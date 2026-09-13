/**
 * FUTBOLCU 360 — OYUNCU SAYFASININ TEK VERİ MODELİ.
 *
 * Oyuncu sayfası bir biyografi değil, bir DURUM SAYFASIDIR: maç bitince son
 * maç eklenir, sezon toplamı değişir, sakatlık durumu güncellenir, yeni haber
 * bağlanır. Bu modül o sayfanın modelini kurar; HTML üretmez. Aynı model
 * Türkçe ve İngilizce üreticilerin ikisini de besler — iki dilde iki ayrı
 * gerçek olmasın diye.
 *
 * MODÜLLER VERİYE GÖRE AÇILIR, TASARIMA GÖRE DEĞİL. Her bölüm bir
 * `available` bayrağı taşır. Veri yoksa bölüm ya hiç çizilmez ya da açıkça
 * "bilgi bulunmuyor" der; tahmin, sıfır ya da tire basılmaz. Sebebi
 * services/cardCredibility.js'in başında yazılı: ölçülmemiş bir sıfır,
 * okuyucuya "oynadı ve üretemedi" diye görünür.
 *
 * KAPI TEK: `publicPlayerView`. Kısıtlı alanlar (kulüp, dakika, maç, gol,
 * asist, forma numarası, puan, piyasa değeri) doğrudan `player.*`den DEĞİL,
 * `view.fields` üzerinden okunur. Bu modül o kapıyı genişletmez.
 *
 * BU MODÜLÜN AÇTIĞI TEK YENİ YÜZEY — maç günlüğü — kendi kanıtını taşır:
 * satırlar kadro ve olay kayıtlarından türetilir (services/
 * playerMatchLogService.js), sezon istatistiği kapısından bağımsızdır ve
 * sayfada kaynağıyla birlikte gösterilir.
 */

const { publicPlayerView, statsAreVerified } = require("./cardCredibility.js");
const { buildPlayerMatchLog, nameKey, namesMatch, normalizeName } = require("./playerMatchLogService.js");
const { bestTrustTierOf, TRUST_TIER } = require("./sourceTrust.js");
const { createComparisonSlugResolver, profileCompareCandidates } = require("./playerComparisonPairs.js");

const { seasonLabel, nextTeamMatch } = require("./playerHubContext");
const { teamHubFile } = require("./teamHubLinks");
const SEASON_LABEL = seasonLabel(require("../data/super-lig-fixtures.json").season);

/**
 * ROTALAR DIŞARIDAN VERİLİR.
 *
 * Türkçe sayfa `takimlar/galatasaray.html`e, İngilizce sayfa
 * `en/team/galatasaray.html`e bağlanır; gol krallığı bir dilde
 * `gol-kralligi.html`, diğerinde `top-scorers.html`. Bu eşlemeyi modülün
 * içine gömmek, İngilizce sayfaların Türkçe adreslere bağlanması demekti.
 *
 * Çözülemeyen rota `null` döner ve BAĞLANTI HİÇ BASILMAZ — var olmayan bir
 * sayfaya giden bağlantı, bağlantı olmamasından kötüdür.
 */
const DEFAULT_ROUTES = Object.freeze({
  teamHref: (teamName) => {
    const slug = TEAM_PAGE_SLUGS[String(teamName || "").toLocaleLowerCase("tr-TR").trim()];
    return slug ? teamHubFile(teamName) : (teamName ? `takimlar.html?team=${encodeURIComponent(teamName)}` : null);
  },
  matchReportHref: (matchId) => (matchId ? `mac-raporu/${matchId}.html` : null),
  newsHref: (slug) => (slug ? `haber/${slug}.html` : null),
  comparisonHref: (slug) => `karsilastirma/${slug}.html`,
  comparePickerHref: (playerId) => `oyuncu-karsilastir.html?player=${encodeURIComponent(playerId)}`,
  topScorers: "gol-kralligi.html",
  topAssists: "asist-kralligi.html",
  transferRadar: "transfer-radari.html",
  matchCentre: "mac-merkezi.html",
  playerRadar: "oyuncu-radari.html",
  today: "bugunun-maclari.html",
  live: "canli-skor.html",
  fixturesHref: (team) => teamHubFile(team) || "mac-takvimi.html",
  standingsHref: (team) => teamPageSlug(team) ? `${teamPageSlug(team)}-puan-durumu.html` : "puan-durumu.html",
  matchHref: (match) => `mac-detay.html?fixtureId=${encodeURIComponent(match.providerId || match.id)}`
});

/** Takım sayfası üretilmiş kulüpler — iç linkler yalnızca var olan sayfaya. */
const TEAM_PAGE_SLUGS = Object.freeze({
  "galatasaray": "galatasaray",
  "fenerbahçe": "fenerbahce",
  "fenerbahce": "fenerbahce",
  "beşiktaş": "besiktas",
  "besiktas": "besiktas",
  "trabzonspor": "trabzonspor"
});

/** Göreli adresi sayfanın konumuna göre mutlaklaştırır; null geçirgendir. */
function withBase(basePrefix, href) {
  return href ? `${basePrefix}${href}` : null;
}

/**
 * SAĞLAYICI YER TUTUCULARI KULLANICIYA GÖSTERİLMEZ.
 *
 * api-football transfer tipini bilmediğinde "N/A", bedeli bilmediğinde
 * "Bilinmiyor" gönderiyor. Bunlar veri değil, verinin YOKLUĞUNUN kodu.
 * Sayfaya olduğu gibi basıldıklarında okuyucu "N/A" diye bir transfer tipi
 * görüyor — scripts/test-no-data-copy.mjs'in tam olarak yasakladığı şey.
 * Değer anlamsızsa alan hiç basılmasın diye burada null'a çevrilir.
 */
const PLACEHOLDER_VALUES = new Set(["n/a", "na", "bilinmiyor", "unknown", "null", "undefined", "-", "—", "?"]);

function meaningful(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  return PLACEHOLDER_VALUES.has(raw.toLowerCase()) ? null : raw;
}

function teamPageSlug(teamName) {
  return TEAM_PAGE_SLUGS[String(teamName || "").toLocaleLowerCase("tr-TR").trim()] || null;
}

/** Mevki ailesi — hangi ek istatistiklerin anlamlı olduğunu belirler. */
function positionFamily(player) {
  const source = `${(player && player.positionGroup) || ""} ${(player && player.position) || ""}`.toLocaleLowerCase("tr-TR");
  if (/kaleci|goalkeep|\bgk\b/.test(source)) return "goalkeeper";
  if (/defend|defans|stoper|bek|savun/.test(source)) return "defender";
  if (/midfield|orta/.test(source)) return "midfielder";
  if (/attack|forward|forvet|santrfor|striker|winger|kanat/.test(source)) return "forward";
  return "other";
}

/**
 * Sayı gerçekten ÖLÇÜLDÜ mü?
 *
 * `statsAreVerified(player, field)` alan bazlı kapıdır. Kapıdan geçmeyen
 * alan için değer DÖNDÜRÜLMEZ — çağıran tarafın 0 ile "ölçülmedi"yi
 * karıştırma ihtimali kalmasın diye null döner.
 */
function measured(player, view, field) {
  // İKİ KAPI, TEK SIRAYLA. Alan bazlı `statsAreVerified` tek başına
  // YETMEZ: kaydın KENDİSİ yayın kapısından geçmediyse (yer tutucu
  // sağlayıcı kimliği, kaynaksız, bayat) üstündeki hiçbir ölçüm
  // yayımlanmaz. Bu sıra atlandığında doğrulanmamış bir kayıttaki şut ve
  // xG değerleri "ek istatistik" başlığı altında sayfaya sızıyordu.
  if (!view || !view.verified) return null;
  if (!statsAreVerified(player, field)) return null;
  const value = player && (player[field] ?? (player.stats && player.stats[field]));
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * Mevkiye göre ek istatistikler.
 *
 * Liste SABİT DEĞİL, VERİYE GÖRE daralır: kaynakta bulunmayan metrik
 * (ki kadro senkronundan gelen kayıtların neredeyse tamamında bulunmuyor)
 * hiç üretilmez. "Şut: 0" basmaktansa şut satırı hiç olmasın.
 */
const POSITION_METRICS = Object.freeze({
  forward: [
    { field: "shots", key: "shots" },
    { field: "shotsOnTarget", key: "shotsOnTarget" },
    { field: "xg", key: "xg", decimals: 2 },
    { field: "keyPasses", key: "keyPasses" }
  ],
  midfielder: [
    { field: "passAccuracy", key: "passAccuracy", suffix: "%" },
    { field: "keyPasses", key: "keyPasses" },
    { field: "xa", key: "xa", decimals: 2 },
    { field: "duelsWon", key: "duelsWon" }
  ],
  defender: [
    { field: "tackles", key: "tackles" },
    { field: "interceptions", key: "interceptions" },
    { field: "duelsWon", key: "duelsWon" },
    { field: "blocks", key: "blocks" }
  ],
  goalkeeper: [
    { field: "saves", key: "saves" },
    { field: "cleanSheets", key: "cleanSheets" },
    { field: "goalsConceded", key: "goalsConceded" },
    { field: "passAccuracy", key: "passAccuracy", suffix: "%" }
  ],
  other: [
    { field: "passAccuracy", key: "passAccuracy", suffix: "%" },
    { field: "duelsWon", key: "duelsWon" }
  ]
});

function buildSeasonStats(player, view, season = SEASON_LABEL) {
  const fields = view.fields || {};
  const core = [];
  if (player.statsSeason && seasonLabel(player.statsSeason) !== season) return {available:false,season,family:positionFamily(player),core:[],positional:[],source:null,verifiedAt:null};

  const push = (key, value, extra = {}) => {
    if (value === null || value === undefined || value === "") return;
    core.push({ key, value, ...extra });
  };

  push("appearances", fields.appearances ?? null);
  // "İlk 11" sağlayıcıdan ayrı bir alan olarak gelir (`stats.starts`).
  // Gelmediyse maç sayısından TÜRETİLMEZ: yedek soyunup oyuna giren bir
  // oyuncunun maçı da "maç"tır, ilk 11'i değil.
  push("starts", measured(player, view, "starts"));
  push("minutes", fields.minutesPlayed ?? fields.minutes ?? null);
  push("goals", fields.goals ?? null);
  push("assists", fields.assists ?? null);
  push("yellowCards", measured(player, view, "yellowCards"));
  push("redCards", measured(player, view, "redCards"));

  const family = positionFamily(player);
  const positional = [];
  for (const metric of POSITION_METRICS[family] || []) {
    const value = measured(player, view, metric.field);
    if (value === null) continue;
    positional.push({
      key: metric.key,
      value: metric.decimals ? Number(value.toFixed(metric.decimals)) : value,
      suffix: metric.suffix || ""
    });
  }

  return {
    available: core.length > 0,
    season,
    family,
    core,
    positional,
    source: player && (player.statsSource || null),
    verifiedAt: player && (player.statsVerifiedAt || null)
  };
}

/**
 * Form serisi — grafiğin verisi.
 *
 * Kaynak maç günlüğüdür, `player.form` DEĞİL: `form` alanı yalnızca 8 eski
 * kayıtta var ve kapıdan (ratingIsVerified) geçmiyor. Maç günlüğü ise her
 * satırını gerçek bir olay kaydına dayandırıyor.
 */
function buildFormSeries(appearances) {
  const rows = appearances.slice(0, 10).reverse();
  return rows.map((row) => ({
    matchId: row.matchId,
    opponent: row.opponent,
    kickoff: row.kickoff,
    result: row.result,
    goals: row.goals,
    assists: row.assists,
    minutes: row.minutes,
    contribution: row.goals + row.assists
  }));
}

/**
 * SAKATLIK VE CEZA.
 *
 * İki kaynak: oyuncu kaydındaki `availabilityStatus` (sağlayıcı) ve
 * data/squad-statuses.json'daki takım eksik listesi. İkisi de yoksa
 * "oynuyor" DENMEZ — bilmediğimizi söyleriz. Bir oyuncunun sakat
 * OLMADIĞINI, sakatlık listesinde görünmemesinden çıkarmak, listenin tam
 * olduğunu varsaymak demektir.
 */
const AVAILABILITY_KEYS = Object.freeze({
  injured: "injured",
  doubtful: "doubtful",
  suspended: "suspended",
  active: "available"
});

function buildAvailability(player, squadStatuses) {
  const direct = String((player && player.availabilityStatus) || "").toLowerCase();
  if (AVAILABILITY_KEYS[direct]) {
    return {
      available: true,
      status: AVAILABILITY_KEYS[direct],
      note: (player && player.availabilityNote) || null,
      source: (player && player.availabilitySource) || null,
      updatedAt: (player && player.availabilityUpdatedAt) || null
    };
  }

  const teams = (squadStatuses && Array.isArray(squadStatuses.teams)) ? squadStatuses.teams : [];
  const playerTeam = String((player && (player.currentTeam || player.team)) || "").trim();
  const key = nameKey(player && player.name);
  if (playerTeam && key) {
    for (const team of teams) {
      if (normalizeName(team.team) !== normalizeName(playerTeam)) continue;
      for (const absence of team.absences || []) {
        if (!namesMatch(nameKey(absence.playerName), key)) continue;
        const status = AVAILABILITY_KEYS[String(absence.status || "").toLowerCase()];
        if (!status) continue;
        return {
          available: true,
          status,
          note: absence.reason || absence.type || null,
          source: absence.source || (squadStatuses && squadStatuses.source) || null,
          updatedAt: (squadStatuses && squadStatuses.updatedAt) || null
        };
      }
    }
  }

  return { available: false, status: "unknown", note: null, source: null, updatedAt: null };
}

/**
 * KARİYER.
 *
 * Sezon bazlı maç/gol tablosu elimizde YOK — sağlayıcı kadro uç noktası
 * göndermiyor. Elimizde olan, kulüp geçmişinin kendisi: `transferHistory`
 * (tarihli, kaynaklı) ve `formerTeams`. Tablo bu yüzden "sezon-maç-gol"
 * değil, "kulüp-katılım-ayrılış" tablosudur. Olmayan sütunu boş basmak
 * yerine, olan sütunla dürüst bir tablo kurulur.
 */
function buildCareer(player) {
  const history = Array.isArray(player && player.transferHistory) ? player.transferHistory.slice() : [];
  history.sort((left, right) => String(left.date || "").localeCompare(String(right.date || "")));

  /**
   * SAĞLAYICI KARİYER VERİSİ TEMİZ DEĞİL — iki kalıbı elemek gerekiyor:
   *
   *   • OYUNCUNUN KENDİ ADI KULÜP OLARAK. api-football bazı "Free agent"
   *     kayıtlarında `toTeam` alanına oyuncunun adını ters çevirip
   *     yazıyor (A. Ablak → "Ablak Ali"). Bu bir kulüp değil; kariyer
   *     tablosunda kulüp gibi göstermek düpedüz yanlış bilgi.
   *   • AYNI KULÜBE ART ARDA DÖNÜŞ. Çift kiralık dönüşü aynı tarihte iki
   *     "Back from Loan" satırı üretiyor; tabloda kulüp iki kez alt alta
   *     görünüyordu. Ardışık aynı kulüp TEK dönem olarak birleştirilir.
   *
   * İkisi de veriyi DÜZELTMEZ, yalnızca yayımlamaz: kaynak kayıt olduğu
   * gibi duruyor, sağlayıcı düzelttiği gün satır kendiliğinden geri gelir.
   */
  const ownNameTokens = new Set(normalizeName(`${player && player.name} ${player && player.fullName}`)
    .split(" ").filter((token) => token.length > 2));

  function looksLikeOwnName(clubName) {
    const tokens = normalizeName(clubName).split(" ").filter((token) => token.length > 2);
    return tokens.length > 0 && tokens.every((token) => ownNameTokens.has(token));
  }

  const stints = [];
  for (const entry of history) {
    if (!entry || !entry.toTeam) continue;
    // "Free agent" satırı bir KULÜBE geçişi anlatmaz; sağlayıcı bu
    // kayıtlarda `toTeam` alanını kulüp dışı bir değerle (çoğu zaman
    // oyuncunun kendi adıyla) dolduruyor. Kariyer tablosu kulüp dönemlerini
    // gösterir, serbest kalma anlarını değil.
    if (/free\s*agent/i.test(String(entry.type || ""))) continue;
    if (looksLikeOwnName(entry.toTeam)) continue;

    const previous = stints.at(-1);
    if (previous && normalizeName(previous.club) === normalizeName(entry.toTeam)) {
      // Aynı kulübe dönüş: dönemi uzatır, yeni satır açmaz.
      previous.leftAt = null;
      continue;
    }
    if (previous && !previous.leftAt) previous.leftAt = entry.date || null;
    stints.push({
      club: entry.toTeam,
      joinedAt: entry.date || null,
      leftAt: null,
      type: meaningful(entry.type),
      fee: meaningful(entry.feeLabel),
      source: meaningful(entry.source)
    });
  }

  const formerTeams = (Array.isArray(player && player.formerTeams) ? player.formerTeams : [])
    .filter((name) => name && !stints.some((stint) => normalizeName(stint.club) === normalizeName(name)));

  return {
    available: stints.length > 0 || formerTeams.length > 0,
    stints: stints.reverse(),
    formerTeams,
    // Kariyer TOPLAMI (maç/gol/asist) yayımlanmaz: elimizde sezon sezon
    // ölçüm yok, mevcut sezon sayıları kariyer toplamı DEĞİL.
    totalsAvailable: false
  };
}

/** Güven kademesini okuyucunun göreceği etikete çevirir. */
function trustLabelKey(tier) {
  if (tier === TRUST_TIER.OFFICIAL) return "official";
  if (tier === TRUST_TIER.HIGH || tier === TRUST_TIER.REPORTER) return "strongSource";
  return "claim";
}

function transferTrustKey(transfer) {
  return trustLabelKey(bestTrustTierOf(transfer));
}

/**
 * Haber–oyuncu bağı.
 *
 * Eşleşme ETİKET ve ÖZNE üzerinden kurulur, gövde metni taranmaz: gövdede
 * geçen bir ad, haberin o oyuncu HAKKINDA olduğunu göstermez (rakip kadro,
 * benzetme, geçmiş transfer). Ad karşılaştırması maç günlüğüyle aynı
 * normalleştiriciyi kullanır — kayıtta "V. Osimhen", haberde "Victor
 * Osimhen" yazıyor.
 */
function newsMentionsPlayer(item, key) {
  if (!key) return false;

  const subject = item && item.discovery && item.discovery.subject;
  if (subject && namesMatch(nameKey(subject), key)) return true;

  for (const tag of (item && item.tags) || []) {
    if (namesMatch(nameKey(tag), key)) return true;
  }

  // Başlık son çare: yalnızca soyadı + ilk harf birlikte geçiyorsa.
  const title = normalizeName(item && item.title);
  if (!title || !key.surname) return false;
  if (!title.includes(key.surname)) return false;
  return key.initial ? new RegExp(`\\b${key.initial}[a-z]*\\s+${key.surname}\\b`).test(title) : true;
}

const TRANSFER_EVENT_TYPES = new Set(["official", "negotiation", "departure"]);

function isTransferNews(item) {
  const eventType = String((item && item.discovery && item.discovery.eventType) || "");
  if (TRANSFER_EVENT_TYPES.has(eventType)) return true;
  return /transfer/i.test(String((item && item.category) || ""));
}

function newsTrustKey(item) {
  // `item.url` KASITLI OLARAK dışarıda: o adres FutbolRadar'ın kendi haber
  // sayfası. Kendi yayınımızı kaynak sayıp kendimize güven kademesi
  // vermek, etiketi anlamsızlaştırır — soru "bu iddianın arkasında KİM
  // var?", "bunu kim yayımladı?" değil.
  const tier = bestTrustTierOf({
    sources: (item && item.sources) || [],
    sourceUrl: (item && item.discovery && item.discovery.sourceUrl) || null
  });
  // Sağlayıcı "confirmed" dese de kaynak bir haber sitesiyse etiket
  // "Resmî" olmaz — kimin konuştuğu, ne dendiğinden önce gelir.
  return trustLabelKey(tier);
}

function buildNews(player, news, options) {
  const key = nameKey(player && player.name);
  const matched = (Array.isArray(news) ? news : [])
    .filter((item) => item && item.status !== "archived" && newsMentionsPlayer(item, key))
    .sort((left, right) => String(right.publishedAt || "").localeCompare(String(left.publishedAt || "")));

  const toRow = (item) => ({
    id: item.id,
    title: item.title,
    href: withBase(options.basePrefix, options.routes.newsHref(item.slug || item.id)),
    publishedAt: item.publishedAt || null,
    category: item.category || null,
    trustKey: newsTrustKey(item)
  });

  const transferItems = matched.filter(isTransferNews).slice(0, 5).map(toRow).filter((row) => row.href);
  const transferIds = new Set(transferItems.map((row) => row.id));
  const generalItems = matched.filter((item) => !transferIds.has(item.id)).slice(0, 6).map(toRow).filter((row) => row.href);

  return { transfer: transferItems, general: generalItems };
}

function buildTransferRecords(player, transfers) {
  const rows = (Array.isArray(transfers) ? transfers : [])
    .filter((transfer) => transfer && transfer.playerId === player.id)
    .sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")))
    .slice(0, 5)
    .map((transfer) => ({
      id: transfer.id || `${transfer.playerId}-${transfer.date}`,
      date: transfer.date || null,
      fromTeam: meaningful(transfer.fromTeam),
      toTeam: meaningful(transfer.toTeam),
      type: meaningful(transfer.type),
      fee: meaningful(transfer.fee),
      sourceName: meaningful(transfer.sourceName),
      sourceUrl: transfer.sourceUrl || null,
      trustKey: transferTrustKey(transfer)
    }));

  return { available: rows.length > 0, rows };
}

/**
 * KİMLİK KARTI.
 *
 * Kulüp, forma numarası ve fotoğraf KAPIDAN geçer (`view.fields`); ad,
 * mevki, uyruk, doğum tarihi, boy ve ayak bağımsız olarak güvenli
 * alanlardır (services/cardCredibility.js — SAFE_FIELDS).
 */
function buildIdentity(player, view, options) {
  const fields = view.fields || {};
  const team = fields.currentTeam || fields.team || null;
  const height = player.heightCm
    ? `${player.heightCm} cm`
    : (player.height ? (/\d\s*cm/i.test(String(player.height)) ? String(player.height) : `${player.height} cm`) : null);

  // GÖRÜNEN AD. Adres tam ada taşındıysa sayfa da tam adı gösterir; iki
  // yerde iki ayrı ad, aramadan gelen okuyucu için sayfanın yanlış kişiye
  // ait olduğu izlenimi yaratır. Ad kaynaklıdır (bkz. playerSlugService),
  // uydurulmuş değil.
  const displayName = options.displayName || player.name;

  return {
    name: displayName,
    // Kayıttaki ad artık başlıktan farklıysa ("V. Osimhen" ↔ "Victor
    // Osimhen") kimlik kartında ikinci kez basılmaz — aynı bilginin
    // kısaltması yeni bir şey söylemiyor.
    fullName: player.fullName && player.fullName !== displayName && player.fullName !== player.name
      ? player.fullName
      : null,
    team,
    teamLogo: player.currentTeamLogo || null,
    teamHref: team ? withBase(options.basePrefix, options.routes.teamHref(team)) : null,
    // `shirtNumber`, `number` alanının ikinci adı — ikisi de kadro uç
    // noktasından gelir ve AYNI kapıdan geçmeli. Ham kayıttan koşulsuz
    // okunduğunda doğrulanmamış kayıtların forma numarası yayına
    // giriyordu; `number` kısıtlı alan listesinde, `shirtNumber` değil.
    shirtNumber: fields.number ?? (view.verified ? (player.shirtNumber ?? null) : null),
    position: player.position || null,
    secondaryPosition: player.secondaryPosition || null,
    nationality: player.nationality || null,
    birthDate: player.birthDate || null,
    age: player.computedAge || player.age || null,
    height,
    preferredFoot: player.preferredFoot || null,
    contractUntil: player.contractUntil || null,
    league: player.league || null
  };
}

/**
 * BAŞARILAR VE KUPALAR.
 *
 * Veri kümesinde henüz böyle bir alan YOK. Uydurulmaz; alan eklendiği gün
 * (players.json → `honours: [{season, title, club}]`) bölüm kendiliğinden
 * açılsın diye okuma yolu şimdiden burada duruyor.
 */
function buildHonours(player) {
  const rows = (Array.isArray(player && player.honours) ? player.honours : [])
    .filter((row) => row && (row.title || row.name))
    .map((row) => ({
      title: row.title || row.name,
      club: row.club || null,
      season: row.season || null,
      type: row.type || null
    }));
  return { available: rows.length > 0, rows };
}

/**
 * KIYAS EŞLERİ KENDİ BAŞINA SEÇİLMEZ.
 *
 * Kıyas sayfaları yalnızca `profileCompareCandidates`ın döndürdüğü çiftler
 * için üretiliyor. Burada bağımsız bir "aynı mevkiden altı oyuncu" listesi
 * kurulduğunda her profil, üretilmemiş beş kıyas sayfasına bağlanıyordu —
 * derleme doğrulaması bunu yüzlerce "missing local target" olarak bildirdi.
 *
 * Tek kaynak: services/playerComparisonPairs.js.
 */
function buildCompare(player, players, options) {
  // Kıyas adresi, kıyas sayfalarını üreten scriptle AYNI kaynaktan gelir.
  //
  // ÇÖZÜCÜ TAM LİSTEYLE KURULMALI: editoryal çiftler kopya kayıt
  // kimlikleriyle yazılı, kıyas havuzu ise yalnızca kanonik kayıtlardan
  // oluşuyor. Havuzla kurulan bir çözücü o çiftleri tanıyamaz ve
  // yayımlanmış adresin yerine türetilmiş bir slug basar — yani
  // üretilmemiş bir sayfaya bağlanır.
  const slugForPair = options.comparisonSlugFor || createComparisonSlugResolver(players);
  const peers = profileCompareCandidates(player, players)
    .map((item) => ({
      id: item.player.id,
      name: item.player.name,
      team: publicPlayerView(item.player).fields.currentTeam || null,
      href: withBase(options.basePrefix, options.routes.comparisonHref(slugForPair(player, item.player)))
    }));

  return {
    available: peers.length > 0,
    // Temiz, ileride indekslenebilir kıyas adresi. Yönlendirme vercel.json
    // üzerinden kanonik /karsilastirma/ sayfasına gider; ikinci bir kopya
    // sayfa üretilmez.
    pickerHref: withBase(options.basePrefix, options.routes.comparePickerHref(player.id)),
    peers
  };
}

function buildInternalLinks(identity, options) {
  const links = [];
  if (identity.teamHref) links.push({ key: "teamSquad", href: identity.teamHref, label: identity.team });
  for (const key of ["topScorers", "topAssists", "transferRadar", "matchCentre", "playerRadar", "today", "live"]) {
    const href = withBase(options.basePrefix, options.routes[key]);
    if (href) links.push({ key, href });
  }
  return links;
}

/**
 * Sayfanın tamamı.
 *
 * @param {object} input
 * @param {object} input.player
 * @param {object[]} [input.players]      kıyas eşleri için
 * @param {object[]} [input.transfers]
 * @param {object[]} [input.news]
 * @param {object[]} [input.matches]
 * @param {object[]} [input.archive]
 * @param {object}   [input.squadStatuses]
 * @param {string}   [input.basePrefix]   üretilen sayfadan köke giden yol
 */
function buildPlayer360(input) {
  const player = input && input.player;
  if (!player) throw new TypeError("buildPlayer360: player gerekli");

  const options = {
    basePrefix: (input && input.basePrefix) || "../",
    routes: { ...DEFAULT_ROUTES, ...((input && input.routes) || {}) }
  };
  const view = input.credibility || publicPlayerView(player);

  const matchLog = buildPlayerMatchLog(player, {
    matches: (input.matches || []).filter(row => Date.parse(row.kickoff || row.date) <= (input.now ?? Date.now())),
    archive: input.archive,
    limit: Infinity
  });

  options.displayName = (input && input.displayName) || null;
  options.comparisonSlugFor = (input && input.comparisonSlugFor) || null;
  const identity = buildIdentity(player, view, options);
  const season = seasonLabel(input.season) || SEASON_LABEL;
  const next = nextTeamMatch(identity.team, input.calendar, input.now);
  const dated = [player.statsVerifiedAt, player.profileUpdatedAt, player.lastVerifiedAt, input.calendarUpdatedAt]
    .filter(value => value && Number.isFinite(Date.parse(value)) && Date.parse(value) <= (input.now ?? Date.now()));
  const updatedAt = dated.sort((a,b) => Date.parse(b)-Date.parse(a))[0] || null;

  return {
    id: player.id,
    season,
    verified: view.verified,
    identity,
    seasonStats: buildSeasonStats(player, view, season),
    updatedAt,
    nextMatch: next ? {...next, href: withBase(options.basePrefix, options.routes.matchHref(next))} : null,
    matchLog: {
      lastGoal: (() => { const row=matchLog.appearances.find(item=>item.goals>0); return row ? {...row,reportHref:withBase(options.basePrefix,options.routes.matchReportHref(row.matchId))} : null; })(),
      lastAssist: (() => { const row=matchLog.appearances.find(item=>item.assists>0); return row ? {...row,reportHref:withBase(options.basePrefix,options.routes.matchReportHref(row.matchId))} : null; })(),
      available: matchLog.appearances.length > 0,
      // Satırın maç raporu adresi BURADA çözülür: görünüm katmanı rota
      // bilmez, yalnızca gelen href'i basar (ya da yoksa basmaz).
      rows: matchLog.appearances.slice(0, 5).map((row) => ({
        ...row,
        reportHref: withBase(options.basePrefix, options.routes.matchReportHref(row.matchId))
      })),
      totals: matchLog.totals,
      scanned: matchLog.evidence.matchesScanned
    },
    formSeries: buildFormSeries(matchLog.appearances.slice(0, 5)),
    availability: buildAvailability(player, input.squadStatuses),
    career: buildCareer(player),
    honours: buildHonours(player),
    transfers: buildTransferRecords(player, input.transfers),
    news: buildNews(player, input.news, options),
    compare: buildCompare(player, input.players, options),
    internalLinks: buildInternalLinks(identity, options)
  };
}

module.exports = {
  DEFAULT_ROUTES,
  SEASON_LABEL,
  buildAvailability,
  buildCareer,
  buildFormSeries,
  buildHonours,
  buildNews,
  buildPlayer360,
  buildSeasonStats,
  newsMentionsPlayer,
  positionFamily,
  teamPageSlug,
  trustLabelKey
};
