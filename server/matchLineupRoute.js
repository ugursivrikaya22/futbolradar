const {
  enforceRateLimit,
  getQuery,
  normalizeText,
  rejectUnsupportedMethod,
  sendError,
  sendSuccess,
  setCachePolicy,
  withTimeout
} = require("../api/_utils");
const apiFootballProvider = require("../services/providers/apiFootballProvider");
const { fetchOfficialLineup, normalizeOfficialLineup, LINEUP_REFRESH_WINDOW_MINUTES } =
  require("../services/officialLineupService");

/**
 * MAÇ DOSYASI İÇİN İLK 11 + CANLI DURUM UÇ NOKTASI.
 *
 *   GET /api/match-lineup?matchId=galatasaray-corum-fk-2026-08-14
 *
 * TEK UÇ NOKTA, TEK İSTEK. Maç dosyası sayfası iki şey soruyor: "ilk 11'ler
 * açıklandı mı?" ve "maç oynanıyor mu, skor kaç?". Bunları iki ayrı uç
 * noktaya bölmek, açık duran her sekmenin her yoklamada İKİ sağlayıcı
 * isteği harcaması demekti. Yanıt ikisini birden taşıyor.
 *
 * DOSYA `api/` ALTINDA DEĞİL — oy ve anket uç noktalarıyla aynı gerekçe:
 * Vercel'de `api/` altındaki her dosya bir sunucusuz işlev sayılıyor ve
 * Hobby planının 12 işlev sınırı dolu. Yönlendirme `api/[...route].js`.
 *
 * ── ASLA UYDURMA ─────────────────────────────────────────────────────────
 * Bu uç nokta tahmini bir on bir ÜRETMEZ. Sağlayıcı kadroyu yayımlamadıysa
 * `status: "pending"` ve BOŞ diziler döner; istemci de "henüz açıklanmadı"
 * yazar. "Muhtemel 11" başlığı altında kendi tahminimizi göstermek,
 * okuyucunun onu resmî sanma riskini taşıyor; o risk tahminin değerinden
 * büyük. Kadro geldiğinde `status: "confirmed"` olur ve başlık kendiliğinden
 * "Resmî İlk 11"e döner — ara bir "yarı resmî" durum yok.
 *
 * Takım başına ayrı onay var (`confirmed.home` / `confirmed.away`): sağlayıcı
 * bazen bir takımın kadrosunu diğerinden önce yayımlıyor. Tek bir bayrakla
 * modellemek, yayımlanmamış tarafı da açıklanmış göstermek olurdu.
 *
 * ── SAĞLAYICIYA NE ZAMAN GİDİLİR ─────────────────────────────────────────
 * Maç sayfası günlerce açık kalabilir ve arama motorları onu istedikleri
 * sıklıkta çeker. Kör yoklama, kotayı hiçbir şey değişmezken tüketirdi.
 * Bu yüzden sağlayıcıya YALNIZCA maç penceresi içinde gidilir:
 * başlama saatinden `LINEUP_REFRESH_WINDOW_MINUTES` (180 dk) önce başlar,
 * maç bitiminden bir süre sonra kapanır. Pencere dışında istek atılmaz;
 * durum `"scheduled"` (henüz erken) veya `"final"` (maç geçti) döner.
 */

const SOURCE = "match-lineup";
const PROVIDER_TIMEOUT_MS = 6000;

/** Maç bittikten sonra da bir süre canlı durum sorulur: uzatma, uzun
 *  duraklama ve sağlayıcının gecikmeli "FT" yazması bu aralığa sığar. */
const AFTER_KICKOFF_WINDOW_MINUTES = 210;

/** Sağlayıcı bitmiş sayılan durum kodları. */
const FINISHED_STATUSES = new Set(["FT", "AET", "PEN", "FINISHED", "POSTPONED", "CANC", "ABD", "AWD", "WO"]);
const LIVE_STATUSES = new Set(["1H", "2H", "HT", "ET", "BT", "P", "LIVE", "INT", "SUSP"]);

/**
 * VERİ DOSYASI SABİT DİZEYLE İSTENİR.
 *
 * `require(değişken)` Vercel'in statik bağımlılık çözümlemesinde görünmez;
 * dosya işlev paketine girmez ve uç nokta canlıda sessizce boş döner.
 * Gerekçenin uzun hâli `server/homePollRoute.js` başında.
 */
function loadFixtures() {
  try {
    return require("../data/fixture-calendar.json");
  } catch (error) {
    return null;
  }
}

function fixtureList(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.matches)) return payload.matches;
  return [];
}

function findFixture(matchId) {
  const wanted = normalizeText(matchId);
  if (!wanted) return null;
  return fixtureList(loadFixtures()).find((match) => normalizeText(match && match.id) === wanted) || null;
}

/** Sağlayıcı fikstür kimliği — yoksa sağlayıcıya hiç gidilmez. */
function providerFixtureId(fixture) {
  const ids = (fixture && fixture.providerIds) || {};
  const candidate = ids.apiFootball || fixture.providerId;
  const text = String(candidate == null ? "" : candidate).trim();
  return /^\d+$/.test(text) ? text : null;
}

function kickoffMs(fixture) {
  const stamp = fixture && fixture.kickoff ? Date.parse(fixture.kickoff) : NaN;
  return Number.isFinite(stamp) ? stamp : null;
}

/**
 * Pencere kararı. Başlama saati okunamıyorsa sağlayıcıya GİDİLMEZ:
 * bilinmeyen bir saat için "her ihtimale karşı sorayım" demek, her
 * ziyaretçide bir sağlayıcı isteği demekti.
 */
function windowState(fixture, nowMs) {
  const kickoff = kickoffMs(fixture);
  if (kickoff == null) {
    return { phase: "unknown", shouldFetch: false, minutesToKickoff: null };
  }

  const minutesToKickoff = (kickoff - nowMs) / 60000;
  if (minutesToKickoff > LINEUP_REFRESH_WINDOW_MINUTES) {
    return { phase: "scheduled", shouldFetch: false, minutesToKickoff };
  }
  if (minutesToKickoff < -AFTER_KICKOFF_WINDOW_MINUTES) {
    return { phase: "final", shouldFetch: false, minutesToKickoff };
  }
  return { phase: minutesToKickoff > 0 ? "pre-match" : "in-play", shouldFetch: true, minutesToKickoff };
}

/** Sağlayıcının ham oyuncu kaydından yalnızca gösterilecek alanlar. */
function publicPlayer(player) {
  return {
    name: player && player.name ? String(player.name) : null,
    number: player && player.number != null ? player.number : null,
    position: player && player.position ? String(player.position) : null
  };
}

function publicSide(side, teamName, teamLogo) {
  const startingXI = ((side && side.startingXI) || []).map(publicPlayer).filter((player) => player.name);
  const substitutes = ((side && side.substitutes) || []).map(publicPlayer).filter((player) => player.name);
  return {
    team: teamName || null,
    logo: teamLogo || null,
    // Diziliş yalnızca kadroyla birlikte anlamlı: on bir yokken "4-2-3-1"
    // yazmak, olmayan bir kadro iddiasının kısaltılmış hâli olurdu.
    formation: startingXI.length ? (side && side.formation) || null : null,
    startingXI,
    substitutes
  };
}

/**
 * ONAY EŞİĞİ ON BİR OYUNCU.
 *
 * Sağlayıcı kadroyu doldururken kısa bir süre eksik liste dönebiliyor.
 * Yedi oyuncuyu "resmî ilk 11" diye göstermek, açıklanmamış bir kadroyu
 * açıklanmış saymanın en kolay yolu; o yüzden tam on bir aranıyor.
 */
function isConfirmedSide(side) {
  return Boolean(side && Array.isArray(side.startingXI) && side.startingXI.length === 11);
}

function lineupStatusFor(home, away, phase) {
  const homeReady = isConfirmedSide(home);
  const awayReady = isConfirmedSide(away);
  if (homeReady && awayReady) return "confirmed";
  if (homeReady || awayReady) return "partial";
  if (phase === "scheduled") return "scheduled";
  if (phase === "final") return "final";
  return "pending";
}

/** Sağlayıcının canlı fikstür kaydından skor tablosu. Kayıt yoksa
 *  fikstür dosyasındaki (derleme anındaki) durum korunur — sıfır-sıfır
 *  uydurulmaz. */
/**
 * `Number(null)` sıfır döner ve `Number.isFinite(0)` doğrudur: bu iki adım,
 * skoru olmayan bir maçı "0 - 0" yapmaya yeterdi. Boş değer önce elenir.
 */
function scoreValue(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function scoreboardFrom(providerMatch, fixture) {
  const source = providerMatch || fixture || {};
  const score = source.score || {};
  const providerStatus = String(source.providerStatus || source.status || "").toUpperCase();
  return {
    status: source.status || fixture.status || null,
    providerStatus: providerStatus || null,
    live: LIVE_STATUSES.has(providerStatus),
    finished: FINISHED_STATUSES.has(providerStatus),
    minute: source.minute != null ? source.minute : source.elapsed != null ? source.elapsed : null,
    home: scoreValue(score.home),
    away: scoreValue(score.away)
  };
}

async function readProviderFixture(fixtureId) {
  try {
    const fixtures = await withTimeout(apiFootballProvider.getFixtures({ fixtureId }), PROVIDER_TIMEOUT_MS);
    if (!Array.isArray(fixtures)) return null;
    return fixtures.find((item) => String(item && item.id) === String(fixtureId)) || null;
  } catch (error) {
    return null;
  }
}

async function readOfficialLineup(fixtureId) {
  try {
    const fetched = await withTimeout(fetchOfficialLineup(fixtureId), PROVIDER_TIMEOUT_MS);
    return normalizeOfficialLineup(fixtureId, fetched);
  } catch (error) {
    return normalizeOfficialLineup(fixtureId, { status: "unavailable", reason: "provider-error", raw: null });
  }
}

async function handleMatchLineup(req, res) {
  if (rejectUnsupportedMethod(req, res)) {
    return;
  }

  const query = getQuery(req);
  const fixture = findFixture(query.matchId || query.match || query.id);

  if (!fixture) {
    // Uydurma fikstür üretilmez: bilinmeyen kimlik 404.
    setCachePolicy(res, "match-lineup");
    return sendError(res, 404, "Bu maç fikstürde bulunamadı.", "MATCH_NOT_FOUND", SOURCE);
  }

  const nowMs = Date.now();
  const state = windowState(fixture, nowMs);
  const providerId = providerFixtureId(fixture);
  const configured = apiFootballProvider.hasConfig();

  // Onaylanmış kadro bir daha değişmez; maç da bittiyse yanıt uzun süre
  // önbelleklenebilir. Onaydan önce kısa önbellek: kadronun yayımlanmasıyla
  // sayfanın onu görmesi arasındaki gecikme dakikalar sürmemeli.
  const canFetch = state.shouldFetch && configured && Boolean(providerId);

  let lineup = null;
  let providerMatch = null;
  if (canFetch) {
    [lineup, providerMatch] = await Promise.all([
      readOfficialLineup(providerId),
      readProviderFixture(providerId)
    ]);
  }

  const home = publicSide(lineup && lineup.home, fixture.homeTeam, fixture.homeTeamLogo);
  const away = publicSide(lineup && lineup.away, fixture.awayTeam, fixture.awayTeamLogo);
  const status = lineupStatusFor(home, away, state.phase);
  const scoreboard = scoreboardFrom(providerMatch, fixture);

  setCachePolicy(res, status === "confirmed" && scoreboard.finished ? "match-lineup-final" : "match-lineup");
  if (enforceRateLimit(req, res, { limit: 240, windowMs: 60000 })) return;

  return sendSuccess(
    res,
    {
      matchId: fixture.id,
      fixtureId: providerId,
      kickoff: fixture.kickoff || null,
      venue: fixture.venue || null,
      phase: state.phase,
      status,
      confirmed: { home: isConfirmedSide(home), away: isConfirmedSide(away) },
      home,
      away,
      scoreboard,
      receivedAt: lineup ? lineup.receivedAt : null
    },
    canFetch && (lineup || providerMatch) ? apiFootballProvider.source : SOURCE,
    undefined,
    {
      // Tanı için: sayfa boş kaldığında nedeni yanıtın kendisinde olsun.
      // "Sağlayıcı yapılandırılmamış" ile "kadro henüz yayımlanmadı"
      // aynı ekranı üretiyor ama farklı işler gerektiriyor.
      polled: canFetch,
      providerConfigured: configured,
      reason: canFetch
        ? null
        : !providerId
          ? "no-provider-fixture-id"
          : !configured
            ? "provider-not-configured"
            : `outside-window:${state.phase}`
    }
  );
}

module.exports = {
  handleMatchLineup,
  // Test yüzeyi.
  AFTER_KICKOFF_WINDOW_MINUTES,
  isConfirmedSide,
  lineupStatusFor,
  publicSide,
  scoreboardFrom,
  windowState
};
