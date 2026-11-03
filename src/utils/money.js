/** Convert a USD number from a Discord option into integer cents. Throws on bad input. */
function toCents(usd) {
    if (typeof usd !== "number" || !Number.isFinite(usd)) throw new UserError("Invalid amount.");
    const cents = Math.round(usd * 100);
    if (Math.abs(usd * 100 - cents) > 1e-6) throw new UserError("Amounts can have at most 2 decimal places.");
    return cents;
}

function fmt(cents) {
    const neg = cents < 0;
    const abs = Math.abs(cents);
    const s = `$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
    return neg ? `-${s}` : s;
}

/** An error whose message is safe to show to the user. */
class UserError extends Error {}

module.exports = { toCents, fmt, UserError };
