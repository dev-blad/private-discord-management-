const { query } = require("../db");

// Roles that count as "job roles" (e.g. @Caper, @Zerker) and show on a worker's !w.
const list = async () => (await query("SELECT role_id, name FROM job_roles ORDER BY name")).rows;

const add = (roleId, name) => query(
    `INSERT INTO job_roles (role_id, name) VALUES ($1,$2)
     ON CONFLICT (role_id) DO UPDATE SET name = EXCLUDED.name`, [roleId, name]);

const remove = async roleId => (await query("DELETE FROM job_roles WHERE role_id = $1", [roleId])).rowCount > 0;

module.exports = { list, add, remove };
