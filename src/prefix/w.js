const { EmbedBuilder } = require("discord.js");
const { query } = require("../db");
const wallets = require("../services/wallets");
const pricing = require("../services/pricing");
const jobroles = require("../services/jobroles");
const { getCalcSettings, footer } = require("../utils/calc");
const { isSupport } = require("../utils/perms");

const usd = cents => (cents / 100).toFixed(2);
const pad = label => label.padEnd(17);
const mono = (label, value) => `\`${pad(label)}: ${value}\``;

async function jobStats(userId) {
    const q = col => query(
        `SELECT count(*)::int AS orders,
                count(*) FILTER (WHERE status = 'completed')::int AS completed,
                count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
                count(*) FILTER (WHERE status = 'claimed')::int AS in_progress
         FROM jobs WHERE ${col} = $1`, [userId]);
    return { asWorker: (await q("worker_id")).rows[0], asCustomer: (await q("customer_id")).rows[0] };
}

async function lifetimeEarned(userId) {
    const { rows } = await query(
        "SELECT COALESCE(SUM(delta_cents),0)::bigint AS n FROM ledger WHERE discord_id=$1 AND bucket='earnings' AND kind IN ('job_earning','support_cut')", [userId]);
    return Number(rows[0].n);
}

/** Lines for the monospace box. Pure given its inputs, so it can be tested. */
function buildLines({ tag, isWorker, wallet, earned, rate, stats, discountText, jobRoleNames, deposit = 0 }) {
    const lines = [`\`${pad("User")}:\` ${tag}`];

    if (isWorker) {
        lines.push(mono("USD Balance", `$${usd(wallet.earnings)}`));
        lines.push(mono("Total Earned", `$${usd(earned)}`));
        lines.push(mono("Deposit Paid", `$${usd(deposit)}`));
        if (wallet.balance > 0) lines.push(mono("Spending Credit", `$${usd(wallet.balance)}`));
    } else {
        const balanceGp = Math.round(wallet.balance / 100 / rate);
        const spentGp = Math.round(wallet.spent / 100 / rate);
        lines.push(mono("OSRS Balance", `${balanceGp}M`));
        lines.push(mono("USD Balance", `$${usd(wallet.balance)}`));
        lines.push(mono("OSRS Spending", `${spentGp}M | ${(spentGp * 1_000_000).toLocaleString("en-US")}gp`));
        lines.push(mono("USD Spending", `$${usd(wallet.spent)}`));
    }

    if (discountText) lines.push("", `\`${pad("Discount Role")}:\` ${discountText}`);
    lines.push("");

    if (isWorker) {
        const s = stats.asWorker;
        lines.push(mono("Orders", s.orders), mono("Completed Jobs", s.completed),
            mono("Cancelled Jobs", s.cancelled), mono("In Progress", s.in_progress));
        if (jobRoleNames.length) lines.push(`\`${pad("Job Roles")}:\` ${jobRoleNames.map(n => `@${n}`).join(", ")}`);
    } else {
        const s = stats.asCustomer;
        lines.push(mono("Orders", s.orders), mono("Cancelled Jobs", s.cancelled));
    }
    return lines;
}

/** The wallet card. Shared by !w and /wallet check. */
async function walletEmbed({ guild, user, member }) {
    const [wallet, stats, earned, roles, settings, tiers, deposit] = await Promise.all([
        wallets.getWallet(user.id), jobStats(user.id), lifetimeEarned(user.id),
        jobroles.list(), getCalcSettings(member), pricing.tiers(), require("../services/deposits").get(user.id)
    ]);

    const have = id => Boolean(id && member?.roles?.cache?.has(id));
    const jobRoleNames = roles.filter(r => have(r.role_id)).map(r => r.name);
    const isWorker = have(process.env.BOOSTER_ROLE_ID) || jobRoleNames.length > 0;

    // best discount tier role they hold, e.g. "@VIP [5%]"
    const tier = tiers.filter(t => have(t.role)).sort((a, b) => b.percent - a.percent)[0];
    let discountText = null;
    if (tier) {
        const roleName = guild?.roles?.cache?.get(tier.role)?.name;
        discountText = roleName ? `@${roleName} [${tier.percent}%]` : `[${tier.percent}%]`;
    }

    const lines = buildLines({
        tag: `<@${user.id}>`, isWorker, wallet, earned, rate: settings.rate,
        stats, discountText, jobRoleNames, deposit
    });

    return new EmbedBuilder()
        .setColor(0x00ae86)
        .setDescription((isWorker ? "Worker statistics and earnings" : "Customer wallet and spending") + "\n\n" + lines.join("\n"))
        .setThumbnail(user.displayAvatarURL({ size: 256 }))
        .setFooter({ text: guild?.name || " ", iconURL: guild?.iconURL?.() || undefined })
        .setTimestamp();
}

module.exports = {
    name: "w",
    aliases: ["wallet"],
    buildLines,
    walletEmbed,
    async execute(message) {
        // Staff can look at someone else with `!w @user`.
        const mentioned = message.mentions.users.first();
        const user = mentioned && isSupport(message.member) ? mentioned : message.author;
        const member = user.id === message.author.id ? message.member : await message.guild.members.fetch(user.id).catch(() => null);
        return message.reply({ embeds: [await walletEmbed({ guild: message.guild, user, member })] });
    }
};
