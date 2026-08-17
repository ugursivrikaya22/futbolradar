/**
 * MAÇ PROGRAMI YÜZEYİ — "Bugünün Maçları" sayfasının tek kuralı.
 *
 * NEDEN BU DOSYA VAR. Sayfanın statik yedeği ile istemci çizimi aynı listeyi
 * İKİ AYRI kuralla üretiyordu:
 *
 *   - Statik yedek (scripts/prerender-core-pages.mjs) listeyi BAŞLAMA
 *     SAATİNE göre sıralıyor ve ilk on ikisini basıyordu.
 *   - İstemci (app.js) sağlayıcıdan gelen sırayı koruyup liglere göre
 *     bloklara ayırıyordu.
 *
 * İkisi de Faz 2.3'te kurulan ilgi puanını (services/matchRelevance.js)
 * kullanmıyordu. Sonuç ölçüldü: 12 Ağustos 2026'da sayfanın statik hâlinde
 * basılan on iki maçın onu 15:00–19:15 arasındaki hazırlık maçlarıydı; aynı
 * günün Konferans Ligi eleme maçları, Leeds–Manchester United ve
 * Deportivo–Real Madrid pencerenin DIŞINDA kalıyordu. Yani sitenin bir
 * numaralı hedef sorgusunda Google'ın gördüğü liste, günün en çok aranan
 * maçlarını hiç içermiyordu.
 *
 * Kural bu yüzden burada, tek yerde: sıralama, lig grupları, iç bağlantı
 * hedefi ve sayfanın SSS'i. Statik üretici de İngilizce üretici de buradan
 * okur; istemci aynı sırayı kayda damgalanmış `relevance` alanından üretir
 * (yarışma kataloğu tarayıcıya inmez).
 *
 * VERİ UYDURULMAZ. SSS metinleri yalnızca elde OLAN kayıtlardan sayılır;
 * "bugün Süper Lig maçı yok" gibi olumsuz bir iddia ÜRETİLMEZ, çünkü bu
 * iddia bizim fikstür kapsamımızın tam olduğunu varsayar. Bir soru ancak
 * cevabı veriden okunabiliyorsa basılır.
 */
const { sortByRelevance } = require("./matchRelevance.js");
const { canonicalStatus, matchDay } = require("./matchStatus.js");
const { isTurkishTeamName } = require("./turkishTeams.js");
const { resolveCompetitionId, findCompetition } = require("./competitionCatalog.js");

/** Sayfa başına basılan en fazla lig bloğu — SSS'te ad sayarken de geçerli. */
const FAQ_LEAGUE_LIMIT = 6;

function text(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return "";
}

/**
 * SIRALAMA. İlgi puanı kuralı services/matchRelevance.js'te; burada yalnızca
 * çağrılır. Hiçbir maç ELENMEZ — pencereleme ayrı bir adım
 * (services/matchListWindow.js).
 */
function orderMatchProgram(matches, options = {}) {
  return sortByRelevance(Array.isArray(matches) ? matches : [], options);
}

/**
 * LİG BLOKLARI. Gelen sıra korunur: liste ilgi puanına göre sıralanmışsa
 * bloklar da o sırada çıkar, yani Süper Lig ve UEFA blokları hazırlık
 * maçlarının üstünde durur.
 *
 * Lig adı boş olan kayıt ATILMAZ; adsız blok başlığı çağırandan gelir.
 *
 * KÜMELEME ANAHTARI KATALOG KİMLİĞİDİR, HAM METİN DEĞİL. Maç katalogda
 * doğrulanmış bir yarışmaya çözülüyorsa (öncelik sırasıyla sağlayıcı
 * kimliği, sonra ad) o kaydın KANONİK adı kullanılır — "Süper Lig" ve
 * "Trendyol Süper Lig" artık iki ayrı blok üretmez, ikisi de aynı kovaya
 * düşer. Katalogda karşılığı olmayan bir yarışma (bkz.
 * services/competitionCatalog.js: resolveCompetitionId) eskisi gibi ham
 * metnine göre kümelenir — kayıp yok, yalnızca daha güvenilir eşleşme.
 */
function groupMatchesByLeague(matches) {
  const list = Array.isArray(matches) ? matches : [];
  const order = [];
  const groups = new Map();
  const labels = new Map();

  for (const match of list) {
    if (!match || typeof match !== "object") continue;
    const resolvedId = resolveCompetitionId(match);
    const competition = resolvedId ? findCompetition(resolvedId) : null;
    const label = competition ? competition.name : text(match.league);
    const key = competition ? `id:${competition.id}` : `raw:${label}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      labels.set(key, label);
      order.push(key);
    }
    groups.get(key).push(match);
  }

  return order.map((key) => ({ league: labels.get(key), matches: groups.get(key) }));
}

/**
 * MAÇ AYRINTISI BAĞLANTISI — istemcideki `matchDetailHref` ile AYNI kural.
 *
 * Statik yedek bugüne kadar HER kartı `./canli-skor.html`e bağlıyordu: on iki
 * kart, on iki özdeş bağlantı ve maç başına tek bir tarama yolu bile yok.
 * İstemci ise aynı kartı maç ayrıntısına bağlıyordu, yani JavaScript
 * yüklendiğinde bağlantı sessizce değişiyordu.
 *
 * Kalıcı analiz sayfası olan maç ona, olmayan `mac-detay.html`e bağlanır.
 * `mac-detay.html` `noindex,follow` — yani bağlantı dizine değil, tarayıcının
 * maçı görmesine hizmet eder. Var olmayan bir adres ÜRETİLMEZ.
 */
function matchDetailPath(match) {
  const page = text(match && match.analysisPage);
  if (page) return `./${page.replace(/^\.\//, "")}`;

  const id = text(match && (match.fixtureId || match.providerId || match.id));
  const day = matchDay(match);
  const params = [`id=${encodeURIComponent(id)}`];
  if (day) params.push(`date=${encodeURIComponent(day)}`);
  return `./mac-detay.html?${params.join("&")}`;
}

const LIVE_STATES = new Set(["LIVE"]);
const FINISHED_STATES = new Set(["FINISHED"]);

function stateOfMatch(match) {
  const status = canonicalStatus(match && (match.status || match.providerStatus));
  if (LIVE_STATES.has(status)) return "live";
  if (FINISHED_STATES.has(status)) return "finished";
  if (status === "POSTPONED" || status === "CANCELLED") return "off";
  return "upcoming";
}

/**
 * SAYIM. Sayfanın metin ve SSS'i buradan beslenir; her sayı elde olan
 * kayıttan okunur, hiçbiri tahmin edilmez.
 */
function matchProgramSummary(matches) {
  const list = Array.isArray(matches) ? matches.filter((match) => match && typeof match === "object") : [];
  const summary = { total: list.length, live: 0, finished: 0, upcoming: 0, off: 0, leagues: [], firstKickoff: "", lastKickoff: "" };

  const leagues = [];
  const seenLeagues = new Set();
  const kickoffs = [];

  for (const match of list) {
    const state = stateOfMatch(match);
    summary[state] += 1;

    const league = text(match.league);
    if (league && !seenLeagues.has(league)) {
      seenLeagues.add(league);
      leagues.push(league);
    }

    const time = text(match.time);
    if (time) kickoffs.push(time);
  }

  kickoffs.sort();
  summary.leagues = leagues;
  summary.firstKickoff = kickoffs[0] || "";
  summary.lastKickoff = kickoffs[kickoffs.length - 1] || "";
  return summary;
}

/**
 * Sahaya çıkan Türk takımlarının adı — kaydın kendisinden.
 *
 * `turkishSideOf` BİLEREK kullanılmıyor: iki tarafı da Türk olan bir maçta
 * o fonksiyon "Galatasaray & Çorum FK" gibi tek bir ETİKET döndürür, ki bir
 * maçın Türk tarafını adlandırmak için doğrudur ama "bugün hangi takımlar
 * oynuyor" sorusunun cevabı takım takım olmalı. Burada iki taraf ayrı ayrı
 * sınanır ve aynı takım iki kez listelenmez.
 */
function turkishTeamsPlaying(matches) {
  const names = [];
  const seen = new Set();

  for (const match of Array.isArray(matches) ? matches : []) {
    if (!match || typeof match !== "object") continue;
    for (const side of [match.homeTeam, match.awayTeam]) {
      const name = text(side);
      if (!name || seen.has(name) || !isTurkishTeamName(name)) continue;
      seen.add(name);
      names.push(name);
    }
  }

  return names;
}

/**
 * SSS — yalnızca veriden okunabilen sorular.
 *
 * Her madde bir KOŞULA bağlı: cevabı üretecek kayıt yoksa soru hiç
 * basılmaz. Boş liste dönmek geçerli bir sonuçtur; sayfa o gün SSS'siz
 * yayınlanır. Google'ın yapılandırılmış veri politikası gereği burada
 * üretilen her cevap sayfanın GÖRÜNEN metniyle birebir aynıdır — işaretleme
 * ile ekran ayrışmaz.
 *
 * @param {Array} matches Sıralanmış maç listesi.
 * @param {object} options `dateLabel` (görünen gün adı), `turkishTeams`
 *   (bugün oynayan Türk takımı adları — çağıran çözer).
 */
function matchProgramFaq(matches, options = {}) {
  const list = Array.isArray(matches) ? matches.filter((match) => match && typeof match === "object") : [];
  if (!list.length) return [];

  const summary = matchProgramSummary(list);
  const dateLabel = text(options.dateLabel);
  const day = dateLabel ? `${dateLabel} günü` : "Bugün";
  const faq = [];

  // 1. Kaç maç var? — sayım doğrudan listeden.
  const leagueCount = summary.leagues.length;
  faq.push({
    question: `${dateLabel || "Bugün"} kaç futbol maçı var?`,
    answer: `${day} FutbolRadar programında ${summary.total} karşılaşma listeleniyor` +
      (leagueCount ? ` ve bu maçlar ${leagueCount} farklı turnuvaya ait.` : ".")
  });

  // 2. Hangi ligler oynuyor? — ad listesi veriden, kısaltılırsa kısaltıldığı söylenir.
  if (leagueCount) {
    const shown = summary.leagues.slice(0, FAQ_LEAGUE_LIMIT);
    const rest = leagueCount - shown.length;
    faq.push({
      question: `${dateLabel || "Bugün"} hangi liglerde maç oynanıyor?`,
      answer: `${shown.join(", ")}${rest > 0 ? ` ve ${rest} turnuva daha` : ""}. Liste maç programı sayfasında lig bloklarına ayrılmış hâlde yer alıyor.`
    });
  }

  // 3. İlk ve son başlama saati — yalnızca saat bilgisi olan kayıtlardan.
  if (summary.firstKickoff && summary.lastKickoff) {
    faq.push({
      question: `${dateLabel || "Bugün"} maçlar saat kaçta başlıyor?`,
      answer: summary.firstKickoff === summary.lastKickoff
        ? `Günün maçları ${summary.firstKickoff} (TSİ) itibarıyla başlıyor.`
        : `Günün ilk maçı ${summary.firstKickoff}, son maçı ${summary.lastKickoff} (TSİ) başlıyor. Saatler Türkiye saatine göre verilir.`
    });
  }

  // 4. Türk takımları — YALNIZCA oynayan varsa. "Yok" iddiası üretilmez.
  const turkishTeams = turkishTeamsPlaying(list);
  if (turkishTeams.length) {
    faq.push({
      question: `${dateLabel || "Bugün"} hangi Türk takımları sahaya çıkıyor?`,
      answer: `${turkishTeams.join(", ")} ${day.toLocaleLowerCase("tr")} maça çıkıyor. Bu karşılaşmalar programın en üstünde listelenir.`
    });
  }

  // 5. Canlı skor — sayfanın kendi işleyişi hakkında, veriye dayanmayan
  //    hiçbir iddia içermez.
  if (summary.upcoming || summary.live) {
    faq.push({
      question: "Maç skorları bu sayfada canlı güncelleniyor mu?",
      answer: "Maç durumu ve skor, veri sağlayıcı doğruladıkça güncellenir. Sağlayıcı doğrulamadığı sürece skor CANLI olarak gösterilmez; maç kendi planlanan durumuyla listelenir."
    });
  }

  return faq;
}

module.exports = {
  FAQ_LEAGUE_LIMIT,
  groupMatchesByLeague,
  matchDetailPath,
  matchProgramFaq,
  matchProgramSummary,
  orderMatchProgram,
  stateOfMatch,
  turkishTeamsPlaying
};
