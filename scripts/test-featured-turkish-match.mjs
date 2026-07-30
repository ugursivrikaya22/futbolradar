import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();

const {
  isTurkishLeague,
  isTurkishMatch,
  isTurkishTeamName,
  turkishSideOf,
  turkishTeamNames
} = require("../services/turkishTeams.js");
const {
  bandOf,
  formatFeaturedSelectionLog,
  selectFeaturedMatch
} = require("../services/featuredMatchSelector.js");
const { curatedMatches } = require("../services/providers/mockProvider.js");

// --- Türk takımı tespiti ---
for (const name of ["Trabzonspor", "Fenerbahçe", "Galatasaray", "Beşiktaş", "Çaykur Rizespor",
  "Göztepe", "Başakşehir", "Kasımpaşa", "Amed Sportif Faaliyetler", "Ümraniyespor",
  "İstanbulspor", "Gaziantep FK", "Çorum FK", "Kocaelispor"]) {
  assert.equal(isTurkishTeamName(name), true, `${name} Türk takımı sayılmalı`);
}

for (const name of ["AEK Athens", "Al-Sadd", "Górnik Zabrze", "FC Midtjylland", "Osijek",
  "Hull City", "AC Monza", "Rennes", "Venezia", "Ittihad Kalba", "IMT Novi Beograd", "Rudeš"]) {
  assert.equal(isTurkishTeamName(name), false, `${name} Türk takımı sayılmamalı`);
}

// Ad benzerliği tuzağı: Finlandiya'dan Inter Turku fikstür takviminde var ve
// "turk" arayan bir kısayol onu Türk maçı sayıp hero kartını yanlış doldurur.
assert.equal(isTurkishTeamName("Inter Turku"), false, "Inter Turku Türk takımı değil");
assert.equal(isTurkishTeamName("Sporting CP"), false, "Sporting CP '-spor' kuralına takılmamalı");
assert.equal(isTurkishTeamName("Sport Recife"), false, "Sport Recife Türk takımı sayılmamalı");

// "-spor" son eki: listede olmayan bir Türk kulübü de tanınmalı.
assert.equal(isTurkishTeamName("Nazillispor"), true, "'-spor' ile biten kulüp Türk sayılmalı");
assert.equal(isTurkishTeamName("Spor"), false, "Tek başına 'Spor' kulüp adı değil");

assert.equal(isTurkishLeague("Trendyol Süper Lig"), true, "Süper Lig Türk organizasyonu");
assert.equal(isTurkishLeague("Ziraat Türkiye Kupası"), true, "Türkiye Kupası Türk organizasyonu");
assert.equal(isTurkishLeague("UEFA Avrupa Ligi"), false, "Avrupa Ligi Türk organizasyonu değil");

assert.equal(
  isTurkishMatch({ homeTeam: "Inter Turku", awayTeam: "Başakşehir" }),
  true,
  "Deplasmandaki Türk takımı da maçı Türk maçı yapar"
);
assert.equal(
  isTurkishMatch({ homeTeam: "Bilinmeyen A", awayTeam: "Bilinmeyen B", league: "Trendyol Süper Lig" }),
  true,
  "Süper Lig maçı takım adı tanınmasa da Türk maçıdır"
);
assert.equal(
  isTurkishMatch({ homeTeam: "AEK Athens", awayTeam: "Osijek", league: "Hazırlık Maçı" }),
  false,
  "İki yabancı takımın hazırlık maçı Türk maçı değil"
);
assert.equal(
  turkishSideOf({ homeTeam: "Inter Turku", awayTeam: "Başakşehir" }),
  "Başakşehir",
  "Günlüğe yazılan taraf Türk takımı olmalı"
);

// --- Bant tespiti ---
const noon = Date.parse("2026-07-30T19:08:00+03:00");
assert.equal(
  bandOf({ kickoff: "2026-07-30T18:30:00+03:00", status: "SCHEDULED" }, noon),
  "in-progress",
  "Başlama saati geçmiş, bitmemiş maç oynanıyor sayılmalı"
);
assert.equal(
  bandOf({ kickoff: "2026-07-30T20:00:00+03:00", status: "SCHEDULED" }, noon),
  "upcoming",
  "Saati gelmemiş maç başlayacak sayılmalı"
);
assert.equal(
  bandOf({ kickoff: "2026-07-30T15:00:00+03:00", status: "SCHEDULED" }, noon),
  "played",
  "Pencereyi aşan maç oynanmış sayılmalı"
);
assert.equal(
  bandOf({ kickoff: "2026-07-30T20:00:00+03:00", status: "LIVE" }, noon),
  "live",
  "Sağlayıcı canlı diyorsa bant live olmalı"
);
assert.equal(
  bandOf({ kickoff: "2026-07-30", status: "SCHEDULED" }, noon),
  "upcoming",
  "Saati açıklanmamış maç oynanıyor sayılamaz"
);

// --- ANA KURAL: bugün ya da canlı Türk takımı maçı hero'yu alır ---
const today = "2026-07-30";
const now = new Date(noon);

// Bugünün gerçek şekli: üç Türk takımı maçı + bir yabancı hazırlık maçı.
const trabzonspor = { id: "trabzonspor-al-sadd", kickoff: "2026-07-30T18:30:00+03:00", homeTeam: "Trabzonspor", awayTeam: "Al-Sadd", league: "Hazırlık Maçı", status: "SCHEDULED" };
const basaksehir = { id: "inter-turku-basaksehir", kickoff: "2026-07-30T19:00:00+03:00", homeTeam: "Inter Turku", awayTeam: "Başakşehir", league: "Konferans Ligi", status: "SCHEDULED" };
const besiktas = { id: "fc-midtjylland-besiktas", kickoff: "2026-07-30T20:00:00+03:00", homeTeam: "FC Midtjylland", awayTeam: "Beşiktaş", league: "Avrupa Ligi", status: "SCHEDULED" };
const foreignFriendly = { id: "aek-osijek", kickoff: "2026-07-30T17:00:00+03:00", homeTeam: "AEK Athens", awayTeam: "Osijek", league: "Hazırlık Maçı", status: "SCHEDULED" };
const foreignLive = { id: "rennes-venezia", kickoff: "2026-07-30T18:45:00+03:00", homeTeam: "Rennes", awayTeam: "Venezia", league: "Hazırlık Maçı", status: "LIVE" };

// Sağlayıcı durumu tazelemediğinde bile (hepsi "SCHEDULED") 19:08'de
// oynanmakta olan Trabzonspor maçı hero'ya gelir.
const staleStatuses = selectFeaturedMatch([foreignFriendly, besiktas, basaksehir, trabzonspor], { now, today });
assert.equal(staleStatuses.match.id, "trabzonspor-al-sadd", "Oynanmakta olan Trabzonspor maçı hero'da olmalı");
assert.equal(staleStatuses.reason, "turkish-in-progress", "Seçim sebebi Türk maçını işaret etmeli");
assert.equal(staleStatuses.turkish, true, "Seçilen maç Türk maçı işaretlenmeli");
assert.equal(staleStatuses.turkishTeam, "Trabzonspor", "Günlükte Türk taraf yazmalı");

// Yabancı bir maç CANLI olsa bile Türk takımı maçını ezemez.
const withForeignLive = selectFeaturedMatch([foreignLive, foreignFriendly, trabzonspor, besiktas], { now, today });
assert.equal(withForeignLive.match.id, "trabzonspor-al-sadd", "Canlı yabancı maç Türk maçını ezmemeli");

// Canlı Türk maçı, oynanmakta olan diğer Türk maçlarının önüne geçer.
const withTurkishLive = selectFeaturedMatch(
  [trabzonspor, { ...besiktas, status: "LIVE" }, foreignLive],
  { now, today }
);
assert.equal(withTurkishLive.match.id, "fc-midtjylland-besiktas", "Canlı Türk maçı en üste sabitlenmeli");
assert.equal(withTurkishLive.reason, "turkish-live", "Canlı Türk maçının sebebi turkish-live olmalı");

// Canlı yoksa bugünün en yakın Türk takımı maçı gelir.
const beforeKickoff = selectFeaturedMatch(
  [foreignFriendly, besiktas, basaksehir, trabzonspor],
  { now: new Date(Date.parse("2026-07-30T12:00:00+03:00")), today }
);
assert.equal(beforeKickoff.match.id, "trabzonspor-al-sadd", "Gün içinde en yakın Türk maçı seçilmeli");
assert.equal(beforeKickoff.reason, "turkish-upcoming", "Sebep turkish-upcoming olmalı");

// Bugünün Türk maçları bittiyse hero yine Türk maçında kalır.
const allFinished = selectFeaturedMatch(
  [
    { ...foreignFriendly, status: "SCHEDULED", kickoff: "2026-07-30T23:30:00+03:00" },
    { ...trabzonspor, status: "FINISHED", score: { home: 2, away: 1 } },
    { ...besiktas, status: "FINISHED", score: { home: 0, away: 3 } }
  ],
  { now: new Date(Date.parse("2026-07-30T22:30:00+03:00")), today }
);
assert.equal(allFinished.match.id, "fc-midtjylland-besiktas", "Biten Türk maçlarından en yenisi seçilmeli");
assert.equal(allFinished.reason, "turkish-played", "Sebep turkish-played olmalı");

// Türk takımı maçı yoksa kural devreye girmez; normal sıralama uygulanır.
const noTurkish = selectFeaturedMatch([foreignFriendly, foreignLive], { now, today });
assert.equal(noTurkish.match.id, "rennes-venezia", "Türk maçı yokken canlı maç öne çıkar");
assert.equal(noTurkish.reason, "live", "Sebep Türk maçı olmadığını göstermeli");
assert.equal(noTurkish.turkish, false, "Yabancı maç Türk işaretlenmemeli");

// Gece yarısını aşan canlı maç TSİ'de "dün" görünse de hero'ya girer.
const overnight = selectFeaturedMatch(
  [{ ...trabzonspor, kickoff: "2026-07-29T23:00:00+03:00", status: "LIVE" }, foreignFriendly],
  { now, today }
);
assert.equal(overnight.reason, "turkish-live", "Canlı Türk maçı tarih filtresine takılmamalı");

// Bugün hiç maç yoksa hero boş kalmaz; takvimdeki sıradaki maç gösterilir.
const emptyDay = selectFeaturedMatch(
  [{ ...trabzonspor, kickoff: "2026-08-02T20:00:00+03:00" }],
  { now, today }
);
assert.equal(emptyDay.reason, "next-fixture", "Bugün maç yoksa sıradaki karşılaşma gösterilmeli");

const nothing = selectFeaturedMatch([], { now, today });
assert.equal(nothing.match, null, "Maç yoksa seçim boş dönmeli");
assert.equal(nothing.reason, "empty", "Boş seçimin sebebi empty olmalı");

// --- Günlük satırı ---
const logLine = formatFeaturedSelectionLog("test", staleStatuses);
assert.match(logLine, /^\[futbolradar:featured-match\]/, "Günlük ortak önekle başlamalı");
assert.match(logLine, /reason=turkish-in-progress/, "Günlükte seçim sebebi yazmalı");
assert.match(logLine, /turkish=true/, "Günlükte Türk maçı bilgisi yazmalı");
assert.match(logLine, /id=trabzonspor-al-sadd/, "Günlükte seçilen maç id'si yazmalı");

// --- Gerçek veri üzerinde değişmez kural ---
// Tarih ilerledikçe veri değişir; sabit bir maç yerine kuralın kendisi
// doğrulanır: havuzda Türk takımı maçı varsa seçim Türk maçı OLMAK ZORUNDA.
const live = curatedMatches();
const realToday = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit"
}).format(new Date());
const realSelection = selectFeaturedMatch(live, { today: realToday });
const realPool = live.filter((match) => String(match.kickoff || "").slice(0, 10) === realToday);
const realTurkishPool = realPool.filter(isTurkishMatch);

if (realTurkishPool.length) {
  assert.equal(
    realSelection.turkish,
    true,
    `Bugün ${realTurkishPool.length} Türk takımı maçı var; hero kartı Türk maçı göstermeli ` +
    `(seçilen: ${realSelection.match && realSelection.match.id})`
  );
  assert.match(realSelection.reason, /^turkish-/, "Gerçek veride sebep turkish- ile başlamalı");
}

// --- İstemci listesi ile servis kapsamı ayrışmamalı ---
// app.js fikstür dosyasını beklemeden karar verebilmek için listeyi kopyalar.
// Süper Lig'e yeni bir takım geldiğinde bu test kırılır ve kopya güncellenir.
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const listMatch = appSource.match(/var TURKISH_TEAM_NAMES = \[([\s\S]*?)\];/);
assert.ok(listMatch, "app.js içinde TURKISH_TEAM_NAMES listesi bulunmalı");

const clientNames = JSON.parse(`[${listMatch[1]}]`);
const clientKeys = new Set(clientNames.map((name) => String(name)
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/ı/g, "i")
  .trim()
  .toLowerCase()
  .replace(/\s+/g, " ")));

const missing = [...turkishTeamNames()].filter((name) => !clientKeys.has(name));
assert.deepEqual(
  missing,
  [],
  `app.js TURKISH_TEAM_NAMES listesi eksik: ${missing.join(", ")} — services/turkishTeams.js ile eşitlenmeli`
);

// --- İstemci ve servis AYNI maçı seçmeli ---
// Kural iki yerde yaşıyor (statik yedek Node'da üretiliyor, canlı sayfa
// tarayıcıda çiziliyor). İkisi ayrışırsa sayfa açılışta bir maç, JS
// yüklenince başka bir maç gösterir; hero kartı "atlar". Blok app.js'ten
// ayıklanıp aynı girdilerle çalıştırılarak karşılaştırılır.
const blockMatch = appSource.match(
  /\/\/ featured-match-selection:start([\s\S]*?)\/\/ featured-match-selection:end/
);
assert.ok(blockMatch, "app.js içinde featured-match-selection bloğu bulunmalı");

const clientModule = new Function(`
  "use strict";
  var window = { console: { info: function () {} } };
  var console = window.console;
  function normalizeSearchText(value) {
    return String(value || "")
      .toLocaleLowerCase("tr-TR")
      .normalize("NFD")
      .replace(/[\\u0300-\\u036f]/g, "")
      .replace(/ı/g, "i");
  }
  function matchDateValue(match) {
    var value = match && (match.kickoff || match.date || match.utcDate);
    return value ? String(value).slice(0, 10) : "";
  }
  function isLiveMatch(match) {
    if (!match) return false;
    if (match.live === true) return true;
    var status = String(match.status || match.providerStatus || "").toUpperCase();
    return ["LIVE", "IN_PLAY", "PAUSED", "HALFTIME", "1H", "HT", "2H", "ET", "BT", "P"].includes(status);
  }
  function todayInIstanbul() {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit"
    }).format(new Date());
  }
  ${blockMatch[1]}
  return { selectFeaturedMatchEntry: selectFeaturedMatchEntry, isTurkishMatch: isTurkishMatch };
`)();

const parityCases = [
  { label: "durum bayat, Trabzonspor oynanıyor", list: [foreignFriendly, besiktas, basaksehir, trabzonspor], now, today },
  { label: "yabancı canlı maç varken", list: [foreignLive, foreignFriendly, trabzonspor, besiktas], now, today },
  { label: "canlı Türk maçı", list: [trabzonspor, { ...besiktas, status: "LIVE" }, foreignLive], now, today },
  { label: "maç öncesi", list: [foreignFriendly, besiktas, basaksehir, trabzonspor], now: new Date(Date.parse("2026-07-30T12:00:00+03:00")), today },
  { label: "Türk maçı yok", list: [foreignFriendly, foreignLive], now, today },
  { label: "gerçek kürasyonlu liste", list: live, now: new Date(), today: realToday }
];

for (const testCase of parityCases) {
  const fromService = selectFeaturedMatch(testCase.list, { now: testCase.now, today: testCase.today });
  const fromClient = clientModule.selectFeaturedMatchEntry(testCase.list, { now: testCase.now, today: testCase.today });

  assert.equal(
    (fromClient.match && fromClient.match.id) || null,
    (fromService.match && fromService.match.id) || null,
    `İstemci ve servis aynı maçı seçmeli (${testCase.label})`
  );
  assert.equal(fromClient.reason, fromService.reason, `Seçim sebebi de aynı olmalı (${testCase.label})`);
  assert.equal(fromClient.turkish, fromService.turkish, `Türk maçı işareti aynı olmalı (${testCase.label})`);
}

for (const name of ["Trabzonspor", "Başakşehir", "Çaykur Rizespor", "İstanbulspor", "Nazillispor"]) {
  assert.equal(
    clientModule.isTurkishMatch({ homeTeam: name, awayTeam: "AEK Athens" }),
    true,
    `İstemci ${name} maçını Türk maçı saymalı`
  );
}
assert.equal(
  clientModule.isTurkishMatch({ homeTeam: "Inter Turku", awayTeam: "Osijek" }),
  false,
  "İstemci Inter Turku maçını Türk maçı saymamalı"
);

console.log("test-featured-turkish-match: OK");
