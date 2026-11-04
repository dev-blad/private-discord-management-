# OSRS Service Bot

Discord bot for a boosting service: USD wallets, job escrow, worker earnings and crypto payout requests.
Postgres is the source of truth; every money movement is an immutable ledger row.

## Money model
- All amounts are stored as integer **USD cents**.
- Each user has `balance` (prepaid, spendable on jobs) and `earnings` (withdrawable by workers).
- `/create_order` escrows the price from the customer's balance and posts the job. `/finish_order` credits the worker `worker_pct`% (config, default 80) to earnings; the rest is house profit. `/cancel_order` refunds.
- `/claimearnings` holds the funds, staff Approve → send crypto → **Mark as paid** with the tx reference. Reject returns the money.
- The `ledger` table is append-only (enforced by a trigger). Totals can always be reconciled from it.

## Commands
| Command | Who | What |
|---|---|---|
| `/wallet check|history` | anyone (own) / staff (others) | balance, earnings, lifetime spend |
| `/wallet add|remove` | staff | adjust a customer balance |
| `/create_order`, `/finish_order`, `/cancel_order` | staff | job lifecycle |
| `/job info|list` | anyone | view jobs |
| Claim button on job board | boosters | atomic, first come first served |
| `/payout address|view` | boosters | where earnings are sent |
| `/claimearnings [amount]` | boosters | request a payout |
| `/payout pending` | staff | payouts awaiting action |
| `/pricing show|set|remove` | anyone / staff | pricing with spend-tier discount |
| `/report summary|leaderboard` | staff / anyone | revenue, profit, owed, top users |
| `/report export <table>` | admin | CSV of wallets, ledger, jobs, payouts |
| `/config get|set|list` | admin | runtime settings |

`/accounts`, `/booster`, `/gold` still use Google Sheets and are off unless `ENABLE_LEGACY_SHEETS=true`.

## Setup
1. `npm install`
2. Copy `.env.example` to `.env` (or set the variables in your host) and fill it in.
3. The bot runs migrations on startup. Or run `npm run migrate`.
4. In Discord: `/setchannels` to pick the claim, claimed, completed, cancelled and payout channels.
5. `npm start`

## Migrating from the old system
`npm run import-wallets -- wallets.csv` (dry run), then add `--commit`. CSV: `discord_id,balance_usd[,earnings_usd][,spent_usd]`.

## Tests
`npm test` starts a throwaway Postgres and checks concurrency, escrow, payouts and ledger integrity.

## Automatic payouts (stablecoins on EVM chains)
Supported: USDT or USDC on Ethereum, USDC on Base, USDT on Polygon, USDT on Arbitrum. One wallet key works on all of them (same 0x address).
1. In OneKey create a NEW wallet used only for payouts. Send it a few days of the token plus a little gas (ETH, or POL on Polygon) on each network you use. Ethereum fees are higher; the bot waits when gas is above `max_gas_gwei_1` (default 20).
2. Export that wallet's private key and set it on Railway as `PAYOUT_PRIVATE_KEY`. Do not use your main wallet. Optional: `ETH_RPC_URL`, `BASE_RPC_URL`, `POLYGON_RPC_URL`, `ARBITRUM_RPC_URL`.
3. Workers set `/payout address` with an "automatic" method.
4. `/pot` shows balances. `/autopayout enable` turns it on; `/autopayout limit` sets the per-payout, per-worker and daily caps. `/autopayout disable` stops it instantly.
Payouts above the limit, BTC/LTC/TRC20, and anything that fails wait for staff (Approve & send / Send / Mark as paid).
