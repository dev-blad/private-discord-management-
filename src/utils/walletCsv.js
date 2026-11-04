/** Minimal CSV line splitter (handles "quoted, values"). */
function splitLine(line) {
    const out = []; let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
        else if (c === '"') q = true;
        else if (c === ",") { out.push(cur); cur = ""; }
        else cur += c;
    }
    out.push(cur);
    return out.map(x => x.trim());
}

const num = v => {
    if (v === undefined || v === "") return 0;
    const n = Number(String(v).replace(/[$,\s]/g, ""));
    return Number.isFinite(n) && n >= 0 ? n : NaN;
};

/**
 * Columns (any order, header required): discord_id, balance_usd, earnings_usd, spent_gp (millions), spent_usd.
 * Returns { rows: [{line, discordId, balanceCents, earningsCents, spentCents}], errors: [string] }.
 */
function parseWalletCsv(text, gpRate) {
    const lines = String(text).replace(/^﻿/, "").split(/\r?\n/).filter(l => l.trim());
    const errors = [], rows = [];
    if (!lines.length) return { rows, errors: ["The file is empty."] };
    const head = splitLine(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, "_"));
    const idx = n => head.indexOf(n);
    if (idx("discord_id") < 0) return { rows, errors: ["The first row must be a header with a discord_id column."] };
    if (lines.length > 2001) return { rows, errors: ["Too many rows (2000 max). Split the file."] };
    const seen = new Set();
    lines.slice(1).forEach((l, i) => {
        const line = i + 2, c = splitLine(l), get = n => (idx(n) >= 0 ? c[idx(n)] : undefined);
        const id = (get("discord_id") || "").trim();
        if (!/^\d{15,25}$/.test(id)) return errors.push(`line ${line}: bad discord_id "${id}"`);
        if (seen.has(id)) return errors.push(`line ${line}: ${id} appears twice`);
        seen.add(id);
        const bal = num(get("balance_usd")), earn = num(get("earnings_usd")), gp = num(get("spent_gp")), usd = num(get("spent_usd"));
        if ([bal, earn, gp, usd].some(Number.isNaN)) return errors.push(`line ${line}: ${id} has a bad number`);
        if (gp && usd) return errors.push(`line ${line}: ${id} has both spent_gp and spent_usd`);
        const r = { line, discordId: id, balanceCents: Math.round(bal * 100), earningsCents: Math.round(earn * 100), spentCents: Math.round((gp ? gp * gpRate : usd) * 100) };
        if (!r.balanceCents && !r.earningsCents && !r.spentCents) return errors.push(`line ${line}: ${id} has nothing to migrate`);
        rows.push(r);
    });
    return { rows, errors };
}

module.exports = { parseWalletCsv };
