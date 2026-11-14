/**
 * CANLI SKORLAR BANDI — HANGİ MAÇ, HANGİ SIRADA, HANGİ ETİKETLE.
 *
 * Kural TEK ve MUTLAK: yalnızca ŞU AN OYNANAN maçlar
 * banda girer. Başlamamış, bitmiş, ertelenen ya da iptal edilen hiçbir
 * kayıt buraya düşmez — "canlı" iddiası bir zaman iddiasıdır ve veri
 * katmanında, çizim katmanında değil, burada kesilir.
 *
 * Süzgeç services/liveScoreFilter.js'in LIVE_STATUSES kümesini FINISHED
 * kümesi hariç kullanır: devre arası (HT) "canlı" sayılır (maç sürüyor,
 * yalnızca duraklamış), ama bitmiş/ertelenmiş asla sayılmaz.
 *
 * DURUM TEK BAŞINA YETMEZ — SAAT DE SORULUR.
 *
 * Bant uzun süre yalnızca `status` alanına baktı ve bu sessizce yanlıştı:
 * sağlayıcı bir maçı hiç FINISHED'e çevirmezse kayıt takvimde sonsuza dek
 * "LIVE, 89'" olarak kalıyor. data/fixture-calendar.json bu zombi
 * kayıtlarla dolmuştu (6 günde 792 kayıt, 647'si 24 saatten eski) ve her
 * derleme onları ana sayfanın tepesine yeniden basıyordu: 11 Eylül akşamı
 * yayındaki bant 6 Eylül'de oynanmış on altı maçı "canlı" rozetiyle,
 * yanıp sönen nabızla ve akan dakikayla gösteriyordu.
 *
 * "Canlı" bir ZAMAN iddiasıdır; zamana bakmadan doğrulanamaz. Karar artık
 * services/matchStatus.js#liveVerdict'e devredildi — sitenin bu soruya tek
 * cevabı orası ve "bayat canlı" koruması (başlama saatinin üstünden
 * LIVE_GRACE_MS geçmişse canlı DEĞİL) zaten orada tanımlı.
 *
 * TEK SAPMA — SKOR. `liveVerdict` skorsuz canlı iddiasını reddeder, çünkü
 * kart "Canlı" deyip "– / –" gösteremez. Bant bunu gösterebilir: dakika
 * göstermek skor iddiası değildir (bkz. aşağıdaki `isCurrentlyLive` notu).
 * Bu yüzden yalnızca `live-without-score` gerekçesi bantta kabul edilir;
 * `stale-live` dahil diğer tüm reddedişler bandı da bağlar.
 *
 * Lig adı fixture.league.id üzerinden doğrulanmış katalog adına çözülür
 * (services/competitionCatalog.js, Faz B'nin kök hata düzeltmesiyle aynı
 * kural) — ham sağlayıcı metni değil.
 */

const { LIVE_STATUSES, isScoreNumber } = (() => {
  const filter = require("./liveScoreFilter");
  return {
    LIVE_STATUSES: filter.LIVE_STATUSES,
    isScoreNumber: (value) => {
      if (typeof value === "number") return isFinite(value);
      if (typeof value === "string" && value.trim() !== "") return isFinite(Number(value));
      return false;
    }
  };
})();
const { resolveCompetitionId, findCompetition } = require("./competitionCatalog");
const { matchDetailPath } = require("./matchProgram");
const { LIVE_GRACE_MS, kickoffMs, liveVerdict } = require("./matchStatus");

/** Bantta en fazla kaç maç? Kayan bir şerit liste değildir. */
const MAX_ITEMS = 16;

/** Bitmiş sayılan durumlar asla "canlı" değildir — LIVE_STATUSES'tan ayrıca çıkarılır. */
const FINISHED_STATUSES = new Set(["FINISHED", "FT", "AET", "PEN", "AWARDED", "AWD", "WO"]);
const OFF_STATUSES = new Set(["POSTPONED", "PST", "CANCELLED", "CANC", "ABANDONED", "ABD", "SUSPENDED", "SUSP", "INTERRUPTED", "INT"]);

/** Kısa durum etiketi (dakika yoksa). */
const SHORT_STATUS_LABELS = Object.freeze({
  HT: "HT",
  HALFTIME: "HT",
  ET: "ET",
  BT: "BT",
  P: "Pen",
  PAUSED: "Devre arası",
  LIVE: "Canlı",
  IN_PLAY: "Canlı",
  "1H": "Canlı",
  "2H": "Canlı"
});

function statusOf(match) {
  return String((match && (match.status || match.providerStatus)) || "").toUpperCase();
}

/**
 * Maç ŞU AN oynanıyor mu?
 *
 * Skoru olsun ya da olmasın — dakika göstermek skor iddiası değildir; bu
 * yüzden skor kapısı bant için KAPATILIR. Başka hiçbir kapı kapatılmaz:
 * özellikle `stale-live` (başlama saatinin üstünden LIVE_GRACE_MS geçmiş)
 * buradan geçemez — dosyada donmuş kalmış bir "LIVE" kaydı bandın tepesine
 * çıkaran şey tam olarak oydu.
 *
 * SKOR KAPISI REDDİ ELEYEREK DEĞİL, KAPIYI KAPATARAK AŞILIR. Reddi
 * `reason === "live-without-score"` diye kabul etmek, kapı sırası yüzünden
 * fazlasını geçirir: skor kapısı doğrulanabilirlik kapısından ÖNCE çalışır,
 * dolayısıyla ne başlama saati ne güncellenme damgası taşıyan bir kayıt —
 * canlılığı hiçbir biçimde doğrulanamayan, süresi de hiç dolmayacak kayıt —
 * o redde takılır ve "skorsuz canlı" sanılıp banda girerdi.
 * `requireScore: false` ile skor kapısı hiç çalışmaz ve böyle bir kayıt
 * doğru kapıda, `live-without-clock`ta düşer.
 *
 * `nowMs` yalnızca test içindir; verilmezse şu an okunur.
 */
function isCurrentlyLive(match, options = {}) {
  if (!match || typeof match !== "object") return false;
  const status = statusOf(match);
  if (FINISHED_STATUSES.has(status) || OFF_STATUSES.has(status)) return false;
  if (match.live !== true && !LIVE_STATUSES.includes(status)) return false;

  return liveVerdict(match, {
    nowMs: Number.isFinite(options.nowMs) ? options.nowMs : undefined,
    requireScore: false
  }).live;
}

/** "67'", "HT", "ET" — dakika varsa dakika, yoksa kısa durum etiketi. */
function minuteOrStatusLabel(match) {
  const minute = match && (match.minute ?? match.elapsed);
  if (minute !== undefined && minute !== null && isFinite(Number(minute)) && String(minute).trim() !== "") {
    return `${minute}'`;
  }
  if (match && typeof match.time === "string" && /^\d+(\+\d+)?'$/.test(match.time.trim())) {
    return match.time.trim();
  }
  return SHORT_STATUS_LABELS[statusOf(match)] || "Canlı";
}

/**
 * BANT ÖĞESİNİN SON KULLANMA ANI.
 *
 * Süzgeç derleme anında çalışıyor, bant ise okunduğu anda görülüyor ve
 * ikisi aynı an değil. Türkçe tarafta app.js bandı canlı uçtan tazeliyor,
 * ama İngilizce sayfalara app.js bilerek yüklenmiyor (yüklenseydi bandın
 * bütün etiketleri Türkçe basılırdı) — orada bant YALNIZCA son derleme
 * kadar tazeydi. Gece yarısından hemen sonra bakıldığında 21:15'te başlayıp
 * çoktan bitmiş bir maç hâlâ "Live 12'" diyordu.
 *
 * Çözüm veriyi taşımak: her öğe kendi canlı payının bittiği anı yanında
 * götürüyor, tarayıcı da o an geçtiğinde öğeyi düşürüyor. Kural yine tek
 * yerden — `LIVE_GRACE_MS`, sunucudaki kapının kullandığı payın ta kendisi.
 *
 * Başlama saati okunamayan kayıtta damga YOK: sunucu kapısı da o kaydı
 * saate bakmadan geçiriyor, istemci ondan fazlasını iddia etmemeli.
 */
function liveUntilOf(match) {
  const kickoff = kickoffMs(match);
  return kickoff === null ? null : new Date(kickoff + LIVE_GRACE_MS).toISOString();
}

/** Skor metni. Skor sayısal değilse "–" — uydurma yok. */
function scoreValue(value) {
  return isScoreNumber(value) ? Number(value) : null;
}

function leagueLabelOf(match) {
  const resolvedId = resolveCompetitionId(match);
  const competition = resolvedId ? findCompetition(resolvedId) : null;
  return (competition && competition.name) || String((match && match.league) || "").trim() || "Futbol";
}

/**
 * Ham maç listesini banda çevirir.
 *
 * `nowMs` süzgecin kendisine girer (bayat canlı koruması); verilmezse şu an
 * okunur. Derleme anı ile görüntüleme anı farklı olduğu için bant istemcide
 * `/api/matches?live=all` ile tazelenir — o uç da AYNI kapıdan geçer.
 * (`?status=live` günün tam listesini çeker; canlı yoklama onu kullanmaz.)
 */
function selectLiveTickerRecords(matches, options = {}) {
  const limit = Number.isFinite(options.limit) ? options.limit : MAX_ITEMS;
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();

  return (Array.isArray(matches) ? matches : [])
    .filter((match) => isCurrentlyLive(match, { nowMs }))
    .map((match) => {
      const homeTeam = String((match && match.homeTeam) || "").trim();
      const awayTeam = String((match && match.awayTeam) || "").trim();
      // Taraf adı eksikse kayıt banda girmez: boşluğu doldurmak bilgi üretmektir.
      if (!homeTeam || !awayTeam) return null;

      const score = match.score || {};
      return {
        id: String((match && match.id) || `${homeTeam}-${awayTeam}`),
        league: leagueLabelOf(match),
        homeTeam,
        awayTeam,
        homeScore: scoreValue(score.home),
        awayScore: scoreValue(score.away),
        minuteOrStatus: minuteOrStatusLabel(match),
        isHalftime: ["HT", "HALFTIME"].includes(statusOf(match)),
        liveUntil: liveUntilOf(match),
        href: matchDetailPath(match)
      };
    })
    .filter(Boolean)
    .slice(0, limit);
}

module.exports = {
  MAX_ITEMS,
  isCurrentlyLive,
  leagueLabelOf,
  minuteOrStatusLabel,
  selectLiveTickerRecords
};
