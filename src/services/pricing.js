const { query } = require("../db");
const config = require("./config");

const list = async () => (await query("SELECT * FROM pricing ORDER BY name")).rows;

const set = (name, cents) => query(
    `INSERT INTO pricing (name, price_cents) VALUES ($1,$2)
     ON CONFLICT (name) DO UPDATE SET price_cents = EXCLUDED.price_cents`, [name, cents]);

const remove = async name => (await query("DELETE FROM pricing WHERE name=$1", [name])).rowCount > 0;

/**
 * Discount tiers live in config as USD thresholds:
 *   discount_threshold_1 = 500   discount_percent_1 = 5   discount_role_1 = <role id>
 */
async function tiers() {
    const cfg = await config.getAll();
    return Object.keys(cfg)
        .filter(k => k.startsWith("discount_threshold_"))
        .map(k => {
            const n = k.split("_").pop();
            return {
                thresholdCents: Math.round(Number(cfg[k]) * 100),
                percent: Number(cfg[`discount_percent_${n}`] || 0),
                role: cfg[`discount_role_${n}`] || null
            };
        })
        .filter(t => Number.isFinite(t.thresholdCents))
        .sort((a, b) => b.thresholdCents - a.thresholdCents);
}

async function discountFor(spentCents) {
    return (await tiers()).find(t => spentCents >= t.thresholdCents) || null;
}

module.exports = { list, set, remove, tiers, discountFor };
