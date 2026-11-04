// Integration tests against a throwaway real Postgres (embedded). Run: npm test
import { createRequire } from "module";
import os from "os"; import fs from "fs"; import path from "path";
import assert from "node:assert/strict";
import EmbeddedPostgres from "embedded-postgres";
const require = createRequire(import.meta.url);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pgtest-"));
const port = 54000 + Math.floor(Math.random() * 500);
const pg = new EmbeddedPostgres({ databaseDir: dir, user: "t", password: "t", port, persistent: false, onLog: () => {}, onError: () => {} });
await pg.initialise(); await pg.start(); await pg.createDatabase("t");
process.env.DATABASE_URL = `postgres://t:t@localhost:${port}/t`;

const db = require("../src/db");
const { migrate } = require("../src/db/migrate");
const wallets = require("../src/services/wallets");
const jobs = require("../src/services/jobs");
const payouts = require("../src/services/payouts");
const reports = require("../src/services/reports");
const config = require("../src/services/config");
const pricing = require("../src/services/pricing");
const { toCents, UserError } = require("../src/utils/money");

let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("  ✓", name); } catch (e) { console.error("  ✗", name, "\n   ", e); process.exitCode = 1; } };
const rejects = (p, msg) => assert.rejects(p, e => e instanceof UserError && (!msg || e.message.includes(msg)));

try {
    await migrate(); await migrate(); // idempotent
    const C = "100000000000000001", W = "100000000000000002", W2 = "100000000000000003", S = "100000000000000009";

    await test("money parsing", () => {
        assert.equal(toCents(12.5), 1250); assert.equal(toCents(0.07), 7); assert.equal(toCents(19.99), 1999);
        assert.throws(() => toCents(1.234), UserError);
    });

    await test("deposit and charge", async () => {
        await wallets.deposit({ discordId: C, cents: 50000, actorId: S, note: "test" });
        assert.equal((await wallets.getWallet(C)).balance, 50000);
        await wallets.charge({ discordId: C, cents: 1000, actorId: S });
        assert.equal((await wallets.getWallet(C)).balance, 49000);
    });

    await test("cannot overdraw", async () => {
        await rejects(wallets.charge({ discordId: C, cents: 99999999, actorId: S }), "Insufficient");
        assert.equal((await wallets.getWallet(C)).balance, 49000);
    });

    await test("20 concurrent charges never lose or invent money", async () => {
        await wallets.deposit({ discordId: W2, cents: 1000, actorId: S });
        const res = await Promise.allSettled(Array.from({ length: 20 }, () => wallets.charge({ discordId: W2, cents: 100, actorId: S })));
        assert.equal(res.filter(r => r.status === "fulfilled").length, 10);
        assert.equal((await wallets.getWallet(W2)).balance, 0);
    });

    await test("job lifecycle: escrow → claim → complete → 80/20 split", async () => {
        const before = (await wallets.getWallet(C)).balance;
        const { job } = await jobs.createJob({ customerId: C, priceCents: 10001, depositCents: 0, description: "x", imageUrl: null, channelId: "1", createdBy: S });
        assert.equal((await wallets.getWallet(C)).balance, before - 10001);
        await rejects(jobs.completeJob({ jobId: job.id, actorId: S }), "only claimed");
        await jobs.claimJob({ jobId: job.id, workerId: W });
        const done = await jobs.completeJob({ jobId: job.id, actorId: S });
        assert.equal(done.worker_cents, 8000); assert.equal(done.house_cents, 2001);
        assert.equal((await wallets.getWallet(W)).earnings, 8000);
        await rejects(jobs.completeJob({ jobId: job.id, actorId: S }), "only claimed"); // no double pay
        assert.equal((await wallets.getWallet(W)).earnings, 8000);
    });

    await test("only one worker can claim a job", async () => {
        const { job } = await jobs.createJob({ customerId: C, priceCents: 500, depositCents: 0, description: "race", imageUrl: null, channelId: "1", createdBy: S });
        const res = await Promise.allSettled([jobs.claimJob({ jobId: job.id, workerId: W }), jobs.claimJob({ jobId: job.id, workerId: W2 }), jobs.claimJob({ jobId: job.id, workerId: S })]);
        assert.equal(res.filter(r => r.status === "fulfilled").length, 1);
    });

    await test("insufficient customer funds blocks job creation, leaves no orphan job", async () => {
        const n = (await db.query("SELECT count(*)::int n FROM jobs")).rows[0].n;
        await rejects(jobs.createJob({ customerId: "100000000000000077", priceCents: 500, depositCents: 0, description: "x", imageUrl: null, channelId: "1", createdBy: S }), "Insufficient");
        assert.equal((await db.query("SELECT count(*)::int n FROM jobs")).rows[0].n, n);
    });

    await test("cancel refunds once and reduces lifetime spent", async () => {
        const w0 = await wallets.getWallet(C);
        const { job } = await jobs.createJob({ customerId: C, priceCents: 700, depositCents: 0, description: "c", imageUrl: null, channelId: "1", createdBy: S });
        await jobs.cancelJob({ jobId: job.id, actorId: S });
        await rejects(jobs.cancelJob({ jobId: job.id, actorId: S }), "already");
        const w1 = await wallets.getWallet(C);
        assert.equal(w1.balance, w0.balance); assert.equal(w1.spent, w0.spent);
    });

    await test("payout needs an address, minimum, and sufficient earnings", async () => {
        await rejects(payouts.requestPayout({ discordId: W, cents: null }), "payout address");
        await wallets.setPayoutAddress(W, "USDT-TRC20", "TXyz1234567890abcdef");
        await rejects(payouts.requestPayout({ discordId: W, cents: 500 }), "Minimum");
        await rejects(payouts.requestPayout({ discordId: W, cents: 99999 }), "only have");
    });

    await test("payout: request holds funds, can't double-claim, approve → paid", async () => {
        const p = await payouts.requestPayout({ discordId: W, cents: null });
        assert.equal(p.amount_cents, 8000);
        assert.equal((await wallets.getWallet(W)).earnings, 0);
        await rejects(payouts.requestPayout({ discordId: W, cents: null }));
        await rejects(payouts.markPaid({ payoutId: p.id, actorId: S, ref: "tx" }), "approved");
        await payouts.approve({ payoutId: p.id, actorId: S });
        await rejects(payouts.approve({ payoutId: p.id, actorId: S }));
        const paid = await payouts.markPaid({ payoutId: p.id, actorId: S, ref: "0xabc" });
        assert.equal(paid.status, "paid");
        await rejects(payouts.reject({ payoutId: p.id, actorId: S }), "already paid");
        assert.equal((await wallets.getWallet(W)).earnings, 0);
    });

    await test("payout reject returns the money", async () => {
        const { job } = await jobs.createJob({ customerId: C, priceCents: 5000, depositCents: 0, description: "p", imageUrl: null, channelId: "1", createdBy: S });
        await jobs.claimJob({ jobId: job.id, workerId: W }); await jobs.completeJob({ jobId: job.id, actorId: S });
        const p = await payouts.requestPayout({ discordId: W, cents: 1500 });
        assert.equal((await wallets.getWallet(W)).earnings, 4000 - 1500);
        await payouts.reject({ payoutId: p.id, actorId: S, note: "bad address" });
        assert.equal((await wallets.getWallet(W)).earnings, 4000);
    });

    await test("ledger is append-only", async () => {
        await assert.rejects(db.query("UPDATE ledger SET delta_cents = 1 WHERE id = 1"), /append-only/);
        await assert.rejects(db.query("DELETE FROM ledger WHERE id = 1"), /append-only/);
    });

    await test("ledger always reconciles with wallet totals", async () => {
        const { rows } = await db.query(`
            SELECT w.discord_id FROM wallets w
            LEFT JOIN (SELECT discord_id, bucket, sum(delta_cents) s FROM ledger GROUP BY 1,2) b ON b.discord_id=w.discord_id AND b.bucket='balance'
            LEFT JOIN (SELECT discord_id, bucket, sum(delta_cents) s FROM ledger GROUP BY 1,2) e ON e.discord_id=w.discord_id AND e.bucket='earnings'
            WHERE w.balance_cents <> COALESCE(b.s,0) OR w.earnings_cents <> COALESCE(e.s,0)`);
        assert.deepEqual(rows, []);
    });

    await test("reports, exports, pricing tiers, config", async () => {
        const s = await reports.summary();
        assert.ok(s.completed_jobs >= 2 && s.profit_cents > 0);
        assert.ok((await reports.leaderboard("workers")).length >= 1);
        const csv = await reports.exportCsv("ledger");
        assert.ok(csv.startsWith("id,discord_id,bucket"));
        await config.set("discount_threshold_1", "100"); await config.set("discount_percent_1", "5");
        assert.equal((await pricing.discountFor(10000)).percent, 5);
        assert.equal(await pricing.discountFor(9999), null);
        assert.equal(await config.get("worker_pct"), "80");
    });

    // ---- catalog / calculators / dropdown / !w (synthetic fixtures only) ----
    const catalog = require("../src/services/catalog");
    const calc = require("../src/utils/calc");
    const sPrefix = require("../src/prefix/s");
    const bPrefix = require("../src/prefix/b");
    const qPrefix = require("../src/prefix/q");
    const wPrefix = require("../src/prefix/w");
    const pmenu = require("../src/utils/pricingMenu");
    const jobroles = require("../src/services/jobroles");

    const pvmRows = [
        ["Vorkath", "Title", "Kill", "Notes"],
        ["", "Price", 2.5, ""],
        ["", "Memo", "per kill", "Needs DS2"],
        ["", "Aliases", "vork", "vorkath section"],
        ["Barrows", "Title", "Kill", "Notes"],
        ["", "Price", 4, ""],
        ["", "Aliases", "brr", "barrows section"],
    ];
    const mgRows = [
        ["Tithe Farm", "Title", "Full", "Half"],
        ["", "Price", 10, 6],
        ["", "Memo", "a", "b"],
        ["", "Aliases", "tf", "tithe", "tf half"],
    ];
    const skillRows = [
        ["Agility", "Calculation", "", "Laps", "Rooftop"],
        ["", "startLevel", "", 1, 50],
        ["", "endLevel", "", 50, 99],
        ["", "$/xp", "", 0.00001, 0.00002],
        ["", "Method", "Some notes", "Basic", "Roofs"],
    ];
    const questRows = [
        ["Group", "quest-name", "Price"],
        ["Desert", "Desert Treasure", 5, "", "dt"],
        ["Desert", "Icthlarin's Little Helper", 3],
        ["Misc", "Cook's Assistant", 1, "", "cooks"],
    ];
    const menuRows = [
        ["Name", "Location", "Thumbnail", "Image", "Emoji"],
        ["Vorkath", "PvM", "", "", ""],
        ["Agility", "Skilling", "", "", ""],
    ];
    const tabs = () => [
        { title: "PvM", rows: pvmRows }, { title: "Minigames", rows: mgRows },
        { title: "Skilling", rows: skillRows }, { title: "Quests", rows: questRows },
        { title: "Pricing", rows: menuRows }, { title: "Wallets", rows: [["x"]] }
    ];

    await test("sheet parsers", () => {
        const b = catalog.parseBlocks(pvmRows).entries;
        assert.equal(b.length, 2);
        assert.deepEqual(b[0].data.aliases, ["vorkath section"]);
        assert.deepEqual(b[0].data.options[0].aliases, ["vork"]);
        const m = catalog.parseBlocks(mgRows).entries[0];
        assert.equal(m.data.hasNotes, false);
        assert.ok(m.data.aliases.includes("tf half"));
        assert.equal(catalog.parseSkilling(skillRows).entries[0].data.columns.length, 2);
        assert.equal(catalog.parseQuests(questRows).entries.length, 3);
        assert.equal(catalog.parseMenu(menuRows).entries.length, 2);
        assert.equal(catalog.detectTabType(questRows), "quests");
        assert.equal(catalog.detectTabType(menuRows), "menu");
        assert.equal(catalog.detectTabType(skillRows), "skilling");
        assert.equal(catalog.detectTabType(pvmRows), "blocks");
    });

    await test("sync loads tabs, ignores Wallets, is repeatable", async () => {
        const r = await catalog.syncCatalog({ fetchTabs: async () => tabs() });
        assert.ok(r.totalEntries >= 8);
        await catalog.syncCatalog({ fetchTabs: async () => tabs() });
        assert.equal((await catalog.getTab("PvM")).length, 2);
        assert.equal((await catalog.getTab("Wallets")).length, 0);
    });

    await test("sync rejects empty or shrinking tabs unless forced", async () => {
        const many = [["Name", "Location"], ...Array.from({ length: 8 }, (_, i) => [`Item${i}`, "PvM"])];
        await catalog.syncCatalog({ fetchTabs: async () => [{ title: "Pricing", rows: many }] });
        assert.equal((await catalog.getTab("Pricing")).length, 8);
        const small = [["Name", "Location"], ["Item0", "PvM"]];
        const r = await catalog.syncCatalog({ fetchTabs: async () => [{ title: "Pricing", rows: small }] });
        assert.equal(r.tabs[0].status, "rejected");
        assert.equal((await catalog.getTab("Pricing")).length, 8);
        const f = await catalog.syncCatalog({ fetchTabs: async () => [{ title: "Pricing", rows: small }], force: true });
        assert.equal(f.tabs[0].status, "ok");
        assert.equal((await catalog.getTab("Pricing")).length, 1);
    });

    await test("!b lookup and output", async () => {
        const entries = await catalog.getTab("PvM");
        const hit = calc.lookupInBlocks(entries, "vork");
        assert.equal(hit.entry.name, "Vorkath");
        assert.equal(hit.option.title, "Kill");
        const sec = calc.lookupInBlocks(entries, "barrows section");
        assert.equal(sec.option, null);
        const d = bPrefix.describe(sec, 2, 0, 0.18);
        assert.ok(d.includes("$8.00"));
        assert.equal(calc.lookupInBlocks(entries, "zzz"), null);
    });

    await test("!s pricing math", async () => {
        const entry = (await catalog.getTab("Skilling"))[0];
        const g = sPrefix.priceRange(entry, 1, 99);
        const total = g.reduce((n, x) => n + x.totalUsd, 0);
        assert.ok(total > 0);
        const clipped = sPrefix.priceRange(entry, 60, 70);
        assert.equal(clipped.length, 1);
        assert.equal(sPrefix.priceRange(entry, 99, 99).length, 0);
    });

    await test("!q picks quests by group and alias", async () => {
        const entries = await catalog.getTab("Quests");
        const byGroup = qPrefix.pickQuests(entries, ["desert"]);
        assert.equal(byGroup.length, 2);
        const byAlias = qPrefix.pickQuests(entries, ["cooks"]);
        assert.equal(byAlias[0].name, "Cook's Assistant");
    });

    await test("dropdown menus respect Discord limits and show a header option", () => {
        const mk = (n, loc) => Array.from({ length: n }, (_, i) => ({ key: `${loc}${i}`, name: `Name ${i}`, data: { location: loc, emoji: "<:a:123456789012345678>" } }));
        const entries = [...mk(60, "Big"), ...mk(3, "Raids"), ...mk(2, "Skilling")];
        const rows = pmenu.buildMenus(entries);
        assert.equal(rows.length, 3 + 1 + 1);
        assert.ok(rows.every(r => r.components[0].options.length <= 25));
        const opts = i => rows[i].components[0].options.map(o => o.data);
        const first = opts(0)[0];
        assert.ok(first.default && first.value.startsWith(pmenu.HEADER_PREFIX) && first.emoji);
        assert.equal(opts(0)[0].label, "Skilling");   // default order puts Skilling first
        assert.equal(opts(1)[0].label, "Raids");
        assert.ok(pmenu.chunkRows(rows).every(c => c.length <= 5));
    });

    await test("job messages move claim → claimed → completed", async () => {
        const board = require("../src/utils/board");
        const sent = [], deleted = [];
        const mkChannel = id => ({ id, send: async m => { const msg = { id: `m${sent.length + 1}` }; sent.push({ ch: id, m }); return msg; },
            messages: { fetch: async mid => ({ id: mid, delete: async () => deleted.push(`${id}/${mid}`), edit: async () => sent.push({ ch: id, edited: mid }) }) } });
        const client = { channels: { fetch: async id => mkChannel(id) } };
        await config.set("claim_channel_id", "C1"); await config.set("claimed_channel_id", "C2"); await config.set("completed_channel_id", "C3");

        await wallets.deposit({ discordId: C, cents: 10000, actorId: S });
        const { job } = await jobs.createJob({ customerId: C, priceCents: 5000, depositCents: 0, description: "x", imageUrl: null, channelId: "T", createdBy: S });
        await board.postNewJob(client, job, mkChannel("FALLBACK"));
        assert.equal(sent[0].ch, "C1");
        assert.ok(sent[0].m.components.length === 1);
        assert.equal(sent[1].ch, "T");                 // customer's copy in the ticket
        assert.equal(sent[1].m.components.length, 0);

        const claimed = await jobs.claimJob({ jobId: job.id, workerId: W });
        await board.moveBoard(client, claimed);
        assert.equal(sent.at(-1).ch, "C2");
        assert.equal(deleted.length, 1);
        assert.equal(sent.at(-1).m.components[0].components[0].data.disabled, true);

        const done = await jobs.completeJob({ jobId: job.id, actorId: S });
        await board.moveBoard(client, done);
        assert.equal(sent.at(-1).ch, "C3");
        assert.equal(deleted.length, 2);
        assert.equal((await jobs.getJob(job.id)).board_channel_id, "C3");
    });

    await test("support cut: worker 80, support 5, house 15", async () => {
        const SUP = "100000000000000077";
        await wallets.deposit({ discordId: C, cents: 10000, actorId: S });
        const { job } = await jobs.createJob({ customerId: C, priceCents: 10000, depositCents: 0, description: "x", imageUrl: null, channelId: "T", createdBy: SUP, supportPct: 5 });
        await jobs.claimJob({ jobId: job.id, workerId: W });
        const w0 = (await wallets.getWallet(W)).earnings;
        const done = await jobs.completeJob({ jobId: job.id, actorId: S });
        assert.equal(Number(done.worker_cents), 8000);
        assert.equal(Number(done.support_cents), 500);
        assert.equal(Number(done.house_cents), 1500);
        assert.equal((await wallets.getWallet(SUP)).earnings, 500);
        assert.equal((await wallets.getWallet(W)).earnings - w0, 8000);
        await rejects(jobs.createJob({ customerId: C, priceCents: 100, depositCents: 0, description: "x", imageUrl: null, channelId: "T", createdBy: SUP, supportPct: 30 }), "over 100%");
        const sr = require("../src/services/supportroles");
        await sr.set("900", "Senior Support", 5); await sr.set("901", "Support", 2.5);
        const member = ids => ({ roles: { cache: { has: id => ids.includes(id) } } });
        assert.equal(await sr.cutFor(member(["900", "901"])), 5);
        assert.equal(await sr.cutFor(member(["901"])), 2.5);
        assert.equal(await sr.cutFor(member([])), 0);
    });

    await test("job roles and !w lines", async () => {
        await jobroles.add("555", "Caper"); await jobroles.add("555", "Caper2");
        assert.equal((await jobroles.list()).length, 1);
        assert.equal(await jobroles.remove("555"), true);
        assert.equal(await jobroles.remove("555"), false);
        const stats = { asWorker: { orders: 3, completed: 2, cancelled: 1, in_progress: 0 }, asCustomer: { orders: 1, cancelled: 0 } };
        const wl = wPrefix.buildLines({ tag: "@w", isWorker: true, wallet: { balance: 0, earnings: 1234, spent: 0 }, earned: 5000, rate: 0.18, stats, discountText: null, jobRoleNames: ["Caper"] }).join("\n");
        assert.ok(wl.includes("$12.34") && wl.includes("$50.00") && wl.includes("@Caper"));
        const cl = wPrefix.buildLines({ tag: "@c", isWorker: false, wallet: { balance: 1800, earnings: 0, spent: 3600 }, earned: 0, rate: 0.18, stats, discountText: "@VIP [5%]", jobRoleNames: [] }).join("\n");
        assert.ok(cl.includes("100M") && cl.includes("200M") && cl.includes("@VIP [5%]"));
    });

    console.log(`\n${passed} tests passed${process.exitCode ? " (with failures)" : ""}`);
} finally {
    await db.close(); await pg.stop();
}
