const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const wallets = require("../services/wallets");
const { toCents, fmt, UserError } = require("../utils/money");
const { isSupport, requireSupport, requireAdmin, requireNotSelf } = require("../utils/perms");
const { walletLog } = require("../utils/walletlog");

const amountOpt = o => o.setName("amount").setDescription("Amount in USD, e.g. 25 or 12.50").setMinValue(0.01).setMaxValue(1000000).setRequired(true);

module.exports = {
    data: new SlashCommandBuilder()
        .setName("wallet")
        .setDescription("Wallet commands (USD)")
        .addSubcommand(s => s.setName("check").setDescription("Check a wallet")
            .addUserOption(o => o.setName("user").setDescription("User (staff only; defaults to you)")))
        .addSubcommand(s => s.setName("add").setDescription("Add funds to a customer's balance (staff)")
            .addUserOption(o => o.setName("user").setDescription("Customer").setRequired(true))
            .addNumberOption(amountOpt)
            .addStringOption(o => o.setName("source").setDescription("How they paid (for your analytics)").addChoices(
                { name: "Crypto", value: "crypto" }, { name: "PayPal", value: "paypal" },
                { name: "GP (gold)", value: "gp" }, { name: "Other", value: "other" }))
            .addStringOption(o => o.setName("note").setDescription("Reason / payment reference").setMaxLength(200)))
        .addSubcommand(s => s.setName("remove").setDescription("Remove funds from a customer's balance (staff)")
            .addUserOption(o => o.setName("user").setDescription("Customer").setRequired(true))
            .addNumberOption(amountOpt)
            .addStringOption(o => o.setName("note").setDescription("Reason").setMaxLength(200)))
        .addSubcommand(s => s.setName("migrate").setDescription("Move someone's old-bot wallet into this one, once (staff)")
            .addUserOption(o => o.setName("user").setDescription("Customer or worker").setRequired(true))
            .addNumberOption(o => o.setName("balance_usd").setDescription("Their spendable balance in USD").setMinValue(0).setMaxValue(1000000))
            .addNumberOption(o => o.setName("earnings_usd").setDescription("A worker's unpaid earnings in USD").setMinValue(0).setMaxValue(1000000))
            .addNumberOption(o => o.setName("spent_gp").setDescription("Lifetime spend in millions of GP (e.g. 200 for 200M), converted at the current rate").setMinValue(0))
            .addNumberOption(o => o.setName("spent_usd").setDescription("Lifetime spend already in USD (use this OR spent_gp)").setMinValue(0).setMaxValue(10000000)))
        .addSubcommand(s => s.setName("import").setDescription("Bulk-migrate wallets from a CSV file (admin)")
            .addAttachmentOption(o => o.setName("file").setDescription("CSV: discord_id,balance_usd,earnings_usd,spent_gp,spent_usd").setRequired(true))
            .addBooleanOption(o => o.setName("dry_run").setDescription("Preview only, change nothing (default: yes)")))
        .addSubcommand(s => s.setName("history").setDescription("Recent wallet activity")
            .addUserOption(o => o.setName("user").setDescription("User (staff only; defaults to you)"))),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const target = interaction.options.getUser("user") || interaction.user;
        const self = target.id === interaction.user.id;

        if (sub === "check" || sub === "history") {
            if (!self) requireSupport(interaction.member);
        } else {
            requireSupport(interaction.member);
        }

        if (sub === "check") {
            const member = self ? interaction.member : await interaction.guild.members.fetch(target.id).catch(() => null);
            const embed = await require("../prefix/w").walletEmbed({ guild: interaction.guild, user: target, member });
            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        if (sub === "history") {
            const rows = await wallets.history(target.id, 15);
            const lines = rows.map(r => {
                const when = Math.floor(r.created_at.getTime() / 1000);
                return `<t:${when}:d> \`${((r.delta_cents > 0 ? "+" : "-") + fmt(Math.abs(r.delta_cents))).padStart(10)}\` ${r.bucket} · ${r.kind}${r.note ? ` (${r.note})` : ""}`;
            });
            const e = new EmbedBuilder().setColor(0x00ae86).setTitle("Wallet History").setDescription(`<@${target.id}>\n\n` + (lines.join("\n") || "No activity yet."))
                .setThumbnail(target.displayAvatarURL({ size: 128 }))
                .setFooter({ text: interaction.guild?.name || " ", iconURL: interaction.guild?.iconURL?.() || undefined });
            return interaction.reply({ embeds: [e], ephemeral: true });
        }

        if (sub === "import") {
            require("../utils/perms").requireAdmin(interaction.member);
            const dry = interaction.options.getBoolean("dry_run") !== false;
            const att = interaction.options.getAttachment("file");
            if (att.size > 2 * 1024 * 1024) throw new UserError("That file is too big (2MB max).");
            await interaction.deferReply({ ephemeral: true });
            const text = await (await fetch(att.url)).text();
            const rate = parseFloat(await require("../services/config").get("gp_usd_rate", process.env.GP_USD_RATE || "0.18"));
            const { parseWalletCsv } = require("../utils/walletCsv");
            const { rows, errors } = parseWalletCsv(text, rate);
            let done = 0, skipped = 0;
            const totals = { balance: 0, earnings: 0, spent: 0 };
            for (const r of rows) {
                if (dry) {
                    const migrated = (await require("../db").query("SELECT 1 FROM audit_log WHERE action='wallet.migrate' AND entity_id=$1 LIMIT 1", [r.discordId])).rows.length;
                    if (migrated) { skipped++; errors.push(`line ${r.line}: ${r.discordId} already migrated`); continue; }
                } else {
                    try {
                        const w = await wallets.migrate({ ...r, actorId: interaction.user.id });
                        await require("../utils/roles").applySpendRole(interaction.guild, r.discordId, w.spent);
                    } catch (e) {
                        if (!(e instanceof UserError)) throw e;
                        skipped++; errors.push(`line ${r.line}: ${r.discordId} ${e.message}`); continue;
                    }
                }
                done++; totals.balance += r.balanceCents; totals.earnings += r.earningsCents; totals.spent += r.spentCents;
            }
            const head = dry ? "🔍 **Preview, nothing changed.** Run again with `dry_run:False` to apply." : "✅ **Import finished.**";
            const errText = errors.length ? `\n\n**Problems (${errors.length})**\n${errors.slice(0, 15).join("\n")}${errors.length > 15 ? "\n…" : ""}` : "";
            return interaction.editReply({
                content: `${head}\n\`People      :\` ${done}${skipped ? ` (${skipped} skipped)` : ""}\n\`Balances    :\` ${fmt(totals.balance)}\n\`Earnings    :\` ${fmt(totals.earnings)}\n\`Lifetime    :\` ${fmt(totals.spent)} (GP converted at $${rate} per 1M)${errText}`
            });
        }

        if (sub === "migrate") {
            requireAdmin(interaction.member);
            const o = interaction.options;
            const gpM = o.getNumber("spent_gp"), spentUsd = o.getNumber("spent_usd");
            if (gpM !== null && spentUsd !== null) throw new UserError("Give lifetime spend as GP or USD, not both.");
            let spentCents = 0;
            if (gpM !== null) {
                const rate = parseFloat(await require("../services/config").get("gp_usd_rate", process.env.GP_USD_RATE || "0.18"));
                spentCents = Math.round(gpM * rate * 100);
            } else if (spentUsd !== null) spentCents = toCents(spentUsd);
            const balanceCents = toCents(o.getNumber("balance_usd") || 0), earningsCents = toCents(o.getNumber("earnings_usd") || 0);
            if (!balanceCents && !earningsCents && !spentCents) throw new UserError("Give at least one of balance, earnings or spend.");
            const w = await wallets.migrate({ discordId: target.id, balanceCents, earningsCents, spentCents, actorId: interaction.user.id });
            await walletLog(interaction, { action: "migrate", targetId: target.id, text: `\`Balance:\` ${fmt(balanceCents)} \`Earnings:\` ${fmt(earningsCents)} \`Spend:\` ${fmt(spentCents)}` });
            await require("../utils/roles").applySpendRole(interaction.guild, target.id, w.spent);
            return interaction.reply({
                content: `✅ Migrated <@${target.id}>: balance ${fmt(w.balance)}, earnings ${fmt(w.earnings)}, lifetime spend ${fmt(w.spent)}` +
                    (gpM !== null ? ` (${gpM}M GP at the current rate)` : "") + ". Any spend-tier role they qualify for was added.",
                ephemeral: true, allowedMentions: { parse: [] }
            });
        }

        requireNotSelf(interaction.member, target.id, interaction.user.id, sub === "add" ? "add money to your wallet" : "change your wallet");
        const cents = toCents(interaction.options.getNumber("amount"));
        const note = interaction.options.getString("note");
        if (sub === "add" && !require("../utils/perms").isAdmin(interaction.member) && !note && !interaction.options.getString("source")) {
            throw new UserError("Say how they paid (`source`) or add a payment reference in `note`, so the deposit can be checked later.");
        }
        const fn = sub === "add" ? wallets.deposit : wallets.charge;
        const r = await fn({ discordId: target.id, cents, actorId: interaction.user.id, note, ...(sub === "add" ? { source: interaction.options.getString("source") } : {}) });
        await walletLog(interaction, { action: sub, targetId: target.id, text: `\`Amount :\` ${fmt(cents)}${interaction.options.getString("source") ? ` · ${interaction.options.getString("source")}` : ""}${note ? `\n\`Note   :\` ${note}` : ""}` });
        return interaction.reply({
            content: `✅ ${sub === "add" ? "Added" : "Removed"} ${fmt(cents)} ${sub === "add" ? "to" : "from"} **${target.username}**. New balance: ${fmt(r.balance)}`,
            ephemeral: true
        });
    }
};
