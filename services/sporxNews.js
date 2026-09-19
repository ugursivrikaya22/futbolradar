/**
 * SPORX KEŞİF HATTI — ÖNCELİK, GÜVEN VE ÖZGÜN YENİDEN YAZIM.
 *
 * NEDEN BU DOSYA VAR. Sporx bir haber KEŞİF kaynağıdır, bir içerik
 * kaynağı değil (bkz. docs/sporx-news-pipeline.md). Bu modül üç ayrı işi
 * TEK yerde toplar, çünkü üçü de aynı editoryal kararın parçası:
 *
 *   1. ÖNCELİK — hangi haber hangi sırada işlenir (Galatasaray/Fenerbahçe/
 *      Beşiktaş/Trabzonspor → Süper Lig → Millî Takım → transfer →
 *      Avrupa). `services/newsTicker.js`'teki `editorialRank` mantığıyla
 *      aynı hiyerarşiyi kullanır ama görev tanımındaki sekiz kademeli
 *      sırayı birebir uygular.
 *   2. GÜVEN — Sporx TEK BAŞINA "resmî" sayılmaz. `services/sourceTrust.js`
 *      Sporx'i zaten YÜKSEK GÜVEN kademesine bile almıyor (bkz. o dosyanın
 *      başındaki gerekçe: geçmişte Sporx kaynaklı bir transfer yanlışlıkla
 *      "Resmî" rozetiyle yayımlanmıştı). Bu modül de aynı kuralı uygular:
 *      Sporx'ten gelen hiçbir kayıt tek başına `confirmed` güven kazanamaz;
 *      yalnızca sitenin KENDİ doğrulanmış verisiyle (`data/transfers.json`
 *      → `status: "confirmed"`) örtüşüyorsa yükselir.
 *   3. YENİDEN YAZIM — Sporx'in başlığı ve metni ASLA kopyalanmaz. Bu
 *      modül yalnızca OLAYI (takım, oyuncu adı adayı, tutar, olay türü)
 *      çıkarır ve tamamen farklı bir cümle kalıbıyla yeniden yazar. Kaynak
 *      atfı ayrı bir alanda (`sources`) açıkça durur; gövde metninde de
 *      "Sporx'in haberine göre" ifadesiyle şeffaf biçimde belirtilir.
 */

const { normalizeText } = require("../api/_utils");
const {
  BIG_FOUR,
  CONFIRMATION_VERBS,
  HEDGE_MARKERS,
  isEuropeanCompetition
} = require("./newsTicker.js");
const { majorClubNames } = require("./majorClubs.js");

/** Görev tanımındaki sekiz kademeli öncelik sırası. Küçük sayı önce işlenir. */
const PRIORITY = Object.freeze({
  GALATASARAY: 0,
  FENERBAHCE: 1,
  BESIKTAS: 2,
  TRABZONSPOR: 3,
  SUPER_LIG: 4,
  MILLI_TAKIM: 5,
  TRANSFER: 6,
  AVRUPA: 7
});

const PRIORITY_LABELS = Object.freeze({
  [PRIORITY.GALATASARAY]: "Galatasaray",
  [PRIORITY.FENERBAHCE]: "Fenerbahçe",
  [PRIORITY.BESIKTAS]: "Beşiktaş",
  [PRIORITY.TRABZONSPOR]: "Trabzonspor",
  [PRIORITY.SUPER_LIG]: "Süper Lig",
  [PRIORITY.MILLI_TAKIM]: "Türkiye Milli Takımı",
  [PRIORITY.TRANSFER]: "Transfer Gündemi",
  [PRIORITY.AVRUPA]: "Avrupa Futbolu"
});

/** Diğer Süper Lig kulüpleri (dört büyükler hariç) — serbest metinde arama için. */
const OTHER_SUPER_LIG_CLUBS = [
  "Göztepe", "Samsunspor", "Kasımpaşa", "Eyüpspor", "Antalyaspor", "Konyaspor",
  "Alanyaspor", "Çaykur Rizespor", "Gençlerbirliği", "Kocaelispor", "Gaziantep FK",
  "Çorum FK", "Karagümrük", "Fatih Karagümrük", "Kayserispor", "Sivasspor"
];

const MILLI_TAKIM_HINTS = [
  "milli takim", "a milli takim", "ay yildizlilar", "ay-yildizlilar", "tff",
  "montella", "u21 milli takim", "u19 milli takim"
];

const TRANSFER_HINTS = ["transfer", "bonservis", "kirali", "imza"];

function text(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

/** Kelime sınırlı, aksan-duyarsız arama. */
function containsWord(haystackNormalized, phrase) {
  const needle = normalizeText(phrase);
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(haystackNormalized);
}

function matchesAny(haystackNormalized, phrases) {
  return phrases.some((phrase) => containsWord(haystackNormalized, phrase));
}

/**
 * Bir Sporx adayının bu görev kapsamına GİRİP GİRMEDİĞİNİ ve hangi
 * öncelik kademesinde olduğunu belirler. Kapsam dışı adaylar `null` döner
 * ve işlenmez — görev tanımı yalnızca sekiz kategoriyi listeliyor,
 * "diğer her şey" bir kategori değil.
 */
function classifyCandidate(candidate) {
  const haystack = normalizeText(`${text(candidate && candidate.title)} ${text(candidate && candidate.summary)}`);
  if (!haystack) return null;

  if (containsWord(haystack, "galatasaray") || containsWord(haystack, "g.saray")) {
    return { rank: PRIORITY.GALATASARAY, category: PRIORITY_LABELS[PRIORITY.GALATASARAY], team: "Galatasaray" };
  }
  if (containsWord(haystack, "fenerbahce") || containsWord(haystack, "fenerbahçe")) {
    return { rank: PRIORITY.FENERBAHCE, category: PRIORITY_LABELS[PRIORITY.FENERBAHCE], team: "Fenerbahçe" };
  }
  if (containsWord(haystack, "besiktas") || containsWord(haystack, "bjk")) {
    return { rank: PRIORITY.BESIKTAS, category: PRIORITY_LABELS[PRIORITY.BESIKTAS], team: "Beşiktaş" };
  }
  if (containsWord(haystack, "trabzonspor")) {
    return { rank: PRIORITY.TRABZONSPOR, category: PRIORITY_LABELS[PRIORITY.TRABZONSPOR], team: "Trabzonspor" };
  }

  // En uzun eşleşen ad tercih edilir: "Karagümrük" listede "Fatih
  // Karagümrük"ten önce geldiği için `.find()` başlıkta "Fatih Karagümrük"
  // geçse bile kısa adı döndürüyordu (bkz. Copilot incelemesi).
  const superLigClub = OTHER_SUPER_LIG_CLUBS
    .filter((club) => containsWord(haystack, club))
    .sort((a, b) => b.length - a.length)[0];
  if (superLigClub || containsWord(haystack, "super lig")) {
    return { rank: PRIORITY.SUPER_LIG, category: PRIORITY_LABELS[PRIORITY.SUPER_LIG], team: superLigClub || "Süper Lig" };
  }

  if (matchesAny(haystack, MILLI_TAKIM_HINTS)) {
    return { rank: PRIORITY.MILLI_TAKIM, category: PRIORITY_LABELS[PRIORITY.MILLI_TAKIM], team: "Türkiye" };
  }

  const majorClub = majorClubNames().find((club) => containsWord(haystack, club));
  const european = isEuropeanCompetition(haystack) || matchesAny(haystack, ["sampiyonlar ligi", "avrupa ligi", "konferans ligi"]);

  if (matchesAny(haystack, TRANSFER_HINTS) && majorClub) {
    return { rank: PRIORITY.TRANSFER, category: PRIORITY_LABELS[PRIORITY.TRANSFER], team: majorClub };
  }

  if (majorClub || european) {
    return { rank: PRIORITY.AVRUPA, category: PRIORITY_LABELS[PRIORITY.AVRUPA], team: majorClub || "Avrupa Futbolu" };
  }

  return null;
}

/** Bu öncelik kademesi ana sayfaya / kayan yazıya taşınacak kadar önemli mi? */
function isBigFourRank(rank) {
  return rank === PRIORITY.GALATASARAY || rank === PRIORITY.FENERBAHCE
    || rank === PRIORITY.BESIKTAS || rank === PRIORITY.TRABZONSPOR;
}

/**
 * OLAY TÜRÜ — yeniden yazım kalıbını seçer. Sporx'in kendi cümlesini değil,
 * yalnızca OLAYIN NE OLDUĞUNU okur.
 */
function detectEventType(haystackNormalized) {
  if (matchesAny(haystackNormalized, ["resmen acikladi", "resmi aciklama", "kap bildirimi", "imzaladi", "imzayi atti"])) {
    return "official";
  }
  if (matchesAny(haystackNormalized, ["yollari ayrildi", "yollar ayrildi", "sozlesmesi feshedildi", "ayrilik", "veda etti"])) {
    return "departure";
  }
  if (matchesAny(haystackNormalized, ["yalanladi", "gercek disi", "reddetti"])) {
    return "denial";
  }
  if (matchesAny(haystackNormalized, ["gorusme", "pazarlik", "teklif", "sicak bak", "gundem", "iddia"])) {
    return "negotiation";
  }
  if (matchesAny(haystackNormalized, ["11 belli oldu", "kadro", "ilk 11", "sakatlik", "cezali"])) {
    return "squad";
  }
  if (matchesAny(haystackNormalized, ["kazandi", "yendi", "berabere", "elendi", "tur atladi", "puan"])) {
    return "result";
  }
  return "statement";
}

/**
 * Başlıktan olası oyuncu/kişi adı adayını çıkarır: art arda iki büyük
 * harfle başlayan kelime ("Anderson Talisca" gibi). Takım adları ve genel
 * kelimeler elenir. Bulunamazsa `null` — UYDURMA YAPILMAZ, boş bırakılır.
 */
const GENERIC_CAPITALIZED = new Set([
  "Galatasaray", "Fenerbahçe", "Beşiktaş", "Trabzonspor", "Süper", "Lig",
  "Türkiye", "Milli", "Takımı", "Sporx", "UEFA", "FIFA", "TFF"
]);

/** Takım/kurum adı kökleriyle başlayan belirteçleri eler (çekim eki farketmez). */
const EXCLUDED_NAME_PREFIXES = [
  "galatasaray", "fenerbahce", "besiktas", "trabzonspor", "super", "lig",
  "turkiye", "milli", "takim", "sporx", "uefa", "fifa", "tff", "oncesi", "sonra"
].map((value) => normalizeText(value));

/** Başlıklarda sık geçen ama isim OLMAYAN büyük harfli kelimeler. */
const HEADLINE_STOPWORDS = new Set(
  ["İlk", "Son", "Yeni", "Eski", "Dev", "Flaş", "Sürpriz", "Kritik", "Resmi", "Resmî", "Transfer", "Bomba", "Peş"]
    .map((value) => normalizeText(value))
);

function isExcludedNameToken(token) {
  const normalized = normalizeText(token);
  return GENERIC_CAPITALIZED.has(token)
    || HEADLINE_STOPWORDS.has(normalized)
    || EXCLUDED_NAME_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/** Türkçe iyelik/hâl eki varsa kırpar: "Kartal'ın" → "Kartal". */
function stripTurkishSuffix(token) {
  return token.split(/['’]/)[0];
}

function extractPersonName(rawTitle) {
  const matches = String(rawTitle || "").match(/([A-ZÇĞİÖŞÜ][\p{L}'’.-]+(?:\s+[A-ZÇĞİÖŞÜ][\p{L}'’.-]+){1,2})/gu) || [];
  for (const candidate of matches) {
    const tokens = candidate.split(/\s+/).filter(Boolean).filter((token) => !isExcludedNameToken(token));
    if (!tokens.length) continue;
    if (tokens.length === 1 && tokens[0].length < 3) continue;
    return tokens.map(stripTurkishSuffix).join(" ");
  }
  return null;
}

/** Para tutarı adayı ("25 milyon euro" gibi). Bulunamazsa `null`. */
function extractAmount(rawText) {
  const match = String(rawText || "").match(/(\d+(?:[.,]\d+)?)\s*(milyon|bin)?\s*(euro|avro|€|tl|dolar|\$)/i);
  if (!match) return null;
  return match[0].replace(/\s+/g, " ").trim();
}

/**
 * SPORX'TEN DOĞRUDAN "RESMÎ/DOĞRULANMIŞ" GÜVEN ÇIKARILMAZ.
 *
 * `services/sourceTrust.js` Sporx'i resmî ya da yüksek güven kademesine
 * almıyor (bkz. o dosyanın gerekçesi). Bu yüzden varsayılan güven her
 * zaman `reported`dir; yalnızca sitenin kendi doğrulanmış transfer
 * verisiyle örtüşme varsa `confirmed`e yükselir. Örtüşme yoksa ve metin
 * belirgin biçimde kesinleşmemiş bir iddiaysa (`iddia`, `gündeme geldi`
 * gibi) `rumour`a düşer.
 */
function resolveConfidence({ haystackNormalized, eventType, corroboratedConfirmed }) {
  if (corroboratedConfirmed) return "confirmed";
  if (eventType === "negotiation" || matchesAny(haystackNormalized, ["iddia", "soylenti"])) return "rumour";
  return "reported";
}

/** `data/transfers.json`'daki onaylı bir kayıtla örtüşüyor mu (oyuncu + takım)? */
function corroborateWithConfirmedTransfers({ team, playerName, transfers }) {
  if (!playerName || !Array.isArray(transfers)) return false;
  const player = normalizeText(playerName);
  const club = normalizeText(team);
  return transfers.some((row) => {
    if (!row || String(row.status || "").toLowerCase() !== "confirmed") return false;
    const rowPlayer = normalizeText(row.player || row.playerName || "");
    const rowClub = normalizeText(row.team || row.toTeam || row.club || "");
    return rowPlayer && player && (rowPlayer.includes(player) || player.includes(rowPlayer)) &&
      (!club || !rowClub || rowClub.includes(club) || club.includes(rowClub));
  });
}

/**
 * TÜRKÇE ÜNLÜ UYUMU — ek üretimi.
 *
 * Şablonlar takım/oyuncu adını değişken biçimde alıyor (Galatasaray,
 * Beşiktaş, Trabzonspor, Süper Lig kulüpleri, yabancı kulüpler, oyuncu
 * adları…). Sabit bir "'de" eki her adla doğru çekimlenmiyor ("Beşiktaş'de"
 * yanlış, "Beşiktaş'ta" doğru). Bu yüzden ek, sondaki ünlüye ve ünsüz
 * sertleşmesine göre HESAPLANIR — tek tek ad listelemek yerine.
 */
const BACK_UNROUNDED = new Set(["a", "ı"]);
const BACK_ROUNDED = new Set(["o", "u"]);
const FRONT_UNROUNDED = new Set(["e", "i"]);
const FRONT_ROUNDED = new Set(["ö", "ü"]);
const VOICELESS_CONSONANTS = new Set(["ç", "f", "h", "k", "p", "s", "ş", "t"]);
const TURKISH_VOWELS = new Set(["a", "ı", "o", "u", "e", "i", "ö", "ü"]);

function lastVowelClass(word) {
  const chars = String(word || "").toLocaleLowerCase("tr").split("");
  for (let index = chars.length - 1; index >= 0; index -= 1) {
    const ch = chars[index];
    if (BACK_UNROUNDED.has(ch)) return "backUnrounded";
    if (BACK_ROUNDED.has(ch)) return "backRounded";
    if (FRONT_UNROUNDED.has(ch)) return "frontUnrounded";
    if (FRONT_ROUNDED.has(ch)) return "frontRounded";
  }
  return "backUnrounded";
}

function lastLetter(word) {
  const trimmed = String(word || "").trim();
  return trimmed ? trimmed.slice(-1).toLocaleLowerCase("tr") : "";
}

function endsWithVowel(word) {
  return TURKISH_VOWELS.has(lastLetter(word));
}

/** Bulunma hâli eki: "-de/-da", ünsüz sertleşmesiyle "-te/-ta". */
function locativeSuffix(word) {
  const cls = lastVowelClass(word);
  const back = cls === "backUnrounded" || cls === "backRounded";
  const base = back ? "da" : "de";
  return VOICELESS_CONSONANTS.has(lastLetter(word)) ? (back ? "ta" : "te") : base;
}

/** Tamlayan (iyelik) eki: "-ın/-in/-un/-ün", ünlüyle bitene "n" tamponu. */
function genitiveSuffix(word) {
  const map = { backUnrounded: "ın", frontUnrounded: "in", backRounded: "un", frontRounded: "ün" };
  const suffix = map[lastVowelClass(word)];
  return endsWithVowel(word) ? `n${suffix}` : suffix;
}

/** Yönelme hâli eki: "-a/-e", ünlüyle bitene "y" tamponu. */
function dativeSuffix(word) {
  const cls = lastVowelClass(word);
  const back = cls === "backUnrounded" || cls === "backRounded";
  const suffix = back ? "a" : "e";
  return endsWithVowel(word) ? `y${suffix}` : suffix;
}

function withLocative(word) { return `${word}'${locativeSuffix(word)}`; }
function withGenitive(word) { return `${word}'${genitiveSuffix(word)}`; }
function withDative(word) { return `${word}'${dativeSuffix(word)}`; }

const EVENT_TEMPLATES = {
  official: {
    title: ({ team, player }) => `${withLocative(team)} ${player || "transfer dosyasında"} resmî gelişme`,
    lead: ({ team, player, sourceName }) =>
      `${sourceName}'in haberine göre ${withLocative(team)} ${player || "gündemdeki dosyada"} resmî bir adım atıldığı bildirildi.`
  },
  departure: {
    title: ({ team, player }) => `${withLocative(team)} ${player || "bir isimle"} yolların ayrıldığı öne sürüldü`,
    lead: ({ team, player, sourceName }) =>
      `${sourceName}'in haberine göre ${team} ile ${player || "kadrodaki bir isim"} arasında yolların ayrıldığı aktarıldı.`
  },
  denial: {
    title: ({ team, player }) => `${team}'den ${player || "iddialara"} yalanlama`,
    lead: ({ team, player, sourceName }) =>
      `${sourceName}'in aktardığına göre ${team} cephesi, ${player || "gündemdeki"} iddiaları yalanladı.`
  },
  negotiation: {
    title: ({ team, player }) => `${withLocative(team)} ${player || "transfer dosyasında"} görüşmelerin sürdüğü iddiası`,
    lead: ({ team, player, sourceName }) =>
      `${sourceName}'in haberine göre ${withGenitive(team)} ${player || "bir transfer dosyasında"} görüşmelerini sürdürdüğü öne sürüldü.`
  },
  squad: {
    title: ({ team }) => `${withLocative(team)} kadro gündemi`,
    lead: ({ team, sourceName }) =>
      `${sourceName}'in haberine göre ${team} cephesinde kadroya ilişkin bir gelişme yaşandığı bildirildi.`
  },
  result: {
    title: ({ team }) => `${team} için maç gündemi`,
    lead: ({ team, sourceName }) =>
      `${sourceName}'in aktardığına göre ${team} ile ilgili sahadaki son gelişmeler gündeme geldi.`
  },
  statement: {
    title: ({ team, player }) => player
      ? `${withLocative(team)} ${withDative(player)} ilişkin açıklama iddiası`
      : `${withLocative(team)} gündeme ilişkin açıklama iddiası`,
    lead: ({ team, player, sourceName }) =>
      `${sourceName}'in haberine göre ${team} çevresinde ${player ? withDative(player) : "gündemdeki konuya"} dair bir açıklama aktarıldı.`
  }
};

const CONFIDENCE_SENTENCE = {
  confirmed: (team) => `Bu bilgi, FutbolRadar'ın takip ettiği doğrulanmış transfer verileriyle örtüşüyor; ${withGenitive(team)} cephesinden gelen resmî kayıtlarla teyit edilmiş durumda.`,
  reported: (team) => `Bu bilgi şu ana kadar yalnızca basında yer aldı; ${withGenitive(team)} ya da karşı tarafın resmî bir açıklaması henüz yok. FutbolRadar, resmî bir duyuru geldiğinde haberi güncelleyecek.`,
  rumour: (team) => `Bu içerik henüz doğrulanmamış bir iddia niteliğinde; ${team} veya ilgili taraflarca resmi olarak teyit edilmedi. Gelişmeler netleştikçe haber güncellenecek.`
};

/**
 * İNGİLİZCE HABER KATMANI.
 * ---------------------------------------------------------------------------
 * `/en` tarafında Türkçe haber gösterilmemesi kuralının uygulandığı yer.
 *
 * Haber metni ZATEN ŞABLONDAN üretiliyor: olay türü, takım, kişi ve güven
 * seviyesi belli. Yani İngilizce karşılık çeviriyle değil, AYNI YAPISAL
 * VERİDEN ikinci kez üretilerek elde edilir. Bu, makine çevirisinden hem daha
 * doğru hem de daha doğal: iki dilin de cümlesi kendi dilinde yazılmıştır.
 *
 * Türkçe şablonların aksine burada hâl ekleri yok; İngilizce'de takım adı
 * çekimlenmiyor. Bu yüzden `withLocative` benzeri yardımcılar kullanılmaz.
 */
/**
 * "AT GALATASARAY" AMA "IN EUROPEAN FOOTBALL".
 *
 * Akışta `team` alanı her zaman bir kulüp değil; "Avrupa Futbolu",
 * "Süper Lig", "Transfer Gündemi" gibi KONU başlıkları da bu alana yazılıyor.
 * Kulüp için doğru edat "at", konu başlığı için "in" — "at European
 * Football" İngilizce bir futbol sitesinde kulağa yanlış gelir.
 *
 * Ölçüt veriye dayanır: ad kategori sözlüğünün bir karşılığıysa konu
 * başlığıdır, değilse kulüptür. Küme TEMBEL kuruluyor, çünkü
 * `NEWS_CATEGORY_EN` bu satırlardan SONRA tanımlanıyor; modül yüklenirken
 * okumak `ReferenceError` verirdi.
 */
let categoryLabelSet = null;

function teamPreposition(team) {
  if (!categoryLabelSet) categoryLabelSet = new Set(Object.values(NEWS_CATEGORY_EN));
  return categoryLabelSet.has(String(team)) ? "in" : "at";
}

const EVENT_TEMPLATES_EN = {
  official: {
    title: ({ team, player }) => `Official development ${teamPreposition(team)} ${team} over ${player || "the transfer file"}`,
    lead: ({ team, player, sourceName }) =>
      `${sourceName} report that an official step has been taken ${teamPreposition(team)} ${team} regarding ${player || "the file in question"}.`
  },
  departure: {
    title: ({ team, player }) => `${team} and ${player || "a squad member"} said to have parted ways`,
    lead: ({ team, player, sourceName }) =>
      `${sourceName} report that ${team} and ${player || "a member of the squad"} have gone their separate ways.`
  },
  denial: {
    title: ({ team, player }) => `${team} deny reports over ${player || "the claims"}`,
    lead: ({ team, player, sourceName }) =>
      `${sourceName} report that ${team} have denied the claims regarding ${player || "the matter in question"}.`
  },
  negotiation: {
    title: ({ team, player }) => `Claim that talks continue ${teamPreposition(team)} ${team} over ${player || "a transfer file"}`,
    lead: ({ team, player, sourceName }) =>
      `${sourceName} report that ${team} are continuing talks over ${player || "a transfer file"}.`
  },
  squad: {
    title: ({ team }) => `Squad agenda ${teamPreposition(team)} ${team}`,
    lead: ({ team, sourceName }) =>
      `${sourceName} report a squad-related development ${teamPreposition(team)} ${team}.`
  },
  result: {
    title: ({ team }) => `Match agenda for ${team}`,
    lead: ({ team, sourceName }) =>
      `${sourceName} report that the latest on-pitch developments involving ${team} are in the spotlight.`
  },
  statement: {
    title: ({ team, player }) => player
      ? `Claim of a statement ${teamPreposition(team)} ${team} regarding ${player}`
      : `Claim of a statement ${teamPreposition(team)} ${team} on the current agenda`,
    lead: ({ team, player, sourceName }) =>
      `${sourceName} report that a statement regarding ${player || "the matter in question"} has been relayed around ${team}.`
  }
};

const CONFIDENCE_SENTENCE_EN = {
  confirmed: (team) => `This matches the verified transfer data FutbolRadar tracks; it has been confirmed by official records from ${team}.`,
  reported: (team) => `So far this has only appeared in the press; there is no official statement yet from ${team} or from the other party. FutbolRadar will update the story once an official announcement arrives.`,
  rumour: (team) => `This remains an unverified claim; it has not been officially confirmed by ${team} or the parties involved. The story will be updated as the situation becomes clearer.`
};

/**
 * Kategori rozetleri. Kartın üstünde GÖRÜNEN metin bu.
 * Tabloda olmayan ad olduğu gibi geçer (çoğu zaten özel ad: "La Liga").
 */
const NEWS_CATEGORY_EN = Object.freeze({
  "süper lig": "Süper Lig",
  "avrupa futbolu": "European Football",
  "dünya futbolu": "World Football",
  "şampiyonlar ligi": "Champions League",
  "avrupa ligi": "Europa League",
  "transfer gündemi": "Transfer Agenda",
  "transfer haberleri": "Transfer News",
  "son dakika transfer": "Breaking Transfer",
  "kulüp gündemi": "Club Agenda",
  "hazırlık maçı": "Friendly",
  "kamp programı": "Pre-season Schedule",
  "maç sonucu": "Match Result",
  "türkiye milli takımı": "Türkiye National Team",
  "maç programı": "Fixture Schedule"
});

function categoryEn(category) {
  const raw = text(category);
  return NEWS_CATEGORY_EN[raw.toLowerCase()] || raw;
}

/**
 * ÖZNENİN İNGİLİZCESİ.
 *
 * `discovery.subject` Sporx başlığından çıkarılıyor ve çoğu zaman bir kişi
 * adı ("Victor Osimhen") — çeviri istemez. Ama çıkarım bazen Türkçe bir
 * ÜNVAN yakalıyor: "Sporting Teknik Direktörü", "Kayserispor Yardımcı
 * Antrenörü". Bu ad İngilizce cümlenin ortasına olduğu gibi yerleştiğinde
 * ("a statement regarding Sporting Teknik Direktörü") cümlenin yarısı
 * Türkçe kalıyordu.
 *
 * Bilinen ünvanlar çevrilir. Çeviriden sonra HÂLÂ Türkçe ünvan kalıntısı
 * varsa özne TAMAMEN DÜŞÜRÜLÜR: şablonun öznesiz varyantı ("on the current
 * agenda") doğru İngilizce bir cümle kurar. Yarı Türkçe bir cümle
 * yayımlamaktansa daha genel ama kusursuz bir cümle yayımlamak doğrudur.
 */
// `\b` KULLANILMIYOR. JavaScript'te `\b` ASCII sözcük karakterine bakar;
// "direktörü" gibi bir dizide `ö`/`ü` sözcük karakteri SAYILMADIĞI için
// sınır yanlış yerde oluşuyor ve desen sözcüğün yarısını eşliyordu
// ("Teknik Direktör" + artakalan "ü"). Sınır bu yüzden Unicode harf
// sınıfına bakan ileri/geri bakışlarla kuruluyor.
function turkishWord(pattern) {
  return new RegExp(`(?<![\\p{L}])(?:${pattern})(?![\\p{L}])`, "giu");
}

const SUBJECT_ROLE_EN = [
  [turkishWord("teknik\\s+direktör[üu]?"), "head coach"],
  [turkishWord("yardımcı\\s+antrenör[üu]?"), "assistant coach"],
  [turkishWord("antrenör[üu]?"), "coach"],
  [turkishWord("başkan[ıi]?"), "president"],
  [turkishWord("kaptan[ıi]?"), "captain"],
  [turkishWord("sözcü(?:sü)?"), "spokesperson"],
  [turkishWord("menajer[i]?"), "agent"],
  [turkishWord("yabancı"), ""]
];

/** Çeviriden sonra da Türkçe ünvan/işlev sözcüğü taşıyor mu? */
const TURKISH_RESIDUE = turkishWord(
  [
    // İşlev ve ünvan sözcükleri.
    "ve", "ile", "için", "hoca", "yönetici", "futbolcu", "oyuncu", "kulüp",
    "taraftar", "basın", "gündem", "haber", "açıklama", "iddia",
    // Tamlama sonları. Başlıktan çıkarılan özne bir kişi adı değil de bir
    // OLAY/DÖNEM adı olduğunda ("Adnan Süvari Sezonu", "Şampiyonlar Ligi")
    // İngilizce cümlenin ortasına Türkçe bir tamlama giriyordu.
    "sezon", "sezonu", "hafta", "haftası", "kupa", "kupası", "ligi",
    "maçı", "derbisi", "kadrosu", "programı", "listesi", "raporu",
    "tablosu", "transferi", "sakatlık", "sakatlığı", "kararı", "toplantısı"
  ].join("|")
);

function subjectEn(subject) {
  let value = text(subject);
  if (!value) return "";
  for (const [pattern, replacement] of SUBJECT_ROLE_EN) value = value.replace(pattern, replacement);
  value = value.replace(/\s{2,}/g, " ").trim();
  if (!value) return "";
  // Global bayraklı desende `test` `lastIndex` taşır; her çağrı bağımsız olmalı.
  TURKISH_RESIDUE.lastIndex = 0;
  if (TURKISH_RESIDUE.test(value)) return "";
  return value;
}

/**
 * Bir haberin İngilizce sürümünü YAPISAL VERİDEN üretir.
 *
 * Girdi, `discovery` alanında zaten saklanan şeylerdir; bu yüzden aynı
 * fonksiyon hem yeni haberde (üretim anında) hem de eski 382 kayıtta
 * (geri doldurma) çalışır.
 */
/**
 * Etiketlerin İngilizcesi.
 *
 * Etiket listesi takım adı, kaynak adı, öncelik etiketi ve kişi adından
 * oluşuyor. Özel adlar olduğu gibi kalır; "Transfer Gündemi" gibi
 * betimleyici etiketler kategori tablosundan çevrilir. Çeviriden sonra da
 * Türkçe kalan etiket (ör. başlıktan çıkarılmış yarım bir tamlama)
 * listeden DÜŞÜRÜLÜR — etiket kartın üstünde görünen metindir.
 */
function tagsEn(tags) {
  const list = Array.isArray(tags) ? tags.map(text).filter(Boolean) : [];
  const out = [];
  for (const tag of list) {
    const mapped = NEWS_CATEGORY_EN[tag.toLowerCase()] || subjectEn(tag);
    if (mapped && !out.includes(mapped)) out.push(mapped);
  }
  return out;
}

function buildEnglishArticle({ team, player, eventType, confidence, amount, sourceName = "Sporx", category, slug, tags }) {
  // `team` her zaman bir kulüp değil: akış "Avrupa Futbolu", "Süper Lig",
  // "Transfer Gündemi" gibi KATEGORİ adlarını da takım alanına yazıyor.
  // Kulüp adı olduğu gibi geçer, kategori adı İngilizceye çevrilir.
  const safeTeam = categoryEn(team) || "the club";
  const person = subjectEn(player);
  const template = EVENT_TEMPLATES_EN[eventType] || EVENT_TEMPLATES_EN.statement;
  const title = template.title({ team: safeTeam, player: person });
  const lead = template.lead({ team: safeTeam, player: person, sourceName });

  const detailParts = [];
  if (person) detailParts.push(`The name in the spotlight is ${person}.`);
  if (text(amount)) detailParts.push(`The figure being discussed is ${text(amount)}.`);
  const detailSentence = detailParts.length
    ? detailParts.join(" ")
    : `${sourceName} shared one further detail on the subject; FutbolRadar is relaying it cautiously until it is confirmed by official sources.`;

  const level = CONFIDENCE_SENTENCE_EN[confidence] ? confidence : "reported";
  const confidenceSentence = CONFIDENCE_SENTENCE_EN[level](safeTeam);

  const evaluationSentence = level === "confirmed"
    ? "FutbolRadar's assessment: because the development matches the site's verified transfer records, it is presented to readers as settled information."
    : `FutbolRadar's assessment: the matter is still at the "${level === "rumour" ? "claim" : "press report"}" stage; this page will be updated when an official statement arrives.`;

  const summary = lead;

  return {
    slug: text(slug) || "",
    category: categoryEn(category),
    title,
    summary,
    spot: `${lead} ${confidenceSentence}`,
    body: [lead, detailSentence, confidenceSentence, evaluationSentence],
    tags: tagsEn(tags),
    seo: {
      metaTitle: `${title} | FutbolRadar`,
      metaDescription: summary.slice(0, 155)
    },
    ticker: { text: lead }
  };
}

const TEAM_INTERNAL_LINKS = {
  "Galatasaray": [
    { label: "Galatasaray transfer radarı", href: "../galatasaray-transfer-radar.html" },
    { label: "Galatasaray form durumu", href: "../galatasaray-form-durumu.html" },
    { label: "Galatasaray puan durumu", href: "../galatasaray-puan-durumu.html" }
  ],
  "Fenerbahçe": [
    { label: "Fenerbahçe transfer radarı", href: "../fenerbahce-transfer-radar.html" },
    { label: "Fenerbahçe form durumu", href: "../fenerbahce-form-durumu.html" },
    { label: "Fenerbahçe puan durumu", href: "../fenerbahce-puan-durumu.html" }
  ],
  "Beşiktaş": [
    { label: "Beşiktaş oyuncu radarı", href: "../besiktas-oyuncu-radari.html" },
    { label: "Beşiktaş form durumu", href: "../besiktas-form-durumu.html" },
    { label: "Beşiktaş puan durumu", href: "../besiktas-puan-durumu.html" }
  ],
  "Trabzonspor": [
    { label: "Trabzonspor oyuncu radarı", href: "../trabzonspor-oyuncu-radari.html" },
    { label: "Trabzonspor form durumu", href: "../trabzonspor-form-durumu.html" },
    { label: "Trabzonspor puan durumu", href: "../trabzonspor-puan-durumu.html" }
  ]
};

const DEFAULT_INTERNAL_LINKS = [
  { label: "Süper Lig puan durumu", href: "../super-lig-puan-durumu.html" },
  { label: "Transfer radarı", href: "../transfer-radari.html" },
  { label: "Tüm haberler", href: "../haberler.html" }
];

function internalLinksFor(team) {
  return TEAM_INTERNAL_LINKS[team] || DEFAULT_INTERNAL_LINKS;
}

/** Basit belirteç kümesi (Türkçe çekim eklerine karşı 5 harfe indirgenir). */
function tokenSet(value) {
  return new Set(
    normalizeText(value)
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 2)
      .map((token) => token.slice(0, 5))
  );
}

/** Jaccard benzerliği — özgünlük denetimi (test dosyasında da kullanılır). */
function jaccard(a, b) {
  const setA = tokenSet(a);
  const setB = tokenSet(b);
  if (!setA.size || !setB.size) return 0;
  let shared = 0;
  for (const token of setA) if (setB.has(token)) shared += 1;
  const union = setA.size + setB.size - shared;
  return union === 0 ? 0 : shared / union;
}

/**
 * Sabit (deterministik) kısa özet — FNV-1a 32 bit. Kriptografik değil,
 * yalnızca aynı girdinin her koşuda aynı slug/id parçasını üretmesi için.
 */
function stableDigest(value) {
  let hash = 0x811c9dc5;
  const str = String(value || "");
  for (let index = 0; index < str.length; index += 1) {
    hash ^= str.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * ÖZGÜN HABER NESNESİ ÜRETİR — `data/news.json` şemasıyla birebir uyumlu.
 *
 * Sporx'in başlığı/metni GİRDİ olarak yalnızca olay çıkarımı için kullanılır;
 * hiçbir cümle olduğu gibi kopyalanmaz. Kaynak atfı `sources` alanında ve
 * gövde metninde ("Sporx'in haberine göre") açıkça yer alır.
 */
function buildArticle({ candidate, classification, transfers = [], now = new Date() }) {
  const rawTitle = text(candidate.title);
  const haystackNormalized = normalizeText(`${rawTitle} ${text(candidate.summary)}`);
  const eventType = detectEventType(haystackNormalized);
  const playerName = extractPersonName(rawTitle);
  const amount = extractAmount(`${rawTitle} ${text(candidate.summary)}`);
  const team = classification.team;
  const sourceName = "Sporx";

  const corroborated = corroborateWithConfirmedTransfers({ team, playerName, transfers });
  const confidence = resolveConfidence({ haystackNormalized, eventType, corroboratedConfirmed: corroborated });

  const template = EVENT_TEMPLATES[eventType] || EVENT_TEMPLATES.statement;
  const title = template.title({ team, player: playerName });
  const lead = template.lead({ team, player: playerName, sourceName });

  const detailParts = [];
  if (playerName) detailParts.push(`Gündemdeki isim ${playerName} olarak öne çıkıyor.`);
  if (amount) detailParts.push(`Aktarılan tutar ${amount} olarak konuşuluyor.`);
  const detailSentence = detailParts.length
    ? detailParts.join(" ")
    : `${sourceName}, konuya ilişkin ek bir ayrıntı daha paylaştı; FutbolRadar bu detayları resmî kaynaklarla doğrulanana kadar temkinli aktarıyor.`;

  const confidenceSentence = (CONFIDENCE_SENTENCE[confidence] || CONFIDENCE_SENTENCE.reported)(team);

  const evaluationSentence = confidence === "confirmed"
    ? `FutbolRadar değerlendirmesi: gelişme, sitenin doğrulanmış transfer kayıtlarıyla örtüştüğü için okuyucuya netleşmiş bir bilgi olarak sunuluyor.`
    : `FutbolRadar değerlendirmesi: konu henüz "${confidence === "rumour" ? "iddia" : "basın haberi"}" aşamasında; resmî bir açıklama geldiğinde bu sayfa güncellenecek.`;

  const body = [lead, detailSentence, confidenceSentence, evaluationSentence];

  const spot = `${lead} ${confidenceSentence}`;
  const summary = lead;

  const publishedAt = text(candidate.publishedAt) || now.toISOString();
  // Sporx adresinden TÜRETİLEN sabit bir kısa özet — aynı Sporx haberi için
  // slug her koşuda AYNI olur. `Date.now()` kullanılsaydı aynı Sporx
  // adresi bir sebeple iki kez işlense bile (ör. sporx-seen.json elle
  // sıfırlanırsa) her seferinde farklı, çakışma riski taşıyan bir slug
  // üretilirdi (bkz. Copilot incelemesi).
  const urlDigest = stableDigest(text(candidate.url) || rawTitle);
  const slug = slugify(`${team}-${playerName || eventType}-${urlDigest}`).slice(0, 90);

  const tags = [...new Set([team, sourceName, PRIORITY_LABELS[classification.rank], playerName].filter(Boolean))];

  const bigFour = isBigFourRank(classification.rank);
  const importantMilliTakim = classification.rank === PRIORITY.MILLI_TAKIM && confidence === "confirmed";
  const importantTransfer = classification.rank === PRIORITY.TRANSFER && confidence === "confirmed";
  const isFeatured = bigFour || importantMilliTakim || importantTransfer;
  const includeInTicker = isFeatured;

  const article = {
    id: slug,
    slug,
    category: classification.category,
    title,
    summary,
    spot,
    body,
    bodyAnchors: ["gelisme", "detay", "dogrulama", "degerlendirme"],
    publishedAt,
    team,
    url: `https://www.futbolradar.com/haber/${slug}`,
    sourceName: "FutbolRadar",
    sources: [
      { name: `Sporx — ${rawTitle}`, url: text(candidate.url) }
    ],
    internalLinks: internalLinksFor(team),
    status: "verified",
    isFeatured,
    includeInTicker,
    seo: {
      metaTitle: `${title} | FutbolRadar`,
      metaDescription: summary.slice(0, 155),
      canonical: `https://www.futbolradar.com/haber/${slug}`
    },
    tags,
    discovery: {
      source: "sporx",
      sourceUrl: text(candidate.url),
      discoveredAt: now.toISOString(),
      confidence,
      eventType,
      // Başlığa giren somut özne (kişi adı). Yoksa `null`: haber yalnızca
      // takım + olay türü şablonundan ibarettir (bkz. isGenericArticle).
      subject: playerName || null
    }
  };

  // İNGİLİZCE SÜRÜM ÜRETİM ANINDA YAZILIR.
  //
  // Sonradan doldurulacak bir alan bırakmak, "İngilizcesi hazır olmayan haber
  // /en tarafında görünmesin" kuralının her yeni haberde bir gün boyunca
  // haberi İngilizce yüzeyden düşürmesi demekti. Aynı yapısal veriden
  // üretildiği için ek maliyeti yok.
  article.en = buildEnglishArticle({
    team, player: playerName, eventType, confidence, amount, sourceName,
    category: classification.category, slug, tags
  });

  if (includeInTicker) {
    // "official" kategorisi resmî ağız (kulüp/federasyon) kaynağı ister —
    // Sporx bu şartı hiçbir zaman karşılamaz (bkz. services/sourceTrust.js).
    // Bu yüzden bu hat "official" kategorisini ASLA kullanmaz; onaylanmış
    // içerik bile "club-agenda" kalır, güven rozeti `confirmed`de zaten
    // rozetsiz görünür. "transfer-rumour" rumourOnly olduğundan yalnızca
    // kesinleşmemiş güvenle birlikte kullanılabilir.
    const isTransferTopic = classification.rank === PRIORITY.TRANSFER || eventType === "negotiation";
    article.ticker = {
      category: isTransferTopic && confidence !== "confirmed" ? "transfer-rumour" : "club-agenda",
      confidence,
      // `title` DEĞİL `lead`: kesinleşmemiş güvende (`reported`/`rumour`)
      // `services/newsTicker.js` → `validateTickerItem` metnin en az bir
      // çekince belirteci taşımasını şart koşuyor ("göre", "aktarıldı"…).
      // Her şablonun `lead` cümlesi bunu zaten taşıyor, kısa `title` taşımaz
      // (ör. "…kadro gündemi") — bant bu yüzden kaydı sessizce reddediyordu
      // (bkz. Copilot incelemesi).
      text: lead
    };
  }

  return article;
}

/**
 * ÖZNESİZ ŞABLON HABERİ — YAYIMLANMAZ.
 *
 * `statement`/`squad`/`result` şablonları kişi adı çıkarılamadığında
 * takım adı dışında hiçbir bilgi taşımayan bir başlık üretir
 * ("Fenerbahçe'de gündeme ilişkin açıklama iddiası"). Sporx günde birkaç
 * kez aynı kulüp hakkında böyle haber geçince aynı başlık ve aynı açıklama
 * 20'den fazla sayfada tekrarlandı; SEO denetimi (scripts/qa.mjs) yinelenen
 * başlığı reddettiği için saatlik veri güncellemesi üç gün boyunca hiç
 * commit'lenemedi. Gövdesi de tamamen şablon olan bu sayfaların arama
 * değeri yok; keşif betiği bunları hiç üretmez, Sporx adresini yine de
 * "görüldü" olarak işaretler ki her koşuda yeniden denenmesin.
 */
const GENERIC_EVENT_TYPES = new Set(["statement", "squad", "result"]);

function isGenericArticle(article) {
  const discovery = (article && article.discovery) || {};
  const subject = text(discovery.subject);
  const eventType = text(discovery.eventType) || "statement";
  return GENERIC_EVENT_TYPES.has(eventType) && !subject;
}

const ISTANBUL_DAY_MONTH = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", timeZone: "Europe/Istanbul" });
const ISTANBUL_CLOCK = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
// İngilizce sürümün ayırt edici son eki de İngilizce olmalı: "(15 September)".
const ISTANBUL_DAY_MONTH_EN = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "Europe/Istanbul" });

/** Daha önce eklenmiş bir ayırt edici son eki soyar; işlev böylece idempotent kalır. */
const SEO_SUFFIX_RE = / \(\d{1,2} \p{L}+(?:, \d{2}:\d{2})?(?:, \d+)?\)$/u;

function stripSeoSuffix(value) {
  return text(value).replace(SEO_SUFFIX_RE, "");
}

/** Sırayla denenen ekler: "", " (3 Eylül)", " (3 Eylül, 11:13)"; sonra sıra numarası. */
function seoSuffixCandidates(publishedAt, locale) {
  const date = new Date(publishedAt || "");
  const valid = Number.isFinite(date.getTime());
  const formatter = String(locale || "tr").toLowerCase() === "en" ? ISTANBUL_DAY_MONTH_EN : ISTANBUL_DAY_MONTH;
  const day = valid ? formatter.format(date) : "";
  const clock = valid ? ISTANBUL_CLOCK.format(date) : "";
  const candidates = [""];
  if (day) candidates.push(` (${day})`, ` (${day}, ${clock})`);
  return { candidates, base: day ? `${day}, ${clock}` : "" };
}

function pickUnique(baseValue, used, suffixes) {
  for (const suffix of suffixes.candidates) {
    const candidate = `${baseValue}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  for (let index = 2; index < 1000; index += 1) {
    const candidate = suffixes.base ? `${baseValue} (${suffixes.base}, ${index})` : `${baseValue} (${index})`;
    if (!used.has(candidate)) return candidate;
  }
  return baseValue;
}

/**
 * HABER DEPOSUNDA BAŞLIK VE AÇIKLAMA TEKİLLİĞİ — DETERMİNİSTİK.
 *
 * Aynı başlığı taşıyan kayıtlardan EN ESKİSİ başlığını korur; sonrakiler
 * yayın günü, gerekirse saat, o da yetmezse sıra numarasıyla ayrışır.
 * Sonuç her koşuda aynıdır (yayın tarihine bağlı, çalışma saatine değil),
 * daha önce eklenen ek yeniden hesaplanır (idempotent) ve slug/URL hiç
 * değişmez. `seo.metaTitle` ve `seo.metaDescription` sayfaya basılan
 * alanlar olduğu için onlar da güncellenir. Değişmeyen kayıt aynı nesne
 * olarak döner.
 */
function dedupeArticleSeo(articles) {
  const list = Array.isArray(articles) ? articles : [];
  const order = list
    .map((article, index) => ({ article, index }))
    .filter(({ article }) => article && typeof article === "object")
    .sort((left, right) =>
      text(left.article.publishedAt).localeCompare(text(right.article.publishedAt)) || left.index - right.index);

  const usedTitles = new Set();
  const usedDescriptions = new Set();
  const output = list.slice();

  for (const { article, index } of order) {
    const suffixes = seoSuffixCandidates(article.publishedAt);
    const seo = article.seo && typeof article.seo === "object" ? article.seo : {};
    const baseTitle = stripSeoSuffix(article.title);
    // Sayfaya basılan açıklama (scripts/generate-news-pages.mjs ile aynı
    // öncelik): metaDescription → spot → summary → title. Karşılaştırma bu
    // ETKİN değer üzerinden yapılır; `seo.metaDescription` yalnızca etkin
    // değer başka bir kayıtla çakışırsa yazılır. Alanı boş olan eski bir
    // kayıt, etkin açıklaması tekilse olduğu gibi kalır; çakışıyorsa
    // ayrıştırılmış açıklama o alana yazılır (sayfa bunu basar).
    const effectiveDescription = text(seo.metaDescription) || text(article.spot) || text(article.summary) || text(article.title);
    const baseDescription = stripSeoSuffix(effectiveDescription);

    const title = baseTitle ? pickUnique(baseTitle, usedTitles, suffixes) : text(article.title);
    const description = baseDescription ? pickUnique(baseDescription, usedDescriptions, suffixes) : effectiveDescription;
    if (title) usedTitles.add(title);
    if (description) usedDescriptions.add(description);

    const previousTitle = text(article.title);
    const titleChanged = title !== previousTitle;
    const descriptionChanged = description !== effectiveDescription;
    if (!titleChanged && !descriptionChanged) continue;

    const previousMetaTitle = text(seo.metaTitle);
    const metaTitle = previousTitle && previousMetaTitle.startsWith(previousTitle)
      ? `${title}${previousMetaTitle.slice(previousTitle.length)}`
      : `${title} | FutbolRadar`;

    output[index] = {
      ...article,
      title,
      seo: {
        ...seo,
        ...(titleChanged ? { metaTitle } : {}),
        ...(descriptionChanged ? { metaDescription: description } : {})
      }
    };
  }

  return output;
}

/**
 * İNGİLİZCE BAŞLIK VE AÇIKLAMA TEKİLLİĞİ.
 *
 * Türkçe başlıklar hâl ekleri ve kişi adı sayesinde doğal olarak ayrışıyor;
 * İngilizce şablon ise özne düştüğünde aynı cümleyi üretiyor ("Claim of a
 * statement at Beşiktaş on the current agenda"). Aynı başlık onlarca sayfada
 * tekrarlandığında arama motoru sayfaları kopya sayar.
 *
 * Algoritma Türkçe tarafla AYNI (`dedupeArticleSeo`): en eski kayıt başlığını
 * korur, sonrakiler tarih/saat son ekiyle ayrışır. Tek fark, okunan ve
 * yazılan alanın `article.en` olması ve son ekin İngilizce biçimlenmesi.
 */
function dedupeEnglishSeo(articles) {
  const list = Array.isArray(articles) ? articles : [];
  const order = list
    .map((article, index) => ({ article, index }))
    .filter(({ article }) => article && typeof article === "object" && article.en && text(article.en.title))
    .sort((left, right) =>
      text(left.article.publishedAt).localeCompare(text(right.article.publishedAt)) || left.index - right.index);

  const usedTitles = new Set();
  const usedDescriptions = new Set();
  const output = list.slice();

  for (const { article, index } of order) {
    const en = article.en;
    const suffixes = seoSuffixCandidates(article.publishedAt, "en");
    const seo = en.seo && typeof en.seo === "object" ? en.seo : {};
    const baseTitle = stripSeoSuffix(en.title);
    const effectiveDescription = text(seo.metaDescription) || text(en.spot) || text(en.summary) || text(en.title);
    const baseDescription = stripSeoSuffix(effectiveDescription);

    const title = baseTitle ? pickUnique(baseTitle, usedTitles, suffixes) : text(en.title);
    const description = baseDescription ? pickUnique(baseDescription, usedDescriptions, suffixes) : effectiveDescription;
    if (title) usedTitles.add(title);
    if (description) usedDescriptions.add(description);

    if (title === text(en.title) && description === effectiveDescription) continue;

    output[index] = {
      ...article,
      en: {
        ...en,
        title,
        seo: { ...seo, metaTitle: `${title} | FutbolRadar`, metaDescription: description }
      }
    };
  }

  return output;
}

module.exports = {
  PRIORITY,
  PRIORITY_LABELS,
  classifyCandidate,
  isBigFourRank,
  withLocative,
  withGenitive,
  withDative,
  detectEventType,
  extractPersonName,
  extractAmount,
  resolveConfidence,
  corroborateWithConfirmedTransfers,
  buildArticle,
  buildEnglishArticle,
  categoryEn,
  dedupeEnglishSeo,
  subjectEn,
  tagsEn,
  NEWS_CATEGORY_EN,
  isGenericArticle,
  dedupeArticleSeo,
  stripSeoSuffix,
  jaccard,
  slugify,
  BIG_FOUR,
  CONFIRMATION_VERBS,
  HEDGE_MARKERS
};
