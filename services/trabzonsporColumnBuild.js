/**
 * MAÇ SONU KÖŞE YAZISI — BAŞLIK, KÜNYE VE KAYIT MONTAJI (saf modül).
 *
 * Model (`trabzonsporMatchColumn.js`) ve metin (`trabzonsporColumnWriter.js`)
 * hazır; burada ikisi `data/columns.json` şemasındaki tek bir kayda
 * dönüşüyor: başlık, SEO başlığı, meta açıklaması, kısa ad, künye, gövde,
 * İngilizce karşılığı ve paylaşım metni.
 *
 * ── BAŞLIK TEK KALIP DEĞİLDİR ───────────────────────────────────────────
 *
 * `headline()` maçın kendi sinyalinden başlığı seçer: kırmızı kart, geriden
 * dönüş, son dakika golü, farklı skor, üretip bitirememe... Aynı kalıbın her
 * hafta tekrarlanması hem okuyucu hem arama motoru için değersizleşirdi.
 * Başlığın sonunda rakip ve skor duruyor; bu, iki yazının aynı başlığı
 * taşımasını da imkânsız kılıyor.
 *
 * ── UZUNLUK BİR KAPI, HEDEF DEĞİL ───────────────────────────────────────
 *
 * Gövde 1.500 kelimeyi aşarsa en düşük öncelikli bölümler sırayla düşürülür
 * (`trimBody`). 1.000 kelimenin ALTINDA kalırsa hiçbir şey eklenmez ve kayıt
 * `draft` doğar (`assessColumn`): eksik veriyi cümleyle doldurmak, bu
 * sitenin bütün veri sözleşmesini bozmak olurdu.
 */

const {
  MIN_WORDS,
  MAX_WORDS,
  countWords,
  slugify,
  isNumber,
  num,
  readiness,
  buildModel
} = require("./trabzonsporMatchColumn.js");

const {
  renderTurkish,
  renderEnglish,
  trDate,
  enDate
} = require("./trabzonsporColumnWriter.js");

const AUTHOR = "FutbolRadar";
const CATEGORY = "trabzonspor";
const CONTENT_TYPE = "Maç Sonu Analizi";

/** Paylaşım görselinin üst başlığı — istenen biçim, birebir. */
const SHARE_IMAGE_TITLE = "TRABZONSPOR | MAÇ SONU ANALİZİ";

/**
 * 1.500 kelime tavanı aşılırsa düşürülecek bölümler — ÖNCELİK SIRASIYLA.
 * Sondan başlayarak değil, bilinçli bir sırayla: "kırılma anı" ve "taktik
 * tablo" yazının sözü, en son onlar düşer.
 */
const DROP_ORDER = [
  "## Beklentinin altında kalanlar",
  "## Sayılarla bireysel üretim",
  "## Rakip ne üretti, savunma neyi verdi",
  "## İlk yarı, ikinci yarı: gece ikiye bölündü mü",
  "## Rakip ne üretti, savunma neyi verdi",
  "## Öne çıkan futbolcular",
  "## Orta saha ve savunma dengesi",
  "## Sonucun lig açısından anlamı",
  "## Teknik direktörün tercihleri"
];

const DROP_ORDER_EN = [
  "## Below expectation",
  "## The individual numbers",
  "## What the defence gave up",
  "## Two halves, or one match",
  "## What the defence gave up",
  "## Who stood out",
  "## Midfield and the defensive balance",
  "## What it means for the league",
  "## The manager's decisions"
];

const TR_MONTH_SLUG = [
  "ocak", "subat", "mart", "nisan", "mayis", "haziran",
  "temmuz", "agustos", "eylul", "ekim", "kasim", "aralik"
];
const EN_MONTH_SLUG = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december"
];

/* ------------------------------------------------------------------ *
 * BAŞLIK
 * ------------------------------------------------------------------ */

/**
 * Maçın en belirgin sinyali. Başlık ve giriş bundan seçiliyor.
 *
 * Sıra önemli: kırmızı kart bir maçın en büyük tek olayıdır, son dakika
 * golü ikinci, farklı skor üçüncü. Hiçbiri yoksa `plain` döner ve başlık
 * sonucun kendisinden kurulur.
 */
function signalOf(model) {
  if (model.cards.us.red.length) return "red-us";
  if (model.cards.them.red.length) return "red-them";

  const decisive = model.turningPoint;
  const lastMinute = decisive && decisive.kind === "goal"
    ? Number(String(decisive.minute).split("+")[0])
    : null;
  if (Number.isFinite(lastMinute) && lastMinute >= 85) return "late";

  if (isNumber(model.margin) && Math.abs(model.margin) >= 3) return model.margin > 0 ? "rout" : "routed";

  // Geriden dönüş: bir noktada geride kalıp sonucu çevirmek.
  let us = 0;
  let them = 0;
  let wasBehind = false;
  for (const goal of model.goals) {
    if (goal.forUs) us += 1; else them += 1;
    if (us < them) wasBehind = true;
  }
  if (wasBehind && model.result === "win") return "comeback";
  if (wasBehind && model.result === "draw") return "rescued";

  const xg = model.stats.xg;
  const ourGoals = model.goals.filter((goal) => goal.forUs).length;
  if (xg && isNumber(xg.us) && ourGoals + 0.8 < xg.us && model.result !== "win") return "wasteful";

  return "plain";
}

/**
 * Başlık kuyruğu SAHA SIRASIYLA yazılır: "Konyaspor 1-0 Trabzonspor".
 *
 * İlk sürüm kuyruğu Trabzonspor'un bakışıyla kuruyordu ("Konyaspor 0-1") ve
 * okuyan kişi skoru rakibe ait sanıyordu — deplasmanda kaybedilen bir maç,
 * başlıkta rakibin gol atamadığı bir maç gibi görünüyordu. Skor, hangi
 * takımın kaç attığını tek okumada söylemek zorunda.
 */
function fixtureLine(model) {
  return model.isHome
    ? `Trabzonspor ${model.ourScore}-${model.theirScore} ${model.opponent}`
    : `${model.opponent} ${model.theirScore}-${model.ourScore} Trabzonspor`;
}

function headline(model) {
  const signal = signalOf(model);
  const tail = fixtureLine(model);

  const hooks = {
    "red-us": `On Kişi Kalan Trabzonspor'da Gecenin Hikâyesi`,
    "red-them": `Sayısal Üstünlük Neyi Değiştirdi: Trabzonspor'da Gecenin Hikâyesi`,
    late: `Son Dakikada Yazılan Sonuç: Trabzonspor'da Maçı Değiştiren Detaylar`,
    rout: `Trabzonspor'dan Fark: Gecenin Hikâyesi ve Maçı Değiştiren Detaylar`,
    routed: `Trabzonspor'da Ağır Gece: Maçı Değiştiren Detaylar`,
    comeback: `Geriden Gelen Trabzonspor: Maçı Değiştiren Detaylar`,
    rescued: `Trabzonspor Kurtardığı Puanın Hikâyesi: Gecenin Detayları`,
    wasteful: `Trabzonspor Üretti, Tabela Yazmadı: Gecenin Hikâyesi`,
    plain: `Trabzonspor'da Gecenin Hikâyesi: Maçı Değiştiren Detaylar`
  };

  return `${hooks[signal] || hooks.plain} | ${tail}`;
}

function headlineEn(model) {
  const signal = signalOf(model);
  const tail = fixtureLine(model);
  const hooks = {
    "red-us": `Down to Ten: The Story of Trabzonspor's Night`,
    "red-them": `What the Extra Man Actually Changed for Trabzonspor`,
    late: `Decided Late: The Details That Changed Trabzonspor's Match`,
    rout: `Trabzonspor Pull Clear: The Details Behind the Margin`,
    routed: `A Heavy Night for Trabzonspor: The Details That Decided It`,
    comeback: `Trabzonspor Turn It Around: The Details That Changed the Match`,
    rescued: `The Point Trabzonspor Rescued: How the Night Unfolded`,
    wasteful: `Trabzonspor Created, the Scoreboard Did Not Follow`,
    plain: `The Story of Trabzonspor's Night: The Details That Changed the Match`
  };
  return `${hooks[signal] || hooks.plain} | ${tail}`;
}

/**
 * SEO başlığı — aranan kalıpları DOĞAL biçimde taşır.
 *
 * "Trabzonspor maç sonucu", "Trabzonspor maç analizi" ve "maç özeti" aynı
 * cümlede tıkıştırılmaz; başlık okunabilir kalır ve kalıplardan ikisini
 * taşır. Üçünü birden yazmak arama motoru için de kötü, okuyucu için de.
 */
function seoTitle(model) {
  return `${fixtureLine(model)} maç sonucu ve maç analizi | FutbolRadar`;
}

function seoTitleEn(model) {
  return `${fixtureLine(model)}: result and match analysis | FutbolRadar`;
}

/** Meta açıklaması 150–160 karakter olmalı; kısaysa uzatılır, uzunsa kelime sınırından kesilir. */
function clampMeta(sentences, { min = 150, max = 160 } = {}) {
  let out = "";
  for (const sentence of sentences) {
    const candidate = out ? `${out} ${sentence}` : sentence;
    if (candidate.length > max) {
      if (out.length >= min) return out;
      // Cümle sınırı tutmuyorsa kelime sınırından kes; yarım kelime bırakma.
      const cut = candidate.slice(0, max);
      const lastSpace = cut.lastIndexOf(" ");
      return (lastSpace > min ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:]+$/, "");
    }
    out = candidate;
  }
  return out;
}

function metaDescription(model) {
  const score = `${model.ourScore}-${model.theirScore}`;
  const resultWord = model.result === "win" ? "kazandı" : model.result === "loss" ? "kaybetti" : "berabere kaldı";
  return clampMeta([
    `Trabzonspor ${model.opponent} maçını ${score} ${resultWord}.`,
    `Goller, istatistikler, kırılma anı ve taktik okuma: maç sonu analizi FutbolRadar'da.`,
    `Puan durumu etkisiyle birlikte.`
  ]);
}

function metaDescriptionEn(model) {
  const score = `${model.ourScore}-${model.theirScore}`;
  const verb = model.result === "win" ? "beat" : model.result === "loss" ? "lost to" : "drew with";
  return clampMeta([
    `Trabzonspor ${verb} ${model.opponent} ${score}.`,
    `Goals, statistics, the turning point and the tactical read in one post-match analysis.`,
    `Plus what it does to the table.`
  ]);
}

function excerpt(model) {
  const score = `${model.ourScore}-${model.theirScore}`;
  const resultWord = model.result === "win" ? "kazandı" : model.result === "loss" ? "kaybetti" : "berabere kaldı";
  return `Trabzonspor ${model.isHome ? "sahasında" : "deplasmanda"} ${model.opponent} karşısında ${score} ${resultWord}. ` +
    `Maç nerede kazanıldı, nerede kaybedildi: goller, istatistikler ve gecenin kırılma anı üzerinden taktik okuma.`;
}

function excerptEn(model) {
  const score = `${model.ourScore}-${model.theirScore}`;
  const verb = model.result === "win" ? "beat" : model.result === "loss" ? "lost to" : "drew with";
  return `Trabzonspor ${verb} ${model.opponent} ${score} ${model.isHome ? "at home" : "away"}. ` +
    `Where the match was won and lost: the goals, the numbers and the moment that turned it.`;
}

function spot(model) {
  const parts = [
    [model.competition, model.stage].filter(Boolean).join(" "),
    fixtureLine(model),
    [model.venue, trDate(model.date)].filter(Boolean).join(", ")
  ].filter(Boolean);
  return parts.join(" | ");
}

function spotEn(model) {
  const parts = [
    [model.competition, model.stage].filter(Boolean).join(" "),
    fixtureLine(model),
    [model.venue, enDate(model.date)].filter(Boolean).join(", ")
  ].filter(Boolean);
  return parts.join(" | ");
}

/** İstenen biçim: `/kose-yazilari/trabzonspor-mac-analizi-19-eylul-2026`. */
function slugFor(model) {
  const date = model.date;
  if (!date) return `trabzonspor-mac-analizi-${slugify(model.matchId)}`;
  return `trabzonspor-mac-analizi-${date.getDate()}-${TR_MONTH_SLUG[date.getMonth()]}-${date.getFullYear()}`;
}

function slugForEn(model) {
  const date = model.date;
  if (!date) return `trabzonspor-match-analysis-${slugify(model.matchId)}`;
  return `trabzonspor-match-analysis-${date.getDate()}-${EN_MONTH_SLUG[date.getMonth()]}-${date.getFullYear()}`;
}

/* ------------------------------------------------------------------ *
 * UZUNLUK
 * ------------------------------------------------------------------ */

/** Bir başlık ve onu izleyen paragrafları gövdeden çıkarır. */
function dropSection(body, heading) {
  const start = body.indexOf(heading);
  if (start === -1) return body;
  let end = start + 1;
  while (end < body.length && !String(body[end]).startsWith("## ")) end += 1;
  return [...body.slice(0, start), ...body.slice(end)];
}

function trimBody(body, order, max = MAX_WORDS) {
  let out = body;
  for (const heading of order) {
    if (countWords(out) <= max) break;
    out = dropSection(out, heading);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * PAYLAŞIM
 * ------------------------------------------------------------------ */

function socialFor(model, entry) {
  return {
    // İstenen paylaşım metni, birebir.
    text: "Trabzonspor maçının ardından: Maç nerede kazanıldı, nerede kaybedildi? " +
      "Gecenin taktik analizi FutbolRadar'da.",
    textEn: "After the Trabzonspor match: where was it won, where was it lost? " +
      "The tactical read of the night is on FutbolRadar.",
    imageTitle: SHARE_IMAGE_TITLE,
    image: `assets/columns/${entry.slug}.svg`,
    url: `https://www.futbolradar.com/kose-yazilari/${entry.slug}.html`,
    urlEn: entry.en ? `https://www.futbolradar.com/en/columns/${entry.en.slug}.html` : ""
  };
}

/* ------------------------------------------------------------------ *
 * PAYLAŞIM GÖRSELİ
 * ------------------------------------------------------------------ */

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/**
 * Kapak görseli. Mevcut köşe yazısı kapaklarıyla aynı ızgara, aynı renkler;
 * tek fark üst şeridin sabit başlığı — istenen "TRABZONSPOR | MAÇ SONU
 * ANALİZİ" ibaresi.
 */
function coverSvg(model) {
  const fixture = fixtureLine(model);
  const context = [model.competition, model.stage].filter(Boolean).join(" · ");
  const footer = [trDate(model.date), model.venue].filter(Boolean).join(" · ");
  // 1200 px genişlikte 60 punto ile yaklaşık 34 karakter rahat oturuyor.
  const fixtureSize = fixture.length > 34 ? 48 : 60;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(`${SHARE_IMAGE_TITLE} — ${fixture}`)}</title>
  <desc id="desc">${escapeXml(`FutbolRadar maç sonu analizi kapak görseli: ${fixture}${footer ? `, ${footer}` : ""}.`)}</desc>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#071017"/>
      <stop offset="0.55" stop-color="#0a1620"/>
      <stop offset="1" stop-color="#041012"/>
    </linearGradient>
    <linearGradient id="bordo" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#8b1a3a"/>
      <stop offset="1" stop-color="#2f6ea8"/>
    </linearGradient>
    <pattern id="grid" width="96" height="84" patternUnits="userSpaceOnUse">
      <path d="M96 0H0V84" fill="none" stroke="#80ff9b" stroke-opacity="0.06" stroke-width="1"/>
    </pattern>
  </defs>

  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#grid)"/>

  <circle cx="985" cy="300" r="235" fill="#2f6ea8" fill-opacity="0.10"/>
  <circle cx="985" cy="300" r="150" fill="none" stroke="#8b1a3a" stroke-opacity="0.45" stroke-width="3"/>
  <circle cx="985" cy="300" r="92" fill="none" stroke="#2f6ea8" stroke-opacity="0.55" stroke-width="2"/>

  <rect x="0" y="0" width="10" height="630" fill="url(#bordo)"/>

  <text x="78" y="132" font-family="Inter, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
        font-size="26" font-weight="800" letter-spacing="4" fill="#80ff9b">${escapeXml(SHARE_IMAGE_TITLE)}</text>

  <text x="78" y="196" font-family="Inter, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
        font-size="25" font-weight="600" fill="#9fb3c0">${escapeXml(context)}</text>

  <text x="78" y="312" font-family="Inter, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
        font-size="${fixtureSize}" font-weight="800" fill="#f2f7fa">${escapeXml(fixture)}</text>

  <line x1="78" y1="372" x2="640" y2="372" stroke="#2f6ea8" stroke-opacity="0.6" stroke-width="2"/>

  <text x="78" y="440" font-family="Inter, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
        font-size="30" font-weight="700" fill="#e2687f">Maç nerede kazanıldı, nerede kaybedildi?</text>

  <text x="78" y="500" font-family="Inter, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
        font-size="26" font-weight="600" fill="#9fb3c0">${escapeXml(footer)}</text>

  <text x="78" y="566" font-family="Inter, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
        font-size="28" font-weight="800" letter-spacing="2" fill="#4de5ff">futbolradar.com</text>
</svg>
`;
}

/* ------------------------------------------------------------------ *
 * MONTAJ
 * ------------------------------------------------------------------ */

/**
 * Yazı yayımlanabilir mi?
 *
 * Kapı üç sorudan oluşuyor ve üçü de OTOMATİK cevaplanabilir; yayın için
 * elle onay beklenmiyor. Ama kapıların kendisi kalkmıyor: veri eksikse ya da
 * metin taban uzunluğun altındaysa kayıt `draft` olarak yazılır ve yüzeylerde
 * görünmez.
 */
function assessColumn(entry, verdict) {
  const reasons = [];
  if (!verdict.ready) reasons.push(`eksik veri: ${verdict.missing.join(", ")}`);

  const words = countWords(entry.body);
  if (words < MIN_WORDS) reasons.push(`gövde ${words} kelime (taban ${MIN_WORDS})`);
  if (words > MAX_WORDS) reasons.push(`gövde ${words} kelime (tavan ${MAX_WORDS})`);
  if (!entry.excerpt) reasons.push("özet yok");
  if (!entry.metaDescription) reasons.push("meta açıklaması yok");

  return { publishable: reasons.length === 0, words, reasons };
}

/**
 * Bitmiş bir maçtan tam köşe yazısı kaydı.
 *
 * @param {object} match  Bitmiş maç kaydı (olaylar, istatistikler, kadrolar).
 * @param {object} context {standing, nextMatch, links, linksEn, now}
 */
function buildColumnEntry(match, context = {}) {
  const verdict = readiness(match);
  const model = buildModel(match, context);
  model.linksEn = context.linksEn || {};

  const body = trimBody(renderTurkish(model), DROP_ORDER);
  const bodyEn = trimBody(renderEnglish(model), DROP_ORDER_EN);

  const slug = slugFor(model);
  const entry = {
    id: slug,
    slug,
    title: headline(model),
    seoTitle: seoTitle(model),
    metaDescription: metaDescription(model),
    author: AUTHOR,
    date: context.now || new Date().toISOString(),
    category: CATEGORY,
    contentType: CONTENT_TYPE,
    tags: ["Trabzonspor", model.opponent, model.competition, "Maç Analizi"].filter(Boolean),
    // Durum, kapıdan geçtikten sonra aşağıda belirleniyor.
    status: "draft",
    excerpt: excerpt(model),
    spot: spot(model),
    featuredImage: `assets/columns/${slug}.svg`,
    featuredImageAlt: `${SHARE_IMAGE_TITLE} — ${fixtureLine(model)}`,
    body,
    en: {
      slug: slugForEn(model),
      title: headlineEn(model),
      seoTitle: seoTitleEn(model),
      metaDescription: metaDescriptionEn(model),
      excerpt: excerptEn(model),
      spot: spotEn(model),
      body: bodyEn
    },
    // KÖKEN: bu kaydın hangi maçtan ve hangi kapılardan geçerek doğduğu.
    generated: {
      by: "scripts/generate-trabzonspor-post-match-column.mjs",
      matchId: model.matchId,
      generatedAt: context.now || new Date().toISOString()
    }
  };

  const assessment = assessColumn(entry, verdict);
  const assessmentEn = { words: countWords(bodyEn) };
  entry.status = assessment.publishable ? "published" : "draft";

  return {
    entry,
    model,
    verdict,
    assessment: { ...assessment, wordsEn: assessmentEn.words },
    social: socialFor(model, entry),
    cover: coverSvg(model)
  };
}

module.exports = {
  AUTHOR,
  fixtureLine,
  CATEGORY,
  CONTENT_TYPE,
  DROP_ORDER,
  DROP_ORDER_EN,
  SHARE_IMAGE_TITLE,
  assessColumn,
  buildColumnEntry,
  clampMeta,
  coverSvg,
  dropSection,
  headline,
  headlineEn,
  metaDescription,
  seoTitle,
  signalOf,
  slugFor,
  slugForEn,
  trimBody
};
