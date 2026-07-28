/**
 * MAÇ SONU AÇIKLAMALARI — ORTAK İŞARETLEME.
 *
 * İki biçim üretir:
 *   • kayan şerit (ana sayfa canlı maç alanı ve maç sayfası başı)
 *   • tam liste (maç sayfası)
 *
 * Kural services/matchStatementsService.js'de; burada yalnızca çizim var.
 * Hiç doğrulanmış açıklama yoksa BÖLÜM GİZLENMEZ: "Kaynaklardan bekleniyor"
 * yazan bir durum kutusu basılır. Sessiz boşluk okuyucuya "kimse konuşmadı"
 * diye okunur; doğrusu "biz henüz doğrulamadık".
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { AWAITING_LABEL } = require("../../services/matchStatementsService.js");

function escapeHtml(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function awaitingHtml(note) {
  return `<div class="statements-awaiting" data-statements-state="awaiting">
      <strong>${escapeHtml(AWAITING_LABEL)}</strong>
      <span>${escapeHtml(note || "Doğrulanmış bir maç sonu açıklaması yayımlandığında burada gösterilecek.")}</span>
    </div>`;
}

function tickerItemHtml(item) {
  const quote = `<span class="statements-quote">${escapeHtml(`“${item.quote}”`)}</span>`;
  const who = `<span class="statements-who">${escapeHtml(item.attribution)}</span>`;
  const body = `${who}${quote}`;

  // Bağlantı varsa maç sayfasına, yoksa doğrudan kaynağa. Kaynağa çıkan
  // bağlantı dış bağlantıdır ve öyle işaretlenir.
  if (item.href) {
    return `<a class="statements-item" href="${escapeHtml(item.href)}">${body}</a>`;
  }
  return `<a class="statements-item" href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">${body}</a>`;
}

/**
 * Kayan şerit.
 *
 * Şerit iki kez basılır (ikincisi aria-hidden): CSS animasyonu kesintisiz
 * dönsün diye. Aynı desen son dakika bandında da kullanılıyor.
 */
export function statementsMarqueeHtml(feed, options = {}) {
  const items = (feed && Array.isArray(feed.items) ? feed.items : []).filter(Boolean);
  const label = options.label || "Maç Sonu Açıklamaları";

  const inner = items.length
    ? (() => {
      const track = items.map(tickerItemHtml).join('<span class="statements-sep" aria-hidden="true"></span>');
      return `<div class="statements-viewport">
          <div class="statements-track">
            <div class="statements-group">${track}</div>
            <div class="statements-group" aria-hidden="true">${track}</div>
          </div>
        </div>`;
    })()
    : `<div class="statements-viewport is-empty">${awaitingHtml(options.awaitingNote)}</div>`;

  return `<div class="statements-marquee" data-card="match-statements" aria-label="${escapeHtml(label)}">
      <span class="statements-badge">${escapeHtml(label)}</span>
      ${inner}
    </div>`;
}

/** Tam liste: alıntının tamamı, kim söyledi ve hangi kaynaktan. */
export function statementsListHtml(result, options = {}) {
  const statements = (result && Array.isArray(result.statements) ? result.statements : []).filter(Boolean);

  if (!statements.length) {
    return awaitingHtml(options.awaitingNote);
  }

  const rows = statements.map((statement) => {
    const when = statement.publishedAt ? String(statement.publishedAt).slice(0, 10) : "";
    return `<article class="statement-card" data-role="${escapeHtml(statement.role)}">
      <header class="statement-head">
        <strong>${escapeHtml(statement.person)}</strong>
        <span class="statement-role">${escapeHtml(statement.roleLabel)}</span>
        <span class="statement-team">${escapeHtml(statement.team)}</span>
      </header>
      <blockquote class="statement-quote">${escapeHtml(statement.quote)}</blockquote>
      <footer class="statement-source">
        <a href="${escapeHtml(statement.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(statement.sourceName)}</a>
        ${when ? `<span>${escapeHtml(when)}</span>` : ""}
      </footer>
    </article>`;
  }).join("");

  return `<div class="statements-list" data-statements-state="ready">${rows}</div>`;
}

export { AWAITING_LABEL, escapeHtml };
