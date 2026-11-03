async function audit(client, actorId, action, entity, entityId, data = null) {
    await client.query(
        "INSERT INTO audit_log (actor_id, action, entity, entity_id, data) VALUES ($1,$2,$3,$4,$5)",
        [actorId, action, entity, entityId == null ? null : String(entityId), data]
    );
}
module.exports = { audit };
