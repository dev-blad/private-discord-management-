const { query, withTx } = require("../db");
const { UserError } = require("../utils/money");
const { applyLedger } = require("./wallets");
const { audit } = require("./audit");
const config = require("./config");

/** Create a job and escrow the customer's funds in one transaction. */
async function createJob({ customerId, priceCents, depositCents, description, imageUrl, channelId, createdBy }) {
    const pct = Number(await config.get("worker_pct", "80"));
    return withTx(async c => {
        const { rows } = await c.query(
            `INSERT INTO jobs (customer_id, price_cents, deposit_cents, worker_pct, description, image_url, channel_id, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [customerId, priceCents, depositCents, pct, description, imageUrl, channelId, createdBy]
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

/** Atomic claim: only succeeds if the job is still open. */
async function claimJob({ jobId, workerId }) {
    return withTx(async c => {
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
        const houseCents = job.price_cents - workerCents;
        if (workerCents > 0) {
            await applyLedger(c, {
                discordId: job.worker_id, bucket: "earnings", delta: workerCents,
                kind: "job_earning", jobId, actorId, note: `Job #${jobId} (${job.worker_pct}%)`
            });
        }
        const upd = await c.query(
            `UPDATE jobs SET status='completed', completed_at=now(), worker_cents=$2, house_cents=$3
             WHERE id=$1 RETURNING *`, [jobId, workerCents, houseCents]);
        await audit(c, actorId, "job.complete", "job", jobId, { workerCents, houseCents });
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

module.exports = { createJob, setBoardMessage, claimJob, completeJob, cancelJob, getJob, listJobs };
