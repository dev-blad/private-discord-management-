const {
    ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder
} = require("discord.js");
const jobs = require("../services/jobs");
const payouts = require("../services/payouts");
const { UserError, fmt } = require("../utils/money");
const { isBooster, requireSupport } = require("../utils/perms");
const { payoutEmbed, payoutRow } = require("../utils/embeds");

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

    await interaction.deferUpdate();
    await require("../utils/board").moveBoard(interaction.client, job);
    await interaction.followUp({ content: `✅ You claimed job #${job.id}.`, ephemeral: true });

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
    const autopay = require("../services/autopay");
    const chain = require("../services/chain");

    if (action === "payout_paid") {
        const modal = new ModalBuilder().setCustomId(`payout_paidmodal:${id}`).setTitle(`Payout #${id} sent`)
            .addComponents(new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId("ref").setLabel("Transaction hash / reference")
                    .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(200)));
        return interaction.showModal(modal);
    }

    const actor = interaction.user.id;

    if (action === "payout_approve" || action === "payout_send") {
        await interaction.deferUpdate();
        let p = action === "payout_approve" ? await payouts.approve({ payoutId: id, actorId: actor }) : await payouts.getPayout(id);
        if (chain.configured() && chain.supports(p.method)) {
            // one tap: approve and send. The result refreshes the card and alerts staff if it needs attention.
            const res = await autopay.sendPayout({ payoutId: id, actorId: actor });
            await autopay.announce(interaction.client, res);
            return;
        }
        await interaction.editReply({ embeds: [payoutEmbed(p)], components: payoutRow(p) });
        await dm(interaction.client, p.discord_id, `✅ Your payout #${p.id} of ${fmt(p.amount_cents)} was approved and will be sent shortly.`);
        return;
    }

    const p = await payouts.reject({ payoutId: id, actorId: actor });
    await interaction.update({ embeds: [payoutEmbed(p)], components: payoutRow(p) });
    await dm(interaction.client, p.discord_id, `❌ Your payout #${p.id} of ${fmt(p.amount_cents)} was rejected. The funds are back in your earnings.`);
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
            if (interaction.isAutocomplete()) {
                const command = client.commands.get(interaction.commandName);
                if (command?.autocomplete) await command.autocomplete(interaction);
                return;
            }
            if (interaction.isChatInputCommand()) {
                const command = client.commands.get(interaction.commandName);
                if (command) await command.execute(interaction, client);
                return;
            }
            if (interaction.isStringSelectMenu()) {
                if (interaction.customId.startsWith("pm:")) return await require("../utils/pricingMenu").handleSelect(interaction);
                if (interaction.customId.startsWith("fb:")) return await require("../utils/feedback").onSelect(interaction, Number(interaction.customId.split(":")[1]));
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
                if (action === "acct_details") {
                    requireSupport(interaction.member);
                    const f = id => interaction.fields.getTextInputValue(id).trim();
                    const a = await require("../services/accountsales").setDetails(rawId,
                        JSON.stringify({ login: f("login"), password: f("password"), recovery: f("recovery"), pin: f("pin"), notes: f("notes") }));
                    return interaction.reply({ content: `🔐 Saved the delivery details for **${a.id}**. They're stored encrypted and only sent with \`/send_account\`.`, ephemeral: true });
                }
                if (action === "payout_paidmodal") return await onPayoutPaidModal(interaction, Number(rawId));
                if (action === "fbmodal") return await require("../utils/feedback").onModal(interaction, Number(rawId), interaction.customId.split(":")[2]);
                if (action === "order_modal") {
                    requireSupport(interaction.member);
                    const [, customerId, price, deposit] = interaction.customId.split(":");
                    await interaction.deferReply({ ephemeral: true });
                    const customer = await interaction.client.users.fetch(customerId).catch(() => null);
                    const text = await require("../utils/orders").openOrder(interaction, {
                        customerId, customerName: customer?.username || customerId,
                        priceCents: Number(price), depositCents: Number(deposit),
                        description: interaction.fields.getTextInputValue("job_details").trim()
                    });
                    return interaction.editReply(text);
                }
            }
        } catch (err) {
            await fail(interaction, err);
        }
    }
};
