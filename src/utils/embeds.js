const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { fmt } = require("./money");

const COLORS = { open: 0x3498db, claimed: 0xf1c40f, completed: 0x2ecc71, cancelled: 0x95a5a6 };

function jobEmbed(job) {
    const e = new EmbedBuilder()
        .setTitle(`Job #${job.id} — ${job.status.toUpperCase()}`)
        .setColor(COLORS[job.status] || 0x3498db)
        .setDescription(job.description)
        .addFields(
            { name: "Customer", value: `<@${job.customer_id}>`, inline: true },
            { name: "Worker", value: job.worker_id ? `<@${job.worker_id}>` : "Unclaimed", inline: true },
            { name: "Price", value: fmt(job.price_cents), inline: true },
            { name: "Worker share", value: `${job.worker_pct}% (${fmt(Math.floor(job.price_cents * job.worker_pct / 100))})`, inline: true }
        )
        .setTimestamp(new Date(job.created_at));
    if (job.deposit_cents > 0) e.addFields({ name: "Deposit required", value: fmt(job.deposit_cents), inline: true });
    if (job.image_url) e.setImage(job.image_url);
    return e;
}

const jobClaimRow = jobId => new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`job_claim:${jobId}`).setLabel("Claim job").setStyle(ButtonStyle.Success)
);

function payoutEmbed(p) {
    const colors = { requested: 0xf1c40f, approved: 0x3498db, paid: 0x2ecc71, rejected: 0xe74c3c };
    const e = new EmbedBuilder()
        .setTitle(`Payout #${p.id} — ${p.status.toUpperCase()}`)
        .setColor(colors[p.status])
        .addFields(
            { name: "Worker", value: `<@${p.discord_id}>`, inline: true },
            { name: "Amount", value: fmt(p.amount_cents), inline: true },
            { name: "Method", value: p.method, inline: true },
            { name: "Address", value: "```" + p.address + "```" }
        )
        .setTimestamp(new Date(p.requested_at));
    if (p.decided_by) e.addFields({ name: "Decided by", value: `<@${p.decided_by}>`, inline: true });
    if (p.paid_ref) e.addFields({ name: "Reference", value: "```" + p.paid_ref + "```" });
    if (p.note) e.addFields({ name: "Note", value: p.note });
    return e;
}

function payoutRow(p) {
    const row = new ActionRowBuilder();
    if (p.status === "requested") {
        row.addComponents(
            new ButtonBuilder().setCustomId(`payout_approve:${p.id}`).setLabel("Approve").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`payout_reject:${p.id}`).setLabel("Reject").setStyle(ButtonStyle.Danger)
        );
    } else if (p.status === "approved") {
        row.addComponents(
            new ButtonBuilder().setCustomId(`payout_paid:${p.id}`).setLabel("Mark as paid").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`payout_reject:${p.id}`).setLabel("Reject").setStyle(ButtonStyle.Danger)
        );
    } else return [];
    return [row];
}

module.exports = { jobEmbed, jobClaimRow, payoutEmbed, payoutRow };
