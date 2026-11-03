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

    console.log(`\n${passed} tests passed${process.exitCode ? " (with failures)" : ""}`);
} finally {
    await db.close(); await pg.stop();
}
