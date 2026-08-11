/**
 * ANA SAYFA SİNYALLERİ — sayaç şeridi, günün başlıkları, paylaşım metni.
 *
 * ÜÇ ŞEY SINANIYOR:
 *
 *   1. ZAYIF DURUM GİZLENİR. Sıfır olan sayaç çizilmez; hepsi sıfırsa şerit
 *      hiç basılmaz. "Analizi hazır 0", sayfanın vaadinin yokluğunu rakamla
 *      ilan ediyordu.
 *
 *   2. BAŞLIK UYDURULMAZ. Her başlığın hem kendisi hem kancası kayıttan
 *      gelmeli. Kancası olmayan aday düşer — "analiz yakında" gibi içi boş
 *      bir satır üretmek yerine başlık hiç çizilmez.
 *
 *   3. İSTEMCİ VE SERVİS AYNI ŞEYİ ÜRETİR. Kural iki yerde yaşıyor (statik
 *      yedek Node'da, canlı sayfa tarayıcıda). Ayrışırlarsa sayfa açılışta
 *      bir başlık, JS yüklenince başka bir başlık gösterir.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);

const { renderQuickStats, visibleQuickStats } = require("../services/homeQuickStats.js");
const { buildDailyHeadlines, firstSentence } = require("../services/dailyHeadlines.js");
const { buildMatchShareText, renderShareBlock, shareTargets } = require("../services/shareText.js");
const { curatedMatches } = require("../services/providers/mockProvider.js");

const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── 1. Sıfır sayaç gizlenir ────────────────────────────────────────────────

{
  const stats = visibleQuickStats({ live: 0, upcoming: 1, finished: 0, analysisReady: 0, total: 1 });
  assert.deepEqual(
    stats.map((stat) => stat.key),
    ["upcoming", "total"],
    "sıfır olan sayaçlar elenmelidir"
  );

  const html = renderQuickStats({ live: 0, upcoming: 1, finished: 0, analysisReady: 0, total: 1 }, escapeHtml);
  assert.ok(!html.includes("Analizi hazır"), "sıfırken 'Analizi hazır' basılmamalı");
  assert.ok(!html.includes("Canlı"), "sıfırken 'Canlı' basılmamalı");
  assert.ok(html.includes("Başlayacak"), "sıfırdan büyük sayaç basılmalı");
}

{
  // Hepsi sıfır: şerit tümüyle gizlenir. Boş bir çerçeve, dolu görünmeye
  // çalışan boş bir çerçeveden iyidir.
  assert.equal(
    renderQuickStats({ live: 0, upcoming: 0, finished: 0, analysisReady: 0, total: 0 }, escapeHtml),
    "",
    "tüm sayaçlar sıfırken şerit hiç basılmamalı"
  );
}

{
  // Sayı olmayan/eksi değerler de gizlenir; ekrana "NaN" ya da "-1" düşmez.
  const html = renderQuickStats({ live: null, upcoming: "iki", finished: -3, analysisReady: undefined, total: 4 }, escapeHtml);
  assert.ok(!/NaN|-3|undefined|null/.test(html), "geçersiz sayaç değeri ekrana sızmamalı");
  assert.ok(html.includes("Toplam"), "geçerli sayaç basılmalı");
}

// ── 2. Başlıklar yalnızca gerçek alanlardan ────────────────────────────────

const today = "2026-07-31";

const liveTurkish = {
  id: "trabzonspor-al-sadd-2026-07-31",
  homeTeam: "Trabzonspor", awayTeam: "Al Sadd",
  kickoff: `${today}T18:00:00+03:00`, status: "LIVE",
  score: { home: 2, away: 1, halftimeHome: 1, halftimeAway: 1 },
  league: "Hazırlık Maçı", venue: "Şenol Güneş Stadyumu"
};

const finishedWithAnalysis = {
  id: "fenerbahce-gornik-2026-07-31",
  homeTeam: "Fenerbahçe", awayTeam: "Górnik Zabrze",
  kickoff: `${today}T21:00:00+03:00`, status: "FINISHED",
  score: { home: 1, away: 0 },
  league: "UEFA Şampiyonlar Ligi",
  analysisPage: "fenerbahce-gornik-zabrze-mac-analizi.html",
  analysis: {
    headline: "Kontrol yüksek, skor marjı dar",
    lead: "Fenerbahçe topa ve saha yerleşimine hükmetti.",
    keyPoints: ["Fenerbahçe yüzde 79 topa sahip oldu ve 762 pas denedi."]
  }
};

// Kancası olmayan aday: skor var ama anlatacak tek bir doğrulanmış cümle yok.
const finishedWithoutHook = {
  id: "bos-mac-2026-07-31",
  homeTeam: "A Takımı", awayTeam: "B Takımı",
  kickoff: `${today}T15:00:00+03:00`, status: "FINISHED",
  score: { home: 0, away: 0 }
};

// Kancası olmayan aday: başlayacak ama saat, saha, aşama, lig hiçbiri yok.
const upcomingWithoutHook = {
  id: "bilgisiz-mac-2026-07-31",
  homeTeam: "C Takımı", awayTeam: "D Takımı",
  kickoff: `${today}T19:00:00+03:00`, status: "SCHEDULED"
};

const upcomingTurkish = {
  id: "galatasaray-rennes-2026-07-31",
  homeTeam: "Galatasaray", awayTeam: "Rennes",
  kickoff: `${today}T21:00:00+03:00`, status: "SCHEDULED",
  time: "21:00", league: "Hazırlık Maçı", venue: "RAMS Park"
};

{
  const headlines = buildDailyHeadlines(
    [upcomingWithoutHook, finishedWithoutHook, upcomingTurkish, finishedWithAnalysis, liveTurkish],
    { today }
  );

  assert.equal(headlines.length, 3, "en fazla üç başlık çizilmeli");

  // Sıra: canlı Türk maçı → biten Türk maçı → bugünün Türk maçı.
  assert.deepEqual(
    headlines.map((headline) => headline.matchId),
    [liveTurkish.id, finishedWithAnalysis.id, upcomingTurkish.id],
    "başlık sırası ilgiye göre olmalı"
  );

  // Kancası olmayan adaylar hiç girmemeli.
  const ids = headlines.map((headline) => headline.matchId);
  assert.ok(!ids.includes(finishedWithoutHook.id), "kancasız biten maç başlık olmamalı");
  assert.ok(!ids.includes(upcomingWithoutHook.id), "kancasız başlayacak maç başlık olmamalı");

  // Her başlığın kancası dolu ve gerçek bir alandan gelmiş olmalı.
  for (const headline of headlines) {
    assert.ok(headline.hook && headline.hook.trim(), `${headline.matchId}: kanca boş olamaz`);
    assert.ok(headline.title && headline.title.trim(), `${headline.matchId}: başlık boş olamaz`);
    assert.ok(
      !/yakında|çok yakında|kaçırma|efsane|müthiş|inanılmaz/i.test(`${headline.title} ${headline.hook}`),
      `${headline.matchId}: başlık editoryal abartı içermemeli`
    );
    assert.ok(
      !/undefined|null|NaN/.test(`${headline.title} ${headline.hook}`),
      `${headline.matchId}: boş değer sızıntısı`
    );
  }

  // Biten maçın başlığı analizin KENDİ cümlesi olmalı, skor satırı değil.
  const finished = headlines.find((headline) => headline.matchId === finishedWithAnalysis.id);
  assert.equal(finished.title, "Kontrol yüksek, skor marjı dar", "analiz başlığı kullanılmalı");
  assert.equal(finished.subtitle, "Fenerbahçe 1-0 Górnik Zabrze", "skor satırı ayrıca taşınmalı");
  assert.equal(finished.hook, finishedWithAnalysis.analysis.keyPoints[0], "kanca analizin ilk maddesi olmalı");

  // Bağlantı UYDURULMAZ: kayıttaki sayfaya gider.
  assert.equal(finished.href, "./fenerbahce-gornik-zabrze-mac-analizi.html", "kayıtlı analiz sayfasına bağlanmalı");
}

{
  // Aday yoksa bölüm gizlenir.
  assert.deepEqual(buildDailyHeadlines([], { today }), [], "maç yoksa başlık üretilmemeli");
  assert.deepEqual(
    buildDailyHeadlines([finishedWithoutHook, upcomingWithoutHook], { today }),
    [],
    "yalnızca kancasız adaylar varken bölüm boş kalmalı"
  );
}

{
  // Rapor deposu varsa kalıcı rapor sayfasına bağlanır.
  const withReport = buildDailyHeadlines([finishedWithAnalysis], {
    today,
    reports: [{ matchId: finishedWithAnalysis.id, reportUrl: "./mac-raporu/fenerbahce-gornik-2026-07-31.html" }]
  });
  assert.equal(
    withReport[0].href,
    "./mac-raporu/fenerbahce-gornik-2026-07-31.html",
    "rapor kaydı varsa kalıcı rapor sayfası tercih edilmeli"
  );
}

{
  // Aynı maç iki kez başlık olamaz.
  const duplicated = buildDailyHeadlines([liveTurkish, { ...liveTurkish }], { today });
  assert.equal(duplicated.length, 1, "aynı maç tek başlık üretmeli");
}

{
  // Ondalık ayırıcı cümleyi bölmemeli: "1,54 xG" ve "0.06" analiz
  // metinlerinde sık geçiyor.
  const sentence = firstSentence("Fenerbahçe 1.54 xG üretti. İkinci cümle.");
  assert.equal(sentence, "Fenerbahçe 1.54 xG üretti.", "cümle ilk noktalamada bitmeli");

  // Kısaltılmış takım adındaki nokta cümleyi bölmemeli: "A. Italiano",
  // "B. Dortmund" gibi adlar maç metinlerinde sık geçiyor.
  assert.equal(
    firstSentence("Estadio Bicentenario'da oynanan maçta A. Italiano 2-2 bitirdi. İkinci cümle."),
    "Estadio Bicentenario'da oynanan maçta A. Italiano 2-2 bitirdi.",
    "baş harf noktası cümle sonu sayılmamalı"
  );
  assert.equal(
    firstSentence("B. Dortmund deplasmanda kazandı. İkinci cümle."),
    "B. Dortmund deplasmanda kazandı.",
    "cümle başındaki baş harf de cümleyi bölmemeli"
  );
}

{
  // REGRESYON: kanca alanına nesne geldiğinde "[object Object]" basılmamalı.
  //
  // Ana sayfadaki üç başlık tam olarak böyle bozulmuştu: `report.digest` bir
  // nesne (`{ headline, paragraph, ... }`) ama cümle gibi kullanılıyordu ve
  // `String()` onu sessizce `"[object Object]"` yapıyordu. O dize boş
  // değildir, bu yüzden "kancası olmayan aday düşer" kuralına takılmadan
  // ekrana kadar gidiyordu.
  for (const value of [{ paragraph: "x" }, ["a", "b"], () => "x", Symbol("x")]) {
    assert.equal(firstSentence(value), "", `metin olmayan değer boş dönmeli: ${String(typeof value)}`);
  }

  // Nesne kanca üretemediğine göre aday da düşmeli.
  const objectDigestOnly = {
    id: "digest-object-only",
    homeTeam: "A. Italiano",
    awayTeam: "Nublense",
    status: "FINISHED",
    kickoff: `${today}T18:00:00Z`,
    score: { home: 2, away: 2 }
  };
  assert.deepEqual(
    buildDailyHeadlines([objectDigestOnly], {
      today,
      reports: [{ matchId: objectDigestOnly.id, digest: { result: { draw: true } } }]
    }),
    [],
    "digest yalnızca nesne alanlar taşıyorsa başlık çizilmemeli"
  );

  // Anlatan alan varsa kanca ONDAN gelmeli, nesnenin kendisinden değil.
  const withParagraph = buildDailyHeadlines([objectDigestOnly], {
    today,
    reports: [{
      matchId: objectDigestOnly.id,
      digest: {
        headline: "A. Italiano ile Nublense 2-2 berabere kaldı",
        paragraph: "Estadio Bicentenario'da oynanan maçta iki takım da öne geçemedi. İkinci cümle."
      }
    }]
  });
  assert.equal(withParagraph.length, 1, "paragraf varsa başlık çizilmeli");
  assert.equal(
    withParagraph[0].hook,
    "Estadio Bicentenario'da oynanan maçta iki takım da öne geçemedi.",
    "kanca digest.paragraph'ın ilk cümlesi olmalı"
  );
}

// ── 3. Paylaşım metni yalnızca doğrulanmış alanlardan ───────────────────────

{
  const share = buildMatchShareText(finishedWithAnalysis, { path: "mac-raporu/fb-gz.html" });
  assert.ok(share, "kimlik alanları tamken paylaşım metni üretilmeli");
  assert.ok(share.text.includes("Fenerbahçe 1-0 Górnik Zabrze"), "skor metne girmeli");
  assert.ok(share.text.includes("Kontrol yüksek"), "analiz başlığı metne girmeli");
  assert.ok(share.url.startsWith("https://"), "paylaşılan adres mutlak olmalı");
  assert.ok(share.text.length <= 200, "paylaşım metni sınırı aşmamalı");
}

{
  // SKOR YOKSA SKOR YAZILMAZ. Paylaşılan metin siteden kopup gider; yanlış
  // bir skor geri alınamaz.
  const scoreless = buildMatchShareText({
    id: "x", homeTeam: "Beşiktaş", awayTeam: "Midtjylland",
    status: "FINISHED", league: "Hazırlık Maçı"
  }, { path: "mac-raporu/x.html" });
  assert.ok(!/\d+-\d+/.test(scoreless.text), "skor yokken metinde skor uydurulmamalı");
  assert.ok(scoreless.text.includes("Beşiktaş"), "takım adı metne girmeli");
}

{
  const upcoming = buildMatchShareText(upcomingTurkish, { path: "bugunun-maclari.html" });
  assert.ok(upcoming.text.includes("21:00"), "başlamamış maçta saat yazılmalı");
  assert.ok(!/\d+-\d+/.test(upcoming.text), "başlamamış maçta skor yazılmamalı");
}

{
  // Kimlik alanı eksikse metin hiç üretilmez.
  assert.equal(buildMatchShareText({ homeTeam: "", awayTeam: "" }), null, "adsız maç paylaşılamaz");
  assert.equal(renderShareBlock(null, escapeHtml), "", "metin yoksa blok basılmamalı");
}

{
  const share = buildMatchShareText(finishedWithAnalysis, { path: "mac-raporu/fb-gz.html" });
  const html = renderShareBlock(share, escapeHtml);
  assert.ok(html.includes("data-share-block"), "blok istemci kancasını taşımalı");
  assert.ok(html.includes("data-share-copy"), "kopyalama düğmesi olmalı");

  // Panoya giden metin, ekranda görünen metnin aynısı olmalı.
  const attribute = html.match(/data-share-text="([^"]*)"/);
  assert.ok(attribute, "kopyalanacak metin öznitelikte olmalı");
  assert.equal(attribute[1], escapeHtml(share.full), "kopyalanan metin gösterilenle aynı olmalı");

  const targets = shareTargets(share);
  assert.equal(targets.length, 3, "üç paylaşım hedefi olmalı");
  for (const target of targets) {
    assert.ok(/^https:\/\//.test(target.href), `${target.key}: hedef https olmalı`);
  }
}

// ── 4. İstemci ile servis ayrışmamalı ──────────────────────────────────────

const blockMatch = appSource.match(/\/\/ daily-headlines:start([\s\S]*?)\/\/ daily-headlines:end/);
assert.ok(blockMatch, "app.js içinde daily-headlines bloğu bulunmalı");

const clientModule = new Function(`
  "use strict";
  function isLiveMatch(match) {
    if (!match) return false;
    if (match.live === true) return true;
    var status = String(match.status || match.providerStatus || "").toUpperCase();
    return ["LIVE", "IN_PLAY", "PAUSED", "HALFTIME", "1H", "HT", "2H", "ET", "BT", "P"].includes(status);
  }
  function isFinishedMatch(match) {
    var status = String((match && (match.status || match.providerStatus)) || "").toUpperCase();
    return ["FINISHED", "FT", "AET", "PEN", "AWARDED", "WO"].indexOf(status) !== -1;
  }
  function isTurkishMatch(match) {
    var names = ["Trabzonspor", "Fenerbahçe", "Galatasaray", "Beşiktaş", "Başakşehir", "Çaykur Rizespor"];
    return names.indexOf(String(match && match.homeTeam)) !== -1 ||
      names.indexOf(String(match && match.awayTeam)) !== -1;
  }
  ${blockMatch[1]}
  return {
    buildDailyHeadlines: buildDailyHeadlines,
    visibleQuickStats: visibleQuickStats
  };
`)();

const parityCases = [
  { label: "canlı + biten + başlayacak", list: [upcomingTurkish, finishedWithAnalysis, liveTurkish] },
  { label: "kancasız adaylar", list: [finishedWithoutHook, upcomingWithoutHook] },
  { label: "yalnızca başlayacak", list: [upcomingTurkish] },
  { label: "boş liste", list: [] },
  { label: "gerçek kürasyonlu liste", list: curatedMatches() }
];

for (const testCase of parityCases) {
  const fromService = buildDailyHeadlines(testCase.list, { today });
  const fromClient = clientModule.buildDailyHeadlines(testCase.list, { today });

  assert.deepEqual(
    fromClient.map((headline) => [headline.matchId, headline.title, headline.hook, headline.kicker, headline.href]),
    fromService.map((headline) => [headline.matchId, headline.title, headline.hook, headline.kicker, headline.href]),
    `${testCase.label}: istemci ve servis aynı başlıkları üretmeli`
  );
}

const quickStatCases = [
  { live: 0, upcoming: 1, finished: 0, analysisReady: 0, total: 1 },
  { live: 2, upcoming: 3, finished: 1, analysisReady: 4, total: 6 },
  { live: 0, upcoming: 0, finished: 0, analysisReady: 0, total: 0 },
  { live: null, upcoming: "x", finished: -1, analysisReady: undefined, total: 2 }
];

for (const counts of quickStatCases) {
  assert.deepEqual(
    clientModule.visibleQuickStats(counts).map((stat) => [stat.key, stat.value]),
    visibleQuickStats(counts).map((stat) => [stat.key, stat.value]),
    `sayaç eşliği bozuldu: ${JSON.stringify(counts)}`
  );
}

// ── 5. Gerçek depoda ne çıkıyor? ───────────────────────────────────────────

{
  const real = buildDailyHeadlines(curatedMatches(), { today: new Date().toISOString().slice(0, 10) });
  console.log(`test-home-signals: gerçek depodan ${real.length} başlık`);
  for (const headline of real) {
    console.log(`test-home-signals:   ${headline.kicker.padEnd(18)} ${headline.title}`);
    assert.ok(headline.hook.trim(), `${headline.matchId}: gerçek veride de kanca dolu olmalı`);
  }
}

console.log("Ana sayfa sinyalleri testleri geçti (sıfır sayaç gizlenir, kancasız başlık düşer, paylaşım metni uydurmaz, istemci-servis eşliği).");
