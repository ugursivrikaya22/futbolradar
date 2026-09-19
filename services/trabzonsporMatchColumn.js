/**
 * TRABZONSPOR MAÇ SONU KÖŞE YAZISI — ÜRETİM ÇEKİRDEĞİ (saf modül).
 *
 * Bu modül dosya okumaz, ağ çağırmaz, hiçbir şey yazmaz. Girdisi bitmiş bir
 * maç kaydı, çıktısı `data/columns.json` şemasında bir köşe yazısı kaydıdır.
 *
 * ── TEK KURAL: ÖLÇÜLMEYEN ŞEY YAZILMAZ ──────────────────────────────────
 *
 * Yazının her cümlesi ya sağlayıcıdan gelen bir sayıya/ada dayanır ya da o
 * sayının doğrudan gerektirdiği bir değerlendirmedir. Veri yoksa cümle de
 * yoktur: eksik bölüm atlanır, yerine "muhtemelen", "büyük ihtimalle" ya da
 * uydurma bir alıntı KONMAZ. Teknik direktör ya da futbolcu ağzından tek bir
 * cümle kurulmaz — bu modül hiçbir yerde tırnak işareti açmaz.
 *
 * Bu yüzden metin uzunluğu bir HEDEF değil, bir KAPIDIR: veri yetmediği için
 * 1.000 kelimenin altında kalan bir yazı yayımlanmaz, taslak olarak kalır
 * (bkz. `assessColumn`). Eksik veriyi doldurmak için cümle üretmek, bu
 * sitenin bütün veri sözleşmesini bozardı.
 *
 * ── İNGİLİZCE AYRI YAZILIR, ÇEVRİLMEZ ───────────────────────────────────
 *
 * Aynı analiz modelinden iki ayrı dilde iki ayrı metin kuruluyor. Türkçe
 * cümleyi kelime kelime İngilizceye çevirmek makine çevirisi tadı verirdi;
 * burada İngilizce sürüm kendi deyimleriyle yazılıyor (bkz. RENDERERS).
 */

const {
  isType,
  minuteOf,
  eventTeamName,
  playerFromEvent,
  statPair
} = require("./matchReportService.js");

const CLUB = "Trabzonspor";

/** Bitmiş sayılan durumlar. Sadece bunlar yazı üretir. */
const FINISHED_STATUSES = new Set(["FINISHED", "FT", "AET", "PEN"]);

/** Yazının yayımlanabilmesi için gereken kelime aralığı. */
const MIN_WORDS = 1200;
const MAX_WORDS = 1800;

/**
 * YAYIN KAPISI: bu bölümler olmadan "maç analizi" denmez.
 *
 * Skor tek başına bir analiz değildir; okuyucuya taktik okuma vaat edip
 * elinde yalnızca skor olan bir yazı yayımlamak sözü tutmamaktır.
 */
const REQUIRED_SECTIONS = ["score", "events", "statistics", "lineups"];

const TR_MONTHS = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"
];
const EN_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

/* ------------------------------------------------------------------ *
 * KÜÇÜK YARDIMCILAR
 * ------------------------------------------------------------------ */

function text(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Ölçülmüş sayı — YA SAYIDIR YA DA YOKTUR.
 *
 * İlk sürüm doğrudan `Number(value)` çağırıyordu ve `Number(null)` 0
 * döndürdüğü için ÖLÇÜLMEMİŞ bir alan "0 ölçüldü" gibi okunuyordu. Bunun
 * bedeli görünürdü: skoru boş gelen bir "FT" kaydı 0-0 biten bir maç sayılır,
 * bitiş doğrulaması kapısından geçer ve oynanmamış bir sonuç üzerinden yazı
 * yayımlanırdı. Boş dize ve boşluk da aynı sebeple reddediliyor.
 */
function num(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  if (typeof value === "boolean") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .toLowerCase()
    .trim();
}

function isTrabzonspor(name) {
  return /trabzonspor/.test(normalize(name));
}

function slugify(value) {
  return String(value || "")
    .toLocaleLowerCase("tr")
    .replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s")
    .replace(/ı/g, "i").replace(/ö/g, "o").replace(/ç/g, "c")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Gövde metninin kelime sayısı. Başlık satırları ve bağlantı adresleri sayılmaz. */
function countWords(body) {
  return (Array.isArray(body) ? body : [])
    .join(" ")
    // markdown bağlantısında yalnızca görünen metin okunur
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^##+\s*/gm, "")
    .replace(/[*_`#]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .length;
}

function isFinishedMatch(match) {
  return FINISHED_STATUSES.has(text(match && match.status).toUpperCase());
}

/* ------------------------------------------------------------------ *
 * MAÇ SEÇİMİ
 * ------------------------------------------------------------------ */

/**
 * Yazısı yazılacak maç.
 *
 * DOĞRULANMAMIŞ BİTİŞ YAZI ÜRETMEZ. `status` bitmiş olmalı VE skorun iki
 * tarafı da sayı olmalı; sağlayıcı maçı "FT" işaretleyip skoru boş
 * bırakabiliyor ve o kayıt bitmiş bir maç değil, yarım bir kayıttır.
 *
 * Pencere (varsayılan 36 saat) bilinçli: eski bir maç için "maç sonu"
 * yazısı yayımlamak okuyucuyu yanıltır. Ayrıca U19/U21 gibi altyapı
 * karşılaşmaları elenir — A takım maçı sanılacak bir analiz üretmemek için.
 */
function selectMatch(matches, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const windowHours = isNumber(options.windowHours) ? options.windowHours : 36;
  const horizon = windowHours * 60 * 60 * 1000;

  const candidates = (Array.isArray(matches) ? matches : []).filter((match) => {
    if (!match || !text(match.id)) return false;
    if (!isTrabzonspor(match.homeTeam) && !isTrabzonspor(match.awayTeam)) return false;
    // Altyapı: kimlikte ya da takım adında yaş grubu geçiyorsa A takım değil.
    if (/\bu(1[4-9]|2[0-3])\b/.test(normalize(`${match.id} ${match.homeTeam} ${match.awayTeam}`))) return false;
    if (!isFinishedMatch(match)) return false;
    const score = match.score || {};
    if (!isNumber(num(score.home)) || !isNumber(num(score.away))) return false;
    const kickoff = Date.parse(match.kickoff || "");
    if (!Number.isFinite(kickoff)) return false;
    if (kickoff > now.getTime()) return false;
    return now.getTime() - kickoff <= horizon;
  });

  candidates.sort((left, right) => String(right.kickoff).localeCompare(String(left.kickoff)));
  return candidates[0] || null;
}

/* ------------------------------------------------------------------ *
 * ANALİZ MODELİ
 *
 * İki dil de BU modelden yazılıyor. Model yalnızca ölçülmüş değer taşır;
 * bir alan null ise o konuda tek cümle kurulmaz.
 * ------------------------------------------------------------------ */

function sideOf(match) {
  return isTrabzonspor(match.homeTeam) ? "home" : "away";
}

function pair(match, type) {
  const values = statPair(match, type);
  if (!values) return null;
  const side = sideOf(match);
  const us = side === "home" ? values.home : values.away;
  const them = side === "home" ? values.away : values.home;
  if (!isNumber(num(us)) && !isNumber(num(them))) return null;
  return { us: num(us), them: num(them) };
}


/**
 * İki ölçülmüş sayıdan yüzde türetir (isabetli/toplam).
 *
 * Her iki taraf da ölçülmemişse null döner — yarım bir oran, ölçülmemiş
 * tarafı sıfır saymak demek olurdu.
 */
function derivedRate(numerator, denominator) {
  if (!numerator || !denominator) return null;
  const rate = (top, bottom) => (isNumber(top) && isNumber(bottom) && bottom > 0
    ? Math.round((top / bottom) * 100)
    : null);
  const us = rate(numerator.us, denominator.us);
  const them = rate(numerator.them, denominator.them);
  if (us === null && them === null) return null;
  return { us, them };
}

/** Olay akışından gol satırları. Kaçan penaltı gol sayılmaz. */
function goalsFrom(match) {
  const rows = [];
  for (const event of Array.isArray(match.events) ? match.events : []) {
    if (!isType(event, "gol", "goal")) continue;
    if (isType(event, "iptal", "cancelled", "disallowed")) continue;
    if (/missed penalty|kaçan penaltı/i.test(`${event.detail || ""} ${event.value || ""}`)) continue;

    const value = text(event.value);
    const assistMatch = value.match(/Asist:\s*([^·]+)/i) || value.match(/Assist:\s*([^·]+)/i);
    rows.push({
      minute: minuteOf(event),
      team: eventTeamName(event),
      forUs: isTrabzonspor(eventTeamName(event)),
      scorer: text(event.player) || playerFromEvent(event) || "",
      assist: text(event.assist) || (assistMatch ? text(assistMatch[1]) : ""),
      penalty: isType(event, "penaltı", "penalty"),
      ownGoal: isType(event, "kendi kalesine", "own goal")
    });
  }
  return rows.sort((left, right) => minuteSort(left.minute) - minuteSort(right.minute));
}

function minuteSort(minute) {
  if (minute === null || minute === undefined) return Number.POSITIVE_INFINITY;
  const [base, extra] = String(minute).split("+");
  return Number(base) + (extra ? Number(extra) / 100 : 0);
}

function cardsFrom(match) {
  const bucket = { us: { yellow: 0, red: [] }, them: { yellow: 0, red: [] } };
  for (const event of Array.isArray(match.events) ? match.events : []) {
    if (!isType(event, "kart", "card")) continue;
    const key = isTrabzonspor(eventTeamName(event)) ? "us" : "them";
    const player = text(event.player) || playerFromEvent(event) || "";
    if (isType(event, "kırmızı", "red card")) {
      bucket[key].red.push({ minute: minuteOf(event), player });
    } else if (isType(event, "sarı", "yellow card")) {
      bucket[key].yellow += 1;
    }
  }
  return bucket;
}

function subsFrom(match) {
  const rows = { us: [], them: [] };
  const direct = Array.isArray(match.substitutions) ? match.substitutions : [];

  for (const row of direct) {
    const key = isTrabzonspor(row && row.team) ? "us" : "them";
    rows[key].push({ minute: minuteOf(row), in: text(row && row.in), out: text(row && row.out) });
  }

  if (!direct.length) {
    for (const event of Array.isArray(match.events) ? match.events : []) {
      if (!isType(event, "subst", "oyuncu değişikliği", "substitution")) continue;
      const key = isTrabzonspor(eventTeamName(event)) ? "us" : "them";
      rows[key].push({
        minute: minuteOf(event),
        in: text(event.player) || playerFromEvent(event) || "",
        out: text(event.assist) || ""
      });
    }
  }

  for (const key of ["us", "them"]) {
    rows[key].sort((left, right) => minuteSort(left.minute) - minuteSort(right.minute));
  }
  return rows;
}

function lineupsFrom(match) {
  const out = { us: null, them: null };
  for (const row of Array.isArray(match.lineups) ? match.lineups : []) {
    if (!row || !text(row.team)) continue;
    const players = (Array.isArray(row.players) ? row.players : Array.isArray(row.startXI) ? row.startXI : [])
      .map((entry) => (typeof entry === "string" ? entry : text(entry && entry.name)))
      .filter(Boolean);
    if (!players.length) continue;
    const key = isTrabzonspor(row.team) ? "us" : "them";
    out[key] = {
      team: text(row.team),
      formation: text(row.formation) || null,
      coach: text(row.coach) || null,
      players
    };
  }
  return out;
}

function playersFrom(match) {
  const rows = { us: [], them: [] };
  for (const row of Array.isArray(match.players) ? match.players : []) {
    if (!row || !text(row.name)) continue;
    const key = isTrabzonspor(row.team) ? "us" : "them";
    rows[key].push(row);
  }
  return rows;
}

/**
 * MAÇIN KIRILMA ANI.
 *
 * Tek bir an seçiliyor ve seçim ölçülebilir bir ölçütle yapılıyor: kırmızı
 * kart > penaltı > skoru eşitliğe/öne taşıyan gol > ilk gol. Hiçbiri yoksa
 * bölüm hiç yazılmaz; "maçın kırılma anı yoktu" demek de bir iddiadır.
 */
function turningPointFrom(model) {
  const { goals, cards } = model;
  const reds = [...cards.us.red.map((row) => ({ ...row, forUs: true })),
                ...cards.them.red.map((row) => ({ ...row, forUs: false }))]
    .sort((left, right) => minuteSort(left.minute) - minuteSort(right.minute));

  /**
   * KIRMIZI KART HER ZAMAN KIRILMA ANI DEĞİLDİR.
   *
   * İlk sürüm kırmızıyı koşulsuz en üste koyuyordu; 2-1 biten bir maçta
   * 84. dakikada görülen kart, skoru 77. dakikada belirleyen golün önüne
   * geçiyordu. Oysa o kart maçın gidişatını değiştirmemişti — değiştirecek
   * dakika kalmamıştı. Bu yüzden kırmızı yalnızca oyunun geri kalanını
   * gerçekten etkileyecek kadar erken geldiyse (80. dakika ve öncesi)
   * öncelikli sayılıyor; daha geç gelen kart, karar golü varsa ona bırakır.
   */
  const early = reds.find((row) => {
    const minute = Number(String(row.minute).split("+")[0]);
    return Number.isFinite(minute) && minute <= 80;
  });
  if (early) {
    return { kind: "red", minute: early.minute, player: early.player, forUs: early.forUs };
  }

  // Skor çizgisini yürüterek durum değiştiren golü bul.
  let us = 0;
  let them = 0;
  let decisive = null;
  for (const goal of goals) {
    const before = us === them ? "level" : us > them ? "ahead" : "behind";
    if (goal.forUs) us += 1; else them += 1;
    const after = us === them ? "level" : us > them ? "ahead" : "behind";
    if (before !== after) decisive = { kind: "goal", ...goal, before, after };
  }
  if (decisive) return decisive;
  if (goals.length) {
    return { kind: "goal", ...goals[0], before: "level", after: goals[0].forUs ? "ahead" : "behind" };
  }
  // Karar golü de yoksa geç gelen kırmızı yine de tek belirgin andır.
  return reds.length ? { kind: "red", minute: reds[0].minute, player: reds[0].player, forUs: reds[0].forUs } : null;
}

/** Öne çıkan ve beklentinin altında kalan futbolcular — sağlayıcı reytinginden. */
function standoutsFrom(players, goals) {
  const rated = players.us.filter((row) => isNumber(num(row.providerRating)) && num(row.minutes) > 0);
  const byRating = [...rated].sort((left, right) => num(right.providerRating) - num(left.providerRating));
  const scorers = new Set(goals.filter((goal) => goal.forUs && goal.scorer).map((goal) => normalize(goal.scorer)));

  const top = byRating.slice(0, 3);
  // Düşük performans yalnızca YETERİNCE OYNAMIŞ oyuncu için yazılır: 20
  // dakika oynayan birinin düşük reytingi bir değerlendirme değil, örnek
  // yetersizliğidir. Gol atan oyuncu bu listeye hiç girmez.
  const under = byRating
    .filter((row) => num(row.minutes) >= 60 && num(row.providerRating) < 6.5)
    .filter((row) => !scorers.has(normalize(row.name)))
    .slice(-2)
    .reverse();

  return { top, under, hasRatings: rated.length >= 8 };
}

function buildModel(match, context = {}) {
  const side = sideOf(match);
  const score = match.score || {};
  const ourScore = num(side === "home" ? score.home : score.away);
  const theirScore = num(side === "home" ? score.away : score.home);
  const opponent = text(side === "home" ? match.awayTeam : match.homeTeam);

  const goals = goalsFrom(match);
  const cards = cardsFrom(match);
  const subs = subsFrom(match);
  const lineups = lineupsFrom(match);
  const players = playersFrom(match);

  const kickoff = new Date(match.kickoff);
  const model = {
    matchId: text(match.id),
    competition: text(match.league) || text(match.competition) || "",
    stage: text(match.stage),
    venue: text(match.venue),
    city: text(match.city),
    kickoff: text(match.kickoff),
    date: Number.isFinite(kickoff.getTime()) ? kickoff : null,
    opponent,
    isHome: side === "home",
    ourScore,
    theirScore,
    margin: isNumber(ourScore) && isNumber(theirScore) ? ourScore - theirScore : null,
    result: ourScore > theirScore ? "win" : ourScore < theirScore ? "loss" : "draw",
    goals,
    cards,
    subs,
    lineups,
    players,
    stats: {
      possession: pair(match, "Topla oynama"),
      shots: pair(match, "Toplam şut"),
      shotsOn: pair(match, "İsabetli şut"),
      boxShots: pair(match, "Ceza sahası içinden şut"),
      outsideShots: pair(match, "Ceza sahası dışından şut"),
      blockedShots: pair(match, "Engellenen şut"),
      corners: pair(match, "Korner"),
      passes: pair(match, "Toplam pas"),
      // PAS İSABETİ ÇOĞU MAÇTA DOĞRUDAN GELMİYOR (havuzdaki 96 maçın
      // yalnızca 24'ünde var) ama "Toplam pas" ve "İsabetli pas" 96'sında
      // da duruyor. Oran bu ikisinden TÜRETİLİYOR: bu bir tahmin değil,
      // sağlayıcının kendi iki sayısının bölümü. Doğrudan gelen değer
      // varsa o kullanılır, türetme yalnızca boşluğu doldurur.
      passAccuracy: pair(match, "Pas isabeti") || derivedRate(
        pair(match, "İsabetli pas"),
        pair(match, "Toplam pas")
      ),
      saves: pair(match, "Kurtarış"),
      fouls: pair(match, "Faul"),
      offsides: pair(match, "Ofsayt"),
      xg: pair(match, "Gol beklentisi (xG)"),
      duels: pair(match, "Kazanılan ikili mücadele"),
      crosses: pair(match, "Toplam orta")
    },
    standing: context.standing || null,
    // Rakip dosyası (transfer verimi, rotasyon, fikstür yükü) — bkz.
    // services/opponentFocus.js. Yoksa bölüm hiç açılmaz.
    opponentFocus: context.opponentFocus || null,
    nextMatch: context.nextMatch || null,
    links: context.links || {}
  };

  model.turningPoint = turningPointFrom(model);
  model.standouts = standoutsFrom(players, goals);
  return model;
}

/* ------------------------------------------------------------------ *
 * HAZIRLIK KAPISI
 * ------------------------------------------------------------------ */

/**
 * Maç, yazı üretmeye yetecek veriye sahip mi?
 *
 * Eksik bölüm adlarıyla döner; çağıran taraf ne bekleneceğini bilsin diye.
 * Boş dönen liste "veri yok" değil, "veri geldi" demektir.
 */
function readiness(match) {
  const missing = [];
  if (!isFinishedMatch(match)) missing.push("finished");
  const score = match && match.score;
  if (!score || !isNumber(num(score.home)) || !isNumber(num(score.away))) missing.push("score");
  if (!(Array.isArray(match && match.events) && match.events.length)) missing.push("events");
  if (!(Array.isArray(match && match.statistics) && match.statistics.length >= 6)) missing.push("statistics");
  if (!(Array.isArray(match && match.lineups) && match.lineups.length >= 2)) missing.push("lineups");

  return {
    ready: REQUIRED_SECTIONS.every((section) => !missing.includes(section)) && !missing.includes("finished"),
    missing
  };
}

module.exports = {
  CLUB,
  derivedRate,
  FINISHED_STATUSES,
  MIN_WORDS,
  MAX_WORDS,
  REQUIRED_SECTIONS,
  TR_MONTHS,
  EN_MONTHS,
  buildModel,
  countWords,
  isFinishedMatch,
  isTrabzonspor,
  minuteSort,
  normalize,
  readiness,
  selectMatch,
  slugify,
  text,
  num,
  isNumber
};
