// The boxed look: `Label     :` value, with the colons lined up.
const row = (label, value, width = 11) => `\`${String(label).padEnd(width)}:\` ${value}`;

/** rows([["Price", "$5"], ["Customer", "@x"]]) -> aligned lines (null/undefined values are skipped). */
function rows(pairs, width) {
    const list = pairs.filter(p => p && p[1] !== null && p[1] !== undefined && p[1] !== false);
    const w = width || Math.max(...list.map(p => String(p[0]).length), 1);
    return list.map(([l, v]) => row(l, v, w)).join("\n");
}

/** Bold section heading followed by aligned rows. */
const section = (title, pairs, width) => `**${title}**\n${rows(pairs, width)}`;

module.exports = { row, rows, section };
