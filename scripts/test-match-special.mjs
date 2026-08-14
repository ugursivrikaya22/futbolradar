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

  // KONUK TAKIMIN KAYNAĞI VERİYE GÖRE DEĞİŞİR, ETİKET HER ZAMAN DOĞRUDUR.
  //
  // Bu satır bir zamanlar "editorial" bekliyordu: Çorum FK'nın arşivde maçı
  // yoktu. Maç oynanıp arşive girince etiket haklı olarak "verified" oldu ve
  // test kırıldı — çünkü kuralı değil, verinin O ANKİ HÂLİNİ sabitlemişti.
  // Denetim artık kuralı sınıyor: etiket geçerli olmalı ve doğrulanmış
  // denen her satır gerçek sayı taşımalı.
  assert.ok(["verified", "editorial"].includes(special.teams.away.form.source),
    `beklenmeyen form kaynağı: ${special.teams.away.form.source}`);
  assert.ok(special.teams.away.form.matches.length > 0);
  if (special.teams.away.form.source === "verified") {
    for (const row of special.teams.away.form.matches) {
      assert.ok(Number.isFinite(row.scored) && Number.isFinite(row.conceded),
        "doğrulanmış form satırı gerçek skor taşımalı");
    }
  }

  // Arşivde HİÇ kaydı olmayan takım editoryal işaretlenir — kuralın kendisi.
  const editorialOnly = formFor({ seasons: {} }, { "Yeni Takım": [{ label: "Yeni Takım 1-0 X", result: "win" }] }, "Yeni Takım", 5);
  assert.equal(editorialOnly.source, "editorial",
    "arşivde kaydı olmayan ama editoryal girdisi olan takım editoryal işaretlenmeli");

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

// ── 10. ÜRETİLEN SAYFALAR: HER KART GERÇEK BİR SAYFAYA GİDER ─────────────
//
// Hub'daki kart listesi üretilen modül listesinden türetiliyor. Türetme
// bozulursa boş hedefe kart basılır — okuyucuya olmayan bir söz.
{
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "data", "match-special-pages.json"), "utf8"));
  assert.ok(Array.isArray(manifest) && manifest.length > 0, "sayfa listesi üretilmeli");

  for (const entry of manifest) {
    for (const locale of ["tr", "en"]) {
      const localized = entry.locales[locale];
      const hubPath = path.join(root, localized.hub);
      assert.ok(fs.existsSync(hubPath), `${localized.hub}: hub sayfası yok`);

      const hub = fs.readFileSync(hubPath, "utf8");
      const hrefs = [...hub.matchAll(/class="match-special__card[^"]*" href="\.\/([^"]+)"/g)].map((row) => row[1]);
      assert.equal(hrefs.length, localized.modules.length,
        `${localized.hub}: kart sayısı modül sayısıyla uyuşmuyor`);

      for (const href of hrefs) {
        const target = path.join(path.dirname(hubPath), href);
        assert.ok(fs.existsSync(target), `${localized.hub} → ${href}: hedef sayfa yok`);
        // Boş sayfa da kırık bağlantı sayılır.
        assert.ok(fs.readFileSync(target, "utf8").includes("<h1"), `${href}: sayfa gövdesiz`);
      }

      for (const module of localized.modules) {
        assert.ok(fs.existsSync(path.join(root, module.href)), `${module.href}: listede var, diskte yok`);
      }
    }

    // İki dil aynı sayıda sayfa üretir: "birebir aynı, yalnızca dil farklı".
    assert.equal(entry.locales.tr.modules.length, entry.locales.en.modules.length);
    assert.deepEqual(
      entry.locales.tr.modules.map((module) => module.id),
      entry.locales.en.modules.map((module) => module.id)
    );
  }
}

// ── 11. HİÇBİR SAYFADA `href="#"` VE YER TUTUCU YOK ──────────────────────
{
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "data", "match-special-pages.json"), "utf8"));
  const files = [];
  for (const entry of manifest) {
    for (const locale of ["tr", "en"]) {
      files.push(path.join(root, entry.locales[locale].hub));
      entry.locales[locale].modules.forEach((module) => files.push(path.join(root, module.href)));
    }
  }

  for (const file of files) {
    const html = fs.readFileSync(file, "utf8");
    const relative = path.relative(root, file);

    // Denetim GÖVDEYE bakar, sayfanın tamamına değil: ortak başlık arama
    // kutusu taşıyor ve onun `placeholder=` özniteliği "yer tutucu metin"
    // aramasına takılıyordu — gerçek bir sorun değil, kelime çakışması.
    const main = (html.match(/<main[\s\S]*?<\/main>/) || [""])[0];
    assert.ok(main, `${relative}: <main> bloğu yok`);
    assert.ok(!/href="#"/.test(main), `${relative}: href="#" var`);
    assert.ok(!/(lorem ipsum|TODO|PLACEHOLDER|yer tutucu)/i.test(main), `${relative}: yer tutucu metin var`);
    assert.match(html, /<link rel="canonical"/, `${relative}: canonical yok`);
    assert.match(html, /<meta name="description"/, `${relative}: açıklama yok`);
  }
}

// ── 12. KAYNAKLI MUHTEMEL 11, RESMÎ KADRODAN AYRI ───────────────────────
{
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "data", "match-special-pages.json"), "utf8"));
  const special = sources.specials.specials.find((row) => row.matchId === "galatasaray-corum-fk-2026-08-14");
  const probable = special && special.probableLineup;
  assert.equal(probable.players.length, 11, "muhtemel kadro tam 11 oyuncu olmalı");

  for (const entry of manifest) {
    for (const locale of ["tr", "en"]) {
      const module = entry.locales[locale].modules.find((row) => row.id === "ilk-11");
      assert.ok(module, `${locale}: ilk 11 modülü olmalı`);
      const html = fs.readFileSync(path.join(root, module.href), "utf8");

      assert.match(html, /data-match-lineups/, "istemci kancası olmalı");
      assert.match(html, /data-lineup-grid[^>]*hidden/, "ızgara kapalı doğmalı");
      assert.match(html, /data-probable-lineup/, `${locale}: muhtemel kadro katmanı olmalı`);
      assert.ok(html.includes(locale === "tr" ? "MUHTEMEL 11 — RESMÎ DEĞİL" : "PROBABLE XI — NOT OFFICIAL"));
      assert.ok(html.includes(locale === "tr" ? "A Spor&#039;un maç öncesi canlı yayınında aktardığı muhtemel 11" : "A Spor&#039;s live pre-match broadcast"));
      for (const player of probable.players) {
        assert.ok(html.includes(player.name), `${locale}: ${player.name} görünmeli`);
        const profile = player.profile[locale] || player.profile.tr;
        assert.ok(fs.existsSync(path.join(root, profile)), `${locale}: ${player.name} profil hedefi yok (${profile})`);
      }
      assert.match(html, /match-special__pitch-row is-4/, `${locale}: dörtlü savunma satırı yok`);
      assert.match(html, /match-special__probable-analysis/, `${locale}: taktik analiz yok`);
    }
  }

  const client = fs.readFileSync(path.join(root, "site.js"), "utf8");
  assert.match(client, /data\.confirmed && data\.confirmed\.home/, "resmî ev sahibi kadrosu kontrol edilmeli");
  assert.match(client, /show\(section, !homeOfficial\)/, "resmî kadro gelince muhtemel katman gizlenmeli");
}

// ── 13. ANA SAYFA KUTUSU: PENCERE VE BAĞLANTILAR ─────────────────────────
{
  const { PROMO_CLOSES_AFTER_MS, PROMO_MODULE_LIMIT, PROMO_OPENS_BEFORE_MS, matchSpecialPromoBlock, selectPromo } =
    await import("./lib/matchSpecialPromo.mjs");

  const manifest = JSON.parse(fs.readFileSync(path.join(root, "data", "match-special-pages.json"), "utf8"));
  const entry = manifest[0];
  const kickoff = Date.parse(entry.kickoff);

  assert.ok(selectPromo(manifest, kickoff - 60 * 60 * 1000), "maçtan bir saat önce kutu açık olmalı");
  assert.ok(selectPromo(manifest, kickoff + 60 * 60 * 1000), "maç sırasında kutu açık olmalı");

  // MAÇ BİTTİKTEN SONRA KUTU DÜŞER: bayat içeriği ana sayfada güncel gibi
  // göstermek, yer tutucu uydurmanın uzun ömürlü biçimi olurdu.
  assert.equal(selectPromo(manifest, kickoff + PROMO_CLOSES_AFTER_MS + 60000), null,
    "pencere kapandıktan sonra kutu basılmamalı");
  assert.equal(selectPromo(manifest, kickoff - PROMO_OPENS_BEFORE_MS - 60000), null,
    "pencere açılmadan kutu basılmamalı");

  for (const locale of ["tr", "en"]) {
    const block = matchSpecialPromoBlock(entry, { locale });
    assert.ok(block.includes(entry.homeTeam) && block.includes(entry.awayTeam));

    const hrefs = [...block.matchAll(/href="([^"]+)"/g)].map((row) => row[1]);
    assert.ok(hrefs.length > 1, `${locale}: kutuda bağlantı yok`);
    assert.ok(hrefs.length <= PROMO_MODULE_LIMIT + 2, `${locale}: kutuda modül sınırı aşıldı`);
    assert.match(block, /match-special-promo__breaking/, `${locale}: ana sayfa muhtemel 11 kartı yok`);
    assert.match(block, /data-lineup-promo/, `${locale}: ana sayfa kartı API kancasını taşımıyor`);

    // Ana sayfaya göre çözülen her adres diskte GERÇEKTEN var olmalı.
    const homeDir = locale === "en" ? path.join(root, "en") : root;
    for (const href of hrefs) {
      assert.ok(fs.existsSync(path.resolve(homeDir, href.split("#")[0])), `${locale}: ${href} hedefi yok`);
    }
  }

  // Kayıt olmadığında kutu boş dize döner (blok hiç basılmaz).
  assert.equal(matchSpecialPromoBlock(null, { locale: "tr" }), "");
  assert.equal(matchSpecialPromoBlock({ locales: {} }, { locale: "tr" }), "");
}

// ── 14. KUTU İKİ ANA SAYFADA DA VAR VE AYNI ───────────────────────────────
{
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "data", "match-special-pages.json"), "utf8"));
  const open = manifest.some((entry) => {
    const kickoff = Date.parse(entry.kickoff);
    return Date.now() >= kickoff - 10 * 24 * 60 * 60 * 1000 && Date.now() <= kickoff + 24 * 60 * 60 * 1000;
  });

  if (open) {
    for (const page of ["index.html", path.join("en", "index.html")]) {
      const html = fs.readFileSync(path.join(root, page), "utf8");
      assert.match(html, /<!-- match-special:start -->/, `${page}: maç dosyası kutusu yok`);
      assert.match(html, /match-special-promo__module/, `${page}: modül kartları yok`);
    }
    console.log("  ok  ana sayfa kutusu iki dilde de basılı");
  } else {
    console.log("  ok  penceresi açık dosya yok, ana sayfa kutusu beklenmiyor");
  }
}

console.log("match-special OK (14 bölüm)");
