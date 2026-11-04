const { query, withTx } = require("../db");
const { UserError } = require("../utils/money");
const secret = require("../utils/secret");
const { audit } = require("./audit");

async function create({ channelId, requestedBy, customerId }) {
    return (await query(
        "INSERT INTO account_requests (channel_id, requested_by, customer_id) VALUES ($1,$2,$3) RETURNING *",
        [channelId, requestedBy, customerId])).rows[0];
}

const setMessage = (id, messageId) => query("UPDATE account_requests SET message_id=$2 WHERE id=$1", [id, messageId]);

async function get(id) {
    const r = (await query("SELECT * FROM account_requests WHERE id=$1", [id])).rows[0];
    if (!r) throw new UserError("That request no longer exists.");
    return r;
}

async function submit({ id, userId, details }) {
    const enc = secret.encrypt(JSON.stringify(details));
    return withTx(async c => {
        const r = (await c.query("SELECT * FROM account_requests WHERE id=$1 FOR UPDATE", [id])).rows[0];
        if (!r) throw new UserError("That request no longer exists.");
        if (r.customer_id !== userId) throw new UserError("This request isn't for you.");
        if (r.status === "submitted") throw new UserError("Details were already submitted for this request.");
        const upd = await c.query(
            "UPDATE account_requests SET status='submitted', details_enc=$2, submitted_by=$3, submitted_at=now() WHERE id=$1 RETURNING *",
            [id, enc, userId]);
        await audit(c, userId, "details.submit", "account_request", id);
        return upd.rows[0];
    });
}

/** Who may open the details: staff who asked, the person who sent them, the worker claimed on a job in this ticket, admins. */
async function canView(r, member, isAdmin) {
    const uid = member.id;
    if (isAdmin || uid === r.requested_by || uid === r.submitted_by) return true;
    const { rows } = await query("SELECT 1 FROM jobs WHERE channel_id=$1 AND status='claimed' AND worker_id=$2 LIMIT 1", [r.channel_id, uid]);
    return rows.length > 0;
}

async function view(id, member, isAdmin) {
    const r = await get(id);
    if (r.status !== "submitted") throw new UserError("No details have been submitted yet.");
    if (!(await canView(r, member, isAdmin))) throw new UserError("Only the worker on this order and the staff who asked for the details can view them.");
    await audit({ query }, member.id, "details.view", "account_request", id);
    return { request: r, details: JSON.parse(secret.decrypt(r.details_enc)) };
}

module.exports = { create, setMessage, get, submit, view };
