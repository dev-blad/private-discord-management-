const { query } = require("../db");
const { UserError } = require("../utils/money");

async function save({ discordId, rsn, world, location, image, imageType }) {
    return (await query(
        `INSERT INTO worker_locations (discord_id, rsn, world, location, image, image_type)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (lower(rsn)) DO UPDATE
           SET discord_id=EXCLUDED.discord_id, world=EXCLUDED.world, location=EXCLUDED.location, image=EXCLUDED.image, image_type=EXCLUDED.image_type, updated_at=now()
         RETURNING id, discord_id, rsn, world, location`,
        [discordId, rsn, world, location, image, imageType])).rows[0];
}

/** Shared pool of mule locations. */
const list = async () => (await query(
    "SELECT id, rsn, world, location FROM worker_locations ORDER BY lower(rsn) LIMIT 25")).rows;

async function get(id) {
    const r = (await query("SELECT * FROM worker_locations WHERE id=$1", [id])).rows[0];
    if (!r) throw new UserError("That saved location doesn't exist any more.");
    return r;
}

async function remove(rsn) {
    const r = await query("DELETE FROM worker_locations WHERE lower(rsn)=lower($1)", [rsn]);
    if (!r.rowCount) throw new UserError(`There's no saved location for **${rsn}**.`);
}

module.exports = { save, list, get, remove };
