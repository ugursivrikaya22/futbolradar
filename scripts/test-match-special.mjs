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

/** Üreticinin kaçışıyla aynı: aranan metin sayfada kaçırılmış hâliyle duruyor. */
function escapeForHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

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
  //
  // Stat adı SABİT YAZILMAZ, takvim kaydıyla karşılaştırılır. Sağlayıcı aynı
  // stadı zaman içinde farklı yazabiliyor ("Rams Park" → "Rams Park
  // Stadyumu") ve beklenen değeri teste gömmek, kuralı değil o günkü yazımı
  // ölçmek olurdu — sınanmak istenen şey stadın adı değil, stat bilgisinin
  // maç dosyasına ELLE değil VERİDEN gelmesi.
  const calendarMatch = (sources.fixtures.matches || []).find((row) => row.id === MATCH_ID);
  assert.ok(calendarMatch, "takvim kaydı bulunmalı");
  assert.equal(special.fixture.homeTeam, "Galatasaray");
  assert.equal(special.fixture.awayTeam, "Çorum FK");
  assert.equal(special.fixture.venue, calendarMatch.venue);
  assert.ok(special.fixture.venue, "stat bilgisi boş kalmamalı");
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

  // Denetim HER dosyanın KENDİ kadrolarına bakar. Önceden tek maç dosyası
  // vardı ve test, Galatasaray – Çorum kadrosunu bütün kayıtlarda arıyordu;
  // ikinci dosya eklenir eklenmez kırıldı — kural bozulduğu için değil,
  // denetim tek kayda göre yazıldığı için.
  let checkedLineups = 0;
  let checkedUnconfirmed = 0;

  for (const entry of manifest) {
    const record = sources.specials.specials.find((row) => row.matchId === entry.matchId);
    assert.ok(record, `${entry.matchId}: kayıt bulunmalı`);
    const lineups = Array.isArray(record.probableLineups)
      ? record.probableLineups
      : (record.probableLineup ? [record.probableLineup] : []);
    assert.ok(lineups.length, `${entry.matchId}: en az bir muhtemel kadro paneli olmalı`);

    for (const locale of ["tr", "en"]) {
      const module = entry.locales[locale].modules.find((row) => row.id === "ilk-11");
      assert.ok(module, `${locale}: ilk 11 modülü olmalı`);
      const html = fs.readFileSync(path.join(root, module.href), "utf8");

      assert.match(html, /data-match-lineups/, "istemci kancası olmalı");
      assert.match(html, /data-lineup-grid[^>]*hidden/, "ızgara kapalı doğmalı");
      assert.match(html, /data-probable-lineup/, `${locale}: muhtemel kadro katmanı olmalı`);

      // Her panel KENDİ takımını ilan etmeli: istemci, resmî kadro gelince
      // hangi paneli kaldıracağını buradan biliyor.
      const panels = html.match(/data-lineup-team="[^"]*"/g) || [];
      assert.equal(panels.length, lineups.length,
        `${entry.matchId} ${locale}: panel sayısı kadro sayısıyla eşleşmeli`);

      for (const probable of lineups) {
        if (probable.status === "unconfirmed") {
          checkedUnconfirmed += 1;
          // EN KRİTİK KURAL: doğrulanmamış panelde oyuncu adı GEÇMEZ.
          assert.ok(!Array.isArray(probable.players) || !probable.players.length,
            `${entry.matchId}: doğrulanmamış kadroda oyuncu listelenmiş`);
          assert.ok(html.includes(locale === "tr" ? "HENÜZ DOĞRULANMADI" : "NOT YET CONFIRMED"),
            `${entry.matchId} ${locale}: doğrulanmamış kadro rozeti yok`);
          assert.match(html, /match-special__probable-pending/,
            `${entry.matchId} ${locale}: doğrulanmamış kadro paneli yok`);
          // Diziliş de bir iddia: kadro yokken diziliş yazılmaz.
          assert.ok(!probable.formation, `${entry.matchId}: doğrulanmamış kadroda diziliş yazılmış`);
          continue;
        }

        checkedLineups += 1;
        assert.equal(probable.players.length, 11, `${entry.matchId}: muhtemel kadro tam 11 oyuncu olmalı`);
        assert.ok(html.includes(locale === "tr" ? "MUHTEMEL 11 — RESMÎ DEĞİL" : "PROBABLE XI — NOT OFFICIAL"));
        const sourceLabel = probable.sourceLabel[locale] || probable.sourceLabel.tr;
        assert.ok(html.includes(escapeForHtml(sourceLabel)),
          `${entry.matchId} ${locale}: kadronun kaynağı sayfada görünmeli`);
        for (const player of probable.players) {
          assert.ok(html.includes(escapeForHtml(player.name)), `${locale}: ${player.name} görünmeli`);
          const profile = player.profile[locale] || player.profile.tr;
          assert.ok(fs.existsSync(path.join(root, profile)), `${locale}: ${player.name} profil hedefi yok (${profile})`);
        }
        assert.match(html, /match-special__pitch-row is-4/, `${locale}: dörtlü savunma satırı yok`);
        assert.match(html, /match-special__probable-analysis/, `${locale}: taktik analiz yok`);
      }
    }
  }

  assert.ok(checkedLineups > 0, "en az bir kaynaklı muhtemel kadro denetlenmeli");
  assert.ok(checkedUnconfirmed > 0, "en az bir doğrulanmamış kadro paneli denetlenmeli");
  console.log(`  ok  ${checkedLineups} kaynaklı kadro, ${checkedUnconfirmed} doğrulanmamış panel`);

  const client = fs.readFileSync(path.join(root, "site.js"), "utf8");
  assert.match(client, /data\.confirmed && data\.confirmed\.home/, "resmî ev sahibi kadrosu kontrol edilmeli");
  // Panel artık KENDİ takımının resmî kadrosuna bakıyor: iki panelli sayfada
  // ev sahibi açıklandığında deplasmanın hâlâ geçerli muhtemel 11'i silinmemeli.
  assert.match(client, /data-lineup-team/, "panel kendi takımını bildirmeli");
  assert.match(client, /show\(section, team \? !mine : !homeOfficial\)/,
    "panel önce kendi takımına, ad yoksa ev sahibine bakmalı");
}

// ── 13. ANA SAYFA KUTUSU: PENCERE VE BAĞLANTILAR ─────────────────────────
{
  const {
    PROMO_CLOSES_AFTER_MS, PROMO_MAX_CARDS, PROMO_MODULE_LIMIT, PROMO_OPENS_BEFORE_MS,
    matchSpecialPromoBlock, selectPromo, selectPromos
  } = await import("./lib/matchSpecialPromo.mjs");

  const manifest = JSON.parse(fs.readFileSync(path.join(root, "data", "match-special-pages.json"), "utf8"));
  const entry = manifest.find((row) => row.homepagePromo !== false);
  assert.ok(entry, "ana sayfada gösterilebilir en az bir dosya olmalı");
  const kickoff = Date.parse(entry.kickoff);

  // PENCERE TEK KAYIT ÜZERİNDE ÖLÇÜLÜR. Manifesto birden çok dosya taşıyor
  // ve biri kapanırken diğeri hâlâ açık olabiliyor; pencere kuralını tüm
  // liste üzerinden sınamak, aslında "hiç açık dosya kalmadı mı" sorusunu
  // sorardı — sınanmak istenen kural bu değil.
  const single = [entry];
  assert.ok(selectPromo(single, kickoff - 60 * 60 * 1000), "maçtan bir saat önce kutu açık olmalı");
  assert.ok(selectPromo(single, kickoff + 60 * 60 * 1000), "maç sırasında kutu açık olmalı");

  // MAÇ BİTTİKTEN SONRA KUTU DÜŞER: bayat içeriği ana sayfada güncel gibi
  // göstermek, yer tutucu uydurmanın uzun ömürlü biçimi olurdu.
  assert.equal(selectPromo(single, kickoff + PROMO_CLOSES_AFTER_MS + 60000), null,
    "pencere kapandıktan sonra kutu basılmamalı");
  assert.equal(selectPromo(single, kickoff - PROMO_OPENS_BEFORE_MS - 60000), null,
    "pencere açılmadan kutu basılmamalı");

  // ── ÇOKLU KART: SAYI SINIRI, ÖNCELİK VE EDİTORYAL KAPATMA ──────────────
  {
    const now = Date.parse("2026-08-15T12:00:00+03:00");
    const open = selectPromos(manifest, now);
    assert.ok(open.length <= PROMO_MAX_CARDS, `ana sayfada en çok ${PROMO_MAX_CARDS} kart olmalı`);
    assert.ok(open.every((row) => row.homepagePromo !== false),
      "editoryal olarak kapatılmış dosya ana sayfaya basılmamalı");

    // Öncelik saatten önce gelir: 21:30'daki Fenerbahçe maçı, 19:00'daki
    // maçın önünde durmalı. Sıralama yalnızca saate bakarsa büyük maç
    // ikinci sıraya düşüyordu.
    const fener = open.findIndex((row) => /Fenerbahçe/.test(`${row.homeTeam} ${row.awayTeam}`));
    if (fener >= 0) assert.equal(fener, 0, "öncelikli takımın dosyası ilk kartta olmalı");

    // Kapatılmış dosyanın SAYFALARI yayında kalır; kapanan yalnızca kutu.
    const closed = manifest.find((row) => row.homepagePromo === false);
    if (closed) {
      assert.ok(fs.existsSync(path.join(root, closed.locales.tr.hub)),
        "kutusu kapatılan dosyanın sayfası silinmemeli");
    }
  }

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
