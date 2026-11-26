/**
 * BOZUK OYUNCU ADI TESPİTİ + NOINDEX KAPISI TESTLERİ.
 *
 *   1. Dedektör: "Sami Bircan Ahmet" yakalanır (resmî kadro önerisiyle),
 *      doğru adlar ("Batuhan Yavuz", "Kartal Yılmaz", "Mohamed Ali") yakalanmaz,
 *      editörce doğrulanmış kayıtlar sezgisel kurallardan muaftır.
 *   2. Onay: yalnızca AYNI ad için geçerli; ad değişirse geçersiz.
 *   3. Depo: şüpheli adlı her oyuncunun profili ve karşılaştırma sayfaları
 *      noindex, site haritasında yok; rapor dosyası güncel.
 *   4. Üreticiler (TR, EN, karşılaştırma) kapıya bağlı.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { buildNameReviewReport, playerNameNeedsReview, reviewForPlayer, resetPlayerNameGate } from "./lib/playerNameGate.mjs";

const require = createRequire(import.meta.url);
const { reviewPlayerName } = require("../services/playerNameReview.js");
const root = process.cwd();
const official = ["Ahmet Sami Bircan", "Ugurcan Çakır"];
const p = (name, extra = {}) => ({ id: name.toLowerCase().replace(/\s+/g, "-"), name, fullName: name, currentTeam: "Takım", dataStatus: "provider", ...extra });

// 1) Dedektör
{
  const bad = reviewPlayerName(p("Sami Bircan Ahmet", { transferHistory: [{ toTeam: "Bircan Ahmet Sami" }] }), { officialNames: official });
  assert.ok(bad.blocking);
  assert.ok(bad.reasons.includes("official-order"));
  assert.equal(bad.suggestion, "Ahmet Sami Bircan");

  assert.ok(reviewPlayerName(p("Coskun Tosun Mustafa")).blocking, "Ad Soyad Ad (son sözcük verilen ad)");
  assert.ok(reviewPlayerName(p("Samet Kalkan Mehmet")).blocking, "verilen ad + soyad + verilen ad");

  for (const ok of ["Batuhan Yavuz", "Berke Baran", "Kartal Yılmaz", "Mohamed Ali", "Efe Berat Töruz", "A. E. Isik", "Victor Osimhen", "Ahmet Sami Bircan"]) {
    assert.equal(reviewPlayerName(p(ok), { officialNames: official }).blocking, false, `yanlış alarm: ${ok}`);
  }

  // Aynı takımda aynı sözcüklerin başka sıralamasıyla ikinci SAĞLAYICI kaydı.
  const verified = p("Hyeon-gyu Oh", { dataStatus: "verified" });
  const dup = p("Oh Hyeon-Gyu");
  assert.ok(reviewPlayerName(dup, { peers: [verified, dup] }).reasons.includes("duplicate-permutation"));
  assert.equal(reviewPlayerName(verified, { peers: [verified, dup] }).blocking, false, "doğrulanmış kayıt işaretlenmez");

  // Doğrulanmış kayıt yalnızca resmî kadro kuralına tabidir.
  assert.equal(reviewPlayerName(p("Coskun Tosun Mustafa", { dataStatus: "verified" })).blocking, false);
  assert.ok(reviewPlayerName(p("Sami Bircan Ahmet", { dataStatus: "verified" }), { officialNames: official }).blocking);

  // Boşluk yalnızca bilgi notudur; sayfayı etkilemez.
  const ws = reviewPlayerName(p("Taylan  Bulut"));
  assert.equal(ws.blocking, false);
  assert.ok(ws.notes.includes("whitespace"));
}

// 2) Onay yalnızca aynı ad için
{
  const clearedPath = path.join(root, "data", "player-name-cleared.json");
  const original = fs.readFileSync(clearedPath, "utf8");
  try {
    const target = { id: "sami-bircan-ahmet-besiktas", name: "Sami Bircan Ahmet" };
    fs.writeFileSync(clearedPath, JSON.stringify({ cleared: [target] }));
    resetPlayerNameGate();
    const players = JSON.parse(fs.readFileSync(path.join(root, "data", "players.json"), "utf8"));
    const player = players.find((row) => row.id === target.id);
    assert.ok(player, "örnek oyuncu veride olmalı");
    assert.equal(playerNameNeedsReview(player, root), false, "onaylı ad indekslenebilir");
    assert.equal(playerNameNeedsReview({ ...player, name: "Sami Bircan Ahmet ", fullName: "Sami Bircan Ahmet " }, root), true, "ad değişince onay geçersiz");
    assert.equal(reviewForPlayer(player, root).cleared, true);
  } finally {
    fs.writeFileSync(clearedPath, original);
    resetPlayerNameGate();
  }
}

// 3) Depo
const report = buildNameReviewReport(root);
const blocking = report.filter((row) => row.noindex);
assert.ok(blocking.some((row) => row.id === "sami-bircan-ahmet-besiktas"), "Sami Bircan Ahmet listede olmalı");
const stored = JSON.parse(fs.readFileSync(path.join(root, "data", "player-name-review.json"), "utf8"));
assert.deepEqual(stored.players, report, "data/player-name-review.json güncel değil: node scripts/audit-player-names.mjs");

const slugs = new Map(JSON.parse(fs.readFileSync(path.join(root, "data", "player-url-slugs.json"), "utf8")).entries.map((entry) => [entry.id, entry.slug]));
const sitemap = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
const robots = (file) => {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) return null;
  return (/<meta name="robots" content="([^"]*)"/.exec(fs.readFileSync(full, "utf8")) || [])[1] || "";
};
const compFiles = fs.readdirSync(path.join(root, "karsilastirma")).filter((f) => f.endsWith(".html"));
for (const row of blocking) {
  const slug = slugs.get(row.id);
  for (const file of [`futbolcu/${slug}.html`, `en/player/${slug}.html`, `oyuncular/${row.id}.html`]) {
    const directive = robots(file);
    if (directive !== null) assert.match(directive, /^noindex/, `${file} noindex olmalı (ad: ${row.name})`);
  }
  assert.ok(!sitemap.includes(`/futbolcu/${slug}<`), `${slug} site haritasında olmamalı`);
  for (const file of compFiles.filter((f) => f.startsWith(`${row.id}-vs-`) || f.endsWith(`-vs-${row.id}.html`))) {
    assert.match(robots(`karsilastirma/${file}`), /^noindex/, `karsilastirma/${file} noindex olmalı`);
    assert.ok(!sitemap.includes(`/karsilastirma/${file}<`), `${file} site haritasında olmamalı`);
  }
}

// 4) Üreticiler kapıya bağlı
for (const [file, needle] of [
  ["scripts/generate-player-profile-pages.mjs", "!playerNameNeedsReview(player, root)"],
  ["scripts/generate-en-player-pages.mjs", "!playerNameNeedsReview(player, root)"],
  ["scripts/generate-player-comparison-pages.mjs", "pairNeedsNameReview(pair) ? ROBOTS_NOINDEX_FOLLOW"]
]) {
  assert.ok(fs.readFileSync(path.join(root, file), "utf8").includes(needle), `${file} kapıya bağlı olmalı`);
}

console.log(`Oyuncu adı inceleme testleri geçti (${blocking.length} noindex, ${report.length - blocking.length} bilgi notu).`);
