#!/usr/bin/env node
/**
 * OYUNCU URL SLUG TABLOSU — `data/player-url-slugs.json`.
 *
 * Adres kalıcıdır: bir kez yayımlanan URL, yanlışsa da kalır. Bu yüzden
 * hangi oyuncunun hangi adresi aldığı ÇALIŞMA ZAMANINDA hesaplanmıyor;
 * bir dosyaya yazılıyor ki gözden geçirilebilsin, fark alınabilsin ve
 * bir sonraki koşuda sessizce değişmesin.
 *
 * Her satır kaynağını taşır:
 *   record           — kaydın kendi adı zaten tam ("Mauro Icardi")
 *   duplicate-record — aynı oyuncunun ikinci kaydından ("Victor Osimhen")
 *   derived          — maç olayı / haber etiketi / yapısal ad alanından
 *   record-fullname  — son çare, sağlayıcının yasal tam adı
 *
 * `--check` ile çalıştırıldığında dosyayı YAZMAZ, yalnızca diskteki hâliyle
 * karşılaştırır ve fark varsa sıfırdan farklı çıkar — derleme, gözden
 * geçirilmemiş bir adres değişikliğiyle ilerlemesin diye.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();

const { getPlayers } = require("../services/playerService.js");
const { annotateDuplicates } = require("../services/duplicatePlayerService.js");
const { buildFullNameMap, buildSlugMap } = require("../services/playerSlugService.js");

const OUTPUT = path.join(root, "data", "player-url-slugs.json");

function readJson(relativePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
  } catch {
    return fallback;
  }
}

/**
 * Tam adın okunabileceği YAPISAL kaynaklar.
 *
 * Liste açıkça yazılı: yeni bir dosya eklemek bilinçli bir karar olsun.
 * Serbest metin (haber gövdesi, analiz paragrafı) KASITLI OLARAK yok —
 * Türkçe tamlamalar ad sanılıp kalıcı bir yanlış adres üretiyordu.
 */
const STRUCTURED_SOURCES = [
  "data/match-specials.json",
  "data/official-lineup-alerts.json",
  "data/super-lig-squads.json",
  "data/post-match-reports.json",
  "data/season-archive.json",
  "data/teams.json",
  "data/match-analyses.json",
  "data/league-leaders.json",
  "data/international-squads.json",
  "data/historical-match-archive.json",
  "data/matches.json",
  "data/predicted-lineups.json",
  "data/motm-poll-pages.json"
];

const players = annotateDuplicates(getPlayers(readJson("data/players.json", [])));

const sources = {
  matches: readJson("data/matches.json", []),
  archive: (readJson("data/historical-match-archive.json", { records: [] }) || {}).records || [],
  news: readJson("data/news.json", []),
  transfers: readJson("data/transfers.json", []),
  structured: STRUCTURED_SOURCES.map((file) => readJson(file)).filter(Boolean)
};

const fullNames = buildFullNameMap(players, sources);
const slugs = buildSlugMap(players, fullNames);

const canonical = players.filter((player) => !player.isDuplicate);
const entries = canonical
  .filter((player) => slugs.has(player.id))
  .map((player) => ({
    id: player.id,
    name: player.name,
    fullName: fullNames.get(player.id).fullName,
    source: fullNames.get(player.id).source,
    slug: slugs.get(player.id)
  }))
  .sort((left, right) => left.slug.localeCompare(right.slug));

// Kopya kayıtlar kanonik kaydın adresine yönlendirilir; kendi adresleri yok.
const aliases = players
  .filter((player) => player.isDuplicate && slugs.has(player.canonicalId))
  .map((player) => ({ id: player.id, canonicalId: player.canonicalId }))
  .sort((left, right) => left.id.localeCompare(right.id));

const payload = {
  _comment: "Üretilmiş dosya — scripts/generate-player-url-slugs.mjs. Elle düzenlemeyin.",
  coverage: {
    players: players.length,
    canonical: canonical.length,
    withSlug: entries.length,
    duplicateAliases: aliases.length
  },
  entries,
  aliases
};

const serialized = `${JSON.stringify(payload, null, 2)}\n`;

if (process.argv.includes("--check")) {
  const current = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, "utf8") : "";
  if (current !== serialized) {
    console.error("[player-url-slugs] tablo güncel değil; `npm run generate:player-slugs` çalıştırın.");
    process.exitCode = 1;
  } else {
    console.log(`[player-url-slugs] güncel (${entries.length} adres).`);
  }
} else {
  fs.writeFileSync(OUTPUT, serialized, "utf8");
  console.log(`[player-url-slugs] ${entries.length}/${canonical.length} kanonik oyuncu tam isimli adres aldı; ` +
    `${aliases.length} kopya kayıt kanoniğe yönlendirilecek.`);
}
