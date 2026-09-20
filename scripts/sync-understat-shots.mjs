#!/usr/bin/env node
/**
 * UNDERSTAT ŞUT VERİSİ ÇEKİMİ — ŞUT HARİTASI VE xG EĞRİSİ İÇİN.
 *
 * Şut haritası, ana sağlayıcıda (API-Football) OLMAYAN tek şeye muhtaç:
 * şutun koordinatı. Understat bunu şut başına `X`/`Y`/`xG` olarak
 * yayımlıyor ama yalnızca BEŞ BÜYÜK LİG için. Bu betik, yalnızca o beş
 * ligdeki BİTMİŞ maçlarımız için veriyi çeker ve
 * `data/understat-shots.json` deposuna yazar; maç sayfası derlenirken
 * oradan okunur (bkz. scripts/generate-match-seo-pages.mjs#detailFor).
 *
 * İSTEK HACMİ BİLEREK ASGARİ:
 *   • Lig fikstürü lig başına TEK istek (`getLeagueData`).
 *   • Maç şutları maç başına TEK istek (`getMatchData`) ve BİR KEZ:
 *     bitmiş maçın şutları değişmez, depoda kayıt varsa tekrar istenmez.
 *   • İstekler arasında bekleme var; kaynak ücretsiz ve belgelenmemiş bir
 *     uç nokta, hızlı ardışık istekle yorulmamalı.
 *   • Çekim DERLEME anında; okuyucu isteğinde Understat'a hiç gidilmez.
 *
 * KAYNAK ERİŞİLEMEZSE HİÇBİR ŞEY KIRILMAZ: depo neyse o kalır, yeni
 * maçlarda şut haritası bölümü gizli doğar, betik 0 ile çıkar. Bu bir
 * ZENGİNLEŞTİRME katmanı; derlemeyi düşürmemeli.
 *
 * Kullanım:
 *   node scripts/sync-understat-shots.mjs            # eksikleri çeker
 *   node scripts/sync-understat-shots.mjs --limit=20 # en çok 20 maç
 *   node scripts/sync-understat-shots.mjs --refresh  # var olanı da tazeler
 *   node scripts/sync-understat-shots.mjs --dry-run  # istek atmaz, planı yazar
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const understat = require(path.join(root, "services", "understatShots.js"));

const STORE_PATH = path.join(root, "data", "understat-shots.json");
const BASE = "https://understat.com";
const SEASON = String(process.env.UNDERSTAT_SEASON || new Date().getFullYear());
const REQUEST_GAP_MS = 1500;
const TIMEOUT_MS = 30000;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const found = args.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.split("=")[1] : fallback;
};

const DRY_RUN = flag("dry-run");
const REFRESH = flag("refresh");
const LIMIT = Number(option("limit", "150"));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ */
/* AĞ                                                                  */
/* ------------------------------------------------------------------ */

/**
 * Understat JSON uç noktasını okur.
 *
 * Yanıt bazen gzip olarak geliyor ve `content-encoding` başlığı her zaman
 * doğru değil; bu yüzden gövde önce düz metin olarak denenir, olmazsa
 * gzip açılır. Başlıkları olmayan bir istek (Referer/XHR) uç noktadan
 * boş yanıt alıyor.
 */
async function fetchJson(pathname) {
  const url = `${BASE}/${pathname}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        Referer: `${BASE}/`
      }
    });
    if (!response.ok) throw new Error(`http ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    let body;
    try {
      body = buffer.toString("utf8");
      return JSON.parse(body);
    } catch {
      body = zlib.gunzipSync(buffer).toString("utf8");
      return JSON.parse(body);
    }
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* DEPO                                                                */
/* ------------------------------------------------------------------ */

function readStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    if (parsed && typeof parsed === "object" && parsed.matches) return parsed;
  } catch {
    /* Depo yoksa ilk koşuda oluşturulur. */
  }
  return { version: 1, source: "understat.com", updatedAt: null, matches: {} };
}

function writeStore(store) {
  store.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  fs.writeFileSync(STORE_PATH, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

/* ------------------------------------------------------------------ */
/* HEDEF MAÇLAR                                                        */
/* ------------------------------------------------------------------ */

function istanbulDay(value) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(parsed));
}

/**
 * Şut haritası hak eden maçlar: Understat'ın kapsadığı bir ligde,
 * OYNANMIŞ ve skoru belli olan sayfalarımız.
 *
 * Oynanmamış maç çekilmez (şutu yoktur); kapsam dışı yarışma hiç
 * sorulmaz — olmayan veriyi istemek, kaynağı boşuna yormaktır.
 */
function targets() {
  const registry = JSON.parse(fs.readFileSync(path.join(root, "data", "match-seo-pages.json"), "utf8"));
  const rows = Array.isArray(registry) ? registry : registry.pages || registry.entries || [];
  const now = Date.now();

  return rows
    .map((entry) => {
      const league = understat.understatLeagueFor(entry.competitionId);
      if (!league) return null;
      const kickoff = Date.parse(entry.kickoff);
      if (!Number.isFinite(kickoff)) return null;
      // Maç bitmemişse şutu da yoktur. İki saatlik pay, uzatmalı
      // karşılaşmanın da tamamlanmasına yeter.
      if (now - kickoff < 2 * 60 * 60 * 1000) return null;
      const day = istanbulDay(entry.kickoff);
      if (!day) return null;
      return {
        key: entry.slug,
        league,
        day,
        homeTeam: entry.homeTeam,
        awayTeam: entry.awayTeam,
        score: entry.score || null
      };
    })
    .filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* KOŞU                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  const store = readStore();
  const wanted = targets();
  const pending = wanted.filter((target) => REFRESH || !store.matches[target.key]);

  const byLeague = new Map();
  for (const target of pending) {
    if (!byLeague.has(target.league)) byLeague.set(target.league, []);
    byLeague.get(target.league).push(target);
  }

  console.log(`[understat] kapsanan yarışmalar: ${understat.supportedCompetitions().join(", ")}`);
  console.log(`[understat] hedef maç: ${wanted.length}; depoda yok: ${pending.length}; sezon: ${SEASON}`);

  if (DRY_RUN) {
    for (const [league, rows] of byLeague) console.log(`  ${league}: ${rows.length} maç`);
    console.log("[understat] --dry-run: istek atılmadı.");
    return;
  }
  if (!pending.length) {
    console.log("[understat] çekilecek yeni maç yok.");
    return;
  }

  let fetched = 0;
  let matched = 0;
  let unmatched = 0;
  let failed = 0;

  for (const [league, rows] of byLeague) {
    if (fetched >= LIMIT) break;

    let dates;
    try {
      const payload = await fetchJson(`getLeagueData/${league}/${SEASON}`);
      dates = payload && Array.isArray(payload.dates) ? payload.dates : [];
      await sleep(REQUEST_GAP_MS);
    } catch (error) {
      console.warn(`  ! ${league} fikstürü alınamadı (${error.message}) — bu lig atlandı.`);
      failed += 1;
      continue;
    }
    console.log(`  ${league}: ${dates.length} fikstür okundu, ${rows.length} maç aranıyor`);

    for (const target of rows) {
      if (fetched >= LIMIT) break;
      const found = understat.findMatch(dates, target);
      if (!found) {
        // Eşleşmeyen maç UYDURULMAZ: kaydı açılmaz, bölüm gizli kalır.
        unmatched += 1;
        continue;
      }
      try {
        const payload = await fetchJson(`getMatchData/${found.id}`);
        const shots = understat.normalizeMatchShots(payload);
        fetched += 1;
        await sleep(REQUEST_GAP_MS);
        if (!shots.length) { unmatched += 1; continue; }
        store.matches[target.key] = {
          understatId: String(found.id),
          league,
          fetchedAt: new Date().toISOString(),
          shots
        };
        matched += 1;
        console.log(`    ✓ ${target.key} — ${shots.length} şut`);
      } catch (error) {
        failed += 1;
        console.warn(`    ! ${target.key} alınamadı (${error.message})`);
      }
    }
  }

  writeStore(store);
  console.log(`[understat] ${matched} maç yazıldı, ${unmatched} eşleşmedi/şutsuz, ${failed} hata; depoda toplam ${Object.keys(store.matches).length} maç.`);
}

main().catch((error) => {
  // ZENGİNLEŞTİRME DERLEMEYİ DÜŞÜRMEZ. Kaynak erişilemezse sayfa bugünkü
  // hâliyle üretilir, şut haritası bölümü gizli kalır.
  console.warn(`[understat] çekim tamamlanamadı: ${error.message}`);
  process.exitCode = 0;
});
