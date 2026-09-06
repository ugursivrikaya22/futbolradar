/**
 * İKİ DİLLİ SİTE — TEK KAYNAK.
 *
 * FutbolRadar Türkçe doğar ve Türkçe kalır: kök alan adı Türkçedir,
 * mevcut Türkçe URL'ler değişmez. İngilizce sürüm `/en/` altında AYRI,
 * indekslenebilir sayfalar olarak yaşar — ekrandaki kelimeleri değiştiren
 * bir istemci betiği değil.
 *
 * Bu dosya üç şeyi tek yerde tutar:
 *
 *   1. SÖZLÜK      — locales/tr.json ve locales/en.json.
 *   2. ROTA EŞLEMESİ — hangi Türkçe sayfanın hangi İngilizce karşılığı var.
 *   3. BİÇİMLEME   — tarih, saat ve maç durumu etiketleri.
 *
 * Neden tek yerde: dil düğmesi (scripts/lib/layout.mjs), İngilizce sayfa
 * üreticisi (scripts/generate-en-pages.mjs), hreflang/canonical enjeksiyonu
 * ve site haritası AYNI eşlemeyi okumak zorunda. İkisi ayrışırsa dil düğmesi
 * var olmayan bir sayfaya bağlanır ya da hreflang çifti tek yönlü kalır —
 * Google'ın alternate ilişkisini tamamen yok saydığı durum budur.
 *
 * ÇEVİRİ SÖZLÜKTEN GELİR, MOTORDAN DEĞİL. Otomatik çeviri yok; her dizge
 * elle yazılmış ve futbol terminolojisi uluslararası kullanımına göre
 * seçilmiştir ("Maç Sonu" → "Full Time", "Devre Arası" → "Half Time").
 */
const fs = require("node:fs");
const path = require("node:path");

const tr = require("../locales/tr.json");
const en = require("../locales/en.json");

const DEFAULT_LOCALE = "tr";
const LOCALES = Object.freeze(["tr", "en"]);
const EN_PREFIX = "en/";

/**
 * DİNAMİK ROTA EŞLEMESİ — MAÇ, TAKIM, OYUNCU SAYFALARI.
 *
 * `ROUTES` sabiti yalnızca 6 çekirdek sayfayı taşır. 7.900+ üretilmiş
 * sayfanın (maç önizlemesi, takım, oyuncu) karşılığı derleme ANINDA
 * belli olur — hangi maç onaylı, hangi oyuncu yayın kapısından geçti
 * yalnızca o üreticiler biliyor. Bu yüzden eşleme dosyaya yazılıyor:
 * her EN üretici (generate-en-match-pages.mjs, generate-en-team-pages.mjs,
 * generate-en-player-pages.mjs) ürettiği sayfaları burada BİRİKTİRİYOR
 * (data/en-route-map.json), diğerlerinin girdilerini SİLMEDEN.
 *
 * Neden dosya, neden bellek içi değil: dil kutusu ve hreflang enjeksiyonu
 * AYRI script çalıştırmalarında okuyor (apply-shared-layout.mjs,
 * inject-hreflang.mjs) — aynı süreçte değiller. Tek kaynak burada
 * kalmazsa üç script üç farklı eşleme görebilir.
 */
const DYNAMIC_ROUTE_MAP_PATH = path.join(__dirname, "..", "data", "en-route-map.json");
let dynamicRouteMapCache = null;

function loadDynamicRouteMap() {
  if (dynamicRouteMapCache) return dynamicRouteMapCache;
  let rows = [];
  try {
    rows = JSON.parse(fs.readFileSync(DYNAMIC_ROUTE_MAP_PATH, "utf8"));
  } catch {
    rows = [];
  }
  const trToEn = new Map();
  const enToTr = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || !row.tr || !row.en) continue;
    trToEn.set(row.tr, row.en);
    enToTr.set(row.en, row.tr);
  }
  dynamicRouteMapCache = { trToEn, enToTr };
  return dynamicRouteMapCache;
}

/** Testler ve her yeni derleme koşusu önbelleği elle temizleyebilir. */
function resetDynamicRouteMapCache() {
  dynamicRouteMapCache = null;
}
const DOMAIN = "https://www.futbolradar.com";

const DICTIONARIES = Object.freeze({ tr, en });

/**
 * ROTA EŞLEMESİ.
 *
 * `tr` ve `en` alanları köke göre dosya yollarıdır; ikisi de gerçekten
 * üretilen dosyalar olmalıdır. Karşılığı olmayan bir Türkçe sayfa buraya
 * YAZILMAZ — yazılırsa dil düğmesi 404'e bağlar.
 *
 * `where-to-watch` bilinçli olarak YOK: Türkçe tarafta bir `/hangi-kanalda`
 * sayfası hiç bulunmuyor (yalnızca maç bazlı "ne-zaman-hangi-kanalda"
 * sayfaları var) ve yayıncı bilgisi yapılandırılmış sağlayıcıların hiçbirinden
 * gelmiyor. Veri olmadan sayfa açmak, boş bir kabuğu içerikmiş gibi
 * indekslettirmek olurdu.
 */
const ROUTES = Object.freeze([
  {
    key: "home",
    tr: "index.html",
    en: "en/index.html",
    changefreq: "daily",
    priority: "1.0"
  },
  {
    key: "todaysMatches",
    tr: "bugunun-maclari.html",
    en: "en/todays-matches.html",
    changefreq: "hourly",
    priority: "0.9"
  },
  {
    key: "liveScores",
    tr: "canli-skor.html",
    en: "en/live-football-scores.html",
    changefreq: "hourly",
    priority: "0.9"
  },
  {
    key: "standings",
    tr: "puan-durumu.html",
    en: "en/standings.html",
    changefreq: "daily",
    priority: "0.8"
  },
  {
    key: "analysis",
    tr: "analizler.html",
    en: "en/analysis.html",
    changefreq: "daily",
    priority: "0.8"
  },
  {
    key: "teams",
    tr: "takimlar.html",
    en: "en/teams.html",
    changefreq: "weekly",
    priority: "0.7"
  },
  // İkinci dalga: menüdeki her Türkçe yüzeyin İngilizce karşılığı.
  //
  // Bu sayfalar daha önce üretilmiyordu ve İngilizce menü onlara Türkçe
  // hedefle bağlanıyordu ("(TR)" işaretiyle). Artık gerçek İngilizce
  // sürümleri var; menü de bunlara bağlanıyor.
  {
    key: "results",
    tr: "mac-sonuclari.html",
    en: "en/results.html",
    changefreq: "daily",
    priority: "0.8"
  },
  {
    key: "fixtures",
    tr: "super-lig-fikstur.html",
    en: "en/fixtures.html",
    changefreq: "daily",
    priority: "0.8"
  },
  {
    key: "matchCentre",
    tr: "mac-merkezi.html",
    en: "en/match-centre.html",
    changefreq: "daily",
    priority: "0.8"
  },
  {
    key: "playerRadar",
    tr: "oyuncu-radari.html",
    en: "en/player-radar.html",
    changefreq: "weekly",
    priority: "0.7"
  },
  {
    key: "topScorers",
    tr: "gol-kralligi.html",
    en: "en/top-scorers.html",
    changefreq: "weekly",
    priority: "0.7"
  },
  {
    key: "topAssists",
    tr: "asist-kralligi.html",
    en: "en/top-assists.html",
    changefreq: "weekly",
    priority: "0.7"
  },
  {
    key: "momentum",
    tr: "momentum.html",
    en: "en/momentum.html",
    changefreq: "weekly",
    priority: "0.7"
  },
  {
    key: "transferRadar",
    tr: "transfer-radari.html",
    en: "en/transfer-radar.html",
    changefreq: "daily",
    priority: "0.7"
  },
  {
    key: "statsHub",
    tr: "istatistik-merkezi.html",
    en: "en/stats-hub.html",
    changefreq: "weekly",
    priority: "0.6"
  },
  {
    key: "archive",
    tr: "arsiv.html",
    en: "en/archive.html",
    changefreq: "weekly",
    priority: "0.6"
  },
  {
    key: "columns",
    tr: "kose-yazilari.html",
    en: "en/columns.html",
    changefreq: "weekly",
    priority: "0.6"
  },
  {
    key: "news",
    tr: "haberler.html",
    en: "en/news.html",
    changefreq: "daily",
    priority: "0.7"
  },
  {
    key: "polls",
    tr: "anketler.html",
    en: "en/polls.html",
    changefreq: "daily",
    priority: "0.6"
  }
]);

/**
 * Sayfa başlığı ve açıklaması dile göre AYRI YAZILIR.
 *
 * Türkçe metnin otomatik çevirisi metadata'ya basılmaz: arama amacı
 * dillerde farklıdır. Türkçe kullanıcı "bugünün maçları" arar, İngilizce
 * kullanıcı "today's football matches" — başlık o amaca göre kurulur.
 */
const ROUTE_META = Object.freeze({
  home: {
    tr: {
      title: "FutbolRadar | Canlı Skor, Süper Lig Puan Durumu ve Maç Analizleri",
      description: "Süper Lig ve Avrupa kupalarında canlı skor, günün maçları, puan durumu ve doğrulanmış transfer hareketleri."
    },
    en: {
      title: "FutbolRadar | Turkish Süper Lig Live Scores, Standings and Analysis",
      description: "Live scores, fixtures, standings and verified transfer news from the Turkish Süper Lig, plus Turkish clubs in European competitions."
    }
  },
  todaysMatches: {
    tr: {
      title: "Bugünün Maçları | FutbolRadar",
      description: "Bugün oynanacak maçlar, başlama saatleri ve turnuvaları; Türkiye saatiyle güncel program."
    },
    en: {
      title: "Football Matches Today | FutbolRadar",
      description: "Today's football fixtures for the Turkish Süper Lig and European competitions — every football match played today, with kick-off times in Türkiye time."
    }
  },
  liveScores: {
    tr: {
      title: "Canlı Skor | FutbolRadar",
      description: "Canlı skorlar, maç durumları ve dakika bilgisi; doğrulanmadan canlı gösterilmez."
    },
    en: {
      title: "Live Football Scores | FutbolRadar",
      description: "Live football scores and live soccer scores for the Turkish Süper Lig and European competitions — never shown as live without verification."
    }
  },
  standings: {
    tr: {
      title: "Süper Lig Puan Durumu | FutbolRadar",
      description: "Trendyol Süper Lig puan durumu: oynanan, galibiyet, beraberlik, mağlubiyet, averaj ve puan."
    },
    en: {
      title: "Turkish Süper Lig Standings | FutbolRadar",
      description: "The full Trendyol Süper Lig table with played, won, drawn, lost, goal difference and points for every club."
    }
  },
  analysis: {
    tr: {
      title: "Maç Analizleri | FutbolRadar",
      description: "Oynanmış maçların doğrulanmış skor, istatistik ve rapor dökümleri."
    },
    en: {
      title: "Turkish Football Match Analysis | FutbolRadar",
      description: "Verified results and statistical breakdowns of Turkish Süper Lig matches and Turkish clubs in Europe."
    }
  },
  teams: {
    tr: {
      title: "Takımlar | FutbolRadar",
      description: "Süper Lig takımları; form, hücum, savunma ve momentum metrikleri."
    },
    en: {
      title: "Turkish Süper Lig Teams | FutbolRadar",
      description: "Every Trendyol Süper Lig club with league position, form and season record — Galatasaray, Fenerbahçe, Beşiktaş, Trabzonspor and the rest."
    }
  },
  results: {
    tr: {
      title: "Maç Sonuçları | FutbolRadar",
      description: "Tamamlanan maçların doğrulanmış skorları; Süper Lig ve Türk kulüplerinin Avrupa maçları."
    },
    en: {
      title: "Football Results Today | FutbolRadar",
      description: "Live match results and football results today from the Trendyol Süper Lig and Turkish clubs in Europe — confirmed final scores only."
    }
  },
  fixtures: {
    tr: {
      title: "Süper Lig Fikstürü | FutbolRadar",
      description: "Trendyol Süper Lig fikstürü: hafta hafta maç programı, tarih ve saatler."
    },
    en: {
      title: "Turkish Süper Lig Fixtures | FutbolRadar",
      description: "The full Trendyol Süper Lig fixture list week by week, with kick-off dates and times in Türkiye time."
    }
  },
  matchCentre: {
    tr: {
      title: "Maç Merkezi | FutbolRadar",
      description: "Tüm maç ekranları tek yerde: canlı skor, günün maçları, sonuçlar ve analizler."
    },
    en: {
      title: "Turkish Football Match Centre | FutbolRadar",
      description: "Every match screen in one place: live scores, today's fixtures, verified results and match analysis for Turkish football."
    }
  },
  playerRadar: {
    tr: {
      title: "Oyuncu Radarı | FutbolRadar",
      description: "Süper Lig oyuncuları; form, gol katkısı ve piyasa değeri göstergeleri."
    },
    en: {
      title: "Turkish Süper Lig Player Radar | FutbolRadar",
      description: "Süper Lig players ranked by form, goal contribution and market value, built only from verified records."
    }
  },
  topScorers: {
    tr: {
      title: "Gol Krallığı | FutbolRadar",
      description: "Süper Lig gol krallığı sıralaması; gol ve asist katkıları."
    },
    en: {
      title: "Turkish Süper Lig Top Scorers | FutbolRadar",
      description: "The Trendyol Süper Lig scoring charts: goals and assists for every player with a verified record."
    }
  },
  topAssists: {
    tr: {
      title: "Asist Krallığı | FutbolRadar",
      description: "Süper Lig asist krallığı sıralaması; yalnızca lig maçlarındaki asistler."
    },
    en: {
      title: "Turkish Süper Lig Top Assists | FutbolRadar",
      description: "The Trendyol Süper Lig assist charts: league-only assists for every player with a verified record."
    }
  },
  momentum: {
    tr: {
      title: "Momentum | FutbolRadar",
      description: "Takım momentumu: form eğrisi, hücum ve savunma sinyalleri."
    },
    en: {
      title: "Turkish Süper Lig Team Momentum | FutbolRadar",
      description: "Which Süper Lig clubs are trending up and which are falling away, measured from recent form, attack and defence signals."
    }
  },
  transferRadar: {
    tr: {
      title: "Transfer Radarı | FutbolRadar",
      description: "Doğrulanmış transfer hareketleri; kaynak ve durum bilgisiyle."
    },
    en: {
      title: "Turkish Süper Lig Transfer Radar | FutbolRadar",
      description: "Verified transfers in and out of Turkish clubs, each one carrying its source and confirmation status."
    }
  },
  statsHub: {
    tr: {
      title: "İstatistik Merkezi | FutbolRadar",
      description: "Tüm istatistik ekranları: oyuncu liderleri, takım trendleri ve karşılaştırmalar."
    },
    en: {
      title: "Turkish Football Statistics Hub | FutbolRadar",
      description: "Every statistics screen in one place: player leaders, team trends, momentum and head-to-head comparisons."
    }
  },
  archive: {
    tr: {
      title: "Arşiv | FutbolRadar",
      description: "Sezon sezon maç arşivi, kadrolar ve teknik direktör dönemleri."
    },
    en: {
      title: "Turkish Football Archive | FutbolRadar",
      description: "Season by season match archive, archived squads and sourced managerial spells from Turkish football."
    }
  },
  columns: {
    tr: {
      title: "Köşe Yazıları | FutbolRadar",
      description: "Yazarların kişisel değerlendirmeleri; sitenin doğrulanmış maç verisinden ayrıdır."
    },
    en: {
      title: "Turkish Football Columns | FutbolRadar",
      description: "Opinion pieces from FutbolRadar writers on Turkish football. Commentary, kept separate from the site's verified match data."
    }
  },
  news: {
    tr: {
      title: "Futbol Haberleri | FutbolRadar",
      description: "Doğrulanmış futbol haberleri; her haber kaynağıyla birlikte yayımlanır."
    },
    en: {
      title: "Turkish Football News | FutbolRadar",
      description: "Verified Turkish football news, each story published with the source it was confirmed against."
    }
  },
  polls: {
    tr: {
      title: "Anketler | FutbolRadar",
      description: "FutbolRadar okuyucu anketleri: açık oylamalar, kapanmış anketlerin kesinleşmiş sonuçları ve yaklaşan sorular bir arada."
    },
    en: {
      title: "Turkish Football Reader Polls | FutbolRadar",
      description: "Open votes, final results from closed polls and upcoming questions — every FutbolRadar reader poll in one place."
    }
  }
});

/**
 * Menü — dile göre AYRI liste.
 *
 * İngilizce menü yalnızca GERÇEKTEN ÜRETİLEN İngilizce sayfaları gösterir.
 * Türkçe menüyü olduğu gibi çevirmek, henüz karşılığı olmayan yedi bağlantıyı
 * 404'e göndermek olurdu.
 */
const NAV_KEYS = Object.freeze({
  tr: {
    primary: [
      { route: null, href: "bugunun-maclari.html", key: "nav.todayMatches" },
      { route: null, href: "canli-skor.html", key: "nav.liveScores" },
      { route: null, href: "mac-sonuclari.html", key: "nav.results" },
      { route: null, href: "super-lig-fikstur.html", key: "nav.superLig" },
      { route: null, href: "analizler.html", key: "nav.analysis" },
      { route: null, href: "takimlar.html", key: "nav.teams" },
      { route: null, href: "kose-yazilari.html", key: "nav.columns" },
      { route: null, href: "puan-durumu.html", key: "nav.standings" },
      { route: null, href: "arsiv.html", key: "nav.archive" }
    ],
    secondary: [
      { href: "mac-takvimi.html", key: "nav.matchCalendar" },
      { href: "oyuncu-radari.html", key: "nav.playerRadar" },
      { href: "istatistik-merkezi.html", key: "nav.statsHub" },
      { href: "transfer-radari.html", key: "nav.transferRadar" },
      { href: "momentum.html", key: "nav.momentum" },
      { href: "gol-kralligi.html", key: "nav.topScorers" },
      { href: "haberler.html", key: "nav.news" },
      { href: "anketler.html", key: "nav.polls" }
    ]
  },
  // İNGİLİZCE MENÜ TÜRKÇEYLE AYNI YÜZEYİ, AYNI SIRAYLA AÇAR.
  //
  // Menü bir aşama önce beş bağlantıydı ve eksik yüzeylere Türkçe hedefle
  // (`trOnly`, "(TR)" işaretiyle) bağlanıyordu. Artık her Türkçe yüzeyin
  // gerçek bir İngilizce karşılığı üretiliyor, dolayısıyla işaret de gerekmiyor:
  // sıra, sayı ve hedef iki dilde birebir aynı.
  //
  // `trOnly` bayrağı KALDIRILMADI (layout.mjs ve i18n testi onu tanıyor):
  // ileride İngilizce karşılığı olmayan bir sayfa menüye girerse, sessizce
  // dil değiştirmek yerine yine işaretlenerek bağlanabilsin.
  en: {
    primary: [
      { href: "en/todays-matches.html", key: "nav.todayMatches" },
      { href: "en/live-football-scores.html", key: "nav.liveScores" },
      { href: "en/results.html", key: "nav.results" },
      { href: "en/fixtures.html", key: "nav.superLig" },
      { href: "en/analysis.html", key: "nav.analysis" },
      { href: "en/teams.html", key: "nav.teams" },
      { href: "en/columns.html", key: "nav.columns" },
      { href: "en/standings.html", key: "nav.standings" },
      { href: "en/archive.html", key: "nav.archive" }
    ],
    secondary: [
      { href: "en/matches.html", key: "nav.matchCalendar" },
      { href: "en/player-radar.html", key: "nav.playerRadar" },
      { href: "en/stats-hub.html", key: "nav.statsHub" },
      { href: "en/transfer-radar.html", key: "nav.transferRadar" },
      { href: "en/momentum.html", key: "nav.momentum" },
      { href: "en/top-scorers.html", key: "nav.topScorers" },
      { href: "en/news.html", key: "nav.news" },
      { href: "en/polls.html", key: "nav.polls" }
    ]
  }
});

function isLocale(value) {
  return LOCALES.includes(String(value || ""));
}

function normalizeLocale(value) {
  return isLocale(value) ? String(value) : DEFAULT_LOCALE;
}

/**
 * Anahtar bulunamazsa ANAHTARIN KENDİSİ döner, sessizce Türkçeye düşmez.
 * İngilizce sayfada beliren bir Türkçe kelime fark edilmeyebilir; "nav.foo"
 * ise derhal görülür ve testte yakalanır.
 */
function t(key, locale) {
  const dictionary = DICTIONARIES[normalizeLocale(locale)] || DICTIONARIES[DEFAULT_LOCALE];
  const value = dictionary[key];
  return typeof value === "string" ? value : String(key);
}

function dictionary(locale) {
  return { ...(DICTIONARIES[normalizeLocale(locale)] || DICTIONARIES[DEFAULT_LOCALE]) };
}

/** Köke göre dosya yolunu sadeleştirir: "./en/x.html" → "en/x.html". */
function normalizePath(value) {
  return String(value || "")
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/^\.?\//, "")
    .replace(/^\/+/, "")
    .trim();
}

function localeOfPath(value) {
  const path = normalizePath(value);
  return path === "en" || path === EN_PREFIX.slice(0, -1) || path.startsWith(EN_PREFIX) ? "en" : "tr";
}

function routeFor(value) {
  const path = normalizePath(value) || "index.html";
  const locale = localeOfPath(path);
  return ROUTES.find((route) => route[locale] === path) || null;
}

/**
 * Aynı sayfanın diğer dildeki karşılığı.
 *
 * Karşılığı yoksa `null` döner — çağıran taraf güvenli yedeği (İngilizce
 * ana sayfa ya da Türkçe ana sayfa) kendisi seçer. Burada sessizce ana
 * sayfaya düşmek, "karşılığı var" ile "karşılığı yok" durumlarını
 * ayırt edilemez yapardı.
 */
function counterpartPath(value, targetLocale) {
  const target = normalizeLocale(targetLocale);
  const normalized = normalizePath(value);
  const route = routeFor(value);
  if (route) return route[target];

  const { trToEn, enToTr } = loadDynamicRouteMap();
  if (target === "en") return trToEn.get(normalized) || null;
  return enToTr.get(normalized) || null;
}

/**
 * Bir EN üreticinin ürettiği (tr, en) çiftini kalıcı eşlemeye ekler.
 *
 * `merge: true` ile çağrılır: dosya baştan yazılmaz, önceki koşulardan
 * kalan (ör. maç sayfaları) girdiler korunur, yalnızca bu üreticinin
 * kategorisi (`kind`) güncellenir. Aksi hâlde üç üretici birbirinin
 * yazdığı eşlemeyi ezerdi — sırayla çalıştıklarında yalnızca SONUNCUSU
 * hayatta kalırdı.
 */
function writeDynamicRoutePairs(kind, pairs) {
  let existing = [];
  try {
    existing = JSON.parse(fs.readFileSync(DYNAMIC_ROUTE_MAP_PATH, "utf8"));
  } catch {
    existing = [];
  }
  const kept = (Array.isArray(existing) ? existing : []).filter((row) => row && row.kind !== kind);
  // Uzantısız kanonik adres taşıyan çiftler (maç SEO sayfaları) `trUrl`/`enUrl`
  // alanlarını da yazar; hreflang enjeksiyonu bu alan varsa onu kullanır,
  // yoksa `absoluteUrl(path)` (uzantılı) üretir. Eski üreticiler etkilenmez.
  const next = kept.concat(pairs.map((pair) => ({
    kind,
    tr: pair.tr,
    en: pair.en,
    ...(pair.trUrl ? { trUrl: pair.trUrl } : {}),
    ...(pair.enUrl ? { enUrl: pair.enUrl } : {})
  })));
  next.sort((left, right) => (left.tr < right.tr ? -1 : left.tr > right.tr ? 1 : 0));
  fs.mkdirSync(path.dirname(DYNAMIC_ROUTE_MAP_PATH), { recursive: true });
  const tempPath = `${DYNAMIC_ROUTE_MAP_PATH}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, DYNAMIC_ROUTE_MAP_PATH);
  resetDynamicRouteMapCache();
  return next.filter((row) => row.kind === kind).length;
}

/** Tüm dinamik eşleme satırları; site haritası ve hreflang enjeksiyonu için. */
function dynamicRoutePairs(kind) {
  let rows = [];
  try {
    rows = JSON.parse(fs.readFileSync(DYNAMIC_ROUTE_MAP_PATH, "utf8"));
  } catch {
    rows = [];
  }
  return (Array.isArray(rows) ? rows : []).filter((row) => !kind || row.kind === kind);
}

function routeMeta(routeKey, locale) {
  const entry = ROUTE_META[routeKey];
  if (!entry) return null;
  return entry[normalizeLocale(locale)] || entry[DEFAULT_LOCALE] || null;
}

/** `<html lang>` değeri. */
function htmlLang(locale) {
  return normalizeLocale(locale) === "en" ? "en" : "tr";
}

/** `hreflang` değeri; Türkçe için bölgeli, İngilizce için nötr. */
function hreflangOf(locale) {
  return normalizeLocale(locale) === "en" ? "en" : "tr-TR";
}

/** OpenGraph `og:locale`. */
function ogLocale(locale) {
  return normalizeLocale(locale) === "en" ? "en_US" : "tr_TR";
}

/**
 * KANONİK URL — YÖNLENDİRMEYE ÇARPMAYAN BİÇİM.
 *
 * `vercel.json` içinde `trailingSlash: false`: kökten başka her yolun sondaki
 * eğik çizgisi 308 ile atılır. Yani `/en/` adresi `/en`e yönlenir. Canonical
 * olarak `/en/` yazılsaydı, kanonik adres kendisi yönlendiren bir adres
 * olurdu — arama motoruna "asıl sayfa şurada" deyip oradan başka yere
 * göndermek. Bu yüzden İngilizce giriş `/en` biçiminde yazılıyor;
 * kullanıcının yazdığı `/en/` yine çalışır, yalnızca bir adım yönlenir.
 *
 * Türkçe ana sayfa `/` istisnadır: kökün eğik çizgisi atılmaz.
 */
/**
 * Dinamik çift satırının kanonik adresi: satır açıkça `trUrl`/`enUrl`
 * taşıyorsa o (uzantısız maç sayfaları), yoksa dosya yolundan türetilen
 * uzantılı adres.
 */
function pairUrl(row, locale) {
  const target = normalizeLocale(locale);
  if (!row) return "";
  const explicit = target === "en" ? row.enUrl : row.trUrl;
  if (explicit) return explicit;
  return absoluteUrl(target === "en" ? row.en : row.tr);
}

function absoluteUrl(path) {
  const normalized = normalizePath(path);
  if (normalized === "index.html") return `${DOMAIN}/`;
  if (normalized === `${EN_PREFIX}index.html`) return `${DOMAIN}/${EN_PREFIX.slice(0, -1)}`;
  return `${DOMAIN}/${normalized}`;
}

const DATE_LOCALES = Object.freeze({ tr: "tr-TR", en: "en-GB" });

/**
 * Tarih ve saat HER İKİ DİLDE DE Türkiye saatiyle yazılır.
 *
 * Dil değişince saat dilimi değişmez: maçlar Türkiye'de oynanıyor ve
 * sitenin tüm zincirinde başlama anı `+03:00` ofsetiyle saklanıyor.
 * Değişen tek şey ay adının dili ("10 Ağustos 2026" / "10 August 2026").
 */
function formatDate(value, locale) {
  const parsed = value instanceof Date ? value : new Date(String(value || ""));
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat(DATE_LOCALES[normalizeLocale(locale)], {
    timeZone: "Europe/Istanbul",
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(parsed);
}

function formatTime(value, locale) {
  const parsed = value instanceof Date ? value : new Date(String(value || ""));
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat(DATE_LOCALES[normalizeLocale(locale)], {
    timeZone: "Europe/Istanbul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(parsed);
}

function formatWeekday(value, locale) {
  const parsed = value instanceof Date ? value : new Date(String(value || ""));
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat(DATE_LOCALES[normalizeLocale(locale)], {
    timeZone: "Europe/Istanbul",
    weekday: "long"
  }).format(parsed);
}

/**
 * Sağlayıcı durum kodu → yerelleştirilmiş etiket.
 *
 * Kanonik duruma çevirme işi services/matchStatus.js'in; burada yalnızca
 * kanonik durumun dile göre karşılığı veriliyor. Eşleme tek merkezde
 * kalsın diye sözlük anahtarları kanonik durum adlarıyla birebir aynı.
 */
function statusLabelFor(canonicalState, locale) {
  const state = String(canonicalState || "UNKNOWN").toUpperCase();
  return t(`status.${state}`, locale);
}

/**
 * Turnuva adı → sözlük anahtarı.
 *
 * Sağlayıcı ve editoryal kayıtlar aynı turnuvayı farklı yazıyor: "Avrupa
 * Ligi", "UEFA Europa League", "Primera Division", "Primera División",
 * "Hazırlık Maçı", "Friendlies Clubs". İngilizce sayfada Türkçe bir turnuva
 * adının kalması, tam da kaçınılması istenen dil karışması olurdu.
 *
 * Tanınmayan ad OLDUĞU GİBİ döner — uydurma bir çeviri üretmektense
 * sağlayıcının verdiği adı göstermek dürüsttür.
 */
const COMPETITION_KEYS = Object.freeze({
  "super lig": "super-lig",
  "süper lig": "super-lig",
  "trendyol super lig": "super-lig",
  "trendyol süper lig": "super-lig",
  "turkish super lig": "super-lig",
  "turkish süper lig": "super-lig",
  "sampiyonlar ligi": "champions-league",
  "şampiyonlar ligi": "champions-league",
  "uefa sampiyonlar ligi": "champions-league",
  "uefa şampiyonlar ligi": "champions-league",
  "uefa champions league": "champions-league",
  "champions league": "champions-league",
  "avrupa ligi": "europa-league",
  "uefa avrupa ligi": "europa-league",
  "uefa europa league": "europa-league",
  "europa league": "europa-league",
  "konferans ligi": "conference-league",
  "uefa konferans ligi": "conference-league",
  "uefa europa conference league": "conference-league",
  "conference league": "conference-league",
  "premier league": "premier-league",
  "premier lig": "premier-league",
  bundesliga: "bundesliga",
  "serie a": "serie-a",
  laliga: "laliga",
  "la liga": "laliga",
  // "Primera División" BİLEREK EŞLENMİYOR.
  //
  // Bu ad İspanya'ya özgü değil: Uruguay, Venezuela, Arjantin ve daha pek çok
  // ülkenin birinci ligi aynı adı taşıyor. Eşlemeye konulduğunda İngilizce
  // sayfada "Deportivo Maldonado – Racing Montevideo" maçının turnuvası
  // "LaLiga" olarak yazılıyordu — okuyucuya yanlış bir olgu sunmak.
  // Tanınmayan ad olduğu gibi geçer; sağlayıcının verdiği ad her zaman
  // uydurulmuş bir çeviriden doğrudur.
  "hazirlik maci": "friendlies",
  "hazırlık maçı": "friendlies",
  "friendlies clubs": "friendlies",
  friendlies: "friendlies"
});

function competitionKey(name) {
  const raw = String(name || "").trim().toLowerCase();
  if (!raw) return null;
  return COMPETITION_KEYS[raw] || null;
}

function competitionLabel(name, locale) {
  const key = competitionKey(name);
  return key ? t(`competition.${key}`, locale) : String(name || "");
}

module.exports = {
  DEFAULT_LOCALE,
  DOMAIN,
  EN_PREFIX,
  LOCALES,
  NAV_KEYS,
  ROUTES,
  ROUTE_META,
  absoluteUrl,
  competitionKey,
  competitionLabel,
  counterpartPath,
  dictionary,
  dynamicRoutePairs,
  formatDate,
  formatTime,
  formatWeekday,
  hreflangOf,
  htmlLang,
  isLocale,
  localeOfPath,
  normalizeLocale,
  normalizePath,
  ogLocale,
  pairUrl,
  resetDynamicRouteMapCache,
  routeFor,
  routeMeta,
  statusLabelFor,
  t,
  writeDynamicRoutePairs
};
