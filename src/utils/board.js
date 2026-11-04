const config = require("../services/config");
const jobs = require("../services/jobs");
const { jobMessage } = require("./embeds");

// Where each stage of a job lives. Set with /setchannels. Unset stages stay where they are.
const KEYS = {
    open: ["claim_channel_id", "job_board_channel_id"],
    claimed: ["claimed_channel_id"],
    completed: ["completed_channel_id"],
    cancelled: ["cancelled_channel_id"]
};
const ENV = { open: "CLAIM_CHANNEL_ID", claimed: "CLAIMED_CHANNEL_ID", completed: "COMPLETED_CHANNEL_ID", cancelled: "CANCELLED_CHANNEL_ID" };

async function channelIdFor(status) {
    for (const k of KEYS[status] || []) {
        const v = await config.get(k);
        if (v) return v;
    }
    return process.env[ENV[status]] || null;
}


/** Post a brand-new job to the claim channel (or fallbackChannel if none is set). */
async function postNewJob(client, job, fallbackChannel) {
    const id = await channelIdFor("open");
    const channel = id ? await client.channels.fetch(id) : fallbackChannel;
    const msg = await channel.send(await jobMessage(client, job, channel.guild));
    await jobs.setBoardMessage(job.id, channel.id, msg.id);
}

/**
 * After a status change, move the job's message to that stage's channel
 * (post there, delete the old one). If no channel is set for the stage, or it is
 * the same channel, edit it in place. Best effort: money is already settled.
 */
async function moveBoard(client, job) {
    try {
        const targetId = await channelIdFor(job.status);
        const sameSpot = !targetId || targetId === job.board_channel_id;

        if (sameSpot) {
            if (!job.board_channel_id || !job.board_message_id) return;
            const ch = await client.channels.fetch(job.board_channel_id);
            const msg = await ch.messages.fetch(job.board_message_id);
            return await msg.edit(await jobMessage(client, job, ch.guild));
        }

        const target = await client.channels.fetch(targetId);
        const msg = await target.send(await jobMessage(client, job, target.guild));
        await jobs.setBoardMessage(job.id, target.id, msg.id);

        if (job.board_channel_id && job.board_message_id) {
            try {
                const old = await client.channels.fetch(job.board_channel_id);
                await (await old.messages.fetch(job.board_message_id)).delete();
            } catch (e) { /* already deleted */ }
        }
    } catch (e) {
        console.error(`[board] couldn't move job #${job.id} to ${job.status}:`, e.message);
    }
}

module.exports = { channelIdFor, postNewJob, moveBoard };
