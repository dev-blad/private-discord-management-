const { EmbedBuilder } = require("discord.js");
const config = require("../services/config");
const accounts = require("../services/accountsales");
const { rows } = require("./box");
const { fmt } = require("./money");

/** USD -> GP, rounded UP to the next 5M so we never undersell. */
async function gpPrice(cents) {
    const rate = parseFloat(await config.get("gp_usd_rate", process.env.GP_USD_RATE || "0.18"));
    if (!(rate > 0)) return null;
    return Math.ceil(cents / 100 / rate / 5) * 5;
}

async function accountEmbed(a, guild) {
    const gp = await gpPrice(Number(a.price_cents));
    const sold = a.status === "sold";
    const e = new EmbedBuilder()
        .setColor(sold ? 0x95a5a6 : 0x5865f2)
        .setTitle(`${sold ? "SOLD — " : "🧾 "}${a.title}`)
        .setDescription(
            rows([
                ["Account ID", a.id],
                ["Type", a.account_type],
                ["Price", fmt(Number(a.price_cents))],
                ["GP Price", gp ? `${gp.toLocaleString("en-US")}M` : null],
                ["In Stock", sold ? "0" : a.stock],
                ["Listed By", `<@${a.creator_id}>`]
            ], 11) + `\n\n**Description**\n${a.description}\n\n` +
            (sold ? "*This account has been sold.*" : "Open a ticket to buy this account."))
        .setFooter({ text: guild?.name || " ", iconURL: guild?.iconURL?.() || undefined })
        .setTimestamp(new Date(a.created_at));
    if (a.image_url) e.setImage(a.image_url);
    return e;
}

/** Post a listing to its channel and remember the message so it can be updated later. */
async function postListing(client, a, channelId) {
    const ch = await client.channels.fetch(channelId);
    const msg = await ch.send({ embeds: [await accountEmbed(a, ch.guild)] });
    await accounts.setMessage(a.id, ch.id, msg.id);
    return msg;
}

/** Re-draw the listing after a sale or restock; delete it when the account was removed. */
async function refreshListing(client, a) {
    if (!a.channel_id || !a.message_id) return;
    try {
        const ch = await client.channels.fetch(a.channel_id);
        const msg = await ch.messages.fetch(a.message_id);
        if (a.status === "deleted") return await msg.delete();
        await msg.edit({ embeds: [await accountEmbed(a, ch.guild)] });
    } catch (e) {
        console.error("[accounts] couldn't update listing", a.id, e.message);
    }
}

/** The DM the buyer gets: login details in the same layout as the old bot. */
async function deliveryMessage({ account, details, buyerName, sellerName, soldCents, guild }) {
    let d;
    try { d = JSON.parse(details); } catch (e) { d = { login: "", password: "", notes: details }; }
    const v = x => (x && String(x).trim()) || "N/A";
    const sythe = await config.get("sythe_vouch_url", "");
    const vouchCh = await config.get("vouch_channel_id", "");
    const lines = ["⭐ **Please leave a vouch!**"];
    if (sythe) lines.push(`• [Sythe Vouch Thread](${sythe})`);
    if (vouchCh) lines.push(`• Or vouch in <#${vouchCh}>`);

    const embed = new EmbedBuilder().setColor(0x2ecc71).setTitle("🎉 Account Purchase Confirmation")
        .setDescription(`Hi ${buyerName}, thanks for your purchase! Here's your account information:`)
        .addFields(
            { name: "🆔 Listing ID", value: account.id },
            { name: "💰 Price", value: fmt(Number(soldCents)) },
            { name: "👤 Seller", value: sellerName },
            { name: "📧 Login Email / Username", value: v(d.login) },
            { name: "🔑 Password", value: v(d.password) },
            { name: "🪪 Recovery Details", value: v(d.recovery) },
            { name: "🔒 Bank Pin", value: v(d.pin) },
            { name: "📝 Notes", value: v(d.notes) })
        .setFooter({ text: `Thank you for choosing ${guild?.name || "us"} • Please leave feedback below!` });
    return { content: lines.length > 1 ? lines.join("\n") : undefined, embeds: [embed] };
}

module.exports = { deliveryMessage, accountEmbed, postListing, refreshListing, gpPrice };
