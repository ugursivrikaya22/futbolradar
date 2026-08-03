/**
 * SEZON ARŞİVİ TESTLERİ
 *
 * Arşivin sözleşmesi dört cümle:
 *
 *   1. Sezon sınırı doğru: Temmuz'daki hazırlık maçı YENİ sezona sayılır.
 *      (Bu kural bir kez yanlış yazıldı — 0 tabanlı ay 7 Temmuz değil
 *      Ağustos — ve tüm Temmuz maçları bir önceki sezona düştü.)
 *   2. Arşiv yalnızca BİTMİŞ ve skoru olan maçı alır.
 *   3. Uydurma yok: veri olmayan yerde sayfa/bölüm üretilmez, boş kabuk
 *      açılmaz, bireysel golcü dökümü yayımlanmaz.
 *   4. Kadro BİRİKTİRİLİR: arşivlenen sezon kadrosu sonradan silinmez.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);

const {
  groupBySeason,
  isArchivable,
  matchesTeam,
  seasonOf,
  seasonSummary,
  slug,
  teamTable
} = require("../services/seasonArchive.js");
const { isAllowedSourceUrl } = require("../services/sourceLinks.js");

function match(overrides = {}) {
  return {
    id: "ornek",
    kickoff: "2026-08-20T21:00:00+03:00",
    homeTeam: "Galatasaray",
    awayTeam: "Fenerbahçe",
    status: "FINISHED",
    score: { home: 2, away: 1 },
    league: "Trendyol Süper Lig",
    ...overrides
  };
}

// ── 1. Sezon sınırı ────────────────────────────────────────────────────────
{
  assert.equal(seasonOf("2026-07-01"), "2026-2027", "Temmuz YENİ sezona sayılmalı");
  assert.equal(seasonOf("2026-06-30"), "2025-2026", "Haziran biten sezona ait");
  assert.equal(seasonOf("2026-08-14"), "2026-2027", "lig açılışı");
  assert.equal(seasonOf("2027-05-23"), "2026-2027", "lig kapanışı aynı sezon");
  assert.equal(seasonOf("2027-07-01"), "2027-2028", "sonraki sezon");
  assert.equal(seasonOf("okunmaz"), null, "geçersiz tarih sezon üretmemeli");
}

// ── 2. Yalnızca bitmiş ve skorlu maç arşive girer ──────────────────────────
{
  assert.equal(isArchivable(match()), true);
  assert.equal(isArchivable(match({ status: "SCHEDULED" })), false, "oynanmamış maç arşive girmemeli");
  assert.equal(isArchivable(match({ status: "LIVE" })), false, "devam eden maç arşive girmemeli");
  assert.equal(isArchivable(match({ score: null })), false, "skorsuz maç arşive girmemeli");
  assert.equal(isArchivable(match({ score: { home: 1, away: null } })), false, "yarım skor arşive girmemeli");
  assert.equal(isArchivable(match({ homeTeam: "" })), false, "takımsız kayıt arşive girmemeli");

  const grouped = groupBySeason([
    match({ id: "a", kickoff: "2026-07-14" }),
    match({ id: "b", kickoff: "2026-08-20T21:00:00+03:00" }),
    match({ id: "c", kickoff: "2026-05-10", status: "FINISHED" }),
    match({ id: "d", status: "SCHEDULED", kickoff: "2026-09-01" })
  ]);

  assert.deepEqual([...grouped.keys()].sort(), ["2025-2026", "2026-2027"]);
  assert.equal(grouped.get("2026-2027").length, 2, "Temmuz ve Ağustos aynı sezonda olmalı");
  assert.equal(grouped.get("2025-2026").length, 1);
  assert.ok(
    !grouped.get("2026-2027").some((entry) => entry.id === "d"),
    "oynanmamış maç sezona yazılmamalı"
  );
}

// ── 3. Takım bilançosu skordan doğrudan çıkar ──────────────────────────────
{
  const rows = teamTable([
    { homeTeam: "A", awayTeam: "B", score: { home: 2, away: 0 } },
    { homeTeam: "B", awayTeam: "A", score: { home: 1, away: 1 } },
    { homeTeam: "A", awayTeam: "C", score: { home: 0, away: 3 } }
  ]);

  const a = rows.find((row) => row.team === "A");
  assert.deepEqual(
    { p: a.played, w: a.won, d: a.drawn, l: a.lost, gf: a.goalsFor, ga: a.goalsAgainst, gd: a.goalDifference },
    { p: 3, w: 1, d: 1, l: 1, gf: 3, ga: 4, gd: -1 }
  );

  const b = rows.find((row) => row.team === "B");
  assert.equal(b.cleanSheets, 0, "B gol yemeden bitirmedi");
  const c = rows.find((row) => row.team === "C");
  assert.equal(c.cleanSheets, 1, "C deplasmanda gol yemeden kazandı");
}

// ── 4. BİREYSEL DÖKÜM YAYIMLANMAZ ──────────────────────────────────────────
//
// Gol olayları golcüyü yapılandırılmış alanda taşımıyor; serbest metinden
// isim ayıklayıp "gol kralı" ilan etmek veriyi aşan bir iddia olurdu.
{
  const summary = seasonSummary([
    { id: "x", homeTeam: "A", awayTeam: "B", score: { home: 3, away: 2 }, league: "Süper Lig", kickoff: "2026-08-20", reportPage: "mac-raporu/x.html" }
  ]);

  assert.equal(summary.individualStatsAvailable, false, "bireysel döküm yayımlanmamalı");
  assert.ok(summary.individualStatsNote, "gerekçe veride taşınmalı");
  assert.equal(summary.totalGoals, 5);
  assert.equal(summary.goalsPerMatch, 5);
  assert.equal(summary.matchCount, 1);

  const empty = seasonSummary([]);
  assert.equal(empty.goalsPerMatch, 0, "maç yokken sıfıra bölünmemeli");
  assert.equal(empty.highestScoring, null, "maç yokken en gollü maç uydurulmamalı");
}

// ── 4b. Eş adlar: bilanço kulübün diğer yazımını ıskalamamalı ──────────────
//
// Depoda aynı kulüp birden fazla adla geçiyor (kadro "Amed", künye "Amed
// Sportif Faaliyetler"). Düz eşitlikle süzülürse teknik direktör sayfası,
// maçlar KAYITLIYKEN "kayıtlı maç yok" derdi.
{
  const amed = { homeTeam: "Amed", awayTeam: "Konyaspor" };
  assert.equal(matchesTeam(amed, "Amed Sportif Faaliyetler", ["Amed"]), true, "eş ad eşleşmeli");
  assert.equal(matchesTeam(amed, "Amed Sportif Faaliyetler", []), false, "eş ad verilmeden eşleşmemeli");
  assert.equal(matchesTeam(amed, "Konyaspor"), true, "deplasman adı da eşleşmeli");
  assert.equal(matchesTeam(amed, "Amedspor", ["Diyarbekirspor"]), false, "yakın ad kendiliğinden eşleşmemeli");

  // Eş adı olan her kayıt gerçekten depodaki bir yazımı göstermeli; kimseye
  // ait olmayan bir takma ad sessizce yanlış maç toplayabilir.
  const doc = JSON.parse(fs.readFileSync(path.join(root, "data", "managers.json"), "utf8"));
  const claimed = new Map();
  for (const entry of doc.managers) {
    for (const name of [entry.team, ...(entry.teamAliases || [])]) {
      assert.ok(!claimed.has(name), `"${name}" iki kulübe birden atanmış (${claimed.get(name)} / ${entry.team})`);
      claimed.set(name, entry.team);
    }
  }

  // Lig kapsamı: 18 takımın tamamı ya kayıtlı ya da gerekçeli eksik listede.
  assert.equal(
    doc.managers.length + (doc.missingTeams || []).length,
    18,
    "Süper Lig 18 takım: kayıt + gerekçeli eksik toplamı tutmalı"
  );
}

// ── 5. Gerçek arşiv dosyası tutarlı ────────────────────────────────────────
{
  const file = path.join(root, "data", "season-archive.json");
  assert.ok(fs.existsSync(file), "data/season-archive.json üretilmiş olmalı");
  const archive = JSON.parse(fs.readFileSync(file, "utf8"));
  const seasons = Object.values(archive.seasons || {});
  assert.ok(seasons.length, "arşivde en az bir sezon olmalı");

  for (const entry of seasons) {
    assert.ok(entry.matchCount > 0, `${entry.season}: boş sezon kabuğu açılmamalı`);
    assert.equal(entry.matches.length, entry.matchCount, `${entry.season}: sayaç ile liste ayrışmamalı`);

    for (const row of entry.matches) {
      assert.equal(row.season, entry.season, `${row.id}: maç yanlış sezona yazılmış`);
      assert.ok(Number.isFinite(row.score.home) && Number.isFinite(row.score.away), `${row.id}: skor eksik`);
    }

    // Her teknik direktör kaydı KAYNAK taşımalı ve kaynak beyaz listede olmalı.
    for (const manager of entry.managers || []) {
      assert.ok(manager.source && manager.source.url, `${manager.manager}: kaynaksız kayıt arşivlenemez`);
      assert.ok(
        isAllowedSourceUrl(manager.source.url),
        `${manager.manager}: kaynak beyaz liste dışı (${manager.source.url})`
      );
      assert.ok(["confirmed", "reported"].includes(manager.confidence), `${manager.manager}: güven seviyesi geçersiz`);
    }
  }
}

// ── 6. Üretilen sayfalar: veri neyse o ─────────────────────────────────────
{
  const archive = JSON.parse(fs.readFileSync(path.join(root, "data", "season-archive.json"), "utf8"));
  const seasons = Object.values(archive.seasons || {});

  assert.ok(fs.existsSync(path.join(root, "arsiv.html")), "arşiv dizini sayfası üretilmeli");

  for (const entry of seasons) {
    const seasonFile = path.join(root, "arsiv", `sezon-${entry.season}.html`);
    assert.ok(fs.existsSync(seasonFile), `${entry.season}: sezon sayfası üretilmeli`);

    const html = fs.readFileSync(seasonFile, "utf8");
    assert.ok(html.includes('rel="canonical"'), "sezon sayfası canonical taşımalı");
    assert.ok(html.includes("application/ld+json"), "sezon sayfası yapılandırılmış veri taşımalı");
    assert.ok(html.includes(String(entry.summary.totalGoals)), "sezon sayfası gol sayısını göstermeli");

    // Her arşivlenen kadro için sayfa; sayfa sayısı veriyle eşleşmeli.
    for (const squad of entry.squads) {
      const squadFile = path.join(root, "arsiv", `kadro-${entry.season}-${slug(squad.teamName)}.html`);
      assert.ok(fs.existsSync(squadFile), `${squad.teamName}: kadro sayfası üretilmeli`);
    }

    // Kaynaklı her teknik direktör için sayfa.
    for (const manager of entry.managers || []) {
      const managerFile = path.join(root, "arsiv", `teknik-direktor-${entry.season}-${slug(manager.manager)}.html`);
      assert.ok(fs.existsSync(managerFile), `${manager.manager}: dönem sayfası üretilmeli`);
    }

    // Kaynağı olmayan takım için sayfa üretilMEMELİ.
    for (const missing of entry.missingManagerTeams || []) {
      const stray = fs.readdirSync(path.join(root, "arsiv"))
        .filter((name) => name.startsWith(`teknik-direktor-${entry.season}-`))
        .filter((name) => name.includes(slug(missing.team)));
      assert.equal(stray.length, 0, `${missing.team}: kaynaksız takım için sayfa üretilmemeli`);
    }
  }
}

// ── 7. Arşiv ana sayfadan ve menüden erişilebilir ──────────────────────────
{
  const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.ok(index.includes('href="./arsiv.html"'), "ana sayfada arşiv bağlantısı olmalı");
  assert.ok(index.includes('id="arsiv-girisi"'), "ana sayfada arşiv bölümü olmalı");

  const layout = fs.readFileSync(path.join(root, "scripts", "lib", "layout.mjs"), "utf8");
  assert.ok(/href:\s*"arsiv\.html"/.test(layout), "arşiv ana menüde olmalı");
}

console.log(
  "Sezon arşivi testleri geçti (sezon sınırı, bitmiş maç süzgeci, takım bilançosu, " +
  "bireysel döküm yasağı, kaynak zorunluluğu, sayfa-veri eşliği, ana sayfa erişimi)."
);
