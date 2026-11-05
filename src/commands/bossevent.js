const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const boss = require("../services/boss");
const { UserError, fmt, toCents } = require("../utils/money");
const { requireAdmin, requireSupport } = require("../utils/perms");
const { rows } = require("../utils/box");

const rarityOpt = o => o.setName("rarity").setDescription("Boss tier").setRequired(true)
    .addChoices(...boss.RARITIES.map(r => ({ name: r, value: r })));

module.exports = {
    data: new SlashCommandBuilder()
        .setName("bossevent")
        .setDescription("Run the boss event (staff)")
        .addSubcommand(s => s.setName("give").setDescription("Give a customer boss tokens")
            .addUserOption(o => o.setName("user").setDescription("Customer").setRequired(true))
            .addIntegerOption(o => o.setName("amount").setDescription("Tokens").setMinValue(1).setMaxValue(100).setRequired(true)))
        .addSubcommand(s => s.setName("prizes").setDescription("List every prize with its id, stock and weight"))
        .addSubcommand(s => s.setName("prize_add").setDescription("Add a prize to a boss's loot table")
            .addStringOption(rarityOpt)
            .addStringOption(o => o.setName("name").setDescription("What it's called").setRequired(true).setMaxLength(80))
            .addStringOption(o => o.setName("kind").setDescription("Wallet credit pays instantly; item is delivered by staff").setRequired(true)
                .addChoices({ name: "wallet credit", value: "credit" }, { name: "item (staff deliver)", value: "item" }))
            .addNumberOption(o => o.setName("usd").setDescription("Wallet credit amount in USD (credit prizes)").setMinValue(0.01).setMaxValue(1000))
            .addIntegerOption(o => o.setName("stock").setDescription("How many can be won (leave empty for unlimited)").setMinValue(1))
            .addIntegerOption(o => o.setName("weight").setDescription("Chance within the tier (default 1, higher = more likely)").setMinValue(1).setMaxValue(1000)))
        .addSubcommand(s => s.setName("prize_remove").setDescription("Take a prize out of the loot tables")
            .addIntegerOption(o => o.setName("id").setDescription("Prize id from /bossevent prizes").setRequired(true)))
        .addSubcommand(s => s.setName("odds").setDescription("What the event costs you: expected credit per token and as % of spend"))
        .addSubcommand(s => s.setName("wins").setDescription("Item prizes waiting to be delivered"))
        .addSubcommand(s => s.setName("redeem").setDescription("Mark an item prize as delivered")
            .addIntegerOption(o => o.setName("drop").setDescription("Drop id").setRequired(true)))
        .addSubcommand(s => s.setName("stats").setDescription("Tokens earned, kills, credit given away")),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        if (["wins", "redeem", "give"].includes(sub)) requireSupport(interaction.member); else requireAdmin(interaction.member);
        const reply = o => interaction.reply({ ephemeral: true, allowedMentions: { parse: [] }, ...o });
        const embed = (title, desc) => ({ embeds: [new EmbedBuilder().setColor(0xe91e63).setAuthor({ name: title }).setDescription(desc)] });

        if (sub === "give") {
            const user = interaction.options.getUser("user");
            const n = await boss.give({ discordId: user.id, amount: interaction.options.getInteger("amount"), actorId: interaction.user.id });
            return reply({ content: `✅ Gave ${interaction.options.getInteger("amount")} token(s) to ${user}. They now have ${n}.` });
        }

        if (sub === "prizes") {
            const list = await boss.listPrizes();
            const lines = list.map(p => `**#${p.id}** ${p.active ? "" : "~~"}${p.rarity} — ${p.name}${p.kind === "item" ? " 🎁" : ""} · weight ${p.weight} · ${p.stock === null ? "unlimited" : p.stock + " left"}${p.active ? "" : "~~"}`);
            return reply(embed("🎁 Boss prizes", lines.join("\n").slice(0, 4000) || "No prizes."));
        }

        if (sub === "prize_add") {
            const kind = interaction.options.getString("kind");
            const usd = interaction.options.getNumber("usd");
            const p = await boss.addPrize({
                rarity: interaction.options.getString("rarity"), name: interaction.options.getString("name"), kind,
                creditCents: usd ? toCents(usd) : 0, stock: interaction.options.getInteger("stock"), weight: interaction.options.getInteger("weight") || 1
            });
            return reply({ content: `✅ Added prize #${p.id}: ${p.name} (${p.rarity}).` });
        }

        if (sub === "prize_remove") {
            const p = await boss.removePrize(interaction.options.getInteger("id"));
            return reply({ content: `✅ Removed prize #${p.id}: ${p.name}.` });
        }

        if (sub === "odds") {
            const o = await boss.expectedValue();
            const lines = Object.entries(o.perRarity).map(([r, v]) => `\`${r.padEnd(9)}:\` ${(v.chance * 100).toFixed(1)}% · avg credit ${fmt(Math.round(v.avgCents))}`);
            return reply(embed("📊 Event cost", lines.join("\n") + "\n\n" + rows([
                ["Per token", `${fmt(Math.round(o.evCents))} wallet credit (item prizes not counted)`],
                ["Spend/token", fmt(o.perCents)],
                ["Cost", o.payoutPct === null ? "—" : `${o.payoutPct.toFixed(1)}% of spend`]], 11)));
        }

        if (sub === "wins") {
            const list = await boss.pendingItems();
            if (!list.length) return reply({ content: "No item prizes waiting." });
            return reply(embed("🎁 Waiting for delivery", list.map(d => `**#${d.id}** <@${d.discord_id}> — ${d.prize_name}`).join("\n")));
        }

        if (sub === "redeem") {
            const d = await boss.redeem({ dropId: interaction.options.getInteger("drop"), actorId: interaction.user.id });
            return reply({ content: `✅ Marked drop #${d.id} (${d.prize_name}) as delivered to <@${d.discord_id}>.` });
        }

        if (sub === "stats") {
            const s = await boss.stats();
            return reply(embed("📈 Boss event", rows([
                ["Players", s.players], ["Tokens earned", s.earned], ["Tokens unused", s.unused], ["Kills", s.kills],
                ["Credit given", fmt(s.creditCents)], ["Items pending", `${s.items.pending} of ${s.items.total}`],
                ["Drops", boss.RARITIES.map(r => `${r} ${s.byRarity[r] || 0}`).join(" · ")]], 13)));
        }
    }
};
