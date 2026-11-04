const { SlashCommandBuilder } = require("discord.js");
const config = require("../services/config");
const autopay = require("../services/autopay");
const chain = require("../services/chain");
const { fmt, UserError } = require("../utils/money");
const { requireAdmin } = require("../utils/perms");
const { audit } = require("../services/audit");
const { query } = require("../db");

const LIMITS = {
    max: ["auto_payout_max_usd", "Largest payout sent automatically"],
    worker_daily: ["auto_payout_daily_worker_usd", "Most one worker gets automatically per 24h"],
    total_daily: ["auto_payout_daily_total_usd", "Most sent automatically in total per 24h"],
    low_balance: ["pot_low_usd", "Warn staff when the payout wallet falls below this"]
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName("autopayout")
        .setDescription("Control automatic payouts (admin)")
        .addSubcommand(s => s.setName("status").setDescription("Show the current settings"))
        .addSubcommand(s => s.setName("enable").setDescription("Turn automatic payouts on"))
        .addSubcommand(s => s.setName("disable").setDescription("Turn automatic payouts off (instant stop)"))
        .addSubcommand(s => s.setName("limit").setDescription("Change a limit")
            .addStringOption(o => o.setName("which").setDescription("Which limit").setRequired(true)
                .addChoices(...Object.entries(LIMITS).map(([value, [, name]]) => ({ name, value }))))
            .addNumberOption(o => o.setName("usd").setDescription("Amount in USD").setMinValue(0).setMaxValue(100000).setRequired(true))),

    async execute(interaction) {
        requireAdmin(interaction.member);
        const sub = interaction.options.getSubcommand();
        const reply = content => interaction.reply({ content, ephemeral: true });

        if (sub === "enable") {
            if (!chain.configured()) throw new UserError("Add `PAYOUT_PRIVATE_KEY` (or `PAYOUT_XPRV`) on Railway first.");
            await config.set("auto_payout_enabled", "true");
            await audit({ query }, interaction.user.id, "autopayout.enable", "config", "auto_payout_enabled");
            return reply("✅ Automatic payouts are **on**. Use `/autopayout status` to check the limits.");
        }
        if (sub === "disable") {
            await config.set("auto_payout_enabled", "false");
            await audit({ query }, interaction.user.id, "autopayout.disable", "config", "auto_payout_enabled");
            return reply("🛑 Automatic payouts are **off**. New payouts wait for staff.");
        }
        if (sub === "limit") {
            const [key] = LIMITS[interaction.options.getString("which", true)];
            const usd = interaction.options.getNumber("usd", true);
            await config.set(key, String(usd));
            await audit({ query }, interaction.user.id, "autopayout.limit", "config", key, { usd });
            return reply(`✅ Set to **$${usd.toFixed(2)}**.`);
        }
        const s = await autopay.settings();
        return reply(
            `**Automatic payouts: ${s.enabled ? "ON" : "OFF"}**\n` +
            `Payout wallet configured: ${chain.configured() ? "yes" : "no"}\n` +
            `Sent automatically up to ${fmt(s.maxCents)} per payout\n` +
            `Per worker per 24h: ${fmt(s.workerDayCents)}\n` +
            `Total per 24h: ${fmt(s.totalDayCents)}\n` +
            `Low wallet alert: ${fmt(s.lowCents)}\n` +
            `Automatic: USDT/USDC on Ethereum, USDC on Base, USDT on Polygon or Arbitrum. BTC, LTC, TRC20 and bigger payouts wait for staff.`);
    }
};
