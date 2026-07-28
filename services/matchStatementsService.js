/**
 * MAÇ SONU AÇIKLAMALARI — tek yetkili kural.
 *
 * Maç sonrası basın toplantısı ve karışık bölge sözleri; teknik direktör ve
 * futbolcuların KENDİ ağzından çıkan alıntılar.
 *
 * NEDEN AYRI BİR SERVİS: bu içerik sağlayıcıdan gelmiyor. API-Football ne
 * basın toplantısı ne alıntı döndürüyor; kayıt tamamen editoryal. Editoryal
 * olması "serbestçe yazılabilir" demek DEĞİL — tam tersine, uydurma riskinin
 * en yüksek olduğu yer burası. Bir maç istatistiğini uydurmak sayı hatasıdır;
 * bir insanın ağzına söylemediği bir cümleyi koymak başka bir şeydir.
 *
 * BU YÜZDEN KAPI SERT:
 *
 *   1. Alıntı, KİŞİ ve KAYNAK BAĞLANTISI olmadan yayımlanmaz. "Bir yetkili
 *      şöyle dedi" biçiminde atıfsız cümle geçmez.
 *   2. `status` açıkça "verified" olmalı. Varsayılan yayımlamak değil,
 *      yayımlamamaktır: alan eksikse kayıt elenir.
 *   3. Rol bilinen bir değer olmalı (teknik direktör / futbolcu). Bilinmeyen
 *      rol "yetkili" gibi bir şeye YUVARLANMAZ, kayıt elenir.
 *   4. Yalnızca BİTMİŞ maçlar açıklama taşır. Maç öncesi bir söz "maç sonu
 *      açıklaması" değildir; başlığın kendisi bir iddiadır.
 *   5. Hiç doğrulanmış açıklama yoksa bölüm GİZLENMEZ, "Kaynaklardan
 *      bekleniyor" yazar. Sessiz boşluk, okuyucuya "kimse konuşmadı" diye
 *      okunur; doğrusu "biz henüz doğrulamadık" demektir.
 *
 * Elenen her kayıt iç günlüğe yazılır — sessizce kaybolmaz.
 */

const { normalizeText } = require("./matchRadarService");

/** Okuyucuya gösterilecek tek bekleme ifadesi. */
const AWAITING_LABEL = "Kaynaklardan bekleniyor";

/**
 * Tanınan roller. Liste bilinçli olarak dar: rol, alıntının ağırlığını
 * belirleyen bir bilgidir ("teknik direktör kadro planını açıkladı" ile
 * "futbolcu maçı değerlendirdi" aynı şey değil) ve tahminle doldurulamaz.
 */
const ROLE_LABELS = {
  manager: "Teknik direktör",
  player: "Futbolcu"
};

const ROLE_ALIASES = {
  manager: "manager",
  "teknik direktor": "manager",
  "teknik direktör": "manager",
  coach: "manager",
  "head-coach": "manager",
  player: "player",
  futbolcu: "player",
  oyuncu: "player"
};

const COMPLETED_STATUSES = new Set(["FINISHED", "FT", "AET", "PEN"]);

/** Bandın taşıyabileceği en fazla öğe; şerit kalabalıklaşmamalı. */
const MAX_TICKER_ITEMS = 6;

/** Banda giren alıntı kısaltılır; tam metin maç sayfasında durur. */
const TICKER_QUOTE_LIMIT = 120;

function isCompleted(match) {
  return COMPLETED_STATUSES.has(String((match && match.status) || "").toUpperCase());
}

function text(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

function resolveRole(value) {
  return ROLE_ALIASES[normalizeText(value)] || null;
}

function isTraceableSource(value) {
  return /^https?:\/\//i.test(text(value));
}

/**
 * Tek bir açıklamayı değerlendirir.
 * @returns {{ok: true, statement: object} | {ok: false, reason: string}}
 */
function evaluateStatement(raw) {
  if (!raw || typeof raw !== "object") {
    return { ok: false, reason: "kayıt yok" };
  }

  const person = text(raw.person || raw.name);
  const team = text(raw.team);
  const quote = text(raw.quote);
  const sourceName = text(raw.sourceName);
  const sourceUrl = text(raw.sourceUrl);
  const role = resolveRole(raw.role);

  const missing = [];
  if (!person) missing.push("kişi");
  if (!role) missing.push("rol");
  if (!team) missing.push("takım");
  if (!quote) missing.push("alıntı");
  if (missing.length) {
    return { ok: false, reason: `zorunlu alan eksik: ${missing.join(", ")}` };
  }

  // Atıf zinciri: alıntının nereden alındığı gösterilemiyorsa yayımlanmaz.
  if (!sourceName) return { ok: false, reason: "kaynak adı yok" };
  if (!isTraceableSource(sourceUrl)) return { ok: false, reason: "izlenebilir kaynak bağlantısı yok" };

  if (normalizeText(raw.status) !== "verified") {
    return { ok: false, reason: `status "${text(raw.status) || "belirtilmemiş"}" (yalnızca "verified" yayımlanır)` };
  }

  return {
    ok: true,
    statement: {
      person,
      role,
      roleLabel: ROLE_LABELS[role],
      team,
      quote,
      sourceName,
      sourceUrl,
      publishedAt: text(raw.publishedAt) || null
    }
  };
}

function statementKey(statement) {
  return `${normalizeText(statement.person)}|${normalizeText(statement.quote)}`;
}

/**
 * Bir maçın yayımlanabilir açıklamaları.
 *
 * @param {object} match maç kaydı
 * @returns {{statements: Array, excluded: Array, awaiting: boolean, awaitingLabel: string}}
 */
function publishableStatements(match) {
  const raw = Array.isArray(match && match.statements) ? match.statements : [];
  const excluded = [];
  const statements = [];
  const seen = new Set();

  // Maç bitmediyse "maç sonu açıklaması" diye bir şey yoktur. Kayıt varsa da
  // yayımlanmaz; başlığın kendisi yanlış olurdu.
  if (!isCompleted(match)) {
    for (const item of raw) {
      excluded.push({ person: text(item && item.person) || "?", reason: "maç henüz bitmedi" });
    }
    return { statements: [], excluded, awaiting: true, awaitingLabel: AWAITING_LABEL };
  }

  for (const item of raw) {
    const verdict = evaluateStatement(item);
    if (!verdict.ok) {
      excluded.push({ person: text(item && item.person) || "?", reason: verdict.reason });
      continue;
    }

    const key = statementKey(verdict.statement);
    if (seen.has(key)) {
      excluded.push({ person: verdict.statement.person, reason: "tekrarlanan alıntı" });
      continue;
    }

    seen.add(key);
    statements.push(verdict.statement);
  }

  // En yeni açıklama önce. Zaman damgası olmayan kayıt sona düşer; sırayı
  // tahmin etmektense bilinen sıralamayı korumak doğru.
  statements.sort((left, right) => String(right.publishedAt || "").localeCompare(String(left.publishedAt || "")));

  return {
    statements,
    excluded,
    awaiting: statements.length === 0,
    awaitingLabel: AWAITING_LABEL
  };
}

/** İç günlük: elenen açıklama sessizce kaybolmaz. */
function logExcludedStatements(scope, excluded) {
  for (const item of excluded || []) {
    console.warn(`[futbolradar:statement-hidden] scope=${scope} person="${item.person}" reason="${item.reason}"`);
  }
}

function truncateQuote(quote, limit = TICKER_QUOTE_LIMIT) {
  const value = text(quote);
  if (value.length <= limit) return value;
  // Kelime ortasından kesme: okunmayan bir yarım kelime yerine son tam
  // kelimede durulur.
  const cut = value.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Bant için tek satırlık etiket: kim, hangi sıfatla, hangi takımdan. */
function statementAttribution(statement) {
  return `${statement.person} · ${statement.roleLabel} · ${statement.team}`;
}

/**
 * Ana sayfa bandı: birden çok maçın açıklamalarından kısa şerit.
 *
 * @param {Array} matches maç kayıtları
 * @param {object} [options] { limit, href } — href(match) bağlantı üretir
 * @returns {{items: Array, awaiting: boolean, awaitingLabel: string}}
 */
function statementTickerItems(matches, options = {}) {
  const limit = Number.isFinite(options.limit) ? options.limit : MAX_TICKER_ITEMS;
  const hrefFor = typeof options.href === "function" ? options.href : () => null;
  const items = [];

  const finished = (Array.isArray(matches) ? matches : [])
    .filter(isCompleted)
    .sort((left, right) => String(right.kickoff || "").localeCompare(String(left.kickoff || "")));

  for (const match of finished) {
    const { statements, excluded } = publishableStatements(match);
    logExcludedStatements("statement-ticker", excluded);

    for (const statement of statements) {
      items.push({
        matchId: match.id || null,
        attribution: statementAttribution(statement),
        quote: truncateQuote(statement.quote),
        fullQuote: statement.quote,
        person: statement.person,
        role: statement.role,
        roleLabel: statement.roleLabel,
        team: statement.team,
        sourceName: statement.sourceName,
        sourceUrl: statement.sourceUrl,
        publishedAt: statement.publishedAt,
        href: hrefFor(match)
      });

      if (items.length >= limit) break;
    }

    if (items.length >= limit) break;
  }

  return { items, awaiting: items.length === 0, awaitingLabel: AWAITING_LABEL };
}

module.exports = {
  AWAITING_LABEL,
  ROLE_LABELS,
  MAX_TICKER_ITEMS,
  TICKER_QUOTE_LIMIT,
  evaluateStatement,
  publishableStatements,
  logExcludedStatements,
  statementAttribution,
  statementTickerItems,
  truncateQuote
};
