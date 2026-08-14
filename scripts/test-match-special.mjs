#!/usr/bin/env node
/**
 * MAÇ DOSYASI — SÖZLEŞME DENETİMİ.
 *
 * Maç dosyası iki tür içeriği yan yana gösteriyor: OLGU (fikstür, kadro,
 * form) ve YORUM (taktik analiz, skor tahmini). Testlerin sıkıştırdığı soru
 * bu ayrımın korunup korunmadığı:
 *
 *   • Kadroda OLMAYAN bir oyuncu "kilit oyuncu" kartına girebilir mi?
 *   • Doğrulanmamış bir form, doğrulanmış gibi görünebilir mi?
 *   • Yarım çevrilmiş bir dosya yayına girebilir mi?
 *   • Fikstürde olmayan bir maç için dosya üretilebilir mi?
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();

const {
  MIN_MODULES,
  formFor,
  keyPlayersFor,
  localizeSpecial,
  sameTeam,
  selectMatchSpecial,
  squadHighlights,
  validateSpecial
} = require("../services/matchSpecial.js");

const sources = {
  specials: require(path.join(root, "data", "match-specials.json")),
  fixtures: require(path.join(root, "data", "fixture-calendar.json")),
  squads: require(path.join(root, "data", "super-lig-squads.json")),
  archive: require(path.join(root, "data", "season-archive.json"))
};

const MATCH_ID = "galatasaray-corum-fk-2026-08-14";

console.log("match-special");

// ── 1. Yayındaki dosya geçerli ve fikstürle uyumlu ────────────────────────
{
  const { special, rejected } = selectMatchSpecial(sources, { matchId: MATCH_ID });
  assert.equal(rejected.length, 0,
    `dosya elendi: ${rejected.map((row) => row.errors.join("; ")).join(" | ")}`);
  assert.ok(special, "yayındaki dosya üretilebilmeli");

  // FİKSTÜR VERİDEN GELİR, dosyadan değil: saat ve stat elle yazılmaz.
  assert.equal(special.fixture.homeTeam, "Galatasaray");
  assert.equal(special.fixture.awayTeam, "Çorum FK");
  assert.equal(special.fixture.venue, "Rams Park");
  assert.equal(special.fixture.round, 1);
  assert.match(special.fixture.kickoff, /^2026-08-14T21:30/);
  assert.ok(special.modules.length >= MIN_MODULES);
}

// ── 2. FİKSTÜRDE OLMAYAN MAÇ İÇİN DOSYA ÜRETİLMEZ ─────────────────────────
//
// Dosya, olmayan bir maçı varmış gibi gösteremez: saat, stat ve hafta
// bilgisi yalnızca fikstürden gelir.
{
  const verdict = validateSpecial({ matchId: "olmayan-mac", slug: "x", enSlug: "y" }, null);
  assert.equal(verdict.valid, false);
  assert.match(verdict.errors.join(" "), /fikstürde maç yok/);
}

// ── 3. KADRODA OLMAYAN OYUNCU KİLİT OYUNCU KARTINA GİREMEZ ────────────────
//
// Bir sezon önce ayrılmış futbolcuyu "kilit oyuncu" diye göstermek,
// okuyucuya yanlış kadro bilgisi vermenin en görünür biçimi.
{
  const squad = {
    players: [
      { name: "V. Osimhen", position: "Attacker" },
      { name: "B. Yılmaz", position: "Attacker" },
      { name: "A. Yilmaz", position: "Defender" },
      { name: "J. Yılmaz", position: "Defender" }
    ]
  };

  const picked = keyPlayersFor(squad, ["Victor Osimhen", "Barış Alper Yılmaz", "Ayrılmış Futbolcu"], 10);
  assert.deepEqual(picked.map((row) => row.name), ["V. Osimhen", "B. Yılmaz"],
    "kadroda olmayan ad listeye girmemeli, kısaltılmış ad eşleşmeli");

  // BELİRSİZ EŞLEŞME SAYILMAZ: yalnızca "Yılmaz" üç oyuncuya düşüyor.
  assert.deepEqual(keyPlayersFor(squad, ["Yılmaz"], 10), [],
    "birden çok adaya düşen ad eşleşme sayılmamalı");
}

// ── 4. Konuk takım için kadrodan DENGELİ seçki ────────────────────────────
{
  const { special } = selectMatchSpecial(sources, { matchId: MATCH_ID });
  const away = special.teams.away.keyPlayers;
  assert.ok(away.length > 0, "konuk takım için kilit oyuncu üretilmeli");

  // Her ad GERÇEKTEN kadroda olmalı.
  const squads = Array.isArray(sources.squads) ? sources.squads : Object.values(sources.squads);
  const corum = squads.find((team) => sameTeam(team.teamName, "Çorum FK"));
  const names = new Set((corum.players || []).map((player) => player.name));
  for (const player of away) {
    assert.ok(names.has(player.name), `${player.name}: Çorum kadrosunda yok`);
  }

  // Seçki tek hattan olmamalı: kaleci, savunma, orta saha, forvet.
  const positions = new Set(away.map((player) => player.position));
  assert.ok(positions.size >= 3, `seçki hatlara dağılmalı (${[...positions].join(", ")})`);

  // Boş kadroda seçki de boş: uydurma isim üretilmez.
  assert.deepEqual(squadHighlights({ players: [] }, 8), []);
}

// ── 5. FORMUN KAYNAĞI ETİKETLENİR ─────────────────────────────────────────
//
// Doğrulanmış arşivden gelen form ile editoryal girdi aynı görünümde
// sunulamaz: ikincisi olmayan bir doğrulama iddiası olurdu.
{
  const { special } = selectMatchSpecial(sources, { matchId: MATCH_ID });

  // Galatasaray'ın maçları arşivde var → doğrulanmış.
  assert.equal(special.teams.home.form.source, "verified");
  assert.ok(special.teams.home.form.matches.length > 0);
  for (const row of special.teams.home.form.matches) {
    assert.ok(["win", "draw", "loss"].includes(row.result));
    assert.ok(Number.isFinite(row.scored) && Number.isFinite(row.conceded));
  }

  // Çorum FK'nın maçı arşivde YOK → editoryal ve öyle işaretli.
  assert.equal(special.teams.away.form.source, "editorial",
    "arşivde kaydı olmayan takımın formu editoryal işaretlenmeli");
  assert.ok(special.teams.away.form.matches.length > 0);

  // Ne arşiv ne editoryal girdi varsa form BOŞ döner, uydurulmaz.
  const empty = formFor({ seasons: {} }, {}, "Bilinmeyen Takım", 5);
  assert.equal(empty.source, "none");
  assert.deepEqual(empty.matches, []);
}

// ── 6. YARIM ÇEVRİLMİŞ DOSYA YAYINA GİRMEZ ────────────────────────────────
{
  const fixture = { id: "x", homeTeam: "A", awayTeam: "B" };
  const base = {
    matchId: "x", slug: "a", enSlug: "b",
    title: { tr: "T", en: "T" }, lead: { tr: "L", en: "L" },
    modules: Array.from({ length: MIN_MODULES }, (_, index) => ({
      id: `m${index}`,
      slug: { tr: `s${index}`, en: `s${index}` },
      title: { tr: "B", en: "B" },
      sections: [{ body: { tr: "gövde", en: "body" } }]
    }))
  };
  assert.equal(validateSpecial(base, fixture).valid, true);

  // İngilizce gövdesi eksik modül.
  const halfTranslated = JSON.parse(JSON.stringify(base));
  delete halfTranslated.modules[0].sections[0].body.en;
  assert.equal(validateSpecial(halfTranslated, fixture).valid, false,
    "tek dilli modül yayına girmemeli");

  // Yinelenen modül adresi: biri diğerini ezerdi.
  const duplicateSlug = JSON.parse(JSON.stringify(base));
  duplicateSlug.modules[1].slug = duplicateSlug.modules[0].slug;
  assert.equal(validateSpecial(duplicateSlug, fixture).valid, false);
  assert.match(validateSpecial(duplicateSlug, fixture).errors.join(" "), /yinelenmiş/);

  // Modül sayısı yetersiz.
  const tooFew = { ...base, modules: base.modules.slice(0, MIN_MODULES - 1) };
  assert.equal(validateSpecial(tooFew, fixture).valid, false);
}

// ── 7. İKİ DİL, TEK DOSYA ─────────────────────────────────────────────────
{
  const { special } = selectMatchSpecial(sources, { matchId: MATCH_ID });
  const tr = localizeSpecial(special, "tr");
  const en = localizeSpecial(special, "en");

  // Modül KÜMESİ ve SIRASI aynı: iki sürüm aynı dosyadır, yalnızca dil değişir.
  assert.deepEqual(tr.modules.map((module) => module.id), en.modules.map((module) => module.id));
  assert.notEqual(tr.slug, en.slug, "iki dilin adresi ayrı olmalı");
  assert.notEqual(tr.title, en.title, "başlık çevrilmiş olmalı");

  for (const module of [...tr.modules, ...en.modules]) {
    assert.ok(module.title, `${module.id}: başlık boş`);
    assert.ok(module.slug, `${module.id}: adres boş`);
    assert.ok(module.sections.length > 0, `${module.id}: bölüm yok`);
    for (const section of module.sections) {
      assert.ok(section.body.length > 40, `${module.id}: gövde fazla kısa`);
    }
  }

  // Skor tahmini EDİTORYAL işaretli olmalı: doğrulanmış veri değil.
  const prediction = tr.modules.find((module) => module.id === "mac-tahmini");
  assert.ok(prediction, "maç tahmini modülü olmalı");
  assert.equal(prediction.editorial, true, "tahmin editoryal işaretlenmeli");
}

// ── 8. Yayındaki içerik hacimli — "kısa önizleme" değil ───────────────────
{
  const { special } = selectMatchSpecial(sources, { matchId: MATCH_ID });
  const tr = localizeSpecial(special, "tr");
  const words = tr.modules
    .flatMap((module) => module.sections.map((section) => section.body))
    .join(" ")
    .split(/\s+/).filter(Boolean).length;
  assert.ok(words >= 900, `Türkçe analiz en az 900 kelime olmalı (${words})`);

  const enWords = localizeSpecial(special, "en").modules
    .flatMap((module) => module.sections.map((section) => section.body))
    .join(" ").split(/\s+/).filter(Boolean).length;
  assert.ok(enWords >= 900, `İngilizce karşılık en az 900 kelime olmalı (${enWords})`);
  console.log(`  ok  analiz hacmi: TR ${words} kelime, EN ${enWords} kelime`);
}

// ── 9. Veri dosyası elle düzenleniyor — bozuk kayıt sessizce geçmesin ─────
{
  const payload = JSON.parse(fs.readFileSync(path.join(root, "data", "match-specials.json"), "utf8"));
  assert.ok(Array.isArray(payload.specials) && payload.specials.length > 0);

  for (const record of payload.specials) {
    const fixtures = Array.isArray(sources.fixtures) ? sources.fixtures : (sources.fixtures.matches || []);
    const fixture = fixtures.find((match) => match.id === record.matchId) || null;
    const verdict = validateSpecial(record, fixture);
    assert.equal(verdict.valid, true,
      `${record.matchId}: ${verdict.errors.join("; ")}`);
  }
}

console.log("match-special OK (9 bölüm)");
