const { SlashCommandBuilder } = require("discord.js");
const jobroles = require("../services/jobroles");
const { requireAdmin } = require("../utils/perms");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("jobrole")
        .setDescription("Manage which roles count as job roles on a worker's !w (admin)")
        .addSubcommand(s => s.setName("add").setDescription("Add a job role")
            .addRoleOption(o => o.setName("role").setDescription("Role to add").setRequired(true)))
        .addSubcommand(s => s.setName("remove").setDescription("Remove a job role")
            .addRoleOption(o => o.setName("role").setDescription("Role to remove").setRequired(true)))
        .addSubcommand(s => s.setName("list").setDescription("List job roles")),

    async execute(interaction) {
        requireAdmin(interaction.member);
        const sub = interaction.options.getSubcommand();

        if (sub === "list") {
            const roles = await jobroles.list();
            return interaction.reply({
                content: roles.length ? roles.map(r => `• <@&${r.role_id}> (${r.name})`).join("\n") : "No job roles set yet. Use `/jobrole add`.",
                ephemeral: true, allowedMentions: { parse: [] }
            });
        }

        const role = interaction.options.getRole("role", true);
        if (sub === "add") {
            await jobroles.add(role.id, role.name);
            return interaction.reply({ content: `✅ <@&${role.id}> is now a job role.`, ephemeral: true, allowedMentions: { parse: [] } });
        }
        const removed = await jobroles.remove(role.id);
        return interaction.reply({
            content: removed ? `✅ Removed <@&${role.id}> from job roles.` : "That role wasn't a job role.",
            ephemeral: true, allowedMentions: { parse: [] }
        });
    }
};
