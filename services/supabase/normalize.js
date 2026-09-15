/**
 * NORMALLEŞTİRME — SAĞLAYICI BİÇİMİNDEN SATIR BİÇİMİNE.
 *
 * ---------------------------------------------------------------------
 * TEK KURAL, HER YERDE: BİLİNMEYEN NULL'DIR
 * ---------------------------------------------------------------------
 * `Number(null)` sıfırdır ve `isFinite(0)` doğrudur. Bu iki gerçek bir
 * arada, "bu değer yayımlandı mı" sorusunu sessizce "evet, sıfır"a
 * çevirir. Bu depoda tam olarak böyle oldu: yayımlanmamış ilk yarı
 * skoru üretimde "İlk yarı 0-0" diye göründü — uydurulmuş bir sayı,
 * gerçek bir sayı gibi.
 *
 * `published()` o tuzağın tek çıkışı: değer gerçekten bir sayı olarak
 * VERİLDİYSE sayıyı, verilmediyse `null` döndürür. Bütün sayısal
 * alanlar bu fonksiyondan geçer. Şema tarafında da karşılığı var:
 * hiçbir istatistik sütunu `default 0` taşımıyor.
 *
 * ---------------------------------------------------------------------
 * SAĞLAYICI ADI DEĞİL, SAĞLAYICI KİMLİĞİ
 * ---------------------------------------------------------------------
 * Satırların birincil anahtarı sitenin kendi slug'ı; sağlayıcı
 * kimlikleri `provider_ids` içinde yaşıyor. Sağlayıcı değiştiğinde
 * eşleme güncellenir, URL'ler ve iç bağlantılar sabit kalır.
 */

const { canonicalStatus } = require("../matchStatus");

/** Boş, boşluk ve "-" gibi yer tutucular metin sayılmaz. */
function text(value) {
  const clean = String(value === undefined || value === null ? "" : value).trim();
  if (!clean) return null;
  // "-", "—", "N/A", "null" gibi değerler sağlayıcıdan "veri yok" anlamında
  // gelir; metin olarak saklamak, o yer tutucunun bir gün ekrana çıkması
  // demektir. Bu depoda "veri yok" ifadeleri site genelinde yasak.
  if (/^(-+|—|n\/?a|null|undefined|veri yok|no data)$/i.test(clean)) return null;
  return clean;
}

/**
 * SAYI GERÇEKTEN VERİLDİ Mİ?
 *
 * `null`, `undefined`, `""` ve sayıya çevrilemeyen her şey → `null`.
 * `0` → `0`, çünkü sıfır geçerli bir ölçümdür ("hiç şut çekmedi").
 * Ayrım burada: veren `0` ile vermeyen `null` bir daha karışmaz.
 */
function published(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Tam sayı alanları için: ondalık gelirse yuvarlanır, yoksa null. */
function publishedInt(value) {
  const number = published(value);
  return number === null ? null : Math.round(number);
}

/** "181 cm" → 181, "1.81 m" → 181, boş → null. */
function heightCm(value) {
  const raw = text(value);
  if (!raw) return null;
  const metres = raw.match(/^(\d+([.,]\d+)?)\s*m$/i);
  if (metres) return Math.round(parseFloat(metres[1].replace(",", ".")) * 100);
  const centimetres = raw.match(/(\d{2,3})\s*cm/i) || raw.match(/^(\d{2,3})$/);
  return centimetres ? Number(centimetres[1]) : null;
}

/** "75 kg" → 75, boş → null. */
function weightKg(value) {
  const raw = text(value);
  if (!raw) return null;
  const match = raw.match(/(\d{2,3})\s*kg/i) || raw.match(/^(\d{2,3})$/);
  return match ? Number(match[1]) : null;
}

/**
 * "3.2M EUR" → 3200000, "850K EUR" → 850000, "Bedelsiz" → 0, boş → null.
 *
 * "Bedelsiz"in 0 olması UYDURMA DEĞİL: bedelsiz transfer, bedeli
 * bilinmeyen transfer değildir — bedeli sıfır olan transferdir. Bilinmeyen
 * bedel `null` kalır.
 */
function moneyEur(value) {
  if (value === 0) return 0;
  const raw = text(value);
  if (!raw) return null;
  if (/^(bedelsiz|serbest|free|ücretsiz)$/i.test(raw)) return 0;
  const match = raw.match(/([\d.,]+)\s*([mkb])?/i);
  if (!match) return null;
  const amount = parseFloat(match[1].replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
  if (!Number.isFinite(amount)) return null;
  const suffix = String(match[2] || "").toLowerCase();
  if (suffix === "m") return Math.round(amount * 1e6);
  if (suffix === "k" || suffix === "b") return Math.round(amount * 1e3);
  return Math.round(amount);
}

/** ISO tarih (YYYY-MM-DD) ya da null. Geçersiz tarih saklanmaz. */
function isoDate(value) {
  const raw = text(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

/** ISO zaman damgası ya da null. */
function isoStamp(value) {
  const raw = text(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Yaştan doğum tarihi UYDURULMAZ. Yalnızca gerçek tarih saklanır. */
function birthDate(player) {
  return isoDate(player && (player.birthDate || player.dateOfBirth || player.birth));
}

function foot(value) {
  const raw = text(value);
  if (!raw) return null;
  if (/^(sağ|sag|right)$/i.test(raw)) return "right";
  if (/^(sol|left)$/i.test(raw)) return "left";
  if (/^(her ?iki|both|çift|cift)$/i.test(raw)) return "both";
  return null;
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u")
    .replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function providerIds(record) {
  const ids = {};
  if (record && record.providerId) ids.provider = String(record.providerId);
  if (record && record.apiFootballId) ids.apiFootball = String(record.apiFootballId);
  if (record && record.fixtureId) ids.fixture = String(record.fixtureId);
  return ids;
}

// ── Varlıklar ─────────────────────────────────────────────────────────

function team(record, sourceId) {
  const id = text(record && record.id) || slug(record && record.name);
  const name = text(record && record.name);
  if (!id || !name) return null;

  return {
    id,
    name,
    short_name: text(record.shortName),
    league: text(record.league),
    country: text(record.country),
    founded: publishedInt(record.founded),
    venue: text(record.venue || record.stadium),
    logo_url: text(record.logo || record.logoUrl || record.crest),
    provider_ids: providerIds(record),
    source_id: sourceId || null
  };
}

function player(record, sourceId) {
  const id = text(record && record.id) || slug(record && record.name);
  const name = text(record && record.name);
  if (!id || !name) return null;

  const teamName = text(record.team);
  return {
    id,
    name,
    // Takım yabancı anahtarı: eşleşme bulunamazsa NULL — olmayan bir
    // takım kimliği uydurmak, ilişkiyi sessizce yanlış kurmaktır.
    team_id: teamName ? slug(teamName) : null,
    position: text(record.position),
    birth_date: birthDate(record),
    nationality: text(record.nationality),
    height_cm: heightCm(record.height),
    weight_kg: weightKg(record.weight),
    preferred_foot: foot(record.preferredFoot),
    market_value_eur: moneyEur(record.marketValue),
    contract_until: isoDate(record.contractUntil),
    photo_url: text(record.photo || record.photoUrl || record.image),
    provider_ids: providerIds(record),
    source_id: sourceId || null
  };
}

/**
 * Oyuncu istatistiği AYRI SATIR ve sezon taşır.
 *
 * Kaynakta sezon yoksa satır ÜRETİLMEZ: sezonsuz istatistik, bir sonraki
 * sezon geldiğinde eskisini ezerdi ve hangi sezona ait olduğu bir daha
 * bilinemezdi.
 */
function playerStats(record, season, sourceId) {
  const playerId = text(record && record.id) || slug(record && record.name);
  const seasonLabel = text(season);
  if (!playerId || !seasonLabel) return null;

  const row = {
    player_id: playerId,
    season: seasonLabel,
    competition: text(record.competition) || "all",
    appearances: publishedInt(record.appearances),
    minutes: publishedInt(record.minutes),
    goals: publishedInt(record.goals),
    assists: publishedInt(record.assists),
    shots: publishedInt(record.shots),
    shots_on_target: publishedInt(record.shotsOnTarget),
    key_passes: publishedInt(record.keyPasses),
    duels: publishedInt(record.duels),
    duels_won: publishedInt(record.duelsWon),
    yellow_cards: publishedInt(record.yellowCards),
    red_cards: publishedInt(record.redCards),
    xg: published(record.xg),
    xa: published(record.xa),
    rating: published(record.rating) === null ? null : Number(published(record.rating)),
    source_id: sourceId || null
  };

  // Şemadaki `player_stats_duels_sane` kısıtı bozuk satırı reddeder ve
  // reddedilen satır, PARÇANIN TAMAMINI düşürür. Burada erken yakalanıp
  // yalnızca tutarsız ALAN düşürülüyor; oyuncunun diğer istatistikleri
  // kaybedilmiyor.
  if (row.duels !== null && row.duels_won !== null && row.duels_won > row.duels) {
    row.duels = null;
    row.duels_won = null;
  }

  // Tek bir gerçek ölçüm bile yoksa satır yazılmaz: her alanı NULL olan
  // bir satır, "bu oyuncunun verisi var" izlenimi verir ve yoktur.
  const measured = [
    "appearances", "minutes", "goals", "assists", "shots", "shots_on_target",
    "key_passes", "duels", "duels_won", "yellow_cards", "red_cards", "xg", "xa", "rating"
  ].some((column) => row[column] !== null);

  return measured ? row : null;
}

function match(record, sourceId) {
  const id = text(record && record.id);
  const kickoff = isoStamp(record && record.kickoff);
  const home = text(record && (record.homeTeam || record.home));
  const away = text(record && (record.awayTeam || record.away));
  if (!id || !kickoff || !home || !away) return null;

  const score = (record && record.score) || {};
  const status = canonicalStatus(record.status || record.providerStatus || "");
  const homeScore = publishedInt(score.home);
  const awayScore = publishedInt(score.away);

  // BİTMİŞ AMA SKORSUZ SATIR YAZILMAZ. Şema bunu zaten reddediyor
  // (`matches_finished_has_score`); burada erken düşürülüyor ki tek bozuk
  // maç yüzünden 500 maçlık parça geri dönmesin.
  if (status === "FINISHED" && (homeScore === null || awayScore === null)) return null;

  let winner = null;
  if (homeScore !== null && awayScore !== null) {
    winner = homeScore > awayScore ? "home" : (homeScore < awayScore ? "away" : "draw");
  }

  return {
    id,
    provider_fixture_id: text(record.fixtureId || record.providerId),
    competition_id: text(record.competitionId),
    competition: text(record.competition || record.league),
    season: text(record.season),
    stage: text(record.stage),
    kickoff,
    venue: text(record.venue),
    city: text(record.city),
    referee: text(record.referee),
    home_team_id: slug(home) || null,
    away_team_id: slug(away) || null,
    home_team_name: home,
    away_team_name: away,
    status,
    // Sağlayıcının HAM durumu ayrı saklanıyor: "CANLI" iddiası yalnızca
    // buradan türetilebilir, arayüzün kendi saat hesabından değil.
    provider_status: text(record.providerStatus),
    home_score: homeScore,
    away_score: awayScore,
    ht_home_score: publishedInt(score.halftimeHome),
    ht_away_score: publishedInt(score.halftimeAway),
    winner,
    source_id: sourceId || null
  };
}

/** İzin verilen üç kaynak. Listenin dışı YAZILMAZ (şema da reddeder). */
const PREDICTION_SOURCES = new Set(["provider_prediction", "market_probability", "futbolradar_model"]);

/** Modelin veri kademeleri — 0005 göçündeki CHECK ile aynı liste. */
const DATA_BASIS_VALUES = new Set(["team-history", "partial-history", "competition-baseline"]);

/**
 * MAÇ TAHMİNİ SATIRI.
 *
 * İki kural burada da geçerli:
 *   1. Toplam tam 100 değilse satır YAZILMAZ. Normalize edilmemiş bir
 *      üçlü, veritabanı kısıtına takılıp tüm parçayı düşürürdü; burada
 *      erken eleniyor.
 *   2. Tanınmayan kaynak etiketi kabul edilmez. "Piyasa olasılığı"nı
 *      sağlayıcı tahmini diye saklamak, veriyi yanlış otoriteye mal
 *      etmektir.
 */
function fixturePrediction(record, sourceId) {
  const fixtureId = text(record && record.fixtureId);
  const home = text(record && record.homeTeam);
  const away = text(record && record.awayTeam);
  const source = text(record && record.source);
  if (!fixtureId || !home || !away || !source || !PREDICTION_SOURCES.has(source)) return null;

  const homeProbability = publishedInt(record.homeProbability);
  const drawProbability = publishedInt(record.drawProbability);
  const awayProbability = publishedInt(record.awayProbability);
  if (homeProbability === null || drawProbability === null || awayProbability === null) return null;
  if (homeProbability + drawProbability + awayProbability !== 100) return null;

  const winner = record.predictedWinner && typeof record.predictedWinner === "object"
    ? text(record.predictedWinner.name) || text(record.predictedWinner.side)
    : text(record.predictedWinner);

  return {
    fixture_id: fixtureId,
    provider_fixture_id: text(record.providerFixtureId),
    competition_id: text(record.competitionId),
    league_id: text(record.leagueId),
    season: text(record.season),
    kickoff: isoStamp(record.kickoff),
    home_team: home,
    away_team: away,
    home_team_id: text(record.homeTeamId),
    away_team_id: text(record.awayTeamId),
    source,
    home_probability: homeProbability,
    draw_probability: drawProbability,
    away_probability: awayProbability,
    predicted_winner: winner,
    advice: text(record.advice),
    under_over: text(record.underOver),
    predicted_goals: record.predictedGoals || null,
    comparison: record.comparison || null,
    confidence: publishedInt(record.confidence),
    model_version: text(record.modelVersion),
    // Kademe listesi 0005 göçündeki CHECK ile aynı; tanınmayan bir değer
    // satırı reddettirmek yerine NULL'a düşer ("bilinmiyor", "sıfır" değil).
    data_basis: DATA_BASIS_VALUES.has(text(record.dataBasis)) ? text(record.dataBasis) : null,
    frozen: Boolean(record.frozen),
    refresh_stage: text(record.refreshStage),
    provider_updated_at: isoStamp(record.providerUpdatedAt),
    calculated_at: isoStamp(record.calculatedAt) || new Date().toISOString(),
    expires_at: isoStamp(record.expiresAt),
    raw_provider_data: record.rawProviderData || null,
    source_id: sourceId || null
  };
}

/**
 * TRANSFER DURUMU EŞLEMESİ — İDDİA, DOĞRULANMIŞ SAYILMAZ.
 *
 * Bu depoda bir kez bir iddia doğrulanmış transfer listesine girdi ve
 * oyuncu, hiç imzalamadığı kulübün kadrosunda göründü. Eşleme burada
 * açıkça yazılı: tanınmayan her durum `rumour`a düşer — yani en
 * temkinli sınıfa, en iddialısına değil.
 */
function transferStatus(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (["confirmed", "official", "resmi", "resmî", "done"].includes(raw)) return "confirmed";
  if (["agreed", "anlaşma", "anlasma", "agreement"].includes(raw)) return "agreed";
  if (["negotiating", "görüşme", "gorusme", "talks"].includes(raw)) return "negotiating";
  if (["cancelled", "canceled", "iptal"].includes(raw)) return "cancelled";
  return "rumour";
}

function transfer(record, sourceId) {
  const id = text(record && record.id);
  const playerName = text(record && record.playerName);
  if (!id || !playerName) return null;

  const status = transferStatus(record.status);
  const sourceUrl = text(record.sourceUrl);

  // Şemadaki `transfers_confirmed_needs_source`: kaynaksız "doğrulandı"
  // olmaz. Kaynağı olmayan kayıt reddedilmek yerine İDDİAYA düşürülür —
  // bilgi korunur, iddia gerçek gibi gösterilmez.
  const safeStatus = status === "confirmed" && !sourceUrl ? "agreed" : status;

  return {
    id,
    player_id: text(record.playerId),
    player_name: playerName,
    from_team: text(record.fromTeam),
    to_team: text(record.toTeam),
    league: text(record.league),
    position: text(record.position),
    transfer_type: text(record.type),
    fee_eur: record.feeEur !== undefined ? published(record.feeEur) : moneyEur(record.fee),
    fee_label: text(record.fee),
    status: safeStatus,
    confidence: published(record.confidence),
    announced_on: isoDate(record.date),
    season: text(record.season),
    source_id: sourceId || null,
    source_name: text(record.sourceName),
    source_url: sourceUrl,
    last_verified_at: isoStamp(record.lastVerifiedAt),
    note: text(record.note)
  };
}

/**
 * `data/post-match-reports.json` kaydından analiz satırı.
 *
 * Bu depoda maç anlatısının GÖVDESİ (paragraflar) ayrı bir üretim
 * adımında (`generate-post-match-pages.mjs`) kuruluyor ve statik
 * sayfaya gömülüyor; kütükteki kayıt anlatının KENDİSİNİ değil,
 * KAPSAM DURUMUNU taşıyor (`coverageGrade`, `dataSources`,
 * `missingInputs`). `body` burada bilerek boş dizi kalabilir — icat
 * edilmiş bir anlatı yazmaktansa "gövde bu alımda yok" demek doğrudur.
 */
function analysisReport(record, sourceId) {
  const id = text(record && (record.slug || record.matchId));
  if (!id) return null;

  const seo = (record && record.seo) || {};

  return {
    id,
    match_id: text(record.matchId),
    kind: "post-match",
    subject_id: null,
    locale: "tr",
    model_version: text(record.modelVersion || record.analysisVersion),
    headline: text(seo.title),
    lead: text(record.coverageNote || seo.description),
    body: Array.isArray(record.body) ? record.body : [],
    coverage_grade: text(record.coverageGrade),
    generated_at: isoStamp(record.analysisGeneratedAt || record.generatedAt) || new Date().toISOString(),
    source_id: sourceId || null
  };
}

module.exports = {
  analysisReport,
  fixturePrediction,
  birthDate,
  foot,
  heightCm,
  isoDate,
  isoStamp,
  match,
  moneyEur,
  player,
  playerStats,
  published,
  publishedInt,
  slug,
  team,
  text,
  transfer,
  transferStatus,
  weightKg
};
