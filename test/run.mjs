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

    await test("boss event: tokens from completed spend, kills, credit, stock", async () => {
        const boss = require("../src/services/boss");
        const U = "boss-user";
        await wallets.deposit({ discordId: U, cents: 100000, actorId: S });
        const mk = async cents => {
            const { job } = await jobs.createJob({ customerId: U, priceCents: cents, depositCents: 0, description: "b", imageUrl: null, channelId: "1", createdBy: S });
            await jobs.claimJob({ jobId: job.id, workerId: W });
            return job;
        };
        // off by default: no tokens
        let j = await mk(5000);
        assert.equal((await jobs.completeJob({ jobId: j.id, actorId: S })).bossTokens, 0);
        await rejects(boss.kill({ discordId: U }), "isn't running");

        await config.set("boss_enabled", "true"); await config.set("boss_usd_per_token", "25");
        j = await mk(6000);                                   // $60 -> 2 tokens, $10 progress
        assert.equal((await jobs.completeJob({ jobId: j.id, actorId: S })).bossTokens, 2);
        j = await mk(1500);                                   // progress $25 -> 1 more
        assert.equal((await jobs.completeJob({ jobId: j.id, actorId: S })).bossTokens, 1);
        assert.equal((await boss.status(U)).tokens, 3);

        // a cancelled order never earns tokens
        const { job: cj } = await jobs.createJob({ customerId: U, priceCents: 9000, depositCents: 0, description: "c", imageUrl: null, channelId: "1", createdBy: S });
        await jobs.cancelJob({ jobId: cj.id, actorId: S });
        assert.equal((await boss.status(U)).tokens, 3);

        const bal0 = (await wallets.getWallet(U)).balance;
        const drops = await boss.kill({ discordId: U, amount: 2 });
        assert.equal(drops.length, 2);
        const credit = drops.reduce((n, d) => n + d.credit_cents, 0);
        assert.equal((await wallets.getWallet(U)).balance, bal0 + credit);
        assert.equal((await boss.status(U)).tokens, 1);
        await rejects(boss.kill({ discordId: U, amount: 5 }), "only have 1");
        assert.equal((await boss.status(U)).tokens, 1);       // failed kill spends nothing

        // limited stock item: wins once then drops out of the pool
        await db.query("UPDATE boss_prizes SET active=FALSE");
        const item = await boss.addPrize({ rarity: "common", name: "Free 99", kind: "item", stock: 1 });
        await boss.give({ discordId: U, amount: 2, actorId: S });
        const pendingBefore = (await boss.pendingItems()).length;
        const [d1] = await boss.kill({ discordId: U });
        assert.equal(d1.prize_name, "Free 99"); assert.equal(d1.redeemed, false);
        await rejects(boss.kill({ discordId: U }), "empty");
        assert.equal((await boss.pendingItems()).length, pendingBefore + 1);
        await boss.redeem({ dropId: d1.id, actorId: S });
        await rejects(boss.redeem({ dropId: d1.id, actorId: S }), "unredeemed");
        assert.ok((await boss.stats()).kills >= 3);
    });

    await test("boss discount prize comes off the next order only, once", async () => {
        const boss = require("../src/services/boss");
        const U = "disc-user";
        await wallets.deposit({ discordId: U, cents: 100000, actorId: S });
        await db.query("UPDATE boss_prizes SET active=FALSE");
        await boss.addPrize({ rarity: "common", name: "10% off", kind: "discount", discountPct: 10 });
        await rejects(boss.addPrize({ rarity: "common", name: "bad", kind: "discount", discountPct: 0 }), "percent");
        await rejects(boss.addPrize({ rarity: "common", name: "bad", kind: "role" }), "role name");
        await boss.give({ discordId: U, amount: 2, actorId: S });
        const [d] = await boss.kill({ discordId: U });
        assert.equal(d.kind, "discount"); assert.equal(d.redeemed, true);
        const first = await jobs.createJob({ customerId: U, priceCents: 10000, depositCents: 0, description: "d", imageUrl: null, channelId: "1", createdBy: S });
        assert.equal(first.job.price_cents, 9000); assert.equal(first.job.discount_pct, 10); assert.equal(Number(first.job.list_price_cents), 10000);
        assert.equal(first.spent, 9000);
        const second = await jobs.createJob({ customerId: U, priceCents: 10000, depositCents: 0, description: "d", imageUrl: null, channelId: "1", createdBy: S });
        assert.equal(second.job.price_cents, 10000); assert.equal(second.job.discount_pct, 0);   // used up
        // every win is saved as its own coupon; each order uses the best one, one at a time
        await db.query("DELETE FROM customer_discounts WHERE discord_id=$1", [U]);
        await boss.give({ discordId: U, amount: 3, actorId: S });
        await boss.kill({ discordId: U, amount: 3 });
        await db.query("UPDATE customer_discounts SET percent=25 WHERE id=(SELECT id FROM customer_discounts WHERE discord_id=$1 ORDER BY id LIMIT 1)", [U]);
        assert.equal(Number((await db.query("SELECT count(*) FROM customer_discounts WHERE discord_id=$1", [U])).rows[0].count), 3);
        const a1 = await jobs.createJob({ customerId: U, priceCents: 10000, depositCents: 0, description: "d", imageUrl: null, channelId: "1", createdBy: S });
        assert.equal(a1.job.discount_pct, 25); assert.equal(a1.job.discountsLeft, 2);
        const a2 = await jobs.createJob({ customerId: U, priceCents: 10000, depositCents: 0, description: "d", imageUrl: null, channelId: "1", createdBy: S });
        assert.equal(a2.job.discount_pct, 10); assert.equal(a2.job.discountsLeft, 1);
    });

    await test("gp_convert parses k/m/b", async () => {
        const g = require("../src/commands/gp_convert");
        assert.equal(g.parseGp("3456m"), 3456);
        assert.equal(g.parseGp("3.4b"), 3400);
        assert.equal(g.parseGp("500k"), 0.5);
        assert.equal(g.parseGp("abc"), null);
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

    await test("automatic USDC payouts: limits, caps, failures never lose or double-send money", async () => {
        const chain = require("../src/services/chain");
        const autopay = require("../src/services/autopay");
        const ADDR = "0x1111111111111111111111111111111111111111";
        const give = (id, cents) => db.withTx(c => wallets.applyLedger(c, { discordId: id, bucket: "earnings", delta: cents, kind: "adjustment", actorId: S }));
        const earnings = async id => (await wallets.getWallet(id)).earnings;
        const mkUser = async (id, cents, addr = ADDR) => { await give(id, cents); await wallets.setPayoutAddress(id, "USDC-BASE", addr); };
        const state = { usdc: 100000, eth: 1n, confirm: { confirmed: true, success: true }, sent: [], failBroadcast: false };
        chain.setSender({
            address: "0xPOT",
            balances: async () => ({ tokenCents: state.usdc, gasWei: state.eth }),
            prepare: async (to, units, opts) => ({ raw: `raw-${state.sent.length}`, hash: "0x" + String(state.sent.length + 1).padStart(64, "a") }),
            broadcast: async raw => { if (state.failBroadcast) throw new Error("rpc exploded"); state.sent.push(raw); },
            confirm: async () => state.confirm
        });
        const U = n => `20000000000000000${String(n).padStart(2, "0")}`;

        assert.equal(chain.centsToUnits(1234), 12340000n);
        assert.equal(chain.centsToUnits(1234, 18), 12340000000000000000n);
        assert.ok(chain.supports("USDT-ERC20") && chain.supports("USDC-BASE") && !chain.supports("LTC") && !chain.supports("constructor"));
        assert.match(chain.explorer("USDT-ERC20", "0xabc"), /etherscan\.io/);
        assert.ok(chain.isValidAddress(ADDR) && !chain.isValidAddress("0x123") && !chain.isValidAddress("hello"));

        // off by default: held for staff
        await mkUser(U(1), 5000);
        let p = await payouts.requestPayout({ discordId: U(1), cents: null });
        let r = await autopay.maybeAuto(p);
        assert.equal(r.state, "review"); assert.equal(state.sent.length, 0);
        assert.equal(await earnings(U(1)), 0);                       // held, not lost

        await config.set("auto_payout_enabled", "true");
        await config.set("auto_payout_max_usd", "100");
        await config.set("auto_payout_daily_worker_usd", "250");
        await config.set("auto_payout_daily_total_usd", "1000");

        // under the limit: sent and marked paid
        await mkUser(U(2), 5000);
        p = await payouts.requestPayout({ discordId: U(2), cents: null });
        r = await autopay.maybeAuto(p);
        assert.equal(r.state, "paid"); assert.equal(r.payout.status, "paid"); assert.ok(r.payout.paid_ref.startsWith("0x"));
        assert.equal(state.sent.length, 1); assert.equal(await earnings(U(2)), 0);

        // over the limit: waits for staff
        await mkUser(U(3), 20000);
        p = await payouts.requestPayout({ discordId: U(3), cents: null });
        r = await autopay.maybeAuto(p);
        assert.equal(r.state, "review"); assert.match(r.reason, /limit/); assert.equal(state.sent.length, 1);

        // staff approve -> sends (never twice, even if clicked twice at once)
        await payouts.approve({ payoutId: p.id, actorId: S });
        const both = await Promise.allSettled([autopay.sendPayout({ payoutId: p.id, actorId: S }), autopay.sendPayout({ payoutId: p.id, actorId: S })]);
        assert.equal(both.filter(x => x.status === "fulfilled" && x.value.state === "paid").length, 1);
        assert.equal(both.filter(x => x.status === "rejected").length, 1);
        assert.equal(state.sent.length, 2);

        // wallet too low: stays approved, funds still held, nothing sent
        state.usdc = 100;
        await mkUser(U(4), 5000);
        p = await payouts.requestPayout({ discordId: U(4), cents: null });
        r = await autopay.maybeAuto(p);
        assert.equal(r.state, "queued"); assert.equal(r.payout.status, "approved"); assert.equal(state.sent.length, 2); assert.equal(await earnings(U(4)), 0);
        state.usdc = 100000;
        r = await autopay.sendPayout({ payoutId: p.id, actorId: S });   // retry after top-up
        assert.equal(r.state, "paid"); assert.equal(state.sent.length, 3);

        // transfer reverted on-chain: back to approved, no money lost
        state.confirm = { confirmed: true, success: false };
        await mkUser(U(5), 5000);
        p = await payouts.requestPayout({ discordId: U(5), cents: null });
        r = await autopay.maybeAuto(p);
        assert.equal(r.state, "queued"); assert.equal((await payouts.getPayout(p.id)).paid_ref, null);

        // not confirmed in time: stays 'sending' for a human, can be marked paid
        state.confirm = { confirmed: false };
        await mkUser(U(6), 5000);
        p = await payouts.requestPayout({ discordId: U(6), cents: null });
        r = await autopay.maybeAuto(p);
        assert.equal(r.state, "unconfirmed"); assert.equal(r.payout.status, "sending");
        await rejects(payouts.reject({ payoutId: p.id, actorId: S }), "already");
        assert.equal((await payouts.markPaid({ payoutId: p.id, actorId: S })).status, "paid");
        state.confirm = { confirmed: true, success: true };

        // broadcast error: left for a human, funds not refunded blindly
        state.failBroadcast = true;
        await mkUser(U(7), 5000);
        p = await payouts.requestPayout({ discordId: U(7), cents: null });
        r = await autopay.maybeAuto(p);
        assert.equal(r.state, "unconfirmed"); assert.equal(await earnings(U(7)), 0);
        state.failBroadcast = false;

        // invalid address: rejected and refunded
        await mkUser(U(8), 5000, "0xnope");
        p = await payouts.requestPayout({ discordId: U(8), cents: null });
        r = await autopay.maybeAuto(p);
        assert.equal(r.state, "rejected"); assert.equal(await earnings(U(8)), 5000);

        // other coins are never auto-sent
        await give(U(9), 5000); await wallets.setPayoutAddress(U(9), "LTC", "ltc1qexampleexampleexample");
        p = await payouts.requestPayout({ discordId: U(9), cents: null });
        r = await autopay.maybeAuto(p);
        assert.equal(r.state, "review");

        // daily cap per worker
        await config.set("auto_payout_daily_worker_usd", "60");
        await mkUser(U(10), 5000); await wallets.setPayoutAddress(U(10), "USDC-BASE", ADDR);
        p = await payouts.requestPayout({ discordId: U(10), cents: 5000 });
        assert.equal((await autopay.maybeAuto(p)).state, "paid");
        await give(U(10), 5000);
        p = await payouts.requestPayout({ discordId: U(10), cents: 5000 });
        r = await autopay.maybeAuto(p);
        assert.equal(r.state, "review"); assert.match(r.reason, /daily cap/);

        // USDT on Ethereum is automatic too, and a gas spike queues it instead of overpaying
        const seen = [];
        const prev = state.confirm;
        chain.setSender(m => ({ address: "0xPOT", balances: async () => ({ tokenCents: 100000, gasWei: 1n }),
            prepare: async (to, units, opts) => { seen.push({ m, units, opts }); if (state.spike) throw new chain.GasTooHigh("Network fees are high right now (99 gwei, limit 20)"); return { raw: "r", hash: "0x" + "b".repeat(64) }; },
            broadcast: async () => {}, confirm: async () => prev }));
        await config.set("auto_payout_daily_worker_usd", "250");
        await give(U(11), 5000); await wallets.setPayoutAddress(U(11), "USDT-ERC20", ADDR);
        state.spike = true;
        p = await payouts.requestPayout({ discordId: U(11), cents: null });
        r = await autopay.maybeAuto(p);
        assert.equal(r.state, "queued"); assert.match(r.reason, /fees/); assert.equal(await earnings(U(11)), 0);
        assert.equal(seen[0].m, "USDT-ERC20"); assert.equal(seen[0].opts.maxGwei, 20);
        state.spike = false;
        r = await autopay.sendPayout({ payoutId: p.id, actorId: S });
        assert.equal(r.state, "paid"); assert.equal(seen.at(-1).units, 50000000n);

        const { rows: bad } = await db.query(`
            SELECT w.discord_id FROM wallets w
            LEFT JOIN (SELECT discord_id, sum(delta_cents) s FROM ledger WHERE bucket='earnings' GROUP BY 1) e ON e.discord_id=w.discord_id
            WHERE w.earnings_cents <> COALESCE(e.s,0)`);
        assert.deepEqual(bad, []);
        chain.setSender(null);
    });

    await test("profit split 7/7/1, withdrawals, deposit sources, analytics", async () => {
        const profit = require("../src/services/profit");
        const analytics = require("../src/services/analytics");
        // $100 job, worker 80, support 5, house 15 -> 7 + 7 + 1 buffer
        assert.deepEqual(profit.splitHouse({ houseCents: 1500, revenueCents: 10000, bufferPct: 1, partnerCount: 2 }), { buffer: 100, pool: 1400, each: 700, remainder: 0 });
        assert.equal(profit.splitHouse({ houseCents: 2000, revenueCents: 10000, bufferPct: 1, partnerCount: 2 }).each, 950);
        assert.equal(profit.splitHouse({ houseCents: 50, revenueCents: 10000, bufferPct: 1, partnerCount: 2 }).buffer, 50);

        await config.set("partner_ids", `${S},100000000000000088`);
        await config.set("house_buffer_pct", "1");
        const s1 = await profit.summary();
        assert.equal(s1.partners.length, 2);
        assert.ok(s1.each > 0 && s1.buffer > 0);
        await profit.withdraw({ partnerId: S, cents: 100, actorId: S, note: "test" });
        assert.equal((await profit.summary()).partners[0].taken, 100);
        await rejects(profit.withdraw({ partnerId: S, cents: 999999999, actorId: S }), "available");
        await rejects(profit.withdraw({ partnerId: "999", cents: 100, actorId: S }), "partner");

        await wallets.deposit({ discordId: C, cents: 1234, actorId: S, source: "paypal" });
        const a = await analytics.overview(30);
        assert.ok(a.jobs >= 1 && a.revenue > 0 && a.deposits.some(d => d.source === "paypal"));
        const ob = await profit.obligations();
        assert.ok(ob.earnings >= 0 && ob.customers > 0);
        assert.ok((await reports.exportCsv("monthly")).startsWith("month,jobs"));
    });

    await test("feedback: customer only, once, posts a vouch", async () => {
        const feedback = require("../src/utils/feedback");
        const orders = require("../src/utils/orders");
        await wallets.deposit({ discordId: C, cents: 5000, actorId: S });
        const posted = [];
        const mkCh = id => ({ id, send: async m => { posted.push({ ch: id, m }); return { id: "m" + posted.length }; }, messages: { fetch: async () => ({ edit: async () => {}, delete: async () => {} }) } });
        const client = { channels: { fetch: async id => mkCh(id) }, users: { fetch: async id => ({ username: "u" + id.slice(-2) }) } };
        await config.set("claim_channel_id", "C1"); await config.set("vouch_channel_id", "V1");
        const inter = {
            client, channelId: "T2", channel: mkCh("T2"), user: { id: S, username: "staff" },
            member: { roles: { cache: { has: () => false } } }, guild: null
        };
        const text = await orders.openOrder(inter, { customerId: C, customerName: "cust", priceCents: 1000, description: "do the thing" });
        assert.match(text, /Created order/);
        const jobId = Number(/#(\d+)/.exec(text)[1]);
        await jobs.claimJob({ jobId, workerId: W });
        await jobs.completeJob({ jobId, actorId: S });

        const modal = (userId, rating, review, anon) => ({
            client, user: { id: userId, username: "cust" }, guild: { name: "G", iconURL: () => null },
            fields: { getTextInputValue: id => id === "review" ? review : anon },
            isFromMessage: () => true, update: async () => {}, followUp: async () => {}, deferReply: async () => {}
        });
        await rejects(feedback.onModal(modal(W, "positive", "great", "no"), jobId, "positive"), "Only the customer");
        await feedback.onModal(modal(C, "positive", "great work", "yes"), jobId, "positive");
        const vouch = posted.find(p => p.ch === "V1");
        assert.ok(vouch && vouch.m.embeds[0].data.description.includes("Anonymous") && vouch.m.embeds[0].data.description.includes("great work"));
        await rejects(feedback.onModal(modal(C, "negative", "changed my mind", "no"), jobId, "negative"), "already");
        assert.equal((await db.query("SELECT count(*)::int n FROM job_feedback WHERE job_id=$1", [jobId])).rows[0].n, 1);
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

    await test("account sales: ids by creator, encrypted details, stock, undo", async () => {
        const acc = require("../src/services/accountsales");
        process.env.ACCOUNT_ENC_KEY = "test-key-test-key-test-key";
        const t1 = await acc.create({ creatorId: "1", creatorName: "Tony", type: "Main", title: "99 FM", description: "d", priceCents: 5000, stock: 2 });
        const t2 = await acc.create({ creatorId: "1", creatorName: "Tony", type: "Pure", title: "Pure", description: "d", priceCents: 9000 });
        const tr = await acc.create({ creatorId: "2", creatorName: "Trevor", type: "Main", title: "Main", description: "d", priceCents: 1000 });
        assert.deepEqual([t1.id, t2.id, tr.id], ["T001", "T002", "Tr001"]);
        await acc.setDetails("t001", "user: bob / pass: secret");
        const raw = (await db.query("SELECT details_enc FROM accounts WHERE id='T001'")).rows[0].details_enc;
        assert.ok(raw && !raw.includes("secret"));
        assert.equal(acc.readDetails(await acc.get("T001")), "user: bob / pass: secret");
        const s1 = await acc.recordSale({ id: "T001", buyerId: "9", soldCents: 4500, soldBy: "1" });
        assert.equal(s1.account.stock, 1);
        await acc.undoSale(s1.sale.id);
        assert.equal((await acc.get("T001")).stock, 2);
        await acc.recordSale({ id: "T001", buyerId: "9", soldCents: 5000, soldBy: "1" });
        const last = await acc.recordSale({ id: "T001", buyerId: "8", soldCents: 5000, soldBy: "1" });
        assert.equal(last.account.status, "sold");
        await rejects(acc.recordSale({ id: "T001", buyerId: "7", soldCents: 1, soldBy: "1" }), "sold out");
        assert.equal((await acc.addStock("T001", 1)).status, "available");
        const tot = await acc.totals();
        assert.equal(tot.count, 2); assert.equal(tot.revenue, 10000);
        await acc.remove("T002");
        await rejects(acc.get("T002"), "No account");
    });

    await test("worker deposits: tracked, shown on !w, gate claiming", async () => {
        const dep = require("../src/services/deposits");
        assert.equal(await dep.get("dw1"), 0);
        assert.equal(await dep.adjust({ discordId: "dw1", delta: 2500, actorId: "1" }), 2500);
        await rejects(dep.adjust({ discordId: "dw1", delta: -9999, actorId: "1" }), "only have");
        assert.equal(await dep.set({ discordId: "dw1", cents: 1000, actorId: "1" }), 1000);
        const stats = { asWorker: { orders: 0, completed: 0, cancelled: 0, in_progress: 0 }, asCustomer: { orders: 0, cancelled: 0 } };
        const l = wPrefix.buildLines({ tag: "<@1>", isWorker: true, wallet: { balance: 0, earnings: 0, spent: 0 }, earned: 0, rate: 0.18, stats, discountText: null, jobRoleNames: [], deposit: 1000 }).join("\n");
        assert.ok(l.includes("Deposit Paid") && l.includes("$10.00"));
        await wallets.deposit({ discordId: "dc1", cents: 5000, actorId: "1" });
        const { job } = await jobs.createJob({ customerId: "dc1", priceCents: 2000, depositCents: 5000, description: "x", createdBy: "1" });
        await rejects(jobs.claimJob({ jobId: job.id, workerId: "dw1" }), "deposit");
        await dep.adjust({ discordId: "dw1", delta: 4000, actorId: "1" });
        assert.equal((await jobs.claimJob({ jobId: job.id, workerId: "dw1" })).status, "claimed");
    });

    await test("account delivery DM layout", async () => {
        const { deliveryMessage } = require("../src/utils/accountCard");
        const config = require("../src/services/config");
        await config.set("sythe_vouch_url", "https://sythe.org/threads/x");
        await config.set("vouch_channel_id", "999");
        const m = await deliveryMessage({ account: { id: "T001" }, details: JSON.stringify({ login: "bob", password: "pw", recovery: "", pin: "2112", notes: "" }),
            buyerName: "Buyer", sellerName: "Blad", soldCents: 13200, guild: { name: "Wizards" } });
        const f = Object.fromEntries(m.embeds[0].data.fields.map(x => [x.name, x.value]));
        assert.equal(f["💰 Price"], "$132.00"); assert.equal(f["🔑 Password"], "pw"); assert.equal(f["🪪 Recovery Details"], "N/A");
        assert.equal(f["🔒 Bank Pin"], "2112"); assert.equal(f["👤 Seller"], "Blad");
        assert.ok(m.content.includes("Sythe Vouch Thread") && m.content.includes("<#999>"));
        assert.ok(m.embeds[0].data.footer.text.includes("Wizards"));
    });

    await test("/config: nice list, autocomplete, validation", async () => {
        const cfgCmd = require("../src/commands/config");
        const admin = { roles: { cache: { has: () => true } }, permissions: { has: () => true } };
        const run = (sub, opts) => new Promise(async (res, rej) => {
            const i = { member: admin, guild: { name: "G" }, options: { getSubcommand: () => sub, getString: n => opts[n] },
                reply: async m => res(m) };
            try { await cfgCmd.execute(i); } catch (e) { res({ error: e.message }); }
        });
        await run("set", { key: "worker_pct", value: "75" });
        const list = await run("list", {});
        const d = list.embeds[0].data.description;
        assert.ok(d.includes("**Channels**") && d.includes("Worker cut") && d.includes("75%") && d.includes("*not set*"));
        assert.ok((await run("set", { key: "worker_pct", value: "abc" })).error.includes("number"));
        assert.ok((await run("set", { key: "claim_channel_id", value: "nope" })).error.includes("ID"));
        let hits;
        await cfgCmd.autocomplete({ member: admin, options: { getFocused: () => "work" }, respond: async h => { hits = h; } });
        assert.ok(hits.some(h => h.value === "worker_pct"));
        await cfgCmd.autocomplete({ member: admin, options: { getFocused: () => "" }, respond: async h => { hits = h; } });
        assert.equal(hits.length, 25);
    });

    await test("request details: only the customer submits, only the requester views", async () => {
        const rd = require("../src/services/reqdetails");
        process.env.ACCOUNT_ENC_KEY = "test-key-test-key-test-key";
        const { job } = await jobs.createJob({ customerId: "rc1", priceCents: 0 + 100, depositCents: 0, description: "x", imageUrl: null, channelId: "chan-rd", createdBy: "1" }).catch(async () => {
            await wallets.deposit({ discordId: "rc1", cents: 1000, actorId: "1" });
            return jobs.createJob({ customerId: "rc1", priceCents: 100, depositCents: 0, description: "x", imageUrl: null, channelId: "chan-rd", createdBy: "1" });
        });
        await db.query("UPDATE jobs SET channel_id='chan-rd' WHERE id=$1", [job.id]);
        await jobs.claimJob({ jobId: job.id, workerId: "rw1" });
        const r = await rd.create({ channelId: "chan-rd", requestedBy: "staff1", customerId: "rc1" });
        await rejects(rd.view(r.id, { id: "staff1" }), "No details");
        await rejects(rd.submit({ id: r.id, userId: "someoneelse", details: {} }), "isn't for you");
        await rd.submit({ id: r.id, userId: "rc1", details: { client: "Runelite", username: "u", password: "hunter2", pin: "1234" } });
        await rejects(rd.submit({ id: r.id, userId: "rc1", details: {} }), "already");
        const raw = (await db.query("SELECT details_enc FROM account_requests WHERE id=$1", [r.id])).rows[0].details_enc;
        assert.ok(!raw.includes("hunter2"));
        assert.equal((await rd.view(r.id, { id: "staff1" })).details.password, "hunter2");
        await rejects(rd.view(r.id, { id: "rw1" }), "Only the person who requested");
        await rejects(rd.view(r.id, { id: "rc1" }), "Only the person who requested");
        await rejects(rd.view(r.id, { id: "boss" }), "Only the person who requested");
        assert.ok((await db.query("SELECT count(*)::int n FROM audit_log WHERE action='details.view'")).rows[0].n >= 1);
    });

    await test("mule locations: shared, replace by RSN, send as a card, remove", async () => {
        const loc = require("../src/services/locations");
        const png = Buffer.from("89504e470d0a1a0a", "hex");
        await loc.save({ discordId: "lw1", rsn: "Nazzaa", world: "308", location: "GE", image: png, imageType: "image/png" });
        await loc.save({ discordId: "lw2", rsn: "nazzaa", world: "327", location: "Varrock", image: png, imageType: "image/png" });
        await loc.save({ discordId: "lw2", rsn: "Ruzzl3k", world: "308", location: "GE", image: png, imageType: "image/png" });
        const list = await loc.list();
        assert.equal(list.length, 2);
        const n = list.find(l => l.rsn.toLowerCase() === "nazzaa");
        assert.equal(n.world, "327");
        const sendCmd = require("../src/commands/send_location");
        let sent, updated;
        await sendCmd.onSelect({
            customId: "loc_send:staff1", user: { id: "staff1" }, values: [String(n.id)],
            guild: { name: "G", iconURL: () => "http://i" },
            channel: { send: async m => { sent = m; } }, update: async m => { updated = m; }
        });
        const d = sent.embeds[0].data.description;
        assert.ok(d.includes("<@staff1>") && d.includes("327") && d.includes("Varrock") && d.includes("payment") && sent.files.length === 1);
        assert.ok(updated.components.length === 0);
        await rejects(sendCmd.onSelect({ customId: "loc_send:staff1", user: { id: "other" }, values: ["1"] }), "isn't yours");
        await loc.remove("NAZZAA");
        await rejects(loc.remove("Nazzaa"), "no saved location");
    });

    await test("/tier: set, replace, list, remove, drive discounts", async () => {
        const tierCmd = require("../src/commands/tier");
        const pricing = require("../src/services/pricing");
        const config = require("../src/services/config");
        const admin = { roles: { cache: { has: () => true } }, permissions: { has: () => true } };
        const run = (sub, o) => new Promise(async res => {
            const i = { member: admin, guild: { name: "G" }, options: { getSubcommand: () => sub, getRole: n => o[n] && { id: o[n] }, getNumber: n => o[n], getChannel: () => null },
                reply: async m => res(m) };
            try { await tierCmd.execute(i); } catch (e) { res({ error: e.message }); }
        });
        const before = (await pricing.tiers()).length;
        await run("set", { role: "r-nov", spend: 200, discount: 2 });
        await run("set", { role: "r-mag", spend: 1000, discount: 5 });
        await run("set", { role: "r-nov", spend: 180, discount: 2 });
        const t = await pricing.tiers();
        assert.equal(t.length, before + 2);
        assert.equal((await pricing.discountFor(250000)).role, "r-mag");
        assert.equal((await pricing.discountFor(18500)).role, "r-nov");
        const listed = await run("list", {});
        assert.ok(listed.embeds[0].data.description.includes("<@&r-nov> = 2%") && listed.embeds[0].data.description.includes("$1,000"));
        await run("remove", { role: "r-mag" });
        await run("remove", { role: "r-nov" });
        assert.equal((await pricing.tiers()).length, before);
        assert.ok((await run("remove", { role: "r-nov" })).error.includes("isn't a tier"));
    });

    await test("wallet migrate: balance, earnings, GP spend to USD, once only; /golive runs", async () => {
        await wallets.migrate({ discordId: "mig1", balanceCents: 5000, earningsCents: 1200, spentCents: 3600, actorId: "1" });
        const w = await wallets.getWallet("mig1");
        assert.equal(w.balance, 5000); assert.equal(w.earnings, 1200); assert.equal(w.spent, 3600);
        await rejects(wallets.migrate({ discordId: "mig1", balanceCents: 1, actorId: "1" }), "already been migrated");
        const walletsCmd = require("../src/commands/wallets");
        await config.set("gp_usd_rate", "0.18");
        const out = await new Promise(async res => {
            const o = { user: { id: "mig2", username: "x" }, spent_gp: 1000 };
            const i = { member: { roles: { cache: { has: () => true } }, permissions: { has: () => true } }, user: { id: "1" }, guild: null,
                options: { getSubcommand: () => "migrate", getUser: () => o.user, getNumber: n => o[n] ?? null, getString: () => null },
                reply: async m => res(m) };
            try { await walletsCmd.execute(i); } catch (e) { res({ error: e.message }); }
        });
        assert.ok(out.content && out.content.includes("$180.00"), JSON.stringify(out));
        assert.equal((await wallets.getWallet("mig2")).spent, 18000);
        const golive = require("../src/commands/golive");
        const g = await new Promise(async res => {
            const i = { member: { roles: { cache: { has: () => true } }, permissions: { has: () => true } }, guild: null, reply: async m => res(m) };
            try { await golive.execute(i); } catch (e) { res({ error: e.message }); }
        });
        assert.ok(g.embeds && g.embeds[0].data.description.includes("Go-live") === false && g.embeds[0].data.description.includes("/tier set"));
    });

    await test("wallet CSV import parsing", async () => {
        const { parseWalletCsv } = require("../src/utils/walletCsv");
        const csv = 'Discord ID,Balance USD,Earnings USD,Spent GP,Spent USD\n' +
            '111111111111111111,25.50,,1000,\n' +
            '222222222222222222,"1,200",10,,500\n' +
            '333333333333333333,5,,100,50\n' +
            'abc,1,,,\n' +
            '111111111111111111,3,,,\n' +
            '444444444444444444,,,,\n';
        const { rows, errors } = parseWalletCsv(csv, 0.18);
        assert.equal(rows.length, 2);
        assert.deepEqual([rows[0].balanceCents, rows[0].spentCents], [2550, 18000]);
        assert.deepEqual([rows[1].balanceCents, rows[1].earningsCents, rows[1].spentCents], [120000, 1000, 50000]);
        assert.equal(errors.length, 4);
        assert.ok(parseWalletCsv("a,b\n1,2", 0.18).errors[0].includes("discord_id"));
    });

    await test("payout wallet from xprv; several saved addresses, choose at cash-out", async () => {
        const { ethers } = require("ethers");
        const chainSvc = require("../src/services/chain");
        const root = ethers.HDNodeWallet.fromPhrase("test test test test test test test test test test test junk", "", "m/44'/60'/0'");
        const expected = ethers.HDNodeWallet.fromPhrase("test test test test test test test test test test test junk").address; // m/44'/60'/0'/0/0
        const saved = { k: process.env.PAYOUT_PRIVATE_KEY, x: process.env.PAYOUT_XPRV };
        try {
            delete process.env.PAYOUT_PRIVATE_KEY; chainSvc.setSender(null);
            process.env.PAYOUT_XPRV = root.extendedKey;
            assert.equal(chainSvc.address(), expected);
            assert.ok(chainSvc.configured());
            process.env.PAYOUT_XPRV_PATH = "0/1";
            assert.notEqual(chainSvc.address(), expected);
        } finally {
            delete process.env.PAYOUT_XPRV_PATH;
            if (saved.k === undefined) delete process.env.PAYOUT_PRIVATE_KEY; else process.env.PAYOUT_PRIVATE_KEY = saved.k;
            if (saved.x === undefined) delete process.env.PAYOUT_XPRV; else process.env.PAYOUT_XPRV = saved.x;
        }

        const U2 = "700000000000000001";
        await wallets.setPayoutAddress(U2, "USDT-ERC20", "0x" + "a".repeat(40));
        await wallets.setPayoutAddress(U2, "BTC", "bc1qexample0000000000000000000000000000");
        assert.equal((await wallets.listPayoutAddresses(U2)).length, 2);
        await db.query("INSERT INTO wallets (discord_id, earnings_cents) VALUES ($1, 5000) ON CONFLICT (discord_id) DO UPDATE SET earnings_cents=5000", [U2]);
        await rejects(payouts.requestPayout({ discordId: U2, cents: 1500, method: "LTC" }), "haven't saved");
        const p1 = await payouts.requestPayout({ discordId: U2, cents: 1500, method: "USDT-ERC20" });
        assert.equal(p1.method, "USDT-ERC20"); assert.equal(p1.address, "0x" + "a".repeat(40));
        await db.query("UPDATE payouts SET status='rejected' WHERE id=$1", [p1.id]);
        const p2 = await payouts.requestPayout({ discordId: U2, cents: 1500 });
        assert.equal(p2.method, "BTC");
        await wallets.removePayoutAddress(U2, "BTC");
        assert.equal((await wallets.getProfile(U2)).payout_method, "USDT-ERC20");
        await rejects(wallets.removePayoutAddress(U2, "BTC"), "don't have");
    });

    console.log(`\n${passed} tests passed${process.exitCode ? " (with failures)" : ""}`);
} finally {
    await db.close(); await pg.stop();
}
