const { SlashCommandBuilder } = require("discord.js");
const config = require("../services/config");
const { requireAdmin } = require("../utils/perms");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("config")
        .setDescription("View or update bot configuration (admin)")
        .addSubcommand(s => s.setName("get").setDescription("Get a value")
            .addStringOption(o => o.setName("key").setDescription("Config key").setRequired(true)))
        .addSubcommand(s => s.setName("set").setDescription("Set a value")
            .addStringOption(o => o.setName("key").setDescription("Config key").setRequired(true).setMaxLength(100))
            .addStringOption(o => o.setName("value").setDescription("Value").setRequired(true).setMaxLength(500)))
        .addSubcommand(s => s.setName("list").setDescription("List all values")),

    async execute(interaction) {
        requireAdmin(interaction.member);
        const sub = interaction.options.getSubcommand();

        if (sub === "get") {
            const key = interaction.options.getString("key");
            const v = await config.get(key);
            return interaction.reply({ content: v !== null ? `⚙️ **${key}** = ${v}` : `❌ Key "${key}" not found.`, ephemeral: true });
        }
        if (sub === "set") {
            const key = interaction.options.getString("key");
            const value = interaction.options.getString("value");
            await config.set(key, value);
            return interaction.reply({ content: `✅ Set **${key}** = ${value}`, ephemeral: true });
        }
        const all = await config.getAll();
        const list = Object.entries(all).map(([k, v]) => `• **${k}** = ${v}`).join("\n");
        return interaction.reply({ content: list ? `⚙️ **Config**\n${list}` : "No config set.", ephemeral: true });
    }
};
