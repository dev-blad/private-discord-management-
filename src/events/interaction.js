const {
    ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder
} = require("discord.js");
const jobs = require("../services/jobs");
const payouts = require("../services/payouts");
const { UserError, fmt } = require("../utils/money");
const { isBooster, requireSupport } = require("../utils/perms");
const { jobEmbed, payoutEmbed, payoutRow } = require("../utils/embeds");

async function fail(interaction, err) {
    const msg = err instanceof UserError ? `❌ ${err.message}` : "❌ Something went wrong. It has been logged.";
    if (!(err instanceof UserError)) console.error("[interaction] error:", err);
    try {
        if (interaction.deferred || interaction.replied) await interaction.followUp({ content: msg, ephemeral: true });
        else await interaction.reply({ content: msg, ephemeral: true });
    } catch (e) { /* interaction expired */ }
}

async function dm(client, userId, content) {
    try { await (await client.users.fetch(userId)).send(content); } catch (e) { /* DMs closed */ }
}

async function onJobClaim(interaction, jobId) {
    if (!isBooster(interaction.member)) throw new UserError("Only Boosters can claim jobs.");
    const job = await jobs.claimJob({ jobId, workerId: interaction.user.id });

    await interaction.update({ embeds: [jobEmbed(job)], components: [] });

    // Give the worker access to the customer's ticket channel. Best effort.
    try {
        const ch = job.channel_id && await interaction.guild.channels.fetch(job.channel_id);
        if (ch && ch.id !== interaction.channelId) {
            await ch.permissionOverwrites.edit(interaction.user.id, { ViewChannel: true, SendMessages: true });
            await ch.send(`${interaction.user} has been added as the worker for job #${job.id}.`);
        }
    } catch (e) {
        console.error("[jobs] couldn't add worker to ticket channel:", e.message);
    }
}

async function onPayoutButton(interaction, action, id) {
    requireSupport(interaction.member);

    if (action === "payout_paid") {
        const modal = new ModalBuilder().setCustomId(`payout_paidmodal:${id}`).setTitle(`Payout #${id} sent`)
            .addComponents(new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId("ref").setLabel("Transaction hash / reference")
                    .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(200)));
        return interaction.showModal(modal);
    }

    const actor = interaction.user.id;
    const p = action === "payout_approve"
        ? await payouts.approve({ payoutId: id, actorId: actor })
        : await payouts.reject({ payoutId: id, actorId: actor });
    await interaction.update({ embeds: [payoutEmbed(p)], components: payoutRow(p) });

    if (p.status === "approved") {
        await dm(interaction.client, p.discord_id, `✅ Your payout #${p.id} of ${fmt(p.amount_cents)} was approved and will be sent shortly.`);
    } else {
        await dm(interaction.client, p.discord_id, `❌ Your payout #${p.id} of ${fmt(p.amount_cents)} was rejected. The funds are back in your earnings.`);
    }
}

async function onPayoutPaidModal(interaction, id) {
    requireSupport(interaction.member);
    const ref = interaction.fields.getTextInputValue("ref").trim();
    const p = await payouts.markPaid({ payoutId: id, actorId: interaction.user.id, ref });
    await interaction.update({ embeds: [payoutEmbed(p)], components: [] });
    await dm(interaction.client, p.discord_id, `💸 Payout #${p.id} of ${fmt(p.amount_cents)} has been sent.\nReference: \`${ref}\``);
}

module.exports = {
    name: "interactionCreate",
    async execute(interaction, client) {
        try {
            if (interaction.isChatInputCommand()) {
                const command = client.commands.get(interaction.commandName);
                if (command) await command.execute(interaction, client);
                return;
            }
            if (interaction.isButton()) {
                const [action, rawId] = interaction.customId.split(":");
                const id = Number(rawId);
                if (!Number.isInteger(id)) return;
                if (action === "job_claim") return await onJobClaim(interaction, id);
                if (action.startsWith("payout_")) return await onPayoutButton(interaction, action, id);
                return;
            }
            if (interaction.isModalSubmit()) {
                const [action, rawId] = interaction.customId.split(":");
                if (action === "payout_paidmodal") return await onPayoutPaidModal(interaction, Number(rawId));
            }
        } catch (err) {
            await fail(interaction, err);
        }
    }
};
