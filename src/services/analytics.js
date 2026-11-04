const { query } = require("../db");

/** days = null for all time. */
async function overview(days = null) {
    const since = days ? `AND completed_at >= now() - interval '${Number(days)} days'` : "";
    const j = (await query(`
        SELECT count(*)::int AS jobs,
               COALESCE(sum(price_cents),0) AS revenue, COALESCE(sum(worker_cents),0) AS workers,
               COALESCE(sum(support_cents),0) AS support, COALESCE(sum(house_cents),0) AS house
        FROM jobs WHERE status='completed' ${since}`)).rows[0];
    const sinceLedger = days ? `AND created_at >= now() - interval '${Number(days)} days'` : "";
    const deposits = (await query(`
        SELECT COALESCE(source,'untagged') AS source, sum(delta_cents) AS total, count(*)::int AS n
        FROM ledger WHERE kind='deposit' ${sinceLedger} GROUP BY 1 ORDER BY total DESC`)).rows;
    const newCustomers = (await query(`
        SELECT count(*)::int AS n FROM (SELECT customer_id, min(completed_at) f FROM jobs WHERE status='completed' GROUP BY 1) t
        ${days ? `WHERE f >= now() - interval '${Number(days)} days'` : ""}`)).rows[0].n;
    const topWorkers = (await query(`
        SELECT worker_id AS id, sum(worker_cents) AS total, count(*)::int AS jobs FROM jobs
        WHERE status='completed' ${since} GROUP BY 1 ORDER BY total DESC LIMIT 5`)).rows;
    const cancelled = (await query(`SELECT count(*)::int AS n FROM jobs WHERE status='cancelled' ${days ? `AND cancelled_at >= now() - interval '${Number(days)} days'` : ""}`)).rows[0].n;
    const accountSales = await require("./accountsales").totals(days);
    const revenue = Number(j.revenue);
    return {
        jobs: j.jobs, revenue, workers: Number(j.workers), support: Number(j.support), house: Number(j.house),
        avgOrder: j.jobs ? Math.round(revenue / j.jobs) : 0,
        margin: revenue ? Number(j.house) / revenue * 100 : 0,
        deposits, newCustomers, topWorkers, cancelled, accountSales
    };
}

module.exports = { overview };
