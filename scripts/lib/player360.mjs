/**
 * FUTBOLCU 360 — TEK GÖRÜNÜM KATMANI.
 *
 * `services/player360Service.js` modeli kurar, bu dosya onu HTML'e çevirir.
 * TÜRKÇE VE İNGİLİZCE ÜRETİCİLER AYNI FONKSİYONU ÇAĞIRIR: iki dilde iki ayrı
 * bölüm listesi, iki ayrı gerçek demektir. Dil farkı yalnızca sözlükten
 * (locales/*.json → `player360.*`) gelir.
 *
 * H2 BAŞLIKLARI SÖZLEŞMEDİR. Sayfanın H1'i yalnızca oyuncunun adıdır; her
 * bölüm başlığı "<Oyuncu> <konu>" kalıbını izler. Bu, uzun kuyruklu aramanın
 * ("Osimhen son maçları", "Osimhen sakatlık durumu") sayfada birebir
 * karşılığını bulması için; başlıkların sırası ve kalıbı bu yüzden
 * scripts/test-player-360.mjs tarafından denetleniyor.
 *
 * SIFIR BAĞIMLILIK, SIFIR İSTEMCİ JS'İ. Form grafiği satır içi SVG olarak
 * basılır: grafik kütüphanesi yok, ek istek yok, düzen kayması yok.
 * Bölümler sunucuda basıldığı için arama motorunun gördüğü HTML ile
 * kullanıcının gördüğü HTML aynıdır.
 *
 * VERİ YOKSA MODÜL SUSAR. Her bölüm ya gerçek veriyle çizilir, ya açıkça
 * "bilgi bulunmuyor" der, ya da hiç basılmaz. Hiçbir bölüm boş bir tabloyu
 * sıfırlarla doldurmaz.
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { competitionLabel, t } = require("../../services/i18n.js");
// Veride Türkçe hazır metin olarak duran künye satırları.
const { sourceNoteLabel } = require("../../services/displayLabels.js");

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Sözlükten dizge; `%s` yer tutucuları sırayla doldurulur. */
function text(key, locale, ...values) {
  let result = t(key, locale);
  for (const value of values) result = result.replace("%s", value);
  return result;
}

function dateFormatter(locale) {
  const tag = locale === "en" ? "en-GB" : "tr-TR";
  return new Intl.DateTimeFormat(tag, { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/Istanbul" });
}

function formatDate(value, locale) {
  if (!value) return null;
  const raw = String(value);
  const parsed = new Date(raw.length <= 10 ? `${raw}T12:00:00+03:00` : raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return dateFormatter(locale).format(parsed);
}

function formatNumber(value, locale) {
  if (typeof value !== "number" || !Number.isFinite(value)) return String(value ?? "");
  return new Intl.NumberFormat(locale === "en" ? "en-GB" : "tr-TR").format(value);
}

/** Başlık + açıklama. Bütün bölümler aynı iskeleti kullanır. */
function sectionHead(heading, note) {
  return `<div class="p360-head"><h2>${escapeHtml(heading)}</h2>${note ? `<p>${escapeHtml(note)}</p>` : ""}</div>`;
}

function emptyNote(message) {
  return `<p class="p360-empty" data-card="empty-state">${escapeHtml(message)}</p>`;
}

// ── Kimlik kartı ────────────────────────────────────────────────────────────

/**
 * Kimlik satırları.
 *
 * İstenen iskelet alanları (forma no, mevki, uyruk, doğum tarihi) her zaman
 * basılır: doğrulanmış değer yoksa "Güncelleniyor" yazılır, uydurma sayı
 * veya "—" yazılmaz. Diğer alanlar bilinmiyorsa hâlâ basılmaz; yokluğu
 * bilinen bir boşluk gibi göstermemek için.
 */
const REQUIRED_IDENTITY_KEYS = Object.freeze(["shirtNumber", "position", "nationality", "birthDate"]);

function identityRows(identity, locale) {
  const rows = [];
  const pending = text("player360.identity.pending", locale);
  const push = (key, value, href, required = false) => {
    const missing = value === null || value === undefined || String(value).trim() === "";
    if (missing && !required) return;
    const label = text(`player360.identity.${key}`, locale);
    const body = missing
      ? `<span class="p360-pending">${escapeHtml(pending)}</span>`
      : href
        ? `<a href="${escapeHtml(href)}">${escapeHtml(value)}</a>`
        : escapeHtml(value);
    rows.push(`<div class="p360-id-row${missing ? " is-pending" : ""}"><dt>${escapeHtml(label)}</dt><dd>${body}</dd></div>`);
  };

  push("fullName", identity.fullName);
  push("club", identity.team, identity.teamHref);
  push("league", identity.league);
  push("shirtNumber", identity.shirtNumber, null, true);
  push("position", identity.position, null, true);
  push("secondaryPosition", identity.secondaryPosition);
  push("nationality", identity.nationality, null, true);
  push("birthDate", formatDate(identity.birthDate, locale), null, true);
  push("age", identity.age);
  push("height", identity.height);
  push("foot", identity.preferredFoot);
  push("contractUntil", formatDate(identity.contractUntil, locale) || identity.contractUntil);

  return rows;
}

function renderIdentity(model, locale) {
  const rows = identityRows(model.identity, locale);
  if (!rows.length) return "";

  const logo = model.identity.teamLogo
    ? `<img class="p360-club-logo" src="${escapeHtml(model.identity.teamLogo)}" alt="${escapeHtml(model.identity.team || "")}" width="28" height="28" loading="lazy" decoding="async">`
    : "";

  const official = model.identity.shirtNumberSource && model.identity.shirtNumberSource.kind === "official-club"
    ? `<p class="p360-source">${escapeHtml(text("player360.season.sourceNote", locale, model.identity.shirtNumberSource.sourceName))}${model.identity.shirtNumberSource.sourceUrl ? ` · <a href="${escapeHtml(model.identity.shirtNumberSource.sourceUrl)}" rel="nofollow noopener noreferrer" target="_blank">${escapeHtml(model.identity.shirtNumberSource.sourceUrl.replace(/^https?:\/\/(www\.)?/, "").split("/")[0])}</a>` : ""}</p>`
    : "";

  return `<section class="p360 p360-identity" aria-labelledby="p360-identity-title" data-p360-section="identity">
        <div class="p360-head"><h2 id="p360-identity-title">${escapeHtml(text("player360.identity.heading", locale))}</h2></div>
        ${logo}
        <dl class="p360-id-grid">${rows.join("")}</dl>
        ${official}
      </section>`;
}

// ── Sezon istatistikleri ────────────────────────────────────────────────────

function statCard(key, value, locale, suffix = "") {
  const label = text(`player360.stat.${key}`, locale);
  return `<div class="p360-stat"><span>${escapeHtml(label)}</span><b>${escapeHtml(formatNumber(value, locale))}${escapeHtml(suffix)}</b></div>`;
}

function renderSeason(model, locale) {
  const name = model.identity.name;
  const heading = text("player360.season.heading", locale, name, model.season);
  const stats = model.seasonStats;

  if (stats.snapshot) {
    const cards = stats.metrics.map(row => {
      const value = row.available ? row.display : "—";

      const per90 = row.available && row.per90 !== null
        ? `<small>90 ${locale === "en" ? "min" : "dk"}: ${escapeHtml(row.per90)}</small>` : "";
      return `<div class="p360-stat"><span>${escapeHtml(text(`player360.stat.${row.key}`, locale))}</span><b>${escapeHtml(value)}</b>${per90}</div>`;
    }).join("");
    const formulas = stats.metrics.filter(row => row.available && row.formula).map(row => `<li>${escapeHtml(text(`player360.stat.${row.key}`, locale))}: ${escapeHtml(locale === "en" ? row.sourceField : row.formula)}</li>`).join("");
    const scope = stats.snapshot.competitions.map(row => `${row.team} / ${competitionLabel(row.name, locale)} (#${row.id})`).join(" · ");
    return `<section class="p360" aria-labelledby="p360-season-title" data-p360-section="season">
      <div class="p360-head"><h2 id="p360-season-title">${escapeHtml(text("player360.season.heading", locale, name, stats.season))}</h2></div>
      <p class="p360-source">${locale === "en" ? "Data" : "Veri"}: <a href="https://www.api-football.com/news/post/how-to-get-started-with-api-football-the-complete-beginners-guide" rel="nofollow noopener noreferrer" target="_blank">API-Football</a> · ${escapeHtml(stats.season)} · ${escapeHtml(scope)}</p>
      ${stats.verifiedAt ? `<p class="p360-source">${escapeHtml(text("player360.season.checked", locale))}: ${escapeHtml(formatDate(stats.verifiedAt, locale))} (Europe/Istanbul)</p>` : ""}
      <div class="p360-stat-grid">${cards}</div>
      <p class="p360-source">—: ${escapeHtml(text("player360.season.pending", locale))}. ${locale === "en" ? "Per 90: value / minutes × 90" : "90 dk: değer / dakika × 90"}.</p>
      <details><summary>${locale === "en" ? "Source fields / aggregation" : "Kaynak alanlar / toplama yöntemi"}</summary><p>${locale === "en" ? "Counts are summed over the listed team/competition blocks for this season. A missing block field stays empty." : "Sayımlar aynı sezondaki listelenen takım/turnuva bloklarından toplanır. Bir blokta alan eksikse toplam boş kalır."}</p><ul>${formulas}</ul></details>
      <p class="p360-source">${escapeHtml(text("player360.season.apiMissing", locale))}</p>
    </section>`;
  }

  if (!stats.available) {
    return `<section class="p360" aria-labelledby="p360-season-title" data-p360-section="season">
        <div class="p360-head"><h2 id="p360-season-title">${escapeHtml(heading)}</h2></div>
        ${emptyNote(text("player360.season.empty", locale, model.season))}
      </section>`;
  }

  const core = stats.core.map((row) => statCard(row.key, row.value, locale)).join("");
  const positional = stats.positional.length
    ? `<h3 class="p360-subhead">${escapeHtml(text("player360.season.positional", locale))}</h3>
        <div class="p360-stat-grid">${stats.positional.map((row) => statCard(row.key, row.value, locale, row.suffix)).join("")}</div>`
    : "";
  const source = stats.source
    ? `<p class="p360-source">${escapeHtml(text("player360.season.sourceNote", locale, sourceNoteLabel(stats.source, locale)))}</p>`
    : "";

  return `<section class="p360" aria-labelledby="p360-season-title" data-p360-section="season">
        <div class="p360-head"><h2 id="p360-season-title">${escapeHtml(heading)}</h2></div>
        <div class="p360-stat-grid">${core}</div>
        ${positional}
        ${source}
      </section>`;
}

/** Pilot batches expose only observed match-window numbers, never season totals. */
function renderRegisteredEvidence(model, locale) {
  const evidence = model.profileEvidence;
  if (!evidence) return "";
  const pending = locale === "en" ? "Updating" : "Güncel<wbr>leniyor";
  const cards = evidence.metrics.map(row => `<div class="p360-stat"><span>${escapeHtml(text(`player360.stat.${row.key}`, locale))}</span><b>${row.value === null ? pending : escapeHtml(formatNumber(row.value, locale) + row.unit)}</b></div>`).join("");
  const abilities = (locale === "en" ? ["Finishing", "Pressing", "Creativity", "Consistency", "Technical ability"] : evidence.pending)
    .map(label => `<div class="p360-stat"><span>${escapeHtml(label)}</span><b>${pending}</b></div>`).join("");
  const matches = evidence.matches.map(row => `<li>${escapeHtml(row.date)} · ${escapeHtml(row.opponent)} · ${escapeHtml(row.id)}</li>`).join("");
  const formulas = evidence.metrics.filter(row => row.formula).map(row => `<li>${escapeHtml(text(`player360.stat.${row.key}`, locale))}: ${escapeHtml(locale === "en" ? row.key === "passAccuracy" ? "Σ accuratePasses / Σ passes × 100" : row.key === "appearances" ? "COUNT(matchId); registered matches only" : `Σ ${row.key}; registered matches only` : row.formula)}</li>`).join("");
  return `<section class="p360" data-p360-section="registered-evidence">
    <div class="p360-head"><h2>${escapeHtml(model.identity.name)} ${locale === "en" ? "Recorded Match Statistics" : "Kayıtlı Maç İstatistikleri"}</h2></div>
    <p class="p360-source">${locale === "en" ? "Data" : "Veri"}: API-Football · ${evidence.matches.length} ${locale === "en" ? "recorded matches; NOT season totals" : "kayıtlı maç; sezon toplamı DEĞİLDİR"}. ${escapeHtml(locale === "en" ? "Only the matches listed below are included. Missing fields are not zero; cached match data is not live data." : "Yalnızca aşağıdaki maçlar kapsanır. Eksik alan sıfır değildir; önbellekteki maç verisi canlı veri değildir.")}</p>
    <div class="p360-stat-grid">${cards}${abilities}</div>
    <p class="p360-source">${locale === "en" ? "Finishing, pressing, creativity, consistency and technical ability have no verified scalar source; xG/xA are not estimated. Transfermarkt market/contract and Understat/FBref imports are not enabled without permitted reuse." : "Bitiricilik, pres, yaratıcılık, istikrar ve teknik beceri için doğrulanmış sayısal kaynak yok; xG/xA tahmin edilmez. Transfermarkt piyasa/sözleşme ve Understat/FBref aktarımı kullanım izni olmadan etkinleştirilmez."}</p>
    <details><summary>${locale === "en" ? "Source / match window / formulas" : "Kaynak / maç kapsamı / formüller"}</summary>
    <p>${escapeHtml(locale === "en" ? "API-Football player-match cache" : "API-Football oyuncu-maç önbelleği")}: data/player-match-history.json · ${escapeHtml(formatDate(evidence.recordedAt, locale))} (Europe/Istanbul). ${locale === "en" ? "Roster identity observation" : "Kadro kimlik doğrulaması"}: ${escapeHtml(formatDate(evidence.verifiedAt, locale))} (Europe/Istanbul).</p><ul>${matches}</ul><ul>${formulas}</ul></details>
  </section>`;
}

// ── Son maçlar ──────────────────────────────────────────────────────────────

function cardsCell(row) {
  const parts = [];
  if (row.yellowCards > 0) parts.push(`<span class="p360-card p360-card-yellow" aria-hidden="true"></span>${row.yellowCards > 1 ? `×${row.yellowCards}` : ""}`);
  if (row.redCards > 0) parts.push(`<span class="p360-card p360-card-red" aria-hidden="true"></span>${row.redCards > 1 ? `×${row.redCards}` : ""}`);
  return parts.join(" ");
}

function renderMatches(model, locale) {
  const name = model.identity.name;
  const heading = text("player360.matches.heading", locale, name);

  if (!model.matchLog.available) {
    return `<section class="p360" aria-labelledby="p360-matches-title" data-p360-section="matches">
        <div class="p360-head"><h2 id="p360-matches-title">${escapeHtml(heading)}</h2></div>
        ${emptyNote(text("player360.matches.empty", locale))}
      </section>`;
  }

  const rows = model.matchLog.rows.map((row) => {
    const date = formatDate(row.kickoff, locale) || "";
    // Maç raporu adresi modelden gelir. Yoksa rakip adı düz metin kalır —
    // var olmayan bir sayfaya bağlantı atmaktansa bağlantısız satır.
    const opponent = row.reportHref
      ? `<a href="${escapeHtml(row.reportHref)}">${escapeHtml(row.opponent)}</a>`
      : escapeHtml(row.opponent);
    const role = row.started
      ? text("player360.matches.started", locale)
      : text("player360.matches.substitute", locale);
    const minutes = row.minutes === null ? "" : `${row.minutes}'`;
    const resultClass = row.result ? ` p360-result-${row.result}` : "";

    return `<tr>
            <th scope="row">${escapeHtml(date)}</th>
            <td>${escapeHtml(row.league ? competitionLabel(row.league, locale) : "")}</td>
            <td>${row.side === "home" ? "" : "@"}${opponent}</td>
            <td class="p360-score${resultClass}">${escapeHtml(row.scoreLine || "")}</td>
            <td>${escapeHtml(role)}</td>
            <td>${escapeHtml(minutes)}</td>
            <td>${row.goals || ""}</td>
            <td>${row.assists || ""}</td>
            <td>${cardsCell(row)}</td>
          </tr>`;
  }).join("\n");

  const header = ["matches.date", "matches.competition", "matches.opponent", "matches.score",
    "matches.role", "stat.minutes", "stat.goals", "stat.assists", "matches.cards"]
    .map((key) => `<th scope="col">${escapeHtml(text(`player360.${key}`, locale))}</th>`)
    .join("");

  return `<section class="p360" aria-labelledby="p360-matches-title" data-p360-section="matches">
        <div class="p360-head"><h2 id="p360-matches-title">${escapeHtml(heading)}</h2></div>
        <div class="p360-table-wrap">
          <table class="p360-table">
            <caption>${escapeHtml(text("player360.matches.caption", locale))}</caption>
            <thead><tr>${header}</tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </section>`;
}

// ── Form grafiği (satır içi SVG) ────────────────────────────────────────────

/**
 * Gol + asist katkısının maç maç seyri.
 *
 * Neden sütun grafiği ve neden satır içi SVG: seri en çok 10 nokta ve tek
 * bir ölçü taşıyor; bunun için bir grafik kütüphanesi indirmek, sayfanın
 * en ağır isteği olurdu. `viewBox` sayesinde grafik kapsayıcısına göre
 * ölçeklenir — mobilde ayrı bir sürüm gerekmez.
 *
 * Erişilebilirlik: grafik `role="img"` ve tek bir özet etiketiyle sunulur;
 * sayıların KENDİSİ zaten üstteki tabloda okunabilir hâlde duruyor.
 */
const CHART_MIN_POINTS = 2;
const CHART_MAX_BAR_WIDTH = 34;

function formChartSvg(series, locale) {
  // TEK NOKTA BİR EĞRİ DEĞİLDİR. İki maçtan azı için grafik çizilmez:
  // tek sütun, ölçeğin tamamını kaplayıp "tavan performans" izlenimi
  // veriyor ve yanında kıyaslanacak hiçbir şey olmuyordu. Sayılar zaten
  // hemen altındaki kartlarda okunuyor.
  if (series.length < CHART_MIN_POINTS) return "";

  const height = 96;
  const gap = 8;
  // Sütun genişliği ÜSTTEN sınırlı: az maçta sütunlar tuvali kaplayıp
  // grafiği bir renk bloğuna çeviriyordu.
  const barWidth = Math.min(CHART_MAX_BAR_WIDTH, Math.max(6, 320 / series.length - gap));
  const slot = barWidth + gap;
  const width = Math.round(slot * series.length);
  const peak = Math.max(1, ...series.map((point) => point.contribution));

  const bars = series.map((point, index) => {
    const barHeight = Math.round((point.contribution / peak) * (height - 20));
    const x = Math.round(index * slot + gap / 2);
    const y = height - barHeight - 14;
    const tone = point.result === "win" ? "win" : point.result === "loss" ? "loss" : "draw";
    const label = `${point.opponent}: ${point.contribution}`;
    return `<g class="p360-bar p360-bar-${tone}"><title>${escapeHtml(label)}</title>` +
      `<rect x="${x}" y="${y}" width="${Math.round(barWidth)}" height="${Math.max(barHeight, 2)}" rx="2"></rect>` +
      `<text x="${Math.round(x + barWidth / 2)}" y="${height - 3}" text-anchor="middle">${point.contribution}</text></g>`;
  }).join("");

  const summary = text("player360.form.chartLabel", locale);
  return `<svg class="p360-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(summary)}" preserveAspectRatio="xMidYMid meet">${bars}</svg>`;
}

/**
 * GOL VE ASİSTLER.
 *
 * İki kaynak, açık bir öncelik sırasıyla:
 *
 *   1. MAÇ GÜNLÜĞÜ varsa — maç maç seyri gösterilir, grafiğiyle birlikte.
 *      Toplamlar "kayıtlı maçlarda" diye etiketlenir; sezonun tamamı
 *      değil, KANITI olan maçların toplamıdır.
 *   2. Günlük yoksa ama sezon sayıları kapıdan geçtiyse — grafiksiz,
 *      yalnızca sezon gol/asisti. Grafik ÇİZİLMEZ: tek bir toplamdan
 *      "form eğrisi" üretmek, olmayan bir seyri varmış gibi göstermek olur.
 *
 * İkisi de yoksa bölüm hiç basılmaz.
 */
function renderForm(model, locale) {
  const heading = text("player360.form.heading", locale, model.identity.name);

  if (model.formSeries.length) {
    const totals = model.matchLog.totals;
    return `<section class="p360" aria-labelledby="p360-form-title" data-p360-section="form">
        <div class="p360-head"><h2 id="p360-form-title">${escapeHtml(heading)}</h2><p>${escapeHtml(text("player360.form.chartLabel", locale))}</p></div>
        ${formChartSvg(model.formSeries, locale)}
        <div class="p360-stat-grid p360-stat-grid-compact">
          ${statCard("appearances", totals.matches, locale)}
          ${statCard("goals", totals.goals, locale)}
          ${statCard("assists", totals.assists, locale)}
        </div>
        <p class="p360-source">${escapeHtml(text("player360.form.totals", locale))}</p>
      </section>`;
  }

  const seasonStats = new Map(model.seasonStats.core.map((row) => [row.key, row.value]));
  if (!seasonStats.has("goals") && !seasonStats.has("assists")) return "";

  const cards = ["goals", "assists", "appearances", "minutes"]
    .filter((key) => seasonStats.has(key))
    .map((key) => statCard(key, seasonStats.get(key), locale))
    .join("");

  return `<section class="p360" aria-labelledby="p360-form-title" data-p360-section="form">
        <div class="p360-head"><h2 id="p360-form-title">${escapeHtml(heading)}</h2></div>
        <div class="p360-stat-grid p360-stat-grid-compact">${cards}</div>
        ${model.seasonStats.source ? `<p class="p360-source">${escapeHtml(text("player360.season.sourceNote", locale, sourceNoteLabel(model.seasonStats.source, locale)))}</p>` : ""}
      </section>`;
}

// ── Sakatlık ve ceza ────────────────────────────────────────────────────────

/**
 * SAĞLAYICI SEBEBİ, OKUYUCUNUN DİLİNDE.
 *
 * api-football sebebi İngilizce gönderiyor ("Muscle Injury", "Off the
 * roster"). Türkçe bir sayfada ham hâliyle basmak, çevirisi olmayan bir
 * alanı okuyucunun üstüne yıkmaktır. Sözlükte karşılığı olan sebep
 * çevrilir; OLMAYAN sebep hiç basılmaz — durum rozeti ("Sakat") zaten
 * asıl bilgiyi taşıyor, tanımadığımız bir kodu aynen aktarmaya gerek yok.
 */
function availabilityReason(note, locale) {
  const raw = String(note ?? "").trim();
  if (!raw) return null;
  const key = `player360.reason.${raw.toLowerCase().replace(/\s+/g, "-")}`;
  const translated = t(key, locale);
  return translated === key ? null : translated;
}

function renderAvailability(model, locale) {
  const heading = text("player360.availability.heading", locale, model.identity.name);
  const state = model.availability;
  const statusLabel = text(`player360.availability.${state.status}`, locale);

  const reason = availabilityReason(state.note, locale);
  const details = state.available
    ? `<div class="p360-status p360-status-${escapeHtml(state.status)}"><strong>${escapeHtml(statusLabel)}</strong>${reason ? `<span>${escapeHtml(reason)}</span>` : ""}</div>
        ${state.source ? `<p class="p360-source">${escapeHtml(text("player360.season.sourceNote", locale, sourceNoteLabel(state.source, locale)))}</p>` : ""}`
    : `<div class="p360-status p360-status-unknown"><strong>${escapeHtml(statusLabel)}</strong></div>
        ${emptyNote(text("player360.availability.unknownNote", locale))}`;

  return `<section class="p360" aria-labelledby="p360-availability-title" data-p360-section="availability">
        <div class="p360-head"><h2 id="p360-availability-title">${escapeHtml(heading)}</h2></div>
        ${details}
      </section>`;
}

// ── Transfer haberleri ──────────────────────────────────────────────────────

function trustBadge(trustKey, locale) {
  return `<span class="p360-trust p360-trust-${escapeHtml(trustKey)}">${escapeHtml(text(`player360.trust.${trustKey}`, locale))}</span>`;
}

function renderTransfers(model, locale) {
  const heading = text("player360.transfers.heading", locale, model.identity.name);
  const records = model.transfers.rows;
  const news = model.news.transfer;

  if (!records.length && !news.length) {
    return `<section class="p360" aria-labelledby="p360-transfers-title" data-p360-section="transfers">
        <div class="p360-head"><h2 id="p360-transfers-title">${escapeHtml(heading)}</h2></div>
        ${emptyNote(text("player360.transfers.empty", locale))}
      </section>`;
  }

  const recordItems = records.map((row) => {
    const date = formatDate(row.date, locale) || "";
    const route = `${escapeHtml(row.fromTeam || "")} → ${escapeHtml(row.toTeam || "")}`;
    const source = row.sourceUrl
      ? `<a href="${escapeHtml(row.sourceUrl)}" rel="nofollow noopener noreferrer" target="_blank">${escapeHtml(row.sourceName || row.sourceUrl)}</a>`
      : escapeHtml(row.sourceName || "");
    return `<li class="p360-feed-item">${trustBadge(row.trustKey, locale)}<div><strong>${route}</strong>` +
      `<span>${escapeHtml([date, row.type, row.fee].filter(Boolean).join(" · "))}</span>${source ? `<span>${source}</span>` : ""}</div></li>`;
  }).join("");

  const newsItems = news.map((row) => {
    const date = formatDate(row.publishedAt, locale) || "";
    return `<li class="p360-feed-item">${trustBadge(row.trustKey, locale)}<div>` +
      `<a href="${escapeHtml(row.href)}"><strong>${escapeHtml(row.title)}</strong></a><span>${escapeHtml(date)}</span></div></li>`;
  }).join("");

  return `<section class="p360" aria-labelledby="p360-transfers-title" data-p360-section="transfers">
        <div class="p360-head"><h2 id="p360-transfers-title">${escapeHtml(heading)}</h2></div>
        <ul class="p360-feed">${recordItems}${newsItems}</ul>
      </section>`;
}

// ── Kariyer ─────────────────────────────────────────────────────────────────

function renderCareer(model, locale) {
  const heading = text("player360.career.heading", locale, model.identity.name);

  if (!model.career.available) {
    return `<section class="p360" aria-labelledby="p360-career-title" data-p360-section="career">
        <div class="p360-head"><h2 id="p360-career-title">${escapeHtml(heading)}</h2></div>
        ${emptyNote(text("player360.career.empty", locale))}
      </section>`;
  }

  const rows = model.career.stints.map((stint) => `<tr>
            <th scope="row">${escapeHtml(stint.club)}</th>
            <td>${escapeHtml(formatDate(stint.joinedAt, locale) || "")}</td>
            <td>${escapeHtml(stint.leftAt ? (formatDate(stint.leftAt, locale) || "") : text("player360.career.present", locale))}</td>
            <td>${escapeHtml([stint.type, stint.fee].filter(Boolean).join(" · "))}</td>
          </tr>`).join("\n");

  const table = model.career.stints.length
    ? `<div class="p360-table-wrap">
          <table class="p360-table">
            <caption>${escapeHtml(text("player360.career.totalsNote", locale))}</caption>
            <thead><tr>
              <th scope="col">${escapeHtml(text("player360.career.club", locale))}</th>
              <th scope="col">${escapeHtml(text("player360.career.joined", locale))}</th>
              <th scope="col">${escapeHtml(text("player360.career.left", locale))}</th>
              <th scope="col">${escapeHtml(text("player360.career.type", locale))}</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`
    : "";

  const former = model.career.formerTeams.length
    ? `<p class="p360-source">${escapeHtml(text("player360.career.formerTeams", locale))}: ${escapeHtml(model.career.formerTeams.join(", "))}</p>`
    : "";

  return `<section class="p360" aria-labelledby="p360-career-title" data-p360-section="career">
        <div class="p360-head"><h2 id="p360-career-title">${escapeHtml(heading)}</h2></div>
        ${table}
        ${former}
      </section>`;
}

// ── Başarılar ───────────────────────────────────────────────────────────────

/** Veri kümesinde kupa alanı yoksa bölüm HİÇ basılmaz — boş vitrin olmaz. */
function renderHonours(model, locale) {
  if (!model.honours.available) return "";

  const heading = text("player360.honours.heading", locale, model.identity.name);
  const items = model.honours.rows.map((row) => `<li class="p360-feed-item"><div><strong>${escapeHtml(row.title)}</strong>` +
    `<span>${escapeHtml([row.club, row.season].filter(Boolean).join(" · "))}</span></div></li>`).join("");

  return `<section class="p360" aria-labelledby="p360-honours-title" data-p360-section="honours">
        <div class="p360-head"><h2 id="p360-honours-title">${escapeHtml(heading)}</h2></div>
        <ul class="p360-feed">${items}</ul>
      </section>`;
}

// ── Haberler ────────────────────────────────────────────────────────────────

function renderNews(model, locale) {
  const heading = text("player360.news.heading", locale, model.identity.name);
  const items = model.news.general;

  if (!items.length) {
    return `<section class="p360" aria-labelledby="p360-news-title" data-p360-section="news">
        <div class="p360-head"><h2 id="p360-news-title">${escapeHtml(heading)}</h2></div>
        ${emptyNote(text("player360.news.empty", locale))}
      </section>`;
  }

  const list = items.map((row) => {
    const date = formatDate(row.publishedAt, locale) || "";
    return `<li class="p360-feed-item">${trustBadge(row.trustKey, locale)}<div>` +
      `<a href="${escapeHtml(row.href)}"><strong>${escapeHtml(row.title)}</strong></a>` +
      `<span>${escapeHtml([row.category, date].filter(Boolean).join(" · "))}</span></div></li>`;
  }).join("");

  return `<section class="p360" aria-labelledby="p360-news-title" data-p360-section="news">
        <div class="p360-head"><h2 id="p360-news-title">${escapeHtml(heading)}</h2></div>
        <ul class="p360-feed">${list}</ul>
      </section>`;
}

// ── Karşılaştırma ve iç linkler ─────────────────────────────────────────────

function renderCompare(model, locale) {
  if (!model.compare.available) return "";

  const heading = text("player360.compare.heading", locale, model.identity.name);
  const peers = model.compare.peers.map((peer) => `<a class="p360-peer" href="${escapeHtml(peer.href)}">` +
    `<strong>${escapeHtml(peer.name)}</strong>${peer.team ? `<span>${escapeHtml(peer.team)}</span>` : ""}</a>`).join("");

  return `<section class="p360" aria-labelledby="p360-compare-title" data-p360-section="compare">
        <div class="p360-head"><h2 id="p360-compare-title">${escapeHtml(heading)}</h2><p>${escapeHtml(text("player360.compare.lead", locale))}</p></div>
        <a class="button primary p360-compare-button" href="${escapeHtml(model.compare.pickerHref)}">${escapeHtml(text("player360.compare.button", locale))}</a>
        <div class="p360-peer-grid">${peers}</div>
      </section>`;
}

function renderInternalLinks(model, locale) {
  const links = model.internalLinks.map((link) => {
    const label = link.label || text(`player360.links.${link.key}`, locale);
    return `<a href="${escapeHtml(link.href)}">${escapeHtml(label)}</a>`;
  }).join("");

  return `<section class="p360 p360-links" aria-label="${escapeHtml(text("player360.links.heading", locale))}" data-p360-section="links">
        <span>${escapeHtml(text("player360.links.heading", locale))}</span>
        ${links}
      </section>`;
}

/**
 * Bütün bölümler, SEO sözleşmesindeki sırayla.
 *
 * Sıra keyfi değil: okuyucu önce kim olduğuna, sonra bu sezon ne yaptığına,
 * sonra son maçlarına bakar. Aramadan gelen kullanıcı da aynı sırayı bekler.
 */
export function renderPlayer360(model, options = {}) {
  const locale = options.locale === "en" ? "en" : "tr";

  return [
    renderIdentity(model, locale),
    renderSeason(model, locale),
    renderRegisteredEvidence(model, locale),
    renderMatches(model, locale),
    renderForm(model, locale),
    renderAvailability(model, locale),
    renderTransfers(model, locale),
    renderCareer(model, locale),
    renderHonours(model, locale),
    renderNews(model, locale),
    renderCompare(model, locale),
    renderInternalLinks(model, locale)
  ].filter(Boolean).join("\n      ");
}

/**
 * META AÇIKLAMASI — SAYFADA GERÇEKTEN OLAN ŞEYİ ANLATIR.
 *
 * Açıklama yalnızca YAYIMLANAN bölümlerden cümle kurar. "Sezon
 * istatistikleri" diye başlayıp sayfada o bölümün boş olması, aramadan
 * gelen kullanıcı için doğrudan bir yalandır; Google için de tıklama sonrası
 * hızlı geri dönüş demektir.
 *
 * PUAN CÜMLEYE GİRMEZ. services/cardCredibility.js'in kapısı meta
 * açıklamasında da geçerli — denetimde en kalıcı yanlışlar oradan sızmıştı.
 */
export function player360Description(model, options = {}) {
  const locale = options.locale === "en" ? "en" : "tr";
  const name = model.identity.name;
  const parts = [];

  const position = model.identity.position;
  if (model.identity.team) {
    parts.push(locale === "en"
      ? `${name} plays for ${model.identity.team}${position ? ` as a ${position}` : ""}`
      : `${name}, ${model.identity.team} formasıyla oynuyor${position ? `, mevki ${position}` : ""}`);
  } else {
    parts.push(locale === "en"
      ? `${name} player profile${position ? `, ${position}` : ""}`
      : `${name} oyuncu profili${position ? `, mevki ${position}` : ""}`);
  }

  const stats = new Map(model.seasonStats.core.map((row) => [row.key, row.value]));
  if (stats.has("goals") || stats.has("assists")) {
    const goals = stats.get("goals");
    const assists = stats.get("assists");
    const matches = stats.get("appearances");
    const measured = [
      matches !== undefined ? `${matches} ${locale === "en" ? "apps" : "maç"}` : null,
      goals !== undefined ? `${goals} ${locale === "en" ? "goals" : "gol"}` : null,
      assists !== undefined ? `${assists} ${locale === "en" ? "assists" : "asist"}` : null
    ].filter(Boolean);
    parts.push(`${model.season} ${locale === "en" ? "season" : "sezonu"}: ${measured.join(", ")}`);
  }

  if (model.profileEvidence?.matches.length) {
    parts.push(locale === "en"
      ? `sourced statistics from ${model.profileEvidence.matches.length} recorded matches, not season totals`
      : `${model.profileEvidence.matches.length} kayıtlı maçın kaynaklı istatistikleri, sezon toplamı değil`);
  }

  if (model.matchLog.available) {
    parts.push(locale === "en"
      ? `recent matches with minutes, goals and cards`
      : `son maçları, dakikaları ve kartları`);
  }

  if (model.availability.available) {
    const status = t(`player360.availability.${model.availability.status}`, locale);
    parts.push(locale === "en" ? `current status: ${status}` : `güncel durum: ${status}`);
  }

  if (model.news.general.length || model.news.transfer.length) {
    parts.push(locale === "en" ? "transfer and news updates" : "transfer ve haber güncellemeleri");
  }

  if (model.career.available && model.career.stints.length > 1) {
    const clubs = model.career.stints.slice(0, 3).map((stint) => stint.club).join(", ");
    parts.push(locale === "en" ? `career clubs: ${clubs}` : `kariyer kulüpleri: ${clubs}`);
  }

  // HİÇBİR BÖLÜMÜ OLMAYAN KAYIT. Açıklama, sayfada ne olmadığını ve NEDEN
  // olmadığını söyler. "A. Ablak oyuncu profili." gibi üç kelimelik bir
  // açıklama arama sonucunda hiçbir soruyu yanıtlamıyor; boş vaat vermeden
  // de sayfanın ne olduğunu anlatmak mümkün.
  if (parts.length === 1) {
    parts.push(locale === "en"
      ? "club, season statistics and market data are published once they match a verified provider record — estimates are never shown"
      : "kulüp, sezon istatistikleri ve piyasa verileri doğrulanmış sağlayıcı kaydıyla eşleştiğinde yayımlanır; tahmini değer gösterilmez");
  }

  const tail = locale === "en" ? "on FutbolRadar." : "FutbolRadar'da.";
  // Arama snippet'i ~150-160 karakter. Bölümleri sırayla ekler; sınırı
  // aşacak cümle düşer, böylece vaat edilen bölüm sayfada kalanlarla sınırlı kalır.
  let used = [];
  let result = `${parts[0]} — ${tail}`;
  for (const part of parts) {
    const candidate = `${[...used, part].join(", ")} — ${tail}`;
    if (used.length && candidate.length > 160) break;
    used.push(part);
    result = candidate;
  }
  return result;
}

/** SEO başlığı. */
export function player360Title(model, options = {}) {
  const locale = options.locale === "en" ? "en" : "tr";
  const name = model.identity.name;
  // ~60 karakterlik görünür başlık. Uzun adlarda normalize-meta.mjs
  // 68'i aşınca " | FutbolRadar" ekini zaten düşürür.
  return locale === "en"
    ? `${name} Stats and Profile | FutbolRadar`
    : `${name} Profili ve İstatistikleri | FutbolRadar`;
}

/**
 * YAPILANDIRILMIŞ VERİ — YALNIZCA GÖRÜNÜR SAYFADA DA OLAN İDDİALAR.
 *
 * schema.org, görünür metinden daha kalıcı bir yanlıştır: arama motoru onu
 * olgu olarak yutar. Bu yüzden `memberOf` yalnızca kayıt yayın kapısından
 * geçtiyse basılır (test-player-surface-enforcement.mjs bunu zorunlu
 * kılıyor) ve hiçbir derecelendirme alanı beyan edilmez.
 */
export function player360Person(model, canonical, description) {
  const identity = model.identity;
  const person = {
    "@type": "Person",
    "@id": `${canonical}#person`,
    name: identity.name,
    url: canonical,
    description
  };

  if (identity.fullName) person.alternateName = identity.fullName;
  if (identity.nationality) person.nationality = identity.nationality;
  if (identity.birthDate) person.birthDate = identity.birthDate;
  if (identity.height) person.height = identity.height;
  if (identity.position) person.jobTitle = identity.position;
  if (identity.shirtNumber != null && String(identity.shirtNumber).trim() !== "") {
    person.additionalProperty = [{
      "@type": "PropertyValue",
      name: "shirtNumber",
      value: String(identity.shirtNumber)
    }];
  }
  if (model.verified && identity.team) {
    const team = { "@type": "SportsTeam", name: identity.team, sport: "Football" };
    if (identity.teamHref) {
      const abs = identity.teamHref.startsWith("http")
        ? identity.teamHref
        : new URL(identity.teamHref.replace(/^\.\//, "/"), "https://www.futbolradar.com/futbolcu/").href;
      // relative team links are presentation-only; schema uses the club name.
      team.name = identity.team;
    }
    person.memberOf = team;
    person.affiliation = team;
  }

  return person;
}

/**
 * Profil sayfasının şema grafiği: Person + BreadcrumbList + ProfilePage.
 * ProfilePage, WebPage'in alt türüdür; ayrı bir WebPage düğümü tekrardır.
 */
export function player360Graph(model, canonical, description, breadcrumbs) {
  const person = player360Person(model, canonical, description);
  return {
    "@context": "https://schema.org",
    "@graph": [
      person,
      {
        "@type": "BreadcrumbList",
        itemListElement: breadcrumbs
      },
      {
        "@type": "ProfilePage",
        "@id": `${canonical}#profile`,
        url: canonical,
        name: model.identity.name,
        description,
        mainEntity: { "@id": `${canonical}#person` },
        isPartOf: {
          "@type": "WebSite",
          name: "FutbolRadar",
          url: "https://www.futbolradar.com/"
        }
      }
    ]
  };
}
