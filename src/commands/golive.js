const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const config = require("../services/config");
const pricing = require("../services/pricing");
const supportroles = require("../services/supportroles");
const jobroles = require("../services/jobroles");
const chain = require("../services/chain");
const { requireAdmin } = require("../utils/perms");
const { query } = require("../db");

const tick = ok => (ok ? "✅" : "⬜");

module.exports = {
    data: new SlashCommandBuilder().setName("golive").setDescription("Setup checklist for going live on this server (admin)"),

    async execute(interaction) {
        requireAdmin(interaction.member);
        const has = async k => Boolean(await config.get(k));
        const channelKeys = ["claim_channel_id", "claimed_channel_id", "completed_channel_id", "cancelled_channel_id", "payout_channel_id", "vouch_channel_id", "account_channel_id"];
        const missingCh = [];
        for (const k of channelKeys) if (!(await has(k))) missingCh.push(k.replace("_channel_id", ""));
        const linksSet = (await Promise.all([1, 2, 3, 4].map(n => has(`pricing_link_${n}`)))).filter(Boolean).length;
        const tiers = await pricing.tiers();
        const catalog = (await query("SELECT count(*)::int n FROM catalog_entries")).rows[0].n;
        const support = (await supportroles.list()).length;
        const jr = (await jobroles.list()).length;
        const partners = await has("partner_ids");
        const migrated = (await query("SELECT count(DISTINCT entity_id)::int n FROM audit_log WHERE action='wallet.migrate'")).rows[0].n;
        const roleEnv = ["ADMIN_ROLE_ID", "SUPPORT_ROLE_ID", "BOOSTER_ROLE_ID"].filter(k => !process.env[k]);

        const lines = [
            `${tick(!missingCh.length)} **Channels** ${missingCh.length ? `missing: ${missingCh.join(", ")} → \`/setchannels\`` : "all set"}`,
            `${tick(catalog > 0)} **Pricing synced** ${catalog ? `${catalog} entries` : "run `!syncdatabase` (set PRICING_SHEET_ID to the live sheet first)"}`,
            `${tick(linksSet === 4)} **Pricing link buttons** ${linksSet}/4 → \`/config set\``,
            `${tick(tiers.length > 0)} **Spend tiers** ${tiers.length ? `${tiers.length} set` : "none yet → `/tier set` (see below), then `/tier post`"}`,
            `${tick(support > 0)} **Support role cuts** ${support ? `${support} set` : "→ `/supportrole set`"}`,
            `${tick(jr > 0)} **Job roles** ${jr ? `${jr} set` : "→ `/jobrole add`"}`,
            `${tick(partners)} **Profit partners** ${partners ? "set" : "→ `/profit partners`"}`,
            `${tick(!roleEnv.length)} **Role variables** ${roleEnv.length ? `missing on Railway: ${roleEnv.join(", ")}` : "set"}`,
            `${tick(Boolean(process.env.ACCOUNT_ENC_KEY))} **ACCOUNT_ENC_KEY** ${process.env.ACCOUNT_ENC_KEY ? "set" : "add on Railway (needed for account sales and /request_details)"}`,
            `${tick(chain.configured())} **Payout wallet key** ${chain.configured() ? "set" : "add PAYOUT_PRIVATE_KEY on Railway when the wallets are ready"}`,
            `${tick((await config.get("auto_payout_enabled", "false")) === "true")} **Auto payouts** → \`/pot\`, test payout, then \`/autopayout enable\``,
            `${tick(await has("sythe_vouch_url"))} **Sythe vouch link** → \`/config set\` sythe_vouch_url`,
            `${tick(migrated > 0)} **Wallets migrated** ${migrated} so far`
        ].join("\n");

        const manual =
            "**Do on the day**\n" +
            "1. Run `!w` on the old bot for each customer and worker, then `/wallet migrate` with their balance, earnings and lifetime spend. " +
            "Give spend as `spent_gp` (millions) and it's converted to USD at the current rate. Their spend-tier role is added automatically.\n" +
            "2. `/deposit set` each worker's deposit.\n" +
            "3. Add the spend tiers: `/tier set` Novice $200 2%, Magician $1,000 5%, Sorcerer $2,000 10%, Wizard $2,500 12%, Warlock $3,000 15%. Then `/tier post` and delete the old GP-based embed.\n" +
            "4. Switch off Titanite's bot on this server.\n" +
            "5. Rotate old secrets (test bot token, old Google key).";

        return interaction.reply({
            embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("🚀 Go-live checklist").setDescription(`${lines}\n\n${manual}`)
                .setFooter({ text: interaction.guild?.name || " ", iconURL: interaction.guild?.iconURL?.() || undefined })],
            ephemeral: true
        });
    }
};
