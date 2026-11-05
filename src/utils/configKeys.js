// Known settings: shown nicely by /config and suggested while typing.
// type: channel | role | number | percent | usd | bool | url | text
const KEYS = [
    // channels
    { key: "claim_channel_id", label: "Claim channel", group: "Channels", type: "channel", help: "New jobs appear here. Easier: /setchannels" },
    { key: "claimed_channel_id", label: "Claimed channel", group: "Channels", type: "channel", help: "Jobs move here when claimed" },
    { key: "completed_channel_id", label: "Completed channel", group: "Channels", type: "channel", help: "Jobs move here when completed" },
    { key: "cancelled_channel_id", label: "Cancelled channel", group: "Channels", type: "channel", help: "Jobs move here when cancelled" },
    { key: "payout_channel_id", label: "Payouts channel", group: "Channels", type: "channel", help: "Payout requests for approval" },
    { key: "vouch_channel_id", label: "Vouches channel", group: "Channels", type: "channel", help: "Customer reviews are posted here" },
    { key: "account_channel_id", label: "Accounts channel", group: "Channels", type: "channel", help: "Account listings are posted here" },
    // money
    { key: "gp_usd_rate", label: "GP rate (USD per 1M)", group: "Money", type: "number", def: "0.18", help: "Used by !s, !b, !w and account GP prices" },
    { key: "worker_pct", label: "Worker cut", group: "Money", type: "percent", def: "80", help: "Share of each job the worker earns" },
    { key: "house_buffer_pct", label: "Wallet buffer", group: "Money", type: "percent", def: "1", help: "Share of each job kept as a cushion. Easier: /profit buffer" },
    { key: "min_payout_usd", label: "Minimum payout", group: "Money", type: "usd", help: "Smallest /claimearnings request" },
    { key: "discount_role_id", label: "Discount role", group: "Money", type: "role", help: "Role that gets the flat discount" },
    { key: "discount_pct", label: "Discount", group: "Money", type: "percent", def: "2", help: "Flat discount for that role" },
    // payouts
    { key: "auto_payout_enabled", label: "Auto payouts", group: "Payouts", type: "bool", def: "false", help: "Easier: /autopayout enable|disable" },
    { key: "auto_payout_max_usd", label: "Auto limit per payout", group: "Payouts", type: "usd", def: "100", help: "Bigger payouts need approval" },
    { key: "auto_payout_daily_worker_usd", label: "Daily limit per worker", group: "Payouts", type: "usd", def: "250" },
    { key: "auto_payout_daily_total_usd", label: "Daily limit total", group: "Payouts", type: "usd", def: "1000" },
    { key: "partner_ids", label: "Profit partners", group: "Payouts", type: "text", help: "Easier: /profit partners" },
    // pricing menu
    { key: "pricing_header_image", label: "Pricing header image", group: "Pricing menu", type: "url", help: "Banner shown above the dropdowns" },
    { key: "pricing_menu_order", label: "Menu order", group: "Pricing menu", type: "text", help: "Order of the dropdown menus" },
    { key: "coin_emoji", label: "Coin emoji", group: "Pricing menu", type: "text", def: "🪙", help: "Shown next to GP amounts" },
    { key: "pricing_link_1", label: "Link button 1", group: "Pricing menu", type: "text", help: "Format: Label | https://link | optional emoji" },
    { key: "pricing_link_2", label: "Link button 2", group: "Pricing menu", type: "text" },
    { key: "pricing_link_3", label: "Link button 3", group: "Pricing menu", type: "text" },
    { key: "pricing_link_4", label: "Link button 4", group: "Pricing menu", type: "text" },
    // links
    { key: "sythe_vouch_url", label: "Sythe vouch thread", group: "Links", type: "url", help: "Shown in account delivery DMs" }
];

const byKey = Object.fromEntries(KEYS.map(k => [k.key, k]));

const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** Value as it should look in Discord. */
function show(def, value) {
    if (value === null || value === undefined || value === "") return def?.def !== undefined ? `*default* ${show(def, def.def)}` : "*not set*";
    switch (def?.type) {
        case "channel": return /^\d+$/.test(value) ? `<#${value}>` : value;
        case "role": return /^\d+$/.test(value) ? `<@&${value}>` : value;
        case "percent": return `${value}%`;
        case "usd": return `$${value}`;
        case "bool": return value === "true" ? "✅ On" : "❌ Off";
        default: return trunc(String(value), 60);
    }
}

module.exports = { KEYS, byKey, show, trunc };
