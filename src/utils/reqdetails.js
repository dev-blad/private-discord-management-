const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle
} = require("discord.js");
const svc = require("../services/reqdetails");
const { UserError } = require("./money");
const { isAdmin } = require("./perms");

const footer = guild => ({ text: guild?.name || " ", iconURL: guild?.iconURL?.() || undefined });

function requestMessage(r, { done = false, guild, requesterName } = {}) {
    const embed = new EmbedBuilder().setColor(0x3498db).setTitle("📝 Account Details Request")
        .setDescription(
            "Someone has requested account details. Click the button below to submit the account information.\n\n" +
            "**Required Information**\n• Client (Runelite or Launcher)\n• Username\n• Password\n• PIN\n\n" +
            "🔒 Only the worker on your order can see these. They're stored encrypted, never shown in the channel.")
        .setFooter({ text: `Requested by ${requesterName || "staff"}${guild?.name ? " | " + guild.name : ""}` }).setTimestamp();
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`reqdet_submit:${r.id}`)
        .setLabel(done ? "Submitted" : "Submit Details").setEmoji(done ? "✅" : "📝")
        .setStyle(done ? ButtonStyle.Secondary : ButtonStyle.Success).setDisabled(done));
    return { content: done ? undefined : `<@${r.customer_id}> please fill in the details below.`, embeds: [embed], components: [row] };
}

async function onSubmitButton(interaction, id) {
    const r = await svc.get(id);
    if (interaction.user.id !== r.customer_id) throw new UserError("This request isn't for you.");
    if (r.status === "submitted") throw new UserError("Details were already submitted.");
    const f = (cid, label, ph, max = 100) => new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(cid)
        .setLabel(label).setPlaceholder(ph).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(max));
    return interaction.showModal(new ModalBuilder().setCustomId(`reqdet_modal:${id}`).setTitle("Account Details Request").addComponents(
        f("client", "Client", "Enter 'Runelite' or 'Launcher'", 30),
        f("username", "Username", "Enter the account username or email"),
        f("password", "Password", "Enter the account password"),
        f("pin", "PIN", "Enter the account PIN (4 digits) or 0000", 4)));
}

async function onModal(interaction, id) {
    const f = cid => interaction.fields.getTextInputValue(cid).trim();
    const details = { client: f("client"), username: f("username"), password: f("password"), pin: f("pin") };
    if (!/^\d{4}$/.test(details.pin)) throw new UserError("The PIN must be exactly 4 digits (use 0000 if there isn't one).");
    const r = await svc.submit({ id, userId: interaction.user.id, details });

    // The request message loses its button; a confirmation with a View Details button goes in the channel.
    const requester = await interaction.guild.members.fetch(r.requested_by).catch(() => null);
    await interaction.update(requestMessage(r, { done: true, guild: interaction.guild, requesterName: requester?.displayName }));
    const done = new EmbedBuilder().setColor(0x2ecc71).setTitle("✅ Details Submitted")
        .setDescription("Account details have been submitted successfully. Click the button below to view the stored information.")
        .setFooter({ text: `${interaction.user.id} | ${interaction.guild?.name || ""}` }).setTimestamp();
    await interaction.channel.send({
        embeds: [done],
        components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`reqdet_view:${id}`)
            .setLabel("View Details").setEmoji("👁️").setStyle(ButtonStyle.Primary))]
    });
}

async function onView(interaction, id) {
    const { request: r, details: d } = await svc.view(id, interaction.user, isAdmin(interaction.member));
    const spoil = x => `||${String(x).replace(/\|/g, "\\|")}||`;
    const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("📋 Account Details").setDescription(
        "Here are the submitted account details:\n\n" +
        `**Client**\n${d.client}\n**Username**\n${d.username}\n**Password**\n${spoil(d.password)}\n**PIN**\n${spoil(d.pin)}\n` +
        `**Requested By**\n<@${r.requested_by}>\n**Submitted By**\n<@${r.submitted_by}>\n**Channel**\n<#${r.channel_id}>\n` +
        `**Date**\n<t:${Math.floor(new Date(r.submitted_at).getTime() / 1000)}:f>`)
        .setFooter(footer(interaction.guild)).setTimestamp();
    return interaction.reply({ embeds: [embed], ephemeral: true, allowedMentions: { parse: [] } });
}

module.exports = { requestMessage, onSubmitButton, onModal, onView };
