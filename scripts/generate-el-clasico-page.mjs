#!/usr/bin/env node
/**
 * El Clásico (Barcelona – Real Madrid) kalıcı SEO sayfası.
 *
 * Çıktı: el-clasico-barcelona-real-madrid.html (kök + public/), kanonik uzantısız.
 * Veri: data/el-clasico.json (kaynaklı fikstür, yayın, ikili rekabet),
 *       data/fixture-calendar.json (aynı providerId varsa güncel durum/skor),
 *       data/league-standings.json (La Liga sıra/form).
 * Kural: kaynağı olmayan bölüm hiç çizilmez; içerik zayıfsa sayfa noindex olur.
 * Ortak başlık/altlık, manifest ve pwa.js postprocess zincirinde enjekte edilir.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { siteFooter, siteHeader } from "./lib/layout.mjs";
import { URL_ENTRY_RE, wrapUrlset } from "./lib/sitemap.mjs";
import { ROBOTS_INDEX, ROBOTS_NOINDEX_FOLLOW } from "./lib/robots.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteUrl = "https://www.futbolradar.com";
export const EL_CLASICO_SLUG = "el-clasico-barcelona-real-madrid";
const canonical = `${siteUrl}/${EL_CLASICO_SLUG}`;

const readJson = (rel, fallback) => {
  try { return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8")); } catch { return fallback; }
};
const esc = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const src = (url, name) => `<a href="${esc(url)}" rel="nofollow noopener noreferrer" target="_blank">${esc(name)}</a>`;
const isClasico = (m) => {
  const t = [m?.homeTeam, m?.awayTeam].map((x) => String(x || "").trim());
  return t.includes("Barcelona") && t.includes("Real Madrid");
};
const trDate = (iso, withTime = true) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const opts = { timeZone: "Europe/Istanbul", day: "numeric", month: "long", year: "numeric" };
  if (withTime && String(iso).includes("T")) Object.assign(opts, { weekday: "long", hour: "2-digit", minute: "2-digit" });
  return new Intl.DateTimeFormat("tr-TR", opts).format(d);
};

function calendarMatches() {
  const out = [];
  const walk = (o) => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (o && typeof o === "object") {
      if (o.homeTeam && o.awayTeam && isClasico(o)) out.push(o);
      else Object.values(o).forEach(walk);
    }
  };
  walk(readJson("data/fixture-calendar.json", []));
  return out;
}

// Köşe yazısı sayfaları build adımında (generate-column-pages) üretilir; yalnızca açılan sayfaya bağlantı verilir.
const columnPageExists = (slug) => fs.existsSync(path.join(root, "kose-yazilari", `${slug}.html`));

export function buildModel({ now = new Date(), data = readJson("data/el-clasico.json", {}), calendar = calendarMatches(), standings = readJson("data/league-standings.json", {}) } = {}) {
  const fixtures = (data.fixtures || []).filter((f) => f.sourceUrl && isClasico(f)).map((f) => {
    const live = f.providerId && calendar.find((m) => String(m.providerId || m.id) === String(f.providerId));
    if (!live) return { ...f };
    const merged = { ...f, kickoff: live.kickoff || f.kickoff, status: live.status || f.status, venue: live.venue || f.venue };
    if (live.status === "FINISHED" && Number.isFinite(live.score?.home) && Number.isFinite(live.score?.away)) merged.score = live.score;
    return merged;
  });
  const ts = (f) => new Date(f.kickoff).getTime();
  const next = fixtures.filter((f) => f.status !== "FINISHED" && ts(f) > now.getTime()).sort((a, b) => ts(a) - ts(b))[0] || null;
  const last = fixtures.filter((f) => f.status === "FINISHED" && f.score && Number.isFinite(f.score.home)).sort((a, b) => ts(b) - ts(a))[0] || null;
  const table = standings?.["la-liga"]?.table || [];
  const rows = ["Barcelona", "Real Madrid"].map((n) => table.find((r) => r.team === n)).filter((r) => r && r.source && Number(r.played) > 0);
  const h2h = data.headToHead?.sourceUrl && data.headToHead?.total ? data.headToHead : null;
  const cols = (readJson("data/columns.json", {}).columns || []).filter((c) => (!c.status || c.status === "published") && c.slug && ["Barcelona", "Real Madrid"].every((t) => (c.tags || []).includes(t)) && /cl[aá]sico/i.test(`${c.title} ${(c.tags || []).join(" ")}`)).filter((c) => columnPageExists(c.slug)).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 3);
  const pv = data.preview;
  const pvSrc = (k) => pv?.sources?.[k]?.sourceUrl && /^https:\/\//.test(pv.sources[k].sourceUrl) ? pv.sources[k] : null;
  const preview = pv?.column?.date ? {
    ...pv,
    stats: (pv.stats || []).filter((s) => s.value && pvSrc(s.source)).map((s) => ({ ...s, src: pvSrc(s.source) })),
    sections: (pv.sections || []).filter((x) => x.h3 && x.paragraphs?.length && (x.sources || []).length && x.sources.every(pvSrc)).map((x) => ({ ...x, srcs: x.sources.map(pvSrc) })),
    columnPublished: (readJson("data/columns.json", {}).columns || []).some((c) => c.slug === pv.column.slug && (!c.status || c.status === "published")) && columnPageExists(pv.column.slug)
  } : null;
  const sections = { hero: Boolean(next || last), preview: Boolean(preview && (preview.stats.length || preview.sections.length)), h2h: Boolean(h2h), standings: rows.length === 2, broadcast: Boolean(next?.broadcast?.sourceUrl && next.broadcast.channels?.length) };
  const indexable = [sections.hero, sections.h2h, sections.standings].filter(Boolean).length >= 2;
  return { preview, columns: cols, next, last, h2h, rows, standingsUpdatedAt: standings?.["la-liga"]?.updatedAt || null, sections, indexable };
}

function faqItems(m) {
  const q = [];
  if (m.next) {
    q.push(["El Clásico ne zaman?", `Sıradaki El Clásico, ${m.next.homeTeam} – ${m.next.awayTeam} maçı ${trDate(m.next.kickoff)} (Türkiye saati) oynanacak; ${m.next.competition}${m.next.round ? ` ${m.next.round}. hafta` : ""}, ${m.next.venue}.`]);
    if (m.sections.broadcast) q.push(["Barcelona – Real Madrid maçı hangi kanalda?", `Maç Türkiye'de ${m.next.broadcast.channels.join(" ve ")} üzerinden yayınlanacak (kaynak: ${m.next.broadcast.sourceName}).`]);
  }
  const opta = m.sections.preview && m.preview.stats.find((s) => s.source === "goal" && /Opta/.test(s.label));
  if (opta) q.push(["El Clásico'da favori kim?", `${trDate(m.preview.matchKickoff, false)} maçı öncesinde Opta'nın galibiyet olasılığı endeksi: ${opta.detail} (kaynak: Goal.com).`]);
  if (m.last) q.push(["Son El Clásico nasıl bitti?", `Son El Clásico'da ${m.last.homeTeam} ${m.last.score.home}–${m.last.score.away} ${m.last.awayTeam} (${trDate(m.last.kickoff, false)}, ${m.last.competition}).`]);
  if (m.h2h) {
    const t = m.h2h.total;
    q.push(["El Clásico'da kim daha fazla kazandı?", `${trDate(m.h2h.asOf, false)} itibarıyla ${t.played} resmî maçta Barcelona ${t.barcelonaWins}, Real Madrid ${t.realMadridWins} galibiyet aldı; ${t.draws} maç berabere bitti (kaynak: ${m.h2h.sourceName}).`]);
  }
  if (m.sections.standings) {
    const [b, r] = m.rows;
    q.push(["Barcelona ve Real Madrid La Liga'da kaçıncı?", `Kayıtlı son tabloya göre Barcelona ${b.rank}. sırada (${b.points} puan, ${b.played} maç), Real Madrid ${r.rank}. sırada (${r.points} puan, ${r.played} maç).`]);
  }
  return q;
}

function render(m) {
  const title = m.next ? "El Clásico: Barcelona – Real Madrid Maçı Ne Zaman, Hangi Kanalda? | FutbolRadar" : "El Clásico: Barcelona – Real Madrid Maç Önü Analiz ve İstatistikler | FutbolRadar";
  const description = m.next
    ? `El Clásico ${trDate(m.next.kickoff)} TSİ, ${m.next.venue}.${m.sections.broadcast ? ` Yayın: ${m.next.broadcast.channels.join(", ")}.` : ""} Barcelona – Real Madrid ikili rekabet, puan durumu ve son maç.`
    : m.sections.preview
      ? "El Clásico maç önü analiz: Barcelona – Real Madrid için Opta tahmini, golcüler, eksikler, ikili rekabet ve La Liga istatistikleri kaynaklarıyla."
      : "El Clásico: Barcelona – Real Madrid ikili rekabet istatistikleri, son maç sonucu ve La Liga puan durumu kaynaklarıyla.";
  const h1 = "El Clásico: Barcelona – Real Madrid";
  const parts = [];
  const sources = new Map();
  const addSrc = (url, name) => { if (url) sources.set(url, name); };

  if (m.sections.hero) {
    let html = `<section class="evergreen-section clasico-hero" aria-labelledby="clasico-next"><h2 id="clasico-next">${m.next ? "Sıradaki El Clásico" : "Son El Clásico"}</h2>`;
    if (m.next) {
      const n = m.next; addSrc(n.sourceUrl, n.sourceName);
      html += `<dl class="clasico-facts"><div><dt>Maç</dt><dd>${esc(n.homeTeam)} – ${esc(n.awayTeam)}</dd></div><div><dt>Tarih ve saat (TSİ)</dt><dd><time datetime="${esc(n.kickoff)}">${esc(trDate(n.kickoff))}</time></dd></div><div><dt>Stadyum</dt><dd>${esc(n.venue)}</dd></div><div><dt>Organizasyon</dt><dd>${esc(n.competition)}${n.round ? ` · ${esc(n.round)}. hafta` : ""}</dd></div>${n.referee ? `<div><dt>Hakem</dt><dd>${esc(n.referee)}</dd></div>` : ""}</dl><p class="clasico-source">Kaynak: ${src(n.sourceUrl, n.sourceName)}</p>`;
      if (m.sections.broadcast) {
        addSrc(n.broadcast.sourceUrl, n.broadcast.sourceName);
        html += `<h3 id="yayin">Barcelona – Real Madrid maçı hangi kanalda?</h3><p>El Clásico Türkiye'de <strong>${esc(n.broadcast.channels.join(" ve "))}</strong> üzerinden canlı yayınlanacak.</p><p class="clasico-source">Kaynak: ${src(n.broadcast.sourceUrl, n.broadcast.sourceName)}</p>`;
      }
    }
    if (m.last) {
      const l = m.last; addSrc(l.sourceUrl, l.sourceName);
      html += `<h3>Son El Clásico sonucu</h3><p><strong>${esc(l.homeTeam)} ${esc(l.score.home)}–${esc(l.score.away)} ${esc(l.awayTeam)}</strong> · ${esc(trDate(l.kickoff, false))} · ${esc(l.competition)}${l.venue ? ` · ${esc(l.venue)}` : ""}${l.note ? `. ${esc(l.note)}` : ""}</p><p class="clasico-source">Kaynak: ${src(l.sourceUrl, l.sourceName)}${l.secondarySourceUrl ? `, ${src(l.secondarySourceUrl, "ikincil kaynak")}` : ""}</p>`;
    }
    parts.push(html + "</section>");
  }

  if (m.sections.preview) {
    const p = m.preview;
    const colLink = p.columnPublished ? ` · <a href="./kose-yazilari/${esc(p.column.slug)}">Köşe yazısının tamamı</a>` : "";
    const stats = p.stats.length ? `<div class="clasico-stats">${p.stats.map((s) => { addSrc(s.src.sourceUrl, s.src.sourceName); return `<article class="glass-card clasico-stat"><span class="card-kicker">${esc(s.label)}</span><strong>${esc(s.value)}</strong>${s.detail ? `<p>${esc(s.detail)}</p>` : ""}<p class="clasico-source">Kaynak: ${src(s.src.sourceUrl, s.src.sourceName.split(" — ")[0])}</p></article>`; }).join("")}</div>` : "";
    const secs = p.sections.map((x) => { x.srcs.forEach((y) => addSrc(y.sourceUrl, y.sourceName)); return `<h3 id="analiz-${esc(x.id)}">${esc(x.h3)}</h3>${x.paragraphs.map((t) => `<p>${esc(t)}</p>`).join("")}<p class="clasico-source">Kaynak: ${x.srcs.map((y) => src(y.sourceUrl, y.sourceName)).join("; ")}</p>`; }).join("");
    parts.push(`<section class="evergreen-section clasico-preview" aria-labelledby="mac-onu-analiz"><h2 id="mac-onu-analiz">Maç Önü Analiz</h2><p class="clasico-byline">Yazan: <strong>${esc(p.column.name)}</strong> (${esc(p.column.label)}) · <time datetime="${esc(p.column.date)}">${esc(trDate(p.column.date, false))}</time> · Maç öncesinde yazıldı; başlama ${esc(trDate(p.matchKickoff))} TSİ${colLink}</p>${stats}${secs}</section>`);
  }

  parts.push(`<section class="evergreen-section" aria-labelledby="clasico-teams"><h2 id="clasico-teams">Takımlar</h2><div class="clasico-teams"><article><h3>Barcelona</h3><p>Ev sahibi; iç saha maçlarını Spotify Camp Nou'da oynuyor.</p><p><a href="./la-liga-puan-durumu">Barcelona'nın La Liga puan durumu</a> · <a href="./lig/la-liga.html">La Liga fikstür ve sonuçlar</a></p></article><article><h3>Real Madrid</h3><p>Konuk takım; iç saha maçlarını Santiago Bernabéu'da oynuyor.</p><p><a href="./la-liga-puan-durumu">Real Madrid'in La Liga puan durumu</a> · <a href="./haberler.html">Real Madrid ve Barcelona haberleri</a></p></article></div></section>`);

  if (m.h2h) {
    const h = m.h2h; addSrc(h.sourceUrl, h.sourceName); addSrc(h.secondarySourceUrl, h.secondarySourceName);
    const row = (label, x) => x ? `<tr><th scope="row">${esc(label)}</th><td>${x.played}</td><td>${x.barcelonaWins}</td><td>${x.draws}</td><td>${x.realMadridWins}</td><td>${x.barcelonaGoals}–${x.realMadridGoals}</td></tr>` : "";
    parts.push(`<section class="evergreen-section" aria-labelledby="clasico-tarihce"><h2 id="clasico-tarihce">El Clásico tarihçesi</h2><p>El Clásico, İspanya'nın en başarılı iki kulübü Barcelona ile Real Madrid arasındaki rekabettir. İlk resmî karşılaşma ${esc(trDate(h.firstMeeting?.date, false) || "1902")} tarihinde ${esc(h.firstMeeting?.competition || "")} kapsamında oynandı (${esc(h.firstMeeting?.score || "")}). Rekabetin en farklı skorları: ${esc(h.largestWins?.realMadrid || "")} ve ${esc(h.largestWins?.barcelona || "")}.</p><h3>Barcelona – Real Madrid ikili rekabet (${esc(trDate(h.asOf, false))} itibarıyla)</h3><div class="evergreen-table-wrap"><table class="evergreen-table"><caption>${esc(h.scope)}</caption><thead><tr><th scope="col">Kapsam</th><th scope="col">O</th><th scope="col">BAR G</th><th scope="col">B</th><th scope="col">RMA G</th><th scope="col">Gol (BAR–RMA)</th></tr></thead><tbody>${row("Tüm resmî maçlar", h.total)}${row("La Liga", h.laLiga)}</tbody></table></div><p class="clasico-source">Kaynak: ${src(h.sourceUrl, h.sourceName)}${h.secondarySourceUrl ? `; ${src(h.secondarySourceUrl, h.secondarySourceName)}` : ""}</p></section>`);
  }

  if (m.sections.standings) {
    const asOf = (m.standingsUpdatedAt || "").slice(0, 10);
    const formHtml = (f) => (f || []).map((x) => `<i class="is-${esc(x)}">${esc({ W: "G", D: "B", L: "M" }[x] || x)}</i>`).join("");
    const rows = m.rows.map((r) => `<tr><th scope="row">${esc(r.team)}</th><td>${r.rank}</td><td>${r.played}</td><td>${r.won}</td><td>${r.drawn}</td><td>${r.lost}</td><td>${r.goalsFor}–${r.goalsAgainst}</td><td><strong>${r.points}</strong></td><td><span class="evergreen-form" aria-label="Son 5 maç">${formHtml(r.form)}</span></td></tr>`).join("");
    addSrc("https://www.api-football.com/", "API-Football");
    parts.push(`<section class="evergreen-section" aria-labelledby="clasico-istatistik"><h2 id="clasico-istatistik">İstatistikler: La Liga'da Barcelona ve Real Madrid</h2><div class="evergreen-table-wrap"><table class="evergreen-table"><caption>La Liga ${esc(asOf)} itibarıyla</caption><thead><tr><th scope="col">Takım</th><th scope="col">Sıra</th><th scope="col">O</th><th scope="col">G</th><th scope="col">B</th><th scope="col">M</th><th scope="col">Gol</th><th scope="col">P</th><th scope="col">Form</th></tr></thead><tbody>${rows}</tbody></table></div><p class="clasico-source">Kaynak: API-Football puan tablosu (<time datetime="${esc(asOf)}">${esc(asOf)}</time>). Tam tablo: <a href="./la-liga-puan-durumu">La Liga puan durumu</a>.</p></section>`);

    const [b, r] = m.rows;
    const gap = b.points - r.points;
    parts.push(`<section class="evergreen-section" aria-labelledby="clasico-analiz"><h2 id="clasico-analiz">Maç analizi: El Clásico öncesi rakamlar</h2><ul><li>Barcelona ${b.played} maçta ${b.won} galibiyet, ${b.drawn} beraberlik, ${b.lost} mağlubiyetle ${b.points} puan topladı; ${b.goalsFor} gol attı, ${b.goalsAgainst} gol yedi.</li><li>Real Madrid ${r.played} maçta ${r.won} galibiyet, ${r.drawn} beraberlik, ${r.lost} mağlubiyetle ${r.points} puanda; ${r.goalsFor} gol attı, ${r.goalsAgainst} gol yedi.</li><li>İki takım arasındaki puan farkı: ${Math.abs(gap)} (${gap >= 0 ? "Barcelona" : "Real Madrid"} önde).</li>${m.h2h ? `<li>Tüm zamanlarda galibiyet sayıları ${m.h2h.total.barcelonaWins}–${m.h2h.total.realMadridWins} eşit; La Liga'da Real Madrid ${m.h2h.laLiga.realMadridWins}, Barcelona ${m.h2h.laLiga.barcelonaWins} galibiyete sahip.</li>` : ""}</ul><p>Bu bölüm yalnızca yukarıdaki kaynaklı verilerden derlenir; yorum veya tahmin içermez.</p>${m.columns.length ? `<h3>El Clásico köşe yazıları</h3><ul>${m.columns.map((c) => `<li><a href="./kose-yazilari/${esc(c.slug)}">${esc(c.title)}</a></li>`).join("")}</ul>` : ""}</section>`);
  }

  const faq = faqItems(m);
  if (faq.length) parts.push(`<section class="evergreen-section" aria-labelledby="clasico-sss"><h2 id="clasico-sss">El Clásico hakkında sık sorulan sorular</h2>${faq.map(([q, a]) => `<details class="clasico-faq"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}</section>`);
  parts.push(`<aside class="evergreen-related" aria-labelledby="clasico-related"><h2 id="clasico-related">El Clásico'dan devam edin</h2><div class="evergreen-link-grid"><a href="./la-liga-puan-durumu">La Liga puan durumu</a><a href="./lig/la-liga.html">La Liga fikstür ve sonuçlar</a><a href="./bugunun-maclari-hangi-kanalda">Bugünün maçları hangi kanalda</a><a href="./derbi-radari.html">Derbi radarı</a></div></aside>`);

  const graph = [
    { "@type": "WebPage", "@id": `${canonical}#page`, url: canonical, name: title, description, inLanguage: "tr-TR" },
    { "@type": "SportsTeam", "@id": `${canonical}#barcelona`, name: "FC Barcelona", sport: "Soccer", url: "https://www.fcbarcelona.com/" },
    { "@type": "SportsTeam", "@id": `${canonical}#real-madrid`, name: "Real Madrid CF", sport: "Soccer", url: "https://www.realmadrid.com/" },
    { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Ana Sayfa", item: `${siteUrl}/` }, { "@type": "ListItem", position: 2, name: "La Liga", item: `${siteUrl}/la-liga-puan-durumu` }, { "@type": "ListItem", position: 3, name: "El Clásico", item: canonical }] }
  ];
  if (m.next) graph.push({ "@type": "SportsEvent", "@id": `${canonical}#next`, name: `El Clásico: ${m.next.homeTeam} – ${m.next.awayTeam}`, startDate: m.next.kickoff, eventStatus: "https://schema.org/EventScheduled", eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode", sport: "Soccer", location: { "@type": "Place", name: m.next.venue, address: { "@type": "PostalAddress", addressLocality: m.next.venueCity || "Barcelona", addressCountry: "ES" } }, homeTeam: { "@id": `${canonical}#barcelona` }, awayTeam: { "@id": `${canonical}#real-madrid` }, competitor: [{ "@id": `${canonical}#barcelona` }, { "@id": `${canonical}#real-madrid` }] });
  if (m.sections.preview) graph.push({ "@type": "Article", "@id": `${canonical}#mac-onu-analiz`, headline: "El Clásico Maç Önü Analiz: Barcelona – Real Madrid", datePublished: m.preview.column.date, inLanguage: "tr-TR", author: { "@type": "Organization", name: `FutbolRadar ${m.preview.column.name}` }, publisher: { "@type": "Organization", name: "FutbolRadar", url: `${siteUrl}/` }, mainEntityOfPage: { "@id": `${canonical}#page` }, about: [{ "@id": `${canonical}#barcelona` }, { "@id": `${canonical}#real-madrid` }], citation: [...new Set(m.preview.stats.map((s) => s.src.sourceUrl).concat(m.preview.sections.flatMap((x) => x.srcs.map((y) => y.sourceUrl))))] });
  if (faq.length) graph.push({ "@type": "FAQPage", "@id": `${canonical}#faq`, mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) });

  const intro = "El Clásico, Barcelona ile Real Madrid arasındaki dünyanın en çok izlenen futbol rekabeti. Bu sayfada sıradaki El Clásico'nun tarihi, saati ve yayın kanalı, son maç sonucu, maç önü analiz, ikili rekabet istatistikleri ve La Liga puan durumu kaynaklarıyla yer alır.";
  const css = `<style>.clasico-facts{display:grid;grid-template-columns:1fr;gap:8px;margin:0}.clasico-facts div{display:flex;flex-wrap:wrap;gap:4px 8px}.clasico-facts dt{font-weight:600}.clasico-facts dd{margin:0}.clasico-source{font-size:.85rem;opacity:.85;overflow-wrap:anywhere}.clasico-source a,.evergreen-related a,.clasico-teams a,[data-page="el-clasico"] .evergreen-breadcrumb a,.clasico-hero a,#clasico-analiz~ul a{display:inline-block;min-height:24px;line-height:24px}.clasico-teams{display:grid;grid-template-columns:1fr;gap:12px}.clasico-faq summary{min-height:24px;padding:6px 0;cursor:pointer}.evergreen-table-wrap{max-width:100%;overflow-x:auto}.clasico-byline{font-size:.9rem;opacity:.85}.clasico-preview .clasico-byline a{display:inline-block;min-height:24px;line-height:24px}.clasico-stats{display:grid;grid-template-columns:1fr;gap:10px;margin:12px 0 16px}.clasico-stat{padding:12px 14px;min-width:0;min-height:0;height:auto;aspect-ratio:auto}.clasico-stat strong{display:block;font-size:1.5rem;line-height:1.2;margin:4px 0}.clasico-stat p{margin:4px 0}@media(min-width:480px){.clasico-stats{grid-template-columns:1fr 1fr}}@media(min-width:960px){.clasico-stats{grid-template-columns:repeat(3,1fr)}}@media(min-width:720px){.clasico-teams{grid-template-columns:1fr 1fr}.clasico-facts{grid-template-columns:1fr 1fr}}</style>`;
  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}" />
    <meta name="robots" content="${m.indexable ? ROBOTS_INDEX : ROBOTS_NOINDEX_FOLLOW}" />
    <link rel="canonical" href="${canonical}" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${siteUrl}/assets/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="manifest" href="./site.webmanifest" />
    <link rel="stylesheet" href="./page.css" />
    ${css}
    <script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replaceAll("<", "\\u003c")}</script>
  </head>
  <body>
    <div class="site-shell">
      ${siteHeader({ base: "./" })}
      <main class="evergreen-page" data-page="el-clasico">
        <div class="container">
          <nav class="evergreen-breadcrumb" aria-label="İçerik yolu"><a href="./">Ana Sayfa</a><span aria-hidden="true">/</span><a href="./la-liga-puan-durumu">La Liga</a><span aria-hidden="true">/</span><span aria-current="page">El Clásico</span></nav>
          <header class="evergreen-hero">
            <span class="section-kicker">La Liga · Barcelona – Real Madrid</span>
            <h1>${esc(h1)}</h1>
            <p>${esc(intro)}</p>
          </header>
          ${parts.join("\n          ")}
        </div>
      </main>
      ${siteFooter({ base: "./" })}
    </div>
    <script src="./site.js" defer></script>
  </body>
</html>\n`;
}

function updateSitemap(file, indexable, lastmod) {
  if (!fs.existsSync(file)) return;
  const xml = fs.readFileSync(file, "utf8");
  const entries = (xml.match(URL_ENTRY_RE) || []).filter((e) => !e.includes(`<loc>${canonical}</loc>`));
  // Sitemap yalnızca indekslenebilir URL taşır; noindex ise kayıt düşer.
  if (indexable) entries.push(`  <url>\n    <loc>${canonical}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.8</priority>\n  </url>`);
  fs.writeFileSync(file, wrapUrlset(entries), "utf8");
}

export function renderElClasico(opts) { const m = buildModel(opts); return { model: m, html: render(m) }; }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { model, html } = renderElClasico();
  for (const out of [root, path.join(root, "public")]) {
    fs.writeFileSync(path.join(out, `${EL_CLASICO_SLUG}.html`), html, "utf8");
    updateSitemap(path.join(out, "sitemap.xml"), model.indexable, (model.standingsUpdatedAt || new Date().toISOString()).slice(0, 10));
  }
  console.log(`[el-clasico] üretildi (${model.indexable ? "index" : "noindex"}); bölümler: ${Object.entries(model.sections).filter(([, v]) => v).map(([k]) => k).join(", ")}`);
}
