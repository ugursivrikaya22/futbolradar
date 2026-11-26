#!/usr/bin/env node
/**
 * YAYIN KANALI ZİNCİRİ — SÖZLEŞME DENETİMİ.
 *
 * Bu özelliğin tek gerçek riski yanlış bilgi yazmak. "Süper Lig maçları
 * beIN Sports'ta yayınlanır" cümlesi turnuva düzeyinde doğru, maç düzeyinde
 * eksik: hangi beIN kanalı, o hafta TRT'ye açılan maç var mı, dijital hak
 * kimde. Bu yüzden zincirin her halkasında sınanan şey aynı: DOĞRULANMAMIŞ
 * bir kanal adı ekrana çıkabiliyor mu.
 *
 * İkinci risk sessiz eksik: satırın hiç çizilmemesi. Okuyucu "yayın satırı
 * yok" ile "bu maç yayınlanmıyor"u ayırt edemez, o yüzden bilinmeyen durum
 * da görünür bir cümle taşımak zorunda.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fixtureCard, broadcastLineHtml } from "./lib/matchCards.mjs";

const require = createRequire(import.meta.url);
const root = process.cwd();
const {
  broadcastLabel,
  cardBroadcastLabel,
  istanbulDayOffset,
  isPriorityMatch,
  priorityRank,
  selectBroadcastMatches,
  PRIORITY_COMPETITION_IDS
} = require("../services/broadcastSchedule.js");
const {
  BROADCASTERS,
  COMPETITION_RIGHTS,
  broadcastersForCompetition,
  channelFromSchedule
} = require("../services/broadcastRights.js");

console.log("broadcast-schedule");

// ── 1. KANAL UYDURULMAZ ───────────────────────────────────────────────────
//
// Hak haritasında Süper Lig için beIN Sports yazıyor. Doğrulanmamış bir
// Süper Lig maçında bu ad ekrana ÇIKMAMALI: harita yalnızca hangi akışı
// tarayacağımızı söyler, ne yazacağımızı değil.
{
  const unverified = {
    kickoff: "2027-05-30T20:00:00+03:00",
    homeTeam: "Kayserispor",
    awayTeam: "Antalyaspor",
    competitionId: "super-lig",
    league: "Süper Lig",
    status: "SCHEDULED"
  };
  const label = broadcastLabel(unverified, "tr");
  assert.equal(label.state, "pending", "doğrulanmamış maç 'pending' olmalı");
  assert.equal(label.channel, "", "doğrulanmamış maçta kanal adı taşınmamalı");
  assert.doesNotMatch(label.text, /beIN|TRT|S Sport|Tabii|Exxen/i,
    "hak haritasındaki kanal adı doğrulanmadan metne sızmamalı");
  assert.match(label.text, /bekleniyor/, "bilinmeyen durum görünür bir cümle taşımalı");
  console.log("  ok  doğrulanmamış maçta kanal adı yazılmıyor");
}

// ── 2. BİLİNMEYEN DURUM SESSİZ DEĞİL ─────────────────────────────────────
{
  const pendingHtml = broadcastLineHtml(broadcastLabel({ kickoff: "2027-05-30T20:00:00+03:00" }, "tr"));
  assert.match(pendingHtml, /data-broadcast="pending"/, "bilinmeyen durum işaretlenmeli");
  assert.match(pendingHtml, /Yayın bilgisi bekleniyor/, "bilinmeyen durumda cümle çizilmeli");
  assert.equal(broadcastLineHtml(null), "", "etiket yoksa satır hiç çizilmemeli");
  console.log("  ok  bilinmeyen durum görünür, etiketsiz kart sessiz");
}

// ── 3. İKİ DİL, AYNI KURAL ───────────────────────────────────────────────
{
  const match = { kickoff: "2027-05-30T20:00:00+03:00", homeTeam: "A", awayTeam: "B" };
  assert.match(broadcastLabel(match, "tr").text, /Yayın bilgisi bekleniyor/);
  assert.match(broadcastLabel(match, "en").text, /Broadcast to be confirmed/);
  const trCard = fixtureCard({ locale: "tr", league: "L", stateLabel: "20:00", homeTeam: "A", awayTeam: "B", homeScore: null, awayScore: null, actionHref: "#", broadcast: broadcastLabel(match, "tr") });
  const enCard = fixtureCard({ locale: "en", league: "L", stateLabel: "20:00", homeTeam: "A", awayTeam: "B", homeScore: null, awayScore: null, actionHref: "#", broadcast: broadcastLabel(match, "en") });
  for (const [name, html] of [["tr", trCard], ["en", enCard]]) {
    assert.match(html, /class="fixture-card-broadcast/, `${name}: kartta yayın satırı olmalı`);
  }
  console.log("  ok  Türkçe ve İngilizce kart aynı satırı çiziyor");
}

// ── 4. OYNANMIŞ MAÇTA YAYIN SATIRI YOK ───────────────────────────────────
//
// "Dün akşamki maç şu kanaldaydı" bilgisi doğru ama ana sayfada yer kaplar
// ve hâlâ izlenebilirmiş izlenimi verir.
{
  const finished = { kickoff: "2026-09-11T20:00:00+03:00", homeTeam: "Beşiktaş", awayTeam: "Erzurumspor FK", status: "FINISHED" };
  const scheduled = { ...finished, kickoff: "2027-05-30T20:00:00+03:00", status: "SCHEDULED" };
  assert.equal(cardBroadcastLabel(finished, "tr"), null, "biten maçta yayın satırı çizilmemeli");
  assert.ok(cardBroadcastLabel(scheduled, "tr"), "oynanmamış maçta yayın satırı olmalı");
  console.log("  ok  geçmiş maç ana sayfada yayın satırı taşımıyor");
}

// ── 5. ÖNCELİK SIRASI İSTENEN SIRA ───────────────────────────────────────
{
  const expected = [
    "super-lig",
    "1-lig",
    "sampiyonlar-ligi",
    "avrupa-ligi",
    "konferans-ligi",
    "premier-league",
    "la-liga",
    "serie-a",
    "bundesliga",
    "ligue-1"
  ];
  assert.deepEqual([...PRIORITY_COMPETITION_IDS], expected, "öncelik sırası istenen sırayla birebir olmalı");

  // Türk kulübü, hangi turnuvada olursa olsun büyük Avrupa liglerinin önünde.
  const turkishInEurope = { kickoff: "2027-05-30T20:00:00+03:00", homeTeam: "Samsunspor", awayTeam: "Legia Varşova", competitionId: "konferans-ligi", league: "Konferans Ligi" };
  const bundesliga = { kickoff: "2027-05-30T20:00:00+03:00", homeTeam: "FC Augsburg", awayTeam: "Bayer Leverkusen", competitionId: "bundesliga", league: "Bundesliga" };
  assert.ok(isPriorityMatch(turkishInEurope), "Avrupa'daki Türk takımı öncelikli sayılmalı");
  assert.ok(priorityRank(turkishInEurope) < priorityRank(bundesliga),
    "Türk kulübünün Avrupa maçı Bundesliga maçının önünde olmalı");
  console.log("  ok  öncelik sırası ve Türk kulübü kuralı");
}

// ── 6. GÜN PENCERESİ: YARIN GERÇEKTEN YARIN ──────────────────────────────
{
  const today = istanbulDayOffset(0);
  const tomorrow = istanbulDayOffset(1);
  assert.notEqual(today, tomorrow, "bugün ve yarın farklı gün olmalı");
  assert.equal(
    Math.round((Date.parse(`${tomorrow}T12:00:00+03:00`) - Date.parse(`${today}T12:00:00+03:00`)) / 86400000),
    1,
    "yarın tam bir gün sonrası olmalı"
  );

  const sample = [
    { kickoff: `${tomorrow}T20:00:00+03:00`, homeTeam: "Galatasaray", awayTeam: "Kocaelispor", competitionId: "super-lig" },
    { kickoff: `${today}T20:00:00+03:00`, homeTeam: "Konyaspor", awayTeam: "Trabzonspor", competitionId: "super-lig" }
  ];
  const picked = selectBroadcastMatches(sample, { day: tomorrow });
  assert.equal(picked.length, 1, "yalnızca istenen günün maçları seçilmeli");
  assert.equal(picked[0].homeTeam, "Galatasaray");
  console.log("  ok  gün penceresi yarını doğru kesiyor");
}

// ── 7. HAK HARİTASI EKRANA DEĞİL, TARAYICIYA HİZMET EDER ─────────────────
//
// Haritadaki her turnuva öncelik listesinde olmalı; olmayan bir turnuva
// için akış taramak boşa iş olurdu. Tersi serbest: bir turnuvanın hak
// sahibi bilinmiyorsa listede olmaz ve o maçlar "bekleniyor" kalır.
{
  for (const competitionId of Object.keys(COMPETITION_RIGHTS)) {
    if (competitionId === "turkiye-kupasi") continue; // kupa öncelik listesinde değil, taranması yine de doğru
    assert.ok(
      PRIORITY_COMPETITION_IDS.includes(competitionId),
      `${competitionId}: hak haritasındaki turnuva öncelik listesinde olmalı`
    );
  }
  const superLig = broadcastersForCompetition("super-lig");
  assert.ok(superLig.length, "Süper Lig için taranacak yayıncı tanımlı olmalı");
  for (const broadcaster of superLig) {
    assert.match(broadcaster.scheduleUrl, /^https:\/\//, "yayıncı akış adresi https olmalı");
  }
  console.log("  ok  hak haritası öncelik listesiyle tutarlı");
}

// ── 8. TARAMA ÇIKTISI SÖZLEŞMESİ ─────────────────────────────────────────
//
// Otomatik dosyanın her kaydı kaynağını ve doğrulama anını taşımalı:
// kaynaksız bir kanal adı, tam da bu özelliğin engellemek için var olduğu
// şeydir.
{
  const scanPath = path.join(root, "data", "broadcast-schedule.json");
  const scan = JSON.parse(fs.readFileSync(scanPath, "utf8"));
  assert.ok(Array.isArray(scan.records), "tarama çıktısı records dizisi taşımalı");
  assert.ok(Array.isArray(scan.days), "tarama çıktısı taranan günleri bildirmeli");

  const today = istanbulDayOffset(0);
  for (const record of scan.records) {
    assert.match(String(record.date), /^\d{4}-\d{2}-\d{2}$/, "kayıt tarihi YYYY-MM-DD olmalı");
    assert.ok(String(record.turkey || "").trim(), `${record.date} ${record.homeTeam}: kanal adı boş olamaz`);
    assert.match(String(record.sourceUrl || ""), /^https:\/\//, `${record.homeTeam}: kanal kaynağı https bağlantı taşımalı`);
    assert.ok(!Number.isNaN(Date.parse(record.verifiedAt)), `${record.homeTeam}: doğrulama anı okunabilir olmalı`);
    // GEÇMİŞ GÜN TUTULMAZ: dosya bugünden eski kayıt taşımamalı.
    assert.ok(String(record.date) >= today, `${record.date}: geçmiş gün kaydı taramada kalmamalı`);
  }
  console.log(`  ok  tarama çıktısı sözleşmesi (${scan.records.length} kayıt)`);
}

// ── 9. İKİ SAYFA DA ÜRETİLMİŞ VE YAYIN SATIRI TAŞIYOR ────────────────────
{
  for (const file of ["bugun-hangi-mac-hangi-kanalda.html", "yarinki-maclar-hangi-kanalda.html"]) {
    const full = path.join(root, file);
    assert.ok(fs.existsSync(full), `${file}: sayfa üretilmiş olmalı`);
    const html = fs.readFileSync(full, "utf8");
    assert.match(html, /fixture-card-broadcast|broadcast-schedule-empty/, `${file}: yayın satırı ya da boş gün kutusu olmalı`);
    assert.doesNotMatch(html, /Yayın kanalı henüz açıklanmadı/, `${file}: eski çift cümle kalmamalı — metin tek yerden gelir`);
  }
  console.log("  ok  bugün-hangi-maç ve yarın sayfaları üretiliyor");
}

// ── 10. AKIŞTAN OKUNAN KANAL ADI ──────────────────────────────────────────
//
// "TRT 1" etiketi + yakalanan "1" eskiden çift rakamlı ("TRT 1" + " 1") oluyordu; noktasız ı
// yüzünden "TRT Spor Yıldız" da "TRT Spor"a düşüyordu.
{
  const trt = BROADCASTERS.trt;
  const bein = BROADCASTERS["bein-sports"];
  assert.equal(channelFromSchedule(trt, "<li>22:00 TRT 1 Galatasaray</li>"), "TRT 1");
  assert.equal(channelFromSchedule(trt, "<li>TRT SPOR canlı</li>"), "TRT Spor");
  assert.equal(channelFromSchedule(trt, "<li>TRT Spor Yıldız canlı</li>"), "TRT Spor Yıldız");
  assert.equal(channelFromSchedule(trt, "<li>TRT SPOR YILDIZ canlı</li>"), "TRT Spor Yıldız");
  assert.equal(channelFromSchedule(trt, "<li>yayın yok</li>"), "TRT 1");
  assert.equal(channelFromSchedule(bein, "<li>beIN SPORTS 1 HD</li>"), "beIN Sports 1");
  assert.equal(channelFromSchedule(bein, "<li>beIN SPORTS</li>"), "beIN Sports");
  for (const value of ["TRT 1", "TRT SPOR", "TRT Spor Yıldız", "beIN SPORTS 1"]) {
    const broadcaster = /^TRT/.test(value) ? trt : bein;
    assert.doesNotMatch(channelFromSchedule(broadcaster, value), /(\d) \1$/, `${value} çift rakam üretmemeli`);
  }
  const schedule = JSON.parse(fs.readFileSync(path.join(root, "data", "broadcast-schedule.json"), "utf8"));
  assert.doesNotMatch(JSON.stringify(schedule), /TRT (\d) \1\b/, "broadcast-schedule.json içinde çift rakamlı TRT etiketi kalmamalı");
  console.log("  ok  akış kanal adları tek biçimli (TRT 1, TRT Spor, TRT Spor Yıldız, beIN Sports 1)");
}

// 11. EK KANALLAR (additionalChannels) — elle doğrulama ana kanalın yanına
//     aynı yayının başka beslemesini (ör. 4K) ekleyebilir; tarama ezemez.
{
  const {
    applyVerifiedBroadcast,
    broadcastChannel,
    broadcastChannels,
    primaryBroadcast
  } = require("../services/broadcastSchedule.js");
  const { matchListSchema } = require("../services/matchSchema.js");
  // Trabzonspor–Beşiktaş, 19 Ekim 2026 (API-Football 1584438): tarama TRT 1
  // yazmıştı, beIN'in kendi listesi "beIN SPORTS 1 - 4K".
  const tsbjk = {
    homeTeam: "Trabzonspor", awayTeam: "Beşiktaş", providerId: "1584438",
    kickoff: "2026-10-19T20:00:00+03:00", league: "Süper Lig", broadcast: { turkey: "TRT 1" }
  };
  assert.deepEqual(broadcastChannels(tsbjk), ["beIN SPORTS 1", "beIN SPORTS 1 4K"]);
  assert.equal(broadcastChannel(tsbjk), "beIN SPORTS 1 / beIN SPORTS 1 4K");
  assert.doesNotMatch(broadcastChannel(tsbjk), /TRT/, "tarama kaydı elle doğrulamayı ezmemeli");
  assert.equal(applyVerifiedBroadcast(tsbjk).broadcast.turkey, "beIN SPORTS 1 / beIN SPORTS 1 4K");
  assert.equal(tsbjk.broadcast.turkey, "TRT 1", "kaynak kayıt değiştirilmemeli");
  assert.equal(primaryBroadcast(tsbjk).channel, "beIN SPORTS 1 / beIN SPORTS 1 4K");
  assert.equal(cardBroadcastLabel(tsbjk, "tr").text, "Yayın: beIN SPORTS 1 / beIN SPORTS 1 4K");
  // Ek kanalı olmayan kayıt eskisi gibi tek kanal.
  const fbRoma = { providerId: "1635659", kickoff: "2026-09-10T19:45:00+03:00" };
  assert.deepEqual(broadcastChannels(fbRoma), ["TRT 1"]);
  assert.equal(broadcastChannel(fbRoma), "TRT 1");
  // Başka gün sızmaz.
  assert.deepEqual(broadcastChannels({ ...tsbjk, kickoff: "2026-10-20T20:00:00+03:00" }), ["TRT 1"]);

  const schema = matchListSchema([tsbjk], { broadcastFor: (match) => broadcastChannels(match) });
  const publication = schema.itemListElement[0].item.publication;
  assert.ok(Array.isArray(publication) && publication.length === 2, "iki kanal iki BroadcastEvent olmalı");
  assert.deepEqual(publication.map((item) => item.publishedOn.name), ["beIN SPORTS 1", "beIN SPORTS 1 4K"]);
  assert.deepEqual(publication.map((item) => item.videoFormat), ["HD", "4K"]);
  const single = matchListSchema([fbRoma].map((m) => ({ ...m, homeTeam: "Fenerbahçe", awayTeam: "AS Roma" })), { broadcastFor: () => "TRT 1" });
  assert.equal(single.itemListElement[0].item.publication.publishedOn.name, "TRT 1", "tek kanal: nesne biçimi değişmez");
  console.log("  ok  ek kanallar: görünen ad birleşik, JSON-LD her besleme için ayrı BroadcastEvent");
}

// ── 12. "BUGÜN HANGİ MAÇ HANGİ KANALDA" SAYFASI VE ANA SAYFA KUTUSU ─────
//
// Hedef sorgu başlıkta/açıklamada/H1'de; canonical tek ve temiz adres; JSON-LD
// SportsEvent listesi sayfadaki maçlardan; kanal adı doğrulanmış kayıttan
// (TRT 1 …) ya da "bekleniyor"; YAYIN BAĞLANTISI/OYNATICI YOK.
{
  const { renderBroadcastPage, PAGES } = await import("./generate-broadcast-schedule-page.mjs");
  const { channelSummaryHtml, homeBroadcastBoxHtml, groupByChannel } = await import("./lib/broadcastBoxes.mjs");
  const FILE = "bugun-hangi-mac-hangi-kanalda.html";
  const URL_ = "https://www.futbolradar.com/bugun-hangi-mac-hangi-kanalda";
  const page = PAGES.find((item) => item.file === FILE);
  assert.ok(page && page.offset === 0, "yeni sayfa bugünün verisini gösterir (offset 0)");

  // Sabit maçlar: TRT 1 (doğrulama kaydı), iki beslemeli beIN, kanalı bilinmeyen.
  const fb = { id: "fb-roma", providerId: "1635659", homeTeam: "Fenerbahçe", awayTeam: "AS Roma", league: "UEFA Europa League", kickoff: "2026-09-10T19:45:00+03:00", time: "19:45" };
  const tsbjk = { id: "ts-bjk", providerId: "1584438", homeTeam: "Trabzonspor", awayTeam: "Beşiktaş", league: "Süper Lig", kickoff: "2026-10-19T20:00:00+03:00", time: "20:00" };
  const gs = { id: "gs-x", providerId: "no-such-id", homeTeam: "Galatasaray", awayTeam: "Rize", league: "Süper Lig", kickoff: "2026-09-10T21:00:00+03:00", time: "21:00" };
  const day = "2026-09-10";
  const shell = fs.readFileSync(path.join(root, FILE), "utf8");
  const { html, matchCount } = renderBroadcastPage(page, [fb, gs], day, shell);
  assert.equal(matchCount, 2, "iki öncelikli maç listelenir");

  // SEO: başlık, açıklama, H1 hedef sorguyu taşır.
  const norm = (value) => value.toLocaleLowerCase("tr-TR");
  const title = html.match(/<title>([^<]*)<\/title>/)[1];
  const description = html.match(/<meta name="description" content="([^"]*)"/)[1];
  assert.match(norm(title), /bugün hangi maç hangi kanalda\?/, "title hedef sorguyu içerir");
  assert.match(norm(description), /bugün hangi maç hangi kanalda\?/, "meta description hedef sorguyu içerir");
  assert.ok(description.length >= 100 && description.length <= 160, `meta description 100-160 karakter (${description.length})`);
  assert.match(html, /<h1>Bugün Hangi Maç Hangi Kanalda\?<\/h1>/, "H1 hedef sorgu");
  assert.equal((html.match(/<h1/g) || []).length, 1, "tek H1");
  assert.match(title, /10 Eylül 2026/, "başlık günün tarihini taşır (içerik günlük)");
  assert.ok(html.includes(`<link rel="canonical" href="${URL_}" />`) && html.includes(`<meta property="og:url" content="${URL_}" />`), "canonical ve og:url temiz adres");
  assert.equal((html.match(/rel="canonical"/g) || []).length, 1, "tek canonical");
  assert.ok(/<meta name="robots" content="index/.test(html), "dizinlenebilir");

  // Kanala göre özet: doğrulanmış TRT 1 etiketi + bekleyen grup.
  assert.match(html, /data-channel="TRT 1"[\s\S]*?Fenerbahçe – AS Roma/, "TRT 1 grubunda Fenerbahçe–Roma");
  assert.match(html, /data-channel="pending"[\s\S]*?Galatasaray – Rize/, "kanalı bilinmeyen maç 'bekleniyor' grubunda");
  assert.doesNotMatch(html.slice(html.indexOf("broadcast-channel-summary"), html.indexOf("broadcast-schedule-grid")), /data-channel="(?!TRT 1|pending)/, "başka kanal uydurulmamalı");
  const groups = groupByChannel([tsbjk]);
  assert.deepEqual(groups.map((group) => group.label), ["beIN SPORTS 1", "beIN SPORTS 1 4K"], "iki besleme iki grupta (kanal adı akıştaki yazımıyla)");
  assert.equal(channelSummaryHtml([]), "", "maç yoksa özet basılmaz");

  // JSON-LD: SportsEvent listesi sayfadaki maçlardan; TRT 1 BroadcastEvent.
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const list = blocks.find((node) => node["@type"] === "ItemList");
  assert.ok(list && list.numberOfItems === 2 && list.itemListElement.length === 2, "ItemList sayfadaki iki maçı taşır");
  assert.ok(list.itemListElement.every((entry) => entry.item["@type"] === "SportsEvent" && entry.item.startDate), "her öğe startDate'li SportsEvent");
  assert.match(JSON.stringify(list), /"publishedOn":\{"@type":"BroadcastService","name":"TRT 1"/, "TRT 1 BroadcastEvent olarak işaretli");
  assert.ok(blocks.some((node) => node["@type"] === "CollectionPage" && node.url === URL_), "CollectionPage sayfa adresinde");
  assert.ok(blocks.some((node) => node["@type"] === "BreadcrumbList"), "BreadcrumbList");

  // LİSANSSIZ YAYIN YOK: oynatıcı/gömme etiketi yok; dış bağlantı yalnızca
  // yayıncının KENDİ resmi yayın akışı sayfası (kanal doğrulama bağlantısı).
  for (const rendered of [html, homeBroadcastBoxHtml([fb, gs])]) {
    assert.doesNotMatch(rendered, /<(iframe|embed|object|video|audio|source)\b/i, "gömülü yayın/oynatıcı olmamalı");
    assert.doesNotMatch(rendered, /(stream|canli-yayin|izle|player)[^"'\s]*\.(m3u8|mpd|mp4)/i, "akış dosyası bağlantısı olmamalı");
  }
  const scheduleHosts = new Set(Object.values(BROADCASTERS).map((b) => new URL(b.scheduleUrl).hostname));
  const mainHtml = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
  for (const [, url] of mainHtml.matchAll(/<a\s[^>]*href="(https?:\/\/[^"]+)"/g)) {
    assert.ok(scheduleHosts.has(new URL(url).hostname), `dış bağlantı yalnızca resmî yayın akışı sayfası olabilir: ${url}`);
  }
  assert.doesNotMatch(homeBroadcastBoxHtml([fb, gs]), /href="https?:\/\//, "ana sayfa kutusunda dış bağlantı yok");

  // İki sayfa birbirine bağlı.
  for (const other of PAGES.filter((item) => item.file !== FILE)) {
    const otherShell = fs.readFileSync(path.join(root, other.file), "utf8");
    const otherHtml = renderBroadcastPage(other, [fb, gs], day, otherShell).html;
    assert.ok(otherHtml.includes(`href="./${FILE}"`), `${other.file} → ${FILE} bağlantısı`);
    assert.ok(html.includes(`href="./${other.file}"`), `${FILE} → ${other.file} bağlantısı`);
  }

  // Ana sayfa kutusu.
  const box = homeBroadcastBoxHtml([fb, gs, tsbjk, fb, gs, tsbjk, fb], { limit: 3 });
  assert.match(box, /TRT 1/, "kutuda TRT 1 etiketi");
  assert.equal((box.match(/class="broadcast-box-row"/g) || []).length, 3, "kutu limit kadar satır basar");
  assert.match(box, /\+4 maç daha/, "kalan maç sayısı yazılır");
  assert.match(box, /Yayın bilgisi bekleniyor|bekleniyor/, "bilinmeyen kanal 'bekleniyor'");
  assert.match(homeBroadcastBoxHtml([]), /maç bulunmuyor/, "maç yoksa boş durum cümlesi");
  const home = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(home, /<section class="container section broadcast-box" id="bugunun-mac-yayinlari"/, "ana sayfada kutu bölümü");
  assert.match(home, /<h2 id="broadcast-box-title">Bugünün Maç Yayınları<\/h2>/, "kutu başlığı");
  assert.match(home, /<a class="section-link" href="\.\/bugun-hangi-mac-hangi-kanalda\.html">/, "kutu yeni sayfaya bağlanır");
  assert.ok(home.includes("<!-- prerender:home-broadcast-box:start -->") && home.includes("<!-- prerender:home-broadcast-box:end -->"), "kutu gövdesi derlemede doldurulur (slot)");
  const prerender = fs.readFileSync(path.join(root, "scripts", "prerender-core-pages.mjs"), "utf8");
  assert.ok(prerender.includes('"home-broadcast-box": homeBroadcastBoxHtml('), "ön işleyici kutuyu her derlemede yazar");

  // Kayıtlar: yönlendirme kuralı, site haritaları, tarama/sitemap üreticileri.
  const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  assert.ok((vercel.rewrites || []).some((rule) => rule.source === "/bugun-hangi-mac-hangi-kanalda" && rule.destination === `/${FILE}`), "temiz adres dosyaya eşlenir");
  assert.ok(!(vercel.redirects || []).some((rule) => rule.source === `/${FILE}` || rule.source === "/bugun-hangi-mac-hangi-kanalda"), "adres yönlendirilmez (kalıcı)");
  for (const file of ["sitemap.xml", "public/sitemap.xml", "sitemaps/sitemap-core.xml", "public/sitemaps/sitemap-core.xml"]) {
    const xml = fs.readFileSync(path.join(root, file), "utf8");
    assert.equal(xml.split(`<loc>${URL_}</loc>`).length - 1, 1, `${file}: sayfa haritada tam bir kez`);
  }
  const staticSeo = fs.readFileSync(path.join(root, "scripts", "generate-static-seo-pages.mjs"), "utf8");
  assert.equal(staticSeo.split(`"${FILE}"`).length - 1, 2, "site haritası üreticisinde (günlük + çekirdek liste) kayıtlı");
  assert.ok(fs.readFileSync(path.join(root, "scripts", "inject-hreflang.mjs"), "utf8").includes(`"${FILE}"`), "hreflang tr-only listesinde");
  assert.ok(fs.existsSync(path.join(root, "public", FILE)), "public kopyası depoda");

  // Görsel kural: yeni CSS yalnızca tasarım belirteçleri (sabit renk yok).
  const css = fs.readFileSync(path.join(root, "page.css"), "utf8");
  const block = css.slice(css.indexOf('/* "Bugün Hangi Maç Hangi Kanalda" sayfası'), css.indexOf("MAÇ LİSTESİ PENCERESİ"));
  assert.ok(block.length > 500 && block.includes(".broadcast-box-row") && block.includes(".broadcast-channel"), "yeni CSS bloğu bulundu");
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, "yeni CSS'te sabit renk yok");
  assert.match(block, /var\(--surface\)/, "tasarım belirteci kullanılıyor");

  // Depodaki kabuk sabit.
  assert.match(shell, /<h1>Bugün Hangi Maç Hangi Kanalda\?<\/h1>/, "depodaki kabukta H1");
  console.log("  ok  Bugün Hangi Maç Hangi Kanalda sayfası ve ana sayfa kutusu");
}

// ── 13. ESKİ "BUGÜNKÜ MAÇLAR HANGİ KANALDA" ADRESİ YENİSİNE YÖNLENDİRİLİR ──
//
// İki sayfa aynı sorguda yarışıyordu; eski adres yeni sayfaya KALICI yönlendirilir.
// Yönlendirilen adres: üretilmez, haritada ve iç bağlantılarda yoktur; hiçbir
// kural zincir/döngü oluşturmaz; temiz hedef gerçekten bir sayfaya çözülür.
{
  const { PAGES } = await import("./generate-broadcast-schedule-page.mjs");
  const OLD_FILE = "bugunun-maclari-hangi-kanalda.html";
  const OLD_SLUG = "bugunun-maclari-hangi-kanalda";
  const NEW_FILE = "bugun-hangi-mac-hangi-kanalda.html";
  const NEW_SLUG = "bugun-hangi-mac-hangi-kanalda";
  const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  const redirects = vercel.redirects || [];
  const rewrites = vercel.rewrites || [];

  // Kalıcı yönlendirme: .html ve uzantısız adres, ikisi de yeni temiz adrese.
  for (const source of [`/${OLD_FILE}`, `/${OLD_SLUG}`]) {
    const rules = redirects.filter((rule) => rule.source === source);
    assert.equal(rules.length, 1, `${source}: tam bir yönlendirme kuralı`);
    assert.equal(rules[0].destination, `/${NEW_SLUG}`, `${source} → yeni temiz adres`);
    assert.equal(rules[0].permanent, true, `${source}: kalıcı (301/308)`);
    assert.ok(!rules[0].has && !rules[0].missing, `${source}: koşulsuz`);
  }
  // Eski adrese giden eski rewrite kalmamalı (yönlendirmeyle çelişir).
  assert.ok(!rewrites.some((rule) => rule.source === `/${OLD_SLUG}` || rule.destination === `/${OLD_FILE}`), "eski adresin rewrite'ı kaldırıldı");
  // Hedef bir yönlendirme kaynağı değil (zincir/döngü yok) ve dosyaya çözülür.
  const sources = new Set(redirects.map((rule) => rule.source));
  assert.ok(!sources.has(`/${NEW_SLUG}`) && !sources.has(`/${NEW_FILE}`), "hedef adres yönlendirilmez (zincir yok)");
  assert.ok(rewrites.some((rule) => rule.source === `/${NEW_SLUG}` && rule.destination === `/${NEW_FILE}`), "hedef temiz adres dosyaya eşlenir");
  assert.ok(fs.existsSync(path.join(root, NEW_FILE)), "hedef sayfa depoda");

  // Eski sayfa üretilmez; kabuk dosyası ve public kopyası kaldırıldı.
  assert.ok(!PAGES.some((page) => page.file === OLD_FILE || page.slug === OLD_SLUG), "üretici eski sayfayı üretmez");
  assert.ok(!fs.existsSync(path.join(root, OLD_FILE)) && !fs.existsSync(path.join(root, "public", OLD_FILE)), "eski sayfa dosyası kaldırıldı");

  // Yönlendirilen adres haritada, hreflang ve site haritası üreticisinde yok.
  for (const file of ["sitemap.xml", "public/sitemap.xml", "sitemaps/sitemap-core.xml", "public/sitemaps/sitemap-core.xml"]) {
    const xml = fs.readFileSync(path.join(root, file), "utf8");
    assert.ok(!xml.includes(OLD_SLUG), `${file}: yönlendirilen eski adres haritada olmamalı`);
    assert.equal(xml.split(`<loc>https://www.futbolradar.com/${NEW_SLUG}</loc>`).length - 1, 1, `${file}: yeni adres haritada tam bir kez`);
  }
  for (const file of ["scripts/generate-static-seo-pages.mjs", "scripts/inject-hreflang.mjs"]) {
    assert.ok(!fs.readFileSync(path.join(root, file), "utf8").includes(`"${OLD_FILE}"`), `${file}: eski sayfa listede olmamalı`);
  }
  assert.ok(!(JSON.parse(fs.readFileSync(path.join(root, "data", "sitemap-lastmod.json"), "utf8")).pages || {})[OLD_FILE], "tazelik kaydında eski sayfa yok");

  // İç bağlantılar yeni sayfaya gider: kaynak ve üretilmiş sayfalar eski adresi taşımaz
  // (301'e giden iç bağlantı sayısı artmamalı).
  const { execFileSync } = await import("node:child_process");
  let hits = "";
  try {
    hits = execFileSync("git", ["grep", "-l", OLD_SLUG, "--", ".", ":!vercel.json", ":!scripts/test-broadcast-schedule.mjs", ":!scripts/generate-broadcast-schedule-page.mjs"], { cwd: root, encoding: "utf8" }).trim();
  } catch (error) {
    if (error.status !== 1) throw error; // git grep: 1 = eşleşme yok (istenen durum)
  }
  assert.equal(hits, "", `eski adrese iç bağlantı kalmamalı:\n${hits}`);
  const home = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.ok(home.includes(`href="./${NEW_FILE}">Bugün hangi maç hangi kanalda?</a>`), "ana sayfa hızlı bağlantısı yeni sayfaya");
  assert.ok(fs.readFileSync(path.join(root, "scripts", "prerender-core-pages.mjs"), "utf8").includes(`href="./${NEW_FILE}">Bugün hangi maç hangi kanalda?</a>`), "ön işleyici hızlı bağlantıyı yeni sayfaya yazar");
  // Yeni sayfa kendisi eski adrese bağlanmaz; yarın sayfasından yeniye bağlantı var.
  const tomorrow = fs.readFileSync(path.join(root, "yarinki-maclar-hangi-kanalda.html"), "utf8");
  assert.ok(tomorrow.includes(`href="./${NEW_FILE}"`) && !tomorrow.includes(OLD_SLUG), "yarın sayfası yeni sayfaya bağlanır");
  console.log("  ok  eski bugün sayfası yeni sayfaya kalıcı yönlendiriliyor (kural, harita, iç bağlantılar)");
}

// ── 14. ÜST MENÜ KAYDI ────────────────────────────────────────────────────
//
// Sayfa yalnızca ana sayfa kutusundan değil, her sayfada görünen ortak
// menüden de bulunmalı. Menü `services/i18n.js#NAV_KEYS`ten beslenir ve
// `apply-shared-layout` ile tüm sayfalara basılır. İngilizce karşılığı yok:
// bu yüzden yalnızca TR menüsünde olması beklenir (EN'e Türkçe sayfaya giden
// sessiz bir öğe eklenmez).
{
  const NEW_FILE = "bugun-hangi-mac-hangi-kanalda.html";
  const { NAV_KEYS } = require("../services/i18n.js");
  const trNav = [...NAV_KEYS.tr.primary, ...NAV_KEYS.tr.secondary];
  const entry = trNav.find((item) => item.href === NEW_FILE);
  assert.ok(entry, "TR menüsünde Hangi Kanalda öğesi olmalı");
  assert.equal(entry.key, "nav.broadcastToday");
  const enNav = [...NAV_KEYS.en.primary, ...NAV_KEYS.en.secondary];
  assert.ok(!enNav.some((item) => item.href === NEW_FILE), "EN menüsü Türkçe yayın sayfasına bağlanmaz");
  for (const locale of ["tr", "en"]) {
    const dict = JSON.parse(fs.readFileSync(path.join(root, "locales", `${locale}.json`), "utf8"));
    assert.ok(String(dict["nav.broadcastToday"] || "").trim(), `${locale}.json: nav.broadcastToday etiketi olmalı`);
  }
  console.log("  ok  Hangi Kanalda sayfası TR üst menüsünde");
}

console.log("broadcast-schedule OK (14 bölüm)");
