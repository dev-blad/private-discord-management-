const { query } = require("../db");
const { UserError } = require("../utils/money");

async function save({ discordId, rsn, world, location, image, imageType }) {
    return (await query(
        `INSERT INTO worker_locations (discord_id, rsn, world, location, image, image_type)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (discord_id, lower(rsn)) DO UPDATE
           SET world=EXCLUDED.world, location=EXCLUDED.location, image=EXCLUDED.image, image_type=EXCLUDED.image_type, updated_at=now()
         RETURNING id, discord_id, rsn, world, location`,
        [discordId, rsn, world, location, image, imageType])).rows[0];
}

const list = async discordId => (await query(
    "SELECT id, rsn, world, location FROM worker_locations WHERE discord_id=$1 ORDER BY updated_at DESC LIMIT 25", [discordId])).rows;

async function get(discordId, id) {
    const r = (await query("SELECT * FROM worker_locations WHERE id=$1 AND discord_id=$2", [id, discordId])).rows[0];
    if (!r) throw new UserError("That saved location doesn't exist any more.");
    return r;
}

async function remove(discordId, rsn) {
    const r = await query("DELETE FROM worker_locations WHERE discord_id=$1 AND lower(rsn)=lower($2)", [discordId, rsn]);
    if (!r.rowCount) throw new UserError(`You have no saved location for **${rsn}**.`);
}

module.exports = { save, list, get, remove };
