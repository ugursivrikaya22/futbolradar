/** Haftalık bülten: içerik, render, gönderim tekilleştirme, uç nokta ve cron testleri. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const content = require("../services/newsletter/content");
const render = require("../services/newsletter/render");
const config = require("../services/newsletter/config");
const { runWeekly } = require("../services/newsletter/weekly");
const { handleNewsletter, normalizeEmail } = require("../server/newsletterRoute");
const { JOBS } = require("../server/cronRoute");

const NOW = Date.parse("2026-10-26T06:00:00Z"); // Pazartesi 09:00 TSİ
const sources = {
  calendar: { matches: [
    { competitionId: "super-lig", league: "Süper Lig", status: "FINISHED", providerStatus: "FT", kickoff: "2026-10-24T19:00:00+03:00", homeTeam: "Galatasaray", awayTeam: "Fenerbahçe", score: { home: 2, away: 1 } },
    { competitionId: "super-lig", league: "Süper Lig", status: "FINISHED", kickoff: "2026-10-12T19:00:00+03:00", homeTeam: "Eski", awayTeam: "Maç", score: { home: 1, away: 0 } },
    { competitionId: "premier-league", league: "Premier League", status: "FINISHED", kickoff: "2026-10-25T19:00:00+03:00", homeTeam: "Arsenal", awayTeam: "Chelsea", score: { home: 1, away: 1 } },
    { competitionId: "super-lig", league: "Süper Lig", status: "SCHEDULED", kickoff: "2026-10-25T19:00:00+03:00", homeTeam: "Beşiktaş", awayTeam: "Trabzonspor", score: { home: null, away: null } },
    { competitionId: "super-lig", league: "Süper Lig", status: "FINISHED", kickoff: "2026-10-25T16:00:00+03:00", homeTeam: "Skor", awayTeam: "Yok", score: { home: null, away: 0 } }
  ] },
  archive: { records: [{ match: { league: "Süper Lig", status: "FINISHED", kickoff: "2026-10-24T19:00:00+03:00", homeTeam: "Galatasaray", awayTeam: "Fenerbahçe", score: { home: 2, away: 1 } } }] },
  standings: { "super-lig": { updatedAt: "2026-10-25T21:00:00Z", table: [
    { rank: 2, team: "Fenerbahçe", points: 18, played: 9 }, { rank: 1, team: "Galatasaray", points: 22, played: 9, goalDifference: 10 }, { rank: 3, team: "Şüpheli", points: 1, needsReview: true }
  ] } },
  columnsJson: { columns: [
    { slug: "yeni", title: "Yeni <yazı>", date: "2026-10-25T10:00:00+03:00", status: "published", excerpt: "Özet" },
    { slug: "taslak", title: "Taslak", date: "2026-10-25T10:00:00+03:00", status: "draft" },
    { slug: "gelecek", title: "Gelecek", date: "2026-11-25T10:00:00+03:00", status: "published" }
  ] },
  supabaseColumns: [{ slug: "supa", title: "Supabase yazısı", excerpt: "x", url: "/kose-yazilari/supa.html", published_at: "2026-10-24T10:00:00Z" }]
};

test("içerik: yalnızca son 7 günün bitmiş, tam skorlu Süper Lig maçları; tekilleştirilir", () => {
  const issue = content.buildIssue(sources, { now: NOW, site: "https://www.futbolradar.com" });
  assert.deepEqual(issue.results.map((r) => `${r.homeTeam} ${r.home}-${r.away} ${r.awayTeam}`), ["Galatasaray 2-1 Fenerbahçe"]);
  assert.deepEqual(issue.standings.rows.map((r) => r.team), ["Galatasaray", "Fenerbahçe"]);
  assert.deepEqual(issue.columns.map((c) => c.slug), ["yeni", "supa"]);
  assert.equal(issue.columns[1].href, "https://www.futbolradar.com/kose-yazilari/supa.html");
  assert.equal(issue.key, "superlig-2026-W44");
  assert.equal(issue.empty, false);
});

test("render: HTML kaçışlı, çıkış bağlantısı, düz metin sürümü", () => {
  const issue = content.buildIssue(sources, { now: NOW, site: "https://www.futbolradar.com" });
  const html = render.renderHtml(issue, { name: "<b>Ali</b>", unsubscribeUrl: "https://x/u?token=abc" });
  assert.ok(!html.includes("<b>Ali</b>") && html.includes("&lt;b&gt;Ali"));
  assert.ok(html.includes("Yeni &lt;yazı&gt;"));
  assert.ok(html.includes("https://x/u?token=abc") && html.includes("Abonelikten tek tıkla çık"));
  assert.ok(html.includes('lang="tr"') && html.includes("max-width:600px"));
  const text = render.renderText(issue, { unsubscribeUrl: "https://x/u" });
  assert.match(text, /Galatasaray 2-1 Fenerbahçe/);
  assert.match(text, /Abonelikten çık: https:\/\/x\/u/);
});

test("gönderim kapısı: bayrak/anahtar/gönderen olmadan kuru çalışma, hiçbir istek yok", async () => {
  let calls = 0;
  const fetcher = async () => { calls += 1; throw new Error("ağ yok"); };
  for (const env of [{}, { NEWSLETTER_ENABLED: "1" }, { NEWSLETTER_ENABLED: "1", RESEND_API_KEY: "re_x" }, { RESEND_API_KEY: "re_x", NEWSLETTER_FROM: "a@b.co" }]) {
    const r = await runWeekly({ env, now: NOW, fetcher, sources });
    assert.equal(r.status, "dry-run");
  }
  assert.equal(calls, 0);
  assert.equal(config.sendingEnabled({ NEWSLETTER_ENABLED: "1", RESEND_API_KEY: "re_x", NEWSLETTER_FROM: "a@b.co" }), true);
});

function fakeStore(n) {
  const subs = Array.from({ length: n }, (_, i) => ({ id: i + 1, email: `u${i + 1}@ornek.com`, name: "Ad", unsubscribe_token: `tok${i + 1}`.padEnd(24, "x") }));
  const sends = new Map();
  return {
    sends,
    isConfigured: () => true,
    listConfirmed: async () => subs,
    sentIds: async () => new Set([...sends.keys()]),
    claim: async (key, ids) => ids.filter((id) => { if (sends.has(id)) return false; sends.set(id, "sending"); return true; }),
    mark: async (key, ids, s) => ids.forEach((id) => (s === "failed" ? sends.delete(id) : sends.set(id, s)))
  };
}
const ENV = { NEWSLETTER_ENABLED: "1", RESEND_API_KEY: "re_test", NEWSLETTER_FROM: "FutbolRadar <bulten@futbolradar.com>" };

test("gönderim: ≤100'lük partiler, List-Unsubscribe başlığı, tekrar çalıştırma çift göndermez", async () => {
  const store = fakeStore(250);
  const batches = [];
  const fetcher = async (url, opts) => {
    assert.equal(url, "https://api.resend.com/emails/batch");
    assert.ok(opts.headers["Idempotency-Key"]);
    const body = JSON.parse(opts.body);
    batches.push(body);
    return { ok: true, status: 200, text: async () => JSON.stringify({ data: body.map((_, i) => ({ id: `m${i}` })) }) };
  };
  const r1 = await runWeekly({ env: ENV, now: NOW, fetcher, sources, store, sleep: async () => {} });
  assert.equal(r1.status, "complete"); assert.equal(r1.sent, 250);
  assert.deepEqual(batches.map((b) => b.length), [100, 100, 50]);
  const first = batches[0][0];
  assert.match(first.headers["List-Unsubscribe"], /^<https:\/\/www\.futbolradar\.com\/api\/newsletter\?action=unsubscribe&token=tok1/);
  assert.equal(first.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.ok(first.text && first.html && first.subject.includes("Süper Lig"));
  const r2 = await runWeekly({ env: ENV, now: NOW, fetcher, sources, store, sleep: async () => {} });
  assert.equal(r2.sent, 0); assert.equal(batches.length, 3);
});

test("gönderim: başarısız parti talebi bırakır, sonraki deneme yalnızca onları gönderir", async () => {
  const store = fakeStore(150);
  let fail = true; const sentTo = [];
  const fetcher = async (url, opts) => {
    const body = JSON.parse(opts.body);
    if (fail && body[0].to[0] === "u101@ornek.com") return { ok: false, status: 422, text: async () => "{\"message\":\"bad\"}" };
    body.forEach((e) => sentTo.push(e.to[0]));
    return { ok: true, status: 200, text: async () => JSON.stringify({ data: [] }) };
  };
  const r1 = await runWeekly({ env: ENV, now: NOW, fetcher, sources, store, sleep: async () => {} });
  assert.equal(r1.status, "partial"); assert.equal(r1.sent, 100); assert.equal(r1.failed, 50);
  fail = false;
  const r2 = await runWeekly({ env: ENV, now: NOW, fetcher, sources, store, sleep: async () => {} });
  assert.equal(r2.sent, 50);
  assert.equal(new Set(sentTo).size, 150); assert.equal(sentTo.length, 150);
});

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: "", setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b || ""; this.ended = true; } };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (p) => { res.body = JSON.stringify(p); res.ended = true; return res; };
  return res;
}
let ipCounter = 0;
function req(method, url, body) { ipCounter += 1; return { method, url, body, headers: { "x-forwarded-for": `10.0.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`, "content-type": "application/json" } }; }
function routeStore() {
  const calls = [];
  return { calls, isConfigured: () => true, findByEmail: async () => null, insertPending: async (r) => calls.push(["insert", r]), refreshPending: async () => {}, confirm: async (t) => t === "a".repeat(43), unsubscribe: async () => true };
}

test("uç nokta: bal küpü ve hızlı gönderim sessizce yutulur", async () => {
  const store = routeStore(); const sent = [];
  const resendStub = { sendOne: async (m) => sent.push(m) };
  for (const body of [{ name: "Ali", email: "ali@ornek.com", consent: true, website: "spam" }, { name: "Ali", email: "ali@ornek.com", consent: true, t: Date.now() }]) {
    const res = mockRes();
    await handleNewsletter(req("POST", "/api/newsletter", body), res, { env: ENV, store, resend: resendStub });
    assert.equal(res.statusCode, 200);
  }
  assert.equal(store.calls.length, 0); assert.equal(sent.length, 0);
});

test("uç nokta: doğrulama, rıza zorunlu, kapalıyken 503, çift onay e-postası", async () => {
  const store = routeStore(); const sent = [];
  const resendStub = { sendOne: async (m) => sent.push(m) };
  const call = async (body, env = ENV) => { const res = mockRes(); await handleNewsletter(req("POST", "/api/newsletter", body), res, { env, store, resend: resendStub }); return res; };
  assert.equal((await call({ name: "Ali", email: "bozuk" })).statusCode, 400);
  assert.equal((await call({ name: "A", email: "ali@ornek.com", consent: true })).statusCode, 400);
  assert.equal((await call({ name: "Ali", email: "ali@ornek.com" })).statusCode, 400);
  assert.equal((await call({ name: "Ali", email: "ali@ornek.com", consent: true }, {})).statusCode, 503);
  const ok = await call({ name: "Ali", email: " Ali@Ornek.com ", consent: true, t: Date.now() - 10000 });
  assert.equal(ok.statusCode, 200);
  assert.equal(store.calls.length, 1);
  const rec = store.calls[0][1];
  assert.equal(rec.email, "ali@ornek.com"); assert.equal(rec.consentVersion, config.CONSENT_VERSION); assert.match(rec.confirmHash, /^[0-9a-f]{64}$/);
  assert.equal(sent.length, 1); assert.match(sent[0].text, /action=confirm&token=/);
  assert.ok(!JSON.stringify(rec).includes(sent[0].text.match(/token=([^\s]+)/)[1]), "ham onay belirteci saklanmamalı");
});

test("uç nokta: onay ve tek tıkla çıkış; abone listesi okunamaz", async () => {
  const store = routeStore();
  let res = mockRes(); await handleNewsletter(req("GET", `/api/newsletter?action=confirm&token=${"a".repeat(43)}`), res, { env: ENV, store });
  assert.equal(res.statusCode, 303); assert.equal(res.headers.location, "/bulten.html?durum=onaylandi");
  res = mockRes(); await handleNewsletter(req("GET", `/api/newsletter?action=confirm&token=${"b".repeat(43)}`), res, { env: ENV, store });
  assert.equal(res.headers.location, "/bulten.html?durum=gecersiz");
  res = mockRes(); await handleNewsletter(req("POST", `/api/newsletter?action=unsubscribe&token=${"c".repeat(30)}`, "List-Unsubscribe=One-Click"), res, { env: ENV, store });
  assert.equal(res.statusCode, 200);
  res = mockRes(); await handleNewsletter(req("GET", "/api/newsletter"), res, { env: ENV, store });
  assert.equal(res.statusCode, 405);
});

test("e-posta doğrulama", () => {
  assert.equal(normalizeEmail("a.b+c@ornek.com.tr"), "a.b+c@ornek.com.tr");
  for (const bad of ["", "a@b", "a@@b.com", "a b@c.com", "x".repeat(250) + "@a.com", "<s>@a.com"]) assert.equal(normalizeEmail(bad), null, bad);
});

test("cron: newsletter işi kayıtlı, Pazartesi 06:00 UTC takvimi, CRON_SECRET'sız 401", async () => {
  assert.ok(JOBS.has("newsletter"));
  const crons = JSON.parse(fs.readFileSync("vercel.json", "utf8")).crons;
  assert.ok(crons.some((c) => c.path === "/api/cron/newsletter" && c.schedule === "0 6 * * 1"));
  const { handleCron } = require("../server/cronRoute");
  const res = mockRes();
  await handleCron({ method: "GET", url: "/api/cron/newsletter", headers: {} }, res, { env: {} });
  assert.equal(res.statusCode, 401);
});

test("migrasyon: idempotent, RLS açık, anon erişimi yok", () => {
  const sql = fs.readFileSync("supabase/migrations/0016_newsletter.sql", "utf8");
  assert.ok(!/create table (?!if not exists)/i.test(sql));
  assert.match(sql, /alter table newsletter_subscribers enable row level security/);
  assert.match(sql, /alter table newsletter_sends enable row level security/);
  assert.ok(!/create policy/i.test(sql));
  assert.match(sql, /primary key \(issue_key, subscriber_id\)/);
});

test("abonelik sayfası: form alanları, bal küpü, rıza metni", async () => {
  const { renderPage } = await import("../scripts/generate-newsletter-page.mjs");
  const html = renderPage();
  for (const s of ['name="name"', 'name="email"', 'name="website"', 'name="consent"', "newsletter.js", 'lang="tr"']) assert.ok(html.includes(s), s);
  assert.ok(html.includes("tek tıkla"));
});
