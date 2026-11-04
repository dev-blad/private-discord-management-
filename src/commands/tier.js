const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require("discord.js");
const config = require("../services/config");
const pricing = require("../services/pricing");
const { requireAdmin } = require("../utils/perms");
const { fmt, toCents, UserError } = require("../utils/money");

const usd = c => fmt(c).replace(/\.00$/, "");

async function nOf(roleId) {
    const cfg = await config.getAll();
    return Object.keys(cfg).filter(k => k.startsWith("discount_role_")).map(k => k.split("_").pop()).find(n => cfg[`discount_role_${n}`] === roleId) || null;
}

async function tiersEmbed(guild) {
    const tiers = (await pricing.tiers()).sort((a, b) => a.thresholdCents - b.thresholdCents);
    const body = tiers.length
        ? tiers.map(t => `**Spend ${usd(t.thresholdCents)}**\n${t.role ? `<@&${t.role}>` : "(no role)"} = ${t.percent}%`).join("\n")
        : "No tiers set yet.";
    const e = new EmbedBuilder().setColor(0x5865f2)
        .setAuthor({ name: guild?.name || " ", iconURL: guild?.iconURL?.() || undefined })
        .setTitle(`${guild?.name || "Server"} Discount Roles`)
        .setDescription(`Spend more, save more. Your role is added automatically as your total spend grows.\n\n${body}`)
        .setTimestamp();
    if (guild?.iconURL) e.setThumbnail(guild.iconURL());
    return e;
}

module.exports = {
    tiersEmbed,
    data: new SlashCommandBuilder()
        .setName("tier")
        .setDescription("Spend tiers: lifetime spend unlocks a role and a discount (admin)")
        .addSubcommand(s => s.setName("set").setDescription("Add or change a tier")
            .addRoleOption(o => o.setName("role").setDescription("Role customers get").setRequired(true))
            .addNumberOption(o => o.setName("spend").setDescription("Lifetime spend in USD to reach it").setMinValue(1).setRequired(true))
            .addNumberOption(o => o.setName("discount").setDescription("Discount percent").setMinValue(0).setMaxValue(100).setRequired(true)))
        .addSubcommand(s => s.setName("remove").setDescription("Delete a tier")
            .addRoleOption(o => o.setName("role").setDescription("The tier's role").setRequired(true)))
        .addSubcommand(s => s.setName("list").setDescription("Show the tiers"))
        .addSubcommand(s => s.setName("post").setDescription("Post the tier list as an embed in a channel")
            .addChannelOption(o => o.setName("channel").setDescription("Where (default: here)").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))),

    async execute(interaction) {
        requireAdmin(interaction.member);
        const sub = interaction.options.getSubcommand();
        const quiet = { allowedMentions: { parse: [] }, ephemeral: true };

        if (sub === "list") return interaction.reply({ embeds: [await tiersEmbed(interaction.guild)], ...quiet });

        if (sub === "post") {
            const ch = interaction.options.getChannel("channel") || interaction.channel;
            await ch.send({ embeds: [await tiersEmbed(interaction.guild)], allowedMentions: { parse: [] } });
            return interaction.reply({ content: `✅ Posted in <#${ch.id}>.`, ...quiet });
        }

        const role = interaction.options.getRole("role", true);
        if (sub === "remove") {
            const n = await nOf(role.id);
            if (!n) throw new UserError("That role isn't a tier.");
            for (const k of ["threshold", "percent", "role"]) await config.del(`discount_${k}_${n}`);
            return interaction.reply({ content: `🗑️ Removed the <@&${role.id}> tier.`, ...quiet });
        }

        const spend = interaction.options.getNumber("spend");
        toCents(spend);
        let n = await nOf(role.id);
        if (!n) {
            const cfg = await config.getAll();
            n = 1;
            while (cfg[`discount_threshold_${n}`] !== undefined) n++;
        }
        await config.set(`discount_threshold_${n}`, String(spend));
        await config.set(`discount_percent_${n}`, String(interaction.options.getNumber("discount")));
        await config.set(`discount_role_${n}`, role.id);
        return interaction.reply({ embeds: [await tiersEmbed(interaction.guild)], content: `✅ Saved <@&${role.id}>: ${usd(Math.round(spend * 100))} → ${interaction.options.getNumber("discount")}%`, ...quiet });
    }
};
