// USDC on Base, signed by one hot-wallet key held in the PAYOUT_PRIVATE_KEY variable.
// Everything chain-related lives here so tests can swap in a fake sender.
const { ethers } = require("ethers");

const CHAIN_ID = 8453;
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // native USDC on Base
const ERC20 = ["function transfer(address to, uint256 amount) returns (bool)", "function balanceOf(address) view returns (uint256)"];
const METHOD = "USDC-BASE";

let override = null;
let cached = null;
let queue = Promise.resolve(); // sends run one at a time so nonces never collide

const configured = () => Boolean(override || process.env.PAYOUT_PRIVATE_KEY);
const isValidAddress = a => /^0x[0-9a-fA-F]{40}$/.test(String(a || "")) && ethers.isAddress(a);
const centsToUnits = cents => BigInt(cents) * 10_000n;           // USDC has 6 decimals
const unitsToCents = units => Number(BigInt(units) / 10_000n);

function real() {
    if (cached) return cached;
    const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL || "https://mainnet.base.org", CHAIN_ID, { staticNetwork: true });
    const key = String(process.env.PAYOUT_PRIVATE_KEY).trim();
    const wallet = new ethers.Wallet(key.startsWith("0x") ? key : `0x${key}`, provider);
    const usdc = new ethers.Contract(USDC, ERC20, wallet);
    cached = {
        address: wallet.address,
        async balances() {
            const [u, e] = await Promise.all([usdc.balanceOf(wallet.address), provider.getBalance(wallet.address)]);
            return { usdcCents: unitsToCents(u), ethWei: e };
        },
        // Sign first so the hash can be saved BEFORE anything reaches the network.
        async prepare(to, units) {
            const data = usdc.interface.encodeFunctionData("transfer", [to, units]);
            const tx = await wallet.populateTransaction({ to: USDC, data, value: 0 });
            const raw = await wallet.signTransaction(tx);
            return { raw, hash: ethers.keccak256(raw) };
        },
        async broadcast(raw) { await provider.broadcastTransaction(raw); },
        async confirm(hash, ms) {
            const r = await provider.waitForTransaction(hash, 1, ms);
            return r ? { confirmed: true, success: r.status === 1 } : { confirmed: false };
        }
    };
    return cached;
}

const sender = () => override || real();
/** Tests (or a future provider) can replace the sender. */
const setSender = s => { override = s; };

/** Run fn when earlier sends are done. */
function serial(fn) {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
}

function address() { try { return sender().address; } catch (e) { return null; } }

module.exports = { METHOD, CHAIN_ID, USDC, configured, isValidAddress, centsToUnits, unitsToCents, sender, setSender, serial, address };
