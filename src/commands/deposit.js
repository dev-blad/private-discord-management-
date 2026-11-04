const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const deposits = require("../services/deposits");
const { toCents, fmt } = require("../utils/money");
const { requireSupport } = require("../utils/perms");

const amount = o => o.setName("amount").setDescription("USD").setMinValue(0.01).setMaxValue(1000000).setRequired(true);
const user = o => o.setName("user").setDescription("Worker").setRequired(true);

module.exports = {
    data: new SlashCommandBuilder()
        .setName("deposit")
        .setDescription("Worker security deposits (staff)")
        .addSubcommand(s => s.setName("add").setDescription("Record a deposit a worker paid").addUserOption(user).addNumberOption(amount))
        .addSubcommand(s => s.setName("remove").setDescription("Take some of a worker's deposit off the record (refund or penalty)").addUserOption(user).addNumberOption(amount))
        .addSubcommand(s => s.setName("set").setDescription("Set a worker's deposit to an exact amount").addUserOption(user)
            .addNumberOption(o => o.setName("amount").setDescription("USD").setMinValue(0).setMaxValue(1000000).setRequired(true)))
        .addSubcommand(s => s.setName("check").setDescription("Show one worker's deposit").addUserOption(user))
        .addSubcommand(s => s.setName("list").setDescription("Everyone's deposits")),

    async execute(interaction) {
        requireSupport(interaction.member);
        const sub = interaction.options.getSubcommand();
        const target = interaction.options.getUser("user");
        const mention = { allowedMentions: { parse: [] }, ephemeral: true };

        if (sub === "list") {
            const rows = await deposits.list();
            const text = rows.length ? rows.map(r => `<@${r.discord_id}> · **${fmt(Number(r.amount_cents))}**`).join("\n") : "No deposits recorded.";
            const total = rows.reduce((n, r) => n + Number(r.amount_cents), 0);
            return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x00ae86).setTitle("Worker deposits")
                .setDescription(`${text}\n\n\`Total held  :\` ${fmt(total)}`)], ...mention });
        }
        if (sub === "check") return interaction.reply({ content: `<@${target.id}> has **${fmt(await deposits.get(target.id))}** on deposit.`, ...mention });

        const cents = toCents(interaction.options.getNumber("amount"));
        const note = `by ${interaction.user.username}`;
        const next = sub === "set"
            ? await deposits.set({ discordId: target.id, cents, actorId: interaction.user.id, note })
            : await deposits.adjust({ discordId: target.id, delta: sub === "add" ? cents : -cents, actorId: interaction.user.id, note });
        return interaction.reply({ content: `✅ <@${target.id}> now has **${fmt(next)}** on deposit.`, ...mention });
    }
};
