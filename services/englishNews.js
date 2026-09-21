/**
 * İNGİLİZCE HABER AKIŞI — /en'in kendi kaynakları.
 *
 * PROBLEM. İngilizce tarafta HİÇ haber üretilmiyordu. `generate-en-pages.mjs`
 * Türkçe `data/news.json` kayıtlarını alıp İngilizce sayfalara
 * `lang="tr"` işaretiyle basıyordu; `en/news.html` tek başına 98 Türkçe
 * düğüm taşıyordu. Karar bilinçliydi ("makine çevirisi yapmıyoruz") ama
 * sonucu şuydu: İngilizce okur, okuyamadığı bir dilde haber görüyordu.
 *
 * ÇÖZÜM ÇEVİRİ DEĞİL. Türkçe metni çevirmek, kaynağı Türk basını olan bir
 * haberi İngilizce okura ikinci elden aktarmak demekti. Bunun yerine
 * İngilizce akış KENDİ KAYNAKLARINDAN kurulur: UEFA, FIFA, lig kurumları,
 * kulüplerin İngilizce duyuruları, BBC/Sky/ESPN/Guardian. Metin Türkçeden
 * çevrilmez; İngilizce kaynaktan İNGİLİZCE olarak yazılır.
 *
 * ÖZGÜNLÜK KURALI TÜRKÇEYLE AYNI. Kaynağın cümlesi kopyalanmaz. Kaynak
 * başlığı yalnızca GİRDİ: olay türü, takım ve isim çıkarımı için okunur.
 * Yayımlanan her cümle buradaki kalıplardan üretilir ve künye hem
 * `sources` alanında hem gövde metninde açıkça durur.
 */

const { promotedNewsId } = require('./newsPriority.js');
const { editorialStatusOf, STATUS } = require("./editorialStatus.js");

/**
 * İNGİLİZCE BESLEMELER.
 *
 * Türkçe tarafın beslemeleriyle KESİŞMEZ. Buradaki her kaynak İngilizce
 * yayın yapar; böylece akışa Türkçe bir cümle yapısal olarak giremez.
 */
/**
 * Google News üzerinden alan adına daraltılmış besleme adresi.
 *
 * UEFA, Premier League ve Bundesliga KENDİ RSS'lerini yayınlamıyor
 * (ölçüldü: 403 / 404). Türkçe tarafta da aynı engel var ve orada da
 * aynı yol kullanılıyor. `site:` daraltması sayesinde gelen her kayıt
 * yine kurumun KENDİ sayfasına gider; künye ve kademe korunur.
 */
function googleNewsFeed(query) {
  const params = new URLSearchParams({ q: query, hl: "en-US", gl: "US", ceid: "US:en" });
  return `https://news.google.com/rss/search?${params.toString()}`;
}

const ENGLISH_FEEDS = Object.freeze([
  // Kurumlar — resmî kademe.
  { id: "uefa-en", name: "UEFA", url: googleNewsFeed("site:uefa.com football"), competition: "European football", priority: 1, trusted: true, expectDomains: ["uefa.com"] },
  { id: "fifa-en", name: "FIFA", url: googleNewsFeed("site:fifa.com football"), competition: "World football", priority: 2, trusted: true, expectDomains: ["fifa.com"] },
  { id: "premier-league", name: "Premier League", url: googleNewsFeed("site:premierleague.com"), competition: "Premier League", priority: 3, trusted: true, expectDomains: ["premierleague.com"] },
  { id: "bundesliga", name: "Bundesliga", url: googleNewsFeed("site:bundesliga.com"), competition: "Bundesliga", priority: 3, trusted: true, expectDomains: ["bundesliga.com"] },
  // La Liga / Serie A / Ligue 1 kurumlarının İngilizce duyuruları.
  { id: "league-officials", name: "League offices", url: googleNewsFeed("site:laliga.com OR site:legaseriea.it OR site:ligue1.com"), competition: "European football", priority: 3, trusted: true, expectDomains: ["laliga.com", "legaseriea.it", "ligue1.com"] },

  // Yayıncılar — yüksek güven kademesi.
  { id: "bbc-football", name: "BBC Sport", url: "https://feeds.bbci.co.uk/sport/football/rss.xml", competition: "World football", priority: 4, trusted: true },
  { id: "sky-football", name: "Sky Sports", url: "https://www.skysports.com/rss/12040", competition: "World football", priority: 4, trusted: true },
  /*
   * Guardian doğrudan çekimi 403 veriyor: curl 200 alırken Node'un
   * `fetch`i aynı adreste engelleniyor (yayıncı tarafında istemci
   * parmak izi denetimi). Kimlik başlığı eklemek yetmedi. Diğer
   * engelli kurumlarla aynı yol kullanılır — künye yine Guardian'ın
   * kendi sayfasına gider.
   */
  { id: "guardian-football", name: "The Guardian", url: googleNewsFeed("site:theguardian.com football"), competition: "World football", priority: 5, trusted: true, expectDomains: ["theguardian.com"] },
  { id: "espn-football", name: "ESPN", url: "https://www.espn.com/espn/rss/soccer/news", competition: "World football", priority: 5, trusted: true },

  /*
   * TÜRK FUTBOLU, İNGİLİZCE KAYNAKTAN.
   *
   * /en okurunun Süper Lig'den tamamen kopmaması gerekiyor; ama haber
   * Türkçe basından ÇEVRİLMEZ. TFF'nin ve kulüplerin İngilizce sayfaları
   * ile uluslararası basının Türkiye kapsaması kullanılır.
   */
  /*
   * AÇIK UÇLU SORGU İZİNLİ LİSTEYLE SINIRLANIR.
   *
   * Diğer beslemeler `site:` ile tek bir kuruma daraltılabiliyor; bu
   * besleme daraltılamıyor ve Türk kulübü ANAN her sayfayı getiriyor.
   * Süzgeçleri sırayla denedik ve her biri bir sonrakini açıkta bıraktı:
   *   - `requireClub` Valencia Üniversitesi'ni eledi, ama...
   *   - yazı kuralı (Latin alfabesi) Suriye ajansı "سانا"yı eledi, ama...
   *   - engel listesi bahis/skor sitelerini eledi, ama...
   *   - Endonezya yerel gazetesi "SuaraGarut.ID" üçünden de geçti:
   *     Latin alfabesi, haber sitesi, başlıkta kulüp adı var. Yalnızca
   *     İNGİLİZCE DEĞİL.
   *
   * Dilin kendisini metinden güvenilir biçimde çıkarmak (künye "SuaraGarut"
   * gibi bir özel isimken) mümkün değil. Bu yüzden kural tersine çevrildi:
   * bu beslemede yayıncı, İngilizce yayın yapan TANINAN kurumlar
   * listesinde olmak zorunda. Kapalı liste, açık uçlu sorgunun tek
   * yapısal karşılığı — engellenecek siteyi saymak yerine kabul edileni
   * saymak, çünkü dünyadaki yerel gazetelerin sayısı sonsuz.
   */
  {
    id: "turkish-football-en",
    name: "International coverage",
    requireClub: true,
    url: googleNewsFeed('"Super Lig" OR Galatasaray OR Fenerbahce OR Besiktas OR Trabzonspor football'),
    competition: "Süper Lig",
    priority: 6,
    trusted: false,
    expectDomains: [
      // Türk futbolunu İngilizce yayımlayan kurumlar
      "turkish-football.com",
      "turkiyetoday.com",
      "dailysabah.com",
      "hurriyetdailynews.com",
      "trtworld.com",
      // Uluslararası ajans ve yayıncılar
      "bbc.co.uk",
      "bbc.com",
      "theguardian.com",
      "espn.com",
      "espn.co.uk",
      "reuters.com",
      "apnews.com",
      "aljazeera.com",
      "france24.com",
      "nytimes.com",
      "yahoo.com",
      "cnn.com",
      "skysports.com",
      "goal.com",
      "si.com",
      // Kurumlar
      "uefa.com",
      "fifa.com",
      "beinsports.com"
    ]
  }
]);

/** Öncelikli turnuvalar — /en ana akışında üste çıkarlar. */
const PRIORITY_COMPETITIONS = Object.freeze([
  "Champions League",
  "Europa League",
  "Conference League",
  "Premier League",
  "La Liga",
  "Serie A",
  "Bundesliga",
  "Ligue 1",
  "Süper Lig"
]);

/** Başlıktan turnuva çıkarımı. Sıra önemli: özel olan genel olandan önce. */
const COMPETITION_PATTERNS = Object.freeze([
  [/\bchampions league|\bucl\b/i, "Champions League"],
  [/\beuropa league|\buel\b/i, "Europa League"],
  [/\bconference league|\buecl\b/i, "Conference League"],
  [/\bpremier league\b/i, "Premier League"],
  [/\bla ?liga\b/i, "La Liga"],
  [/\bserie a\b/i, "Serie A"],
  [/\bbundesliga\b/i, "Bundesliga"],
  [/\bligue ?1\b/i, "Ligue 1"],
  [/\bsuper ?lig\b|\bsüper ?lig\b/i, "Süper Lig"],
  [/\bworld cup\b|\beuro 20\d\d\b|\bnations league\b/i, "International"],
  [/\bfa cup\b|\bcarabao\b|\bcopa del rey\b|\bcoppa italia\b|\bdfb[- ]pokal\b/i, "Domestic cups"]
]);

/** Sık geçen kulüpler — başlıktan takım çıkarımı için. */
const CLUB_PATTERNS = Object.freeze([
  [/\bman(?:chester)? ?city\b/i, "Manchester City"],
  [/\bman(?:chester)? ?utd\b|\bmanchester united\b/i, "Manchester United"],
  [/\bliverpool\b/i, "Liverpool"],
  [/\barsenal\b/i, "Arsenal"],
  [/\bchelsea\b/i, "Chelsea"],
  [/\btottenham\b|\bspurs\b/i, "Tottenham"],
  [/\breal madrid\b/i, "Real Madrid"],
  [/\bbarcelona\b|\bbar[çc]a\b/i, "Barcelona"],
  [/\batl[ée]tico madrid\b/i, "Atlético Madrid"],
  [/\bjuventus\b/i, "Juventus"],
  [/\bac milan\b|\bmilan\b/i, "AC Milan"],
  [/\binter\b(?! ?milan ?fan)/i, "Inter"],
  [/\bnapoli\b/i, "Napoli"],
  [/\bbayern\b/i, "Bayern Munich"],
  [/\bdortmund\b/i, "Borussia Dortmund"],
  [/\bpsg\b|\bparis saint-germain\b/i, "Paris Saint-Germain"],
  [/\bgalatasaray\b/i, "Galatasaray"],
  [/\bfenerbah[çc]e\b/i, "Fenerbahçe"],
  [/\bbe[şs]ikta[şs]\b/i, "Beşiktaş"],
  [/\btrabzonspor\b/i, "Trabzonspor"]
]);

/**
 * KULÜBÜN KENDİ LİGİ.
 *
 * Başlıkta turnuva adı geçmiyorsa besleme "World football" diyordu ve
 * başlık "Arsenal transfer development in World football" gibi çıkıyordu.
 * Kulüp biliniyorsa ligi de biliniyordur; genel etiket ancak ikisi de
 * bilinmiyorsa kalır.
 */
const CLUB_COMPETITION = Object.freeze({
  "Manchester City": "Premier League",
  "Manchester United": "Premier League",
  Liverpool: "Premier League",
  Arsenal: "Premier League",
  Chelsea: "Premier League",
  Tottenham: "Premier League",
  "Real Madrid": "La Liga",
  Barcelona: "La Liga",
  "Atlético Madrid": "La Liga",
  Juventus: "Serie A",
  "AC Milan": "Serie A",
  Inter: "Serie A",
  Napoli: "Serie A",
  "Bayern Munich": "Bundesliga",
  "Borussia Dortmund": "Bundesliga",
  "Paris Saint-Germain": "Ligue 1",
  Galatasaray: "Süper Lig",
  "Fenerbahçe": "Süper Lig",
  "Beşiktaş": "Süper Lig",
  Trabzonspor: "Süper Lig"
});

/** Turnuva adı olmayan, yalnızca "bir yerlerde futbol" diyen etiketler. */
const GENERIC_COMPETITIONS = new Set(["World football", "European football", "International"]);

function text(value) {
  return typeof value === "string" ? value : "";
}

function normalize(value) {
  return text(value).toLowerCase();
}

/** Başlıktaki turnuva; bulunamazsa beslemenin kendi turnuvası. */
function detectCompetition(title, feed, club = null) {
  const haystack = text(title);
  for (const [pattern, name] of COMPETITION_PATTERNS) {
    if (pattern.test(haystack)) return name;
  }
  // Başlık turnuva söylemiyorsa kulübün kendi ligine düş.
  if (club && CLUB_COMPETITION[club]) return CLUB_COMPETITION[club];
  return (feed && feed.competition) || "World football";
}

/** Başlıktaki kulüp; yoksa null. Takımsız haber de yayımlanabilir. */
function detectClub(title) {
  const haystack = text(title);
  for (const [pattern, name] of CLUB_PATTERNS) {
    if (pattern.test(haystack)) return name;
  }
  return null;
}

/**
 * OLAY TÜRÜ. Türkçe taraftaki `detectEventType` ile aynı işi görür; sözlüğü
 * İngilizce. Sıra önemli — "resmen açıklandı" ile "görüşüyor" aynı cümlede
 * geçebilir ve kesin olan kazanmalıdır.
 */
const EVENT_PATTERNS = Object.freeze([
  [/\b(?:sign(?:s|ed|ing)?|complete[sd]? (?:the )?(?:transfer|move|signing)|joins?|unveil(?:s|ed)?)\b/i, "transfer"],
  [/\b(?:injur(?:y|ed|ies)|ruled out|sidelined|out for|fitness)\b/i, "injury"],
  [/\b(?:ban(?:ned|s)?|suspend(?:ed|s|ion)|fine[sd]?|charge[sd]?|sanction)\b/i, "sanction"],
  [/\b(?:sack(?:ed|s|ing)?|appoint(?:ed|s|ment)?|new (?:head )?coach|steps? down|resign(?:s|ed|ation)?|takes? charge)\b/i, "manager"],
  [/\b(?:squad|line-?up|starting xi|call-?up|named? (?:a |the )?squad)\b/i, "squad"],
  /*
   * "DRAW" İKİ ANLAMA GELİR. Kura çekimi ("the draw for the group stage")
   * ile beraberlik ("held to a draw") aynı sözcük. Çıplak "draw" fikstür
   * sayılınca "held to a draw in Champions League opener" başlığı "takvim
   * güncellemesi" olarak sınıflanıyordu. Kura anlamı yalnızca KURA
   * bağlamında ("the draw", "draw for") kabul edilir; maç sonucu kalıbı
   * da kendi içinde beraberliği açıkça yakalar.
   */
  [/\b(?:the draw\b|draw for\b|fixtures?|schedule|kick-?off time|group stage)\b/i, "competition"],
  [/\b(?:beat|wins?|won|defeat(?:s|ed)?|held to a draw|drew with|draw with|lose|lost|thrash(?:ed)?|held)\b/i, "result"],
  [/\b(?:says?|said|insists?|admits?|reveals?|speaks?|press conference|told)\b/i, "statement"]
]);

function detectEventType(title) {
  const haystack = text(title);
  for (const [pattern, type] of EVENT_PATTERNS) {
    if (pattern.test(haystack)) return type;
  }
  return "statement";
}

/**
 * ÖZGÜN İNGİLİZCE KALIPLAR.
 *
 * Kaynağın cümlesi değil, kaynaktan ÇIKARILAN olgular kullanılır: takım,
 * turnuva, olay türü, künye. Aynı girdi her koşuda aynı metni üretir —
 * sayfa gereksiz yere değişmesin diye.
 */
const EVENT_TEMPLATES = Object.freeze({
  transfer: {
    title: ({ subject, competition, person }) => {
      if (person) return `${person} linked with a move involving ${subject}`;
      return GENERIC_COMPETITIONS.has(competition)
        ? `${subject} transfer development`
        : `${subject} transfer development in the ${competition}`;
    },
    lead: ({ subject, publisher, person }) =>
      person
        ? `${publisher} reports a transfer development involving ${person} and ${subject}.`
        : `${publisher} reports a transfer development involving ${subject}.`
  },
  injury: {
    title: ({ subject, person }) =>
      person ? `${person} facing a fitness setback at ${subject}` : `${subject} handed an injury concern`,
    lead: ({ subject, publisher, person }) =>
      person
        ? `${publisher} reports a fitness issue involving ${person} at ${subject}.`
        : `${publisher} reports a fitness issue affecting ${subject}.`
  },
  sanction: {
    title: ({ subject }) => `Disciplinary decision involving ${subject}`,
    lead: ({ subject, publisher }) =>
      `${publisher} reports a disciplinary decision that concerns ${subject}.`
  },
  manager: {
    title: ({ subject, person }) =>
      person ? `${person} at the centre of the ${subject} dugout question` : `${subject} facing a change in the dugout`,
    lead: ({ subject, publisher, person }) =>
      person
        ? `${publisher} reports a coaching change involving ${person} at ${subject}.`
        : `${publisher} reports a coaching change around ${subject}.`
  },
  squad: {
    title: ({ subject }) => `${subject} squad update`,
    lead: ({ subject, publisher }) =>
      `${publisher} reports a squad update concerning ${subject}.`
  },
  competition: {
    title: ({ competition, subject }) =>
      GENERIC_COMPETITIONS.has(competition) ? `${subject} calendar update` : `${competition} calendar update`,
    lead: ({ competition, publisher }) =>
      `${publisher} reports a scheduling update in the ${competition}.`
  },
  result: {
    title: ({ subject }) => `Match update involving ${subject}`,
    lead: ({ subject, publisher }) =>
      `${publisher} reports on the latest match involving ${subject}.`
  },
  statement: {
    /*
     * YAYINCI ADI BAŞLIĞIN AYIRT EDİCİ PARÇASIDIR.
     *
     * Adı geçen bir kişi yoksa başlık yalnızca `subject`'ten kurulurdu ve
     * aynı kulüp hakkında iki ayrı açıklama haberi geldiğinde iki sayfa
     * BİREBİR aynı başlığı alırdı (ölçüldü: "Barcelona agenda in focus"
     * ve "Fenerbahçe agenda in focus" ikişer sayfa; test-seo-integrity
     * haklı olarak düşüyordu). Yayıncı adı kaydın kendisinde zaten var,
     * yani uydurma bir ayrım eklenmiyor — haberin gerçek kaynağı yazılıyor.
     */
    title: ({ subject, person, publisher }) =>
      person ? `${person} speaks on the ${subject} agenda` : `${subject} agenda in focus — ${publisher}`,
    lead: ({ subject, publisher, person }) =>
      person
        ? `${publisher} reports comments from ${person} relating to ${subject}.`
        : `${publisher} reports fresh comments around ${subject}.`
  }
});

/**
 * DURUM CÜMLESİ. Rozet tek başına yetmez — okur haberin neden o rozeti
 * taşıdığını metinde de görmeli. Cümleler `services/editorialStatus.js`
 * durumlarıyla birebir eşleşir.
 */
const STATUS_SENTENCE = Object.freeze({
  [STATUS.OFFICIAL]: (subject) =>
    `This has been confirmed through an official channel connected to ${subject}. FutbolRadar treats it as settled unless the same channel revises it.`,
  [STATUS.NEGOTIATION]: (subject) =>
    `Talks around ${subject} are described as ongoing, and nothing has been signed off. FutbolRadar will update this page when either side confirms an outcome.`,
  [STATUS.CLAIM]: (subject) =>
    `This remains an unconfirmed claim: ${subject} has not addressed it through an official channel. FutbolRadar will update this page if it is confirmed or denied.`,
  [STATUS.REPORTED]: (subject) =>
    `This has been reported by an established outlet but not announced officially by ${subject}. FutbolRadar will update this page when an official statement follows.`
});

const DEFAULT_INTERNAL_LINKS = Object.freeze([
  { label: "Premier League standings", href: "../premier-league-standings.html" },
  { label: "Champions League standings", href: "../champions-league-standings.html" },
  { label: "All football news", href: "../news.html" }
]);

const COMPETITION_INTERNAL_LINKS = Object.freeze({
  "Premier League": [
    { label: "Premier League standings", href: "../premier-league-standings.html" },
    { label: "Today's matches", href: "../todays-matches.html" },
    { label: "All football news", href: "../news.html" }
  ],
  "La Liga": [
    { label: "La Liga standings", href: "../la-liga-standings.html" },
    { label: "Top scorers", href: "../top-scorers.html" },
    { label: "All football news", href: "../news.html" }
  ],
  "Serie A": [
    { label: "Serie A standings", href: "../serie-a-standings.html" },
    { label: "Top scorers", href: "../top-scorers.html" },
    { label: "All football news", href: "../news.html" }
  ],
  Bundesliga: [
    { label: "Bundesliga standings", href: "../bundesliga-standings.html" },
    { label: "Top scorers", href: "../top-scorers.html" },
    { label: "All football news", href: "../news.html" }
  ],
  "Ligue 1": [
    { label: "Ligue 1 standings", href: "../ligue-1-standings.html" },
    { label: "Top scorers", href: "../top-scorers.html" },
    { label: "All football news", href: "../news.html" }
  ],
  "Champions League": [
    { label: "Champions League standings", href: "../champions-league-standings.html" },
    { label: "Match centre", href: "../match-centre.html" },
    { label: "All football news", href: "../news.html" }
  ],
  "Europa League": [
    { label: "Europa League standings", href: "../europa-league-standings.html" },
    { label: "Match centre", href: "../match-centre.html" },
    { label: "All football news", href: "../news.html" }
  ],
  "Conference League": [
    { label: "Conference League standings", href: "../conference-league-standings.html" },
    { label: "Match centre", href: "../match-centre.html" },
    { label: "All football news", href: "../news.html" }
  ],
  "Süper Lig": [
    { label: "Süper Lig standings", href: "../super-lig-standings.html" },
    { label: "Transfer radar", href: "../transfer-radar.html" },
    { label: "All football news", href: "../news.html" }
  ]
});

function internalLinksFor(competition) {
  return COMPETITION_INTERNAL_LINKS[competition] || DEFAULT_INTERNAL_LINKS;
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

/** Sabit kısa özet (FNV-1a) — aynı girdi, aynı slug. */
function stableDigest(value) {
  let hash = 0x811c9dc5;
  const str = String(value || "");
  for (let index = 0; index < str.length; index += 1) {
    hash ^= str.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function tokenSet(value) {
  return new Set(
    normalize(value)
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 2)
  );
}

/** Jaccard benzerliği — özgünlük denetiminde kullanılır. */
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
 * TÜRKÇE SIZINTI DENETİMİ.
 *
 * İngilizce akışın tek sert kuralı: Türkçe cümle geçmez. Kaynak adı
 * ("Fenerbahçe", "Beşiktaş") özel isimdir ve geçebilir; denetim ÖZEL
 * İSİMLERE değil, Türkçe DİL yapısına bakar — Türkçeye özgü harfler
 * taşıyan sözcükler ve sık geçen Türkçe işlev sözcükleri.
 */
/*
 * NOT: BURADA `\b` KULLANILMAZ.
 *
 * JavaScript'te `\b` yalnızca ASCII harf/rakamı "sözcük karakteri" sayar.
 * "ı", "ş", "ğ" sözcük karakteri DEĞİLDİR, bu yüzden `/\byapıldı\b/`
 * "yapıldı" sözcüğünü YAKALAMAZ — sınır denetimi kelimenin sonundaki
 * "ı"da düşer. Denetim bu yüzden desen eşleştirmez, metni Unicode harf
 * sınırlarından PARÇALAYIP sözcük kümesine bakar.
 */
const TURKISH_FUNCTION_WORDS = new Set([
  "ve", "ile", "için", "göre", "olarak", "ancak", "daha", "sonra", "önce",
  "kadar", "gibi", "üzerine", "hakkında", "ayrıca", "ise", "yine", "henüz",
  "açıklama", "açıkladı", "haberine", "bildirdi", "aktardı", "aktarıldı",
  "iddia", "iddiası", "görüşme", "görüşmesi", "görüşmeler", "resmî", "resmi",
  "transferi", "kulüp", "kulübü", "maçı", "maçında", "sezon", "sezonu",
  "oyuncu", "oyuncusu", "teknik", "direktör", "yapıldı", "edildi", "oldu",
  "bulunuyor", "durumda", "sözleşme", "sözleşmesi", "kadro", "kadroya",
  "puan", "durumu", "takım", "takımı", "milli", "haber", "haberler",
  "gündemi", "gündem", "yazdığına", "belirtildi", "duyurdu", "imza"
]);


function turkishTokens(value) {
  return text(value)
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter(Boolean);
}

/**
 * TÜRKÇE SIZINTI DENETİMİ.
 *
 * İngilizce akışın tek sert kuralı: Türkçe cümle geçmez. Kulüp adı
 * ("Fenerbahçe", "Beşiktaş") ÖZEL İSİMDİR ve geçebilir — bu yüzden
 * denetim Türkçe harflere değil, Türkçe İŞLEV SÖZCÜKLERİNE bakar.
 * "Fenerbahçe and Beşiktaş meet on Sunday" temizdir;
 * "Fenerbahçe'de görüşme yapıldı" değildir.
 */
function containsTurkish(value) {
  const tokens = turkishTokens(value);
  if (!tokens.length) return false;
  // ÖLÇÜT KARAKTER DEĞİL SÖZCÜK.
  //
  // Burada bir zamanlar ikinci bir kural vardı: "Türkçe harf taşıyan sözcük
  // de Türkçe sayılır", yanında da onu telafi etmesi beklenen elle yazılmış
  // bir kulüp adı listesi. O liste tanımı gereği hiçbir zaman tamamlanamaz —
  // oyuncu, başkan, hakem, kasaba adları sonsuz. Ölçtük: "Aziz Yıldırım"
  // geçen 60 haber, metinleri tertemiz İngilizce olduğu hâlde akıştan
  // eleniyordu, çünkü "Yıldırım" listede yoktu.
  //
  // Geriye kalan kural doğru olanı: Türkçe İŞLEV SÖZCÜKLERİ. Bunlar hiçbir
  // özel adın içinde geçmez, dolayısıyla "Fenerbahçe and Beşiktaş meet on
  // Sunday" temiz kalırken "Fenerbahçe'de görüşme yapıldı" yakalanır.
  for (const token of tokens) {
    if (TURKISH_FUNCTION_WORDS.has(token)) return true;
  }
  return false;
}


/**
 * BAŞLIKTAKİ KİŞİ ADI.
 *
 * Kulüp yoksa haberin öznesi çoğu zaman bir İNSANDIR (oyuncu, teknik
 * direktör, başkan). Bu çıkarım olmadan kalıplar ligin adına düşüyor ve
 * akış "Premier League in the spotlight after fresh comments" satırlarıyla
 * doluyordu — birbirinden ayırt edilemeyen başlıklar.
 *
 * Kural basit tutulur: ard arda gelen iki büyük harfli sözcük bir ad
 * sayılır. Cümle başındaki sözcük ve bilinen futbol terimleri dışlanır
 * ki "Champions League" ya da "Premier League" ad sanılmasın.
 */
const NAME_STOPWORDS = new Set([
  // Yarışma ve kurum adları
  "Champions", "League", "Europa", "Conference", "Premier", "Serie", "Liga",
  "Bundesliga", "Ligue", "World", "Cup", "Nations", "Super", "Lig", "Primera",
  "División", "Division", "Laliga", "Fifa", "Uefa",
  // Kulüp adı parçaları — kulüp bir kişi değildir
  "United", "City", "Real", "Inter", "Milan", "Manchester", "Madrid", "Munich",
  "München", "Saint", "Germain", "Borussia", "Dortmund", "Hertha", "Berlin",
  "Stuttgart", "Bayern", "Barcelona", "Arsenal", "Chelsea", "Liverpool",
  "Tottenham", "Everton", "Napoli", "Juventus", "Roma", "Lazio", "Sevilla",
  "Valencia", "Villarreal", "Betis", "Porto", "Benfica", "Sporting", "Ajax",
  "Man", "Utd", "Galatasaray", "Fenerbahce", "Besiktas", "Trabzonspor",
  // Yayın ve bölüm etiketleri — RSS başlıkları bunlarla dolu
  "Sports", "Sport", "News", "Football", "Soccer", "Video", "Watch", "Live",
  "Match", "Report", "Full", "Time", "Week", "Matchday", "Fixture", "Fixtures",
  "Difficulty", "Table", "Standings", "Scout", "Selection", "Fantasy", "Team",
  "Squad", "Panel", "Incidents", "Performance", "Insights", "Statistics",
  "Multimedia", "Official", "Oficial", "App", "Priceless", "Moments",
  "Transfer", "Highlights", "Preview", "Review", "Analysis", "Podcast",
  "Form", "Guide", "Voting", "Works", "Agent", "Platform", "Legal", "Portal",
  "Volunteer", "Community", "Store", "Tickets", "Media", "Careers", "Terms",
  // Ülke adları kişi adı değildir
  "South", "North", "Korea", "Japan", "States", "Kingdom", "Africa",
  // Cümle başı / soru sözcükleri
  "The", "New", "First", "Last", "Next", "How", "Why", "What", "Who", "Does",
  "Will", "Can", "Should", "When", "Where", "And", "But", "For", "With"
]);

/**
 * Bir sözcük KİŞİ ADI biçiminde mi?
 *
 * Kural: baş harf büyük, GERİSİ küçük. Bu tek kural RSS başlıklarındaki
 * gürültünün çoğunu eler — "LALIGA", "WATCHLIVECHAMPIONS", "DAZN", "VfB",
 * "FIFA" hiçbiri bu biçimde değildir; "Thomas", "Guirassy" hepsi öyledir.
 */
function looksLikeNameWord(word) {
  return /^[A-ZÀ-Þ][a-zà-ÿ'’-]{2,}$/.test(word);
}

function extractPersonName(rawTitle) {
  const words = text(rawTitle).split(/\s+/);
  for (let index = 0; index < words.length - 1; index += 1) {
    const first = words[index].replace(/[^A-Za-zÀ-ÿ'’-]/g, "");
    const second = words[index + 1].replace(/[^A-Za-zÀ-ÿ'’-]/g, "");
    if (!looksLikeNameWord(first) || !looksLikeNameWord(second)) continue;
    if (NAME_STOPWORDS.has(first) || NAME_STOPWORDS.has(second)) continue;
    return `${first} ${second}`;
  }
  return null;
}

/**
 * BESLEME NEYİ VAAT ETTİYSE ONU GETİRMELİ.
 *
 * `site:uefa.com` araması yalnızca UEFA getirmiyor: Google News aynı
 * sorguya alakasız alan adları da karıştırıyor. Ölçüldü — "site:laliga.com"
 * beslemesinden Valencia Üniversitesi'nin (uv.es) sayfası ve bir fantezi
 * lig sitesi akışa girdi. Alan adı beklentisi tanımlanmış bir beslemede
 * yayıncı o listeden değilse kayıt DÜŞER: yanlış künyeli haber, eksik
 * haberden daha kötüdür.
 */
/**
 * İNGİLİZCE SAYFADA KÜNYE DE İNGİLİZCE OKUNABİLMELİ.
 *
 * Gövde metni kalıplardan üretildiği için her zaman İngilizce. Künye ise
 * DOĞRUDAN yayıncıdan geliyor ve o denetimin dışında kalıyordu: canlı
 * koşuda Suriye devlet ajansı "سانا" adıyla /en kartlarına düştü. Metin
 * İngilizceydi, kartın altındaki ad Arap alfabesiyleydi.
 *
 * Türkçe sızıntı denetimi (`containsTurkish`) bunu yakalayamaz — yakalaması
 * da beklenmez, o Türkçeye bakar. Bu yüzden kural dile değil YAZIYA bakar:
 * künye ağırlıklı olarak Latin alfabesi olmalı. Böylece Arapça, Kiril,
 * Yunan, CJK künyeler tek kuralla elenir ve her yeni örnek için engel
 * listesine satır eklemek gerekmez.
 *
 * Eşik %100 DEĞİL: "Beşiktaş JK", "Fenerbahçe", "Türkiye Today" gibi meşru
 * künyeler Latin dışı görünen harfler taşıyabilir. Ölçüt, harflerin
 * çoğunluğunun Latin olması.
 */
const LATIN_LETTER = /\p{Script=Latin}/u;
const ANY_LETTER = /\p{L}/u;
const LATIN_MAJORITY_THRESHOLD = 0.6;

function hasLatinPublisherName(name) {
  const value = text(name).trim();
  if (!value) return false;
  let letters = 0;
  let latin = 0;
  for (const ch of value) {
    if (!ANY_LETTER.test(ch)) continue;
    letters += 1;
    if (LATIN_LETTER.test(ch)) latin += 1;
  }
  // Harf içermeyen künye (yalnızca rakam/işaret) bir yayın adı değildir.
  if (letters === 0) return false;
  return latin / letters >= LATIN_MAJORITY_THRESHOLD;
}

function matchesExpectedDomain(publisherUrl, feed) {
  let host;
  try {
    host = new URL(publisherUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    // Alan adı okunamıyorsa yalnızca beklenti tanımlanmamış beslemede geçer.
    return !(feed && Array.isArray(feed.expectDomains) && feed.expectDomains.length);
  }

  /*
   * FANTEZİ LİG HABER DEĞİLDİR. `fantasy.premierleague.com` teknik olarak
   * Premier League'in alan adı altındadır ve beklenti denetiminden geçer;
   * ama taşıdığı içerik oyun tüyosudur, futbol haberi değil.
   */
  const blocked = (feed && feed.blockDomains) || DEFAULT_BLOCKED_DOMAINS;
  if (blocked.some((domain) => host === domain || host.endsWith(`.${domain}`))) return false;

  const expected = feed && feed.expectDomains;
  if (!Array.isArray(expected) || !expected.length) return true;
  return expected.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/** Alan adı beklentisinden geçse bile akışa girmemesi gereken kaynaklar. */
const DEFAULT_BLOCKED_DOMAINS = Object.freeze([
  "fantasy.premierleague.com",
  "multimedia.laliga.com",
  "store.premierleague.com",
  // FIFA'nın haber DIŞI alt portalleri: hizmet sayfası haber değildir.
  "agents.fifa.com",
  "legal.fifa.com",
  "publications.fifa.com",
  // Açık uçlu sorgunun getirdiği futbol dışı alan adları (ölçüldü).
  "uv.es",

  /*
   * SKOR SERVİSİ VE BAHİS SİTESİ GAZETECİLİK DEĞİLDİR.
   *
   * Canlı koşuda ölçüldü: `turkish-football-en` beslemesi kulüp adı geçtiği
   * için oddsscanner.com ve flashscore.com sayfalarını akışa soktu. İkisi
   * de meşru site ama haber ÜRETMİYOR — biri oran karşılaştırıyor, diğeri
   * skor tablosu yayımlıyor. Künyede "Odds Scanner" yazan bir kart, okura
   * bir yayın kurulunun arkasında durduğu izlenimini verir.
   */
  "oddsscanner.com",
  "flashscore.com",
  "sofascore.com",
  "livescore.com",
  "footystats.org",
  "betting.com",
  "oddspedia.com",
  "forebet.com"
]);

/**
 * Bir İngilizce haber nesnesi üretir — `data/news.json` şemasıyla uyumlu,
 * `lang: "en"` işaretli.
 */
function buildEnglishArticle({ item, feed = {}, now = new Date() }) {
  const rawTitle = text(item && item.title).trim();
  if (!rawTitle) return null;

  const club = detectClub(rawTitle);
  const competition = detectCompetition(rawTitle, feed, club);
  const eventType = detectEventType(rawTitle);
  const publisher = text(item.sourceName || feed.name || feed.id || "The source").trim() || "The source";
  const subject = club || competition;

  const person = extractPersonName(rawTitle);
  const template = EVENT_TEMPLATES[eventType] || EVENT_TEMPLATES.statement;
  const title = template.title({ subject, competition, publisher, person });
  const lead = template.lead({ subject, competition, publisher, person });

  const publishedAt = new Date(item.publishedAt || now).toISOString();
  const sources = [{ name: `${publisher} — ${rawTitle}`, url: text(item.link) }].filter((s) => s.url);

  /*
   * YAYINCININ KİMLİĞİ BAĞLANTIDA DEĞİL, `<source url>` ALANINDADIR.
   *
   * Google News üzerinden gelen kayıtlarda `link` toplayıcıya gider
   * (`news.google.com/rss/articles/...`) ve özgün adres geri
   * getirilemiyor. Kademe yalnızca bağlantıya bakarsa UEFA'nın kendi
   * duyurusu "news.google.com" görünür ve RESMÎ olan haber İDDİA
   * rozetiyle yayımlanır — ölçüldü, 26 kaydın tamamı böyle çıkmıştı.
   *
   * Beslemedeki `<source url="https://www.uefa.com">` alanı yayıncının
   * kim olduğunu söyler. Kademe kararı buna bakar; okura gösterilen
   * bağlantı ise çalışan tek adres olarak kalır.
   */
  const publisherUrl = text(item.sourceUrl);
  if (!matchesExpectedDomain(publisherUrl, feed)) return null;
  // Künye Latin alfabesi değilse kayıt /en akışına giremez (bkz. yukarısı).
  if (!hasLatinPublisherName(publisher)) return null;
  /*
   * AÇIK UÇLU SORGU KENDİNİ SINIRLAMAZ. Türk futbolunu İngilizce tarayan
   * besleme `site:` ile daraltılamıyor; sorgu kulüp adı geçen HER sayfayı
   * getiriyor ve akışa Valencia Üniversitesi'nin (uv.es) sayfası girdi.
   * Böyle bir beslemede başlıkta TANINAN bir kulüp geçmesi şarttır.
   */
  if (feed && feed.requireClub && !club) return null;

  // Durum, künyeden ve başlıktan türetilir — İngilizce kalıplar da
  // aynı servisten geçer, böylece iki dil aynı ölçüyü kullanır.
  const verdict = editorialStatusOf(
    { title: rawTitle, summary: lead, publishedAt, sources, sourceUrl: publisherUrl },
    { now: new Date(now).getTime() }
  );

  const contextSentence = GENERIC_COMPETITIONS.has(competition)
    ? (club
        ? `The story concerns ${club} and is being followed across the European game.`
        : "The story is being followed across the European game.")
    : (club
        ? `The story sits in the ${competition} picture and concerns ${club}.`
        : `The story sits in the ${competition} picture.`);
  const statusSentence = (STATUS_SENTENCE[verdict.status] || STATUS_SENTENCE[STATUS.REPORTED])(subject);
  const closing =
    "FutbolRadar writes every English entry from English-language sources and links back to the original report above.";

  const body = [lead, contextSentence, statusSentence, closing];
  const slug = `${slugify([subject, person, eventType].filter(Boolean).join("-"))}-${stableDigest(`${rawTitle}|${item.link || ""}`)}`;

  return {
    id: slug,
    slug,
    lang: "en",
    category: competition,
    title,
    summary: lead,
    spot: [lead, statusSentence].join(" "),
    body,
    bodyAnchors: ["development", "context", "verification", "note"],
    publishedAt,
    team: club,
    competition,
    url: `https://www.futbolradar.com/en/news/${slug}`,
    sourceName: publisher,
    publisherUrl,
    sources,
    internalLinks: internalLinksFor(competition),
    status: "verified",
    editorialStatus: verdict.status,
    editorialStatusLabel: verdict.label,
    isBreaking: verdict.isBreaking,
    eventType,
    person,
    tags: [competition, club, person, publisher].filter(Boolean),
    discovery: {
      source: feed.id || "english-feed",
      sourceUrl: text(item.link),
      discoveredAt: new Date(now).toISOString(),
      eventType
    }
  };
}

/**
 * KURALLAR DEĞİŞİNCE ESKİ KAYITLAR DA YENİDEN DENETLENİR.
 *
 * PROBLEM. `sync` mevcut dosyayı okuyup üzerine ekliyor; eski kayıtlara
 * bir daha bakmıyordu. Bunun bedeli ölçüldü: künye kuralı eklendikten
 * sonra YENİ kayıtlara "سانا" giremedi ama daha önce girmiş olanlar
 * dosyada kaldı ve /en kartlarında görünmeye devam etti. Yani her kural
 * düzeltmesi, elle veri temizliği gerektiriyordu.
 *
 * ÇÖZÜM. Kabul edilebilirlik bir KAPI değil, SÜREKLİ BİR KOŞUL. Her
 * koşuda dosyadaki her kayıt güncel kurallardan yeniden geçer; geçemeyen
 * düşer. Böylece bir kuralı sıkılaştırmak, bir sonraki koşuda geçmişi de
 * kendiliğinden temizler.
 *
 * Kayıt RSS öğesi değil, depolanmış haber nesnesi olduğu için künye
 * bilgisi `sourceName`/`publisherUrl` alanlarından okunur.
 */
function isStillAcceptable(article) {
  if (!isPublishableEnglish(article)) return false;
  if (!hasLatinPublisherName(article && article.sourceName)) return false;
  // Yayıncı alan adı bilinmiyorsa kayıt korunur: eksik üstveri, kusur değil.
  const publisherUrl = text(article && article.publisherUrl);
  if (!publisherUrl) return true;

  /*
   * KAYDIN KENDİ BESLEMESİNİN KURALLARI UYGULANIR.
   *
   * Burası boş bir besleme nesnesiyle (`{}`) çağrılıyordu; sonuç olarak
   * yalnızca genel engel listesi işliyor, beslemeye ÖZGÜ izinli liste
   * (`expectDomains`) hiç bakılmıyordu. Ölçüldü: açık uçlu beslemeye
   * izinli liste eklendikten sonra YENİ kayıtlarda SuaraGarut.ID
   * engellendi ama dosyadaki eski kaydı ayakta kaldı.
   *
   * Kayıt hangi beslemeden geldiğini `discovery.source` alanında taşıyor;
   * o besleme bulunup kendi kurallarıyla denetlenir. Besleme artık
   * tanımlı değilse (listeden çıkarılmışsa) yalnızca genel kurallar kalır.
   */
  const feedId = text(article && article.discovery && article.discovery.source);
  const feed = ENGLISH_FEEDS.find((entry) => entry.id === feedId) || {};
  if (!matchesExpectedDomain(publisherUrl, feed)) return false;
  return true;
}

/**
 * YAYINLANABİLİR Mİ?/**
 * YAYINLANABİLİR Mİ?
 *
 * Üç koşul: metin İngilizce, künye var, başlık bir şey söylüyor. Türkçe
 * sızıntı denetimi burada — akışa giren her kayıt bu kapıdan geçer.
 */
/**
 * İKİ HABER AYNI BAŞLIĞI VE AYNI AÇIKLAMAYI TAŞIYAMAZ.
 *
 * Kalıplar kulüp + yayıncı ikilisi aynı olduğunda birebir aynı metni
 * üretebiliyor; üretim kapısı bunu haklı olarak düşürüyor
 * (scripts/test-seo-integrity.mjs). Ayrım UYDURULMAZ: sırayla kaydın kendi
 * yayıncı adı, haberin özgün başlığı ve kalıcı slug'ı kullanılır — üçü de
 * kayıtta zaten duran veri. Sıra korunur, yani aynı girdi her koşuda aynı
 * çıktıyı verir.
 *
 * Hem akışı yazan taraf (scripts/sync-english-news.mjs) hem de sayfayı
 * çizen taraf (scripts/generate-en-news-pages.mjs) bu işlevden geçer.
 */
function sourceHeadlineOf(article) {
  const first = Array.isArray(article.sources) ? article.sources[0] : null;
  const name = String((first && first.name) || "").trim();
  if (!name) return "";
  // Kaynak adı "<yayıncı> — <özgün başlık>" biçiminde saklanır.
  const dash = name.indexOf(" — ");
  return dash === -1 ? name : name.slice(dash + 3).trim();
}

function withUniqueEnglishMetadata(list) {
  const titles = new Map();
  const descriptions = new Map();
  return (Array.isArray(list) ? list : []).map((article) => {
    const next = { ...article };

    const title = String(next.title || "").trim();
    if (title) {
      if (titles.has(title)) {
        const publisher = String(next.sourceName || "").trim();
        let candidate = publisher && !title.includes(publisher) ? `${title} — ${publisher}` : "";
        if (!candidate || titles.has(candidate)) candidate = `${title} — ${next.slug}`;
        next.title = candidate;
      }
      titles.set(String(next.title).trim(), true);
    }

    const description = String(next.spot || next.summary || next.title || "").trim();
    if (description) {
      if (descriptions.has(description)) {
        /*
         * AYIRT EDİCİ PARÇA BAŞA YAZILIR.
         *
         * `scripts/normalize-meta.mjs` açıklamayı 160 karakterde kırpıyor;
         * sona eklenen bir ek kırpılıp gidiyor ve iki açıklama yine birebir
         * aynı kalıyordu (ölçüldü). Haberin özgün başlığı bu yüzden öne
         * alınır: kırpma sonrası da ayrım ayakta kalır.
         */
        const headline = sourceHeadlineOf(next);
        let candidate = headline ? `\u201C${headline}\u201D — ${description}` : "";
        if (!candidate || descriptions.has(candidate)) candidate = `${next.slug} — ${description}`;
        next.spot = candidate;
      }
      descriptions.set(String(next.spot || next.summary || next.title).trim(), true);
    }

    return next;
  });
}

function isPublishableEnglish(article) {
  if (!article || !article.slug) return false;
  if (!Array.isArray(article.sources) || !article.sources.length) return false;
  if (!text(article.title).trim() || !text(article.summary).trim()) return false;
  const composed = [article.title, article.summary, ...(article.body || [])].join(" ");
  if (containsTurkish(composed)) return false;
  return true;
}

/**
 * ÖNCELİK SIRASI.
 *
 * Önce tazelik değil ÖNEM: öncelikli turnuvalar üste çıkar, sonra tarih.
 * Bayat içerik geri plana alınır — `stalenessPenaltyHours` sonrası her
 * haber sıralamada aşağı iner, silinmez.
 */
const TRANSLATED_ORIGIN_PENALTY = 1000;

function rankEnglishNews(articles, options = {}) {
  const now = options.now ? new Date(options.now).getTime() : Date.now();
  const staleAfterHours = Number.isFinite(options.staleAfterHours) ? options.staleAfterHours : 48;

  const lead = promotedNewsId(articles, new Date(now));
  return [...articles]
    .map((article) => {
      const published = Date.parse(text(article.publishedAt));
      const ageHours = Number.isFinite(published) ? (now - published) / 3600000 : Number.MAX_SAFE_INTEGER;
      const priorityIndex = PRIORITY_COMPETITIONS.indexOf(article.competition || article.category);
      let score = 0;
      if (priorityIndex >= 0) score += 40 - priorityIndex * 2;
      if (article.editorialStatus === STATUS.OFFICIAL) score += 25;
      if (article.isBreaking) score += 20;
      // KÖKEN. /en öncelikle İngilizce kaynaklı bir yayın; Türkçe masadan
      // çevrilen haberler arkadan doldurur. Ceza öteki terimlerin toplam
      // aralığından büyük seçildi, yani ayrım KESİN: tazelik ya da resmî
      // olmak bir çeviriyi İngilizce kaynaklının üstüne çıkaramaz. Bedeli
      // bilinçli — dün yazılmış bir UEFA duyurusu, bugünkü bir transfer
      // çevirisinin üstünde kalır; karşılığında okur /en'e girdiğinde önce
      // kendi basınını görür. Sıralama her iki grubun İÇİNDE aynı kurallarla
      // sürer. `origin` taşımayan kayıt İngilizce kaynaklı sayılır, yani
      // mevcut çağıranların davranışı birebir korunur.
      if (article.origin === "translated") score -= TRANSLATED_ORIGIN_PENALTY;
      // Bayatlık cezası: eşikten sonra her 12 saat için puan düşer.
      if (ageHours > staleAfterHours) score -= Math.min(60, ((ageHours - staleAfterHours) / 12) * 10);
      return { article, score, published: Number.isFinite(published) ? published : 0 };
    })
    .sort((left, right) => Number(right.article.id === lead) - Number(left.article.id === lead) || right.score - left.score || right.published - left.published)
    .map((entry) => entry.article);
}

module.exports = {
  CLUB_COMPETITION,
  CLUB_PATTERNS,
  COMPETITION_PATTERNS,
  ENGLISH_FEEDS,
  EVENT_TEMPLATES,
  GENERIC_COMPETITIONS,
  PRIORITY_COMPETITIONS,
  buildEnglishArticle,
  containsTurkish,
  detectClub,
  detectCompetition,
  DEFAULT_BLOCKED_DOMAINS,
  detectEventType,
  extractPersonName,
  hasLatinPublisherName,
  internalLinksFor,
  withUniqueEnglishMetadata,
  isPublishableEnglish,
  isStillAcceptable,
  jaccard,
  matchesExpectedDomain,
  rankEnglishNews,
  slugify,
  stableDigest
};
