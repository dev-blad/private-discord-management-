const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { fmt } = require("./money");

const COLORS = { open: 0x3498db, claimed: 0xf1c40f, completed: 0x2ecc71, cancelled: 0x95a5a6 };

const STAGE = {
    open:      { title: "🔔 New Job Available!", color: 0x5865f2 },
    claimed:   { title: "⏳ Job Claimed",        color: 0xf1c40f },
    completed: { title: "✅ Job Completed",      color: 0x2ecc71 },
    cancelled: { title: "❌ Job Cancelled",      color: 0x95a5a6 }
};

const label = (name, width = 11) => `\`${name.padEnd(width)}:\``;
const stamp = d => new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

/**
 * The boxed job card. ctx: { customerName, workerName, guild } (names are looked up by the caller).
 *   `Order ID  :` #6
 *   `Customer  :` @name
 */
function jobEmbed(job, ctx = {}) {
    const st = STAGE[job.status] || STAGE.open;
    let d = `${label("Order ID")} #${job.id}\n`;
    d += `${label("Customer")} @${ctx.customerName || job.customer_id}\n`;
    if (job.worker_id) d += `${label("Worker")} @${ctx.workerName || job.worker_id}\n`;
    d += `${label("Price")} ${fmt(job.price_cents)}\n`;
    d += `${label("Deposit")} ${job.deposit_cents > 0 ? fmt(job.deposit_cents) : "None"}\n`;
    if (job.status === "completed" || job.status === "claimed") {
        d += `${label("Worker cut")} ${job.worker_pct}% (${fmt(Math.floor(job.price_cents * job.worker_pct / 100))})\n`;
    }
    if (job.channel_id) d += `${label("Ticket")} <#${job.channel_id}>\n`;
    d += `\n**Job Details**\n${job.description}`;

    const e = new EmbedBuilder().setColor(st.color).setTitle(st.title).setDescription(d.slice(0, 4096));
    const g = ctx.guild;
    e.setFooter({ text: `${g?.name || "Jobs"} | ${stamp(job.created_at)}`, iconURL: g?.iconURL?.() || undefined });
    if (job.image_url) e.setImage(job.image_url);
    return e;
}

const jobClaimRow = jobId => new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`job_claim:${jobId}`).setLabel("Claim Job").setEmoji("✅").setStyle(ButtonStyle.Success)
);

const claimedRow = (jobId, workerName) => new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`job_claimed:${jobId}`).setLabel(`Claimed by ${workerName}`.slice(0, 80))
        .setStyle(ButtonStyle.Secondary).setDisabled(true)
);

/** Full message (content + embed + buttons) for a job in its current stage. */
async function jobMessage(client, job, guild) {
    const name = async id => {
        if (!id) return null;
        try { return (await client.users.fetch(id)).username; } catch (e) { return null; }
    };
    const customerName = await name(job.customer_id);
    const workerName = await name(job.worker_id);
    const msg = { embeds: [jobEmbed(job, { customerName, workerName, guild })], components: [] };
    if (job.status === "open") {
        msg.components = [jobClaimRow(job.id)];
        if (process.env.BOOSTER_ROLE_ID) msg.content = `<@&${process.env.BOOSTER_ROLE_ID}>`;
    } else if (job.status === "claimed") {
        msg.components = [claimedRow(job.id, workerName || "worker")];
    }
    if (!msg.content) msg.content = "";
    return msg;
}

function payoutEmbed(p) {
    const colors = { requested: 0xf1c40f, approved: 0x3498db, sending: 0x9b59b6, paid: 0x2ecc71, rejected: 0xe74c3c };
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
    if (p.paid_ref) e.addFields({ name: "Reference", value: /^0x[0-9a-fA-F]{64}$/.test(p.paid_ref) ? `[${p.paid_ref}](${require("../services/chain").explorer(p.method, p.paid_ref)})` : "```" + p.paid_ref + "```" });
    if (p.note) e.addFields({ name: "Note", value: p.note });
    return e;
}

function payoutRow(p) {
    const row = new ActionRowBuilder();
    const chain = require("../services/chain");
    const canSend = chain.configured() && chain.supports(p.method);
    if (p.status === "requested") {
        row.addComponents(
            new ButtonBuilder().setCustomId(`payout_approve:${p.id}`).setLabel(canSend ? "Approve & send" : "Approve").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`payout_reject:${p.id}`).setLabel("Reject").setStyle(ButtonStyle.Danger)
        );
    } else if (p.status === "approved") {
        if (canSend) row.addComponents(new ButtonBuilder().setCustomId(`payout_send:${p.id}`).setLabel("Send").setStyle(ButtonStyle.Success));
        row.addComponents(
            new ButtonBuilder().setCustomId(`payout_paid:${p.id}`).setLabel("Mark as paid").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`payout_reject:${p.id}`).setLabel("Reject").setStyle(ButtonStyle.Danger)
        );
    } else if (p.status === "sending") {
        row.addComponents(new ButtonBuilder().setCustomId(`payout_paid:${p.id}`).setLabel("Mark as paid").setStyle(ButtonStyle.Primary));
    } else return [];
    return [row];
}

module.exports = { jobEmbed, jobClaimRow, jobMessage, payoutEmbed, payoutRow };
