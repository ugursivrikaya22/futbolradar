#!/usr/bin/env node
/**
 * OYUNCU ÖZELLİK PUANLARINI HESAPLA VE SAKLA.
 *
 * Build adımı. Üç çıktı üretir:
 *
 *   • `data/player-ratings.json` — tam blok (kategori başına girdi dökümü
 *     dahil). Statik sayfa üreticileri detay açılımını buradan basar.
 *   • `data/players.json` — her kayda KOMPAKT blok (`ratingScores`) ve
 *     `playerRatingUpdatedAt` eklenir; `/data/players.json` istemcinin
 *     yedek kaynağı olduğu için tablo API olmadan da dolu gelir.
 *   • `public/data/...` — aynı iki dosyanın yayın kopyası.
 *
 * ZAMAN DAMGASI GEREKSİZ YERE DEĞİŞMEZ. Her koşuda `updatedAt` yazmak,
 * içerik aynıyken bile 806 kaydı kirletir ve "son güncelleme" tarihini
 * anlamsızlaştırırdı. Damga yalnızca oyuncunun PUANLARI değiştiğinde
 * yenilenir; değişmediyse önceki damga korunur.
 *
 * Kullanım:
 *   node scripts/compute-player-ratings.mjs [--check]
 *
 * `--check` hiçbir dosya yazmaz, yalnızca kapsama raporu basar.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { getPlayers } = require("../services/playerService.js");
const { createRatingContextFactory } = require("../services/playerRatingService.js");
const { computePlayerRatingScores, RATING_CATEGORY_ORDER } = require("../services/playerRatingEngine.js");

const checkOnly = process.argv.includes("--check");
const retryBuffer = new Int32Array(new SharedArrayBuffer(4));

function readJson(relativePath, fallback) {
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    console.warn(`[player-ratings] ${relativePath} okunamadı: ${error.message}`);
    return fallback;
  }
}

function writeJson(relativePath, value) {
  const file = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const contents = `${JSON.stringify(value, null, 2)}\n`;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      fs.writeFileSync(file, contents, "utf8");
      return;
    } catch (error) {
      const retryable = ["UNKNOWN", "EBUSY", "EPERM"].includes(error && error.code);
      if (!retryable || attempt === 11) throw error;
      Atomics.wait(retryBuffer, 0, 0, 75 * (attempt + 1));
    }
  }
}

/** Damganın ne zaman yenileneceğine karar veren parmak izi. */
function fingerprint(scores) {
  const payload = RATING_CATEGORY_ORDER.map((key) => {
    const category = scores.categories[key];
    return [key, category.status, category.value, (category.inputs || []).map((item) => `${item.label}=${item.value}`).join("|")].join(":");
  }).join("~");
  return crypto.createHash("sha1").update(`${scores.scheme}|${scores.positionGroup}|${payload}`).digest("hex").slice(0, 16);
}

/**
 * İstemciye giden hafif biçim: değer + durum.
 *
 * Etiket ("Hücum") ve görünen metin ("Veri yetersiz") kayda YAZILMAZ; ikisi
 * de `scheme` + `status` üzerinden türetilebiliyor (bkz.
 * services/playerRatingView.js). 806 kayda sekiz kez etiket yazmak
 * `data/players.json`i 1.3 MB şişiriyordu — istemcinin indirdiği dosya bu.
 */
function compactScores(scores) {
  const base = {
    version: scores.version,
    scheme: scores.scheme,
    positionGroup: scores.positionGroup,
    status: scores.status,
    coverage: scores.coverage,
    updatedAt: scores.status === "computed" ? scores.updatedAt : null
  };

  // Hiçbir kategorisi hesaplanamayan kayıtta kategori sözlüğü yazılmaz:
  // sekiz kez "value: null, status: insufficient" yazmak 548 kayıtta yarım
  // megabayt eder ve görünüm katmanı eksik kategoriyi zaten "Veri yetersiz"
  // olarak çözüyor. Zaman damgası da yazılmaz — tarihlenecek bir puan yok.
  if (scores.status !== "computed") return base;

  const categories = {};
  for (const key of RATING_CATEGORY_ORDER) {
    const category = scores.categories[key];
    categories[key] = { value: category.value, status: category.status };
  }

  return { ...base, categories };
}

const rawPlayers = readJson("data/players.json", []);
if (!Array.isArray(rawPlayers) || !rawPlayers.length) {
  console.error("[player-ratings] data/players.json boş; adım atlandı.");
  process.exit(0);
}

const previousRatings = readJson("data/player-ratings.json", { players: {} });
const previousById = (previousRatings && previousRatings.players) || {};

const contextFor = createRatingContextFactory({
  archive: (readJson("data/historical-match-archive.json", { records: [] }) || {}).records || [],
  fixtures: (readJson("data/fixture-calendar.json", { matches: [] }) || {}).matches || [],
  standings: readJson("data/league-standings.json", {}),
  leagueLeaders: readJson("data/league-leaders.json", {}),
  now: new Date()
});

// Puan hesabı NORMALİZE kayıt üzerinden yapılır (mevki grubu, yaş ve
// istatistik alanları orada tek biçime iniyor); yazma ise HAM kayda,
// böylece dosyadaki elle kürasyonlu alanlar olduğu gibi kalır.
const normalized = getPlayers(rawPlayers);
const ratingsById = {};
const allScores = new Map();
const summary = { total: rawPlayers.length, computed: 0, insufficient: 0, categories: {}, changed: 0 };
for (const key of RATING_CATEGORY_ORDER) summary.categories[key] = { computed: 0, insufficient: 0, notApplicable: 0 };

normalized.forEach((player, index) => {
  const scores = computePlayerRatingScores(player, contextFor(player));
  const stamp = fingerprint(scores);
  const previous = previousById[player.id];

  if (previous && previous.fingerprint === stamp && previous.updatedAt) {
    scores.updatedAt = previous.updatedAt;
  } else if (scores.status === "computed") {
    // Damga yalnızca YAYIMLANAN bir puan değiştiğinde yenilenir. Hesaplanamayan
    // kayıtlar her koşuda "değişti" sayılsaydı, gösterilecek puanı olmayan 548
    // kayıt her build'de yeni bir tarih alır ve veri dosyası boş yere kirlenirdi.
    summary.changed += 1;
  }

  scores.fingerprint = stamp;
  // TAM BLOK YALNIZCA HESAPLANMIŞ KAYITLAR İÇİN SAKLANIR.
  //
  // Hiçbir kategorisi hesaplanamayan 548 kaydın "girdi dökümü" boş bir
  // iskeletten ibaret; hepsini yazmak dosyayı iki katına çıkarıyordu.
  // Etiket ve durum bilgisi zaten `data/players.json` içindeki kompakt
  // blokta duruyor, görünüm katmanı oradan okuyor.
  if (scores.status === "computed") ratingsById[player.id] = scores;

  if (scores.status === "computed") summary.computed += 1;
  else summary.insufficient += 1;
  allScores.set(player.id, scores);

  for (const key of RATING_CATEGORY_ORDER) {
    const category = scores.categories[key];
    if (category.status === "computed") summary.categories[key].computed += 1;
    else if (category.status === "not-applicable") summary.categories[key].notApplicable += 1;
    else summary.categories[key].insufficient += 1;
  }

  if (!checkOnly) {
    const record = rawPlayers[index];
    if (record && (record.id === player.id || !record.id)) {
      record.ratingScores = compactScores(scores);
      const stampedAt = scores.status === "computed" ? scores.updatedAt : null;
      record.playerRatingUpdatedAt = stampedAt;
      record.player_rating_updated_at = stampedAt;
    }
  }
});

const latestUpdate = Array.from(allScores.values())
  .map((scores) => Date.parse(scores.updatedAt))
  .filter((value) => Number.isFinite(value))
  .sort((a, b) => b - a)[0];

const output = {
  source: "futbolradar:player-rating-engine",
  version: 1,
  updatedAt: latestUpdate ? new Date(latestUpdate).toISOString() : new Date().toISOString(),
  playerCount: allScores.size,
  ratedPlayerCount: Object.keys(ratingsById).length,
  summary,
  players: ratingsById
};

if (!checkOnly) {
  writeJson("data/player-ratings.json", output);
  writeJson("data/players.json", rawPlayers);
  writeJson("public/data/player-ratings.json", output);
  writeJson("public/data/players.json", rawPlayers);
}

const line = RATING_CATEGORY_ORDER
  .map((key) => `${key}=${summary.categories[key].computed}`)
  .join(" ");
console.log(`[player-ratings] ${summary.computed}/${summary.total} oyuncuda puan hesaplandı (${summary.changed} kayıt güncellendi)`);
console.log(`[player-ratings] kategori kapsaması: ${line}`);
if (checkOnly) console.log("[player-ratings] --check: dosya yazılmadı.");
