const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const config = require("../services/config");
const { requireAdmin } = require("../utils/perms");
const { UserError } = require("../utils/money");
const { KEYS, byKey, show, trunc } = require("../utils/configKeys");

const keyOption = o => o.setName("key").setDescription("Setting (start typing to search)").setRequired(true).setAutocomplete(true).setMaxLength(100);

module.exports = {
    data: new SlashCommandBuilder()
        .setName("config")
        .setDescription("View or update bot settings (admin)")
        .addSubcommand(s => s.setName("get").setDescription("Show one setting").addStringOption(keyOption))
        .addSubcommand(s => s.setName("set").setDescription("Change a setting").addStringOption(keyOption)
            .addStringOption(o => o.setName("value").setDescription("New value").setRequired(true).setMaxLength(500)))
        .addSubcommand(s => s.setName("list").setDescription("Show all settings")),

    async autocomplete(interaction) {
        if (!require("../utils/perms").isAdmin(interaction.member)) return interaction.respond([]);
        const q = interaction.options.getFocused().toLowerCase().replace(/\s+/g, "");
        const all = await config.getAll();
        const extra = Object.keys(all).filter(k => !byKey[k]).map(k => ({ key: k, label: k, group: "Other" }));
        const hits = [...KEYS, ...extra]
            .filter(k => (k.key + k.label).toLowerCase().replace(/[\s_()]/g, "").includes(q.replace(/_/g, "")))
            .slice(0, 25)
            .map(k => ({ name: trunc(`${k.label} — ${k.key}`, 100), value: k.key }));
        return interaction.respond(hits);
    },

    async execute(interaction) {
        requireAdmin(interaction.member);
        const sub = interaction.options.getSubcommand();
        const footer = { text: interaction.guild?.name || " ", iconURL: interaction.guild?.iconURL?.() || undefined };
        const reply = embed => interaction.reply({ embeds: [embed.setFooter(footer)], ephemeral: true, allowedMentions: { parse: [] } });

        if (sub === "list") {
            const all = await config.getAll();
            const groups = new Map();
            for (const k of KEYS) {
                if (!groups.has(k.group)) groups.set(k.group, []);
                groups.get(k.group).push(k);
            }
            const other = Object.keys(all).filter(k => !byKey[k]);
            if (other.length) groups.set("Other", other.map(k => ({ key: k, label: k, group: "Other" })));

            const blocks = [];
            for (const [name, ks] of groups) {
                const w = Math.max(...ks.map(k => k.label.length));
                blocks.push(`**${name}**\n` + ks.map(k => `\`${k.label.padEnd(w)}\` ${show(k, all[k.key])}`).join("\n"));
            }
            return reply(new EmbedBuilder().setColor(0x5865f2).setTitle("⚙️ Settings")
                .setDescription(blocks.join("\n\n") + "\n\n*Change one with* `/config set` *and start typing its name.*"));
        }

        const key = interaction.options.getString("key").trim();
        const def = byKey[key] || { key, label: key, type: "text" };

        if (sub === "get") {
            const v = await config.get(key);
            if (v === null && !byKey[key]) throw new UserError(`No setting called \`${key}\`. Start typing and pick one from the list.`);
            return reply(new EmbedBuilder().setColor(0x5865f2).setTitle(`⚙️ ${def.label}`)
                .setDescription(`\`Key  :\` ${key}\n\`Value:\` ${show(def, v)}` + (def.help ? `\n\n${def.help}` : "")));
        }

        const value = interaction.options.getString("value").trim();
        if (["number", "percent", "usd"].includes(def.type) && !(Number(value) >= 0)) throw new UserError(`**${def.label}** needs a number, e.g. \`${def.def || 10}\`.`);
        if (["channel", "role"].includes(def.type) && !/^\d{15,25}$/.test(value)) throw new UserError(`**${def.label}** needs a ${def.type} ID. For channels, \`/setchannels\` is easier.`);
        if (def.type === "bool" && !["true", "false"].includes(value)) throw new UserError(`**${def.label}** must be \`true\` or \`false\`.`);
        await config.set(key, value);
        return reply(new EmbedBuilder().setColor(0x2ecc71).setTitle(`✅ ${def.label} updated`).setDescription(`\`Key  :\` ${key}\n\`Value:\` ${show(def, value)}`));
    }
};
