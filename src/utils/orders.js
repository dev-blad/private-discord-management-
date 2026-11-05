const jobs = require("../services/jobs");
const board = require("./board");
const { fmt } = require("./money");
const { applySpendRole } = require("./roles");

/**
 * Create a job from a staff command or the order popup: escrow the customer's money,
 * post the claim card, post the customer's copy in the ticket. Returns the reply text.
 */
async function openOrder(interaction, { customerId, customerName, priceCents, depositCents = 0, description, imageUrl = null }) {
    const { job, spent } = await jobs.createJob({
        customerId, priceCents, depositCents, description, imageUrl,
        channelId: interaction.channelId,
        createdBy: interaction.user.id,
        supportPct: await require("../services/supportroles").cutFor(interaction.member)
    });

    let note = "";
    try {
        const r = await board.postNewJob(interaction.client, job, interaction.channel);
        if (r.ticket?.error) note = `\n⚠️ Couldn't post the customer's copy in this ticket: ${r.ticket.error}`;
        else if (r.ticket?.ok) note = "\n📨 Posted in the claim channel and in this ticket.";
    } catch (e) {
        console.error("[orders] failed to post the claim card:", e.message);
        note = "\n⚠️ Couldn't post it to the claim channel. Check the bot's permissions there (and /setchannels).";
    }
    await applySpendRole(interaction.guild, customerId, spent);
    const disc = job.discount_pct > 0 ? ` 🏷️ ${job.discount_pct}% boss discount applied (${fmt(Number(job.list_price_cents))} → ${fmt(job.price_cents)})${job.discountsLeft > 0 ? `, ${job.discountsLeft} more saved` : ""}.` : "";
    return `✅ Created order **#${job.id}** (${fmt(job.price_cents)} escrowed from ${customerName}).${disc}${note}`;
}

module.exports = { openOrder };
