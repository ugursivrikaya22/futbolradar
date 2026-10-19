#!/usr/bin/env node
/**
 * "/bugunun-maclari-hangi-kanalda" — kalıcı yayın programı sayfası.
 *
 * URL SABİT, İÇERİK GÜNLÜK. Sayfa `bugunun-maclari.html` gibi diğer
 * "çekirdek" sayfalar aynı desenle üretilir: kabuk HTML depoda durur, bu
 * betik her koşuda içeriği `<!-- prerender:X:start/end -->` işaretçileri
 * arasına basar (`npm run build` her dağıtımda, saatlik/5 dakikalık CI
 * işleri de aynı adımı çağırır — bkz. docs/news-ticker.md §7 aynı desen).
 * Başlık ve açıklama de bu koşuda GÜNÜN tarihiyle yeniden yazılır; URL hiç
 * değişmez.
 *
 * KAPSAM BİLEREK DAR: Süper Lig, dört büyük kulüp (hangi turnuvada
 * oynarlarsa oynasınlar) ve büyük Avrupa yarışmaları/ligleri — kural tek
 * yerde, services/broadcastSchedule.js.
 *
 * YAYIN KANALI UYDURULMAZ. Sağlayıcı vermediyse alan boş kalır ve sayfa
 * bunu nötr bir notla söyler; bir kanal adı asla tahmin edilmez.
 *
 * SAF SSR: bu sayfa `data-api-target` TAŞIMAZ, yani istemci tarafında API
 * ile yeniden çizilmez — görülen HTML, arama motorunun gördüğü HTML ile
 * birebir aynıdır.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);

const { curatedMatches } = require("../services/providers/mockProvider.js");
const {
  broadcastChannels,
  broadcastLabel,
  istanbulDayOffset,
  competitionDisplayName,
  selectBroadcastMatches
} = require("../services/broadcastSchedule.js");
const {
  displayStatusLabel,
  hasReadableScore,
  isFinishedStatus,
  istanbulDay,
  liveVerdict,
  statusLabel
} = require("../services/matchStatus.js");
const { minuteOrStatusLabel } = require("../services/liveScoresTicker.js");
const { matchDetailPath } = require("../services/matchProgram.js");
const { matchListSchema } = require("../services/matchSchema.js");
const { escapeHtml, fixtureTeamInitials, leagueMarkHtml } = require("./lib/matchCards.mjs");

const DOMAIN = "https://www.futbolradar.com";

/**
 * İKİ SAYFA, TEK ÜRETİCİ: BUGÜN VE YARIN.
 *
 * "Hangi kanalda" sorusu maç günü değil, bir gün önce soruluyor. Bugün
 * sayfası o soruya ancak geç cevap veriyordu: okuyucu akşam 20.00 maçının
 * kanalını öğrenmek için sabaha kadar bekliyordu. Yarın sayfası aynı veriyi
 * bir gün önceden yayımlar.
 *
 * İki sayfa AYNI koddan üretilir. Ayrı bir üretici yazmak, yayın satırı
 * kuralının iki yerde ayrışmasına açık kapı bırakırdı — bu depoda daha önce
 * tam olarak bu şekilde kırılan bir yer var (bkz. services/newsFeed.js).
 */
const PAGES = Object.freeze([
  Object.freeze({
    file: "bugunun-maclari-hangi-kanalda.html",
    slug: "bugunun-maclari-hangi-kanalda",
    offset: 0,
    dayWord: "Bugün",
    heading: "Bugünkü Maçlar Hangi Kanalda?",
    titleFor: (label) => `Bugünkü Maçlar Hangi Kanalda? ${label} Maç Programı | FutbolRadar`
  }),
  Object.freeze({
    file: "yarinki-maclar-hangi-kanalda.html",
    slug: "yarinki-maclar-hangi-kanalda",
    offset: 1,
    dayWord: "Yarın",
    heading: "Yarın Hangi Maçlar Hangi Kanalda?",
    titleFor: (label) => `Yarın Hangi Maçlar Hangi Kanalda? ${label} Maç Programı | FutbolRadar`
  })
]);
// Kalıcı, temiz adres — vercel.json'daki rewrite bunu dosyaya eşler.
// Canonical/og:url/schema @id hep bu adrese işaret eder, .html'e değil.
const pageUrlFor = (page) => `${DOMAIN}/${page.slug}`;

const retryBuffer = new Int32Array(new SharedArrayBuffer(4));

function writeGeneratedFile(file, contents) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      fs.writeFileSync(file, contents, "utf8");
      return;
    } catch (error) {
      const retryable = ["UNKNOWN", "EBUSY", "EPERM"].includes(error && error.code);
      if (!retryable || attempt === 11) throw error;
      Atomics.wait(retryBuffer, 0, 0, 75 * (attempt + 1));
    }
  }
}

function text(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

function replaceStaticSlot(html, target, content) {
  const markerStart = `<!-- prerender:${target}:start -->`;
  const markerEnd = `<!-- prerender:${target}:end -->`;
  if (!html.includes(markerStart) || !html.includes(markerEnd)) return html;
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expression = new RegExp(`${escape(markerStart)}[\\s\\S]*?${escape(markerEnd)}`);
  return html.replace(expression, `${markerStart}\n${content}\n${markerEnd}`);
}

function jsonLdScript(schema) {
  if (!schema) return "";
  const json = JSON.stringify(schema).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${json}</script>`;
}

function dateLabel(day) {
  const parsed = new Date(`${day}T12:00:00+03:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(parsed);
}

function longDateLabel(day) {
  const parsed = new Date(`${day}T12:00:00+03:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "numeric",
    month: "long",
    weekday: "long"
  }).format(parsed);
}

function kickoffTimeLabel(match) {
  const explicit = text(match && match.time);
  if (explicit) return explicit;
  const kickoff = text(match && match.kickoff);
  if (!kickoff) return "";
  const parsed = new Date(kickoff);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(parsed);
}

/**
 * Kartın üst-sağ durum etiketi ve skor gösterilip gösterilmeyeceği.
 * `liveVerdict` tek yetkili kapı (services/matchStatus.js): canlı iddiası
 * skor/dakika verisi yoksa ya da veri bayatsa yapılmaz.
 */
function stateFor(match) {
  const verdict = liveVerdict(match);
  if (verdict.live) {
    return { stateClass: "is-live", stateLabel: "Canlı", showScore: true, minuteLabel: minuteOrStatusLabel(match) };
  }
  if (isFinishedStatus(match) && hasReadableScore(match)) {
    return { stateClass: "is-final", stateLabel: statusLabel(match), showScore: true, minuteLabel: "" };
  }
  if (verdict.verdict === "not-live" && verdict.reason === "not-started") {
    const time = kickoffTimeLabel(match);
    return { stateClass: "", stateLabel: time || "Saat bekleniyor", showScore: false, minuteLabel: "" };
  }
  return { stateClass: "", stateLabel: displayStatusLabel(match), showScore: false, minuteLabel: "" };
}

function scoreRow(name, score, otherScore) {
  const winner = score !== null && otherScore !== null && Number(score) > Number(otherScore);
  return `<div class="fixture-row${winner ? " is-winner" : ""}">` +
    `<span class="fixture-row-fallback" aria-hidden="true">${escapeHtml(fixtureTeamInitials(name))}</span>` +
    `<span class="fixture-row-name">${escapeHtml(name)}</span>` +
    `<span class="fixture-row-score">${score === null || score === undefined ? "–" : escapeHtml(score)}</span>` +
    `</div>`;
}

/**
 * Yayın satırı — metin ortak servisten gelir.
 *
 * Sayfa eskiden kendi cümlesini kuruyordu ("Yayın kanalı henüz
 * açıklanmadı"), kartlar başka bir cümle kuruyordu. Aynı durum iki farklı
 * ifadeyle anlatıldığında okuyucu ikisinin farklı şeyler anlattığını sanır.
 * Cümle artık services/broadcastSchedule.js#broadcastLabel'da, tek yerde.
 */
function broadcastRowHtml(match) {
  const label = broadcastLabel(match, "tr");
  const pending = label.state !== "verified";
  const body = pending ? escapeHtml(label.text) : `Yayın: <b>${escapeHtml(label.channel)}</b>`;
  return `<div class="fixture-card-broadcast${pending ? " is-unknown" : ""}" data-broadcast="${pending ? "pending" : "verified"}">` +
    `<span class="fixture-card-broadcast-icon" aria-hidden="true">📺</span><span>${body}</span></div>`;
}

function matchCardHtml(match) {
  const state = stateFor(match);
  const league = competitionDisplayName(match);
  const home = text(match.homeTeam);
  const away = text(match.awayTeam);
  const homeScore = state.showScore && match.score ? match.score.home : null;
  const awayScore = state.showScore && match.score ? match.score.away : null;
  const href = matchDetailPath(match);
  const minuteHtml = state.stateClass === "is-live" && state.minuteLabel
    ? `<span class="fixture-card-live-minute"><i class="live-pulse" aria-hidden="true"></i>${escapeHtml(state.minuteLabel)}</span>`
    : "";

  return `<article class="fixture-card${state.stateClass ? ` ${state.stateClass}` : ""}" data-card="fixture" data-match="${escapeHtml(match.id || "")}">
    <div class="fixture-card-top"><span class="fixture-card-league">${leagueMarkHtml(league)}${escapeHtml(league)}</span><span class="fixture-card-state ${escapeHtml(state.stateClass)}">${escapeHtml(state.stateLabel)}${minuteHtml}</span></div>
    <div class="fixture-card-time">${escapeHtml(kickoffTimeLabel(match) || "Saat bekleniyor")} TSİ</div>
    <div class="fixture-card-rows">${scoreRow(home, homeScore, awayScore)}${scoreRow(away, awayScore, homeScore)}</div>
    ${broadcastRowHtml(match)}
    ${match.broadcastSourceUrl ? `<a class="detail-link" href="${escapeHtml(match.broadcastSourceUrl)}" target="_blank" rel="nofollow noopener noreferrer">Yayıncı programını doğrula</a>` : ""}
    <a class="fixture-card-action" href="${escapeHtml(href)}" data-match-click>Maç ayrıntısını aç</a>
  </article>`;
}

function emptyStateHtml(dayLabel) {
  return `<div class="broadcast-schedule-empty card"><strong>Bugün önceliklendirilen liglerde ya da dört büyük kulüpte maç bulunmuyor.</strong><span>${escapeHtml(dayLabel)} için Süper Lig, Şampiyonlar Ligi, Avrupa Ligi, Premier League, La Liga, Serie A ve Bundesliga programında kayıtlı bir karşılaşma yok.</span></div>`;
}

/**
 * Boş gün metni sayfaya göre değişir: "bugün maç yok" ile "yarın maç yok"
 * aynı cümle değildir ve ikisi de doğru olabilir.
 */
function emptyStateFor(page, dayLongLabel) {
  return `<div class="broadcast-schedule-empty card"><strong>${escapeHtml(page.dayWord)} önceliklendirilen liglerde ya da Türk takımlarında maç bulunmuyor.</strong><span>${escapeHtml(dayLongLabel)} için Süper Lig, 1. Lig, Şampiyonlar Ligi, Avrupa Ligi, Konferans Ligi, Premier League, La Liga, Serie A, Bundesliga ve Ligue 1 programında kayıtlı bir karşılaşma yok.</span></div>`;
}

const allMatches = curatedMatches();
let generated = 0;

for (const page of PAGES) {
  const dayIso = istanbulDayOffset(page.offset);
  const matches = selectBroadcastMatches(allMatches, { day: dayIso });
  const pageUrl = pageUrlFor(page);
  const dayLongLabel = longDateLabel(dayIso) || page.dayWord;
  const dayShortLabel = dateLabel(dayIso) || dayLongLabel;

  // İki sayfa birbirine bağlanır: "bugün"e bakan okuyucu yarını da merak
  // eder ve tersi. Aynı zamanda her iki sayfayı da orphan olmaktan çıkarır.
  const sibling = PAGES.find((other) => other.slug !== page.slug);
  const crossLinkHtml = sibling
    ? `<p class="broadcast-schedule-crosslink"><a class="detail-link" href="./${escapeHtml(sibling.file)}">${escapeHtml(sibling.heading)}</a></p>`
    : "";

  const listHtml = (matches.length
    ? `<div class="grid broadcast-schedule-grid">${matches.map(matchCardHtml).join("")}</div>`
    : emptyStateFor(page, dayLongLabel)) + crossLinkHtml;

  const title = page.titleFor(dayShortLabel);
  const description = `${dayShortLabel}: Süper Lig, 1. Lig, Galatasaray, Fenerbahçe, Beşiktaş, Trabzonspor, Şampiyonlar Ligi, Avrupa Ligi, Konferans Ligi, Premier League, La Liga, Serie A, Bundesliga ve Ligue 1 maçlarının saatleri ve yayın kanalları.`;

  const schema = [
    matchListSchema(matches, {
      name: `${page.dayWord} oynanacak öncelikli futbol maçları ve yayın bilgileri`,
      urlFor: (match) => (match && (match.matchPage || match.analysisPage) ? matchDetailPath(match) : ""),
      broadcastFor: (match) => broadcastChannels(match)
    }),
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      "@id": pageUrl,
      url: pageUrl,
      name: title,
      isPartOf: { "@type": "WebSite", name: "FutbolRadar", url: `${DOMAIN}/` },
      inLanguage: "tr-TR",
      description
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Ana Sayfa", item: `${DOMAIN}/` },
        { "@type": "ListItem", position: 2, name: "Maç Merkezi", item: `${DOMAIN}/mac-merkezi.html` },
        { "@type": "ListItem", position: 3, name: page.heading, item: pageUrl }
      ]
    }
  ].filter(Boolean).map(jsonLdScript).join("\n");

  const sourcePath = path.join(root, page.file);
  if (!fs.existsSync(sourcePath)) {
    console.warn(`[broadcast-schedule] kabuk dosya yok: ${page.file} — sayfa atlandı.`);
    continue;
  }

  let html = fs.readFileSync(sourcePath, "utf8");
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`);
  html = html.replace(/(<meta name="description" content=")[^"]*("\s*\/>)/, `$1${escapeHtml(description)}$2`);
  html = html.replace(/(<meta property="og:title" content=")[^"]*("\s*\/>)/, `$1${escapeHtml(title)}$2`);
  html = html.replace(/(<meta property="og:description" content=")[^"]*("\s*\/>)/, `$1${escapeHtml(description)}$2`);
  html = html.replace(/(<meta name="twitter:title" content=")[^"]*("\s*\/>)/, `$1${escapeHtml(title)}$2`);
  html = html.replace(/(<meta name="twitter:description" content=")[^"]*("\s*\/>)/, `$1${escapeHtml(description)}$2`);
  html = replaceStaticSlot(html, "broadcast-date-label", escapeHtml(dayLongLabel));
  html = replaceStaticSlot(html, "broadcast-matches", listHtml);
  html = replaceStaticSlot(html, "broadcast-schema", schema);

  for (const targetRoot of [root, path.join(root, "public")]) {
    writeGeneratedFile(path.join(targetRoot, page.file), html);
  }

  console.log(`Generated ${page.file} (${matches.length} maç, ${dayIso})`);
  generated += 1;
}

console.log(`[broadcast-schedule] ${generated} sayfa üretildi.`);
