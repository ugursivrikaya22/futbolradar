/**
 * ANA SAYFA TAHMİN ANKETİ — HANGİ ANKET AÇIK, HANGİ SEÇENEKLERLE.
 *
 * Bu anket maçın adamı anketinden FARKLI BİR ŞEY iddia eder. Orada soru
 * olmuş bir maç hakkındaydı; burada soru GELECEK hakkında. Bu yüzden
 * sonuç bir veri iddiası değil, topluluğun beklentisidir ve ekranda da
 * öyle yazar (`subtitle`). Ama seçenek listesi yine bir veri iddiasıdır:
 * "Trendyol Süper Lig kulüpleri" başlığı altında bastığımız her ad, o
 * kulübün gerçekten bu sezon o ligde olduğunu söyler.
 *
 *     LİGDE OLDUĞUNU BİLMEDİĞİMİZ KULÜP LİSTEYE GİRMEZ.
 *
 * Bu yüzden kulüp listesi elle yazılmıyor: `data/teams.json` içindeki
 * `isCurrentSuperLigTeam` bayrağı taşıyan kayıtlardan türetiliyor. Lig
 * kadrosu değiştiğinde (küme düşme/çıkma) anket kendiliğinden doğru olur.
 *
 * TAKVİM KODA DEĞİL VERİYE YAZILI.
 *
 * Anketler `data/home-polls.json` içinde sırayla durur. Aynı anda yalnızca
 * BİR anket açıktır: `startsAt <= now < endsAt` olan. Bir anket kapanınca
 * sonuçları gösterilmeye devam eder ve sıradaki anket kendi saatinde
 * otomatik açılır. Yeni anket planlamak için dosyaya bir nesne eklemek
 * yeterlidir — bu, "admin dostu" olmanın kod gerektirmeyen biçimidir.
 *
 * PENCERE EN AZ İKİ HAFTA. Daha kısa pencereli kayıt ELENİR ve nedeni
 * günlüğe yazılır. Gerekçe: ana sayfadaki büyük bir anket birkaç günde
 * kapanırsa okuyucuların çoğu onu hiç görmeden sonucu kaçırır; ayrıca kısa
 * pencere, az sayıda oyla "topluluk kararı" iddia etmek demektir.
 *
 * ÇAKIŞMA YOK. İki anketin penceresi kesişiyorsa SONRAKİ elenir: aynı anda
 * iki "bu sezonun anketi" göstermek, hangisinin geçerli olduğunu okuyucuya
 * sorulmamış bir soru hâline getirirdi.
 *
 * OY DEPOSU BU MODÜLÜN İŞİ DEĞİL (services/homePollVoteStore.js), çizim de
 * değil (site.js). Burada yalnızca "hangi anket, hangi seçeneklerle,
 * hangi dilde" sorusu yanıtlanır.
 */

/** Pencere alt sınırı. Gerekçe dosya başında. */
const MIN_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/** Seçenek listesi ekranda okunabilir kalmalı; lig 18 kulüp, sınır geniş. */
const MAX_OPTIONS = 24;

/** Desteklenen diller. Anket iki dilde BİREBİR aynıdır, yalnızca metin değişir. */
const LOCALES = ["tr", "en"];

/** Kulüp armaları için lisanslı medya sunucusu (oyuncu fotoğrafıyla aynı kural). */
const TEAM_LOGO_BASE = "https://media.api-sports.io/football/teams";

/** Ekran metinleri; dile göre tek yerde. */
const COPY = Object.freeze({
  tr: {
    kicker: "Okuyucu Anketi",
    button: "Oyunu Ver",
    thanks: "Teşekkürler! Güncel sonuçlar aşağıda.",
    leader: "Önde",
    votesSuffix: "oy",
    totalVotes: "toplam oy",
    closed: "Bu anket kapandı; sonuçlar kesinleşti.",
    closedNext: "Yeni anket yakında bu alanda.",
    communityNote: "Sonuçlar tüm okuyucuların oylarından hesaplanıyor. Her tarayıcı bir kez oy verebilir.",
    localNote: "Oy deposuna ulaşılamadı; aşağıdaki sonuç topluluk ortalaması değil, yalnızca bu tarayıcıda saklanan oydur.",
    yourVote: "Senin oyun",
    endsPrefix: "Oylama bitişi:",
    // Anket bir TAHMİNDİR ve bu yazılı olmak zorunda: sitenin geri kalanı
    // doğrulanmış veri iddia ediyor, bu bölüm etmiyor.
    disclaimer: "Bu bölüm okuyucu tahminidir; sitenin doğrulanmış maç verisinden ayrıdır."
  },
  en: {
    kicker: "Reader Poll",
    button: "Cast Your Vote",
    thanks: "Thanks! Live results are below.",
    leader: "Leading",
    votesSuffix: "votes",
    totalVotes: "total votes",
    closed: "This poll has closed; the results are final.",
    closedNext: "A new poll is coming to this space.",
    communityNote: "Results are calculated from all readers' votes. Each browser can vote once.",
    localNote: "The vote store could not be reached; the result below is not a community average, only the vote stored in this browser.",
    yourVote: "Your vote",
    endsPrefix: "Voting closes:",
    disclaimer: "This section is a reader prediction, separate from the site's verified match data."
  }
});

function text(value) {
  return String(value === undefined || value === null ? "" : value).trim();
}

/** Aksan ve büyük harf nötr kimlik (depodaki diğer katlamalarla aynı iş). */
function foldKey(value) {
  return text(value)
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ç/g, "c")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeLocale(value) {
  return LOCALES.includes(text(value)) ? text(value) : "tr";
}

function stampOf(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * İki dilli alan: istenen dil yoksa Türkçeye düşer (kaynak dil Türkçe).
 *
 * Yedeğe düşmek SUNUM içindir, DOĞRULAMA için değil: yarım çevrilmiş bir
 * anketin İngilizce sayfada Türkçe soruyla çıkması, hiç çıkmamasından
 * iyidir — ama o kaydın yayına girmesine izin verilmemelidir. Doğrulama bu
 * yüzden yedeğe bakmaz, `hasLocale` ile alanın GERÇEKTEN yazılıp
 * yazılmadığını sorar.
 */
function localized(field, locale) {
  if (!field) return "";
  if (typeof field === "string") return text(field);
  return text(field[normalizeLocale(locale)]) || text(field.tr) || text(field.en);
}

/** Alan bu dilde GERÇEKTEN yazılmış mı? Yedeğe düşmez. */
function hasLocale(field, locale) {
  if (!field || typeof field === "string") return false;
  return Boolean(text(field[normalizeLocale(locale)]));
}

/**
 * GÜNCEL SÜPER LİG KULÜPLERİ.
 *
 * Kaynak `data/teams.json` ve süzgeç `isCurrentSuperLigTeam`. Arma yalnızca
 * GERÇEK sağlayıcı kimliğinden türetilir (yalnızca rakam); yer tutucu
 * kimlikten adres üretmek ya kırık görsel ya da BAŞKA bir kulübün arması
 * demek olurdu. Arması olmayan kulüp listeden düşmez — baş harfleriyle
 * görünür; bir kulübü ankete almamak, armasının eksikliğinden çok daha
 * büyük bir hata olurdu.
 */
function superLigOptions(teamsPayload) {
  const list = Array.isArray(teamsPayload)
    ? teamsPayload
    : (teamsPayload && Array.isArray(teamsPayload.teams) ? teamsPayload.teams : []);

  return list
    .filter((team) => team && team.isCurrentSuperLigTeam && text(team.name))
    .map((team) => {
      const providerId = text(team.providerId);
      const name = text(team.name);
      return {
        id: foldKey(name),
        label: { tr: name, en: name },
        team: name,
        logo: /^\d+$/.test(providerId) ? `${TEAM_LOGO_BASE}/${providerId}.png` : "",
        initials: name.split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join("").toLocaleUpperCase("tr-TR")
      };
    })
    .sort((left, right) => left.team.localeCompare(right.team, "tr"))
    .slice(0, MAX_OPTIONS);
}

/** Elle yazılmış seçenekler (transfer/teknik direktör/oyuncu anketleri). */
function explicitOptions(records, teamsPayload) {
  const teams = Array.isArray(teamsPayload)
    ? teamsPayload
    : (teamsPayload && Array.isArray(teamsPayload.teams) ? teamsPayload.teams : []);

  return (Array.isArray(records) ? records : [])
    .map((record) => {
      const label = record && record.label;
      const trLabel = localized(label, "tr");
      if (!trLabel) return null;
      const teamName = text(record.team);
      // Kulüp adı verilmişse arması aynı kuralla çözülür; verilmemişse
      // seçenek armasız görünür (bir oyuncu ya da teknik direktör için
      // kulüp arması zorunlu değildir).
      const hit = teams.find((team) => foldKey(team && team.name) === foldKey(teamName));
      const providerId = text(hit && hit.providerId);
      return {
        id: text(record.id) || foldKey(trLabel),
        label: typeof label === "string" ? { tr: label, en: label } : label,
        team: teamName,
        logo: text(record.logo) || (/^\d+$/.test(providerId) ? `${TEAM_LOGO_BASE}/${providerId}.png` : ""),
        initials: trLabel.split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join("").toLocaleUpperCase("tr-TR")
      };
    })
    .filter(Boolean)
    .slice(0, MAX_OPTIONS);
}

/**
 * KAYIT DOĞRULAMASI. Geçersiz anket elenir ve NEDENİ döner — sessiz eleme,
 * hata ayıklanamaz eleme demek.
 */
function validatePoll(record, sources = {}) {
  const errors = [];
  if (!record || typeof record !== "object") return { valid: false, errors: ["kayıt okunamadı"], poll: null };

  const id = text(record.id);
  const startsAt = stampOf(record.startsAt);
  const endsAt = stampOf(record.endsAt);

  if (!id) errors.push("id zorunlu");
  if (!startsAt) errors.push("startsAt okunabilir bir tarih olmalı");
  if (!endsAt) errors.push("endsAt okunabilir bir tarih olmalı");
  // İKİ DİL DE ZORUNLU: iki sürüm aynı ankettir, yalnızca dil değişir.
  // Yarım çevrilmiş bir kayıt yayına girerse İngilizce sayfa sessizce
  // Türkçe soru gösterir ve kimse fark etmez.
  if (!hasLocale(record.question, "tr")) errors.push("question.tr zorunlu");
  if (!hasLocale(record.question, "en")) errors.push("question.en zorunlu");
  // Alt başlık isteğe bağlıdır ama VARSA iki dilde de olmalı.
  if (record.subtitle && (!hasLocale(record.subtitle, "tr") || !hasLocale(record.subtitle, "en"))) {
    errors.push("subtitle verildiyse iki dilde de olmalı");
  }

  if (startsAt && endsAt) {
    if (endsAt <= startsAt) errors.push("endsAt startsAt'ten sonra olmalı");
    else if (endsAt - startsAt < MIN_WINDOW_MS) {
      errors.push(`pencere en az 14 gün olmalı (${Math.round((endsAt - startsAt) / 86400000)} gün)`);
    }
  }

  const options = text(record.optionSource) === "super-lig-teams"
    ? superLigOptions(sources.teams)
    : explicitOptions(record.options, sources.teams);

  if (options.length < 2) errors.push(`en az iki seçenek olmalı (${options.length})`);

  // Kimlikler benzersiz olmalı: aynı kimlikli iki seçenek, oyların
  // birbirine karışması demek.
  if (new Set(options.map((option) => option.id)).size !== options.length) {
    errors.push("seçenek kimlikleri benzersiz olmalı");
  }

  if (errors.length) return { valid: false, errors, poll: null };

  return {
    valid: true,
    errors: [],
    poll: {
      id,
      type: text(record.type) || "custom",
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(endsAt).toISOString(),
      question: record.question,
      subtitle: record.subtitle || null,
      options
    }
  };
}

function asPollList(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.polls)) return payload.polls;
  return [];
}

/**
 * TAKVİM. Kayıtlar doğrulanır, başlama saatine göre sıralanır ve pencereleri
 * ÇAKIŞANLAR elenir (sonraki düşer). Dönen liste yayına uygun ankettir.
 */
function scheduleFrom(sources = {}) {
  const polls = [];
  const rejected = [];

  const validated = asPollList(sources.polls)
    .map((record) => ({ record, verdict: validatePoll(record, sources) }))
    .filter(({ record, verdict }) => {
      if (verdict.valid) return true;
      rejected.push({ id: text(record && record.id) || "(kimliksiz)", errors: verdict.errors });
      return false;
    })
    .map(({ verdict }) => verdict.poll)
    .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));

  for (const poll of validated) {
    const previous = polls[polls.length - 1];
    if (previous && Date.parse(poll.startsAt) < Date.parse(previous.endsAt)) {
      rejected.push({ id: poll.id, errors: [`penceresi "${previous.id}" ile çakışıyor`] });
      continue;
    }
    // Aynı kimlik iki kez planlanamaz: oylar tek anahtarda toplanıyor.
    if (polls.some((entry) => entry.id === poll.id)) {
      rejected.push({ id: poll.id, errors: ["kimlik yinelenmiş"] });
      continue;
    }
    polls.push(poll);
  }

  return { polls, rejected };
}

/**
 * ŞU AN GÖSTERİLECEK ANKET.
 *
 * Üç durum var ve üçü de EKRANDA FARKLI ŞEY SÖYLER:
 *
 *   • `open`   — pencere içinde; form gösterilir, oy alınır.
 *   • `closed` — pencere geçti; SONUÇLAR gösterilmeye devam eder, oy alınmaz.
 *                Bir sonraki anket başlayana kadar bu bölüm boş kalmaz.
 *   • `null`   — gösterilecek anket yok (takvim boş ya da ilk anket henüz
 *                başlamadı). Bölüm HİÇ ÇİZİLMEZ; boş bir anket kutusu, yer
 *                tutucu uydurmanın sessiz biçimi olurdu.
 *
 * Kapanan anketten sonrakine geçiş kendiliğinden olur: sıradaki anketin
 * `startsAt` saati geldiğinde açık anket o olur.
 */
function selectHomePoll(sources = {}, options = {}) {
  const nowMs = Number.isFinite(options.now) ? options.now : Date.now();
  const { polls, rejected } = scheduleFrom(sources);

  const open = polls.find((poll) =>
    Date.parse(poll.startsAt) <= nowMs && nowMs < Date.parse(poll.endsAt));
  if (open) {
    return { poll: open, status: "open", next: polls.find((entry) => Date.parse(entry.startsAt) >= Date.parse(open.endsAt)) || null, rejected };
  }

  // Açık anket yok: EN SON KAPANMIŞ anketin sonuçları durmaya devam eder.
  const closed = polls
    .filter((poll) => Date.parse(poll.endsAt) <= nowMs)
    .sort((left, right) => Date.parse(right.endsAt) - Date.parse(left.endsAt))[0];
  if (closed) {
    return { poll: closed, status: "closed", next: polls.find((entry) => Date.parse(entry.startsAt) > nowMs) || null, rejected };
  }

  return { poll: null, status: "none", next: polls[0] || null, rejected };
}

/** Anketi tek dile indirger; istemciye giden biçim budur. */
function localizePoll(poll, locale) {
  if (!poll) return null;
  const lang = normalizeLocale(locale);
  return {
    id: poll.id,
    type: poll.type,
    startsAt: poll.startsAt,
    endsAt: poll.endsAt,
    question: localized(poll.question, lang),
    subtitle: localized(poll.subtitle, lang),
    options: poll.options.map((option) => ({
      id: option.id,
      label: localized(option.label, lang),
      team: option.team,
      logo: option.logo,
      initials: option.initials
    }))
  };
}

/** Elenen anketleri görünür kılar. */
function logRejected(rejected) {
  for (const row of Array.isArray(rejected) ? rejected : []) {
    console.warn(`[futbolradar:home-poll-rejected] id=${row.id} reasons="${row.errors.join("; ")}"`);
  }
}

module.exports = {
  COPY,
  LOCALES,
  MAX_OPTIONS,
  MIN_WINDOW_MS,
  TEAM_LOGO_BASE,
  explicitOptions,
  foldKey,
  hasLocale,
  localized,
  localizePoll,
  logRejected,
  normalizeLocale,
  scheduleFrom,
  selectHomePoll,
  superLigOptions,
  validatePoll
};
