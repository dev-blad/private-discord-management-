const { SlashCommandBuilder } = require("discord.js");
const locations = require("../services/locations");
const { requireSupport } = require("../utils/perms");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("remove_location")
        .setDescription("Delete a mule's saved location (staff)")
        .addStringOption(o => o.setName("rsn").setDescription("Which RSN").setRequired(true).setAutocomplete(true)),

    async autocomplete(interaction) {
        const q = interaction.options.getFocused().toLowerCase();
        const list = await locations.list();
        return interaction.respond(list.filter(l => l.rsn.toLowerCase().includes(q)).slice(0, 25).map(l => ({ name: `${l.rsn} (World ${l.world})`, value: l.rsn })));
    },

    async execute(interaction) {
        requireSupport(interaction.member);
        const rsn = interaction.options.getString("rsn");
        await locations.remove(rsn);
        return interaction.reply({ content: `🗑️ Removed **${rsn}**.`, ephemeral: true });
    }
};
