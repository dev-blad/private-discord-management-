const pricing = require("../services/pricing");

/** Give the customer the highest spend-tier role they now qualify for. Best effort. */
async function applySpendRole(guild, userId, spentCents) {
    try {
        const tier = await pricing.discountFor(spentCents);
        if (!tier?.role) return;
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member && !member.roles.cache.has(tier.role)) await member.roles.add(tier.role).catch(() => null);
    } catch (e) {
        console.error("[roles] applySpendRole failed:", e.message);
    }
}
module.exports = { applySpendRole };
