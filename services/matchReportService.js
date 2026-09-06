/**
 * Tamamlanan maçlar için otomatik maç raporu üretir.
 *
 * Tasarım kuralı: her cümle maçın gerçek verisinden türer. Veri yoksa bölüm
 * "unavailable" döner ve sayfa bunu açıkça yazar — model, eksik veriyi
 * doldurmak için tahmin üretmez. Bu, sitenin geri kalanındaki "doğrulanmamış
 * veri yayımlanmaz" kuralının rapor katmanındaki karşılığıdır.
 *
 * Üretim deterministiktir: aynı maç verisi her zaman aynı raporu verir, bu
 * yüzden build çıktısı tekrarlanabilir ve diff'ler gürültüsüzdür.
 */

const { finishLabel, finishType, isAnalyzableMatch } = require("./matchStatus");

const VOICELESS = new Set(["f", "s", "t", "k", "ç", "ş", "h", "p"]);
const BACK_VOWELS = new Set(["a", "ı", "o", "u"]);
const VOWELS = "aeıioöuüAEIİOÖUÜ";

function lastVowel(word) {
  const clean = String(word || "").toLocaleLowerCase("tr-TR");
  for (let i = clean.length - 1; i >= 0; i -= 1) {
    if (VOWELS.includes(clean[i])) return clean[i];
  }
  return "";
}

function endsWithVowel(word) {
  const clean = String(word || "").trim().toLocaleLowerCase("tr-TR");
  const last = clean[clean.length - 1] || "";
  // Yabancı adlarda sondaki "y" sesli okunur (Hull City -> City'yi, Derby ->
  // Derby'yi); Türkçe ek pratiği yazıma değil okunuşa bakar.
  if (last === "y" && clean.length > 1 && !VOWELS.includes(clean[clean.length - 2])) return true;
  return VOWELS.includes(last);
}

/**
 * 3. tekil iyelik eki taşıyan yer adları ("... Stadyumu", "... Parkı") hâl
 * eki almadan önce kaynaştırma "n"si ister: Stadyumu'nda, Parkı'nda.
 */
function isPossessivePlace(name) {
  return /(stadyum|stad|park|saha|tesis|kompleks|arena)\w*[uüıi]$/i.test(String(name || "").trim());
}

function lastLetter(word) {
  const clean = String(word || "").trim().toLocaleLowerCase("tr-TR");
  return clean[clean.length - 1] || "";
}

/** Belirtme hâli: "Galatasaray'ı", "Fenerbahçe'yi". */
function accusative(name) {
  const vowel = lastVowel(name);
  const suffix = BACK_VOWELS.has(vowel)
    ? (vowel === "o" || vowel === "u" ? "u" : "ı")
    : (vowel === "ö" || vowel === "ü" ? "ü" : "i");
  return `${name}'${endsWithVowel(name) ? "y" : ""}${suffix}`;
}

/** Yönelme hâli: "Trabzonspor'a", "Beşiktaş'a", "Monza'ya". */
function dative(name) {
  const suffix = BACK_VOWELS.has(lastVowel(name)) ? "a" : "e";
  return `${name}'${endsWithVowel(name) ? "y" : ""}${suffix}`;
}

/** Bulunma hâli: "Kadıköy'de", "Linz'de", "Tüpraş Stadyumu'nda". */
function locative(name) {
  const back = BACK_VOWELS.has(lastVowel(name));
  if (isPossessivePlace(name)) {
    return `${name}'n${back ? "da" : "de"}`;
  }
  const hard = VOICELESS.has(lastLetter(name));
  return `${name}'${hard ? "t" : "d"}${back ? "a" : "e"}`;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .trim()
    .toLowerCase();
}

/** "2026-07-27" -> "27 Temmuz 2026". Geçersiz girdide ham değeri döndürür. */
function formatTrDate(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return String(value || "").slice(0, 10);
  return new Intl.DateTimeFormat("tr-TR", {
    day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Istanbul"
  }).format(date);
}

function slug(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function round(value, decimals) {
  const factor = 10 ** (decimals || 0);
  return Math.round(Number(value) * factor) / factor;
}

/** Türkçe ondalık gösterim: 1.54 -> "1,54". */
function tr(value, decimals) {
  if (!isNumber(Number(value))) return null;
  const fixed = decimals === undefined ? String(round(value, 2)) : Number(value).toFixed(decimals);
  return fixed.replace(".", ",");
}

/**
 * Rapor cümlelerinin her maçta birebir aynı kalmaması için maç kimliğine
 * göre deterministik varyant seçer. Rastgelelik yok: aynı maç her build'de
 * aynı varyantı alır, ama farklı maçlar farklı kalıpla yazılır.
 */
function seedFrom(value) {
  const text = String(value || "");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function variant(seed, options) {
  if (!Array.isArray(options) || !options.length) return "";
  return options[seed % options.length];
}

function statValue(match, type, side) {
  const row = (match.statistics || []).find((item) => normalizeText(item.type) === normalizeText(type));
  if (!row) return null;
  const value = row[side];
  return isNumber(Number(value)) && value !== null && value !== "" ? Number(value) : null;
}

function statPair(match, type) {
  const home = statValue(match, type, "home");
  const away = statValue(match, type, "away");
  return home === null && away === null ? null : { home, away };
}

// Uzatma dakikasi korunur: "45+4'" bilgisi "45"e indirgenirse ilk yarinin
// uzatmasinda atilan gol, normal oyun icinde atilmis gibi okunur.
function minuteOf(event) {
  const raw = String((event && event.time) || "").match(/(\d+)(?:\s*\+\s*(\d+))?/);
  if (!raw) return null;
  return raw[2] ? `${raw[1]}+${raw[2]}` : Number(raw[1]);
}

function eventTeamName(event) {
  if (!event || !event.team) return "";
  return typeof event.team === "string" ? event.team : event.team.name || "";
}

/**
 * OLAY SÖZLÜĞÜ — iki kaynak, iki dil.
 *
 * Kürasyonlu kayıtlar olay türünü Türkçe yazıyor ("Gol", "Kırmızı kart");
 * sağlayıcı İngilizce veriyor ("Goal", "Card" + detail "Red Card"). Ağırlık
 * ve katkı hesabı yalnızca Türkçe terimlere baktığı için sağlayıcıdan gelen
 * KIRMIZI KARTLAR HİÇ SAYILMIYORDU: kırılma anları listesinde 10 puanlık bir
 * olay 1 puana düşüp eleniyordu. "Gol" ise "goal" içinde geçtiği için
 * tesadüfen çalışıyordu — sözleşme değil, şans.
 *
 * Tür ve detay birlikte taranıyor: sağlayıcı kart olaylarında rengi `type`
 * değil `detail` alanında bildiriyor.
 */
const EVENT_SYNONYMS = {
  "gol": ["goal"],
  "kırmızı": ["red card"],
  "sarı": ["yellow card"],
  "penaltı": ["penalty"],
  "direk": ["woodwork", "hit the post"],
  "kurtarış": ["saved", "goalkeeper save"],
  "asist": ["assist"],
  "iptal": ["cancelled", "disallowed", "var"]
};

function isType(event, ...needles) {
  const haystack = `${normalizeText(event && event.type)} ${normalizeText(event && event.detail)}`;
  return needles.some((needle) => {
    const key = normalizeText(needle);
    if (haystack.includes(key)) return true;
    const synonyms = EVENT_SYNONYMS[needle] || EVENT_SYNONYMS[key] || [];
    return synonyms.some((synonym) => haystack.includes(normalizeText(synonym)));
  });
}

/** Kırılma anları listesinde gösterilecek Türkçe etiket. */
const EVENT_LABELS = [
  [["red card"], "Kırmızı kart"],
  [["yellow card", "second yellow"], "Sarı kart"],
  [["penalty missed", "missed penalty"], "Kaçan penaltı"],
  [["penalty"], "Penaltı"],
  [["own goal"], "Kendi kalesine gol"],
  [["normal goal", "goal"], "Gol"],
  [["substitution", "subst"], "Oyuncu değişikliği"],
  [["var"], "VAR incelemesi"]
];

function eventLabel(event) {
  const haystack = `${normalizeText(event && event.detail)} ${normalizeText(event && event.type)}`;
  for (const [keys, label] of EVENT_LABELS) {
    if (keys.some((key) => haystack.includes(normalizeText(key)))) return label;
  }
  // Tanınmayan tür OLDUĞU GİBİ gösterilir; uydurma bir etiket koymaktansa
  // sağlayıcının yazdığı kalsın.
  return (event && event.type) || "Olay";
}

function goalEvents(match) {
  return (match.events || []).filter((event) => isType(event, "gol") && !isType(event, "iptal"));
}

/**
 * Olay metninden oyuncu adını çıkarır: "Anderson Talisca serbest vuruştan...".
 * Ada eklenmiş Türkçe hâl eki ("Kökçü'nün") kırpılır; ad içinde geçen
 * kesme işareti ("N'Golo") korunur — ayrım, kesmeden sonraki harfin küçük
 * olup olmadığına bakılarak yapılır.
 */
function stripTurkishSuffix(token) {
  return token.replace(/['’](?=\p{Ll})\p{Ll}+$/u, "");
}

/**
 * Olaydaki OYUNCU ADI — sağlayıcı biçimi ile kürasyonlu biçim aynı alanı
 * kullanmıyor ve fark sessizce yanlış isim bastırıyordu.
 *
 *   • Kürasyonlu kayıt: `detail` bir Türkçe cümle —
 *     "Anderson Talisca serbest vuruştan skoru 1-0 yaptı."
 *   • Sağlayıcı kaydı: `detail` olayın TÜRÜ — "Normal Goal", "Red Card" —
 *     oyuncu ise `value` alanında: "V. Osimhen · Asist: L. Torreira · Normal Goal".
 *
 * Yalnızca `detail` okunduğu için sağlayıcıdan gelen her maçta golcü adı
 * "Normal Goal" çıkıyordu; 167 rapor sayfasında "2' Goal · Takım Normal Goal"
 * yazıyordu. Ad UYDURULMUŞ değildi ama olmayan bir oyuncuyu varmış gibi
 * göstermek de aynı kapıya çıkıyor.
 *
 * Bu yüzden önce `value`nun ilk parçası denenir (ayraç " · "), sonra
 * `detail` cümlesine düşülür. Hiçbiri ad vermiyorsa null döner ve arayüz
 * oyuncusuz cümleyi kurar — tahmin edilmez.
 */
function playerFromEvent(event) {
  if (!event) return null;
  const value = String(event.value || "").split("·")[0].trim();
  const fromValue = playerFromDetail(value);
  if (fromValue) return fromValue;

  // `detail` GERİ DÖNÜŞÜ YALNIZCA CÜMLE İSE GEÇERLİ. Sağlayıcı kaydında
  // detay olayın türüdür ("Normal Goal", "Red Card") ve iki büyük harfle
  // başlayan iki kelime olduğu için ad çıkarıcı onu memnuniyetle kabul
  // ediyor. Tanınan bir olay etiketi asla oyuncu adı sayılmaz.
  if (isKnownEventLabel(event.detail)) return null;
  return playerFromDetail(event.detail);
}

/**
 * Satırda gösterilecek detay: önce oyuncu adı, yoksa sağlayıcının serbest
 * metni. Detay tanınan bir olay ETİKETİ ise boş bırakılır — `type` alanı
 * zaten Türkçe etiketi taşıyor ve "Gol — Normal Goal" demek kendini
 * tekrarlayan, üstelik çevrilmemiş bir satır olurdu.
 */
function eventDetailText(event) {
  const player = playerFromEvent(event);
  if (player) return player;
  return isKnownEventLabel(event && event.detail) ? "" : (event && event.detail) || "";
}

/** Metin, olay türü sözlüğündeki bir etiketin kendisi mi? */
function isKnownEventLabel(text) {
  const value = normalizeText(text);
  if (!value) return false;
  return EVENT_LABELS.some(([keys]) => keys.some((key) => value === normalizeText(key)));
}

function playerFromDetail(detail) {
  const text = String(detail || "").trim();
  if (!text) return null;
  const match = text.match(/^([\p{Lu}][\p{L}'’.-]*(?:\s+[\p{Lu}][\p{L}'’.-]*){0,3})/u);
  if (!match) return null;
  const name = match[1]
    .trim()
    .replace(/[.,;:]$/, "")
    .split(/\s+/)
    .map(stripTurkishSuffix)
    .join(" ")
    .trim();
  return name.split(/\s+/).length >= 2 ? name : null;
}

function outcome(match) {
  const home = match.score && match.score.home;
  const away = match.score && match.score.away;
  if (!isNumber(home) || !isNumber(away)) return null;
  if (home > away) return { winner: match.homeTeam, loser: match.awayTeam, draw: false, margin: home - away };
  if (away > home) return { winner: match.awayTeam, loser: match.homeTeam, draw: false, margin: away - home };
  return { winner: null, loser: null, draw: true, margin: 0 };
}

function scoreLine(match) {
  const home = match.score && match.score.home;
  const away = match.score && match.score.away;
  return isNumber(home) && isNumber(away) ? `${home}-${away}` : null;
}

// ── 1. Maç özeti ────────────────────────────────────────────────────────────
function buildSummary(match, seed) {
  const result = outcome(match);
  const score = scoreLine(match);
  if (!result || !score) {
    return { status: "unavailable", reason: "Maç sonucu sağlayıcı tarafından paylaşılmadı." };
  }

  const goals = goalEvents(match);
  // Saha bilinmediginde `where` bos kalir ve cumle "oynanan ..." diye kucuk
  // harfle baslardi; cumle kurulduktan sonra bas harf buyutulur.
  const where = match.venue && match.venue !== "Açıklanmadı" ? `${locative(match.venue)} ` : "";
  // Aşama etiketi yalnızca lig adına bilgi katıyorsa eklenir; "Hazırlık Maçı
  // sezon öncesi hazırlık" gibi kendini tekrar eden ifadeler ayıklanır. Özel
  // adlar ("Summer Series Upper Austria") küçültülmez.
  const leagueWords = new Set(normalizeText(match.league).split(/\s+/).filter((word) => word.length > 3));
  const rawStage = String(match.stage || "").replace(/,\s*/g, " ").trim();
  const stageAddsInfo = rawStage
    && !normalizeText(rawStage).split(/\s+/).filter((word) => word.length > 3).some((word) => leagueWords.has(word));
  let stage = stageAddsInfo ? `${match.league} ${rawStage}` : match.league;
  // Cümle zaten "karşılaşma" sözcüğünü getiriyor; etiket "... Maçı" ile
  // bitiyorsa o sözcük düşer ("Hazırlık Maçı maçını" -> "hazırlık maçını").
  // Tek sözcük kalırsa cins isimdir, küçültülür; çok sözcüklüler özel ad
  // olabileceği için yazımı korunur.
  const trimmed = stage.replace(/\s*ma[çc][ıi]$/i, "").trim();
  if (trimmed && trimmed !== stage) {
    stage = trimmed.includes(" ") ? trimmed : trimmed.toLocaleLowerCase("tr-TR");
  }

  // Kazanan anıldığında skor kazananın gol sayısı önce gelecek şekilde
  // yazılır; ev-deplasman sırası korunursa "Galatasaray 1-5 kazandı" gibi
  // yanıltıcı bir cümle çıkıyor.
  const home = match.score.home;
  const away = match.score.away;
  const winnerFirst = result.draw
    ? score
    : `${Math.max(home, away)}-${Math.min(home, away)}`;

  const headline = result.draw
    ? `${match.homeTeam} ile ${match.awayTeam} ${score} berabere kaldı`
    : `${result.winner}, ${accusative(result.loser)} ${winnerFirst} yendi`;

  // Saha bilinmiyorsa "oynanan" sozcugu de dusurulur; aksi halde cumle
  // "Oynanan hazirlik macini ..." diye sahipsiz bir yan cumleyle basliyordu.
  const played = where ? `${where}oynanan ` : "";
  const opening = result.draw
    ? variant(seed, [
        `${match.homeTeam} ile ${match.awayTeam}, ${played}${stage} karşılaşmasında ${score} berabere kaldı.`,
        `${played}${stage} maçında ${match.homeTeam} ile ${match.awayTeam} birbirini geçemedi: ${score}.`
      ])
    : variant(seed, [
        `${result.winner}, ${played}${stage} karşılaşmasında ${accusative(result.loser)} ${winnerFirst} mağlup etti.`,
        `${played}${stage} maçını ${result.winner} ${winnerFirst} kazandı; ${result.loser} sahadan puansız ayrıldı.`
      ]);

  // Saha bilinmiyorsa `where` bos kalir ve cumle "oynanan ..." diye kucuk
  // harfle baslar; bas harfi Turkce kurallarina gore buyutulur.
  const sentences = [opening.charAt(0).toLocaleUpperCase("tr-TR") + opening.slice(1)];

  if (goals.length) {
    const scorers = goals
      .map((event) => {
        const minute = minuteOf(event);
        const player = playerFromEvent(event);
        const team = eventTeamName(event);
        // Kendi kalesine gollerde olay metninde golu atan rakip oyuncu yer
        // almaz; "52. dakikada Hull City" demek golu onlarin bir oyuncusunun
        // attigi izlenimi verirdi.
        const ownGoal = /kendi kalesine/i.test(String(event.detail || ""));
        if (ownGoal) return minute ? `${minute}. dakikada kendi kalesine` : "kendi kalesine";
        if (!player) return minute ? `${minute}. dakikada ${team}` : team;
        return minute ? `${minute}. dakikada ${player} (${team})` : `${player} (${team})`;
      })
      .filter(Boolean);
    if (scorers.length) {
      sentences.push(`${scorers.length === 1 ? "Tek golü" : "Golleri"} ${scorers.join(", ")} kaydetti.`);
    }
  } else if (home === 0 && away === 0) {
    // Golsüz maçta "gol bilgisi doğrulanmadı" demek yanlış olur: eksik veri
    // değil, gerçekten gol yok.
    sentences.push("İki takım da gol bulamadı.");
  } else {
    sentences.push("Gol dakikaları ve golcü bilgisi sağlayıcı tarafından paylaşılmadı.");
  }

  const htHome = match.score && match.score.halftimeHome;
  const htAway = match.score && match.score.halftimeAway;
  if (isNumber(htHome) && isNumber(htAway)) {
    const htLine = `${htHome}-${htAway}`;
    sentences.push(
      htLine === score
        ? `İlk yarı da ${htLine} tamamlanmıştı; ikinci yarıda skor değişmedi.`
        : `Devre ${htLine} kapanmıştı.`
    );
  }

  return {
    status: "ready",
    headline,
    paragraph: sentences.join(" "),
    score,
    result
  };
}

// ── 2. Öne çıkan oyuncular ──────────────────────────────────────────────────
function buildStandoutPlayers(match) {
  const contributions = new Map();

  function add(name, team, weight, note) {
    if (!name) return;
    const key = `${normalizeText(name)}|${normalizeText(team)}`;
    const entry = contributions.get(key) || { name, team, score: 0, notes: [] };
    entry.score += weight;
    if (note) entry.notes.push(note);
    contributions.set(key, entry);
  }

  for (const event of match.events || []) {
    const team = eventTeamName(event);
    const player = playerFromEvent(event);
    const minute = minuteOf(event);
    const stamp = minute ? `${minute}'` : "";

    if (isType(event, "gol")) add(player, team, 5, `${stamp} gol`.trim());
    else if (isType(event, "asist")) add(player, team, 3, `${stamp} asist`.trim());
    // "Kurtarış" olayında olay takımı hücum eden taraf, metinde önce anılan
    // isim de şutu çeken oyuncudur; kurtaran kaleci ikinci sırada geçer.
    // Bu yüzden katkı, kurtarış değil isabetli şut olarak yazılır.
    else if (isType(event, "kurtarış")) add(player, team, 2, `${stamp} kaleciden dönen isabetli şut`.trim());
    else if (isType(event, "direk")) add(player, team, 2, `${stamp} direkten dönen şut`.trim());
    else if (isType(event, "kırmızı")) add(player, team, -4, `${stamp} kırmızı kart`.trim());
    else if (isType(event, "sarı")) add(player, team, -1, `${stamp} sarı kart`.trim());
  }

  const ranked = [...contributions.values()]
    .filter((entry) => entry.notes.length)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name, "tr"))
    .slice(0, 4);

  if (!ranked.length) {
    return {
      status: "unavailable",
      reason: `${match.homeTeam} - ${match.awayTeam} maçında oyuncu bazlı katkı verisi (gol, asist, kart, kurtarış) sağlayıcı tarafından paylaşılmadı.`
    };
  }

  return {
    status: "ready",
    players: ranked.map((entry) => ({
      name: entry.name,
      team: entry.team,
      contribution: entry.notes.join(" · "),
      impact: entry.score >= 5 ? "yüksek" : entry.score > 0 ? "orta" : "olumsuz"
    }))
  };
}

// ── 3. İstatistik analizi ───────────────────────────────────────────────────
/** Olay dakikasını sayıya çevirir: "37'", "90+2'" -> 37, 92. */
function eventMinute(event) {
  const raw = String((event && event.time) || "").replace(/['’\s]/g, "");
  if (!raw) return null;
  const parts = raw.split("+").map((part) => Number(part));
  if (!parts.length || !Number.isFinite(parts[0])) return null;
  return parts.reduce((total, part) => total + (Number.isFinite(part) ? part : 0), 0);
}

/**
 * MAÇ MOMENTUMU — olay akışından türetilir, uydurulmaz.
 *
 * Momentum burada bir tahmin modeli değil, ÖLÇÜLEN bir şey: maçı yarılara
 * bölüp her yarıda hangi takımın kaç kayda değer olay ürettiğine bakıyoruz.
 * Kaynak, sağlayıcının olay akışı (goller, kartlar, kritik kurtarışlar).
 *
 * Dakikası okunamayan olaylar sayıma girmez — "bir yerde olmuş" bilgisi
 * momentum için işe yaramaz ve varsayılan bir dakika atamak veriyi
 * uydurmak olurdu.
 *
 * İki taraflı en az iki dakikalı olay yoksa bölüm "veri yok" der. Tek golle
 * momentum grafiği çizmek, ölçüm gibi görünen bir süs olurdu.
 */
function buildMomentum(match) {
  const events = Array.isArray(match.events) ? match.events : [];
  const timed = events
    .map((event) => ({ event, minute: eventMinute(event), team: eventTeamName(event) }))
    .filter((item) => item.minute !== null && item.team);

  if (timed.length < 2) {
    return {
      status: "unavailable",
      reason: `${match.homeTeam} - ${match.awayTeam} karşılaşmasının dakikalı olay akışı momentum çıkarmaya yetmiyor. ` +
        "Sağlayıcıdan olay verisi geldiğinde bu bölüm otomatik dolar."
    };
  }

  // Yarım saatlik dilimler: 0-30, 30-60, 60-90+. Maçın gerçek uzunluğuna
  // göre son dilim uzayabilir.
  const lastMinute = Math.max(90, ...timed.map((item) => item.minute));
  const bounds = [[0, 30], [30, 60], [60, lastMinute + 1]];

  const phases = bounds.map(([from, to]) => {
    const inPhase = timed.filter((item) => item.minute >= from && item.minute < to);
    const home = inPhase.filter((item) => item.team === match.homeTeam).length;
    const away = inPhase.filter((item) => item.team === match.awayTeam).length;
    const label = to > 90 ? `${from}+` : `${from}-${to}`;

    return {
      label: `${label} dk`,
      home,
      away,
      // Üstünlük yalnızca fark varsa iddia edilir; eşitlikte "dengeli".
      leader: home === away ? null : (home > away ? match.homeTeam : match.awayTeam),
      events: inPhase.length
    };
  });

  const goals = timed.filter((item) => /gol/i.test(String(item.event.type || "")));
  const firstGoal = goals.length ? goals[0] : null;

  const readings = phases
    .filter((phase) => phase.events > 0)
    .map((phase) => phase.leader
      ? `${phase.label}: ${phase.leader} ${Math.max(phase.home, phase.away)}-${Math.min(phase.home, phase.away)} olayla öne çıktı.`
      : `${phase.label}: ${phase.home}-${phase.away} dengeli bir bölüm.`);

  if (firstGoal) {
    readings.unshift(`İlk gol ${firstGoal.minute}. dakikada ${firstGoal.team} tarafından geldi.`);
  }

  return {
    status: "ready",
    phases,
    // Kaç olaydan türetildiği açıkça taşınıyor: iki olaydan çıkan momentum
    // ile yirmi olaydan çıkan momentum aynı ağırlıkta okunmamalı.
    sampleSize: timed.length,
    confidence: timed.length >= 6 ? "yüksek" : timed.length >= 4 ? "orta" : "sınırlı",
    readings
  };
}

/**
 * TAKIM SİNYALLERİ — yalnızca ölçülmüş istatistiklerden.
 *
 * Her sinyal tek bir gerçek istatistiğe dayanır ve hangi ölçüden geldiğini
 * taşır. Ölçü yoksa sinyal üretilmez; "muhtemelen baskılıydı" türü bir
 * çıkarım yapılmaz.
 */
function buildSignals(match) {
  const stats = Array.isArray(match.statistics) ? match.statistics : [];
  if (!stats.length) {
    return {
      status: "unavailable",
      reason: `${match.homeTeam} - ${match.awayTeam} için takım sinyalleri istatistik dökümüne dayanır; ` +
        "sağlayıcıdan bu maçın istatistikleri henüz gelmedi."
    };
  }

  const definitions = [
    { stat: "Topla oynama", label: "Oyun kontrolü", threshold: 60 },
    { stat: "Gol beklentisi (xG)", label: "Pozisyon kalitesi", threshold: null },
    { stat: "Toplam şut", label: "Şut hacmi", threshold: null },
    { stat: "İsabetli şut", label: "İsabet", threshold: null },
    { stat: "Pas isabeti", label: "Pas güvenliği", threshold: 85 },
    { stat: "Korner", label: "Baskı sürekliliği", threshold: null }
  ];

  const signals = [];
  for (const definition of definitions) {
    const pair = statPair(match, definition.stat);
    if (!pair || !isNumber(pair.home) || !isNumber(pair.away)) continue;
    if (pair.home === pair.away) continue;

    const leader = pair.home > pair.away ? match.homeTeam : match.awayTeam;
    const top = Math.max(pair.home, pair.away);
    const bottom = Math.min(pair.home, pair.away);

    signals.push({
      label: definition.label,
      team: leader,
      value: `${pair.home}-${pair.away}`,
      // Sinyalin dayandığı ölçü adıyla taşınıyor: okuyucu neyin ölçüldüğünü
      // görebilmeli, "sinyal" kelimesine güvenmek zorunda kalmamalı.
      metric: definition.stat,
      strong: definition.threshold !== null && top >= definition.threshold,
      margin: Math.round((top - bottom) * 100) / 100
    });
  }

  if (!signals.length) {
    return {
      status: "unavailable",
      reason: "İstatistik dökümü geldi ancak iki takım arasında sinyal üretecek fark ölçülmedi."
    };
  }

  return { status: "ready", signals, sampleSize: signals.length };
}

function buildStatisticsAnalysis(match, seed) {
  const stats = match.statistics || [];
  if (!stats.length) {
    return {
      status: "unavailable",
      reason: `${match.homeTeam} - ${match.awayTeam} karşılaşmasının istatistik dökümü sağlayıcıdan henüz alınmadı. Veri geldiğinde bu bölüm otomatik dolar.`
    };
  }

  const possession = statPair(match, "Topla oynama");
  const shots = statPair(match, "Toplam şut");
  const onTarget = statPair(match, "İsabetli şut");
  const xg = statPair(match, "Gol beklentisi (xG)");
  const passAccuracy = statPair(match, "Pas isabeti");
  const corners = statPair(match, "Korner");

  const readings = [];
  const home = match.homeTeam;
  const away = match.awayTeam;

  if (possession && isNumber(possession.home)) {
    const leader = possession.home >= possession.away ? home : away;
    const value = Math.max(possession.home, possession.away);
    readings.push(
      value >= 65
        ? `${leader} topa yüzde ${value} sahip olarak oyunun ritmini tek başına belirledi.`
        : `Topla oynama yüzde ${possession.home}-${possession.away} dağıldı; ${leader} hafif üstünlük kurdu.`
    );
  }

  if (shots && isNumber(shots.home) && isNumber(shots.away)) {
    const detail = onTarget && isNumber(onTarget.home)
      ? ` İsabetli şutta tablo ${onTarget.home}-${onTarget.away}.`
      : "";
    readings.push(`Şut üretimi ${shots.home}-${shots.away} sonuçlandı.${detail}`);
  }

  if (xg && isNumber(xg.home) && isNumber(xg.away)) {
    const actualHome = match.score && match.score.home;
    const actualAway = match.score && match.score.away;
    readings.push(`Gol beklentisi (xG) ${tr(xg.home, 2)}-${tr(xg.away, 2)} oldu.`);
    if (isNumber(actualHome) && isNumber(actualAway)) {
      const homeDelta = actualHome - xg.home;
      const awayDelta = actualAway - xg.away;
      const bigger = Math.abs(homeDelta) >= Math.abs(awayDelta) ? { team: home, delta: homeDelta } : { team: away, delta: awayDelta };
      if (Math.abs(bigger.delta) >= 0.5) {
        readings.push(
          bigger.delta < 0
            ? `${bigger.team} ürettiği pozisyonun gerisinde kaldı; xG ile gerçek skor arasında ${tr(Math.abs(bigger.delta), 2)} fark var.`
            : `${bigger.team} beklentinin üzerinde bitiricilik gösterdi (+${tr(bigger.delta, 2)}).`
        );
      }
    }
  }

  if (passAccuracy && isNumber(passAccuracy.home)) {
    readings.push(`Pas isabeti yüzde ${passAccuracy.home}-${passAccuracy.away} ölçüldü.`);
  }

  if (corners && isNumber(corners.home)) {
    readings.push(`Korner sayısı ${corners.home}-${corners.away}.`);
  }

  // Şut başına gol: bitiricilik verimliliği
  const conversion = [];
  for (const [side, team] of [["home", home], ["away", away]]) {
    const teamShots = shots && shots[side];
    const goals = match.score && match.score[side];
    if (isNumber(teamShots) && teamShots > 0 && isNumber(goals)) {
      conversion.push({ team, rate: round((goals / teamShots) * 100, 1), shots: teamShots, goals });
    }
  }

  return {
    status: "ready",
    readings,
    conversion,
    highlights: stats
      .filter((row) => isNumber(Number(row.home)) && isNumber(Number(row.away)))
      .slice(0, 12)
      .map((row) => ({
        type: row.type,
        home: row.decimals ? tr(row.home, row.decimals) : row.home,
        away: row.decimals ? tr(row.away, row.decimals) : row.away,
        unit: row.unit || ""
      })),
    lead: variant(seed, [
      "Sayısal tablo maçın hangi bölümlerinde üstünlük kurulduğunu gösteriyor.",
      "Rakamlar, skorun oyunun akışını ne kadar yansıttığını ortaya koyuyor."
    ])
  };
}

// ── 4. Taktik değerlendirme ─────────────────────────────────────────────────
function buildTacticalRead(match) {
  const lineups = match.lineups || [];
  const formations = lineups.filter((row) => row && row.formation);
  const possession = statPair(match, "Topla oynama");
  const duels = statPair(match, "Kazanılan ikili mücadele");
  const crosses = statPair(match, "Toplam orta");
  const clearances = statPair(match, "Uzaklaştırma");
  const boxTouches = statPair(match, "Rakip ceza sahasında topla buluşma");

  const notes = [];

  for (const row of formations) {
    notes.push(`${row.team} sahaya ${row.formation} dizilişiyle çıktı.`);
  }

  if (possession && isNumber(possession.home) && Math.abs(possession.home - possession.away) >= 20) {
    const dominant = possession.home > possession.away ? match.homeTeam : match.awayTeam;
    const other = possession.home > possession.away ? match.awayTeam : match.homeTeam;
    notes.push(`${dominant} topu elinde tutarken ${other} derin blokta savunma yapmayı tercih etti.`);
  }

  if (clearances && isNumber(clearances.home) && isNumber(clearances.away)) {
    const high = clearances.home >= clearances.away ? { team: match.homeTeam, value: clearances.home } : { team: match.awayTeam, value: clearances.away };
    if (high.value >= 25) {
      notes.push(`${high.team} ${high.value} uzaklaştırma yaptı; bu, uzun süre kendi yarı alanında baskı altında kaldığını gösteriyor.`);
    }
  }

  if (boxTouches && isNumber(boxTouches.home) && isNumber(boxTouches.away)) {
    const leader = boxTouches.home >= boxTouches.away ? match.homeTeam : match.awayTeam;
    notes.push(`Rakip ceza sahasında topla buluşmada ${leader} önde (${boxTouches.home}-${boxTouches.away}); hücum yükü bu tarafta toplandı.`);
  }

  if (crosses && isNumber(crosses.home) && isNumber(crosses.away) && Math.max(crosses.home, crosses.away) >= 20) {
    const leader = crosses.home >= crosses.away ? match.homeTeam : match.awayTeam;
    notes.push(`${leader} ${Math.max(crosses.home, crosses.away)} orta denedi; kanat merkezli bir kırma tercihi öne çıktı.`);
  }

  if (duels && isNumber(duels.home) && isNumber(duels.away)) {
    const leader = duels.home >= duels.away ? match.homeTeam : match.awayTeam;
    notes.push(`İkili mücadelelerde ${leader} üstün geldi (${duels.home}-${duels.away}).`);
  }

  const subs = match.substitutions || [];
  if (subs.length) {
    const early = subs.filter((row) => {
      const minute = minuteOf(row);
      return minute !== null && minute <= 60;
    });
    notes.push(
      early.length >= 3
        ? `Teknik heyetler 60. dakikaya kadar ${early.length} değişiklik yaparak oyuna erken müdahale etti.`
        : `Maç boyunca ${subs.length} oyuncu değişikliği yapıldı.`
    );
  }

  if (!notes.length) {
    return {
      status: "unavailable",
      reason: `${match.homeTeam} ve ${match.awayTeam} için diziliş ve oyun yapısı verisi (formasyon, topla oynama, mücadele dağılımı) bu karşılaşmada sağlayıcı tarafından paylaşılmadı.`
    };
  }

  return { status: notes.length >= 3 ? "ready" : "partial", notes };
}

// ── 5. Maçın kırılma anları ─────────────────────────────────────────────────
function buildTurningPoints(match) {
  const events = (match.events || []).filter((event) => event && (event.type || event.detail));
  if (!events.length) {
    return {
      status: "unavailable",
      reason: `${match.homeTeam} - ${match.awayTeam} maçının olay akışı sağlayıcı tarafından paylaşılmadı.`
    };
  }

  const weighted = events.map((event) => {
    let weight = 1;
    if (isType(event, "kırmızı")) weight = 10;
    else if (isType(event, "penaltı")) weight = 8;
    else if (isType(event, "gol")) weight = 7;
    else if (isType(event, "direk")) weight = 4;
    else if (isType(event, "kurtarış")) weight = 3;
    else if (isType(event, "sarı")) weight = 2;
    return { event, weight, minute: minuteOf(event) };
  });

  const picked = weighted
    .filter((row) => row.weight >= 3)
    .sort((left, right) => right.weight - left.weight || (left.minute || 0) - (right.minute || 0))
    .slice(0, 5)
    .sort((left, right) => (left.minute || 0) - (right.minute || 0));

  const chosen = picked.length ? picked : weighted.slice(0, 3);

  return {
    status: picked.length ? "ready" : "partial",
    moments: chosen.map((row) => ({
      minute: row.minute === null ? "-" : `${row.minute}'`,
      team: eventTeamName(row.event),
      type: eventLabel(row.event),
      // Okuyucunun aradığı şey olayın türü değil, KİM: detay alanına önce
      // oyuncu adı yazılır, ad çıkarılamıyorsa sağlayıcının metni kalır.
      detail: eventDetailText(row.event),
      pivotal: row.weight >= 7
    }))
  };
}

// ── 5a. Devre analizleri, teknik kararlar ve nihai değerlendirme ────────────

/** Olayın hangi devreye ait olduğu. 45+2 birinci, 46 ikinci devre. */
function halfOf(event) {
  const raw = String((event && event.time) || "").match(/(\d+)(?:\s*\+\s*(\d+))?/);
  if (!raw) return null;
  return Number(raw[1]) <= 45 ? 1 : 2;
}

function eventsInHalf(match, half) {
  return (match.events || []).filter((event) => halfOf(event) === half);
}

/**
 * API-Football değişiklik olaylarını `type: "subst"` ile gönderiyor.
 * Yalnızca Türkçe karşılıkları arayan eski kontrol bu olayları hiç
 * görmüyordu ve teknik karar bölümü sağlayıcı veri verse bile boş
 * kalıyordu.
 */
function isSubstitution(event) {
  return isType(event, "subst", "oyuncu değişikliği", "değişiklik", "substitution", "oyuncu degisikligi");
}

function halftimeScore(match) {
  const score = match.score || {};
  return isNumber(score.halftimeHome) && isNumber(score.halftimeAway)
    ? { home: score.halftimeHome, away: score.halftimeAway }
    : null;
}

/**
 * Olay yoğunluğundan tempo okuması. Bu TÜRETİLMİŞ bir ölçü ve öyle
 * yazılıyor: "kayıtlı olay sayısı" diyor, "maç hızlıydı" demiyor.
 */
function rhythmNote(count, half) {
  const label = half === 1 ? "İlk yarı" : "İkinci yarı";
  if (count >= 6) return `${label} kayıtlı olay bakımından yoğun geçti (${count} olay).`;
  if (count >= 3) return `${label} dengeli bir olay akışı üretti (${count} olay).`;
  if (count > 0) return `${label} az sayıda kayıtlı olay üretti (${count} olay).`;
  return null;
}

/**
 * DEVRE ANALİZİ — yalnızca o devrenin doğrulanmış olaylarından ve devre
 * arası skorundan.
 *
 * Olay akışı yoksa ve devre arası skoru da yoksa bölüm ÜRETİLMEZ. İkisinden
 * biri varsa üretilir ve neyin ölçüldüğü açıkça yazılır — "ilk yarı dengeli
 * geçti" gibi hiçbir veriye dayanmayan cümle kurulmaz.
 */
function buildHalfAnalysis(match, half) {
  const events = eventsInHalf(match, half);
  const halftime = halftimeScore(match);
  const full = match.score || {};
  const label = half === 1 ? "İlk yarı" : "İkinci yarı";

  if (!events.length && !halftime) {
    return {
      status: "unavailable",
      half,
      reason: `${label} için dakikalı olay akışı ve devre arası skoru sağlayıcı tarafından sunulmadı.`
    };
  }

  const notes = [];
  const goals = events.filter((event) => isType(event, "gol") && !isType(event, "iptal"));
  const cards = events.filter((event) => isType(event, "kart"));
  const subs = events.filter(isSubstitution);

  // Devre skoru: ilk yarı doğrudan, ikinci yarı toplam eksi ilk yarı.
  if (half === 1 && halftime) {
    notes.push(`Devre arasına ${match.homeTeam} ${halftime.home}-${halftime.away} ${match.awayTeam} skoruyla gidildi.`);
  } else if (half === 2 && halftime && isNumber(full.home) && isNumber(full.away)) {
    const secondHalf = { home: full.home - halftime.home, away: full.away - halftime.away };
    notes.push(secondHalf.home + secondHalf.away === 0
      ? "İkinci yarıda skor değişmedi; sonucu belirleyen goller ilk yarıda gelmişti."
      : `İkinci yarının skoru ${secondHalf.home}-${secondHalf.away} oldu.`);
  }

  const rhythm = rhythmNote(events.length, half);
  if (rhythm) notes.push(rhythm);

  for (const goal of goals) {
    const scorer = playerFromEvent(goal);
    // Etiket Türkçeleştirilir: sağlayıcı kaydında `detail` "Normal Goal"
    // olduğu için satır sonunda ham İngilizce metin kalıyordu.
    notes.push(`${minuteOf(goal)}' ${eventTeamName(goal)}${scorer ? ` — ${scorer}` : ""}: ${eventLabel(goal).toLocaleLowerCase("tr-TR")}`);
  }

  for (const card of cards) {
    notes.push(`${minuteOf(card)}' ${eventTeamName(card)} ${String(card.type).toLocaleLowerCase("tr-TR")}${card.detail ? ` — ${card.detail}` : ""}`);
  }

  // Kaçan pozisyon ve kurtarışlar, gol olmadan da devrenin yönünü gösterir.
  const chances = events.filter((event) => isType(event, "direk", "kurtarış", "kaçan", "şut"));
  if (chances.length) {
    notes.push(`Kayda geçen diğer pozisyonlar: ${chances.map((event) =>
      `${minuteOf(event)}' ${eventTeamName(event)} ${String(event.type).toLocaleLowerCase("tr-TR")}`).join(", ")}.`);
  }

  if (subs.length) {
    notes.push(`${label} içinde ${subs.length} oyuncu değişikliği kaydedildi.`);
  }

  return {
    status: notes.length ? "ready" : "partial",
    half,
    eventCount: events.length,
    goals: goals.length,
    // Eldeki kanıt sınırlıysa okuyucu bunu bilmeli.
    evidence: events.length ? "events" : "halftime-score",
    notes
  };
}

/**
 * TEKNİK KARARLAR — oyuncu değişiklikleri ve dizilişler.
 *
 * Sağlayıcı değişiklik olayı vermiyorsa bölüm üretilmez. Bir teknik
 * direktörün "hamlesi" hakkında, hamlenin ne olduğunu bilmeden cümle
 * kurmak uydurmadır.
 */
function buildCoachingDecisions(match) {
  const subs = (match.events || []).filter(isSubstitution);
  const formations = (match.lineups || [])
    .map((lineup) => ({
      team: lineup.team || lineup.teamName || "",
      formation: lineup.formation || null
    }))
    .filter((entry) => entry.formation);

  if (!subs.length && !formations.length) {
    return {
      status: "unavailable",
      reason: "Oyuncu değişikliği akışı ve diziliş bilgisi sağlayıcı tarafından sunulmadı."
    };
  }

  const notes = [];

  for (const entry of formations) {
    notes.push(`${entry.team} maça ${entry.formation} dizilişiyle başladı.`);
  }

  // Değişiklik sonrası ne olduğu YALNIZCA aynı takımın sonraki olaylarından
  // okunur; "hamle tuttu" yorumu kanıta bağlanır.
  const ordered = subs.slice().sort((left, right) => (numericMinute(left) || 0) - (numericMinute(right) || 0));

  for (const sub of ordered) {
    const minute = numericMinute(sub);
    const team = eventTeamName(sub);
    const after = (match.events || []).filter((event) =>
      numericMinute(event) !== null && numericMinute(event) > minute &&
      normalizeText(eventTeamName(event)) === normalizeText(team) &&
      isType(event, "gol", "direk", "şut", "kurtarış"));

    notes.push(`${minuteOf(sub)}' ${team} değişikliği${sub.detail ? ` (${sub.detail})` : ""}.` +
      (after.length
        ? ` Değişiklikten sonra ${team} adına ${after.length} pozisyon kaydedildi — eldeki veri hamlenin ardından hücum üretiminin sürdüğünü gösteriyor.`
        : " Değişiklikten sonra bu takım adına kayda geçen pozisyon yok."));
  }

  return {
    status: "ready",
    substitutionCount: subs.length,
    formations,
    notes,
    // Yorum ile ölçüm ayrımı okuyucuya açıkça bildirilir.
    interpretation: subs.length
      ? "Değişikliklerin etkisi, yalnızca sonrasında kayda geçen olaylara bakılarak değerlendirildi."
      : "Diziliş bilgisi doğrulandı; değişiklik akışı sağlayıcıdan gelmediği için hamle değerlendirmesi yapılmadı."
  };
}

/**
 * NİHAİ DEĞERLENDİRME — sonucu neyin belirlediği.
 *
 * Her cümle ya skora, ya olaya ya da ölçülmüş bir istatistiğe bağlanır.
 * Hiçbiri yoksa bölüm üretilmez.
 */
function buildFinalAssessment(match) {
  const result = outcome(match);
  const score = scoreLine(match);

  if (!result || !score) {
    return { status: "unavailable", reason: "Maç sonucu doğrulanmadığı için değerlendirme üretilmedi." };
  }

  const shots = statPair(match, "Toplam şut");
  const onTarget = statPair(match, "İsabetli şut");
  const possession = statPair(match, "Topla oynama");
  const xg = statPair(match, "Gol beklentisi (xG)");
  const goals = goalEvents(match);

  const verdict = [];
  const strengths = [];
  const improvements = [];

  if (result.draw) {
    verdict.push(`Maç ${score} berabere bitti.`);
  } else {
    verdict.push(`${result.winner}, ${accusative(result.loser)} ${score} yendi.`);
  }

  // Kazananın üstünlüğü hangi ölçüde göründü?
  if (onTarget && result.winner) {
    const winnerIsHome = normalizeText(result.winner) === normalizeText(match.homeTeam);
    const winnerOn = winnerIsHome ? onTarget.home : onTarget.away;
    const loserOn = winnerIsHome ? onTarget.away : onTarget.home;
    if (isNumber(winnerOn) && isNumber(loserOn)) {
      verdict.push(winnerOn > loserOn
        ? `İsabetli şutta da öndeydi (${winnerOn}-${loserOn}); sonuç üretilen pozisyonla uyumlu.`
        : `İsabetli şutta geride kalmasına rağmen kazandı (${winnerOn}-${loserOn}); eldeki veri sonucun verimlilikle geldiğini gösteriyor.`);
    }
  }

  if (xg && isNumber(xg.home) && isNumber(xg.away) && isNumber(match.score.home) && isNumber(match.score.away)) {
    const homeDiff = match.score.home - xg.home;
    const awayDiff = match.score.away - xg.away;
    const overachiever = homeDiff > awayDiff ? match.homeTeam : match.awayTeam;
    const diff = Math.max(homeDiff, awayDiff);
    if (Math.abs(diff) >= 0.5) {
      verdict.push(`${overachiever}, gol beklentisinin ${tr(Math.abs(diff), 2)} üzerinde skor üretti.`);
    }
  }

  if (possession && isNumber(possession.home) && isNumber(possession.away)) {
    const dominant = possession.home > possession.away ? match.homeTeam : match.awayTeam;
    const share = Math.max(possession.home, possession.away);
    strengths.push(`${dominant} topa daha çok sahip oldu (%${tr(share, 0)}).`);
  }

  if (shots && isNumber(shots.home) && isNumber(shots.away)) {
    const moreShots = shots.home > shots.away ? match.homeTeam : match.awayTeam;
    strengths.push(`${moreShots} daha çok şut denedi (${shots.home}-${shots.away}).`);
  }

  if (onTarget && shots && isNumber(onTarget.home) && isNumber(shots.home) && shots.home > 0 &&
    isNumber(onTarget.away) && isNumber(shots.away) && shots.away > 0) {
    const homeAccuracy = (onTarget.home / shots.home) * 100;
    const awayAccuracy = (onTarget.away / shots.away) * 100;
    const weaker = homeAccuracy < awayAccuracy ? match.homeTeam : match.awayTeam;
    improvements.push(`${weaker} şut isabetinde geride kaldı (%${tr(Math.min(homeAccuracy, awayAccuracy), 0)}); bitiricilik geliştirilmesi gereken alan.`);
  }

  if (result.loser && goals.length) {
    const conceded = goals.filter((event) => normalizeText(eventTeamName(event)) !== normalizeText(result.loser));
    const lateConceded = conceded.filter((event) => (numericMinute(event) || 0) >= LATE_GAME_FROM);
    if (lateConceded.length) {
      improvements.push(`${result.loser} son bölümde ${lateConceded.length} gol yedi; maç sonu konsantrasyonu öne çıkan sorun.`);
    }
  }

  const reds = (match.events || []).filter((event) => isType(event, "kırmızı"));
  if (reds.length) {
    improvements.push(`Kırmızı kart maçın seyrini etkiledi (${reds.map((event) => `${minuteOf(event)}' ${eventTeamName(event)}`).join(", ")}).`);
  }

  return {
    status: verdict.length ? "ready" : "partial",
    verdict,
    strengths,
    improvements,
    // Ölçülmüş istatistik yoksa değerlendirme yalnızca skora ve olaylara
    // dayanır; okuyucu bunu bilmeli.
    basis: shots || possession || onTarget ? "statistics+events" : "events-only",
    closing: result.draw
      ? `${score} beraberlik, iki takımın da üstünlük kuramadığı bir maçın sonucu.`
      : `${result.winner} sahadan ${result.margin} farkla ayrıldı.`
  };
}

// ── 5b. Son bölüm ve bitiş şekli ────────────────────────────────────────────

/** Son bölüm sınırı. 75. dakika ve sonrası "maç sonu" sayılır. */
const LATE_GAME_FROM = 75;

/**
 * Sıralanabilir dakika: "90+3" → 93. `minuteOf` uzatma bilgisini metin
 * olarak koruduğu için (okuyucu "90+3" görmeli) karşılaştırma ayrı yapılır.
 */
function numericMinute(event) {
  const raw = String((event && event.time) || "").match(/(\d+)(?:\s*\+\s*(\d+))?/);
  if (!raw) return null;
  return Number(raw[1]) + (raw[2] ? Number(raw[2]) : 0);
}

/**
 * MAÇ SONU DEĞİŞİMİ — 75. dakika ve sonrası.
 *
 * Yalnızca gerçek olay akışından üretilir. Olay yoksa bölüm "unavailable"
 * döner ve sunum katmanı sağlayıcının bu veriyi vermediğini yazar; boş bir
 * "son bölümde bir şey olmadı" cümlesi kurulmaz — olay akışı olmayan bir
 * maçta o cümle ölçüme değil bilgisizliğe dayanır.
 *
 * Olay akışı VAR ama son bölümde olay YOKSA bu ölçülmüş bir bulgudur ve
 * öyle yazılır: maçın son çeyreği olaysız geçmiştir.
 */
function buildLateGame(match) {
  const events = (match.events || []).filter((event) => event && numericMinute(event) !== null);

  if (!events.length) {
    return {
      status: "unavailable",
      from: LATE_GAME_FROM,
      reason: `${match.homeTeam} - ${match.awayTeam} maçının dakikalı olay akışı sağlayıcı tarafından sunulmadı.`
    };
  }

  const late = events.filter((event) => numericMinute(event) >= LATE_GAME_FROM);

  if (!late.length) {
    return {
      status: "ready",
      from: LATE_GAME_FROM,
      moments: [],
      goals: { home: 0, away: 0 },
      verdict: `Maçın son ${90 - LATE_GAME_FROM} dakikasında kayıtlı bir gol, kart ya da kırılma anı yok; sonuç bu bölüme girilmeden belirlenmiş.`
    };
  }

  const lateGoals = late.filter((event) => isType(event, "gol") && !isType(event, "iptal"));
  const homeLateGoals = lateGoals.filter((event) => normalizeText(eventTeamName(event)) === normalizeText(match.homeTeam)).length;
  const awayLateGoals = lateGoals.length - homeLateGoals;

  const moments = late
    .sort((left, right) => numericMinute(left) - numericMinute(right))
    .map((event) => ({
      minute: `${minuteOf(event)}'`,
      team: eventTeamName(event),
      // Kırılma anlarıyla aynı sözleşme: Türkçe etiket + oyuncu adı.
      type: eventLabel(event),
      detail: eventDetailText(event),
      decisive: isType(event, "gol", "kırmızı", "penaltı")
    }));

  const parts = [];
  if (lateGoals.length) {
    const scorers = lateGoals.map((event) => playerFromEvent(event)).filter(Boolean);
    parts.push(`Son bölümde ${lateGoals.length} gol kaydedildi`);
    if (scorers.length) parts.push(`(${[...new Set(scorers)].join(", ")})`);
  }

  const lateReds = late.filter((event) => isType(event, "kırmızı")).length;
  if (lateReds) parts.push(`${lateReds} kırmızı kart bu bölümde görüldü`);

  // Skor farkı son bölümdeki gollerle kapanıyor mu? Yalnızca skor da,
  // goller de ölçülmüşse yazılır.
  const result = outcome(match);
  if (result && !result.draw && lateGoals.length && result.margin <= lateGoals.length) {
    parts.push(`sonucu belirleyen fark bu bölümde oluştu`);
  }

  if (!parts.length) {
    parts.push(`Son bölümde ${late.length} olay kaydedildi, gol yok`);
  }

  return {
    status: "ready",
    from: LATE_GAME_FROM,
    moments,
    goals: { home: homeLateGoals, away: awayLateGoals },
    verdict: `${parts.join(", ")}.`
  };
}

/**
 * BİTİŞ ŞEKLİ — normal süre / uzatma / penaltılar.
 *
 * Durum kodundan okunur (FT/AET/PEN), uydurulmaz. Uzatmaya giden bir maçta
 * "normal sürede bitti" yazmak, sağlayıcının verdiği bilgiyi silmek olurdu.
 */
function buildFinish(match) {
  const type = finishType(match);
  const label = finishLabel(match);
  const extraTimeEvents = (match.events || []).filter((event) => {
    const minute = numericMinute(event);
    return minute !== null && minute > 90;
  });

  return {
    status: "ready",
    type,
    label,
    wentToExtraTime: type !== "regular",
    decidedOnPenalties: type === "penalties",
    extraTimeEventCount: extraTimeEvents.length
  };
}

// ── 6. AI puanlaması ────────────────────────────────────────────────────────
/**
 * Takım performans puanı yalnızca ölçülmüş istatistiklerden hesaplanır.
 * İstatistik yoksa puan üretilmez (null döner) — oyuncu rating'lerinde
 * uygulanan "veri yoksa puan yok" kuralının maç seviyesindeki karşılığı.
 */
function buildAiRating(match) {
  const stats = match.statistics || [];
  const score = match.score || {};
  if (!stats.length || !isNumber(score.home) || !isNumber(score.away)) {
    return {
      status: "unavailable",
      reason: `Performans puanı yalnızca doğrulanmış istatistiklerden hesaplanır; ${match.homeTeam} - ${match.awayTeam} maçının istatistik dökümü henüz yok.`
    };
  }

  const possession = statPair(match, "Topla oynama");
  const shots = statPair(match, "Toplam şut");
  const onTarget = statPair(match, "İsabetli şut");
  const xg = statPair(match, "Gol beklentisi (xG)");
  const passAccuracy = statPair(match, "Pas isabeti");

  function sideScore(side, opponent) {
    const parts = [];
    const weights = [];

    if (possession && isNumber(possession[side])) {
      parts.push(Math.min(100, possession[side] * 1.25));
      weights.push(15);
    }
    if (shots && isNumber(shots[side])) {
      parts.push(Math.min(100, shots[side] * 6));
      weights.push(20);
    }
    if (onTarget && isNumber(onTarget[side])) {
      parts.push(Math.min(100, onTarget[side] * 14));
      weights.push(20);
    }
    if (xg && isNumber(xg[side])) {
      parts.push(Math.min(100, xg[side] * 42));
      weights.push(25);
    }
    if (passAccuracy && isNumber(passAccuracy[side])) {
      parts.push(passAccuracy[side]);
      weights.push(10);
    }

    const goals = score[side];
    const conceded = score[opponent];
    if (isNumber(goals) && isNumber(conceded)) {
      const margin = goals - conceded;
      parts.push(Math.max(0, Math.min(100, 50 + margin * 18)));
      weights.push(30);
    }

    if (!parts.length) return null;
    const total = weights.reduce((sum, value) => sum + value, 0);
    const weighted = parts.reduce((sum, value, index) => sum + value * weights[index], 0);
    return Math.round(weighted / total);
  }

  const homeScore = sideScore("home", "away");
  const awayScore = sideScore("away", "home");
  if (homeScore === null || awayScore === null) {
    return { status: "unavailable", reason: "Puan için yeterli ölçülmüş istatistik yok." };
  }

  // Kaç ayrı metrik hesaba girdi -> güven göstergesi
  const available = ["Topla oynama", "Toplam şut", "İsabetli şut", "Gol beklentisi (xG)", "Pas isabeti"]
    .filter((type) => statPair(match, type)).length;
  const confidence = Math.round((available / 5) * 100);

  return {
    status: "ready",
    home: { team: match.homeTeam, score: homeScore },
    away: { team: match.awayTeam, score: awayScore },
    confidence,
    basis: `Puan; topla oynama, şut, isabetli şut, xG, pas isabeti ve skor farkından ağırlıklı olarak hesaplandı (${available}/5 metrik mevcut).`
  };
}

// ── 7. Sonraki maç öngörüsü ─────────────────────────────────────────────────
function buildNextMatchOutlook(match, context) {
  const fixtures = (context && context.fixtures) || [];
  const played = new Date(match.kickoff || match.date || 0).getTime();
  const result = outcome(match);

  function nextFor(team) {
    return fixtures
      .filter((row) => {
        if (normalizeText(row.id) === normalizeText(match.id)) return false;
        const when = new Date(row.kickoff || row.date || 0).getTime();
        if (!Number.isFinite(when) || when <= played) return false;
        return normalizeText(row.homeTeam) === normalizeText(team) || normalizeText(row.awayTeam) === normalizeText(team);
      })
      .sort((left, right) => new Date(left.kickoff).getTime() - new Date(right.kickoff).getTime())[0] || null;
  }

  const entries = [];
  for (const team of [match.homeTeam, match.awayTeam]) {
    const next = nextFor(team);
    const won = result && !result.draw && normalizeText(result.winner) === normalizeText(team);
    const lost = result && !result.draw && normalizeText(result.loser) === normalizeText(team);
    const form = won ? "galibiyetin moraliyle" : lost ? "mağlubiyetin ardından" : "beraberliğin ardından";

    if (!next) {
      entries.push({
        team,
        status: "unavailable",
        text: `${team} için doğrulanmış bir sonraki karşılaşma henüz takvimde yok; fikstür açıklandığında bu alan güncellenecek.`
      });
      continue;
    }

    const opponent = normalizeText(next.homeTeam) === normalizeText(team) ? next.awayTeam : next.homeTeam;
    const homeAway = normalizeText(next.homeTeam) === normalizeText(team) ? "sahasında" : "deplasmanda";
    const date = String(next.kickoff || next.date || "").slice(0, 10);
    entries.push({
      team,
      status: "ready",
      opponent,
      date,
      text: `${team}, ${form} ${formatTrDate(next.kickoff || next.date)} tarihinde ${homeAway} ${opponent} ile karşılaşacak.`
    });
  }

  const ready = entries.filter((entry) => entry.status === "ready");
  const status = ready.length ? (ready.length === entries.length ? "ready" : "partial") : "unavailable";
  return {
    status,
    entries,
    // Diğer bölümlerle aynı sözleşme: "unavailable" ise gerekçe yazılır.
    reason: status === "unavailable"
      ? "İki takım için de doğrulanmış bir sonraki karşılaşma takvimde yok; fikstür açıklandığında bu bölüm otomatik dolar."
      : undefined,
    note: "Öngörü, doğrulanmış fikstür ve bu maçın sonucuna dayanır; skor tahmini içermez."
  };
}

// ── SEO ─────────────────────────────────────────────────────────────────────
/**
 * BAŞLIK VE AÇIKLAMA — ne olduğunu söyleyen, ne vaat ettiğini de söyleyen.
 *
 * ESKİ BAŞLIK her maç için aynı kalıptaydı:
 *
 *     "Çaykur Rizespor 1-2 Hull City Maç Raporu ve İstatistikleri | FutbolRadar"
 *
 * Skor dışında hiçbir ayırt edici bilgi yok: turnuva yok, tarih yok, maçın
 * neyle ilgili olduğuna dair bir işaret yok. Arama sonucunda yan yana duran
 * iki FutbolRadar bağlantısı birbirinden ayırt edilemiyor ve tıklamayı
 * yalnızca takım adları taşıyor.
 *
 * YENİ BAŞLIK turnuvayı da taşır. Uzunluk sınırı (120) yüzünden turnuva
 * ancak sığdığında eklenir — kırpılmış bir başlık, eksik bir başlıktan kötü.
 *
 * AÇIKLAMA da kalıp bir virgül listesiydi. Artık maçın KENDİ cümlesiyle
 * başlıyor: `summary.paragraph` gerçek olay ve istatistikten üretilmiş
 * metindir. Kalıp liste yalnızca o cümle yokken devreye girer.
 *
 * UYDURMA YOK: buraya giren her parça kayıttan gelir. Skor yoksa skor
 * yazılmaz, turnuva yoksa turnuva yazılmaz, özet yoksa özet cümlesi olmaz.
 */
function buildSeo(match, summary) {
  const score = scoreLine(match) || "";
  const competition = match.league || "Futbol";
  const strip = score ? `${match.homeTeam} ${score} ${match.awayTeam}` : `${match.homeTeam} - ${match.awayTeam}`;

  // Turnuva adı ancak sınıra sığıyorsa eklenir.
  const brand = " | FutbolRadar";
  const base = `${strip} maç raporu`;
  const withCompetition = match.league ? `${base}: ${match.league} istatistikleri` : `${base} ve istatistikleri`;
  const title = `${withCompetition}${brand}`.length <= 120
    ? `${withCompetition}${brand}`
    : `${base}${brand}`;

  let description = "";

  // 1. Maçın kendi cümlesi. En bilgilendirici seçenek bu.
  if (summary.status === "ready" && String(summary.paragraph || "").trim()) {
    const sentence = String(summary.paragraph).trim();
    const firstStop = sentence.match(/^[\s\S]*?[.!?](?=\s|$)/);
    description = String(firstStop ? firstStop[0] : sentence).trim();
  }

  // 2. Cümle yoksa (ya da çok kısaysa) doğrulanabilir ayrıntılarla kurulur.
  if (description.length < 60) {
    const parts = [`${strip} maç raporu`];

    const goals = goalEvents(match)
      .map((event) => playerFromEvent(event))
      .filter(Boolean);
    if (goals.length) parts.push(`goller: ${[...new Set(goals)].join(", ")}`);
    if ((match.statistics || []).length) parts.push("xG, şut ve pas istatistikleri");
    parts.push("kırılma anları ve sonraki maç");

    description = `${parts.join(", ")}.`;
  }

  if (description.length > 158) description = `${description.slice(0, 155).replace(/[\s,;:]+$/, "")}...`;

  const dateStamp = String(match.kickoff || match.date || "").slice(0, 10);
  const path = match.analysisPage || `mac-raporu/${slug(match.homeTeam)}-${slug(match.awayTeam)}-${dateStamp}.html`;

  return { title, description, path, competition };
}

/** Tüm bölümleri tek raporda toplar. */
function buildMatchReport(match, context) {
  // FT/AET/PEN dahil tüm tamamlanmış maçlar rapor üretir; hükmen sonuçlar
  // (oynanmamış maç) üretmez.
  if (!isAnalyzableMatch(match)) {
    return null;
  }

  const seed = seedFrom(match.id || `${match.homeTeam}-${match.awayTeam}`);
  const summary = buildSummary(match, seed);
  const sections = {
    summary,
    standoutPlayers: buildStandoutPlayers(match),
    momentum: buildMomentum(match),
    signals: buildSignals(match),
    statistics: buildStatisticsAnalysis(match, seed),
    tactical: buildTacticalRead(match),
    firstHalf: buildHalfAnalysis(match, 1),
    secondHalf: buildHalfAnalysis(match, 2),
    turningPoints: buildTurningPoints(match),
    lateGame: buildLateGame(match),
    finish: buildFinish(match),
    coaching: buildCoachingDecisions(match),
    finalAssessment: buildFinalAssessment(match),
    aiRating: buildAiRating(match),
    nextMatch: buildNextMatchOutlook(match, context)
  };

  // `finish` durum kodundan okunuyor ve her zaman "ready"; kapsama oranına
  // katılsa ölçülmüş veri yokken bile oranı yukarı çekerdi.
  const measured = Object.entries(sections).filter(([key]) => key !== "finish");
  const readyCount = measured.filter(([, section]) => section.status === "ready").length;
  const coverage = Math.round((readyCount / measured.length) * 100);

  return {
    matchId: match.id,
    generatedAt: (context && context.generatedAt) || null,
    seo: buildSeo(match, summary),
    sections,
    coverage,
    dataStatus: coverage >= 70 ? "complete" : coverage >= 35 ? "partial" : "minimal"
  };
}

module.exports = {
  LATE_GAME_FROM,
  buildCoachingDecisions,
  buildFinalAssessment,
  buildFinish,
  buildHalfAnalysis,
  buildLateGame,
  buildMatchReport,
  buildSummary,
  buildStandoutPlayers,
  buildStatisticsAnalysis,
  buildMomentum,
  buildSignals,
  buildTacticalRead,
  buildTurningPoints,
  buildAiRating,
  buildNextMatchOutlook,
  buildSeo,
  accusative,
  dative,
  locative,
  slug
};
