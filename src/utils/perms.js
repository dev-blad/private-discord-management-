const { PermissionFlagsBits } = require("discord.js");

const has = (member, id) => Boolean(id && member?.roles?.cache?.has(id));

function isAdmin(member) {
    return has(member, process.env.ADMIN_ROLE_ID) ||
        Boolean(member?.permissions?.has?.(PermissionFlagsBits.Administrator));
}
const isSupport = member => isAdmin(member) || has(member, process.env.SUPPORT_ROLE_ID);
const isBooster = member => isSupport(member) || has(member, process.env.BOOSTER_ROLE_ID);

function require_(check, label) {
    return member => {
        if (!check(member)) {
            const { UserError } = require("./money");
            throw new UserError(`You need the ${label} role to do that.`);
        }
    };
}

module.exports = {
    isAdmin, isSupport, isBooster,
    requireAdmin: require_(isAdmin, "Admin"),
    requireSupport: require_(isSupport, "Support"),
    requireBooster: require_(isBooster, "Booster")
};
