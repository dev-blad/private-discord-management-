const { query, withTx } = require("../db");
const { UserError } = require("../utils/money");
const secret = require("../utils/secret");

const clean = name => String(name || "").replace(/[^A-Za-z0-9]/g, "");
const cap = s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

/** Same creator always gets the same prefix: "Tony" -> T, "Trevor" -> Tr (first free one). */
async function prefixFor(c, creatorId, creatorName) {
    const mine = await c.query("SELECT prefix FROM account_prefixes WHERE creator_id=$1", [creatorId]);
    if (mine.rows[0]) return mine.rows[0].prefix;
    const name = clean(creatorName) || "X";
    for (let n = 1; n <= name.length; n++) {
        const p = cap(name.slice(0, n));
        const r = await c.query("INSERT INTO account_prefixes (prefix, creator_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING prefix", [p, creatorId]);
        if (r.rows[0]) return p;
    }
    // every prefix of the name is taken: add a number
    for (let i = 2; ; i++) {
        const p = cap(name) + i;
        const r = await c.query("INSERT INTO account_prefixes (prefix, creator_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING prefix", [p, creatorId]);
        if (r.rows[0]) return p;
    }
}

async function create({ creatorId, creatorName, type, title, description, priceCents, stock = 1, imageUrl = null }) {
    return withTx(async c => {
        await c.query("SELECT pg_advisory_xact_lock(8008)");
        const prefix = await prefixFor(c, creatorId, creatorName);
        const { rows } = await c.query("SELECT COALESCE(max(seq),0)+1 AS n FROM accounts WHERE prefix=$1", [prefix]);
        const seq = rows[0].n;
        const id = `${prefix}${String(seq).padStart(3, "0")}`;
        const ins = await c.query(
            `INSERT INTO accounts (id,prefix,seq,creator_id,account_type,title,description,price_cents,stock,image_url)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
            [id, prefix, seq, creatorId, type, title, description, priceCents, stock, imageUrl]);
        return ins.rows[0];
    });
}

async function get(id, { includeDeleted = false } = {}) {
    const { rows } = await query("SELECT * FROM accounts WHERE lower(id)=lower($1)", [String(id).trim()]);
    const a = rows[0];
    if (!a || (!includeDeleted && a.status === "deleted")) throw new UserError(`No account with ID **${String(id).trim()}**.`);
    return a;
}

const setMessage = (id, channelId, messageId) =>
    query("UPDATE accounts SET channel_id=$2, message_id=$3 WHERE id=$1", [id, channelId, messageId]);

async function setDetails(id, text) {
    const a = await get(id);
    await query("UPDATE accounts SET details_enc=$2 WHERE id=$1", [a.id, secret.encrypt(text)]);
    return a;
}

const readDetails = a => (a.details_enc ? secret.decrypt(a.details_enc) : null);

async function addStock(id, amount) {
    const a = await get(id);
    const { rows } = await query(
        "UPDATE accounts SET stock = stock + $2, status='available' WHERE id=$1 RETURNING *", [a.id, amount]);
    return rows[0];
}

async function remove(id) {
    const a = await get(id);
    const { rows } = await query("UPDATE accounts SET status='deleted' WHERE id=$1 RETURNING *", [a.id]);
    return rows[0];
}

/** Take one from stock and record the sale. Returns { account, sale }. */
async function recordSale({ id, buyerId, soldCents, soldBy }) {
    return withTx(async c => {
        const { rows } = await c.query("SELECT * FROM accounts WHERE lower(id)=lower($1) FOR UPDATE", [String(id).trim()]);
        const a = rows[0];
        if (!a || a.status === "deleted") throw new UserError(`No account with ID **${id}**.`);
        if (a.status !== "available" || a.stock < 1) throw new UserError(`**${a.id}** is sold out.`);
        const upd = await c.query(
            "UPDATE accounts SET stock=stock-1, status=CASE WHEN stock-1=0 THEN 'sold' ELSE 'available' END WHERE id=$1 RETURNING *", [a.id]);
        const sale = await c.query(
            "INSERT INTO account_sales (account_id,buyer_id,sold_cents,listed_cents,sold_by) VALUES ($1,$2,$3,$4,$5) RETURNING *",
            [a.id, buyerId, soldCents, a.price_cents, soldBy]);
        return { account: upd.rows[0], sale: sale.rows[0] };
    });
}

/** Reverse a sale (used when the DM couldn't be delivered). */
async function undoSale(saleId) {
    return withTx(async c => {
        const s = (await c.query("UPDATE account_sales SET undone=true WHERE id=$1 AND NOT undone RETURNING *", [saleId])).rows[0];
        if (!s) return null;
        return (await c.query("UPDATE accounts SET stock=stock+1, status='available' WHERE id=$1 RETURNING *", [s.account_id])).rows[0];
    });
}

async function list({ includeSold = false } = {}) {
    const { rows } = await query(
        `SELECT * FROM accounts WHERE status = 'available' ${includeSold ? "OR status = 'sold'" : ""} ORDER BY created_at DESC LIMIT 25`);
    return rows;
}

/** Account sales totals for /analytics. days = null for all time. */
async function totals(days = null) {
    const since = days ? `AND sold_at >= now() - interval '${Number(days)} days'` : "";
    const r = (await query(
        `SELECT count(*)::int AS n, COALESCE(sum(sold_cents),0) AS revenue FROM account_sales WHERE NOT undone ${since}`)).rows[0];
    const byCreator = (await query(
        `SELECT a.creator_id AS id, count(*)::int AS n, sum(s.sold_cents) AS total FROM account_sales s
         JOIN accounts a ON a.id = s.account_id WHERE NOT s.undone ${since.replace("sold_at", "s.sold_at")} GROUP BY 1 ORDER BY total DESC`)).rows;
    return { count: r.n, revenue: Number(r.revenue), byCreator };
}

module.exports = { create, get, setMessage, setDetails, readDetails, addStock, remove, recordSale, undoSale, list, totals };
