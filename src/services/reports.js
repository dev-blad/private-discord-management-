const { query } = require("../db");

async function summary() {
    const jobs = (await query(`
        SELECT
          count(*) FILTER (WHERE status='open')::int      AS open_jobs,
          count(*) FILTER (WHERE status='claimed')::int   AS claimed_jobs,
          count(*) FILTER (WHERE status='completed')::int AS completed_jobs,
          COALESCE(sum(price_cents)  FILTER (WHERE status='completed'),0) AS revenue_cents,
          COALESCE(sum(house_cents)  FILTER (WHERE status='completed'),0) AS profit_cents,
          COALESCE(sum(worker_cents) FILTER (WHERE status='completed'),0) AS worker_cents,
          COALESCE(sum(price_cents)  FILTER (WHERE status IN ('open','claimed')),0) AS escrow_cents
        FROM jobs`)).rows[0];
    const wallets = (await query(`
        SELECT COALESCE(sum(balance_cents),0) AS customer_balances,
               COALESCE(sum(earnings_cents),0) AS owed_to_workers FROM wallets`)).rows[0];
    const payouts = (await query(`
        SELECT COALESCE(sum(amount_cents) FILTER (WHERE status IN ('requested','approved')),0) AS pending_cents,
               COALESCE(sum(amount_cents) FILTER (WHERE status='paid'),0) AS paid_cents,
               count(*) FILTER (WHERE status IN ('requested','approved'))::int AS pending_count
        FROM payouts`)).rows[0];
    return { ...jobs, ...wallets, ...payouts };
}

async function leaderboard(kind = "customers", limit = 10) {
    const sql = kind === "workers"
        ? `SELECT worker_id AS id, sum(worker_cents) AS total, count(*)::int AS jobs
           FROM jobs WHERE status='completed' GROUP BY worker_id ORDER BY total DESC LIMIT $1`
        : `SELECT customer_id AS id, sum(price_cents) AS total, count(*)::int AS jobs
           FROM jobs WHERE status='completed' GROUP BY customer_id ORDER BY total DESC LIMIT $1`;
    return (await query(sql, [limit])).rows;
}

const EXPORTS = {
    wallets: "SELECT * FROM wallets ORDER BY discord_id",
    ledger: "SELECT * FROM ledger ORDER BY id",
    jobs: "SELECT * FROM jobs ORDER BY id",
    payouts: "SELECT * FROM payouts ORDER BY id",
    monthly: `SELECT to_char(date_trunc('month', completed_at), 'YYYY-MM') AS month, count(*) AS jobs,
                     sum(price_cents) AS revenue_cents, sum(worker_cents) AS worker_cents,
                     sum(COALESCE(support_cents,0)) AS support_cents, sum(house_cents) AS house_cents
              FROM jobs WHERE status='completed' GROUP BY 1 ORDER BY 1`
};

function csvCell(v) {
    if (v === null || v === undefined) return "";
    const s = v instanceof Date ? v.toISOString() : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function exportCsv(name) {
    if (!EXPORTS[name]) throw new Error(`unknown export ${name}`);
    const { rows, fields } = await query(EXPORTS[name]);
    const head = fields.map(f => f.name).join(",");
    const body = rows.map(r => fields.map(f => csvCell(r[f.name])).join(","));
    return [head, ...body].join("\n") + "\n";
}

module.exports = { summary, leaderboard, exportCsv, EXPORT_NAMES: Object.keys(EXPORTS) };
