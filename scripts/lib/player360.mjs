/**
 * FUTBOLCU 360 — TEK GÖRÜNÜM KATMANI.
 *
 * `services/player360Service.js` modeli kurar, bu dosya onu HTML'e çevirir.
 * TÜRKÇE VE İNGİLİZCE ÜRETİCİLER AYNI FONKSİYONU ÇAĞIRIR: iki dilde iki ayrı
 * bölüm listesi, iki ayrı gerçek demektir. Dil farkı yalnızca sözlükten
 * (locales/*.json → `player360.*`) gelir.
 *
 * H1, Türkçe sayfada oyuncunun tam adıyla "X kimdir?" kalıbını kullanır;
 * kısaltmalı kayıt adı (`V. Osimhen`) başlığa girmez. H2 başlıkları
 * "<Oyuncu> <konu>" kalıbını izler. Uzun kuyruklu aramanın sayfada birebir
 * karşılığı bu yüzden testlerle denetlenir.
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
const { isAllowedSourceUrl, hostOf } = require("../../services/sourceLinks.js");
// Kulüp kimliği yazımdan bağımsız tek anahtardan (services/turkishNames.js).
const { clubKey } = require("../../services/turkishNames.js");

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

  // Kulüp yolu: tek bakışta kronoloji, gidip dönen kulübün dönemleri ve kiralıklar.
  const path = model.career.stints.length > 1
    ? careerClubList(model.career.stints, { locale })
    : [];
  const pathLine = path.length > 1
    ? `<p class="p360-source" data-p360="career-path">${escapeHtml(text("player360.career.path", locale))}: ${escapeHtml(path.join(", "))}</p>`
    : "";

  const former = model.career.formerTeams.length
    ? `<p class="p360-source">${escapeHtml(text("player360.career.formerTeams", locale))}: ${escapeHtml(model.career.formerTeams.join(", "))}</p>`
    : "";

  return `<section class="p360" aria-labelledby="p360-career-title" data-p360-section="career">
        <div class="p360-head"><h2 id="p360-career-title">${escapeHtml(heading)}</h2></div>
        ${pathLine}
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

// ── Kimdir (TR SEO) ─────────────────────────────────────────────────────────

const TITLE_LIMIT = 60;
const DESCRIPTION_LIMIT = 160;

const KIMDIR_BLOCKED_HOST = /(?:^|\.)(wikipedia\.org|transfermarkt\.(?:com|com\.tr|co\.uk|us)|topscorersfootball\.com|fbref\.com|thesportsdb\.com)$/i;

const PLACEHOLDER_LABELS = new Set([
  "güncelleniyor", "guncelleniyor", "updating", "n/a", "na", "bilinmiyor",
  "unknown", "null", "undefined", "-", "—", "–", "?", "yakında", "bekleniyor"
]);

/** Değer yayınlanabilir mi? "Güncelleniyor" ve boş alan cümleye girmez. */
export function player360ValuePresent(value) {
  if (value === null || value === undefined) return false;
  const text = String(value).trim();
  if (!text) return false;
  return !PLACEHOLDER_LABELS.has(text.toLocaleLowerCase("tr-TR"));
}

function isAllowedKimdirSourceUrl(url) {
  if (!url) return false;
  if (!isAllowedSourceUrl(url)) return false;
  const host = hostOf(url);
  return Boolean(host) && !KIMDIR_BLOCKED_HOST.test(host);
}

/**
 * Kimlik kartında görünen, izinli resmi kaynaklar.
 * Wikipedia, Transfermarkt, topscorersfootball ve izinli listede olmayan
 * adresler etikete girmez.
 */
export function player360KimdirSources(model) {
  const source = model && model.identity && model.identity.shirtNumberSource;
  if (!source || source.kind !== "official-club") return [];
  if (!player360ValuePresent(source.sourceName)) return [];
  if (source.sourceUrl && !isAllowedKimdirSourceUrl(source.sourceUrl)) return [];
  return [source];
}

function yearOf(value) {
  const match = /^(\d{4})/.exec(String(value || ""));
  return match ? match[1] : null;
}

/**
 * KARİYER KULÜP LİSTESİ — dönem ve kiralık bilgisiyle.
 *
 * Kronolojik sırada, kulüp kimliği yazımdan bağımsız (`clubKey`). Bir kulüp
 * listede BİRDEN FAZLA kez geçiyorsa (gidip dönen oyuncu) her geçişin dönemi
 * yazılır ki okuyucu iki "Galatasaray"ı ayırt edebilsin; tek geçişte dönem
 * yazılmaz (gürültü). Kiralık dönem her zaman işaretlenir.
 *
 *   Galatasaray (2017–2021), Leicester (kiralık), Galatasaray
 *
 * `excludeCurrent`: son, açık uçlu dönem şu anki kulüpse listeden çıkar
 * ("Daha önce …" cümlesi için); yine de tekrar sayımına girer. Dönemi
 * bilinmeyen (tarihsiz) kayıt için dönem uydurulmaz.
 */
export function careerClubList(stints, options = {}) {
  const locale = options.locale === "en" ? "en" : "tr";
  const loanLabel = locale === "en" ? "loan" : "kiralık";
  const rows = (Array.isArray(stints) ? stints : [])
    .filter((stint) => stint && player360ValuePresent(stint.club))
    .slice()
    .reverse(); // model en yeni dönemi başa koyar; burada kronolojik.

  const currentKey = options.currentTeam ? clubKey(options.currentTeam) : "";
  const counts = new Map();
  // Aynı kulüp kayıtta farklı yazımlarla geçebilir ("İstanbul Başakşehir" / "Başakşehir");
  // listede ilk görülen yazım kullanılır ki bir kulüp tek adla görünsün.
  const spelling = new Map();
  for (const row of rows) {
    const key = clubKey(row.club);
    counts.set(key, (counts.get(key) || 0) + 1);
    if (!spelling.has(key)) spelling.set(key, String(row.club).trim());
  }

  let visible = rows;
  const last = rows.at(-1);
  if (options.excludeCurrent && last && !last.leftAt && currentKey && clubKey(last.club) === currentKey) {
    visible = rows.slice(0, -1);
  }

  return visible.map((row) => {
    const parts = [];
    const open = !row.leftAt;
    if ((counts.get(clubKey(row.club)) || 0) > 1 && !open) {
      const from = yearOf(row.joinedAt);
      const to = yearOf(row.leftAt);
      if (from && to) parts.push(from === to ? from : `${from}–${to}`);
      else if (from) parts.push(`${from}–`);
    }
    if (row.loan) parts.push(loanLabel);
    const club = spelling.get(clubKey(row.club));
    return parts.length ? `${club} (${parts.join(", ")})` : club;
  });
}

function uniqueClubs(stints, exceptName, locale) {
  return careerClubList(stints, { locale, currentTeam: exceptName, excludeCurrent: true });
}

function formatDateLong(value, locale) {
  if (!value) return null;
  const raw = String(value);
  const parsed = new Date(raw.length <= 10 ? `${raw}T12:00:00+03:00` : raw);
  if (Number.isNaN(parsed.getTime())) return null;
  const tag = locale === "en" ? "en-GB" : "tr-TR";
  return new Intl.DateTimeFormat(tag, { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Istanbul" }).format(parsed);
}

function midSentence(value) {
  const text = String(value || "").trim();
  if (!text) return text;
  return text.charAt(0).toLocaleLowerCase("tr-TR") + text.slice(1);
}

/**
 * "X kimdir?" cevabı — yalnızca modelde duran, doğrulanmış alanlardan
 * 1-3 cümle. Kulüp, lig ve forma no yalnız kayıt doğrulanmışsa girer.
 * Doğum yeri gibi modelde olmayan bir alan yazılmaz.
 */
export function player360Bio(model, options = {}) {
  const locale = options.locale === "en" ? "en" : "tr";
  const identity = (model && model.identity) || {};
  const name = identity.name;
  const sentences = [];
  const birth = formatDateLong(identity.birthDate, locale);
  const age = player360ValuePresent(identity.age) ? String(identity.age).trim() : null;
  const nationality = player360ValuePresent(identity.nationality) ? String(identity.nationality).trim() : null;
  const position = player360ValuePresent(identity.position) ? String(identity.position).trim() : null;
  const team = model && model.verified && player360ValuePresent(identity.team) ? String(identity.team).trim() : null;
  const league = team && player360ValuePresent(identity.league) ? String(identity.league).trim() : null;
  const shirt = team && player360ValuePresent(identity.shirtNumber) ? String(identity.shirtNumber).trim() : null;

  if (locale === "tr") {
    const who = [];
    if (birth && age) who.push(`${birth} doğumlu (${age})`);
    else if (birth) who.push(`${birth} doğumlu`);
    else if (age) who.push(`${age} yaşında`);
    if (nationality) who.push(`${nationality} uyruklu`);
    if (position && who.length) sentences.push(`${name}, ${who.join(", ")} bir ${midSentence(position)} oyuncusudur.`);
    else if (position) sentences.push(`${name} bir ${midSentence(position)} oyuncusudur.`);
    else if (who.length) sentences.push(`${name}, ${who.join(", ")} bir futbolcudur.`);

    if (team) {
      const bits = [`${name}, ${team} formasıyla oynamaktadır`];
      const extras = [];
      if (league) extras.push(league);
      if (shirt) extras.push(`forma numarası ${shirt}`);
      sentences.push(extras.length ? `${name}, ${team} formasıyla oynamaktadır (${extras.join(", ")}).` : `${bits[0]}.`);
    }

    const clubs = uniqueClubs(model && model.career && model.career.stints, team, locale);
    if (clubs.length) {
      sentences.push(clubs.length === 1
        ? `Daha önce ${clubs[0]} forması giydi.`
        : `Daha önce ${clubs.join(", ")} kulüplerinde forma giydi.`);
    }
  } else {
    const who = [];
    if (birth && age) who.push(`born ${birth} (age ${age})`);
    else if (birth) who.push(`born ${birth}`);
    else if (age) who.push(`${age} years old`);
    if (nationality) who.push(`${nationality} nationality`);
    if (position && who.length) sentences.push(`${name} is a ${position} (${who.join(", ")}).`);
    else if (position) sentences.push(`${name} is a ${position}.`);
    else if (who.length) sentences.push(`${name} is a footballer (${who.join(", ")}).`);

    if (team) {
      const extras = [];
      if (league) extras.push(league);
      if (shirt) extras.push(`shirt number ${shirt}`);
      sentences.push(extras.length
        ? `${name} plays for ${team} (${extras.join(", ")}).`
        : `${name} plays for ${team}.`);
    }

    const clubs = uniqueClubs(model && model.career && model.career.stints, team, locale);
    if (clubs.length) {
      sentences.push(clubs.length === 1
        ? `Previous club: ${clubs[0]}.`
        : `Previous clubs: ${clubs.join(", ")}.`);
    }
  }

  return {
    text: sentences.slice(0, 3).join(" "),
    sentences: sentences.slice(0, 3),
    sources: player360KimdirSources(model)
  };
}

/** H1: tam ad + "kimdir?" (TR). İngilizcede ad olduğu gibi kalır. */
export function player360H1(model, options = {}) {
  const locale = options.locale === "en" ? "en" : "tr";
  const name = model.identity.name;
  return locale === "en" ? name : `${name} kimdir?`;
}

function joinDescription(parts, tail, limit) {
  let used = [];
  let result = `${parts[0]} — ${tail}`;
  for (const part of parts) {
    const candidate = `${[...used, part].join(" ")} — ${tail}`;
    if (used.length && candidate.length > limit) break;
    used.push(part);
    result = candidate;
  }
  return result;
}

/**
 * Sık sorulan sorular. Yalnızca değeri duran, "Güncelleniyor" olmayan
 * alanlar için soru üretilir. Görünür metin ile FAQPage şeması aynı dizgeleri kullanır.
 */
export function player360Faq(model, options = {}) {
  const locale = options.locale === "en" ? "en" : "tr";
  const identity = (model && model.identity) || {};
  const name = identity.name;
  const bio = player360Bio(model, { locale });
  const items = [];
  const team = model && model.verified && player360ValuePresent(identity.team) ? String(identity.team).trim() : null;
  const league = team && player360ValuePresent(identity.league) ? String(identity.league).trim() : null;
  const shirt = team && player360ValuePresent(identity.shirtNumber) ? String(identity.shirtNumber).trim() : null;
  const age = player360ValuePresent(identity.age) ? String(identity.age).trim() : null;
  const birth = formatDateLong(identity.birthDate, locale);
  const position = player360ValuePresent(identity.position) ? String(identity.position).trim() : null;
  const nationality = player360ValuePresent(identity.nationality) ? String(identity.nationality).trim() : null;

  if (bio.text) {
    items.push({
      question: locale === "en" ? `Who is ${name}?` : `${name} kimdir?`,
      answer: bio.text
    });
  }
  if (team) {
    items.push({
      question: locale === "en" ? `Which club does ${name} play for?` : `${name} hangi takımda oynuyor?`,
      answer: locale === "en"
        ? (league ? `${name} plays for ${team} (${league}).` : `${name} plays for ${team}.`)
        : (league ? `${name}, ${team} formasıyla oynamaktadır (${league}).` : `${name}, ${team} formasıyla oynamaktadır.`)
    });
  }
  if (age || birth) {
    let answer;
    if (locale === "en") {
      answer = age && birth ? `${name} is ${age} years old (born ${birth}).`
        : age ? `${name} is ${age} years old.`
        : `${name} was born on ${birth}.`;
    } else {
      answer = age && birth ? `${name}, ${birth} doğumlu olup ${age} yaşındadır.`
        : age ? `${name}, ${age} yaşındadır.`
        : `${name}, ${birth} doğumludur.`;
    }
    items.push({
      question: locale === "en" ? `How old is ${name}?` : `${name} kaç yaşında?`,
      answer
    });
  }
  if (position) {
    items.push({
      question: locale === "en" ? `What position does ${name} play?` : `${name} hangi mevkide oynuyor?`,
      answer: locale === "en"
        ? `${name} plays as a ${position}.`
        : `${name}, ${position} mevkiinde oynamaktadır.`
    });
  }
  if (shirt) {
    items.push({
      question: locale === "en" ? `What shirt number does ${name} wear?` : `${name} forma numarası kaç?`,
      answer: locale === "en"
        ? `${name} wears shirt number ${shirt}.`
        : `${name} şu anda ${shirt} numarayı giymektedir.`
    });
  }
  if (nationality) {
    items.push({
      question: locale === "en" ? `Which country is ${name} from?` : `${name} hangi ülkeli?`,
      answer: locale === "en"
        ? `${name} is ${nationality}.`
        : `${name}, ${nationality} uyrukludur.`
    });
  }
  return items;
}

export function player360FaqPage(model, canonical, options = {}) {
  const items = player360Faq(model, options);
  if (!items.length) return null;
  return {
    "@type": "FAQPage",
    "@id": `${canonical}#faq`,
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer }
    }))
  };
}

export function renderPlayer360Bio(model, options = {}) {
  const locale = options.locale === "en" ? "en" : "tr";
  const bio = player360Bio(model, { locale });
  if (!bio.text) return "";
  const sources = bio.sources.map((source) => {
    const host = source.sourceUrl ? source.sourceUrl.replace(/^https?:\/\/(www\.)?/, "").split("/")[0] : "";
    const link = source.sourceUrl
      ? ` · <a href="${escapeHtml(source.sourceUrl)}" rel="nofollow noopener noreferrer" target="_blank">${escapeHtml(host)}</a>`
      : "";
    return `<p class="p360-source">${escapeHtml(text("player360.season.sourceNote", locale, source.sourceName))}${link}</p>`;
  }).join("");
  return `<section class="p360 p360-bio" data-p360-section="bio" aria-label="${escapeHtml(player360H1(model, { locale }))}">
        <p>${escapeHtml(bio.text)}</p>
        ${sources}
      </section>`;
}

export function renderPlayer360Faq(model, options = {}) {
  const locale = options.locale === "en" ? "en" : "tr";
  const items = player360Faq(model, { locale });
  if (!items.length) return "";
  const name = model.identity.name;
  const heading = locale === "en" ? `Frequently asked questions about ${name}` : `${name} hakkında sık sorulan sorular`;
  const rows = items.map((item) => `<div class="p360-faq-item"><dt>${escapeHtml(item.question)}</dt><dd>${escapeHtml(item.answer)}</dd></div>`).join("");
  return `<section class="p360 p360-faq" data-p360-section="faq" aria-labelledby="p360-faq-title">
        <div class="p360-head"><h2 id="p360-faq-title">${escapeHtml(heading)}</h2></div>
        <dl class="p360-faq-list">${rows}</dl>
      </section>`;
}

/** Hero altındaki kimdir bloğu: biyografi + FAQ, aynı metin şemaya da gider. */
export function renderPlayer360Kimdir(model, options = {}) {
  return [renderPlayer360Bio(model, options), renderPlayer360Faq(model, options)].filter(Boolean).join("\n      ");
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

function player360CompactDescription(model, locale) {
  const identity = (model && model.identity) || {};
  const name = identity.name;
  const birth = formatDateLong(identity.birthDate, locale);
  const age = player360ValuePresent(identity.age) ? String(identity.age).trim() : null;
  const nationality = player360ValuePresent(identity.nationality) ? String(identity.nationality).trim() : null;
  const position = player360ValuePresent(identity.position) ? midSentence(identity.position) : null;
  const team = model && model.verified && player360ValuePresent(identity.team) ? String(identity.team).trim() : null;
  const league = team && player360ValuePresent(identity.league) ? String(identity.league).trim() : null;
  const shirt = team && player360ValuePresent(identity.shirtNumber) ? String(identity.shirtNumber).trim() : null;

  const who = [];
  if (birth && age) who.push(`${birth} doğumlu (${age})`);
  else if (birth) who.push(`${birth} doğumlu`);
  else if (age) who.push(`${age} yaşında`);
  if (nationality) who.push(`${nationality} uyruklu`);

  const parts = [];
  if (who.length && position) parts.push(`${name} kimdir? ${who.join(", ")} ${position}.`);
  else if (position) parts.push(`${name} kimdir? ${position}.`);
  else if (who.length) parts.push(`${name} kimdir? ${who.join(", ")}.`);
  else parts.push(`${name} kimdir?`);

  if (team) {
    const extras = [league, shirt ? `${shirt} numara` : null].filter(Boolean);
    parts.push(extras.length
      ? `${team} formasıyla oynuyor (${extras.join(", ")}).`
      : `${team} formasıyla oynuyor.`);
  }
  return parts;
}

export function player360Description(model, options = {}) {
  const locale = options.locale === "en" ? "en" : "tr";
  const name = model.identity.name;
  const tail = locale === "en" ? "on FutbolRadar." : "FutbolRadar'da.";

  // TR: "X kimdir?" niyeti. Cümleler bütün olarak eklenir, ortadan kesilmez.
  if (locale === "tr") {
    const bio = player360Bio(model, { locale });
    if (bio.sentences.length) {
      const full = `${name} kimdir? ${bio.text} — ${tail}`;
      if (full.length <= DESCRIPTION_LIMIT) return full;
    }
    const compact = player360CompactDescription(model, locale);
    if (compact && compact.length) {
      const compactFull = `${compact.join(" ")} — ${tail}`;
      if (compactFull.length <= DESCRIPTION_LIMIT) return compactFull;
      const compactFitted = joinDescription(compact, tail, DESCRIPTION_LIMIT);
      if (compactFitted.length <= DESCRIPTION_LIMIT) return compactFitted;
    }
    if (bio.sentences.length) {
      return joinDescription([`${name} kimdir? ${bio.sentences[0]}`], tail, DESCRIPTION_LIMIT);
    }
    return joinDescription([
      `${name} kimdir? Kulüp, sezon istatistikleri ve piyasa verileri doğrulanmış sağlayıcı kaydıyla eşleştiğinde yayımlanır; tahmini değer gösterilmez`
    ], tail, DESCRIPTION_LIMIT);
  }

  const parts = [];

  const position = model.identity.position;
  if (model.identity.team) {
    parts.push(`${name} plays for ${model.identity.team}${position ? ` as a ${position}` : ""}`);
  } else {
    parts.push(`${name} player profile${position ? `, ${position}` : ""}`);
  }

  const stats = new Map(model.seasonStats.core.map((row) => [row.key, row.value]));
  if (stats.has("goals") || stats.has("assists")) {
    const goals = stats.get("goals");
    const assists = stats.get("assists");
    const matches = stats.get("appearances");
    const measured = [
      matches !== undefined ? `${matches} apps` : null,
      goals !== undefined ? `${goals} goals` : null,
      assists !== undefined ? `${assists} assists` : null
    ].filter(Boolean);
    parts.push(`${model.season} season: ${measured.join(", ")}`);
  }

  if (model.profileEvidence?.matches.length) {
    parts.push(`sourced statistics from ${model.profileEvidence.matches.length} recorded matches, not season totals`);
  }

  if (model.matchLog.available) {
    parts.push(`recent matches with minutes, goals and cards`);
  }

  if (model.availability.available) {
    const status = t(`player360.availability.${model.availability.status}`, locale);
    parts.push(`current status: ${status}`);
  }

  if (model.news.general.length || model.news.transfer.length) {
    parts.push("transfer and news updates");
  }

  if (model.career.available && model.career.stints.length > 1) {
    const clubs = model.career.stints.slice(0, 3).map((stint) => stint.club).join(", ");
    parts.push(`career clubs: ${clubs}`);
  }

  if (parts.length === 1) {
    parts.push("club, season statistics and market data are published once they match a verified provider record — estimates are never shown");
  }

  let used = [];
  let result = `${parts[0]} — ${tail}`;
  for (const part of parts) {
    const candidate = `${[...used, part].join(", ")} — ${tail}`;
    if (used.length && candidate.length > DESCRIPTION_LIMIT) break;
    used.push(part);
    result = candidate;
  }
  return result;
}

/** SEO başlığı. TR'de "kimdir" kalıbı, ~60 karakter; uzun adlarda kuyruk kısalır. */
export function player360Title(model, options = {}) {
  const locale = options.locale === "en" ? "en" : "tr";
  const name = model.identity.name;
  if (locale === "en") {
    return `${name} Stats and Profile | FutbolRadar`;
  }
  const brand = " | FutbolRadar";
  const variants = [
    `${name} Kimdir? Kulübü, Mevkii, İstatistikleri${brand}`,
    `${name} Kimdir? Kulübü ve İstatistikleri${brand}`,
    `${name} Kimdir? İstatistikleri${brand}`,
    `${name} Kimdir?${brand}`,
    `${name} Kimdir?`
  ];
  return variants.find((title) => title.length <= TITLE_LIMIT) || variants[variants.length - 1];
}

/**
 * TRANSFER ODAKLI BAŞLIK — aktif tescil penceresinde kesinleşmiş transferi
 * olan oyuncu için.
 *
 * O hafta arama "Osimhen Galatasaray transferi" biçiminde geliyor; kulüp
 * adını taşıyan başlık o niyetin birebir karşılığı:
 *
 *   "Aleksey Batrakov Galatasaray Transferi ve İstatistikleri | FutbolRadar"
 *
 * Diğer oyuncular `player360Title` ("kimdir" kalıbı) ile devam eder. Marka
 * eki ve "ve İstatistikleri" kuyruğu sırayla düşer; kulüp adı ASLA düşmez
 * (başlığın var olma sebebi o). Takım adı yoksa genel başlığa dönülür.
 */
export const TRANSFER_TITLE_LIMIT = 70;
export function player360TransferTitle(model, team, options = {}) {
  const clean = String(team || "").trim();
  if (!clean || options.locale === "en") return player360Title(model, options);
  const name = model.identity.name;
  const brand = " | FutbolRadar";
  const variants = [
    `${name} ${clean} Transferi ve İstatistikleri${brand}`,
    `${name} ${clean} Transferi ve İstatistikleri`,
    `${name} ${clean} Transferi${brand}`,
    `${name} ${clean} Transferi`
  ];
  return variants.find((title) => title.length <= TRANSFER_TITLE_LIMIT) || variants[variants.length - 1];
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
export function player360Graph(model, canonical, description, breadcrumbs, options = {}) {
  const person = player360Person(model, canonical, description);
  const faqPage = player360FaqPage(model, canonical, options);
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
      },
      ...(faqPage ? [faqPage] : [])
    ]
  };
}
