const { query } = require("../db");

const list = async () => (await query("SELECT role_id, name, cut_pct::float AS cut_pct FROM support_roles ORDER BY cut_pct DESC, name")).rows;

const set = (roleId, name, pct) => query(
    `INSERT INTO support_roles (role_id, name, cut_pct) VALUES ($1,$2,$3)
     ON CONFLICT (role_id) DO UPDATE SET name = EXCLUDED.name, cut_pct = EXCLUDED.cut_pct`, [roleId, name, pct]);

const remove = async roleId => (await query("DELETE FROM support_roles WHERE role_id=$1", [roleId])).rowCount > 0;

/** A member's cut is the highest percentage among their support roles (0 if none). */
async function cutFor(member) {
    const have = member?.roles?.cache;
    if (!have) return 0;
    return (await list()).filter(r => have.has(r.role_id)).reduce((m, r) => Math.max(m, r.cut_pct), 0);
}

module.exports = { list, set, remove, cutFor };
