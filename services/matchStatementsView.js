/**
 * MAÇ SONU AÇIKLAMALARI — SUNUM KATMANI (salt okunur).
 *
 * Modül SAF: dosya okumaz, ağ çağırmaz, hiçbir şey yazmaz. Girdi olarak
 * `services/matchStatementService.js` çıktısını alır, HTML döndürür.
 *
 * İki kural:
 *
 *   1. BÖLÜM GİZLENMEZ. Açıklama yoksa bölüm sayfadan kaldırılmıyor; açıkça
 *      "doğrulanmış açıklama bekleniyor" yazıyor. Bölümü gizlemek, okuyucuya
 *      "böyle bir şey yok" demek olurdu; oysa doğru cümle "henüz doğrulanmış
 *      bir kaydımız yok".
 *   2. HER SÖZ KAYNAĞINI TAŞIR. Konuşan, rolü, takımı, tarihi ve sözün
 *      yayımlandığı adres birlikte yazılır. Kaynaksız söz basılmaz — o karar
 *      zaten matchStatementService'de veriliyor, burada yalnızca gösteriliyor.
 */

const { trustBadges, statementTrustLabels } = require("./trustLabels.js");
const { relativeAgeLabel } = require("./contentFreshness.js");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatStatementDate(value) {
  const parsed = new Date(String(value || ""));
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat("tr-TR", {
    day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul"
  }).format(parsed);
}

/** Tek bir sözün kartı. */
function statementCard(statement) {
  const stamp = formatStatementDate(statement.publishedAt);
  const time = stamp
    ? `<time datetime="${escapeHtml(statement.publishedAt)}">${escapeHtml(stamp)}</time>`
    : "";
  const context = statement.context
    ? `<span class="match-statement-context">${escapeHtml(statement.context)}</span>`
    : "";

  // Hangi maçtan sonra söylendiği kartta yazar: bülten ve bant kartı maç
  // sayfasının dışında da gösteriyor, orada bağlam kaybolurdu.
  const match = statement.matchLabel
    ? `<span class="match-statement-match">${escapeHtml(statement.matchLabel)}</span>`
    : "";
  const age = statement.publishedAt
    ? `<span class="match-statement-age">${escapeHtml(relativeAgeLabel(statement.publishedAt))}</span>`
    : "";

  return `<article class="card match-statement" data-card="match-statement" data-role="${escapeHtml(statement.role)}">
    <div class="match-statement-head">
      <span class="match-statement-role">${escapeHtml(statement.roleLabel)}</span>
      <strong class="match-statement-speaker">${escapeHtml(statement.speaker)}</strong>
      <span class="match-statement-team">${escapeHtml(statement.team)}</span>
      ${trustBadges(statementTrustLabels(statement))}
    </div>
    ${match}
    <blockquote class="match-statement-quote"><p>${escapeHtml(statement.quote)}</p></blockquote>
    <div class="match-statement-foot">
      ${context}${time}${age}
      <a class="detail-link" href="${escapeHtml(statement.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(statement.sourceName)} kaynağını aç</a>
    </div>
  </article>`;
}

/** Açıklama yokken basılan tek kart. Sayı ya da iddia taşımaz. */
function awaitingCard(matchLabel) {
  const subject = matchLabel ? `${matchLabel} için ` : "";
  return `<article class="card data-empty" data-card="empty-state">
    <strong>Doğrulanmış açıklama bekleniyor</strong>
    <span>${escapeHtml(`${subject}teknik direktör ve futbolcu sözleri, kulüp veya resmî kaynak yayımladığı anda kaynağıyla birlikte burada listelenecek. Doğrulanmamış söz yayımlanmaz.`)}</span>
  </article>`;
}

/**
 * "Maç Sonu Açıklamaları" bölümünün tamamı.
 *
 * @param {Array} statements matchStatementService.statementsForMatch çıktısı
 * @param {{matchLabel?: string, headingId?: string}} options
 * @returns {string} HTML
 */
function statementsSection(statements, options = {}) {
  const list = Array.isArray(statements) ? statements : [];
  const headingId = options.headingId || "mac-sonu-aciklamalari";
  const matchLabel = options.matchLabel || "";

  const lead = list.length
    ? "Teknik direktör ve futbolcu sözleri; her biri yayımlandığı kaynağa bağlıdır."
    : "Sözler yalnızca doğrulanmış kaynaktan yayımlanır; kayıt oluşmadan bu alan doldurulmaz.";

  const body = list.length
    ? `<div class="match-statement-grid">${list.map(statementCard).join("")}</div>`
    : awaitingCard(matchLabel);

  return `<section class="post-match-section match-statements" aria-labelledby="${escapeHtml(headingId)}">
    <div class="section-head"><div class="section-title">
      <span class="section-kicker">Maç sonu</span>
      <h2 id="${escapeHtml(headingId)}">Maç Sonu Açıklamaları</h2>
      <p>${escapeHtml(lead)}</p>
    </div></div>
    ${body}
  </section>`;
}

/**
 * Yapılandırılmış veri: yalnızca GERÇEK sözler için `Quotation` düğümü.
 * Söz yoksa hiçbir düğüm üretilmez — arama motoruna boş bir iddia yazmak,
 * görünür sayfada uydurmaktan daha tehlikelidir.
 */
function statementsSchema(statements, pageUrl) {
  const list = Array.isArray(statements) ? statements : [];
  if (!list.length) return [];

  return list.map((statement) => ({
    "@type": "Quotation",
    text: statement.quote,
    spokenByCharacter: { "@type": "Person", name: statement.speaker },
    datePublished: statement.publishedAt,
    isPartOf: pageUrl || undefined,
    citation: statement.url
  }));
}

module.exports = { statementsSchema, statementsSection };
