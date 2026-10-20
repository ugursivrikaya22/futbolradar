/**
 * ÖNE ÇIKAN KÖŞE YAZISI — "KÖŞE NOTU" (bu akşamın maçı).
 *
 * Ana sayfadaki öne çıkan köşe yazısı bölümünün içinde, kartın altında
 * duran kısa satır: "Bu akşam 20.00 · Papara Park — Trabzonspor–Beşiktaş".
 *
 * ELLE YAZILMAZ. Veri, ana sayfa maç vitrininin (scripts/generate-featured-
 * match-spotlight.mjs) zaten seçtiği maçtan gelir: takımlar, başlama saati,
 * stadyum ve kalıcı maç sayfası. Not yalnızca şu koşullarda basılır:
 *   • vitrin bir maç seçmiş ve maç ana sayfada gösterilebilir (pre/live),
 *   • maç BUGÜN (İstanbul saatiyle) oynanıyor,
 *   • başlama saatinin üzerinden NOTE_DWELL_MS (2 saat) geçmemiş,
 *   • iki takım adı ve geçerli bir başlama saati var.
 * Aksi hâlde BOŞ DİZE döner; üretici notu `hidden` yapar. Derleme saatlik
 * koştuğu için aynı son kullanma damgası (`data-expires-at`) istemcide de
 * uygulanır (featured-match-spotlight.js).
 */

export const NOTE_DWELL_MS = 2 * 60 * 60 * 1000;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function istanbulParts(ms) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date(ms));
  const get = (type) => (parts.find((part) => part.type === type) || {}).value || "";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")), time: `${get("hour")}.${get("minute")}` };
}

/**
 * @param {object|null} match  { homeTeam, awayTeam, kickoff, venue, phase, href }
 *        `href` yalnızca maç sayfası diskte varsa verilir; yoksa not bağlantısız basılır.
 * @param {number} nowMs
 * @returns {{ html: string, expiresAt: string }}
 */
export function featuredColumnNote(match, nowMs = Date.now()) {
  const empty = { html: "", expiresAt: "" };
  if (!match || !match.homeTeam || !match.awayTeam) return empty;
  if (!["pre", "live"].includes(match.phase)) return empty;
  const kickoffMs = Date.parse(match.kickoff);
  if (!Number.isFinite(kickoffMs)) return empty;
  const expiresMs = kickoffMs + NOTE_DWELL_MS;
  if (nowMs >= expiresMs) return empty;
  const kickoff = istanbulParts(kickoffMs);
  if (kickoff.day !== istanbulParts(nowMs).day) return empty;

  const when = `${kickoff.hour >= 17 ? "Bu akşam" : "Bugün"} ${kickoff.time}`;
  const fixture = `${match.homeTeam}–${match.awayTeam}`;
  const expiresAt = new Date(expiresMs).toISOString();
  const inner = `<time datetime="${escapeHtml(match.kickoff)}">${escapeHtml(when)}</time>`
    + (match.venue ? ` · ${escapeHtml(match.venue)}` : "")
    + ` — <strong>${escapeHtml(fixture)}</strong>`;
  const body = match.href
    ? `<a class="home-featured-column__note-link" href="${escapeHtml(match.href)}">${inner} <span aria-hidden="true">→</span></a>`
    : `<span class="home-featured-column__note-link">${inner}</span>`;
  return {
    html: `<p class="home-featured-column__note-text" data-expires-at="${escapeHtml(expiresAt)}"><span class="home-featured-column__note-kicker">Köşe notu</span> ${body}</p>`,
    expiresAt
  };
}

/** Ana sayfa HTML'inde not slot'unu doldurur ve kabuğun `hidden` durumunu ayarlar. */
export function applyFeaturedColumnNote(html, noteHtml) {
  const start = "<!-- prerender:home-featured-column-note:start -->";
  const end = "<!-- prerender:home-featured-column-note:end -->";
  if (!html.includes(start) || !html.includes(end)) return html;
  const startAt = html.indexOf(start) + start.length;
  const endAt = html.indexOf(end, startAt);
  let next = `${html.slice(0, startAt)}\n${noteHtml}\n${html.slice(endAt)}`;
  const tag = (next.match(/<aside\b[^>]*\bdata-featured-column-note\b[^>]*>/) || [])[0];
  if (tag) {
    const hidden = /\s+hidden(?=[\s>])/.test(tag);
    const wanted = noteHtml.trim()
      ? tag.replace(/\s+hidden(?=[\s>])/, "")
      : (hidden ? tag : tag.replace(/>$/, " hidden>"));
    next = next.replace(tag, wanted);
  }
  return next;
}
