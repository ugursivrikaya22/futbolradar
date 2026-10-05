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
  MAX_FEATURED_SLIDES,
  ROTATION_INTERVAL_MS,
  bandOf,
  formatFeaturedSelectionLog,
  selectFeaturedMatch,
  selectFeaturedMatches,
  tierOf
} = require("../services/featuredMatchSelector.js");
const { isMajorClubName, majorClubNames } = require("../services/majorClubs.js");
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
  bandOf({ kickoff: "2026-07-30T20:00:00+03:00", status: "LIVE", score: { home: 0, away: 0 } }, noon),
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
const foreignLive = { id: "rennes-venezia", kickoff: "2026-07-30T18:45:00+03:00", homeTeam: "Rennes", awayTeam: "Venezia", league: "Hazırlık Maçı", status: "LIVE", score: { home: 0, away: 0 } };

// Sağlayıcı canlı demiyorsa büyük kart CANLILIK uydurmaz — ama bugünün
// henüz başlamamış Türk takımı maçını (Trendyol Süper Lig güvencesi)
// dürüst durumuyla gösterir. trabzonspor (18:30) ve basaksehir (19:00)
// kalkışı geçmiş, sağlayıcı onayı yok → "in-progress" tahmini olurdu ve
// dışarıda kalır; besiktas (20:00) henüz başlamadı → doğrulanmış "upcoming".
const staleStatuses = selectFeaturedMatch([foreignFriendly, besiktas, basaksehir, trabzonspor], { now, today });
assert.equal(staleStatuses.match.id, "fc-midtjylland-besiktas", "Canlı yokken bugünün henüz başlamamış Türk maçı kutuyu doldurmalı");
assert.equal(staleStatuses.reason, "turkish-upcoming", "Doğrulanmamış 'oynanıyor' tahmini değil, dürüst 'başlayacak' sebebi olmalı");

// Canlı olmayan Türk maçı, doğrulanmış canlı yabancı maçı ezemez.
const withForeignLive = selectFeaturedMatch([foreignLive, foreignFriendly, trabzonspor, besiktas], { now, today });
assert.equal(withForeignLive.match.id, "rennes-venezia", "Yalnızca doğrulanmış canlı maç büyük karta girmeli");

// Canlı Türk maçı, oynanmakta olan diğer Türk maçlarının önüne geçer.
const withTurkishLive = selectFeaturedMatch(
  [trabzonspor, { ...besiktas, status: "LIVE", score: { home: 0, away: 1 } }, foreignLive],
  { now, today }
);
assert.equal(withTurkishLive.match.id, "fc-midtjylland-besiktas", "Canlı Türk maçı en üste sabitlenmeli");
assert.equal(withTurkishLive.reason, "turkish-live", "Canlı Türk maçının sebebi turkish-live olmalı");

// Canlı yoksa, bugünün en yakın Türk maçı (henüz başlamadıysa saatiyle)
// büyük kartı doldurur — hepsi henüz başlamamış olduğu için en erken
// kalkışlı (trabzonspor, 18:30) öne çıkar.
const beforeKickoff = selectFeaturedMatch(
  [foreignFriendly, besiktas, basaksehir, trabzonspor],
  { now: new Date(Date.parse("2026-07-30T12:00:00+03:00")), today }
);
assert.equal(beforeKickoff.match.id, "trabzonspor-al-sadd", "Canlı yokken bugünün en erken Türk maçı büyük kartı doldurmalı");
assert.equal(beforeKickoff.reason, "turkish-upcoming", "Henüz başlamamış maçın sebebi turkish-upcoming olmalı");

// Canlı yoksa, bugün SAĞLAYICI TARAFINDAN onaylanmış biten bir Türk maçı
// (en son oynanan) büyük kartta sonucuyla kalır — "canlı" diye uydurulmaz.
const allFinished = selectFeaturedMatch(
  [
    { ...foreignFriendly, status: "SCHEDULED", kickoff: "2026-07-30T23:30:00+03:00" },
    { ...trabzonspor, status: "FINISHED", score: { home: 2, away: 1 } },
    { ...besiktas, status: "FINISHED", score: { home: 0, away: 3 } }
  ],
  { now: new Date(Date.parse("2026-07-30T22:30:00+03:00")), today }
);
assert.equal(allFinished.match, null, "Biten maçlar ana sayfa vitrininde kalmamalı");
assert.equal(allFinished.reason, "empty");

// Türk takımı maçı yoksa kural devreye girmez; normal sıralama uygulanır.
const noTurkish = selectFeaturedMatch([foreignFriendly, foreignLive], { now, today });
assert.equal(noTurkish.match.id, "rennes-venezia", "Türk maçı yokken canlı maç öne çıkar");
assert.equal(noTurkish.reason, "live", "Sebep Türk maçı olmadığını göstermeli");
assert.equal(noTurkish.turkish, false, "Yabancı maç Türk işaretlenmemeli");

// Ne canlı maç ne bugünün Türk maçı varsa kutu boş kalır — hâlâ uydurma yok.
const nothingToShow = selectFeaturedMatch([foreignFriendly], { now, today });
assert.equal(nothingToShow.match, null, "Ne canlı ne Türk maçı varken hero boş kalmalı");
assert.equal(nothingToShow.reason, "empty", "Boş seçim açıkça işaretlenmeli");

// Ertelenen/iptal edilen bugünün Türk maçı, canlı yokken bile kutuyu
// doldurmamalı: nihai bir sonucu ve kesin bir kalkış saati yok.
const postponedTurkish = selectFeaturedMatch(
  [{ ...trabzonspor, status: "POSTPONED" }, foreignFriendly],
  { now, today }
);
assert.equal(postponedTurkish.match, null, "Ertelenen Türk maçı büyük kartı doldurmamalı");

// Gerçekten canlı bir yabancı maç varsa, bugün henüz başlamamış bir Türk
// maçı bile onu deviremez — "canlı" her zaman "yakında başlayacak"tan önde.
const liveForeignBeatsUpcomingTurkish = selectFeaturedMatch(
  [foreignLive, besiktas],
  { now, today }
);
assert.equal(liveForeignBeatsUpcomingTurkish.match.id, "rennes-venezia",
  "Gerçek canlı maç, henüz başlamamış Türk maçının önünde kalmalı");

// Gece yarısını aşan canlı maç TSİ'de "dün" görünse de hero'ya girer — ama
// yalnızca gerçekten yakın zamanda kalkmışsa. "23:00'te başladı" + "00:45'te
// hâlâ canlı" bayat-canlı korumasının penceresi (150 dk) içinde kalır; bu
// yüzden burada paylaşılan `now` (19:08) DEĞİL, gece yarısını gerçekçi bir
// farkla aşan ayrı bir an kullanılır.
const overnightNow = new Date(Date.parse("2026-07-30T00:45:00+03:00"));
const overnight = selectFeaturedMatch(
  [{ ...trabzonspor, kickoff: "2026-07-29T23:00:00+03:00", status: "LIVE", score: { home: 1, away: 0 } }, foreignFriendly],
  { now: overnightNow, today: "2026-07-30" }
);
assert.equal(overnight.reason, "turkish-live", "Canlı Türk maçı tarih filtresine takılmamalı");

// Aynı maç, kalkışın üstünden bayat-canlı penceresini AŞAN bir "gece yarısını
// aşan" an için artık canlı sayılmamalı — tam da üretimde yakalanan hata bu:
// sağlayıcı bir maçı hiç FINISHED'e çevirmezse kayıt günlerce "canlı" kalıp
// hero'ya sabitleniyordu.
const staleOvernightNow = new Date(Date.parse("2026-07-30T19:08:00+03:00"));
const staleOvernight = selectFeaturedMatch(
  [{ ...trabzonspor, kickoff: "2026-07-29T23:00:00+03:00", status: "LIVE", score: { home: 1, away: 0 } }, foreignFriendly],
  { now: staleOvernightNow, today: "2026-07-30" }
);
assert.notEqual(staleOvernight.reason, "turkish-live",
  "Kalkıştan 150 dakikadan uzun süre geçmiş 'canlı' kayıt artık canlı sayılmamalı");
assert.equal(staleOvernight.match, null,
  "Bayat canlı kayıt havuzdan düşünce canlı olmayan bugünün maçı öne çıkmamalı");

// Bugün hiç canlı maç yoksa hero boş kalır.
const emptyDay = selectFeaturedMatch(
  [{ ...trabzonspor, kickoff: "2026-08-02T20:00:00+03:00" }],
  { now, today }
);
assert.equal(emptyDay.reason, "empty", "Canlı maç yoksa sıradaki karşılaşma büyük karta taşınmamalı");

const nothing = selectFeaturedMatch([], { now, today });
assert.equal(nothing.match, null, "Maç yoksa seçim boş dönmeli");
assert.equal(nothing.reason, "empty", "Boş seçimin sebebi empty olmalı");

// --- Büyük kulüp tespiti ---
for (const name of ["Real Madrid", "Bayern München", "Bayern Munich", "Manchester City",
  "Paris Saint-Germain", "PSG", "Inter", "AC Milan", "Liverpool", "Ajax"]) {
  assert.equal(isMajorClubName(name), true, `${name} büyük kulüp sayılmalı`);
}

// Tam ad eşleşmesi: "Inter" büyük kulüp ama "Inter Turku" değil.
assert.equal(isMajorClubName("Inter Turku"), false, "Inter Turku büyük kulüp sayılmamalı");
assert.equal(isMajorClubName("Osijek"), false, "Osijek büyük kulüp sayılmamalı");
assert.equal(isMajorClubName("Rennes"), false, "Rennes bu listede yok");
assert.equal(isMajorClubName(""), false, "Boş ad büyük kulüp sayılmamalı");

// --- KARUSEL SIRASI ---
const realMadridLive = { id: "real-madrid-osijek", kickoff: "2026-07-30T19:00:00+03:00", homeTeam: "Real Madrid", awayTeam: "Osijek", league: "Hazırlık Maçı", status: "LIVE", score: { home: 1, away: 0 } };
const bayernLive = { id: "bayern-aek", kickoff: "2026-07-30T19:30:00+03:00", homeTeam: "Bayern München", awayTeam: "AEK Athens", league: "Hazırlık Maçı", status: "LIVE", score: { home: 0, away: 0 } };

// Canlı Türk maçı ilk karta sabitlenir; kalanlar arkasından sıralanır.
const rotation = selectFeaturedMatches(
  [foreignFriendly, realMadridLive, besiktas, { ...trabzonspor, status: "LIVE", score: { home: 2, away: 1 } }, foreignLive],
  { now, today }
);
assert.equal(rotation[0].match.id, "trabzonspor-al-sadd", "Canlı Türk maçı ilk kart olmalı");
assert.equal(rotation[0].reason, "turkish-live", "İlk kartın sebebi turkish-live olmalı");
assert.equal(rotation[1].match.id, "rennes-venezia", "Aynı öncelik kademesinde erken başlayan maç önde olmalı");
assert.equal(rotation[2].match.id, "real-madrid-osijek", "Büyük kulüp etiketi editoryal lig sırasını ezmemeli");
assert.equal(rotation[2].reason, "major-live", "Büyük kulüp maçının sebebi major-live kalmalı");
assert.equal(rotation[2].major, true, "Büyük kulüp işareti taşımalı");
assert.equal(rotation.length, 3, "Canlı olmayan maçlar karusele girmemeli");

// Türk maçı yokken hazırlık maçları aynı "diğer" kademesinde başlama
// saatine göre sıralanır; kulüp şöhreti editoryal lig sırasını ezmez.
const majorFirst = selectFeaturedMatches([foreignFriendly, foreignLive, bayernLive, realMadridLive], { now, today });
assert.equal(majorFirst[0].match.id, "rennes-venezia", "Diğer kademesinde en erken canlı maç ilk olmalı");
assert.equal(majorFirst[1].match.id, "real-madrid-osijek", "İkinci başlama saati hemen arkasında olmalı");
assert.equal(majorFirst[2].match.id, "bayern-aek", "Daha geç başlayan maç sonra gelmeli");
assert.equal(majorFirst[1].reason, "major-live", "Büyük kulüp açıklama etiketi korunmalı");

// Bugün Türk maçı varsa, yabancı bir maç canlı olsa bile ilk kart Türk maçıdır.
const turkishBeatsMajor = selectFeaturedMatches([realMadridLive, { ...trabzonspor, status: "LIVE", score: { home: 0, away: 0 } }], { now, today });
assert.equal(turkishBeatsMajor[0].match.id, "trabzonspor-al-sadd", "Canlı Türk maçı büyük kulübün canlı maçını geçer");
assert.equal(turkishBeatsMajor[1].match.id, "real-madrid-osijek", "Büyük kulüp maçı karuselde ikinci kart");

// ── Canlı olmayan sıradaki Türk maçı hero'ya girmez ──────────────────────
const nextTurkishFixture = {
  id: "sturm-graz-fenerbahce",
  kickoff: "2026-07-31T21:30:00+03:00",
  homeTeam: "Sturm Graz",
  awayTeam: "Fenerbahçe",
  league: "Şampiyonlar Ligi",
  status: "SCHEDULED"
};

const noTurkishToday = selectFeaturedMatches(
  [foreignFriendly, foreignLive, nextTurkishFixture],
  { now, today }
);
assert.equal(noTurkishToday.length, 1, "Yalnızca doğrulanmış canlı maç kalmalı");
assert.equal(noTurkishToday[0].match.id, "rennes-venezia", "Canlı olmayan Türk maçı büyük karta taşınmamalı");

// Bugün Türk maçı VARSA sıradaki maç öne alınmaz: bugünkü maç her zaman önde.
const turkishTodayWins = selectFeaturedMatches([foreignLive, nextTurkishFixture, { ...trabzonspor, status: "LIVE", score: { home: 1, away: 1 } }], { now, today });
assert.equal(turkishTodayWins[0].match.id, "trabzonspor-al-sadd", "Bugünkü Türk maçı sıradakinin önünde olmalı");
assert.equal(turkishTodayWins[0].reason, "turkish-live", "Canlı Türk maçı doğru etiketlenmeli");

assert.equal(tierOf({ ...trabzonspor, status: "LIVE", score: { home: 0, away: 0 } }, noon), 0, "Canlı Türk maçı kademe 0");
assert.equal(tierOf(trabzonspor, noon), 1, "Bugünün Türk maçı kademe 1");
assert.equal(tierOf(realMadridLive, noon), 5, "Katalog dışı hazırlık maçı diğerler kademesinde");
assert.equal(tierOf(foreignLive, noon), 5, "Diğer canlı maç kademe 5");
assert.equal(tierOf(foreignFriendly, noon), 6, "Canlı olmayan yabancı maç canlı sırasının dışında");

// Karusel sınırı: havuz büyüse de kart sayısı sabit tavanda kalır.
const crowd = Array.from({ length: 12 }, (unused, index) => ({
  id: `crowd-${index}`,
  kickoff: `2026-07-30T2${index % 2}:00:00+03:00`,
  homeTeam: "AEK Athens",
  awayTeam: "Osijek",
  league: "Hazırlık Maçı",
  status: "LIVE",
  score: { home: index % 3, away: 0 }
}));
assert.equal(
  selectFeaturedMatches(crowd, { now, today }).length,
  MAX_FEATURED_SLIDES,
  `Karusel en fazla ${MAX_FEATURED_SLIDES} kart göstermeli`
);
assert.equal(
  selectFeaturedMatches(crowd, { now, today, limit: 2 }).length,
  2,
  "limit seçeneği kart sayısını daraltmalı"
);
assert.equal(ROTATION_INTERVAL_MS, 10000, "Kart değişim aralığı 10 saniye olmalı");

// selectFeaturedMatch karuselin ilk kartını verir.
assert.equal(
  selectFeaturedMatch([foreignFriendly, realMadridLive, trabzonspor], { now, today }).match.id,
  selectFeaturedMatches([foreignFriendly, realMadridLive, trabzonspor], { now, today })[0].match.id,
  "Tekil seçim karuselin ilk kartıyla aynı olmalı"
);

// --- Günlük satırı ---
const logLine = formatFeaturedSelectionLog("test", withTurkishLive, 1);
assert.match(logLine, /^\[futbolradar:featured-match\]/, "Günlük ortak önekle başlamalı");
assert.match(logLine, /slot=1/, "Günlükte kaçıncı kart olduğu yazmalı");
assert.match(logLine, /reason=turkish-live/, "Günlükte seçim sebebi yazmalı");
assert.match(logLine, /turkish=true/, "Günlükte Türk maçı bilgisi yazmalı");
assert.match(logLine, /id=fc-midtjylland-besiktas/, "Günlükte seçilen maç id'si yazmalı");
assert.match(
  formatFeaturedSelectionLog("test", majorFirst[1], 2),
  /major=true majorClub="Real Madrid"/,
  "Büyük kulüp seçimi günlükte işaretlenmeli"
);

// --- Gerçek veri üzerinde değişmez kural ---
// Tarih ilerledikçe veri değişir; sabit bir maç yerine kuralın kendisi
// doğrulanır: havuzda canlı Türk takımı maçı varsa seçim Türk maçı olmalı.
const live = curatedMatches();
const realToday = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit"
}).format(new Date());
const realSelection = selectFeaturedMatch(live, { today: realToday });
const realRotation = selectFeaturedMatches(live, { today: realToday });
const realTurkishPool = realRotation.filter((entry) => entry.turkish);

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

const emptyFeaturedFallback = appSource.match(/if \(!featured\) \{\s*return \(\s*([\s\S]*?)\n\s*\);\s*\}/);
assert.ok(emptyFeaturedFallback, "app.js içinde boş featured hero dönüşü bulunmalı");
assert.match(
  emptyFeaturedFallback[1],
  /data-featured-carousel/,
  "boş featured hero istemcide de karusel kapsayıcısını korumalı"
);
assert.match(
  emptyFeaturedFallback[1],
  /data-featured-slide="0"/,
  "boş featured hero tek slayt olarak işaretlenmeli"
);
assert.match(
  emptyFeaturedFallback[1],
  /featured-match-actions/,
  "boş featured hero çıkış bağlantılarını korumalı"
);

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

// Canlılık kapısı TAKLİT EDİLMEZ. Hero'nun "bu maç canlı mı?" kararı
// LiveGuard'a (app.js#live-freshness-guard) bağlı; burada basit bir taklit
// kullanılsaydı test gerçek istemciyi değil taklidi ölçerdi — tazelik
// kapısını taklit, servis ise gerçekten uyguladığı için ayrışma tam da
// testin göremediği yerde kalırdı. Blok olduğu gibi alınır.
const guardMatch = appSource.match(
  /\/\/ live-freshness-guard:start([\s\S]*?)\/\/ live-freshness-guard:end/
);
assert.ok(guardMatch, "app.js içinde live-freshness-guard bloğu bulunmalı");

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
  function todayInIstanbul() {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit"
    }).format(new Date());
  }
  ${guardMatch[1]}
  ${blockMatch[1]}
  return {
    selectFeaturedMatchEntry: selectFeaturedMatchEntry,
    selectFeaturedMatchEntries: selectFeaturedMatchEntries,
    isTurkishMatch: isTurkishMatch,
    isMajorClubName: isMajorClubName,
    MAJOR_CLUB_NAMES: MAJOR_CLUB_NAMES,
    FEATURED_ROTATION_MS: FEATURED_ROTATION_MS,
    FEATURED_MAX_SLIDES: FEATURED_MAX_SLIDES
  };
`)();

const parityCases = [
  { label: "durum bayat, Trabzonspor oynanıyor", list: [foreignFriendly, besiktas, basaksehir, trabzonspor], now, today },
  { label: "yabancı canlı maç varken", list: [foreignLive, foreignFriendly, trabzonspor, besiktas], now, today },
  { label: "canlı Türk maçı", list: [trabzonspor, { ...besiktas, status: "LIVE" }, foreignLive], now, today },
  { label: "maç öncesi", list: [foreignFriendly, besiktas, basaksehir, trabzonspor], now: new Date(Date.parse("2026-07-30T12:00:00+03:00")), today },
  { label: "Türk maçı yok", list: [foreignFriendly, foreignLive], now, today },
  { label: "büyük kulüp sırası", list: [foreignFriendly, foreignLive, bayernLive, realMadridLive], now, today },
  { label: "tam karusel", list: [foreignFriendly, realMadridLive, besiktas, { ...trabzonspor, status: "LIVE" }, foreignLive], now, today },
  { label: "gerçek kürasyonlu liste", list: live, now: new Date(), today: realToday }
];

for (const testCase of parityCases) {
  const options = { now: testCase.now, today: testCase.today };
  const fromService = selectFeaturedMatch(testCase.list, options);
  const fromClient = clientModule.selectFeaturedMatchEntry(testCase.list, options);

  assert.equal(
    (fromClient.match && fromClient.match.id) || null,
    (fromService.match && fromService.match.id) || null,
    `İstemci ve servis aynı maçı seçmeli (${testCase.label})`
  );
  assert.equal(fromClient.reason, fromService.reason, `Seçim sebebi de aynı olmalı (${testCase.label})`);
  assert.equal(fromClient.turkish, fromService.turkish, `Türk maçı işareti aynı olmalı (${testCase.label})`);
  assert.equal(fromClient.major, fromService.major, `Büyük kulüp işareti aynı olmalı (${testCase.label})`);

  // Yalnızca ilk kart değil, karuselin TAMAMI aynı sırada olmalı: statik
  // yedek Node'da, canlı sayfa tarayıcıda üretiliyor. Sıralar ayrışırsa JS
  // yüklendiğinde kartlar yerinden oynar.
  const serviceOrder = selectFeaturedMatches(testCase.list, options);
  const clientOrder = clientModule.selectFeaturedMatchEntries(testCase.list, options);

  assert.deepEqual(
    clientOrder.map((entry) => `${entry.match.id}:${entry.reason}`),
    serviceOrder.map((entry) => `${entry.match.id}:${entry.reason}`),
    `İstemci ve servis karusel sırası aynı olmalı (${testCase.label})`
  );
}

assert.equal(clientModule.FEATURED_ROTATION_MS, ROTATION_INTERVAL_MS, "Dönüş aralığı iki tarafta aynı olmalı");
assert.equal(clientModule.FEATURED_MAX_SLIDES, MAX_FEATURED_SLIDES, "Kart tavanı iki tarafta aynı olmalı");

// Büyük kulüp listesi de ayrışmamalı.
const clientMajorKeys = new Set(clientModule.MAJOR_CLUB_NAMES.map((name) => String(name)
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/ı/g, "i")
  .trim()
  .toLowerCase()
  .replace(/\s+/g, " ")));
const missingMajor = majorClubNames()
  .map((name) => String(name).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i").trim().toLowerCase().replace(/\s+/g, " "))
  .filter((name) => !clientMajorKeys.has(name));
assert.deepEqual(
  missingMajor,
  [],
  `app.js MAJOR_CLUB_NAMES listesi eksik: ${missingMajor.join(", ")} — services/majorClubs.js ile eşitlenmeli`
);

for (const name of ["Real Madrid", "Bayern München", "PSG", "Inter"]) {
  assert.equal(clientModule.isMajorClubName(name), true, `İstemci ${name} kulübünü büyük saymalı`);
}
assert.equal(clientModule.isMajorClubName("Inter Turku"), false, "İstemci Inter Turku'yu büyük kulüp saymamalı");

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
