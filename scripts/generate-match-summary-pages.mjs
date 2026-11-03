#!/usr/bin/env node
/**
 * KALICI MAÇ ÖZETİ SAYFALARI — /ozet/<slug> (derleme anında, statik).
 *
 * Kaynak: `data/match-summaries.json` (saatlik iş motorunun ürettiği kalıcı
 * sicil) + derleme anındaki `data/fixture-calendar.json` (sicilde henüz
 * olmayan yeni bitmiş maçlar bellekte eklenir; dosyaya yazılmaz).
 * `<slug>`, maçın kalıcı `/mac/<slug>` adresiyle AYNIDIR (data/match-seo-index.json).
 *
 * Her satır saklanan veriden gelir; verisi olmayan bölüm basılmaz.
 * Yazdıkları:
 *   ozet/<slug>.html (+ public/ aynası)
 *   index.html          <!-- match-summary-recent:start/end --> "Son maçlar"
 *   takimlar/<t>.html, <t>-maclari.html  <!-- match-summary-team:start/end -->
 *   mac/<slug>.html     <!-- match-summary-link:start/end --> (özet bağlantısı)
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { siteHeader, siteFooter } from "./lib/layout.mjs";
import { ROBOTS_INDEX, ROBOTS_NOINDEX_FOLLOW } from "./lib/robots.mjs";

const require = createRequire(import.meta.url);
const core = require("../services/matchSummary/index.js");
const { TEAM_PAGE_TABLE, teamPageSlug } = require("../services/superLigTeamPages.js");
const root = process.cwd();
const HOME_LIMIT = 8;
const TEAM_LIMIT = 5;

const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function readJson(rel, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8")); } catch { return fallback; }
}

function writeBoth(rel, html) {
  for (const base of [root, path.join(root, "public")]) {
    const target = path.join(base, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, html, "utf8");
  }
}

function formatDate(iso) {
  return new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}
function shortDate(iso) {
  return new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "long" }).format(new Date(iso));
}

function goalLabel(g) {
  return g.kind === "penalty" ? " (penaltı)" : g.kind === "own-goal" ? " (kendi kalesine)" : "";
}

function goalsHtml(s) {
  if (!s.events.goals.length) return "";
  const items = s.events.goals.map((g) => `<li><b>${g.minute ? `${esc(g.minute)}'` : ""}</b> ${esc(g.player || "Oyuncu bilgisi yok")}${esc(goalLabel(g))}${g.team ? ` <span class="ozet-team">${esc(g.team)}${g.kind === "own-goal" ? " hanesine" : ""}</span>` : ""}</li>`).join("");
  return `<section class="post-match-section ozet-section" id="goller" aria-labelledby="ozet-goller"><h2 id="ozet-goller">Goller</h2><ol class="ozet-list">${items}</ol></section>`;
}

function keyEventsHtml(s) {
  const rows = [];
  for (const r of s.events.redCards) rows.push({ minute: r.minute, html: `🟥 ${esc(r.player || "Oyuncu bilgisi yok")}${r.secondYellow ? " (ikinci sarı)" : ""}${r.team ? ` <span class="ozet-team">${esc(r.team)}</span>` : ""} — kırmızı kart` });
  for (const p of s.events.penalties) rows.push({ minute: p.minute, html: `⚽ ${esc(p.player || "Oyuncu bilgisi yok")}${p.team ? ` <span class="ozet-team">${esc(p.team)}</span>` : ""} — penaltı ${p.outcome === "missed" ? "kaçırıldı" : "golle sonuçlandı"}` });
  if (!rows.length) return "";
  const num = (m) => { const [a, b] = String(m || "999").split("+").map(Number); return a + (b || 0) / 100; };
  rows.sort((a, b) => num(a.minute) - num(b.minute));
  return `<section class="post-match-section ozet-section" id="onemli-olaylar" aria-labelledby="ozet-olaylar"><h2 id="ozet-olaylar">Önemli olaylar</h2><ul class="ozet-list">${rows.map((r) => `<li><b>${r.minute ? `${esc(r.minute)}'` : ""}</b> ${r.html}</li>`).join("")}</ul></section>`;
}

function statsHtml(s) {
  const rows = core.STAT_KEYS.filter((d) => s.stats[d.key]).map((d) => {
    const v = s.stats[d.key];
    const total = v.home + v.away;
    const share = total > 0 ? Math.round((v.home / total) * 100) : 50;
    return `<div class="ozet-stat"><span class="ozet-stat-val">${esc(d.unit === "%" ? `%${v.home}` : v.home)}</span><span class="ozet-stat-label">${esc(d.label)}</span><span class="ozet-stat-val">${esc(d.unit === "%" ? `%${v.away}` : v.away)}</span><span class="ozet-bar" aria-hidden="true"><i style="width:${share}%"></i></span></div>`;
  });
  if (!rows.length) return "";
  return `<section class="post-match-section ozet-section" id="istatistikler" aria-labelledby="ozet-istatistik"><h2 id="ozet-istatistik">Öne çıkan istatistikler</h2><div class="ozet-stats"><div class="ozet-stat ozet-stat-head"><span>${esc(s.homeTeam)}</span><span></span><span>${esc(s.awayTeam)}</span></div>${rows.join("")}</div></section>`;
}

function teamLinks(s) {
  const out = [];
  for (const name of [s.homeTeam, s.awayTeam]) {
    const slug = teamPageSlug(name);
    if (slug && fs.existsSync(path.join(root, "takimlar", `${slug}.html`))) out.push(`<a href="../takimlar/${slug}"><span>Takım profili</span><strong>${esc(name)}</strong></a>`);
  }
  return out.join("");
}

export function pageHtml(s) {
  const url = core.summaryUrl(s.slug);
  const title = `${core.scoreLine(s)} maç özeti${s.league ? ` | ${s.league}` : ""} | FutbolRadar`;
  const description = `${core.scoreLine(s)} maç özeti: ${s.events.goals.length ? "goller, " : ""}${s.events.redCards.length || s.events.penalties.length ? "önemli olaylar, " : ""}${Object.keys(s.stats).length ? "istatistikler ve " : ""}tek cümlelik değerlendirme.`;
  const indexable = core.hasSubstance(s);
  const ht = Number.isFinite(s.score.halftimeHome) ? `<small>İlk yarı ${esc(s.score.halftimeHome)}-${esc(s.score.halftimeAway)}</small>` : "";
  const extra = s.providerStatus === "AET" ? "<small>Uzatmalar sonunda</small>" : s.providerStatus === "PEN" ? "<small>Uzatmalar sonunda; penaltı atışlarına gidildi</small>" : "";
  const macExists = fs.existsSync(path.join(root, "mac", `${s.slug}.html`));
  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#0f172a" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}" />
    <link rel="canonical" href="${url}" />
    <meta name="robots" content="${indexable ? ROBOTS_INDEX : ROBOTS_NOINDEX_FOLLOW}" />
    <meta property="og:type" content="article" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:url" content="${url}" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:image" content="${core.SITE}/assets/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(title)}" />
    <meta name="twitter:description" content="${esc(description)}" />
    <meta name="twitter:image" content="${core.SITE}/assets/og-image.png" />
    <script type="application/ld+json">${JSON.stringify(core.jsonLd(s)).replace(/</g, "\\u003c")}</script>
    <link rel="icon" href="../favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="/site.webmanifest" />
    <link rel="stylesheet" href="../page.css" />
  </head>
  <body class="subpage post-match-page ozet-page">
    ${siteHeader({ base: "../" })}
    <main class="container">
      <nav class="breadcrumb" aria-label="Sayfa yolu"><a href="../index.html">Ana Sayfa</a><span>/</span><a href="../mac-merkezi.html">Maç Merkezi</a><span>/</span><span>${esc(s.homeTeam)} - ${esc(s.awayTeam)} maç özeti</span></nav>
      <section class="post-match-hero">
        <div class="post-match-heading"><span class="eyebrow">Maç özeti${s.league ? ` · ${esc(s.league)}` : ""}${s.round != null ? ` · ${esc(s.round)}. hafta` : ""}</span><h1>${esc(s.homeTeam)} ${esc(s.score.home)}-${esc(s.score.away)} ${esc(s.awayTeam)}</h1><p class="ozet-comment">${esc(s.comment)}</p><div class="post-match-meta"><span><time datetime="${esc(s.kickoff)}">${esc(formatDate(s.kickoff))}</time></span>${s.venue ? `<span>${esc(s.venue)}</span>` : ""}${s.referee ? `<span>Hakem: ${esc(s.referee)}</span>` : ""}</div></div>
        <div class="post-match-scoreboard" aria-label="Maç sonucu">
          <div><strong>${esc(s.homeTeam)}</strong></div>
          <div class="post-match-score"><span>Maç sonucu</span><b>${esc(s.score.home)}<i>-</i>${esc(s.score.away)}</b>${ht}${extra}</div>
          <div><strong>${esc(s.awayTeam)}</strong></div>
        </div>
      </section>
      ${goalsHtml(s)}
      ${keyEventsHtml(s)}
      ${statsHtml(s)}
      <p class="ozet-source">Bu özet, maçın sağlayıcı verisinden (skor, olay dökümü ve takım istatistikleri) otomatik üretilmiştir; verisi olmayan bölüm gösterilmez. Son güncelleme: <time datetime="${esc(s.updatedAt || s.kickoff)}">${esc(formatDate(s.updatedAt || s.kickoff))}</time>.</p>
      <section class="post-match-next-grid">
        ${macExists ? `<a href="../mac/${esc(s.slug)}"><span>Maç sayfası</span><strong>${esc(s.homeTeam)} - ${esc(s.awayTeam)}</strong><p>Kadrolar, tüm olaylar ve maç merkezi.</p></a>` : ""}
        ${teamLinks(s)}
        <a href="../mac-merkezi.html"><span>Maç merkezi</span><strong>Tüm maçlar</strong></a>
      </section>
    </main>
    ${siteFooter({ base: "../" })}
    <script src="../site.js" defer></script>
  </body>
</html>
`;
}

function cardList(list, base) {
  return `<ul class="ozet-recent">${list.map((s) => `<li><a href="${base}ozet/${esc(s.slug)}"><span class="ozet-recent-date">${esc(shortDate(s.kickoff))}${s.league ? ` · ${esc(s.league)}` : ""}</span><strong>${esc(s.homeTeam)} <b>${esc(s.score.home)}-${esc(s.score.away)}</b> ${esc(s.awayTeam)}</strong><span class="ozet-recent-cta">Maç özeti</span></a></li>`).join("")}</ul>`;
}

function applyBlock(html, start, end, block, beforeNeedle) {
  const re = new RegExp(`${start}[\\s\\S]*?${end}`);
  if (re.test(html)) return html.replace(re, () => block);
  if (beforeNeedle && html.includes(beforeNeedle)) return html.replace(beforeNeedle, () => `${block}\n${beforeNeedle}`);
  return null;
}

// Bloğu kökteki dosyaya ve (varsa) public/ aynasına AYRI AYRI uygular; ayna
// kendi içeriğini korur (kopyalanmaz).
function replaceBlock(rel, start, end, content, beforeNeedle) {
  const block = `${start}\n${content}\n${end}`;
  let ok = false;
  for (const file of [path.join(root, rel), path.join(root, "public", rel)]) {
    if (!fs.existsSync(file)) continue;
    const html = fs.readFileSync(file, "utf8");
    const next = applyBlock(html, start, end, block, beforeNeedle);
    if (next === null) continue;
    if (next !== html) fs.writeFileSync(file, next, "utf8");
    if (file === path.join(root, rel)) ok = true;
  }
  return ok;
}

export function run() {
  const registry = readJson("data/match-summaries.json", { version: 1, summaries: {} });
  const { registry: merged } = core.updateRegistry(registry, readJson("data/fixture-calendar.json", { matches: [] }), readJson("data/match-seo-index.json", {}));
  const all = core.sortedSummaries(merged);
  for (const s of all) writeBoth(`ozet/${s.slug}.html`, pageHtml(s));

  // Ana sayfa: "Son maçlar" — en yeni özetler.
  const recent = all.slice(0, HOME_LIMIT);
  const homeBlock = recent.length ? `<section class="container section ozet-home" id="son-mac-ozetleri" aria-labelledby="son-mac-ozetleri-title">
          <div class="section-head"><div class="section-title"><span class="section-kicker">Son maçlar</span><h2 id="son-mac-ozetleri-title">Biten maçların özetleri</h2><p>Skor, goller, önemli olaylar ve öne çıkan istatistikler.</p></div></div>
          ${cardList(recent, "./")}
        </section>` : "";
  replaceBlock("index.html", "<!-- match-summary-recent:start -->", "<!-- match-summary-recent:end -->", homeBlock, null);

  // İlgili takım sayfaları: takım profili + "<takım> maçları".
  let teamPages = 0;
  for (const { slug: teamSlug } of TEAM_PAGE_TABLE) {
    const list = all.filter((s) => teamPageSlug(s.homeTeam) === teamSlug || teamPageSlug(s.awayTeam) === teamSlug).slice(0, TEAM_LIMIT);
    for (const [rel, base] of [[`takimlar/${teamSlug}.html`, "../"], [`${teamSlug}-maclari.html`, "./"]]) {
      const content = list.length ? `<section class="post-match-section ozet-team-block" aria-label="Son maç özetleri"><h2>Son maç özetleri</h2>${cardList(list, base)}</section>` : "";
      if (replaceBlock(rel, "<!-- match-summary-team:start -->", "<!-- match-summary-team:end -->", content, "</main>")) teamPages += 1;
    }
  }

  // /mac/<slug> → /ozet/<slug> bağlantısı (maç sayfası varsa).
  let macLinks = 0;
  for (const s of all) {
    const rel = `mac/${s.slug}.html`;
    if (replaceBlock(rel, "<!-- match-summary-link:start -->", "<!-- match-summary-link:end -->", `<p class="ozet-mac-link"><a class="detail-link" href="../ozet/${esc(s.slug)}">Maç özetini oku</a></p>`, "</main>")) macLinks += 1;
  }
  console.log(`[match-summary-pages] sayfa=${all.length} ana-sayfa=${recent.length} takım-sayfası=${teamPages} mac-bağlantısı=${macLinks}`);
  return { pages: all.length, recent: recent.length };
}

if (import.meta.url === `file://${process.argv[1]}`) run();
