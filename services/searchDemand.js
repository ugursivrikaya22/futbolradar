/**
 * SEARCH DEMAND CONTENT ENGINE — KURAL VE PUANLAMA KATMANI
 * ----------------------------------------------------------------------------
 * Amaç: içerik kararlarını "gündemde olduğunu düşündüğümüz" konulara göre
 * değil, GERÇEK arama talebine ve doğrulanabilir sinyallere göre vermek.
 *
 * Bu katmanın iki sert kuralı var ve ikisi de yapıya gömülü:
 *
 *   1. UYDURMA HACİM YOK. Bir fırsatın hiçbir puan boyutu, kanıt (evidence)
 *      göstermeden sıfırın üzerine çıkamaz. "Bu konu çok aranıyor" demek
 *      yetmez; hangi sinyalden geldiği (Search Console, autocomplete,
 *      site içi arama, fikstür verisi, kaynaklı haber) kayıtlı olmalı.
 *      Kanıtsız boyut 0 sayılır ve eksik veri olarak raporlanır — sessizce
 *      tahmine dönüşmez.
 *
 *   2. KESİNLEŞMEMİŞ TRANSFER, KESİNLEŞMİŞ GİBİ PAZARLANAMAZ. Transfer
 *      niyetli fırsatların başlık ve önerilerinde kesinlik fiilleri
 *      (imzaladı, resmen, duyurdu...) ancak doğrulanmış kayıt varsa
 *      kullanılabilir. Bu, ticker'daki kuralın (services/newsTicker.js)
 *      içerik planlamasına genişletilmiş hâlidir.
 *
 * Puanlama ağırlıkları ürün kararıdır ve tek yerde durur. Editoryal panel,
 * üretim planı ve testler hepsi bu sabitleri okur.
 */

/** Fırsat puanı ağırlıkları (toplam 100). */
const WEIGHTS = Object.freeze({
  demand: 25,          // Güncel arama talebi
  trendRise: 20,       // Arama trendindeki yükseliş
  turkeyRelevance: 15, // Türkiye ile ilgi
  siteFit: 10,         // FutbolRadar'ın mevcut içeriğiyle bağlantı
  beatableCompetition: 10, // Rekabetin aşılabilir olması
  timeSensitivity: 10, // İçeriğin zaman hassasiyeti
  internalLinks: 5,    // İç bağlantı potansiyeli
  longTerm: 5          // Uzun vadeli trafik potansiyeli
});

/** 75 ve üzeri yüksek öncelik. */
const HIGH_PRIORITY_THRESHOLD = 75;

/** Aciliyet/niyet sınıfları. Bir fırsat birden fazla etiket taşıyabilir. */
const CLASSIFICATIONS = Object.freeze([
  "breaking",            // Hemen yayımlanmalı
  "today",               // Aynı gün yayımlanmalı
  "evergreen",           // Kalıcı arama trafiği
  "match-intent",        // Maç odaklı arama
  "transfer-intent",     // Transfer odaklı arama
  "informational",       // Bilgi arayan kullanıcı
  "opinion",             // Köşe yazısı / yorum
  "commercial-potential" // Reklam değeri yüksek sorgu
]);

/** Desteklenen içerik türleri (arama niyetine göre seçilir). */
const CONTENT_TYPES = Object.freeze([
  "quick-news",     // Hızlı haber
  "match-guide",    // Maç rehberi (saat/kanal/11'ler/eksikler)
  "qa",             // Doğrudan soruya cevap veren açıklayıcı sayfa
  "column",         // Köşe yazısı
  "player-profile", // Oyuncu profili
  "team-file",      // Takım dosyası
  "comparison",     // Karşılaştırma
  "evergreen-guide",// Kalıcı rehber
  "transfer-hub",   // Transfer merkez sayfası (söylenti başına yeni sayfa YOK)
  "update-existing" // Yeni sayfa yerine mevcut sayfanın güncellenmesi
]);

/** Kanıt olarak kabul edilen sinyal kaynakları. */
const EVIDENCE_SOURCES = Object.freeze([
  "search-console",      // GSC Search Analytics API
  "google-trends",       // Trends gözlemi (elle veya API)
  "google-autocomplete", // Otomatik tamamlama önerisi
  "people-also-ask",     // Kullanıcılar bunları da sordu
  "related-searches",    // İlgili aramalar
  "site-search",         // Site içi arama kayıtları
  "site-traffic",        // FutbolRadar'da trafik alan mevcut sayfa
  "serp-observation",    // Rakiplerin sıralandığı, bizde içerik olmayan sorgu
  "social-trend",        // Sosyal medyada yükselen gündem
  "internal-fixtures",   // Doğrulanmış maç/fikstür verisi
  "internal-transfers",  // Doğrulanmış transfer kaydı
  "internal-news",       // Kaynaklı, doğrulanmış haber kaydı
  "manual-research"      // Kaynak bağlantılı elle araştırma
]);

/**
 * Kesinlik fiilleri — transfer niyetli fırsat başlıklarında ancak
 * doğrulanmış kayıt (confirmed) varsa geçebilir. services/newsTicker.js
 * ile bilinçli olarak aynı liste; iki katman aynı dili konuşmalı.
 */
const CONFIRMATION_VERBS = [
  "resmen",
  "imzaladı",
  "imzayı attı",
  "duyurdu",
  "kesinleşti",
  "anlaşma sağlandı",
  "transferi tamamlandı",
  "resmi açıklama"
];

function text(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

function lower(value) {
  return text(value).toLocaleLowerCase("tr");
}

function clampScore(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(100, num));
}

/**
 * Tek bir kanıt kaydını doğrular: kaynak türü bilinmeli ve izlenebilir bir
 * referans (url ya da iç veri yolu) taşımalı.
 */
function validateEvidence(entry) {
  const errors = [];
  if (!entry || typeof entry !== "object") {
    return { valid: false, errors: ["kanıt kaydı nesne değil"] };
  }
  const source = text(entry.source);
  if (!source) errors.push("kanıt kaynağı (source) yok");
  else if (!EVIDENCE_SOURCES.includes(source)) errors.push(`bilinmeyen kanıt kaynağı: ${source}`);

  const ref = text(entry.ref);
  if (!ref) {
    errors.push("kanıt referansı (ref) yok — url ya da iç veri yolu gerekli");
  } else if (source === "manual-research" && !/^https?:\/\//i.test(ref)) {
    errors.push("manual-research kanıtı doğrulanabilir bir URL taşımalı");
  }

  if (!text(entry.note)) errors.push("kanıt notu (note) yok — sinyalin ne söylediği yazılmalı");
  return { valid: errors.length === 0, errors };
}

/**
 * Fırsat puanı. Her boyut 0-100 arası bir değer VE en az bir kanıt ister.
 * Kanıtsız boyut sıfırlanır ve `missingData` içinde raporlanır.
 *
 * @param {Object} dimensions {demand: {value, evidence: [..]}, ...}
 * @returns {{score:number, breakdown:Object, missingData:string[]}}
 */
function computeOpportunityScore(dimensions) {
  const input = dimensions && typeof dimensions === "object" ? dimensions : {};
  const breakdown = {};
  const missingData = [];
  let total = 0;

  for (const [key, weight] of Object.entries(WEIGHTS)) {
    const dim = input[key];
    const rawValue = dim && typeof dim === "object" ? dim.value : dim;
    const evidence = dim && typeof dim === "object" && Array.isArray(dim.evidence) ? dim.evidence : [];
    const validEvidence = evidence.filter((entry) => validateEvidence(entry).valid);

    let value = clampScore(rawValue);
    if (value > 0 && !validEvidence.length) {
      // UYDURMA HACİM YOK: kanıtsız iddia puana dönüşmez.
      value = 0;
      missingData.push(key);
    }

    const contribution = (value * weight) / 100;
    breakdown[key] = { value, weight, contribution: Math.round(contribution * 10) / 10, evidenceCount: validEvidence.length };
    total += contribution;
  }

  return { score: Math.round(total), breakdown, missingData };
}

/** Puan sınıfı: yüksek öncelik eşiği tek yerde. */
function isHighPriority(score) {
  return Number(score) >= HIGH_PRIORITY_THRESHOLD;
}

/**
 * Tam fırsat kaydını doğrular (data/search-demand/opportunities.json).
 * Geçersiz kayıt panele ve üretim planına giremez.
 */
function validateOpportunity(entry) {
  const errors = [];
  if (!entry || typeof entry !== "object") {
    return { valid: false, errors: ["kayıt nesne değil"] };
  }

  if (!text(entry.id)) errors.push("id yok");
  if (!text(entry.query)) errors.push("hedef sorgu (query) yok");
  if (!text(entry.suggestedTitle)) errors.push("önerilen başlık yok");

  const contentType = text(entry.contentType);
  if (!contentType) errors.push("contentType yok");
  else if (!CONTENT_TYPES.includes(contentType)) errors.push(`bilinmeyen contentType: ${contentType}`);

  const classifications = Array.isArray(entry.classifications) ? entry.classifications : [];
  if (!classifications.length) errors.push("en az bir sınıflandırma etiketi gerekli");
  for (const label of classifications) {
    if (!CLASSIFICATIONS.includes(label)) errors.push(`bilinmeyen sınıflandırma: ${label}`);
  }

  const decision = text(entry.decision);
  if (!["new", "update"].includes(decision)) {
    errors.push('decision "new" ya da "update" olmalı — kanibalizasyon kontrolü atlanamaz');
  }
  if (decision === "update" && !text(entry.existingPage)) {
    errors.push("update kararı existingPage göstermeli");
  }

  const evidence = Array.isArray(entry.evidence) ? entry.evidence : [];
  if (!evidence.length) {
    errors.push("kanıt yok — kanıtsız fırsat listeye giremez");
  } else {
    evidence.forEach((item, index) => {
      const verdict = validateEvidence(item);
      if (!verdict.valid) errors.push(`kanıt[${index}]: ${verdict.errors.join("; ")}`);
    });
  }

  // Kesinleşmemiş transfer fırsatı kesinlik diliyle başlıklanamaz.
  if (classifications.includes("transfer-intent") && entry.transferStatus !== "confirmed") {
    const haystack = lower(entry.suggestedTitle);
    const hit = CONFIRMATION_VERBS.find((verb) => haystack.includes(verb));
    if (hit) {
      errors.push(`kesinleşmemiş transfer fırsatının başlığında kesinlik ifadesi var ("${hit}")`);
    }
  }

  if (!Array.isArray(entry.linkTargets) || entry.linkTargets.length < 3) {
    errors.push("en az 3 iç bağlantı hedefi gerekli — yetim sayfa üretilmez");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * İçerik planı kaydını doğrular (data/search-demand/content-plan.json).
 * İnce/boş sayfa koruması burada: bölüm ve içerik alt sınırı yapısal.
 */
function validateContentPlanEntry(entry) {
  const errors = [];
  if (!entry || typeof entry !== "object") {
    return { valid: false, errors: ["kayıt nesne değil"] };
  }

  const slug = text(entry.slug);
  if (!slug) errors.push("slug yok");
  else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    errors.push(`slug Türkçe karakter/boşluk içeremez: ${slug}`);
  }

  const type = text(entry.type);
  if (!["match-guide", "transfer-hub", "qa", "evergreen-guide", "dashboard"].includes(type)) {
    errors.push(`bilinmeyen sayfa türü: ${type}`);
  }

  if (!text(entry.title)) errors.push("title yok");
  if (!text(entry.description)) errors.push("description yok");
  if (text(entry.description).length > 170) errors.push("description 170 karakteri aşmamalı");
  if (!text(entry.h1)) errors.push("h1 yok");
  if (!text(entry.updatedAt)) errors.push("updatedAt yok — güncellik görünür olmalı");

  if (type !== "dashboard") {
    const sections = Array.isArray(entry.sections) ? entry.sections : [];
    if (sections.length < 2) errors.push("en az 2 içerik bölümü gerekli — ince sayfa üretilmez");
    const totalLength = sections.reduce((sum, section) => {
      const paragraphs = Array.isArray(section.paragraphs) ? section.paragraphs : [];
      return sum + paragraphs.join(" ").length;
    }, 0);
    if (totalLength < 600) errors.push("içerik gövdesi çok kısa — kullanıcıya gerçek cevap vermeli");

    const answer = text(entry.directAnswer);
    if (!answer) errors.push("directAnswer yok — ilk ekran arama niyetini karşılamalı");

    if (!Array.isArray(entry.internalLinks) || entry.internalLinks.length < 3) {
      errors.push("en az 3 iç bağlantı gerekli");
    }

    const needsSources = ["match-guide", "transfer-hub", "qa", "evergreen-guide"].includes(type);
    const sources = Array.isArray(entry.sources) ? entry.sources : [];
    if (needsSources && !sources.length) errors.push("kaynak gösterilmeli");
    for (const source of sources) {
      if (!text(source.name) || !/^https?:\/\//i.test(text(source.url))) {
        errors.push("kaynaklar ad ve http(s) bağlantısı taşımalı");
      }
    }
  }

  // Transfer merkez sayfası: iddialar güven seviyesiyle etiketlenmeli ve
  // kesinleşmemiş dosya kesinlik diliyle başlıklanamaz.
  if (type === "transfer-hub") {
    const claims = Array.isArray(entry.claims) ? entry.claims : [];
    if (!claims.length) errors.push("transfer-hub en az bir durum kaydı (claims) taşımalı");
    for (const claim of claims) {
      if (!["confirmed", "reported", "rumour", "denied"].includes(text(claim.confidence))) {
        errors.push("transfer iddiası güven seviyesi confirmed/reported/rumour/denied olmalı");
      }
      if (!text(claim.statement)) errors.push("transfer iddiası ifadesi boş olamaz");
      if (["reported", "rumour"].includes(text(claim.confidence))) {
        const hit = CONFIRMATION_VERBS.find((verb) => lower(claim.statement).includes(verb));
        if (hit) errors.push(`kesinleşmemiş iddiada kesinlik ifadesi var ("${hit}")`);
      }
    }
    if (entry.overallStatus === "confirmed") {
      const anyConfirmed = claims.some((claim) => text(claim.confidence) === "confirmed");
      if (!anyConfirmed) errors.push("overallStatus confirmed ama doğrulanmış kayıt yok");
    }
  }

  return { valid: errors.length === 0, errors };
}

module.exports = {
  WEIGHTS,
  HIGH_PRIORITY_THRESHOLD,
  CLASSIFICATIONS,
  CONTENT_TYPES,
  EVIDENCE_SOURCES,
  CONFIRMATION_VERBS,
  computeOpportunityScore,
  isHighPriority,
  validateEvidence,
  validateOpportunity,
  validateContentPlanEntry
};
