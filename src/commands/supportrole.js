const { SlashCommandBuilder } = require("discord.js");
const supportroles = require("../services/supportroles");
const { requireAdmin } = require("../utils/perms");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("supportrole")
        .setDescription("Set the cut support staff earn on jobs they create (admin)")
        .addSubcommand(s => s.setName("set").setDescription("Set a support role's cut")
            .addRoleOption(o => o.setName("role").setDescription("Support role").setRequired(true))
            .addNumberOption(o => o.setName("percent").setDescription("Cut of each job price, e.g. 5").setMinValue(0).setMaxValue(50).setRequired(true)))
        .addSubcommand(s => s.setName("remove").setDescription("Remove a support role's cut")
            .addRoleOption(o => o.setName("role").setDescription("Role").setRequired(true)))
        .addSubcommand(s => s.setName("list").setDescription("List support cuts")),

    async execute(interaction) {
        requireAdmin(interaction.member);
        const sub = interaction.options.getSubcommand();
        const quiet = { ephemeral: true, allowedMentions: { parse: [] } };

        if (sub === "list") {
            const rows = await supportroles.list();
            const worker = Number(await require("../services/config").get("worker_pct", "80"));
            return interaction.reply({
                content: (rows.length ? rows.map(r => `• <@&${r.role_id}>: **${r.cut_pct}%**`).join("\n") : "No support cuts set. Use `/supportrole set`.") +
                    `\nWorker gets ${worker}%; the house keeps the rest after the support cut.`, ...quiet });
        }
        const role = interaction.options.getRole("role", true);
        if (sub === "set") {
            const pct = interaction.options.getNumber("percent", true);
            await supportroles.set(role.id, role.name, pct);
            return interaction.reply({ content: `✅ <@&${role.id}> now earns **${pct}%** of jobs its members create.`, ...quiet });
        }
        const removed = await supportroles.remove(role.id);
        return interaction.reply({ content: removed ? `✅ Removed the cut for <@&${role.id}>.` : "That role had no cut set.", ...quiet });
    }
};
