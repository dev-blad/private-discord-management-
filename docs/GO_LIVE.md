# Go-live runbook

When Daniel says it's go-live night, walk him through this in order. `/golive` in Discord shows the live checklist.

1. Railway variables: PRICING_SHEET_ID (live sheet, shared with the service account), ACCOUNT_ENC_KEY, ADMIN/SUPPORT/BOOSTER role IDs, PAYOUT_PRIVATE_KEY (when Angelo's wallets are ready).
2. Invite the bot to the real server, then `/setchannels` (claim, claimed, completed, cancelled, payouts, vouches, accounts).
3. `!syncdatabase`, `/pricing_dropdown`, `/config set pricing_link_1..4`, `/config set sythe_vouch_url`.
4. Spend tiers (USD): Novice $200 2%, Magician $1,000 5%, Sorcerer $2,000 10%, Wizard $2,500 12%, Warlock $3,000 15% via `/tier set`, then `/tier post` and delete the old GP embed.
5. `/supportrole set`, `/jobrole add`, `/profit partners`.
6. Wallets: Titanite's report is sent in chat; convert it to the CSV below and run `/wallet import` (dry run first). Lifetime spend in GP is converted at gp_usd_rate (check the rate first). `/wallet migrate` for one-offs.
   CSV header: `discord_id,balance_usd,earnings_usd,spent_gp,spent_usd` (spent_gp is millions; use one of spent_gp / spent_usd).
7. `/deposit set` for each worker's deposit.
8. Payouts: fund the payout wallet, `/pot`, a $10 test payout, then `/autopayout enable`.
9. Switch off Titanite's bot on the server; rotate old secrets (test bot token, old Google key).

## Boss event (December)
1. `/config set boss_usd_per_token 25` (spend per token) and optionally `boss_announce_channel_id`.
2. Review loot with `/bossevent prizes`; add item prizes with `/bossevent prize_add`; check cost with `/bossevent odds`.
3. Turn on with `/config set boss_enabled true`. Tokens only come from orders completed while it is on.
4. Staff deliver item wins with `/bossevent wins` then `/bossevent redeem`.
