// Stablecoin payouts on EVM chains, signed by ONE hot-wallet key (PAYOUT_PRIVATE_KEY).
// The same 0x address works on every network below; it just has to hold the token and some gas there.
// Everything chain-related lives here so tests can swap in a fake sender.
const { ethers } = require("ethers");

const ERC20 = [
    "function transfer(address to, uint256 amount)",
    "function balanceOf(address) view returns (uint256)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)"
];

// Payout method (saved by workers with /payout address) -> token on a network.
const ASSETS = {
    "USDT-ERC20":   { label: "USDT (Ethereum)", symbol: "USDT", decimals: 6, chainId: 1,     gas: "ETH", rpcEnv: "ETH_RPC_URL",      rpc: "https://ethereum-rpc.publicnode.com", token: "0xdAC17F958D2ee523a2206206994597C13D831ec7", defaultMaxGwei: 20 },
    "USDC-ERC20":   { label: "USDC (Ethereum)", symbol: "USDC", decimals: 6, chainId: 1,     gas: "ETH", rpcEnv: "ETH_RPC_URL",      rpc: "https://ethereum-rpc.publicnode.com", token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", defaultMaxGwei: 20 },
    "USDC-BASE":    { label: "USDC (Base)",     symbol: "USDC", decimals: 6, chainId: 8453,  gas: "ETH", rpcEnv: "BASE_RPC_URL",     rpc: "https://mainnet.base.org",            token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
    "USDT-POLYGON": { label: "USDT (Polygon)",  symbol: "USDT", decimals: 6, chainId: 137,   gas: "POL", rpcEnv: "POLYGON_RPC_URL",  rpc: "https://polygon-bor-rpc.publicnode.com", token: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F" },
    "USDT-ARBITRUM":{ label: "USDT (Arbitrum)", symbol: "USDT", altSymbols: ["USD₮0"], decimals: 6, chainId: 42161, gas: "ETH", rpcEnv: "ARBITRUM_RPC_URL", rpc: "https://arb1.arbitrum.io/rpc",        token: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9" }
};

let override = null;
let queue = Promise.resolve(); // sends run one at a time so nonces never collide
const cache = new Map();

const supports = method => Object.prototype.hasOwnProperty.call(ASSETS, method);
const asset = method => ASSETS[method];
const configured = () => Boolean(override || process.env.PAYOUT_PRIVATE_KEY || process.env.PAYOUT_XPRV);
const isValidAddress = a => /^0x[0-9a-fA-F]{40}$/.test(String(a || "")) && ethers.isAddress(a);
const centsToUnits = (cents, decimals = 6) => BigInt(cents) * 10n ** BigInt(decimals - 2);
const unitsToCents = (units, decimals = 6) => Number(BigInt(units) / 10n ** BigInt(decimals - 2));

class GasTooHigh extends Error {}

/**
 * The signing key. Either a plain 0x key (PAYOUT_PRIVATE_KEY), or an extended private key
 * (PAYOUT_XPRV, e.g. exported from OneKey) from which the key at PAYOUT_XPRV_PATH (default "0/0") is derived.
 */
function walletKey() {
    const xprv = String(process.env.PAYOUT_XPRV || "").trim();
    if (xprv && !process.env.PAYOUT_PRIVATE_KEY) {
        const path = String(process.env.PAYOUT_XPRV_PATH || "0/0").trim();
        return ethers.HDNodeWallet.fromExtendedKey(xprv).derivePath(path).privateKey;
    }
    const key = String(process.env.PAYOUT_PRIVATE_KEY || "").trim();
    return key.startsWith("0x") ? key : `0x${key}`;
}

function real(method) {
    if (cache.has(method)) return cache.get(method);
    const a = ASSETS[method];
    const provider = new ethers.JsonRpcProvider(process.env[a.rpcEnv] || a.rpc, a.chainId, { staticNetwork: true });
    const wallet = new ethers.Wallet(walletKey(), provider);
    const token = new ethers.Contract(a.token, ERC20, wallet);
    let verified = false;
    // Refuse to touch a contract that isn't the token we think it is.
    const verify = async () => {
        if (verified) return;
        const [sym, dec] = await Promise.all([token.symbol(), token.decimals()]);
        if (![a.symbol, ...(a.altSymbols || [])].includes(sym) || Number(dec) !== a.decimals) throw new Error(`Token check failed on ${a.label}: found ${sym}/${dec}`);
        verified = true;
    };
    const s = {
        address: wallet.address,
        asset: a,
        async balances() {
            await verify();
            const [t, g] = await Promise.all([token.balanceOf(wallet.address), provider.getBalance(wallet.address)]);
            return { tokenCents: unitsToCents(t, a.decimals), gasWei: g };
        },
        // Sign first so the hash can be saved BEFORE anything reaches the network.
        async prepare(to, units, { maxGwei = 0 } = {}) {
            await verify();
            const data = token.interface.encodeFunctionData("transfer", [to, units]);
            const tx = await wallet.populateTransaction({ to: a.token, data, value: 0 });
            if (maxGwei > 0 && tx.maxFeePerGas && tx.maxFeePerGas > ethers.parseUnits(String(maxGwei), "gwei"))
                throw new GasTooHigh(`Network fees are high right now (${ethers.formatUnits(tx.maxFeePerGas, "gwei").slice(0, 6)} gwei, limit ${maxGwei})`);
            const raw = await wallet.signTransaction(tx);
            return { raw, hash: ethers.keccak256(raw) };
        },
        async broadcast(raw) { await provider.broadcastTransaction(raw); },
        async confirm(hash, ms) {
            const r = await provider.waitForTransaction(hash, 1, ms);
            return r ? { confirmed: true, success: r.status === 1 } : { confirmed: false };
        }
    };
    cache.set(method, s);
    return s;
}

/** The sender for a payout method. Tests can replace it with setSender(fn | object). */
function sender(method) {
    if (override) return typeof override === "function" ? override(method) : override;
    return real(method);
}
const setSender = s => { override = s; };

/** Run fn when earlier sends are done. */
function serial(fn) {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
}

/** The payout wallet's address (derived from the key; no network needed). */
function address() {
    try {
        if (override) { const s = typeof override === "function" ? override("USDC-BASE") : override; return s.address || null; }
        return (process.env.PAYOUT_PRIVATE_KEY || process.env.PAYOUT_XPRV) ? new ethers.Wallet(walletKey()).address : null;
    } catch (e) { return null; }
}

const explorer = (method, hash) => {
    const base = { 1: "https://etherscan.io/tx/", 8453: "https://basescan.org/tx/", 137: "https://polygonscan.com/tx/", 42161: "https://arbiscan.io/tx/" }[ASSETS[method]?.chainId] || "https://etherscan.io/tx/";
    return base + hash;
};

module.exports = { walletKey, ASSETS, GasTooHigh, supports, asset, configured, isValidAddress, centsToUnits, unitsToCents, sender, setSender, serial, address, explorer };
