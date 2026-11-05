const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const boss = require("../services/boss");
const { UserError, fmt } = require("../utils/money");
const { rows } = require("../utils/box");

const sleep = ms => new Promise(r => setTimeout(r, ms));
const bar = pct => { const n = Math.round(pct / 10); return "█".repeat(n) + "░".repeat(10 - n) + ` ${pct}%`; };
const RARITY_LABEL = { common: "Common", uncommon: "Uncommon", rare: "Rare", ultra: "Ultra Rare" };
const prizeText = d => d.kind === "credit" ? `${d.prize_name}` : `🎁 ${d.prize_name} (staff will deliver in your ticket)`;

async function bossEmbed(rarity, title, description, footer) {
    const b = await boss.bossFor(rarity);
    return new EmbedBuilder().setColor(b.color).setAuthor({ name: title })
        .setThumbnail(b.img || null).setDescription(description).setFooter({ text: footer });
}

/** The single-kill show: a boss appears, you fight, it dies, loot drops. */
async function animate(interaction, drop) {
    const names = await Promise.all(boss.RARITIES.map(async r => [r, (await boss.bossFor(r)).name]));
    const roll = [...boss.RARITIES].sort(() => Math.random() - 0.5).filter(r => r !== drop.rarity).slice(0, 2);
    const final = await boss.bossFor(drop.rarity);
    const user = `${interaction.user}`;

    await interaction.reply({ embeds: [await bossEmbed(roll[0], "⚔️ A boss approaches…", `${user} heads into the wilderness…\n\n\`Boss   :\` ❓❓❓\n\`HP     :\` ${bar(100)}`, "Rolling…")] });
    await sleep(1100);
    await interaction.editReply({ embeds: [await bossEmbed(roll[1], "⚔️ A boss approaches…", `\`Boss   :\` 👁️ …is that ${names.find(n => n[0] === roll[1])[1]}?\n\`HP     :\` ${bar(100)}`, "Rolling…")] });
    await sleep(1100);

    const label = RARITY_LABEL[drop.rarity];
    await interaction.editReply({ embeds: [await bossEmbed(drop.rarity, `⚔️ ${final.name} appears!`, `\`Boss   :\` ${final.name}\n\`Tier   :\` ${label}\n\`HP     :\` ${bar(100)}`, "Fight!")] });
    await sleep(1200);
    for (const hp of [70, 40, 10]) {
        await interaction.editReply({ embeds: [await bossEmbed(drop.rarity, `🗡️ Fighting ${final.name}`, `\`Boss   :\` ${final.name}\n\`Tier   :\` ${label}\n\`HP     :\` ${bar(hp)}`, "Fight!")] });
        await sleep(900);
    }
    await interaction.editReply({ embeds: [await bossEmbed(drop.rarity, `💀 ${final.name} has died!`, `\`Boss   :\` ${final.name}\n\`HP     :\` ${bar(0)}\n\nSomething is dropping…`, "Loot incoming")] });
    await sleep(1400);
    await interaction.editReply({ embeds: [await bossEmbed(drop.rarity, `📦 ${final.name} dropped loot!`,
        rows([["Tier", label], ["Drop", prizeText(drop)]], 5), `Drop #${drop.id}`)] });
}

async function announce(interaction, drops) {
    const id = await require("../services/config").get("boss_announce_channel_id");
    if (!id) return;
    const big = drops.filter(d => d.rarity === "rare" || d.rarity === "ultra");
    if (!big.length) return;
    try {
        const ch = await interaction.guild.channels.fetch(id);
        for (const d of big) {
            const b = await boss.bossFor(d.rarity);
            await ch.send({ content: `🎉 ${interaction.user} slayed **${b.name}** and got **${d.prize_name}**!`, allowedMentions: { parse: [] } });
        }
    } catch (e) { console.error("[boss] announce failed:", e.message); }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("boss")
        .setDescription("The boss event: spend tokens to kill bosses and win loot")
        .addSubcommand(s => s.setName("kill").setDescription("Spend boss tokens to fight a boss")
            .addIntegerOption(o => o.setName("amount").setDescription("How many (default 1, up to 10)").setMinValue(1).setMaxValue(10)))
        .addSubcommand(s => s.setName("tokens").setDescription("How many boss tokens you have and how close the next one is"))
        .addSubcommand(s => s.setName("loot").setDescription("Your recent drops"))
        .addSubcommand(s => s.setName("table").setDescription("The bosses and what they can drop")),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();

        if (sub === "kill") {
            const amount = interaction.options.getInteger("amount") || 1;
            const drops = await boss.kill({ discordId: interaction.user.id, amount });
            if (amount === 1) await animate(interaction, drops[0]);
            else {
                const lines = [];
                for (const d of drops) lines.push(`\`${RARITY_LABEL[d.rarity].padEnd(10)}:\` ${(await boss.bossFor(d.rarity)).name} → ${prizeText(d)}`);
                await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xe91e63).setAuthor({ name: `⚔️ ${interaction.user.displayName} killed ${amount} bosses` }).setDescription(lines.join("\n"))] });
            }
            return announce(interaction, drops);
        }

        if (sub === "tokens") {
            const s = await boss.status(interaction.user.id);
            const on = await boss.enabled();
            const next = s.perCents ? fmt(s.perCents - s.progressCents) : "—";
            return interaction.reply({ ephemeral: true, embeds: [new EmbedBuilder().setColor(0xe91e63).setAuthor({ name: "🗡️ Boss tokens" }).setDescription(
                rows([["Tokens", s.tokens], ["Kills", s.kills], ["Next token", s.perCents ? `${next} more spend` : "—"], ["Event", on ? "running" : "not running"]], 10) +
                `\n\nYou earn 1 token for every ${fmt(s.perCents)} spent on completed orders.`)] });
        }

        if (sub === "loot") {
            const list = await boss.myDrops(interaction.user.id);
            if (!list.length) throw new UserError("No drops yet. Complete an order to earn a boss token.");
            const lines = list.map(d => `**#${d.id}** ${RARITY_LABEL[d.rarity]} — ${d.prize_name}${d.kind === "item" ? (d.redeemed ? " ✅ delivered" : " 🎁 waiting for staff") : ""}`);
            return interaction.reply({ ephemeral: true, embeds: [new EmbedBuilder().setColor(0xe91e63).setAuthor({ name: "📦 Your recent drops" }).setDescription(lines.join("\n"))] });
        }

        if (sub === "table") {
            const [w, prizes] = [await boss.weights(), await boss.listPrizes()];
            const total = Object.values(w).reduce((a, b) => a + b, 0) || 1;
            const e = new EmbedBuilder().setColor(0xe91e63).setAuthor({ name: "☠️ Bosses and loot" });
            for (const r of boss.RARITIES) {
                const ps = prizes.filter(p => p.rarity === r && p.active && (p.stock === null || p.stock > 0));
                if (!ps.length || !w[r]) continue;
                e.addFields({ name: `${(await boss.bossFor(r)).name} — ${RARITY_LABEL[r]} (${Math.round(w[r] / total * 100)}%)`, value: ps.map(p => p.name).join("\n").slice(0, 1000) });
            }
            return interaction.reply({ ephemeral: true, embeds: [e] });
        }
    }
};
