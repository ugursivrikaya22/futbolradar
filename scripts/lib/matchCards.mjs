/**
 * MAÇ VE TAKIM KARTLARI — TEK BİLEŞEN, İKİ DİL.
 *
 * `.fixture-card`, `.fixture-row`, `.trend-card` ve transfer paneli
 * işaretlemesi iki üreticide birden yazılmıştı: Türkçe sayfalar için
 * prerender-core-pages.mjs, İngilizce sayfalar için generate-en-pages.mjs.
 * İki kopya, Türkçe tarafta yapılan her kart değişikliğinin İngilizce
 * tarafta SESSİZCE eksik kalması demekti — tam da iki dilli sürümün
 * yasaklaması gereken şey.
 *
 * Kural: işaretleme BURADA, bir kez. Metinler sözlükten (`t(key, locale)`),
 * durum etiketi gibi dil+veri bileşimleri çağırandan gelir. Türkçe çıktı
 * birebir korunur: buradaki şablonlar prerender'daki eski şablonların
 * karakteri karakterine taşınmış hâlidir; sözlükteki Türkçe karşılıklar
 * eski sabit dizgelerle aynıdır.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { normalizeLocale, t } = require("../../services/i18n.js");

export function escapeHtml(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function fixtureTeamInitials(name) {
  const clean = String(name || "").trim();
  if (!clean) return "?";
  const parts = clean.split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("") || clean.charAt(0).toUpperCase();
}

/**
 * Lig rozeti. Renk sınıfı lig adının kararlı karmasından türetilir; aynı
 * lig her sayfada aynı renktedir. İstemcideki `leagueMarkHtml` ile aynı
 * kural (app.js).
 */
export function leagueMarkHtml(league) {
  const name = String(league || "").trim();
  if (!name) return "";

  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toLocaleUpperCase("tr"))
    .join("");

  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) % 997;
  }

  return `<i class="league-mark league-mark-${hash % 5}" aria-hidden="true">${escapeHtml(initials)}</i>`;
}

export function fixtureRow(name, score, otherScore) {
  const winner = score !== null && otherScore !== null && Number(score) > Number(otherScore);
  return `<div class="fixture-row${winner ? " is-winner" : ""}">` +
    `<span class="fixture-row-fallback" aria-hidden="true">${escapeHtml(fixtureTeamInitials(name))}</span>` +
    `<span class="fixture-row-name">${escapeHtml(name)}</span>` +
    `<span class="fixture-row-score">${escapeHtml(score === null ? "–" : score)}</span>` +
    `</div>`;
}

/**
 * Maç kartı.
 *
 * Durum ETİKETİ çağırandan gelir: Türkçe taraf kendi durum sözlüğünü ve
 * başlık önceliğini uygular, İngilizce taraf `statusLabelFor` kullanır.
 * Bileşen yalnızca işaretlemeyi sahiplenir — davranış farkı veriden,
 * görünüm farkı buradan doğamaz.
 *
 * @param {object} options
 *   id           data-match değeri (yoksa öznitelik yazılmaz)
 *   league       lig adı (görünen)
 *   live         kart canlı vurgusu alsın mı
 *   stateClass   "is-live" | "is-final" | ""
 *   stateLabel   görünen durum metni
 *   homeTeam/awayTeam, homeScore/awayScore (null = skor yok)
 *   formHtml     hazır form bloğu (yalnızca Türkçe tarafta dolu)
 *   actionHref   kart altındaki bağlantının hedefi
 *   withMatchClick  data-match-click özniteliği (analytics; Türkçe taraf)
 *   locale
 */
export function fixtureCard(options) {
  const locale = normalizeLocale(options.locale);
  const leagueLabel = options.league || t("card.leagueFallback", locale);
  return `<article class="fixture-card${options.live ? " is-live" : ""}" data-card="fixture"${options.id ? ` data-match="${escapeHtml(options.id)}"` : ""}>
    <div class="fixture-card-top"><span class="fixture-card-league">${leagueMarkHtml(leagueLabel)}${escapeHtml(leagueLabel)}</span><span class="fixture-card-state ${options.stateClass || ""}">${escapeHtml(options.stateLabel || "")}</span></div>
    <div class="fixture-card-rows">${fixtureRow(options.homeTeam, options.homeScore, options.awayScore)}${fixtureRow(options.awayTeam, options.awayScore, options.homeScore)}</div>
    ${options.formHtml ? `<div class="fixture-card-meta">${options.formHtml}</div>` : ""}
    <a class="fixture-card-action" href="${escapeHtml(options.actionHref)}"${options.withMatchClick ? " data-match-click" : ""}>${escapeHtml(t("card.openMatchDetail", locale))}</a>
  </article>`;
}

/**
 * LİG BLOĞU (.league-match-group).
 *
 * İstemci maç programı sayfasını lig bloklarına ayırıyor, statik yedek ise
 * kartları tek uzun liste hâlinde basıyordu. İki sonucu vardı: JavaScript
 * yüklendiğinde liste yeniden çiziliyor ve sayfa yerinden oynuyordu; ve
 * tarayıcı yalnızca statik hâli gördüğü için hangi maçın hangi turnuvaya
 * ait olduğu HTML'de hiç yazmıyordu.
 *
 * İşaretleme istemcideki `renderMatchesByLeague` ile bilerek özdeştir.
 * Sayı etiketi ("12 maç") çağırandan gelir; dil farkı buradan doğamaz.
 */
export function leagueMatchGroup(options) {
  const league = String(options.league || "");
  return `<section class="league-match-group league-block" data-league-group="${escapeHtml(league)}">` +
    `<div class="league-block-head"><span class="league-block-title">${escapeHtml(league)}</span>` +
    `<b class="league-block-count">${escapeHtml(options.countLabel || "")}</b></div>` +
    `<div class="league-match-grid">${options.cardsHtml || ""}</div>` +
    `</section>`;
}

/**
 * Trend takım kartı (.trend-card). Form noktaları çağırandan hazır gelir:
 * Türkçe noktalar G/B/M, İngilizce W/D/L harfleriyle çizilir.
 */
export function trendCard(options) {
  const locale = normalizeLocale(options.locale);
  const action = options.actionHref
    ? `<a class="fixture-card-action" href="${escapeHtml(options.actionHref)}">${escapeHtml(t("card.openTeamRadar", locale))}</a>`
    : "";
  return `<article class="trend-card" data-card="trend-team"${options.id ? ` data-team="${escapeHtml(options.id)}"` : ""}>
      <div class="trend-card-head"><span class="trend-card-avatar" aria-hidden="true">${escapeHtml(fixtureTeamInitials(options.name))}</span><span><strong>${escapeHtml(options.name)}</strong><span>${escapeHtml(options.leagueLabel || t("card.teamFallback", locale))}</span></span><b class="trend-card-score">${escapeHtml(options.momentum ?? "–")}</b></div>
      ${options.formDotsHtml || ""}
      <dl class="trend-card-stats"><div><dt>${escapeHtml(t("trend.attack", locale))}</dt><dd>${escapeHtml(options.attack ?? "–")}</dd></div><div><dt>${escapeHtml(t("trend.defence", locale))}</dt><dd>${escapeHtml(options.defense ?? "–")}</dd></div><div><dt>${escapeHtml(t("trend.form", locale))}</dt><dd>${escapeHtml(options.formScore ?? "–")}</dd></div></dl>
      ${action}
    </article>`;
}

/**
 * Ana sayfa transfer paneli (.home-transfer-watch-shell içeriği).
 * Satır bağlantı hedefleri çağırandan gelir; Türkçe taraf transfer-radari
 * sayfasına, İngilizce taraf kaynağa ya da kendi köküne bağlar.
 */
/**
 * Bölüm başlığı — `.section-head` düzeni Türkçe ve İngilizce sayfalarda
 * aynı. Üç EN üretici (ana sayfa, takım, maç/oyuncu) bunu ayrı ayrı
 * yazıyordu; artık tek yerde.
 */
export function sectionHead(options) {
  const locale = normalizeLocale(options.locale);
  const link = options.linkHref
    ? `<a class="section-link" href="${escapeHtml(options.linkHref)}">${escapeHtml(options.linkText || t("common.viewAll", locale))}</a>`
    : "";
  return `<div class="section-head"><div class="section-title"><span class="section-kicker">${escapeHtml(options.kicker)}</span><h2 id="${escapeHtml(options.titleId)}">${escapeHtml(options.title)}</h2>${options.lead ? `<p>${escapeHtml(options.lead)}</p>` : ""}</div>${link}</div>`;
}

/** Form noktaları (.form-dots). `win/draw/loss` çağırandan hazır gelir. */
export function formDotsHtml(form, locale) {
  const list = Array.isArray(form) ? form : [];
  if (!list.length) return "";
  const map = normalizeLocale(locale) === "en" ? { win: "W", draw: "D", loss: "L" } : { win: "G", draw: "B", loss: "M" };
  return `<span class="form-dots">${list
    .map((entry) => `<span class="form-dot ${escapeHtml(entry.result || "draw")}">${escapeHtml(map[entry.result] || map.draw)}</span>`)
    .join("")}</span>`;
}

export function transferWatchShell(options) {
  const locale = normalizeLocale(options.locale);
  const leader = options.leader;
  const sideRows = (options.rows || []).map((row) =>
    `<a class="home-transfer-row" href="${escapeHtml(row.href)}"><span>${escapeHtml(row.date || "")}</span><strong>${escapeHtml(row.playerName)}</strong><b>${escapeHtml(row.toTeam)}</b></a>`).join("");
  const leaderActions = [
    leader.sourceUrl
      ? `<a class="detail-link" href="${escapeHtml(leader.sourceUrl)}" target="_blank" rel="nofollow noopener noreferrer">${escapeHtml(t("transfer.openDetail", locale))}</a>`
      : "",
    options.allHref
      ? `<a class="detail-link ghost" href="${escapeHtml(options.allHref)}">${escapeHtml(t("transfer.all", locale))}</a>`
      : ""
  ].filter(Boolean).join("");

  return `<article class="home-transfer-feature" data-card="home-transfer-watch"><div class="home-transfer-player"><div><span>${escapeHtml(t("transfer.latestConfirmed", locale))}</span><h3>${escapeHtml(leader.playerName)}</h3><p>${escapeHtml(leader.typeLabel || t("transfer.fallbackType", locale))} · ${escapeHtml(leader.date || "")}</p></div></div><div class="home-transfer-route"><b>${escapeHtml(leader.fromTeam || "—")}</b><em>→</em><b>${escapeHtml(leader.toTeam)}</b></div>${leaderActions ? `<div class="home-transfer-actions">${leaderActions}</div>` : ""}</article><aside class="home-transfer-side"><div class="home-transfer-list">${sideRows}</div></aside>`;
}
