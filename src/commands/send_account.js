const { SlashCommandBuilder } = require("discord.js");
const accounts = require("../services/accountsales");
const { toCents, fmt, UserError } = require("../utils/money");
const { requireSupport } = require("../utils/perms");
const { refreshListing, deliveryMessage } = require("../utils/accountCard");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("send_account")
        .setDescription("DM the buyer their account details and log the sale (staff)")
        .addStringOption(o => o.setName("id").setDescription("Account ID").setRequired(true))
        .addUserOption(o => o.setName("user").setDescription("The buyer").setRequired(true))
        .addNumberOption(o => o.setName("price").setDescription("USD actually paid (default: the listed price)").setMinValue(0).setMaxValue(100000)),

    async execute(interaction) {
        requireSupport(interaction.member);
        const buyer = interaction.options.getUser("user");
        const a0 = await accounts.get(interaction.options.getString("id"));
        const details = accounts.readDetails(a0);
        if (!details) throw new UserError(`**${a0.id}** has no delivery details yet. Add them with \`/account_details id:${a0.id}\`.`);

        await interaction.deferReply({ ephemeral: true });
        const paid = interaction.options.getNumber("price");
        const soldCents = paid === null ? Number(a0.price_cents) : toCents(paid);
        const { account, sale } = await accounts.recordSale({ id: a0.id, buyerId: buyer.id, soldCents, soldBy: interaction.user.id });

            const sellerMember = await interaction.guild.members.fetch(account.creator_id).catch(() => null);
        const buyerMember = await interaction.guild.members.fetch(buyer.id).catch(() => null);
        const dm = await deliveryMessage({
            account, details, soldCents, guild: interaction.guild,
            buyerName: buyerMember?.displayName || buyer.username,
            sellerName: sellerMember?.displayName || "Staff"
        });
        try {
            await buyer.send(dm);
        } catch (e) {
            await accounts.undoSale(sale.id);
            throw new UserError(`I couldn't DM ${buyer.username} (their DMs are closed), so nothing was recorded. Ask them to allow DMs from this server and run it again.`);
        }

        await refreshListing(interaction.client, account);
        return interaction.editReply(`✅ Sent **${account.id}** to <@${buyer.id}> and logged the sale at ${fmt(soldCents)}. ${account.stock} left in stock.`);
    }
};
