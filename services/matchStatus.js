/**
 * MAÇ DURUMU — SAĞLAYICI DURUM SÖZLÜĞÜ VE YAŞAM DÖNGÜSÜ
 *
 * Sağlayıcının (API-Football) verdiği kısa kodların TAMAMI burada tek yerde
 * tanımlıdır. Bu modül olmadan her katman kendi eşlemesini yazıyordu ve
 * ikisi de eksikti:
 *
 *   services/providers/apiFootballProvider.js  — yalnızca 1H/2H/HT/BT/ET/P
 *     ve FT/AET/PEN tanıyor, GERİ KALAN HER ŞEYİ "SCHEDULED" sayıyordu.
 *     Ertelenen (PST), iptal edilen (CANC), tatil edilen (ABD), askıya
 *     alınan (SUSP) ve hükmen (AWD/WO) sonuçlanan maçlar "programlandı"
 *     görünüyordu. Başlama saati geçtiği için arayüz bunları "oynanıyor"
 *     bandına alıyordu: OYNANMAYAN BİR MAÇ CANLI GİBİ GÖSTERİLİYORDU.
 *
 *   scripts/sync-fixture-calendar.mjs — SUSP, INT, AWD ve WO tanımlı değildi.
 *
 * ÜÇ AYRI SORU, ÜÇ AYRI CEVAP. Kodun karıştırdığı şey buydu:
 *
 *   1. Maç şu anda oynanıyor mu?     → isLiveStatus
 *   2. Maç tamamlandı mı?            → isFinishedStatus
 *   3. Maç analiz edilebilir mi?     → isAnalyzableStatus
 *
 * Hükmen sonuçlar (AWD/WO) tamamlanmıştır ve analiz hattına GİRER — ama
 * maç sahada oynanmadığı için olay/istatistik beklenmez; analiz kaçınılmaz
 * olarak "partial_data" olur. Ertelenen/iptal/tatil edilen maçlar
 * tamamlanmış SAYILMAZ: nihai sonuçları yoktur.
 *
 * BAYAT CANLI KORUMASI. Başlama saati geçmiş ama sağlayıcıdan doğrulanmış
 * canlı sinyali gelmeyen maç canlı gösterilmez. `liveVerdict()` bu kararı
 * tek yerde verir ve sebebini döndürür, böylece arayüz "veri yok" durumunu
 * yazabilir. Skor ya da dakika UYDURULMAZ.
 */

/** Sağlayıcı kısa kodu → kanonik durum. */
const STATUS_VOCABULARY = Object.freeze({
  // Oynanmadı
  TBD: "SCHEDULED",
  NS: "SCHEDULED",
  SCHEDULED: "SCHEDULED",
  TIMED: "SCHEDULED",
  NOT_STARTED: "SCHEDULED",

  // Oynanıyor
  "1H": "LIVE",
  "2H": "LIVE",
  ET: "LIVE",
  P: "LIVE",
  LIVE: "LIVE",
  IN_PLAY: "LIVE",

  // Ara — hâlâ "in-play", ama oyun durmuş
  HT: "HALFTIME",
  BT: "HALFTIME",
  HALFTIME: "HALFTIME",
  PAUSED: "HALFTIME",

  // Geçici kesinti — maç sürüyor sayılır, sık yoklanır
  SUSP: "INTERRUPTED",
  SUSPENDED: "INTERRUPTED",
  INT: "INTERRUPTED",
  INTERRUPTED: "INTERRUPTED",

  // Tamamlandı, sahada oynandı
  FT: "FINISHED",
  AET: "FINISHED",
  PEN: "FINISHED",
  FINISHED: "FINISHED",
  FULL_TIME: "FINISHED",
  AFTER_EXTRA_TIME: "FINISHED",
  PENALTIES: "FINISHED",
  "MATCH FINISHED": "FINISHED",

  // Tamamlandı, hükmen
  AWD: "AWARDED",
  AWARDED: "AWARDED",
  WO: "AWARDED",
  WALKOVER: "AWARDED",

  // Oynanmadı ve oynanmayacak (ya da ertelendi)
  PST: "POSTPONED",
  POSTPONED: "POSTPONED",
  CANC: "CANCELLED",
  CANCELLED: "CANCELLED",
  ABD: "ABANDONED",
  ABANDONED: "ABANDONED"
});

/** Oyun sürüyor (devre arası ve geçici kesinti dahil). */
const LIVE_STATES = new Set(["LIVE", "HALFTIME", "INTERRUPTED"]);

/** Sahada oynanıp tamamlanmış. */
const PLAYED_STATES = new Set(["FINISHED"]);

/** Analiz hattına giren tüm durumlar — hükmen sonuçlar dahil. */
const ANALYZABLE_STATES = new Set(["FINISHED", "AWARDED"]);

/** Nihai sonucu olmayan, oynanmamış maçlar. */
const UNPLAYED_STATES = new Set(["POSTPONED", "CANCELLED", "ABANDONED"]);

/**
 * Başlama saati geçmiş bir maçın doğrulanmış canlı sinyal olmadan "hâlâ
 * oynanıyor" sayılabileceği en uzun süre. Uzatma, devre arası ve makul
 * gecikme buna sığar; ötesinde maç ya bitmiştir ya da sağlayıcı veriyi
 * vermiyordur. İkisi de "canlı" değildir.
 */
const LIVE_GRACE_MS = 150 * 60 * 1000;

/**
 * CANLI VERİNİN TAZELİK ÖMRÜ.
 *
 * `LIVE_GRACE_MS` "maç ne kadar sürer?" sorusunu yanıtlar; bu eşik ise
 * "elimdeki kayıt ne kadar önce güncellendi?" sorusunu. İkisi ayrı sorudur:
 * 20:00'de başlayan bir maç 20:30'da hâlâ süre penceresindedir, ama o maçın
 * kaydı en son 20:02'de güncellendiyse ekrandaki dakika ve skor donmuştur.
 * Sağlayıcı akışı kesildiğinde, önbellek eski JSON'u servis ettiğinde ya da
 * derleme anında dondurulmuş statik veri geri geldiğinde olan tam budur.
 *
 * Canlı bir maç dakikada bir güncellenir; on iki dakika hiç güncellenmemiş
 * bir "canlı" kayıt canlı değildir, DONMUŞTUR.
 */
const LIVE_DATA_STALE_MS = 12 * 60 * 1000;

/**
 * Sağlayıcı bir alanı döndürmediğinde arayüzde görünecek metin.
 *
 * "Veri bekleniyor" ile bilinçli olarak farklı: o metin "henüz gelmedi,
 * gelebilir" demek. Bu metin ise maç bitmiş ve sağlayıcı o veriyi hiç
 * vermemiş demek.
 */
const PROVIDER_MISSING_LABEL = "Veri sağlayıcı tarafından sunulmadı";

/** Doğrulanamayan canlı durum için arayüz metni. */
const UNVERIFIED_LIVE_LABEL = "Canlı veri doğrulanamadı";

const STATE_LABELS = Object.freeze({
  SCHEDULED: "Başlamadı",
  LIVE: "Canlı",
  HALFTIME: "Devre arası",
  INTERRUPTED: "Maça ara verildi",
  FINISHED: "Tamamlandı",
  AWARDED: "Hükmen sonuçlandı",
  POSTPONED: "Ertelendi",
  CANCELLED: "İptal edildi",
  ABANDONED: "Tatil edildi",
  UNKNOWN: "Durum doğrulanmadı"
});

function normalizeStatusToken(value) {
  return String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
}

/**
 * Kanonik duruma çevirir. TANINMAYAN KOD "SCHEDULED" OLMAZ — "UNKNOWN"
 * olur. Eski davranış (bilinmeyeni programlanmış saymak) ertelenen bir maçı
 * "birazdan başlayacak" gibi gösteriyordu; bilinmeyen durum bilinmeyen
 * olarak taşınmalı ki arayüz "durum doğrulanmadı" diyebilsin.
 */
function canonicalStatus(value) {
  const token = normalizeStatusToken(value);

  if (!token) {
    return "UNKNOWN";
  }

  // Sözlük hem boşluklu ("MATCH FINISHED") hem alt çizgili biçimi taşıyor.
  return STATUS_VOCABULARY[token] || STATUS_VOCABULARY[token.replace(/_/g, " ")] || "UNKNOWN";
}

/** Kayıttaki tüm durum alanları (kaynaklar farklı alan adları kullanıyor). */
function statusesOf(match) {
  if (!match) {
    return [];
  }

  return [match.status, match.providerStatus, match.matchStatus]
    .map(normalizeStatusToken)
    .filter(Boolean);
}

/**
 * Kaydın kanonik durumu. Birden fazla alan doluysa EN İLERİ durum kazanır:
 * sağlayıcı "FT" derken kürasyonlu kayıt hâlâ "SCHEDULED" taşıyor olabilir.
 */
const STATE_RANK = { UNKNOWN: 0, SCHEDULED: 1, LIVE: 2, HALFTIME: 2, INTERRUPTED: 2, POSTPONED: 3, CANCELLED: 3, ABANDONED: 3, AWARDED: 4, FINISHED: 4 };

function matchState(match) {
  const states = statusesOf(match).map(canonicalStatus).filter((state) => state !== "UNKNOWN");

  if (!states.length) {
    return match && match.live === true ? "LIVE" : "UNKNOWN";
  }

  return states.reduce((best, state) => (STATE_RANK[state] > STATE_RANK[best] ? state : best), states[0]);
}

function isLiveStatus(match) {
  return LIVE_STATES.has(matchState(match)) || (match && match.live === true && matchState(match) !== "FINISHED");
}

function isFinishedStatus(match) {
  return PLAYED_STATES.has(matchState(match));
}

function isAwardedStatus(match) {
  return matchState(match) === "AWARDED";
}

function isUnplayedStatus(match) {
  return UNPLAYED_STATES.has(matchState(match));
}

/** Analiz hattına girer mi? FT/AET/PEN + hükmen (AWD/WO). */
function isAnalyzableStatus(match) {
  return ANALYZABLE_STATES.has(matchState(match));
}

/**
 * Maç öncesi sayılan analiz kayıt durumları (`data/match-analyses.json`).
 * Maç bittiğinde bu durumlardan biri hâlâ takılı kalmışsa kayıt bayatlamıştır
 * — bkz. scripts/prune-stale-match-analyses.mjs.
 */
const PRE_MATCH_ANALYSIS_STATUSES = new Set(["scheduled", "live", "halftime"]);

/**
 * Bir maç-öncesi analiz kaydı ARTIK GEÇERSİZ mi?
 *
 * Tek yerde tanımlı olmalı: hem betik (scripts/prune-stale-match-analyses.mjs,
 * gerçek silme) hem de günlük sağlık kontrolü (services/dailyHealthCheckService.js,
 * salt-okunur sayım) AYNI kuralı kullanmalı — biri "3 bayat kayıt" derken
 * diğeri farklı bir eşiğe göre "0" derse rapor kendi kendiyle çelişir.
 *
 * `match` bulunamazsa (havuzdan düşmüş) kayıt yalnızca hâlâ maç öncesi
 * durumdaysa bayat sayılır; bulunursa maç tamamlanmış VE kayıt hâlâ maç
 * öncesi durumdaysa bayat sayılır.
 */
function isStaleAnalysisRecord(record, match) {
  const recordStatus = String((record && record.status) || "").toLowerCase();
  if (!PRE_MATCH_ANALYSIS_STATUSES.has(recordStatus)) return false;
  if (!match) return true;
  return isAnalyzableStatus(match);
}

function statusLabel(match) {
  return STATE_LABELS[matchState(match)] || STATE_LABELS.UNKNOWN;
}

// ── Geriye dönük adlar ───────────────────────────────────────────────────
// Zincirin geri kalanı bu adları kullanıyor; anlamları değişmedi.
const isFinishedMatch = isFinishedStatus;
const isAwardedMatch = isAwardedStatus;
const isAnalyzableMatch = isAnalyzableStatus;

/** Bitiş şekli: normal süre / uzatma / penaltılar / hükmen. */
function finishType(match) {
  const tokens = statusesOf(match);

  if (tokens.some((token) => token === "PEN" || token === "PENALTIES")) return "penalties";
  if (tokens.some((token) => token === "AET" || token === "AFTER_EXTRA_TIME")) return "extra-time";
  if (isAwardedStatus(match)) return "awarded";

  return "regular";
}

const FINISH_LABELS = Object.freeze({
  regular: "Normal sürede tamamlandı",
  "extra-time": "Uzatma devrelerinde tamamlandı",
  penalties: "Penaltı atışlarıyla belirlendi",
  awarded: "Hükmen sonuçlandı"
});

function finishLabel(match) {
  return FINISH_LABELS[finishType(match)];
}

function kickoffMs(match) {
  const raw = String((match && (match.kickoff || match.date || match.utcDate)) || "");
  if (!raw) return null;
  const hasTime = raw.includes("T") || raw.includes(":");
  const parsed = Date.parse(hasTime ? raw : `${raw.slice(0, 10)}T00:00:00+03:00`);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * KAYDIN SON GÜNCELLENME ANI.
 *
 * Sağlayıcılar ve ara katmanlar bu damgayı altı ayrı adla taşıyor; hiçbiri
 * garanti değil. Hepsi denenir, ilk OKUNABİLİR olan kazanır — okunamayan
 * bir damga "damga yok" demektir, "şimdi güncellendi" demek değil.
 *
 * Damga yoksa `null` döner ve tazelik kapısı o kayıt için ÇALIŞMAZ; onun
 * yerine başlama saati kapısı devreye girer. Damgayı uydurmak (ör. yokken
 * `Date.now()` varsaymak) donmuş kaydı taze ilan etmek olurdu.
 */
function updatedAtMs(match) {
  if (!match || typeof match !== "object") return null;

  // SSE anlık görüntüsünde (services/liveScoreStream.js#matchSnapshot) üst
  // düzeyde `updatedAt`/`fetchedAt` YOKTUR; sağlayıcının gerçek yaşı
  // `timing.serverReceivedAt` içinde taşınır. Okumazsak canlı akıştan gelen
  // her kayıt "damgasız" görünür ve tazelik kapısı o kayıtlar için hiç
  // çalışmaz — tam da donmuş akışın yakalanması gereken yer.
  const timing = (match.timing && typeof match.timing === "object") ? match.timing : {};

  const candidates = [
    match.updatedAt, match.updated_at,
    match.lastUpdated, match.last_updated,
    match.fetchedAt, match.fetched_at,
    match.lastSyncedAt, match.last_synced_at,
    timing.serverReceivedAt, timing.backend_receive_time
  ];

  // `timestamp` BİLEREK LİSTEDE YOK. API-Football'da `fixture.timestamp`
  // kaydın güncellenme anı DEĞİL, BAŞLAMA saatidir (saniye cinsinden). Onu
  // "son güncelleme" sanmak, başlama saatinin üstünden tazelik ömrü geçen
  // HER maçı — yani gerçekten canlı olan her maçı — bayat ilan ederdi.

  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || candidate === "") continue;

    // Saniye cinsinden UNIX damgası milisaniyeye çevrilir; milisaniye
    // damgası olduğu gibi kalır. (Eşik 1e12: 2001'den sonraki her
    // milisaniye damgası bunun üstünde, her saniye damgası altındadır.)
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate < 1e12 ? candidate * 1000 : candidate;
    }

    const raw = String(candidate).trim();
    if (!raw) continue;

    if (/^\d+$/.test(raw)) {
      const numeric = Number(raw);
      if (Number.isFinite(numeric)) return numeric < 1e12 ? numeric * 1000 : numeric;
      continue;
    }

    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) return parsed;
  }

  return null;
}

/**
 * TAKVİM GÜNÜ — TEK TANIM.
 *
 * "Bu maç hangi güne ait?" sorusu sitenin her yerinde ISO dizesinin ilk on
 * karakteri dilimlenerek yanıtlanıyordu. Bu, YALNIZCA başlama saati TSİ
 * ofsetiyle yazılmışsa doğrudur. UTC ofsetli tek bir kayıt (sağlayıcı öyle
 * döndürüyordu) TSİ 00:00-02:59 arasında başlayan maçları bir önceki güne
 * yazar: gece yarısını geçen maç "dün oynanmış" görünür, "Bugünün Maçları"
 * listesi de onu yanlış güne koyar.
 *
 * Burada gün, dizeyi kesip atarak değil, anı Europe/Istanbul'a çevirerek
 * bulunur. Saat taşımayan kayıtlarda (yalnızca "2026-07-17") çevrilecek bir
 * an yoktur; değer olduğu gibi kullanılır — gün UYDURULMAZ.
 */
const ISTANBUL_DAY_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Istanbul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

// Only a pure timestamp-to-day conversion is cached. Scores, live verdicts
// and the current clock are never cached. Bound memory for arbitrary inputs.
const ISTANBUL_DAY_MEMO = new Map();
const ISTANBUL_DAY_MEMO_LIMIT = 8192;
function istanbulDay(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (!raw.includes("T")) return raw.slice(0, 10);
  if (ISTANBUL_DAY_MEMO.has(raw)) return ISTANBUL_DAY_MEMO.get(raw);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw.slice(0, 10);
  const day = ISTANBUL_DAY_FORMATTER.format(parsed);
  if (ISTANBUL_DAY_MEMO.size >= ISTANBUL_DAY_MEMO_LIMIT) ISTANBUL_DAY_MEMO.clear();
  ISTANBUL_DAY_MEMO.set(raw, day);
  return day;
}

/** Kaydın takvim günü (kickoff/date/utcDate sırasıyla). */
function matchDay(match) {
  return istanbulDay(match && (match.kickoff || match.date || match.utcDate));
}

/**
 * SKOR OKUNABİLİR Mİ?
 *
 * Canlı bir maçın skoru VARDIR — maç başladığı anda 0-0'dır. Sıfır geçerli
 * bir skordur; eksik olan `null`/`undefined`tır. Bu ayrım önemli: `0` ile
 * "bilmiyorum"u aynı kefeye koyan bir kontrol, başlamış maçı canlı
 * saymazdı.
 */
function isScoreValue(value) {
  // `Number(null)` SIFIRDIR. Doğrudan `Number()`e vermek, eksik skoru 0-0
  // sanmak demekti — tam da bu kapının engellemesi gereken şey.
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string" && value.trim() !== "") return Number.isFinite(Number(value));
  return false;
}

function hasReadableScore(match) {
  const score = match && match.score;
  if (!score || typeof score !== "object") return false;
  return isScoreValue(score.home) && isScoreValue(score.away);
}

/**
 * BAYAT CANLI KORUMASI.
 *
 * "Bu maç şu anda canlı gösterilmeli mi?" sorusunun tek cevabı. Üç sonuç:
 *
 *   live       — sağlayıcı canlı diyor VE skoru okunabiliyor, göster.
 *   unverified — canlı iddiası var ama arkasını dolduran veri yok. Canlı
 *                GÖSTERME; arayüz "canlı veri doğrulanamadı" yazar. Skor ya
 *                da dakika uydurulmaz.
 *   not-live   — maç ya başlamadı ya bitti ya da oynanmayacak.
 *
 * `stale` bayrağı, canlı işaretli ama uzun süredir güncellenmemiş maçları
 * ayırır: yeniden denemeye değer, ama o hâliyle canlı sayılmaz.
 *
 * SKOR KAPISI. Üç kapı vardı — bitmiş, oynanmamış, bayat-canlı — ama
 * sağlayıcı "LIVE" deyip skoru `null` gönderdiğinde maç yine de canlı
 * sayılıyordu. Ekranda "Canlı" rozetiyle "– / –" duruyordu: okuyucuya
 * "şu anda oynanıyor ve skoru biliyoruz" diyen, ikincisi doğru olmayan bir
 * kart. Canlı iddiası, arkasını dolduran veri olmadan yapılmaz.
 */
function liveVerdict(match, options) {
  const settings = options || {};
  const nowMs = Number.isFinite(settings.nowMs) ? settings.nowMs : Date.now();
  const graceMs = Number.isFinite(settings.graceMs) ? settings.graceMs : LIVE_GRACE_MS;
  const state = matchState(match);

  if (PLAYED_STATES.has(state) || state === "AWARDED") {
    return { live: false, verdict: "not-live", reason: "finished", state };
  }

  if (UNPLAYED_STATES.has(state)) {
    return { live: false, verdict: "not-live", reason: "unplayed", state };
  }

  const kickoff = kickoffMs(match);

  if (LIVE_STATES.has(state)) {
    // 0. KAYNAK KAPISI. Canlı API'ye ulaşılamadığında istemci statik yedek
    //    JSON'a düşüyor (derleme anında dondurulmuş dosyalar). O dosyadaki
    //    "LIVE" kaydı bir zaman iddiasıdır ve arkasında canlı bir kaynak
    //    YOKTUR: sağlayıcı erişilemezken eski skoru canlı göstermek, yanlış
    //    veri değil yanlış İDDİA olur. Yedekten gelen kayıt canlı olamaz.
    if (match && match.__staticFallback === true) {
      return { live: false, verdict: "unverified", reason: "static-fallback", stale: true, state };
    }

    const dataStaleMs = Number.isFinite(settings.dataStaleMs) ? settings.dataStaleMs : LIVE_DATA_STALE_MS;
    const today = istanbulDay(new Date(nowMs).toISOString());
    const day = matchDay(match);

    // 1. GÜN KAPISI (Europe/Istanbul). Dünkü maç bugün canlı olamaz.
    //
    // Gün, ham ISO dizesi dilimlenerek değil `istanbulDay` ile bulunur;
    // aksi hâlde TSİ 00:00-02:59 arası başlayan maçlar bir önceki güne
    // yazılırdı. Gece yarısını geçerek oynanan maç bu kapıdan düşmez:
    // takvim günü dün olsa da başlama saati süre penceresinin içindedir,
    // karar aşağıdaki saat kapısına bırakılır.
    if (day && today && day < today && (kickoff === null || nowMs - kickoff > graceMs)) {
      return { live: false, verdict: "unverified", reason: "stale-day", stale: true, state, day, today };
    }

    // 2. BAŞLAMA SAATİ KAPISI. Canlı işaretli ama sağlayıcı uzun süredir
    // güncellemiyorsa bu maç muhtemelen bitmiştir ve sonucu gelmemiştir.
    if (kickoff !== null && nowMs - kickoff > graceMs) {
      return { live: false, verdict: "unverified", reason: "stale-live", stale: true, state };
    }

    // 3. VERİ TAZELİĞİ KAPISI. Süre penceresinin İÇİNDE olmak yetmez:
    //    kaydın kendisi de güncel olmalı. Donmuş bir kayıt (akış kesildi,
    //    önbellek eski JSON'u servis ediyor, derleme anındaki anlık görüntü
    //    geri geldi) doğru dakikayı değil, DONDUĞU dakikayı taşır.
    const updatedAt = updatedAtMs(match);
    if (updatedAt !== null && nowMs - updatedAt > dataStaleMs) {
      return {
        live: false,
        verdict: "unverified",
        reason: "stale-data",
        stale: true,
        state,
        updatedAt,
        ageMs: nowMs - updatedAt
      };
    }

    // 4. SKOR KAPISI. Skorsuz canlı iddiası yapılmaz; bkz. yukarıdaki not.
    //
    // Skor bandı bu kapıyı BİLEREK kapatır (`requireScore: false`): bant
    // skor değil DAKİKA iddia eder ve skoru "–" basar, ki bu bir skor
    // iddiası değildir (bkz. services/liveScoresTicker.js). Kart basan
    // yüzeyler için kapı açıktır — "Canlı" rozetinin yanında "– / –"
    // duran bir kart, ikisinden biri doğru olmayan iki şey söyler.
    const requireScore = settings.requireScore !== false;
    if (requireScore && !hasReadableScore(match)) {
      return { live: false, verdict: "unverified", reason: "live-without-score", stale: true, state };
    }

    // 5. DOĞRULANABİLİRLİK KAPISI. Başlama saati olmayan bir kayıtta
    //    yukarıdaki saat kapılarının hiçbiri çalışamaz: böyle bir kayıt
    //    SONSUZA DEK canlı kalırdı. Doğrulanamayan canlı iddiası
    //    gösterilmez — bu, "kökten engelle" kuralının son halkası.
    if (kickoff === null && updatedAt === null) {
      return { live: false, verdict: "unverified", reason: "live-without-clock", stale: true, state };
    }

    return { live: true, verdict: "live", reason: "provider-live", state };
  }

  // Buradan sonrası SCHEDULED veya UNKNOWN.
  if (kickoff === null) {
    return { live: false, verdict: "not-live", reason: "no-kickoff", state };
  }

  if (kickoff > nowMs) {
    return { live: false, verdict: "not-live", reason: "not-started", state };
  }

  // Başlama saati geçti, sağlayıcı canlı demiyor. Doğrulanmamış.
  return {
    live: false,
    verdict: "unverified",
    reason: nowMs - kickoff > graceMs ? "kickoff-long-passed" : "kickoff-passed-no-signal",
    stale: nowMs - kickoff <= graceMs,
    state
  };
}

/**
 * TEK ORTAK KAPI — ANA SAYFA, /canli-skor VE MAÇ MERKEZİ AYNI BURAYI SORAR.
 *
 * "Bu maçı CANLI diye gösterebilir miyim?" sorusunun tek cevabı. Her yüzey
 * (hero karuseli, Canlı Skorlar panosu, skor bandı, "Süper Lig'de Bugün",
 * maç merkezi) kendi durum eşlemesini yazdığı için kapılar yüzeyden yüzeye
 * ayrışıyordu: bant hiç saat kontrolü yapmıyor, pano yapıyordu. Ayrışma
 * ekranda "bir yerde canlı, öbür yerde bitmiş" olarak görünüyordu.
 */
function isDisplayableLive(match, options) {
  return liveVerdict(match, options).live === true;
}

/** Veri katmanı süzgeci: canlı gösterilemeyen maç dönen diziye HİÇ girmez. */
function filterDisplayableLive(list, options) {
  return (Array.isArray(list) ? list : []).filter((match) => isDisplayableLive(match, options));
}

/** Şu anın Europe/Istanbul takvim günü ("YYYY-MM-DD"). */
function todayInIstanbul(nowMs) {
  const stamp = Number.isFinite(nowMs) ? nowMs : Date.now();
  return istanbulDay(new Date(stamp).toISOString());
}

/**
 * Maç BUGÜNE mi ait? "Süper Lig'de Bugün" ve "Bugünün Maçları" alanlarının
 * kapısı. Dünkü maç bu kapıdan geçemez — sağlayıcı ne derse desin.
 */
function isTodayInIstanbul(match, options) {
  const settings = options || {};
  const nowMs = Number.isFinite(settings.nowMs) ? settings.nowMs : Date.now();
  const day = matchDay(match);
  return Boolean(day) && day === todayInIstanbul(nowMs);
}

/** Arayüzün doğrudan basabileceği durum metni. */
function displayStatusLabel(match, options) {
  const verdict = liveVerdict(match, options);

  if (verdict.verdict === "unverified") {
    return UNVERIFIED_LIVE_LABEL;
  }

  return statusLabel(match);
}

module.exports = {
  ANALYZABLE_STATES,
  FINISH_LABELS,
  LIVE_DATA_STALE_MS,
  LIVE_GRACE_MS,
  LIVE_STATES,
  PLAYED_STATES,
  PROVIDER_MISSING_LABEL,
  STATE_LABELS,
  STATUS_VOCABULARY,
  UNPLAYED_STATES,
  UNVERIFIED_LIVE_LABEL,
  canonicalStatus,
  displayStatusLabel,
  filterDisplayableLive,
  isDisplayableLive,
  isTodayInIstanbul,
  todayInIstanbul,
  updatedAtMs,
  finishLabel,
  finishType,
  isAnalyzableMatch,
  isAnalyzableStatus,
  isAwardedMatch,
  isAwardedStatus,
  isFinishedMatch,
  isFinishedStatus,
  isLiveStatus,
  isStaleAnalysisRecord,
  isUnplayedStatus,
  istanbulDay,
  kickoffMs,
  hasReadableScore,
  liveVerdict,
  matchDay,
  matchState,
  normalizeStatusToken,
  PRE_MATCH_ANALYSIS_STATUSES,
  statusLabel,
  statusesOf
};
