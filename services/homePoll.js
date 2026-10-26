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

/**
 * YÜZEYLER — ANKET NEREDE YAŞIYOR.
 *
 * Başlangıçta tek yüzey vardı (ana sayfa) ve 14 günlük alt sınır o yüzeyin
 * kuralıydı: ana sayfadaki büyük bir anket birkaç günde kapanırsa okuyucuların
 * çoğu sonucu hiç görmeden kaçırır. MAÇ ANKETİ ("bu maçı kim kazanır?") aynı
 * kurala giremez — bir maç önü penceresi saatlerle ölçülür. Kuralı gevşetmek
 * yerine YÜZEY kavramı eklendi: her yüzeyin kendi alt sınırı var ve çakışma
 * denetimi yüzey İÇİNDE yapılıyor.
 *
 * Bu ayrım olmadan tek bir takvim listesi, aynı anda açık olan bir maç anketi
 * ile bir sezon anketini "çakışıyor" sayıp birini eler ve ana sayfa anketi bir
 * maç yüzünden kaybolurdu.
 *
 *   • `home`  — ana sayfa ve anket sayfası. Aynı anda YALNIZCA BİR tane.
 *   • `match` — bir maçın sayfasına bağlı anket. Aynı anda birden çok maç
 *     anketi açık olabilir (farklı maçlar), ama AYNI maç için tek anket.
 */
const SURFACES = Object.freeze({
  home: { minWindowMs: MIN_WINDOW_MS },
  // Maç önü penceresi: en az bir saat. Daha kısası, oyların hiç toplanmadan
  // kapanması demek olurdu.
  match: { minWindowMs: 60 * 60 * 1000 }
});

const DEFAULT_SURFACE = "home";

/** Anket sayfası adres kökleri. Türkçe ve İngilizce AYRI adres, AYNI anket. */
const POLL_PATH_PREFIX = Object.freeze({ tr: "/anket", en: "/en/poll" });

/** Seçenek listesi ekranda okunabilir kalmalı; lig 18 kulüp, sınır geniş. */
const MAX_OPTIONS = 24;

/** Desteklenen diller. Anket iki dilde BİREBİR aynıdır, yalnızca metin değişir. */
const LOCALES = ["tr", "en"];

/** Kulüp armaları için lisanslı medya sunucusu (oyuncu fotoğrafıyla aynı kural). */
const TEAM_LOGO_BASE = "https://media.api-sports.io/football/teams";

/**
 * EKRAN METİNLERİ — DİLE GÖRE TEK YERDE.
 *
 * Bu sözlük hem işaretleme üreticisinin (`scripts/lib/homePoll.mjs`) hem de
 * sunucunun okuduğu kaynaktır; üretici kendi çerçeve metinlerini buradan
 * türetiyor. İki ayrı sözlük tutulduğu sürece Türkçesi düzeltilip
 * İngilizcesi unutulan bir satır kaçınılmazdı.
 */
const COPY = Object.freeze({
  tr: {
    kicker: "🔥 FutbolRadar Günün Anketi",
    button: "Oyunu Ver",
    thanks: "Teşekkürler! Güncel sonuçlar aşağıda.",
    leader: "Önde",
    closed: "Bu anket kapandı; sonuçlar kesinleşti.",
    closedNext: "Yeni anket yakında bu alanda.",
    communityNote: "Sonuçlar tüm okuyucuların oylarından hesaplanıyor. Her tarayıcı bir kez oy verebilir.",
    localNote: "Oy deposuna ulaşılamadı; aşağıdaki sonuç topluluk ortalaması değil, yalnızca bu tarayıcıda saklanan oydur.",
    yourVote: "✓ Senin oyun",
    endsPrefix: "Oylama bitişi:",
    // Anket bir TAHMİNDİR ve bu yazılı olmak zorunda: sitenin geri kalanı
    // doğrulanmış veri iddia ediyor, bu bölüm etmiyor.
    offline: "Oylama şu anda kullanılamıyor. Soru ve seçenekler görünür; oylar açıldığında bu kutudan oy verebilirsin.",
    region: "Ana sayfa tahmin anketi",
    disclaimer: "Bu bölüm okuyucu tahminidir; sitenin doğrulanmış maç verisinden ayrıdır."
  },
  en: {
    kicker: "🔥 FutbolRadar Poll of the Day",
    button: "Cast Your Vote",
    thanks: "Thanks! Live results are below.",
    leader: "Leading",
    closed: "This poll has closed; the results are final.",
    closedNext: "A new poll is coming to this space.",
    communityNote: "Results are calculated from all readers' votes. Each browser can vote once.",
    localNote: "The vote store could not be reached; the result below is not a community average, only the vote stored in this browser.",
    yourVote: "✓ Your vote",
    endsPrefix: "Voting closes:",
    offline: "Voting is unavailable right now. The question and options are shown; you will be able to vote from this box once voting opens.",
    region: "Homepage prediction poll",
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
 * ANKET ADRESİ — PAYLAŞILAN BAĞLANTININ GİTTİĞİ YER.
 *
 * Her anketin kendi sayfası var: `/anket/<slug>` ve `/en/poll/<slug>`. İki
 * adres AYNI anketi gösterir ve AYNI oy havuzunu paylaşır — dil başına ayrı
 * havuz açmak, aynı soruya iki farklı "topluluk kararı" üretirdi.
 *
 * Slug VERİDEN gelir çünkü adres bir yayın kararıdır: kimlik
 * (`super-lig-2026-2027-ilk-dort`) bir depo anahtarıdır ve değişmemesi
 * gerekir; adres ise okunabilir olmalı (`super-lig-ilk-dort-2026-27`).
 * İkisini aynı dizeye bağlamak, adresi güzelleştirmek istediğimizde
 * toplanmış oyları kaybettirirdi.
 *
 * Slug yazılmamışsa kimlikten türetilir: adres çirkin olur ama sayfa yine
 * doğru anketi gösterir. Yer tutucu bir adres uydurmak yerine var olan
 * kimliği kullanmak, sessiz kırık bağlantıdan iyidir.
 */
function slugFor(poll, locale) {
  const lang = normalizeLocale(locale);
  const raw = poll && poll.slug;
  const value = typeof raw === "string" ? raw : text(raw && raw[lang]);
  return foldKey(value || (raw && raw.tr) || (poll && poll.id) || "");
}

/** Anketin bu dildeki site-içi yolu (`/anket/...` ya da `/en/poll/...`). */
function pollPathFor(poll, locale) {
  const lang = normalizeLocale(locale);
  const slug = slugFor(poll, lang);
  return slug ? `${POLL_PATH_PREFIX[lang]}/${slug}` : "";
}

/**
 * PAYLAŞIM METNİ SABİT DEĞİL — SEÇİME VE SONUCA GÖRE KURULUR.
 *
 * Şablonlar burada duruyor ve uç noktayla birlikte istemciye gidiyor.
 * Gerekçe tek kelimeyle KOPYA: metni tarayıcıda ikinci kez yazmak, bir gün
 * Türkçe sürümün düzeltilip İngilizcenin unutulması demekti. İstemci
 * yalnızca yer tutucuları dolduruyor.
 *
 * Yer tutucular: `{team}` seçilen/önde giden seçenek, `{percent}` onun oy
 * oranı, `{url}` anketin adresi. Toplam oy/katılımcı sayısı için yer tutucu
 * YOKTUR: anket sonuçlarında yalnızca yüzde gösterilir.
 *
 * YÜZDE UYDURULMAZ. Sayım yoksa (`withoutResult`) yüzdesiz metin kullanılır;
 * "%0 ile lider" demek, veride olmayan bir sayı iddia etmek olurdu.
 */
const SHARE_COPY = Object.freeze({
  tr: {
    voted: "Ben FutbolRadar anketinde {team} dedim! ⚽ {team} şu anda %{percent} oy alıyor. Sen de oyunu kullan 👇",
    votedWithoutResult: "Ben FutbolRadar anketinde {team} dedim! ⚽ Sen de oyunu kullan 👇",
    leader: "🔥 FutbolRadar anketi: {team} şu anda %{percent} ile lider! Sen ne diyorsun? Oyunu kullan.",
    plain: "🔥 FutbolRadar anketi: {question} Sen de oyunu kullan 👇",
    copied: "Bağlantı kopyalandı",
    copyFailed: "Bağlantı kopyalanamadı"
  },
  en: {
    voted: "I picked {team} in the FutbolRadar poll! ⚽ {team} is on {percent}% right now. Cast your vote 👇",
    votedWithoutResult: "I picked {team} in the FutbolRadar poll! ⚽ Cast your vote 👇",
    leader: "🔥 FutbolRadar poll: {team} leads with {percent}%! What do you say? Cast your vote.",
    plain: "🔥 FutbolRadar poll: {question} Cast your vote 👇",
    copied: "Link copied",
    copyFailed: "Link could not be copied"
  }
});

/**
 * ANKETE ÖZEL PAYLAŞIM METNİ — VARSAYILANIN ÜSTÜNE YAZAR.
 *
 * Varsayılan şablonlar HER anket için geçerli olmak zorunda, bu yüzden
 * bilinçli olarak yalındır ("{team} dedim"). Türkçede kulüp adına ek
 * getirmek ses uyumu ister ("Galatasaray'ı", "Fenerbahçe'yi",
 * "Gençlerbirliği S.K." …) ve bunu kod içinde kestirmeye çalışmak, 18
 * kulübün birkaçında bozuk bir cümleyle biterdi. Bozuk Türkçe bir paylaşım
 * metni, sitenin sesini paylaşan kişinin ağzına koyuyor.
 *
 * Çözüm kodda değil veride: anket kaydı kendi metnini yazabilir
 * (`share.voted.tr`, `share.leader.en`, …). Editör cümleyi doğru kurar,
 * kod da hiçbir kulüp adına ek getirmez. Verilmeyen alanlar varsayılanda
 * kalır — yarım bir geçersiz kılma, metni kaybettirmez.
 */
function shareCopyFor(poll, locale) {
  const lang = normalizeLocale(locale);
  const base = SHARE_COPY[lang];
  const overrides = poll && poll.share;
  if (!overrides || typeof overrides !== "object") return base;

  const merged = { ...base };
  for (const key of ["voted", "votedWithoutResult", "leader", "plain"]) {
    const value = localized(overrides[key], lang);
    if (value) merged[key] = value;
  }
  return merged;
}

/**
 * PAYLAŞILAN BAĞLANTIYA KAYNAK ETİKETİ.
 *
 * Hangi ağdan kaç okuyucu geldiği ancak adres ayrışırsa ölçülebilir.
 * Kampanya adı anket kimliğinden türetiliyor: yeni anket eklendiğinde
 * ölçüm etiketi de kendiliğinden doğru olur, kimse bir sabiti güncellemeyi
 * unutamaz.
 */
function shareUrlFor(baseUrl, platform, pollId) {
  const url = text(baseUrl);
  if (!url) return "";
  const source = foldKey(platform) || "share";
  const campaign = `poll_${foldKey(pollId).replace(/-/g, "_")}`;
  const query = `utm_source=${encodeURIComponent(source)}&utm_medium=social&utm_campaign=${encodeURIComponent(campaign)}`;
  return url + (url.indexOf("?") < 0 ? "?" : "&") + query;
}

/**
 * ANKET LİDERLERİ — İLK ÜÇ.
 *
 * Sunucudan gelen sıralı sonuçtan ilk üçü alır. Sayım yoksa BOŞ döner:
 * madalyaları boş bir listeye asmak, olmayan bir yarışın sonucunu
 * bildirmek olurdu.
 */
function podium(results) {
  return (Array.isArray(results) ? results : []).slice(0, 3);
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

/**
 * MAÇ ANKETİ SEÇENEKLERİ — "BU MAÇI KİM KAZANIR?"
 *
 * Üç seçenek maçın KENDİSİNDEN türer: ev sahibi, beraberlik, deplasman.
 * Elle yazılsaydı her maç için üç satır bakım demek olurdu ve bir kulüp adı
 * yanlış yazıldığında arma sessizce kırılırdı.
 *
 * MAÇ BULUNAMAZSA SEÇENEK ÜRETİLMEZ. Boş dizi dönmek, doğrulamanın kaydı
 * "en az iki seçenek olmalı" diyerek elemesi demektir — var olmayan bir maç
 * için "Galatasaray / Beraberlik / ?" basmaktansa anket hiç çıkmamalı.
 *
 * Beraberlik seçeneğinin arması YOKTUR ve olmamalıdır: bir sonucu kulüp
 * armasıyla göstermek, o sonucu bir kulübe ait gibi okutur.
 */
function matchOutcomeOptions(record, sources = {}) {
  const wanted = text(record && record.matchId);
  if (!wanted) return [];

  const payload = sources.matches;
  const list = Array.isArray(payload)
    ? payload
    : (payload && Array.isArray(payload.matches) ? payload.matches : []);

  const match = list.find((entry) => entry && text(entry.id) === wanted);
  if (!match) return [];

  const teams = Array.isArray(sources.teams)
    ? sources.teams
    : (sources.teams && Array.isArray(sources.teams.teams) ? sources.teams.teams : []);

  const crestFor = (name) => {
    const hit = teams.find((team) => foldKey(team && team.name) === foldKey(name));
    const providerId = text(hit && hit.providerId);
    return /^\d+$/.test(providerId) ? `${TEAM_LOGO_BASE}/${providerId}.png` : "";
  };
  const initialsFor = (name) => text(name).split(/\s+/).slice(0, 2)
    .map((part) => part.charAt(0)).join("").toLocaleUpperCase("tr-TR");

  const home = text(match.homeTeam || (match.home && match.home.name));
  const away = text(match.awayTeam || (match.away && match.away.name));
  if (!home || !away) return [];

  return [
    { id: "home", label: { tr: home, en: home }, team: home, logo: crestFor(home), initials: initialsFor(home) },
    { id: "draw", label: { tr: "Beraberlik", en: "Draw" }, team: "", logo: "", initials: "X" },
    { id: "away", label: { tr: away, en: away }, team: away, logo: crestFor(away), initials: initialsFor(away) }
  ];
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
  const surface = text(record.surface) || DEFAULT_SURFACE;

  if (!id) errors.push("id zorunlu");
  if (!SURFACES[surface]) errors.push(`surface "${surface}" tanımsız (${Object.keys(SURFACES).join(", ")})`);
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

  // PENCERE ALT SINIRI YÜZEYE GÖRE. Ana sayfa anketi iki hafta, maç anketi
  // bir saat: gerekçe `SURFACES` başlığında.
  const minWindowMs = (SURFACES[surface] || SURFACES[DEFAULT_SURFACE]).minWindowMs;
  if (startsAt && endsAt) {
    if (endsAt <= startsAt) errors.push("endsAt startsAt'ten sonra olmalı");
    else if (endsAt - startsAt < minWindowMs) {
      errors.push(surface === "match"
        ? `pencere en az 1 saat olmalı (${Math.round((endsAt - startsAt) / 60000)} dakika)`
        : `pencere en az 14 gün olmalı (${Math.round((endsAt - startsAt) / 86400000)} gün)`);
    }
  }

  // SLUG VERİLDİYSE İKİ DİLDE DE OLMALI. Tek dilde yazılmış bir slug,
  // diğer dilin adresini sessizce kimliğe düşürür ve iki dil arasındaki
  // hreflang eşleşmesi bir gün "neden bu sayfa indekslenmiyor" sorusuna
  // dönüşürdü.
  if (record.slug && (!hasLocale(record.slug, "tr") || !hasLocale(record.slug, "en"))) {
    errors.push("slug verildiyse iki dilde de olmalı");
  }

  const optionSource = text(record.optionSource);
  const options = optionSource === "super-lig-teams"
    ? superLigOptions(sources.teams)
    : (optionSource === "match-outcome"
      ? matchOutcomeOptions(record, sources)
      : explicitOptions(record.options, sources.teams));

  // MAÇ ANKETİ BİR MAÇA BAĞLI OLMAK ZORUNDA. Bağsız bir maç anketi hiçbir
  // sayfaya basılamaz ve sessizce takvimde asılı kalırdı.
  if (surface === "match" && !text(record.matchId)) errors.push("maç anketinde matchId zorunlu");

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
      surface,
      matchId: text(record.matchId),
      slug: {
        tr: slugFor({ slug: record.slug, id }, "tr"),
        en: slugFor({ slug: record.slug, id }, "en")
      },
      // Ankete özel paylaşım metni (varsa). Doğrulanmaz: eksik alan
      // varsayılanda kalır ve varsayılan her zaman geçerli bir cümledir.
      share: record.share && typeof record.share === "object" ? record.share : null,
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

  // ÇAKIŞMA DENETİMİ YÜZEY İÇİNDE. Ana sayfada aynı anda tek anket olmalı;
  // maç anketlerinde "aynı anda" kuralı MAÇ başına işler — iki farklı maçın
  // anketi elbette aynı saatte açık olabilir.
  const lastPerScope = new Map();
  for (const poll of validated) {
    const scope = poll.surface === "match" ? `match:${poll.matchId}` : poll.surface;
    const previous = lastPerScope.get(scope);
    if (previous && Date.parse(poll.startsAt) < Date.parse(previous.endsAt)) {
      rejected.push({ id: poll.id, errors: [`penceresi "${previous.id}" ile çakışıyor`] });
      continue;
    }
    // Aynı kimlik iki kez planlanamaz: oylar tek anahtarda toplanıyor.
    if (polls.some((entry) => entry.id === poll.id)) {
      rejected.push({ id: poll.id, errors: ["kimlik yinelenmiş"] });
      continue;
    }
    // ADRES DE BENZERSİZ OLMALI. İki anket aynı slug'ı taşırsa
    // `/anket/<slug>` bir anketi gösterir, diğerini sessizce yutar.
    const clash = polls.find((entry) => entry.slug.tr === poll.slug.tr || entry.slug.en === poll.slug.en);
    if (clash) {
      rejected.push({ id: poll.id, errors: [`adresi "${clash.id}" ile aynı`] });
      continue;
    }
    lastPerScope.set(scope, poll);
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
  const { polls: all, rejected } = scheduleFrom(sources);
  // Ana sayfa yalnızca `home` yüzeyini gösterir; bir maç anketi ana sayfaya
  // düşerse okuyucu sezon sorusu beklerken bir maç sorusu bulurdu.
  const polls = all.filter((poll) => poll.surface === "home");

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

/**
 * TAKVİMDEKİ BÜTÜN ANKETLER, DURUMLARIYLA — ANKET SAYFASI İÇİN.
 *
 * Ana sayfa tek bir anket gösterir (açık olan, ya da son kapanmış).
 * Anket sayfasının işi farklı: geçmişi, bugünü ve planlananı BİR ARADA
 * göstermek. Bu yüzden burada eleme yok — takvimdeki her geçerli anket,
 * durumuyla birlikte dönüyor.
 *
 * Sıra OKUYUCUNUN İLGİSİNE göre: önce oy verilebilen (`open`), sonra
 * sonuçları okunabilen (`closed`, en yenisi üstte), en sonda henüz
 * başlamamış olanlar (`upcoming`, en yakını üstte). Kronolojik sıralamak
 * kapanmış bir anketi açık olanın üstüne koyardı ve sayfaya giren okuyucu
 * oy verebileceği anketi aramak zorunda kalırdı.
 */
function listHomePolls(sources = {}, options = {}) {
  const nowMs = Number.isFinite(options.now) ? options.now : Date.now();
  const { polls: all, rejected } = scheduleFrom(sources);
  // Yüzey süzgeci isteğe bağlı: varsayılan `home` (anket sayfası), `all` ise
  // sayfa üreticisinin her ankete bir adres açabilmesi için.
  const wanted = text(options.surface) || DEFAULT_SURFACE;
  const polls = wanted === "all" ? all : all.filter((poll) => poll.surface === wanted);

  const statusOf = (poll) => {
    if (Date.parse(poll.startsAt) > nowMs) return "upcoming";
    return Date.parse(poll.endsAt) <= nowMs ? "closed" : "open";
  };

  const rank = { open: 0, closed: 1, upcoming: 2 };
  const entries = polls.map((poll) => ({ poll, status: statusOf(poll) }));

  entries.sort((left, right) => {
    if (rank[left.status] !== rank[right.status]) return rank[left.status] - rank[right.status];
    // Kapanmışlarda en YENİ üstte, planlananlarda en YAKIN üstte.
    return left.status === "upcoming"
      ? Date.parse(left.startsAt || left.poll.startsAt) - Date.parse(right.poll.startsAt)
      : Date.parse(right.poll.endsAt) - Date.parse(left.poll.endsAt);
  });

  return { entries, rejected };
}

/**
 * KİMLİĞE YA DA ADRESE GÖRE TEK ANKET — ANKET SAYFASI VE UÇ NOKTA İÇİN.
 *
 * Anket sayfası BELLİ bir anketi gösterir (kapanmış olsa bile); ana sayfa
 * ise "şu an açık olanı". İkisi aynı takvimden okur ama farklı soru sorar.
 * Durum burada da hesaplanır, çünkü sayfa kapanmış anketi "kapandı" diye
 * göstermek zorunda — kapanmış bir ankete oy formu basmak, oyu sessizce
 * kaybettirirdi.
 */
function findPoll(sources = {}, selector = {}, options = {}) {
  const nowMs = Number.isFinite(options.now) ? options.now : Date.now();
  const { polls, rejected } = scheduleFrom(sources);

  const id = text(selector.id);
  const slug = foldKey(selector.slug);
  const poll = polls.find((entry) => (id && entry.id === id)
    || (slug && (entry.slug.tr === slug || entry.slug.en === slug)));

  if (!poll) return { poll: null, status: "none", rejected };

  const status = Date.parse(poll.startsAt) > nowMs
    ? "upcoming"
    : (Date.parse(poll.endsAt) <= nowMs ? "closed" : "open");
  return { poll, status, rejected };
}

/**
 * BİR MAÇIN ANKETİ — "BU MAÇI KİM KAZANIR?".
 *
 * Maç sayfasının soracağı tek soru vardır: o maçın anketi. Birden fazla
 * kayıt varsa AÇIK olan tercih edilir, yoksa en son kapanan; başlamamış
 * bir anket maç sayfasında gösterilmez çünkü oy alamaz ve sonuç da yoktur.
 */
function selectMatchPoll(sources = {}, matchId, options = {}) {
  const nowMs = Number.isFinite(options.now) ? options.now : Date.now();
  const wanted = text(matchId);
  const { polls, rejected } = scheduleFrom(sources);
  const mine = polls.filter((poll) => poll.surface === "match" && poll.matchId === wanted);

  const open = mine.find((poll) => Date.parse(poll.startsAt) <= nowMs && nowMs < Date.parse(poll.endsAt));
  if (open) return { poll: open, status: "open", rejected };

  const closed = mine
    .filter((poll) => Date.parse(poll.endsAt) <= nowMs)
    .sort((left, right) => Date.parse(right.endsAt) - Date.parse(left.endsAt))[0];
  if (closed) return { poll: closed, status: "closed", rejected };

  return { poll: null, status: "none", rejected };
}

/** Anketi tek dile indirger; istemciye giden biçim budur. */
function localizePoll(poll, locale) {
  if (!poll) return null;
  const lang = normalizeLocale(locale);
  return {
    id: poll.id,
    type: poll.type,
    surface: poll.surface || DEFAULT_SURFACE,
    matchId: poll.matchId || "",
    slug: slugFor(poll, lang),
    // Paylaşılan bağlantının gideceği yer. İstemci buna kendi kökünü ekler;
    // servis mutlak adres üretmez çünkü aynı kod hem yerelde hem yayında
    // koşuyor ve alan adını buraya gömmek, yereldeki her paylaşımı canlı
    // siteye göndermek olurdu.
    path: pollPathFor(poll, lang),
    share: shareCopyFor(poll, lang),
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
  DEFAULT_SURFACE,
  LOCALES,
  MAX_OPTIONS,
  MIN_WINDOW_MS,
  POLL_PATH_PREFIX,
  SHARE_COPY,
  SURFACES,
  TEAM_LOGO_BASE,
  explicitOptions,
  findPoll,
  shareCopyFor,
  foldKey,
  hasLocale,
  localized,
  listHomePolls,
  localizePoll,
  logRejected,
  matchOutcomeOptions,
  normalizeLocale,
  podium,
  pollPathFor,
  scheduleFrom,
  selectHomePoll,
  selectMatchPoll,
  shareUrlFor,
  slugFor,
  superLigOptions,
  validatePoll
};
