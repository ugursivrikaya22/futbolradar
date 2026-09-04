#!/usr/bin/env node
/**
 * OTOMATİK ALINTI TOPLAMA — SÖZLEŞME DENETİMİ.
 *
 * Bu modülün doğru çalışması "çok alıntı toplaması" DEĞİL, "doğrulayamadığı
 * hiçbir şeyi geçirmemesi". Bu yüzden testlerin çoğu neyin GEÇTİĞİNİ değil
 * neyin ELENDİĞİNİ sınıyor.
 *
 * Bir alıntı üç ayrı iddia taşır ve her birinin kendi kanıtı olmak zorunda:
 *
 *   1. Cümle harfi harfine söylendi  → yalnızca tırnak içi kopyalanır
 *   2. Kişi şu kişi, şu roldedir     → kadro/teknik direktör listesinden aranır
 *   3. Söz şu maçtan sonra söylendi  → zaman penceresiyle bağlanır
 *
 * Üçünden biri kanıtlanamıyorsa kayıt REDDEDİLİR. Yarım kayıt üretmek —
 * rolü tahmin edilmiş ya da maçı seçilmiş bir alıntı — uydurmadır.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  MAX_QUOTES_PER_MATCH,
  STATEMENT_MAX_MS,
  STATEMENT_MIN_MS,
  bindMatch,
  buildSpeakerIndex,
  harvestQuote,
  mergeHarvestedQuotes,
  parseQuoteHeadline,
  resolveSpeaker,
  verifyQuoteInBody
} = require("../services/quoteHarvest.js");
const { validateQuote } = require("../services/managerQuotes.js");

console.log("quote-harvest");

// Sahte kadro/teknik direktör verisi: kural gerçek dosyaların o günkü
// içeriğine bağlanmasın diye. Gerçek veriyle uyum 9. bölümde ayrıca sınanıyor.
const SOURCES = {
  managers: {
    managers: [
      { team: "Başakşehir", manager: "Nuri Şahin", confidence: "confirmed" },
      { team: "Kasımpaşa", manager: "Emre Belözoğlu", confidence: "confirmed" },
      // Doğrulanmamış atama kimlik kanıtı sayılmaz.
      { team: "Konyaspor", manager: "Belirsiz Hoca", confidence: "reported" }
    ]
  },
  squads: [
    {
      teamName: "Beşiktaş",
      players: [
        { name: "L. Trossard", position: "Attacker" },
        { name: "A. Yılmaz", position: "Defender" },
        { name: "B. Yılmaz", position: "Midfielder" }
      ]
    },
    { teamName: "Galatasaray", players: [{ name: "V. Osimhen", position: "Attacker" }] }
  ]
};

const INDEX = buildSpeakerIndex(SOURCES);

const KICKOFF = "2026-08-30T21:30:00+03:00";
const FIXTURES = [
  { id: "basaksehir-kasimpasa-2026-08-30", homeTeam: "Başakşehir", awayTeam: "Kasımpaşa", kickoff: KICKOFF, status: "FINISHED" },
  { id: "besiktas-galatasaray-2026-08-29", homeTeam: "Beşiktaş", awayTeam: "Galatasaray", kickoff: "2026-08-29T21:30:00+03:00", status: "FINISHED" }
];
const FINISHED = (match) => String(match.status).toUpperCase() === "FINISHED";
const AFTER = (ms) => new Date(Date.parse(KICKOFF) + ms).toISOString();

const CONTEXT = { speakerIndex: INDEX, fixtures: FIXTURES, isFinished: FINISHED, now: "2026-08-31T09:00:00Z" };

function item(overrides) {
  return {
    title: 'Nuri Şahin: "Çok gereksiz 2 puan kaybettik"',
    link: "https://www.sporx.com/futbol/superlig/haber-123",
    publishedAt: AFTER(3 * 60 * 60 * 1000),
    sourceName: "Sporx",
    feedId: "test",
    ...overrides
  };
}

// ── 1. BAŞLIK: YALNIZCA TIRNAK İÇİ ALINIR ─────────────────────────────────
//
// Gazetecinin dolaylı anlatımını ("kadroyu övdü") tırnağa almak, söylenmemiş
// bir cümle üretmektir. Tırnak yoksa alıntı da yoktur.
{
  const ok = parseQuoteHeadline('Nuri Şahin: "Çok gereksiz 2 puan kaybettik"');
  assert.equal(ok.speaker, "Nuri Şahin");
  assert.equal(ok.quote, "Çok gereksiz 2 puan kaybettik", "tırnak içi HARFİ HARFİNE alınmalı");

  for (const [label, title] of [
    ["tırnaksız", "Nuri Şahin kadrosunu savundu"],
    ["iki nokta yok", 'Nuri Şahin "bir şeyler" dedi'],
    ["tırnak açılmış kapanmamış", 'Nuri Şahin: "yarım cümle'],
    ["boş", ""]
  ]) {
    assert.ok(parseQuoteHeadline(title).error, `${label}: reddedilmeli`);
    assert.ok(!parseQuoteHeadline(title).quote, `${label}: alıntı üretilmemeli`);
  }

  // Türk basınının kullandığı işaretlerin hepsi tanınmalı.
  for (const title of [
    'Emre Belözoğlu: “Bu kural bizi zorluyor”',
    "Emre Belözoğlu: 'Bu kural bizi zorluyor'",
    "Emre Belözoğlu: «Bu kural bizi zorluyor»"
  ]) {
    assert.equal(parseQuoteHeadline(title).quote, "Bu kural bizi zorluyor", `işaret tanınmalı: ${title}`);
  }

  // Alıntının İÇİNDE tırnak varsa kapanış SONDAN aranır, ilk işaretten değil.
  const nested = parseQuoteHeadline('Nuri Şahin: "Bize \'kaybettik\' demek düşmez"');
  assert.equal(nested.quote, "Bize 'kaybettik' demek düşmez", "iç tırnak alıntıyı kesmemeli");

  // Tek kelimelik "alıntı" alıntı değil.
  assert.ok(parseQuoteHeadline('Nuri Şahin: "Evet"').error, "fazla kısa alıntı reddedilmeli");
}

// ── 2. KİŞİ ARANIR, TAHMİN EDİLMEZ ────────────────────────────────────────
{
  const manager = resolveSpeaker(INDEX, "Nuri Şahin");
  assert.equal(manager.role, "manager");
  assert.equal(manager.team, "Başakşehir");

  // Kadro kısaltılmış tutuyor ("L. Trossard"), haber tam ad yazıyor.
  const player = resolveSpeaker(INDEX, "Leandro Trossard");
  assert.equal(player.role, "player", "tam ad kısaltılmış kadro kaydıyla eşleşmeli");
  assert.equal(player.team, "Beşiktaş");

  // Başlık ada ön ek koyabiliyor; ad yine listeye karşı çözülüyor.
  const prefixed = resolveSpeaker(INDEX, "Başakşehir'de Nuri Şahin");
  assert.equal(prefixed.team, "Başakşehir", "ön ekli ad da çözülmeli");

  // BELİRSİZ EŞLEŞME, EŞLEŞME DEĞİLDİR: kadroda iki Yılmaz var.
  assert.ok(resolveSpeaker(INDEX, "Yılmaz").error, "aynı soyada düşen ad reddedilmeli");

  // Listede olmayan kişi geçmez — rol ve takım uydurulamaz.
  for (const unknown of ["Ahmet Bilinmeyen", "Kulüp Başkanı", "Taraftar Grubu"]) {
    assert.ok(resolveSpeaker(INDEX, unknown).error, `${unknown}: reddedilmeli`);
  }

  // Doğrulanmamış teknik direktör kaydı kimlik kanıtı sayılmaz.
  assert.ok(resolveSpeaker(INDEX, "Belirsiz Hoca").error, "confirmed olmayan atama dizine girmemeli");
}

// ── 3. MAÇ BAĞLAMA: PENCERE VE BELİRSİZLİK ────────────────────────────────
{
  const bound = bindMatch({
    team: "Başakşehir",
    publishedAt: AFTER(3 * 60 * 60 * 1000),
    fixtures: FIXTURES,
    isFinished: FINISHED
  });
  assert.equal(bound.matchId, "basaksehir-kasimpasa-2026-08-30");

  // Devre arası demeci "maç sonu açıklaması" değildir.
  assert.ok(bindMatch({
    team: "Başakşehir", publishedAt: AFTER(STATEMENT_MIN_MS - 60_000),
    fixtures: FIXTURES, isFinished: FINISHED
  }).error, "pencereden önce gelen demeç bağlanmamalı");

  // Ertesi günün basın toplantısı da değil.
  assert.ok(bindMatch({
    team: "Başakşehir", publishedAt: AFTER(STATEMENT_MAX_MS + 60_000),
    fixtures: FIXTURES, isFinished: FINISHED
  }).error, "pencereden sonra gelen demeç bağlanmamalı");

  // Maç bitmediyse maç sonu açıklaması olamaz.
  assert.ok(bindMatch({
    team: "Başakşehir", publishedAt: AFTER(3 * 60 * 60 * 1000),
    fixtures: FIXTURES, isFinished: () => false
  }).error, "bitmemiş maça bağlanmamalı");

  // İKİ ADAY VARSA SEÇİM YAPILMAZ: hangisinden bahsedildiği belli değil.
  const twoGames = [
    ...FIXTURES,
    { id: "basaksehir-x-2026-08-30", homeTeam: "Başakşehir", awayTeam: "X", kickoff: KICKOFF, status: "FINISHED" }
  ];
  const ambiguous = bindMatch({
    team: "Başakşehir", publishedAt: AFTER(3 * 60 * 60 * 1000),
    fixtures: twoGames, isFinished: FINISHED
  });
  assert.ok(ambiguous.error, "birden çok aday varsa maç seçilmemeli");
  assert.ok(!ambiguous.matchId);

  assert.ok(bindMatch({ team: "Hiç Oynamayan", publishedAt: AFTER(0), fixtures: FIXTURES, isFinished: FINISHED }).error);
}

// ── 4. UÇTAN UCA: KAYIT TAM KURULUR YA DA HİÇ KURULMAZ ────────────────────
{
  const verdict = harvestQuote(item(), CONTEXT);
  assert.ok(verdict.quote, `alıntı üretilmeli: ${verdict.error || ""}`);

  const quote = verdict.quote;
  assert.equal(quote.matchId, "basaksehir-kasimpasa-2026-08-30");
  assert.equal(quote.speaker, "Nuri Şahin");
  assert.equal(quote.role, "manager", "rol LİSTEDEN gelmeli");
  assert.equal(quote.team, "Başakşehir", "takım LİSTEDEN gelmeli");
  assert.equal(quote.quote, "Çok gereksiz 2 puan kaybettik");
  assert.equal(quote.source.url, "https://www.sporx.com/futbol/superlig/haber-123");
  assert.ok(quote.automation, "otomatik kayıt işaretlenmeli");

  // SON KAPI: otomatik kayıt, elle girilmiş kayıtla AYNI doğrulamadan geçer.
  assert.equal(validateQuote(quote).valid, true, "üretilen kayıt yayın kapısından geçmeli");
}

// ── 5. HER EKSİK KANIT KAYDI DÜŞÜRÜR ──────────────────────────────────────
{
  for (const [label, overrides] of [
    ["bağlantı yok", { link: "" }],
    ["bağlantı http değil", { link: "javascript:alert(1)" }],
    ["yayın zamanı okunamıyor", { publishedAt: "belirsiz" }],
    ["tırnaksız başlık", { title: "Nuri Şahin kadrosunu savundu" }],
    ["tanınmayan kişi", { title: 'Ahmet Bilinmeyen: "Bir şeyler söyledim"' }],
    ["belirsiz ad", { title: 'Yılmaz: "Bir şeyler söyledim"' }],
    ["pencere dışı", { publishedAt: AFTER(STATEMENT_MAX_MS + 3_600_000) }]
  ]) {
    const verdict = harvestQuote(item(overrides), CONTEXT);
    assert.ok(verdict.error, `${label}: reddedilmeli`);
    assert.ok(!verdict.quote, `${label}: yarım kayıt üretilmemeli`);
  }
}

// ── 6. FUTBOLCU ALINTISI ROLÜYLE GELİR ────────────────────────────────────
{
  const verdict = harvestQuote(item({
    title: 'Leandro Trossard: "Bugün olması gerektiği gibi oynayamadık"',
    publishedAt: new Date(Date.parse("2026-08-29T21:30:00+03:00") + 2 * 60 * 60 * 1000).toISOString()
  }), CONTEXT);

  assert.ok(verdict.quote, `futbolcu alıntısı üretilmeli: ${verdict.error || ""}`);
  assert.equal(verdict.quote.role, "player");
  assert.equal(verdict.quote.team, "Beşiktaş");
  assert.equal(verdict.quote.matchId, "besiktas-galatasaray-2026-08-29");

  // AD KAYNAĞINKİ. Kadro dosyası sağlayıcı kısaltmasını tutuyor
  // ("L. Trossard"); onu basmak hem okunaksız hem de kaynaktan sapma olur.
  // Kadro kaydı yalnızca ROLÜ ve TAKIMI kanıtlıyor.
  assert.equal(verdict.quote.speaker, "Leandro Trossard", "görünen ad kaynağın yazdığı olmalı");
  assert.equal(verdict.quote.automation.rosterName, "L. Trossard", "kadro karşılığı izlenebilir kalmalı");
}

// ── 7. BİRLEŞTİRME EL EMEĞİNE DOKUNMAZ ────────────────────────────────────
{
  const editorial = {
    matchId: "basaksehir-kasimpasa-2026-08-30",
    speaker: "Elle Girilmiş",
    role: "manager",
    team: "Başakşehir",
    quote: "Editörün girdiği cümle.",
    at: "2026-08-31T00:00:00+03:00",
    source: { name: "Sporx", url: "https://www.sporx.com/x" }
  };

  const harvested = harvestQuote(item(), CONTEXT).quote;
  const merged = mergeHarvestedQuotes({ quotes: [editorial] }, [harvested]);

  const kept = merged.quotes.find((row) => row.speaker === "Elle Girilmiş");
  assert.deepEqual(kept, editorial, "elle girilmiş kayıt AYNEN korunmalı");
  assert.equal(merged.added.length, 1);

  // Aynı alıntı iki kaynaktan gelirse bir kez girer.
  const again = mergeHarvestedQuotes(merged, [harvested]);
  assert.equal(again.added.length, 0, "aynı alıntı tekrar eklenmemeli");
  assert.equal(again.quotes.length, merged.quotes.length);

  // ADIN YAZIMI DEĞİŞİNCE DE TEKRAR ETMEZ. İki yayın organı aynı kişiyi
  // farklı yazıyor ("Rıdvan Yılmaz" / "R. Yılmaz"); ad tekilleştirme
  // anahtarına girseydi aynı cümle şeritte arka arkaya iki kez görünürdü.
  const spelledDifferently = { ...harvested, speaker: "N. Şahin" };
  const variant = mergeHarvestedQuotes(merged, [spelledDifferently]);
  assert.equal(variant.added.length, 0, "ad yazımı farklı diye aynı cümle tekrar girmemeli");

  // En yeni açıklama başta: şerit ve rapor bu sırayı bekliyor.
  const stamps = merged.quotes.map((row) => Date.parse(row.at));
  assert.deepEqual(stamps, [...stamps].sort((a, b) => b - a), "en yeni kayıt başta olmalı");
}

// ── 8. TEK MAÇ ŞERİDİ KAPLAYAMAZ ──────────────────────────────────────────
{
  const many = Array.from({ length: MAX_QUOTES_PER_MATCH + 3 }, (_, index) =>
    harvestQuote(item({
      title: `Nuri Şahin: "Bu ${index}. cümle biraz daha uzun olsun diye yazıldı"`,
      link: `https://www.sporx.com/futbol/superlig/haber-${index}`
    }), CONTEXT).quote
  ).filter(Boolean);

  assert.equal(many.length, MAX_QUOTES_PER_MATCH + 3, "ön koşul: hepsi geçerli olmalı");

  const merged = mergeHarvestedQuotes({ quotes: [] }, many);
  assert.equal(merged.added.length, MAX_QUOTES_PER_MATCH, "maç başına sınır uygulanmalı");
  assert.ok(merged.skipped.length >= 3, "sınıra takılanlar gerekçeyle elenmiş olmalı");
}

// ── 8b. BAŞLIK TEK BAŞINA KANIT DEĞİL: CÜMLE GÖVDEDE DE GEÇMELİ ───────────
//
// Yayın organı başlığa SIKIŞTIRILMIŞ bir alıntı koyup onu yine tırnak içinde
// veriyor. Ölçülmüş gerçek örnek: başlık "Derbi çok önemli, puan ya da
// puanlar istiyoruz" derken gövdedeki sözler "Fenerbahçe derbisi herkes için
// çok önemli... Puan ya da puanlar almak istiyoruz" idi. İkisi aynı anlamda
// ama AYNI CÜMLE DEĞİL; tırnak içinde yayımlanınca okuyucu onu konuşanın
// kurduğu cümle sanar.
{
  const page = `
    <html><head><title>Vincenzo Italiano: 'Derbi çok önemli, puan ya da puanlar istiyoruz'</title></head>
    <body>
      <h1>Vincenzo Italiano: 'Derbi çok önemli, puan ya da puanlar istiyoruz'</h1>
      <p>Beşiktaş Teknik Direktörü Vincenzo Italiano, maçın ardından konuştu.</p>
      <p>Fenerbahçe derbisi herkes için çok önemli. Puan ya da puanlar almak istiyoruz.</p>
    </body></html>`;

  // BAŞLIK KROMU SAYILMAZ. Sayılsaydı kontrol her zaman "geçti" derdi:
  // başlığın kendisi sayfada duruyor ve hiçbir şey ölçülmemiş olurdu.
  const compressed = verifyQuoteInBody("Derbi çok önemli, puan ya da puanlar istiyoruz", page);
  assert.ok(compressed.error, "yalnızca başlıkta geçen sıkıştırılmış alıntı reddedilmeli");

  const real = verifyQuoteInBody("Puan ya da puanlar almak istiyoruz", page);
  assert.equal(real.verified, true, "gövdede geçen cümle doğrulanmalı");

  // Tipografik tırnak farkı metin farkı değildir.
  assert.equal(
    verifyQuoteInBody("Fenerbahçe derbisi “herkes” için çok önemli", page).verified,
    true,
    "tırnak varyantı eşleşmeyi bozmamalı"
  );

  // Okunamayan sayfa doğrulanmış SAYILMAZ: "herhâlde doğrudur" doğrulama değil.
  assert.ok(verifyQuoteInBody("Bir cümle", "").error, "boş gövde doğrulama sayılmamalı");
  assert.ok(verifyQuoteInBody("", page).error, "boş alıntı doğrulanamaz");
}

// ── 9. GERÇEK VERİ: DİZİN KURULABİLİYOR ───────────────────────────────────
//
// Kural sahte veriyle sınandı; bu blok yayındaki dosyaların o kuralı
// besleyebildiğini doğruluyor. Dizin boş kalırsa betik hiç alıntı toplayamaz
// ve bunu sessizce yapar — en pahalı sessizlik.
{
  const managers = JSON.parse(fs.readFileSync("data/managers.json", "utf8"));
  const squads = JSON.parse(fs.readFileSync("data/super-lig-squads.json", "utf8"));
  const index = buildSpeakerIndex({ managers, squads });

  assert.ok(index.size > 100, `konuşan dizini fazla küçük (${index.size})`);

  const confirmed = (managers.managers || []).filter((row) => row.confidence === "confirmed");
  assert.ok(confirmed.length > 0, "ön koşul: doğrulanmış teknik direktör kaydı olmalı");

  for (const row of confirmed.slice(0, 5)) {
    const verdict = resolveSpeaker(index, row.manager);
    assert.ok(!verdict.error, `${row.manager}: dizinde çözülmeli (${verdict.error || ""})`);
    assert.equal(verdict.role, "manager");
  }

  // Depodaki her kayıt yayın kapısından geçmeli — otomatik ya da elle.
  const store = JSON.parse(fs.readFileSync("data/manager-quotes.json", "utf8"));
  for (const entry of store.quotes || []) {
    const verdict = validateQuote(entry);
    assert.equal(verdict.valid, true, `${entry.speaker}: ${verdict.errors.join("; ")}`);
  }
}

console.log("quote-harvest OK (10 bölüm)");
