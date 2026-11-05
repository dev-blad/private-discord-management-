const { query, withTx } = require("../db");
const { UserError, fmt } = require("../utils/money");
const { applyLedger } = require("./wallets");
const { audit } = require("./audit");
const config = require("./config");

/** Create a job and escrow the customer's funds in one transaction. */
async function createJob({ customerId, priceCents, depositCents, description, imageUrl, channelId, createdBy, supportPct = 0 }) {
    const pct = Number(await config.get("worker_pct", "80"));
    if (pct + supportPct > 100) throw new UserError(`Worker ${pct}% + support ${supportPct}% is over 100%. Ask an admin to fix the cuts.`);
    return withTx(async c => {
        const { rows } = await c.query(
            `INSERT INTO jobs (customer_id, price_cents, deposit_cents, worker_pct, description, image_url, channel_id, created_by, support_pct)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
            [customerId, priceCents, depositCents, pct, description, imageUrl, channelId, createdBy, supportPct]
        );
        const job = rows[0];
        const w = await applyLedger(c, {
            discordId: customerId, bucket: "balance", delta: -priceCents,
            kind: "job_charge", jobId: job.id, actorId: createdBy, note: `Job #${job.id}`
        });
        await audit(c, createdBy, "job.create", "job", job.id, { priceCents, customerId });
        return { job, spent: w.spent };
    });
}

async function setBoardMessage(jobId, channelId, messageId) {
    await query("UPDATE jobs SET board_channel_id=$2, board_message_id=$3 WHERE id=$1", [jobId, channelId, messageId]);
}

async function setTicketMessage(jobId, messageId) {
    await query("UPDATE jobs SET ticket_message_id=$2 WHERE id=$1", [jobId, messageId]);
}

/** Atomic claim: only succeeds if the job is still open. */
async function claimJob({ jobId, workerId }) {
    return withTx(async c => {
        const pre = (await c.query("SELECT deposit_cents, status FROM jobs WHERE id=$1", [jobId])).rows[0];
        if (pre && pre.status === "open" && Number(pre.deposit_cents) > 0) {
            const held = await require("./deposits").get(workerId, c);
            if (held < Number(pre.deposit_cents)) {
                throw new UserError(`This job needs a ${fmt(Number(pre.deposit_cents))} deposit and you have ${fmt(held)} on record. Ask staff to log your deposit.`);
            }
        }
        const { rows } = await c.query(
            `UPDATE jobs SET status='claimed', worker_id=$2, claimed_at=now()
             WHERE id=$1 AND status='open' RETURNING *`, [jobId, workerId]);
        if (!rows.length) {
            const cur = await c.query("SELECT status, worker_id FROM jobs WHERE id=$1", [jobId]);
            if (!cur.rows.length) throw new UserError(`Job #${jobId} doesn't exist.`);
            throw new UserError(`Job #${jobId} is already ${cur.rows[0].status}.`);
        }
        await audit(c, workerId, "job.claim", "job", jobId);
        return rows[0];
    });
}

/** Complete a claimed job and credit the worker's share. */
async function completeJob({ jobId, actorId }) {
    return withTx(async c => {
        const { rows } = await c.query("SELECT * FROM jobs WHERE id=$1 FOR UPDATE", [jobId]);
        const job = rows[0];
        if (!job) throw new UserError(`Job #${jobId} doesn't exist.`);
        if (job.status !== "claimed") throw new UserError(`Job #${jobId} is ${job.status}; only claimed jobs can be completed.`);

        const workerCents = Math.floor(job.price_cents * job.worker_pct / 100);
        const supportCents = Math.floor(job.price_cents * Number(job.support_pct) / 100);
        const houseCents = job.price_cents - workerCents - supportCents;
        if (workerCents > 0) {
            await applyLedger(c, {
                discordId: job.worker_id, bucket: "earnings", delta: workerCents,
                kind: "job_earning", jobId, actorId, note: `Job #${jobId} (${job.worker_pct}%)`
            });
        }
        if (supportCents > 0) {
            await applyLedger(c, {
                discordId: job.created_by, bucket: "earnings", delta: supportCents,
                kind: "support_cut", jobId, actorId, note: `Job #${jobId} support cut (${job.support_pct}%)`
            });
        }
        const upd = await c.query(
            `UPDATE jobs SET status='completed', completed_at=now(), worker_cents=$2, house_cents=$3, support_cents=$4
             WHERE id=$1 RETURNING *`, [jobId, workerCents, houseCents, supportCents]);
        await audit(c, actorId, "job.complete", "job", jobId, { workerCents, supportCents, houseCents });
        return upd.rows[0];
    });
}

/** Cancel an open or claimed job and refund the customer. */
async function cancelJob({ jobId, actorId }) {
    return withTx(async c => {
        const { rows } = await c.query("SELECT * FROM jobs WHERE id=$1 FOR UPDATE", [jobId]);
        const job = rows[0];
        if (!job) throw new UserError(`Job #${jobId} doesn't exist.`);
        if (!["open", "claimed"].includes(job.status)) throw new UserError(`Job #${jobId} is already ${job.status}.`);

        await applyLedger(c, {
            discordId: job.customer_id, bucket: "balance", delta: job.price_cents,
            kind: "job_refund", jobId, actorId, note: `Job #${jobId} cancelled`
        });
        const upd = await c.query(
            "UPDATE jobs SET status='cancelled', cancelled_at=now() WHERE id=$1 RETURNING *", [jobId]);
        await audit(c, actorId, "job.cancel", "job", jobId);
        return upd.rows[0];
    });
}

async function getJob(jobId) {
    const { rows } = await query("SELECT * FROM jobs WHERE id=$1", [jobId]);
    return rows[0] || null;
}

async function listJobs({ status = null, workerId = null, limit = 15 } = {}) {
    const { rows } = await query(
        `SELECT * FROM jobs WHERE ($1::text IS NULL OR status=$1) AND ($2::text IS NULL OR worker_id=$2)
         ORDER BY id DESC LIMIT $3`, [status, workerId, limit]);
    return rows;
}

module.exports = { createJob, setBoardMessage, setTicketMessage, claimJob, completeJob, cancelJob, getJob, listJobs };
