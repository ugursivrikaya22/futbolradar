/**
 * "BUGÜNÜN MAÇLARI" YÜZEYİ TESTLERİ.
 *
 * Sayfanın sözleşmesi dört cümle:
 *
 *   1. Arama motorunun gördüğü liste, GÜNÜN ÖNEMLİ maçlarını içerir. Sıra
 *      başlama saatine göre değil ilgi puanına göredir; aksi hâlde sayfanın
 *      bir numaralı hedef sorgusunda ("bugünkü maçlar") Google'a giden on
 *      iki kart o günün en çok aranan maçlarını hiç taşımaz.
 *   2. Liste lig bloklarına ayrılır ve blok yapısı istemcininkiyle aynıdır;
 *      JavaScript yüklendiğinde sayfa yerinden oynamaz.
 *   3. Her kart maçın KENDİ ayrıntısına bağlanır. Eskiden on iki kartın on
 *      ikisi de `canli-skor.html`e gidiyordu — maç başına tek bir tarama
 *      yolu bile yoktu.
 *   4. Yapılandırılmış veri (SportsEvent / FAQPage) sayfanın GÖRÜNEN
 *      içeriğiyle birebir aynıdır ve hiçbir alanı uydurulmaz.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);

const {
  groupMatchesByLeague,
  matchDetailPath,
  matchProgramFaq,
  matchProgramSummary,
  orderMatchProgram,
  turkishTeamsPlaying
} = require("../services/matchProgram.js");
const { faqSchema, matchListSchema, sportsEventNode } = require("../services/matchSchema.js");
const { sortByRelevance, relevanceScore } = require("../services/matchRelevance.js");

const NOW = Date.parse("2026-08-12T16:00:00+03:00");

function match(overrides) {
  return {
    id: "mac",
    league: "Friendlies Clubs",
    competitionId: "hazirlik-maci",
    kickoff: "2026-08-12T19:00:00+03:00",
    time: "19:00",
    homeTeam: "Ev",
    awayTeam: "Deplasman",
    status: "SCHEDULED",
    ...overrides
  };
}

// ── 1. Sıra ilgi puanına göre ──────────────────────────────────────────────
{
  const conference = match({
    id: "konferans",
    league: "UEFA Europa Conference League",
    competitionId: "konferans-ligi",
    homeTeam: "FC Copenhagen",
    awayTeam: "Debreceni VSC",
    kickoff: "2026-08-12T19:00:00+03:00"
  });
  const earlyMinorFriendly = match({
    id: "kucuk",
    homeTeam: "Atlético Tordesillas",
    awayTeam: "Real Ávila",
    kickoff: "2026-08-12T18:30:00+03:00",
    time: "18:30"
  });
  const lateMajorFriendly = match({
    id: "buyuk",
    homeTeam: "Leeds",
    awayTeam: "Manchester United",
    kickoff: "2026-08-12T21:30:00+03:00",
    time: "21:30"
  });

  const ordered = orderMatchProgram([earlyMinorFriendly, lateMajorFriendly, conference], { now: NOW });
  assert.deepEqual(
    ordered.map((entry) => entry.id),
    ["konferans", "buyuk", "kucuk"],
    "resmî yarışma önce; hazırlık maçları arasında büyük kulüp saatten önce gelmeli"
  );

  // Veri KAYBOLMAZ: sıralama eleme değildir.
  assert.equal(ordered.length, 3, "sıralama hiçbir maçı düşürmemeli");

  // Servisle aynı kural: orderMatchProgram yalnızca sortByRelevance'ı çağırır.
  assert.deepEqual(
    ordered,
    sortByRelevance([earlyMinorFriendly, lateMajorFriendly, conference], { now: NOW }),
    "program sırası ilgi puanı servisinden gelmeli"
  );
}

// ── 2. İptal edilen maç oynanan maçın üstüne çıkamaz ───────────────────────
//
// `stateOf` iptal/erteleme durumunu bilmiyorken, saati geçmiş bir iptal maçı
// "oynanıyor" bandına düşüp gerçek maçların önüne geçiyordu.
{
  const cancelled = match({ id: "iptal", status: "CANCELLED", kickoff: "2026-08-12T15:00:00+03:00" });
  const playing = match({ id: "oynanan", status: "SCHEDULED", kickoff: "2026-08-12T19:15:00+03:00" });

  assert.ok(
    relevanceScore(playing, { now: NOW }) > relevanceScore(cancelled, { now: NOW }),
    "iptal edilen maç, oynanacak maçın altında kalmalı"
  );
}

// ── 3. Lig blokları — sıra korunur, veri kaybolmaz, kanonik ada göre kümelenir ─
//
// Gruplama artık katalog kimliğine göre kurulur (bkz. matchProgram.js:
// groupMatchesByLeague). Aynı yarışmanın iki farklı yazımı ("UEFA Europa
// Conference League" alias'ı) tek bloğa düşer; katalogda karşılığı olmayan
// bir ad (boş dize) eskisi gibi kendi ham metnine göre kümelenir.
{
  const list = [
    match({ id: "a", league: "UEFA Europa Conference League", competitionId: "konferans-ligi" }),
    match({ id: "b", league: "Friendlies Clubs", competitionId: "hazirlik-maci" }),
    match({ id: "c", league: "UEFA Europa Conference League", competitionId: "konferans-ligi" }),
    match({ id: "d", league: "", competitionId: "" })
  ];

  const groups = groupMatchesByLeague(list);
  assert.deepEqual(
    groups.map((group) => group.league),
    ["Konferans Ligi", "Hazırlık Maçı", ""],
    "bloklar ilk görülme sırasını korumalı ve kanonik ada göre kümelenmeli"
  );
  assert.equal(
    groups.reduce((total, group) => total + group.matches.length, 0),
    list.length,
    "gruplama hiçbir maçı düşürmemeli"
  );
  assert.deepEqual(groups[0].matches.map((entry) => entry.id), ["a", "c"]);
}

// ── 4. Kart bağlantısı maçın kendisine gider ───────────────────────────────
{
  const withPage = match({ analysisPage: "fenerbahce-gornik-zabrze-mac-analizi.html" });
  assert.equal(matchDetailPath(withPage), "./fenerbahce-gornik-zabrze-mac-analizi.html");

  const withoutPage = match({ id: "x", providerId: "1607607" });
  assert.equal(matchDetailPath(withoutPage), "./mac-detay.html?id=1607607&date=2026-08-12");

  assert.ok(
    !matchDetailPath(withoutPage).includes("canli-skor"),
    "kart artık herkesi canlı skor sayfasına göndermemeli"
  );
}

// ── 5. SSS — yalnızca veriden okunabilen sorular ───────────────────────────
{
  assert.deepEqual(matchProgramFaq([]), [], "maç yoksa SSS de yok");

  const list = [
    match({ id: "1", league: "Süper Lig", competitionId: "super-lig", homeTeam: "Galatasaray", awayTeam: "Çorum FK", time: "19:00" }),
    match({ id: "2", league: "Friendlies Clubs", homeTeam: "Leeds", awayTeam: "Manchester United", time: "21:30" })
  ];

  const faq = matchProgramFaq(list, { dateLabel: "12 Ağustos Çarşamba" });
  assert.ok(faq.length >= 3, "elde veri varken SSS üretilmeli");
  for (const entry of faq) {
    assert.ok(entry.question && entry.answer, "her maddede soru ve cevap olmalı");
  }

  const joined = faq.map((entry) => `${entry.question} ${entry.answer}`).join(" ");
  assert.ok(joined.includes("2 karşılaşma"), "sayı listenin kendisinden gelmeli");
  assert.ok(joined.includes("19:00") && joined.includes("21:30"), "ilk ve son saat veriden okunmalı");
  assert.ok(joined.includes("Galatasaray"), "sahaya çıkan Türk takımı adıyla anılmalı");

  // Türk takımı YOKSA o soru hiç sorulmaz — "bugün Türk takımı yok" gibi bir
  // olumsuz iddia, fikstür kapsamımızın tam olduğunu varsayardı.
  const foreignOnly = matchProgramFaq([match({ homeTeam: "Ajax", awayTeam: "PSV" })], { dateLabel: "12 Ağustos" });
  assert.ok(
    !foreignOnly.some((entry) => entry.question.includes("Türk takım")),
    "Türk takımı oynamıyorsa o soru basılmamalı"
  );
  assert.ok(
    !foreignOnly.some((entry) => /\byok\b/i.test(entry.answer)),
    "SSS olumsuz kapsam iddiası üretmemeli"
  );
}

// ── 6. Takım adları tek tek, birleşik etiket değil ─────────────────────────
//
// `turkishSideOf` iki tarafı da Türk olan maçta "Galatasaray & Çorum FK"
// döndürür; bu bir maçın Türk tarafını adlandırmak için doğru, "hangi
// takımlar oynuyor" sorusunun cevabı için değil.
{
  const names = turkishTeamsPlaying([
    match({ homeTeam: "Galatasaray", awayTeam: "Çorum FK" }),
    match({ homeTeam: "Fenerbahçe", awayTeam: "Galatasaray" })
  ]);
  assert.ok(names.includes("Galatasaray") && names.includes("Çorum FK") && names.includes("Fenerbahçe"));
  assert.equal(names.filter((name) => name === "Galatasaray").length, 1, "aynı takım iki kez listelenmemeli");
  assert.ok(!names.some((name) => name.includes("&")), "birleşik etiket basılmamalı");
}

// ── 7. Özet sayıları ───────────────────────────────────────────────────────
{
  const summary = matchProgramSummary([
    match({ status: "LIVE", time: "15:00" }),
    match({ status: "FINISHED", time: "13:00" }),
    match({ status: "SCHEDULED", time: "21:30" }),
    match({ status: "CANCELLED", time: "19:00" })
  ]);
  assert.equal(summary.total, 4);
  assert.equal(summary.live, 1);
  assert.equal(summary.finished, 1);
  assert.equal(summary.upcoming, 1);
  assert.equal(summary.off, 1);
  assert.equal(summary.firstKickoff, "13:00");
  assert.equal(summary.lastKickoff, "21:30");
}

// ── 8. SportsEvent — eksik veri uydurulmaz ─────────────────────────────────
{
  const withVenue = sportsEventNode(match({ venue: "Parken Stadium" }));
  assert.equal(withVenue.location.name, "Parken Stadium");

  const withoutVenue = sportsEventNode(match({ venue: null }));
  assert.ok(
    !("location" in withoutVenue),
    "statı ve ülkesi bilinmeyen hazırlık maçında location yazılmaz"
  );

  assert.equal(sportsEventNode(match({ status: "POSTPONED" })).eventStatus, "https://schema.org/EventPostponed");
  assert.equal(sportsEventNode(match({ status: "CANCELLED" })).eventStatus, "https://schema.org/EventCancelled");
  assert.equal(sportsEventNode(match({ status: "LIVE" })).eventStatus, "https://schema.org/EventScheduled");
  assert.equal(sportsEventNode(match({ status: "FINISHED" })).eventStatus, undefined);
  assert.equal(sportsEventNode(match({ status: "ABD" })).eventStatus, "https://schema.org/EventCancelled");

  assert.equal(sportsEventNode(match({ kickoff: "" })), null, "zamansız etkinlik işaretlenmez");
  assert.equal(sportsEventNode(match({ homeTeam: "" })), null, "takımsız etkinlik işaretlenmez");

  // Doğrulanmamış skor makineye de verilmez.
  const finished = sportsEventNode(match({ status: "FINISHED", score: { home: 1, away: 1 } }));
  assert.ok(!JSON.stringify(finished).includes('"homeScore"'), "skor işaretlemeye yazılmaz");
}

// ── 9. ItemList ve FAQPage sayfayla ayrışmaz ───────────────────────────────
{
  const list = [match({ id: "1" }), match({ id: "2", kickoff: "" })];
  const schema = matchListSchema(list, { name: "Bugünün futbol maçları" });
  assert.equal(schema.numberOfItems, 1, "üretilemeyen maç sayıya da girmemeli");
  assert.equal(schema.itemListElement.length, 1);
  assert.equal(schema.itemListElement[0].position, 1);
  assert.equal(matchListSchema([]), null, "boş listede işaretleme üretilmez");

  assert.equal(faqSchema([]), null);
  const faq = faqSchema([{ question: "Soru?", answer: "Cevap." }]);
  assert.equal(faq.mainEntity[0].acceptedAnswer.text, "Cevap.");
}

// ── 10. İstemci ile ön derleme AYNI sırayı üretmeli ────────────────────────
//
// Kural sunucuda (services/matchRelevance.js); istemci puanı kayıttan okur
// ama eşitlik bozma sırasını kendi uygular. Ayrışırlarsa statik yedek bir
// sırayla basılır, JavaScript başka bir sıraya geçer ve kartlar yer
// değiştirir.
{
  const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const block = appSource.match(/\/\/ match-program-order:start([\s\S]*?)\/\/ match-program-order:end/);
  assert.ok(block, "app.js içinde match-program-order bloğu bulunmalı");

  // Blok kendi kendine yeter: sıralama, gösterim kurallarına (isLiveMatch ve
  // skor kapısı) bağlı DEĞİL. "Bu maçı canlı gösterebilir miyim?" ile "bu maç
  // ne kadar öne çıksın?" ayrı sorular; ayrışmaları bilinçli.
  assert.ok(
    !/isLiveMatch\s*\(/.test(block[1]),
    "sıralama bloğu gösterim kuralına bağlanmamalı — ikisi ayrı soru"
  );

  const clientOrder = new Function(`${block[1]}\nreturn orderMatchProgram;`)();

  const sample = [
    match({ id: "a", league: "Friendlies Clubs", homeTeam: "Leeds", awayTeam: "Manchester United", kickoff: "2026-08-12T21:30:00+03:00" }),
    match({ id: "b", league: "Friendlies Clubs", homeTeam: "Atlético Tordesillas", awayTeam: "Real Ávila", kickoff: "2026-08-12T18:30:00+03:00" }),
    match({ id: "c", league: "UEFA Europa Conference League", competitionId: "konferans-ligi", homeTeam: "Rapid Vienna", awayTeam: "Paide" }),
    match({ id: "d", status: "CANCELLED", kickoff: "2026-08-12T15:00:00+03:00" }),
    match({ id: "e", league: "Süper Lig", competitionId: "super-lig", homeTeam: "Galatasaray", awayTeam: "Çorum FK" })
  ];

  const server = sortByRelevance(sample, { now: NOW });
  const stamped = sample.map((entry) => ({ ...entry, relevance: relevanceScore(entry, { now: NOW }) }));

  assert.deepEqual(
    clientOrder(stamped, NOW).map((entry) => entry.id),
    server.map((entry) => entry.id),
    "istemci sırası ile servis sırası aynı olmalı"
  );

  // PUANSIZ LİSTE (sağlayıcı kesintisi → statik JSON yedeği). Yarışma sırası
  // iddia edilmez ama ham sağlayıcı sırası da korunmaz: durum sırası
  // uygulanır ve bu bilgi kaydın kendisinde vardır.
  const unscored = [
    match({ id: "biten", status: "FINISHED", kickoff: "2026-08-12T13:00:00+03:00" }),
    match({ id: "gec", status: "SCHEDULED", kickoff: "2026-08-12T21:30:00+03:00" }),
    match({ id: "iptal", status: "CANCELLED", kickoff: "2026-08-12T15:00:00+03:00" }),
    match({ id: "canli", status: "LIVE", kickoff: "2026-08-12T15:00:00+03:00" }),
    match({ id: "erken", status: "SCHEDULED", kickoff: "2026-08-12T19:00:00+03:00" })
  ];
  assert.deepEqual(
    clientOrder(unscored, NOW).map((entry) => entry.id),
    ["canli", "erken", "gec", "biten", "iptal"],
    "puan yokken canlı önce, sonra başlayacaklar saatine göre, en sonda oynanmayanlar"
  );
}

// ── 11. Üretilen sayfa ─────────────────────────────────────────────────────
{
  const file = path.join(root, "bugunun-maclari.html");
  const html = fs.readFileSync(file, "utf8");

  const slot = html.match(/<!-- prerender:matches-page:start -->([\s\S]*?)<!-- prerender:matches-page:end -->/);
  assert.ok(slot, "maç listesi slotu bulunmalı");
  const body = slot[1];

  const cards = body.match(/data-card="fixture"/g) || [];
  assert.ok(cards.length > 0, "statik HTML'de maç kartı bulunmalı — sayfa Googlebot'a boş görünmemeli");

  assert.ok(
    (body.match(/league-match-group/g) || []).length > 0,
    "liste lig bloklarına ayrılmalı; istemci de aynı bloğu çiziyor"
  );

  // Blok başlığındaki sayı, blok içindeki kart sayısını tutmalı.
  for (const group of body.match(/<section class="league-match-group[\s\S]*?<\/section>/g) || []) {
    const declared = Number((group.match(/league-block-count">(\d+) maç/) || [])[1]);
    const actual = (group.match(/data-card="fixture"/g) || []).length;
    assert.equal(declared, actual, "lig bloğundaki sayı kart sayısıyla eşleşmeli");
  }

  // Kart bağlantıları maç başına ayrışmalı.
  const hrefs = [...body.matchAll(/class="fixture-card-action" href="([^"]+)"/g)].map((entry) => entry[1]);
  assert.equal(hrefs.length, cards.length, "her kartın bir bağlantısı olmalı");
  assert.equal(new Set(hrefs).size, hrefs.length, "her kart kendi maçına bağlanmalı");
  assert.ok(
    !hrefs.some((href) => href === "./canli-skor.html"),
    "kartlar toplu hâlde canlı skor sayfasına gitmemeli"
  );

  // Yapılandırılmış veri sayfada ve GÖRÜNEN metinle aynı.
  const schemaSlot = html.match(/<!-- prerender:today-schema:start -->([\s\S]*?)<!-- prerender:today-schema:end -->/);
  assert.ok(schemaSlot, "yapılandırılmış veri slotu bulunmalı");

  const blocks = [...schemaSlot[1].matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((entry) => JSON.parse(entry[1].replace(/\\u003c/g, "<")));
  const itemList = blocks.find((entry) => entry["@type"] === "ItemList");
  assert.ok(itemList, "maç listesi SportsEvent ItemList olarak işaretlenmeli");
  assert.equal(
    itemList.numberOfItems,
    cards.length,
    "işaretlenen maç sayısı, sayfada BASILAN kart sayısıyla aynı olmalı"
  );
  for (const entry of itemList.itemListElement) {
    assert.equal(entry.item["@type"], "SportsEvent");
    assert.ok(entry.item.startDate, "her etkinliğin başlama zamanı olmalı");
    assert.ok(
      html.includes(entry.item.homeTeam.name),
      `işaretlenen takım sayfada da görünmeli: ${entry.item.homeTeam.name}`
    );
  }

  const faqBlock = blocks.find((entry) => entry["@type"] === "FAQPage");
  const faqSection = html.match(/<!-- prerender:today-faq:start -->([\s\S]*?)<!-- prerender:today-faq:end -->/);
  assert.ok(faqSection, "SSS slotu bulunmalı");

  if (faqBlock) {
    assert.ok(faqSection[1].includes("demand-faq"), "işaretlenen SSS sayfada GÖRÜNÜR olmalı");
    for (const entry of faqBlock.mainEntity) {
      // Görünen metin HTML kaçışlı olabilir; kaçışsız parçayı arıyoruz.
      const probe = entry.name.split("?")[0].slice(0, 24);
      assert.ok(
        faqSection[1].includes(probe),
        `SSS sorusu sayfada da yazmalı: ${entry.name}`
      );
    }
  }
}

// ── 12. Maç listeleyen her sayfa işaretlenmiş olmalı ──────────────────────
//
// "Bugünün Maçları"ndaki kusur tek sayfaya özgü değildi: `canli-skor.html`
// ve `mac-sonuclari.html` da on ikişer maç kartı basıyor ama arama motoruna
// bunların MAÇ olduğunu söyleyen tek bir işaret taşımıyorlardı. Bu blok,
// kartı olan sayfanın şemasız kalmasını engelliyor.
{
  const PAGES = [
    { file: "bugunun-maclari.html", slot: "today-schema", card: 'data-card="fixture"' },
    { file: "canli-skor.html", slot: "live-schema", card: 'data-card="fixture"' },
    { file: "mac-sonuclari.html", slot: "results-schema", card: 'data-card="verified-result"' }
  ];

  for (const page of PAGES) {
    const html = fs.readFileSync(path.join(root, page.file), "utf8");
    const cards = (html.match(new RegExp(page.card, "g")) || []).length;

    const slot = html.match(
      new RegExp(`<!-- prerender:${page.slot}:start -->([\\s\\S]*?)<!-- prerender:${page.slot}:end -->`)
    );
    assert.ok(slot, `${page.file}: ${page.slot} işaretçileri bulunmalı`);

    if (!cards) continue; // Kart yoksa işaretleme de olmamalı; iddia edilecek maç yok.

    const blocks = [...slot[1].matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
      .map((entry) => JSON.parse(entry[1].replace(/\\u003c/g, "<")));
    const itemList = blocks.find((entry) => entry["@type"] === "ItemList");
    assert.ok(itemList, `${page.file}: ${cards} maç kartı var ama SportsEvent işaretlemesi yok`);

    assert.equal(
      itemList.numberOfItems,
      itemList.itemListElement.length,
      `${page.file}: sayı ile içerik ayrışmamalı`
    );
    assert.ok(
      itemList.numberOfItems <= cards,
      `${page.file}: işaretleme sayfada OLMAYAN maçı iddia edemez (${itemList.numberOfItems} > ${cards})`
    );

    for (const entry of itemList.itemListElement) {
      assert.equal(entry.item["@type"], "SportsEvent", `${page.file}: düğüm SportsEvent olmalı`);
      assert.ok(entry.item.startDate, `${page.file}: her etkinliğin başlama zamanı olmalı`);
      // Skor YAZILMAZ: schema.org SportsEvent'in standart bir skor alanı yok.
      const json = JSON.stringify(entry.item);
      assert.ok(!/"score"|"homeScore"|"awayScore"/.test(json), `${page.file}: skor işaretlemeye yazılmamalı`);
    }
  }
}

console.log("Maç programı testleri geçti.");
