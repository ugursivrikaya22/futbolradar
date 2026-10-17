#!/usr/bin/env node
/**
 * ORGANİK TRAFİK YAPISI — boş veri, doğrulama, özet, GA4 yanıt ayrıştırma.
 * Ağa çıkmaz (GA4 çağrısı sahte fetch ile).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EMPTY_ORGANIC_TRAFFIC, parseDailyReport, parseTopPagesReport, renderOrganicReport, summarizeOrganicTraffic, validateOrganicTraffic } from "./lib/organicTraffic.mjs";
import { buildReportRequests, fetchOrganicTraffic, readCredentials } from "./fetch-ga4-organic.mjs";

console.log("organic-traffic");
const root = process.cwd();

// 1. Depodaki dosya BOŞ ve geçerli; rapor "veri yok" der, sayı yazmaz.
{
  const stored = JSON.parse(fs.readFileSync(path.join(root, "data", "analytics", "organic-traffic.json"), "utf8"));
  assert.deepEqual(validateOrganicTraffic(stored), []);
  assert.equal(stored.configured, false);
  assert.deepEqual(stored.daily, []);
  assert.deepEqual(stored.topPages, []);
  const summary = summarizeOrganicTraffic(stored);
  assert.equal(summary.hasData, false);
  const text = renderOrganicReport(summary);
  assert.match(text, /Veri yok/);
  assert.ok(!/\b0 (oturum|ziyaretçi|kullanıcı)\b/.test(text), "veri yokken sıfır sayı yazılmamalı");
  assert.ok(/— \(veri yok\)/.test(text));
  assert.deepEqual(EMPTY_ORGANIC_TRAFFIC.daily, []);
  console.log("  ok  depodaki dosya boş ve geçerli; rapor 'veri yok' diyor, sıfır uydurmuyor");
}

// 2. Doğrulama kötü veriyi reddeder.
{
  const base = { version: 1, configured: true, daily: [{ date: "2026-10-01", sessions: 10, users: 8 }], topPages: [{ path: "/", sessions: 5 }] };
  assert.deepEqual(validateOrganicTraffic(base, { now: Date.parse("2026-10-16") }), []);
  const bad = (patch) => validateOrganicTraffic({ ...base, ...patch }, { now: Date.parse("2026-10-16") });
  assert.ok(bad({ daily: [{ date: "2026-13-01", sessions: 1, users: 1 }] }).length, "geçersiz tarih");
  assert.ok(bad({ daily: [{ date: "2026-10-01", sessions: -1, users: 1 }] }).length, "negatif oturum");
  assert.ok(bad({ daily: [{ date: "2026-10-01", sessions: 1.5, users: 1 }] }).length, "kesirli oturum");
  assert.ok(bad({ daily: [{ date: "2027-01-01", sessions: 1, users: 1 }] }).length, "gelecek tarih");
  assert.ok(bad({ daily: [{ date: "2026-10-01", sessions: 1, users: 1 }, { date: "2026-10-01", sessions: 2, users: 1 }] }).length, "tekrarlı gün");
  assert.ok(bad({ daily: [{ date: "2026-10-01", sessions: 5, users: 1, engagedSessions: 9 }] }).length, "etkileşimli > oturum");
  assert.ok(bad({ topPages: [{ path: "x", sessions: 1 }] }).length, "yol / ile başlamalı");
  assert.ok(bad({ topPages: [{ path: "/x", sessions: 1, engagementRate: 1.4 }] }).length, "oran 0-1");
  console.log("  ok  doğrulama: geçerli veri geçiyor, 8 bozuk durum reddediliyor");
}

// 3. Özet yalnızca eldeki günlerden hesaplanır; eksik gün sıfır sayılmaz.
{
  const daily = Array.from({ length: 10 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, "0")}`, sessions: 10 + i, users: 8 + i, engagedSessions: 5 }));
  const summary = summarizeOrganicTraffic({ source: "ga4-data-api", fetchedAt: "2026-10-11T00:00:00Z", daily, topPages: [{ path: "/a", sessions: 3 }, { path: "/b", sessions: 9 }] }, { days: 28 });
  assert.equal(summary.hasData, true);
  assert.equal(summary.coverageDays, 10);
  assert.equal(summary.requestedDays, 28);
  assert.equal(summary.organicSessions, daily.reduce((t, r) => t + r.sessions, 0));
  assert.equal(summary.peakDay.date, "2026-10-10");
  assert.equal(summary.previousPeriod, null, "önceki dönem verisi yoksa karşılaştırma uydurulmaz");
  assert.equal(summary.topPages[0].path, "/b");
  const text = renderOrganicReport(summary);
  assert.match(text, /10\/28 gün/);
  assert.match(text, /eksik günler sıfır sayılmadı/);
  const twoPeriods = summarizeOrganicTraffic({ daily: Array.from({ length: 56 }, (_, i) => ({ date: new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10), sessions: i < 28 ? 10 : 20, users: 5 })), topPages: [] }, { days: 28 });
  assert.equal(twoPeriods.previousPeriod.changePercent, 100);
  console.log("  ok  özet: kapsam günü açık, önceki dönem yoksa karşılaştırma yok, +%100 değişim doğru");
}

// 4. GA4 yanıt ayrıştırma + istek gövdesi + sahte fetch.
{
  const requests = buildReportRequests();
  assert.equal(requests.daily.dimensionFilter.filter.stringFilter.value, "Organic Search");
  assert.equal(requests.topPages.dimensionFilter.filter.stringFilter.value, "Organic Search");
  const daily = parseDailyReport({ rows: [{ dimensionValues: [{ value: "20261002" }], metricValues: [{ value: "7" }, { value: "6" }, { value: "4" }, { value: "5" }] }, { dimensionValues: [{ value: "20261001" }], metricValues: [{ value: "3" }, { value: "3" }, { value: "2" }, { value: "1" }] }] });
  assert.deepEqual(daily.map((r) => r.date), ["2026-10-01", "2026-10-02"]);
  assert.equal(daily[1].sessions, 7);
  const pages = parseTopPagesReport({ rows: [
    { dimensionValues: [{ value: "/mac/x?utm_source=g" }], metricValues: [{ value: "4" }, { value: "4" }, { value: "0.5" }, { value: "30" }] },
    { dimensionValues: [{ value: "/mac/x" }], metricValues: [{ value: "6" }, { value: "5" }, { value: "0.7" }, { value: "50" }] },
    { dimensionValues: [{ value: "(not set)" }], metricValues: [{ value: "9" }, { value: "9" }, { value: "0.1" }, { value: "1" }] }
  ] });
  assert.equal(pages.length, 1, "(not set) ve sorgu dizgisi ayrımı");
  assert.equal(pages[0].sessions, 10);
  assert.equal(pages[0].engagementRate, 0.62);

  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push(String(url));
    if (String(url).includes("oauth2")) return { ok: true, json: async () => ({ access_token: "t" }) };
    const body = JSON.parse(init.body);
    return { ok: true, json: async () => (body.dimensions[0].name === "date" ? { rows: [{ dimensionValues: [{ value: "20261001" }], metricValues: [{ value: "2" }, { value: "2" }, { value: "1" }, { value: "1" }] }] } : { rows: [{ dimensionValues: [{ value: "/" }], metricValues: [{ value: "2" }, { value: "2" }, { value: "0.5" }, { value: "10" }] }] }) };
  };
  const { privateKey } = (await import("node:crypto")).generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  const data = await fetchOrganicTraffic({ propertyId: "123", clientEmail: "a@b.iam.gserviceaccount.com", privateKey }, { fetchImpl: fakeFetch, now: new Date("2026-10-16T00:00:00Z") });
  assert.equal(calls.length, 3, "1 token + 2 rapor isteği");
  assert.ok(calls[1].includes("/properties/123:runReport"));
  assert.deepEqual(validateOrganicTraffic(data, { now: Date.parse("2026-10-16") }), []);
  assert.equal(data.daily[0].sessions, 2);

  const missing = readCredentials({});
  assert.equal(missing.propertyId, "");
  assert.equal(missing.privateKey, "");
  console.log("  ok  GA4: organik filtre, tarih/yol ayrıştırma, sahte fetch ile 3 çağrı, kimlik yokken boş");
}

console.log("organic-traffic: tamam");
