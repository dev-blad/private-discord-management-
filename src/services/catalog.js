const { query, withTx } = require("../db");
const { UserError } = require("../utils/money");

const norm = s => String(s ?? "").toLowerCase().trim();
const text = v => (v === null || v === undefined ? "" : String(v).trim());
const isUrl = s => /^https?:\/\//i.test(s);

// Tabs that hold customer/order data, not prices. Never read.
const IGNORED_TABS = new Set([
    "wallets", "orders", "transactions", "accounts for sale", "sold accounts", "locations"
]);

/** "$8.10", "1,200", 8.1 -> number, anything else -> null. */
function num(v) {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    const n = parseFloat(String(v ?? "").replace(/[$£€,\s]/g, ""));
    return Number.isFinite(n) ? n : null;
}

function detectTabType(rows) {
    if (rows[0] && norm(rows[0][0]) === "group" && norm(rows[0][1]) === "quest-name") return "quests";
    if (rows[0] && norm(rows[0][0]) === "name" && norm(rows[0][1]) === "location") return "menu";
    let skilling = false;
    for (const r of rows.slice(0, 400)) {
        if (text(r?.[0]) && norm(r[1]) === "title") return "blocks";
        if (norm(r?.[1]) === "calculation") skilling = true;
    }
    return skilling ? "skilling" : null;
}

/** Group a tab's rows into blocks: a block starts at a row with text in column A. */
function collectBlocks(rows, startLabel) {
    const out = [];
    let i = 0;
    while (i < rows.length) {
        const head = rows[i] || [];
        if (!(text(head[0]) && norm(head[1]) === startLabel)) { i++; continue; }
        const by = {};
        let j = i + 1;
        while (j < rows.length && !text(rows[j]?.[0])) {
            const label = norm(rows[j]?.[1]);
            if (label && !(label in by)) by[label] = rows[j];
            j++;
        }
        out.push({ head, by });
        i = j;
    }
    return out;
}

/**
 * Block tabs (PvM, Raids, Minigames, Endgame Kits, ...). One block =
 *   A: name | B: title     | C..: option names   (a cell "Notes" marks the notes column)
 *           | B: price     | C..: prices
 *           | B: memo/notes
 *           | B: aliases   | C..: aliases
 *           | B: thumbnail | C: url
 * Rows are matched by the label in column B, not by position, so a missing
 * row never shifts the others.
 *
 * Two layouts exist in the sheet:
 *  - with a Notes column (PvM, Raids, Kits, ...): the aliases cell under Notes
 *    is the SECTION alias; aliases further right belong to the option above them.
 *  - without one (Minigames): every alias in the row is a block alias.
 */
function parseBlocks(rows) {
    const entries = [];
    const warnings = [];
    const seen = new Set();

    for (const { head, by } of collectBlocks(rows, "title")) {
        const name = text(head[0]);
        const memoRow = by.memo || by.notes || [];
        const priceRow = by.price || [];
        const aliasRow = by.aliases || [];

        let notesCol = -1;
        head.forEach((cell, col) => { if (col >= 2 && notesCol === -1 && norm(cell) === "notes") notesCol = col; });
        const hasNotes = notesCol !== -1;

        const options = [];
        head.forEach((cell, col) => {
            if (col < 2 || col === notesCol) return;
            const title = text(cell);
            if (!title) return;
            const price = num(priceRow[col]);
            if (price === null) warnings.push(`${name} › ${title}: no valid price`);
            else if (price < 0) warnings.push(`${name} › ${title}: negative price`);
            options.push({
                title, price,
                memo: text(memoRow[col]) || null,
                aliases: hasNotes && text(aliasRow[col]) ? [norm(aliasRow[col])] : []
            });
        });

        const key = norm(name);
        if (seen.has(key)) { warnings.push(`${name}: duplicate block ignored`); continue; }
        if (!options.some(o => o.price !== null)) { warnings.push(`${name}: no priced options, skipped`); continue; }
        seen.add(key);

        const blockAliases = hasNotes ? [aliasRow[notesCol]] : aliasRow.slice(2);
        const thumb = text(by.thumbnail?.[2]);
        entries.push({
            kind: "block", name, position: entries.length,
            data: {
                hasNotes,
                notes: hasNotes ? text(memoRow[notesCol]) || null : null,
                thumbnail: isUrl(thumb) ? thumb : null,
                aliases: [...new Set(blockAliases.map(norm).filter(Boolean))],
                options
            }
        });
    }
    return { entries, warnings };
}

/** Skilling tab: one block per skill; columns are method segments. */
function parseSkilling(rows) {
    const entries = [];
    const warnings = [];
    const seen = new Set();
    for (const { head, by } of collectBlocks(rows, "calculation")) {
        const name = text(head[0]);
        const startRow = by.startlevel || [], endRow = by.endlevel || [], rateRow = by["$/xp"] || [], methodRow = by.method || [];
        let notes = text(methodRow[2]);
        if (/^notes?/i.test(notes)) notes = notes.replace(/^notes?/i, "").trim();

        const columns = [];
        const width = Math.max(head.length, startRow.length, endRow.length, rateRow.length, methodRow.length);
        for (let col = 3; col < width; col++) {
            const group = text(head[col]);
            if (!group) continue;
            const start = num(startRow[col]), end = num(endRow[col]), rate = num(rateRow[col]);
            if (start === null || end === null || rate === null || start <= 0 || end <= 0 || rate <= 0) continue;
            columns.push({ group, start, end, rate, method: text(methodRow[col]) });
        }
        const key = norm(name);
        if (seen.has(key)) { warnings.push(`${name}: duplicate skill ignored`); continue; }
        if (!columns.length) { warnings.push(`${name}: no usable method columns, skipped`); continue; }
        seen.add(key);
        entries.push({ kind: "skill", name, position: entries.length, data: { notes: notes || null, columns } });
    }
    return { entries, warnings };
}

/** Quests tab: Group | quest-name | Price | (blank) | alias | alias ... */
function parseQuests(rows) {
    const entries = [];
    const warnings = [];
    const seen = new Set();
    for (const r of rows.slice(1)) {
        const name = text(r?.[1]).replace(/\r/g, "");
        if (!name) continue;
        const key = norm(name);
        if (seen.has(key)) { warnings.push(`${name}: duplicate quest ignored`); continue; }
        const price = num(r[2]);
        if (price === null) { warnings.push(`${name}: no valid price, skipped`); continue; }
        seen.add(key);
        entries.push({
            kind: "quest", name, position: entries.length,
            data: { group: text(r[0]) || null, price, aliases: [...new Set(r.slice(4).map(norm).filter(Boolean))] }
        });
    }
    return { entries, warnings };
}

/** Pricing tab (the dropdown list): Name | Location | Thumbnail | Image | Emoji */
function parseMenu(rows) {
    const entries = [];
    const warnings = [];
    const seen = new Set();
    for (const r of rows.slice(1)) {
        const name = text(r?.[0]), location = text(r?.[1]);
        if (!name || !location) continue;
        const key = `${norm(location)}|${norm(name)}`;
        if (seen.has(key)) { warnings.push(`${location} › ${name}: duplicate menu item ignored`); continue; }
        seen.add(key);
        const thumb = text(r[2]), image = text(r[3]);
        entries.push({
            kind: "menu", name, key, position: entries.length,
            data: { location, thumbnail: isUrl(thumb) ? thumb : null, image: isUrl(image) ? image : null, emoji: text(r[4]) || null }
        });
    }
    return { entries, warnings };
}

const PARSERS = { blocks: parseBlocks, skilling: parseSkilling, quests: parseQuests, menu: parseMenu };

async function fetchTabsFromGoogle() {
    const id = process.env.PRICING_SHEET_ID;
    if (!id) throw new UserError("PRICING_SHEET_ID is not set on the bot.");
    const { getSheetsClient } = require("../sheets/auth");
    const sheets = await getSheetsClient();
    const meta = await sheets.spreadsheets.get({ spreadsheetId: id, fields: "sheets.properties.title" });
    const titles = meta.data.sheets.map(s => s.properties.title).filter(t => !IGNORED_TABS.has(norm(t)));
    const res = await sheets.spreadsheets.values.batchGet({
        spreadsheetId: id,
        ranges: titles.map(t => `'${t.replace(/'/g, "''")}'!A1:AZ3000`),
        valueRenderOption: "UNFORMATTED_VALUE"
    });
    return res.data.valueRanges.map((vr, k) => ({ title: titles[k], rows: vr.values || [] }));
}

/**
 * Copy the sheet into Postgres. Each tab is replaced as a whole inside one
 * transaction, so the bot never sees half a tab. A tab that parses to nothing,
 * or that would lose more than half its entries, is rejected and the previous
 * copy is kept (unless force is set).
 */
async function syncCatalog({ fetchTabs = fetchTabsFromGoogle, actorId = null, force = false } = {}) {
    const started = new Date();
    const tabs = await fetchTabs();
    const results = [];
    const accepted = [];

    for (const t of tabs) {
        if (IGNORED_TABS.has(norm(t.title))) continue;
        const type = detectTabType(t.rows);
        if (!type) { results.push({ tab: t.title, status: "ignored" }); continue; }

        const { entries, warnings } = PARSERS[type](t.rows);
        const prev = (await query("SELECT count(*)::int AS n FROM catalog_entries WHERE lower(tab) = $1", [norm(t.title)])).rows[0].n;

        if (entries.length === 0) {
            results.push({ tab: t.title, status: "rejected", note: "no entries found, kept previous copy", warnings });
        } else if (!force && prev >= 4 && entries.length < prev * 0.5) {
            results.push({ tab: t.title, status: "rejected", note: `would drop ${prev} → ${entries.length} entries, kept previous copy (run "!syncdatabase force" if intended)`, warnings });
        } else {
            accepted.push({ tab: t.title, entries });
            results.push({ tab: t.title, status: "ok", type, entries: entries.length, previous: prev, warnings });
        }
    }

    await withTx(async c => {
        for (const { tab, entries } of accepted) {
            await c.query("DELETE FROM catalog_entries WHERE lower(tab) = $1", [norm(tab)]);
            const aliasSeen = new Set();
            for (const e of entries) {
                const ins = await c.query(
                    `INSERT INTO catalog_entries (tab, kind, name, name_key, position, data)
                     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
                    [tab, e.kind, e.name, e.key || norm(e.name), e.position, JSON.stringify(e.data)]
                );
                for (const a of e.data.aliases || []) {
                    if (aliasSeen.has(a) || a === norm(e.name)) continue;
                    aliasSeen.add(a);
                    await c.query(
                        `INSERT INTO catalog_aliases (tab_key, alias_key, entry_id) VALUES ($1,$2,$3)
                         ON CONFLICT DO NOTHING`,
                        [norm(tab), a, ins.rows[0].id]
                    );
                }
            }
        }
    });

    try { await require("./bossroster").syncRoster(); } catch (e) { console.error("[bossroster] sync failed:", e.message); }

    const summary = { tabs: results, totalEntries: accepted.reduce((n, a) => n + a.entries.length, 0), ms: Date.now() - started.getTime() };
    await query(
        "INSERT INTO catalog_sync_log (started_at, actor_id, ok, summary) VALUES ($1,$2,$3,$4)",
        [started, actorId, !results.some(r => r.status === "rejected"), JSON.stringify(summary)]
    );
    return summary;
}

const rowToEntry = r => ({ id: r.id, tab: r.tab, kind: r.kind, name: r.name, key: r.name_key, position: r.position, data: r.data });

/** Every entry of a tab, in sheet order. Tabs are small (tens to a couple of hundred rows). */
async function getTab(tab) {
    const { rows } = await query("SELECT * FROM catalog_entries WHERE lower(tab) = $1 ORDER BY position", [norm(tab)]);
    return rows.map(rowToEntry);
}

/** Find one entry in a tab by name or block alias (case-insensitive). */
async function findEntry(tab, queryText) {
    const q = norm(queryText);
    if (!q) return null;
    const { rows } = await query(
        `SELECT e.* FROM catalog_entries e
         WHERE lower(e.tab) = $1 AND e.name_key = $2
         UNION ALL
         SELECT e.* FROM catalog_aliases a JOIN catalog_entries e ON e.id = a.entry_id
         WHERE a.tab_key = $1 AND a.alias_key = $2
         LIMIT 1`,
        [norm(tab), q]
    );
    return rows[0] ? rowToEntry(rows[0]) : null;
}

async function suggest(tab, queryText, limit = 3) {
    const q = norm(queryText);
    if (!q) return [];
    const { rows } = await query(
        `SELECT name FROM catalog_entries
         WHERE lower(tab) = $1 AND (name_key LIKE $2 OR name_key LIKE $3)
         ORDER BY position LIMIT $4`,
        [norm(tab), `${q}%`, `%${q}%`, limit]
    );
    return rows.map(r => r.name);
}

/** Resolve a Pricing-tab "Location" to the real tab name (typos and truncated names). */
const TAB_NAME_MAP = {
    "questing": "Quests",
    "pvm & bossing": "PvM",
    "pets & misc boosing": "Pets & Misc Boosting"
};
async function resolveTab(location) {
    const l = norm(location);
    const mapped = TAB_NAME_MAP[l] || location;
    const { rows } = await query("SELECT DISTINCT tab FROM catalog_entries WHERE kind <> 'menu'");
    const tabs = rows.map(r => r.tab);
    const m = norm(mapped);
    return tabs.find(t => norm(t) === m)
        || tabs.find(t => norm(t).startsWith(m) || m.startsWith(norm(t)))
        || null;
}

async function lastSync() {
    const { rows } = await query("SELECT * FROM catalog_sync_log ORDER BY id DESC LIMIT 1");
    return rows[0] || null;
}

module.exports = {
    norm, num, detectTabType, parseBlocks, parseSkilling, parseQuests, parseMenu,
    fetchTabsFromGoogle, syncCatalog, getTab, findEntry, suggest, resolveTab, lastSync
};
