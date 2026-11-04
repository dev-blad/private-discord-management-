const { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require("discord.js");
const { toCents } = require("../utils/money");
const { requireSupport } = require("../utils/perms");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("create_order")
        .setDescription("Create an order from this ticket (staff)")
        .addUserOption(o => o.setName("customer").setDescription("Customer").setRequired(true))
        .addNumberOption(o => o.setName("price").setDescription("Price in USD").setMinValue(0.01).setMaxValue(1000000).setRequired(true))
        .addNumberOption(o => o.setName("deposit").setDescription("Deposit the worker must hold, in USD (optional)").setMinValue(0).setMaxValue(1000000)),

    async execute(interaction) {
        requireSupport(interaction.member);
        const customer = interaction.options.getUser("customer", true);
        const price = toCents(interaction.options.getNumber("price", true));
        const deposit = toCents(interaction.options.getNumber("deposit") || 0);

        const modal = new ModalBuilder()
            .setCustomId(`order_modal:${customer.id}:${price}:${deposit}`)
            .setTitle("New Order - Job Details")
            .addComponents(new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId("job_details").setLabel("Job Details")
                    .setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)
                    .setPlaceholder("Skill, level range, method, any notes...")));
        return interaction.showModal(modal);
    }
};
