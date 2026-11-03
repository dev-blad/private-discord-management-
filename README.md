# OSRS Service Bot

Discord bot for a boosting service: USD wallets, job escrow, worker earnings and crypto payout requests.
Postgres is the source of truth; every money movement is an immutable ledger row.

## Money model
- All amounts are stored as integer **USD cents**.
- Each user has `balance` (prepaid, spendable on jobs) and `earnings` (withdrawable by workers).
- `/job create` escrows the price from the customer's balance. `/job complete` credits the worker `worker_pct`% (config, default 80) to earnings; the rest is house profit. `/job cancel` refunds.
- `/claimearnings` holds the funds, staff Approve → send crypto → **Mark as paid** with the tx reference. Reject returns the money.
- The `ledger` table is append-only (enforced by a trigger). Totals can always be reconciled from it.

## Commands
| Command | Who | What |
|---|---|---|
| `/wallet check|history` | anyone (own) / staff (others) | balance, earnings, lifetime spend |
| `/wallet add|remove` | staff | adjust a customer balance |
| `/job create|complete|cancel` | staff | job lifecycle |
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
4. In Discord: `/config set job_board_channel_id <id>` and `/config set payout_channel_id <id>`.
5. `npm start`

## Migrating from the old system
`npm run import-wallets -- wallets.csv` (dry run), then add `--commit`. CSV: `discord_id,balance_usd[,earnings_usd][,spent_usd]`.

## Tests
`npm test` starts a throwaway Postgres and checks concurrency, escrow, payouts and ledger integrity.
