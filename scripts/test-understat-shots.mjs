#!/usr/bin/env node
/**
 * UNDERSTAT ŞUT VERİSİ — SÖZLEŞME TESTLERİ.
 *
 * Bu katmanın iki sessiz hata biçimi var ve ikisi de ekranda DOĞRU görünür:
 *
 *   1. YANLIŞ MAÇIN haritası basılır (rövanş, geçen sezon, benzer adlı
 *      kulüp). Okuyucu sahte bir maçı gerçek sanır.
 *   2. Bozuk bir koordinat sahanın dışına düşer ya da `NaN` olur.
 *
 * Testler bu iki kapıyı kilitliyor: eşleştirme üç şart birden ister,
 * ölçülemeyen kayıt elenir.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const understat = require(path.join(root, "services", "understatShots.js"));

let checks = 0;
const ok = (message) => { checks += 1; console.log(`  ok  ${message}`); };

/* ── 1. KAPSAM: yalnızca Understat'ın verdiği ligler ───────────────── */
{
  assert.equal(understat.understatLeagueFor("premier-league"), "EPL");
  assert.equal(understat.understatLeagueFor("la-liga"), "La_liga");
  assert.equal(understat.understatLeagueFor("serie-a"), "Serie_A");
  assert.equal(understat.understatLeagueFor("bundesliga"), "Bundesliga");
  assert.equal(understat.understatLeagueFor("ligue-1"), "Ligue_1");

  // KAPSAM DIŞI YARIŞMADA HİÇ İSTEK ATILMAMALI. Süper Lig ve kupalar
  // Understat'ta yok; `null` dönmesi "bu maçı sorma" demek.
  for (const outside of ["super-lig", "1-lig", "sampiyonlar-ligi", "avrupa-ligi", "konferans-ligi", "turkiye-kupasi", "", null, undefined]) {
    assert.equal(understat.understatLeagueFor(outside), null, `${outside}: kapsam dışı sayılmalı`);
  }
  ok("yalnızca beş büyük lig kapsamda; Süper Lig ve kupalar hiç sorulmuyor");
}

/* ── 2. ŞUT NORMALLEŞTİRME ─────────────────────────────────────────── */
{
  const raw = {
    minute: "16", result: "MissedShots", X: "0.7559999847412109", Y: "0.56",
    xG: "0.02283024787902832", player: "Antoine Semenyo", h_a: "h",
    situation: "OpenPlay", shotType: "RightFoot", h_team: "Bournemouth",
    a_team: "Arsenal", player_assisted: "Alex Scott"
  };
  const shot = understat.normalizeShot(raw);
  assert.equal(shot.outcome, "off");
  assert.equal(shot.side, "home");
  assert.equal(shot.team, "Bournemouth");
  assert.equal(shot.x, 75.6, "X 0-1'den 0-100'e ölçeklenmeli");
  assert.equal(shot.y, 56);
  assert.equal(shot.xg, 0.023);
  assert.equal(shot.minute, 16);
  assert.equal(shot.player, "Antoine Semenyo");
  assert.equal(shot.assist, "Alex Scott");

  // Sonuç eşlemesi
  const outcomeOf = (result) => understat.normalizeShot({ ...raw, result }).outcome;
  assert.equal(outcomeOf("Goal"), "goal");
  assert.equal(outcomeOf("SavedShot"), "on");
  assert.equal(outcomeOf("BlockedShot"), "blocked");
  assert.equal(outcomeOf("ShotOnPost"), "off");

  // KENDİ KALESİNE GOL HARİTAYA GİRMEZ: Understat bunu şutu çeken takımın
  // kaydı olarak tutuyor, haritada yanlış tarafta görünürdü.
  assert.equal(understat.normalizeShot({ ...raw, result: "OwnGoal" }), null);
  assert.equal(understat.normalizeShot({ ...raw, result: "Bilinmeyen" }), null);
  ok("şut kaydı bizim sözleşmemize doğru çevriliyor; kendi kalesine gol haritaya girmiyor");
}

/* ── 3. BOZUK KAYIT ELENİR ─────────────────────────────────────────── */
{
  const base = { result: "Goal", X: "0.5", Y: "0.5", h_a: "h", minute: "10" };
  assert.equal(understat.normalizeShot(null), null);
  assert.equal(understat.normalizeShot({ ...base, X: null }), null, "koordinatsız şut elenmeli");
  assert.equal(understat.normalizeShot({ ...base, Y: "" }), null);
  assert.equal(understat.normalizeShot({ ...base, X: "abc" }), null, "sayı olmayan koordinat elenmeli");
  assert.equal(understat.normalizeShot({ ...base, X: "1.8" }), null, "saha dışı koordinat elenmeli");
  assert.equal(understat.normalizeShot({ ...base, Y: "-0.2" }), null);
  assert.equal(understat.normalizeShot({ ...base, h_a: "x" }), null, "tarafı belirsiz şut elenmeli");

  // xG bir olasılık: 0-1 dışı bir değer ölçüm değildir ve taşınmaz.
  assert.equal(understat.normalizeShot({ ...base, xG: "1.4" }).xg, null);
  assert.equal(understat.normalizeShot({ ...base, xG: "-0.3" }).xg, null);
  assert.equal(understat.normalizeShot({ ...base, xG: null }).xg, null);
  assert.equal(understat.normalizeShot({ ...base, minute: "999" }).minute, null);
  ok("koordinatsız, saha dışı ve ölçek dışı kayıtlar eleniyor");
}

/* ── 4. MAÇ YÜKÜ: iki taraf birleşiyor, kronolojik sıralanıyor ─────── */
{
  const payload = {
    shots: {
      h: [{ result: "Goal", X: "0.9", Y: "0.5", h_a: "h", minute: "70", xG: "0.4" }],
      a: [
        { result: "SavedShot", X: "0.8", Y: "0.4", h_a: "a", minute: "12", xG: "0.1" },
        { result: "MissedShots", X: "0.7", Y: "0.3", h_a: "a", minute: "34" },
        { result: "OwnGoal", X: "0.1", Y: "0.5", h_a: "a", minute: "50" }
      ]
    }
  };
  const shots = understat.normalizeMatchShots(payload);
  assert.deepEqual(shots.map((s) => s.minute), [12, 34, 70], "kronolojik sıralanmalı (xG eğrisi kümülatif)");
  assert.equal(shots.length, 3, "kendi kalesine gol dışarıda kalmalı");
  assert.deepEqual(understat.normalizeMatchShots({}), []);
  assert.deepEqual(understat.normalizeMatchShots(null), []);
  ok("maç yükü tek listeye iniyor, kronolojik ve temiz");
}

/* ── 5. KULÜP ADI EŞLEŞTİRME ───────────────────────────────────────── */
{
  assert.equal(understat.sameClub("Wolverhampton Wanderers", "Wolverhampton"), true);
  assert.equal(understat.sameClub("Paris Saint Germain", "Paris Saint-Germain"), true);
  assert.equal(understat.sameClub("Bayern München", "Bayern Munich"), false, "farklı yazımlar zorlanmamalı");
  assert.equal(understat.sameClub("Real Sociedad", "Real Madrid"), false, "aynı önek farklı kulüp");
  assert.equal(understat.sameClub("Manchester United", "Manchester City"), false);
  assert.equal(understat.sameClub("", "Arsenal"), false);
  ok("kulüp eşleştirme yazım farkını tolere ediyor, farklı kulübü tutmuyor");
}

/* ── 6. FİKSTÜR EŞLEŞTİRME: ÜÇ ŞART BİRDEN ────────────────────────── */
{
  const dates = [
    { id: "1", isResult: true, h: { title: "Arsenal" }, a: { title: "Chelsea" }, goals: { h: "2", a: "1" }, datetime: "2026-09-12 19:00:00" },
    // Rövanş: aynı takımlar, BAŞKA gün.
    { id: "2", isResult: true, h: { title: "Chelsea" }, a: { title: "Arsenal" }, goals: { h: "0", a: "0" }, datetime: "2027-02-01 19:00:00" },
    { id: "3", isResult: false, h: { title: "Arsenal" }, a: { title: "Spurs" }, goals: null, datetime: "2026-09-13 19:00:00" }
  ];

  const found = understat.findMatch(dates, { homeTeam: "Arsenal", awayTeam: "Chelsea", day: "2026-09-12", score: { home: 2, away: 1 } });
  assert.equal(found.id, "1");

  // GÜN TUTMUYORSA EŞLEŞME YOK — rövanşın haritası bu maça basılamaz.
  assert.equal(understat.findMatch(dates, { homeTeam: "Arsenal", awayTeam: "Chelsea", day: "2026-11-20" }), null,
    "başka günün maçı eşleşmemeli");

  // EV SAHİBİ/DEPLASMAN TERSSE EŞLEŞME YOK.
  assert.equal(understat.findMatch(dates, { homeTeam: "Chelsea", awayTeam: "Arsenal", day: "2026-09-12" }), null);

  // OYNANMAMIŞ maç hiç aday değil.
  assert.equal(understat.findMatch(dates, { homeTeam: "Arsenal", awayTeam: "Spurs", day: "2026-09-13" }), null);

  // Saat dilimi kayması: bir gün önce/sonra tolere edilir.
  assert.equal(understat.findMatch(dates, { homeTeam: "Arsenal", awayTeam: "Chelsea", day: "2026-09-13" }).id, "1");

  assert.equal(understat.findMatch(dates, { homeTeam: "Arsenal", awayTeam: "Chelsea", day: null }), null);
  assert.equal(understat.findMatch([], { homeTeam: "Arsenal", awayTeam: "Chelsea", day: "2026-09-12" }), null);
  ok("fikstür eşleştirme ev/deplasman + gün şartını birden istiyor");
}

/* ── 7. GERÇEK DEPO: yazılmış her kayıt çizilebilir olmalı ─────────── */
{
  const storePath = path.join(root, "data", "understat-shots.json");
  if (!fs.existsSync(storePath)) {
    ok("depo henüz üretilmemiş (npm run sync:understat-shots) — denetim atlandı");
  } else {
    const store = JSON.parse(fs.readFileSync(storePath, "utf8"));
    const keys = Object.keys(store.matches || {});
    let shotCount = 0;
    let withXg = 0;

    for (const key of keys) {
      const record = store.matches[key];
      assert.ok(Array.isArray(record.shots) && record.shots.length, `${key}: şutsuz kayıt yazılmamalı`);
      for (const shot of record.shots) {
        shotCount += 1;
        assert.ok(Number.isFinite(shot.x) && shot.x >= 0 && shot.x <= 100, `${key}: saha dışı x`);
        assert.ok(Number.isFinite(shot.y) && shot.y >= 0 && shot.y <= 100, `${key}: saha dışı y`);
        assert.ok(["goal", "on", "off", "blocked"].includes(shot.outcome), `${key}: bilinmeyen sonuç`);
        assert.ok(["home", "away"].includes(shot.side), `${key}: taraf belirsiz`);
        assert.ok(shot.xg === null || (shot.xg >= 0 && shot.xg <= 1), `${key}: ölçek dışı xG`);
        assert.ok(shot.minute === null || (shot.minute >= 0 && shot.minute <= 130), `${key}: imkânsız dakika`);
        assert.ok(!/null|undefined|NaN/i.test(`${shot.player}${shot.team}`), `${key}: bozuk metin`);
        if (shot.xg !== null) withXg += 1;
      }
    }

    // Sayfa sicilinde olmayan bir maça kayıt yazılmamalı.
    const registry = JSON.parse(fs.readFileSync(path.join(root, "data", "match-seo-pages.json"), "utf8"));
    const rows = Array.isArray(registry) ? registry : registry.pages || registry.entries || [];
    const slugs = new Set(rows.map((entry) => entry.slug));
    for (const key of keys) {
      assert.ok(slugs.has(key), `${key}: sicilde olmayan maça şut kaydı yazılmış`);
    }
    ok(`depoda ${keys.length} maç / ${shotCount} şut; hepsi çizilebilir (${withXg} şutta xG)`);
  }
}

console.log(`\n[test-understat-shots] ${checks} denetim geçti.`);
