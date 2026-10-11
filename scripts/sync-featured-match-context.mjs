#!/usr/bin/env node
/**
 * ÖNE ÇIKARILAN MAÇ BAĞLAMI — SINIRLI SAĞLAYICI ÇEKİMİ.
 *
 * `data/featured-match-spotlight.json#featuredFixtures` içindeki her maç
 * için (takvimde API-Football kimliği ve iki takım kimliği varsa):
 *   /fixtures/headtohead?h2h=<ev>-<dep>&last=10   (1 istek)
 *   /fixtures?team=<ev>&last=10                    (1 istek)
 *   /fixtures?team=<dep>&last=10                   (1 istek)
 * Yalnızca maçtan en fazla 72 saat önce ve en sık 12 saatte bir; maç
 * başladıktan sonra hiç. Koşu başına üst sınır: MAX_FIXTURES × 3 istek.
 * Anahtar yoksa ya da sağlayıcı korumalı moddaysa hiçbir şey yazılmaz ve
 * var olan kayıt korunur (silinmez). İçerik değişmediyse dosya yazılmaz.
 *
 *   node scripts/sync-featured-match-context.mjs            # kuru koşu
 *   node scripts/sync-featured-match-context.mjs --apply
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const APPLY = process.argv.includes("--apply");
const NOW_ARG = (process.argv.find((arg) => arg.startsWith("--now=")) || "").slice(6);
const nowMs = NOW_ARG && Number.isFinite(Date.parse(NOW_ARG)) ? Date.parse(NOW_ARG) : Date.now();
const MAX_FIXTURES = 2;

const context = require("../services/featuredMatchContext.js");
const spotlight = require("../services/featuredMatchSpotlight.js");
const provider = require(process.env.FEATURED_CONTEXT_PROVIDER || "../services/providers/apiFootballProvider.js");

const CONFIG_PATH = path.join(root, "data", "featured-match-spotlight.json");
const CALENDAR_PATH = path.join(root, "data", "fixture-calendar.json");
const STORE_PATH = path.join(root, "data", "featured-match-context.json");

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

const config = readJson(CONFIG_PATH, {}) || {};
const settings = spotlight.withDefaults(config);
const calendar = readJson(CALENDAR_PATH, { matches: [] });
const calendarMatches = Array.isArray(calendar) ? calendar : (calendar.matches || []);
const store = readJson(STORE_PATH, null) || { version: 1, fixtures: {} };
store.fixtures = store.fixtures || {};

function targetFixtures() {
  const out = [];
  for (const match of calendarMatches) {
    if (!spotlight.featuredFixtureFor(match, settings.featuredFixtures)) continue;
    const providerFixtureId = match.providerIds && match.providerIds.apiFootball;
    if (!/^\d+$/.test(String(providerFixtureId || "")) || !/^\d+$/.test(String(match.homeTeamId || "")) || !/^\d+$/.test(String(match.awayTeamId || ""))) {
      console.log(`featured-match-context: ${match.id} sağlayıcı/takım kimliği eksik — atlandı.`);
      continue;
    }
    out.push({ id: match.id, providerFixtureId: String(providerFixtureId), homeTeam: match.homeTeam, awayTeam: match.awayTeam, homeTeamId: String(match.homeTeamId), awayTeamId: String(match.awayTeamId), kickoff: match.kickoff });
  }
  return out.slice(0, MAX_FIXTURES);
}

async function main() {
  const targets = targetFixtures();
  if (!targets.length) {
    console.log("featured-match-context: takvimde öne çıkarılan maç yok; istek atılmadı.");
    return;
  }
  const due = targets.map((fixture) => ({ fixture, decision: context.needsFetch(store.fixtures[fixture.providerFixtureId], fixture, nowMs) }));
  for (const { fixture, decision } of due) console.log(`featured-match-context: ${fixture.id} (${fixture.providerFixtureId}) → ${decision.fetch ? "çekilecek" : "atlandı"} [${decision.reason}]`);
  const toFetch = due.filter((item) => item.decision.fetch).map((item) => item.fixture);
  if (!toFetch.length) return;
  if (!APPLY) {
    console.log(`featured-match-context: kuru koşu — ${toFetch.length * context.REQUESTS_PER_FIXTURE} istek atılacaktı.`);
    return;
  }
  if (!provider.hasConfig()) {
    console.log("featured-match-context: APIFOOTBALL_API_KEY yok — istek atılmadı, kayıt korunuyor.");
    return;
  }

  let requests = 0;
  let changed = false;
  for (const fixture of toFetch) {
    try {
      const h2hPayload = await provider.providerFetch("/fixtures/headtohead", { h2h: `${fixture.homeTeamId}-${fixture.awayTeamId}`, last: 10 }); requests += 1;
      const homeLastPayload = await provider.providerFetch("/fixtures", { team: fixture.homeTeamId, last: 10, timezone: "Europe/Istanbul" }); requests += 1;
      const awayLastPayload = await provider.providerFetch("/fixtures", { team: fixture.awayTeamId, last: 10, timezone: "Europe/Istanbul" }); requests += 1;
      const next = context.buildContext({ fixture, h2hPayload, homeLastPayload, awayLastPayload, fetchedAt: new Date(nowMs).toISOString() });
      const previous = store.fixtures[fixture.providerFixtureId];
      // Boş yanıt dolu kaydı ezmez: sağlayıcı bir koşuda boş dönerse eldeki doğrulanmış satırlar kalır.
      if (previous && !next.last10.home.length && !next.last10.away.length && !next.h2h.length) {
        console.log(`featured-match-context: ${fixture.id} boş yanıt — önceki kayıt korunuyor.`);
        continue;
      }
      // Tazelik damgası her başarılı çekimde ilerler (12 saat kuralı bu
      // damgaya bakar); dosya en sık 12 saatte bir değişir.
      store.fixtures[fixture.providerFixtureId] = next;
      changed = true;
      console.log(`featured-match-context: ${fixture.id} — h2h ${next.h2h.length}, son maçlar ${next.last10.home.length}/${next.last10.away.length}.`);
    } catch (error) {
      console.log(`featured-match-context: ${fixture.id} çekilemedi (${error.code || error.message}) — kayıt korunuyor.`);
      if (error.code === "PROVIDER_RATE_LIMIT") break;
    }
  }
  console.log(`featured-match-context: ${requests} sağlayıcı isteği.`);
  if (!changed) return;
  store.version = 1;
  store._comment = "ÜRETİLİR — scripts/sync-featured-match-context.mjs. Öne çıkarılan maçların sağlayıcı (API-Football) son 10 maç ve ikili rekabet kayıtları. Elle düzenlemeyin.";
  store.updatedAt = new Date(nowMs).toISOString();
  const temp = `${STORE_PATH}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(store, null, 2)}\n`);
  fs.renameSync(temp, STORE_PATH);
}

main().catch((error) => {
  // Bu adım isteğe bağlıdır: hata güncellemeyi düşürmez, kayıt korunur.
  console.log(`featured-match-context: beklenmeyen hata (${error.message}) — kayıt korunuyor.`);
});
