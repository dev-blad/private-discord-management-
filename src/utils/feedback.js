const {
    ActionRowBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder
} = require("discord.js");
const { query } = require("../db");
const config = require("../services/config");
const { UserError } = require("./money");

const feedbackRow = jobId => new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId(`fb:${jobId}`).setPlaceholder("⭐ Leave feedback for your order...")
        .addOptions(
            { label: "Positive", value: "positive", emoji: "👍", description: "I'm happy with the service" },
            { label: "Negative", value: "negative", emoji: "👎", description: "Something wasn't right" }));

async function jobFor(jobId) {
    return (await query("SELECT * FROM jobs WHERE id=$1", [jobId])).rows[0];
}

/** Customer picks positive/negative -> popup for the written review. */
async function onSelect(interaction, jobId) {
    const job = await jobFor(jobId);
    if (!job) throw new UserError("That order no longer exists.");
    if (interaction.user.id !== job.customer_id) throw new UserError("Only the customer for this order can leave feedback.");
    if ((await query("SELECT 1 FROM job_feedback WHERE job_id=$1", [jobId])).rows.length) throw new UserError("Feedback has already been left for this order.");

    const modal = new ModalBuilder().setCustomId(`fbmodal:${jobId}:${interaction.values[0]}`).setTitle("Your feedback")
        .addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("review").setLabel("Your review")
                .setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(900)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("anon").setLabel("Post anonymously? (yes / no)")
                .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(3).setPlaceholder("no")));
    return interaction.showModal(modal);
}

/** Review submitted -> save, post to the vouch channel, close the dropdown. */
async function onModal(interaction, jobId, rating) {
    if (!["positive", "negative"].includes(rating)) return;
    const job = await jobFor(jobId);
    if (!job) throw new UserError("That order no longer exists.");
    if (interaction.user.id !== job.customer_id) throw new UserError("Only the customer for this order can leave feedback.");

    const review = interaction.fields.getTextInputValue("review").trim();
    const anonymous = /^y/i.test(interaction.fields.getTextInputValue("anon").trim());

    const ins = await query(
        `INSERT INTO job_feedback (job_id, customer_id, rating, anonymous, review) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT DO NOTHING RETURNING *`, [jobId, interaction.user.id, rating, anonymous, review]);
    if (!ins.rows.length) throw new UserError("Feedback has already been left for this order.");

    // Close the dropdown on the original message.
    if (interaction.isFromMessage?.()) await interaction.update({ components: [] });
    else await interaction.deferReply({ ephemeral: true });

    try {
        const chId = await config.get("vouch_channel_id");
        if (chId) {
            const ch = await interaction.client.channels.fetch(chId);
            const header = await config.get("pricing_header_image", process.env.PRICING_HEADER_IMAGE || "");
            const e = new EmbedBuilder().setColor(rating === "positive" ? 0x2ecc71 : 0xe74c3c).setTitle("Customer Review")
                .setDescription(
                    `\`User      :\` ${anonymous ? "Anonymous" : `@${interaction.user.username}`}\n` +
                    `\`Rating    :\` ${rating === "positive" ? "👍 Positive" : "👎 Negative"}\n` +
                    `\`Order     :\` #${job.id}\n` +
                    `\`Timestamp :\` <t:${Math.floor(Date.now() / 1000)}:f>\n\n` +
                    `**Feedback**\n${review}`)
                .setFooter({ text: interaction.guild?.name || "Reviews", iconURL: interaction.guild?.iconURL?.() || undefined });
            if (header) e.setThumbnail(header);
            await ch.send({ embeds: [e] });
        }
    } catch (err) {
        console.error("[feedback] couldn't post to the vouch channel:", err.message);
    }
    await interaction.followUp({ content: "✅ Thanks for your feedback!", ephemeral: true });
}

module.exports = { feedbackRow, onSelect, onModal };
