/**
 * KAYNAKLI OYUNCU KARŞILAŞTIRMA SAYFALARI.
 *
 * data/comparison-module/players/*.json okur. Sayı uydurmaz: null olan
 * alan arayüzde "Veri yok" olur. Çift adresleri alfabetik slug sırasıdır;
 * ters sıra vercel.json içinde 301 ile kanoniğe gider.
 *
 * Mevcut kıyas üreticisinin sildiği dosyalar `data-fr-module` ile korunur.
 */
import fs from "node:fs";
import path from "node:path";
import { siteHeader, siteFooter } from "./lib/layout.mjs";
import { URL_ENTRY_RE, wrapUrlset } from "./lib/sitemap.mjs";
import { createFreshnessTracker } from "./lib/sitemapFreshness.mjs";
import { robotsMeta } from "./lib/robots.mjs";

const root = process.cwd();
const domain = "https://www.futbolradar.com";
const dataDir = path.join(root, "data", "comparison-module", "players");
const MARKER = "stat-comparison";
const LINK_START = "<!-- stat-comparison-links:start -->";
const LINK_END = "<!-- stat-comparison-links:end -->";
const LINK_RE = /[\t ]*<!-- stat-comparison-links:start -->[\s\S]*?<!-- stat-comparison-links:end -->\n?/g;

const TEAM_PAGES = [
  ["takimlar/galatasaray.html", /galatasaray/i],
  ["takimlar/fenerbahce.html", /fenerbah/i],
  ["takimlar/besiktas.html", /beşiktaş|besiktas/i],
  ["takimlar/trabzonspor.html", /trabzonspor/i],
  ["takimlar/basaksehir.html", /ba[sş]ak[sş]ehir/i]
];

function readPlayers() {
  if (!fs.existsSync(dataDir)) return [];
  return fs.readdirSync(dataDir).filter((name) => name.endsWith(".json")).sort().map((name) => (
    JSON.parse(fs.readFileSync(path.join(dataDir, name), "utf8"))
  ));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function show(value, suffix = "") {
  if (value == null || value === "") return `<span class="cmp-missing">Veri yok</span>`;
  return escapeHtml(`${value}${suffix}`);
}

function footLabel(value) {
  const key = String(value || "").toLowerCase();
  if (key === "right") return "Sağ";
  if (key === "left") return "Sol";
  if (key === "both") return "İki ayak";
  return value ? String(value) : null;
}

function positionLabel(value) {
  const map = {
    Goalkeeper: "Kaleci",
    "Centre-Back": "Stoper",
    "Left-Back": "Sol bek",
    "Right-Back": "Sağ bek",
    "Defensive Midfield": "Ön libero",
    "Central Midfield": "Merkez orta saha",
    "Attacking Midfield": "Ofansif orta saha",
    "Left Winger": "Sol kanat",
    "Right Winger": "Sağ kanat",
    "Centre-Forward": "Santrfor",
    "Second Striker": "İkinci forvet"
  };
  return map[value] || value || null;
}

function groupOf(player) {
  const raw = `${player.identity?.positionGroup || ""} ${player.identity?.position || ""}`.toUpperCase();
  if (raw.includes("GOAL")) return "kaleci";
  if (raw.includes("DEF") || raw.includes("BACK")) return "defans";
  if (raw.includes("MID")) return "orta-saha";
  if (raw.includes("ATTACK") || raw.includes("WING") || raw.includes("FORWARD") || raw.includes("STRIKER")) return "forvet";
  return "diger";
}

function per90(total, minutes) {
  if (total == null || !minutes) return null;
  return Math.round((Number(total) / Number(minutes)) * 90 * 100) / 100;
}

function pairSlug(left, right) {
  return [left.slug, right.slug].sort().join("-vs-");
}

function selectPairs(players) {
  const groups = new Map();
  for (const player of players) {
    const key = groupOf(player);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(player);
  }
  const chosen = [];
  const seen = new Set();
  for (const [key, list] of groups) {
    if (key === "diger" || list.length < 2) continue;
    const candidates = [];
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i];
        const b = list[j];
        let score = 0;
        if (a.identity.league && a.identity.league === b.identity.league) score += 3;
        const clubs = [a.identity.club, b.identity.club].filter(Boolean);
        if (clubs.length === 2 && clubs[0] !== clubs[1]) score += 1;
        candidates.push({ a, b, score });
      }
    }
    candidates.sort((a, b) => b.score - a.score || pairSlug(a.a, a.b).localeCompare(pairSlug(b.a, b.b)));
    const load = new Map();
    for (const candidate of candidates) {
      const leftLoad = load.get(candidate.a.slug) || 0;
      const rightLoad = load.get(candidate.b.slug) || 0;
      if (leftLoad >= 6 || rightLoad >= 6) continue;
      const slug = pairSlug(candidate.a, candidate.b);
      if (seen.has(slug)) continue;
      seen.add(slug);
      load.set(candidate.a.slug, leftLoad + 1);
      load.set(candidate.b.slug, rightLoad + 1);
      const ordered = [candidate.a, candidate.b].sort((x, y) => x.slug.localeCompare(y.slug));
      chosen.push({ slug, left: ordered[0], right: ordered[1], group: key });
    }
  }
  return chosen;
}

function dateLabel(iso) {
  const months = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
  const match = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return iso || null;
  return `${Number(match[3])} ${months[Number(match[2]) - 1]} ${match[1]}`;
}

function cmpNumber(label, left, right, unit = "") {
  if (left == null && right == null) return "";
  if (left == null || right == null) {
    const known = left == null ? right : left;
    const name = left == null ? "sağdaki oyuncu" : "soldaki oyuncu";
    return `${label} yalnızca ${name} için var: ${known}${unit}.`;
  }
  if (Number(left) === Number(right)) return `${label} eşit: ${left}${unit}.`;
  const leader = Number(left) > Number(right) ? "soldaki oyuncu" : "sağdaki oyuncu";
  return `${label}: ${left}${unit} ve ${right}${unit}; daha yüksek olan ${leader}.`;
}

function analysis(left, right) {
  const lines = [
    cmpNumber("Kariyer gol", left.career?.goals, right.career?.goals),
    cmpNumber("Kariyer asist", left.career?.assists, right.career?.assists),
    cmpNumber("Kariyer dakika", left.career?.minutes, right.career?.minutes),
    cmpNumber("Kariyer maç", left.career?.appearances, right.career?.appearances),
    cmpNumber("Sarı kart", left.career?.yellowCards, right.career?.yellowCards),
    cmpNumber("Kırmızı kart", left.career?.redCards, right.career?.redCards),
    cmpNumber("Pas isabeti", left.technical?.passAccuracy, right.technical?.passAccuracy, "%"),
    cmpNumber("Gol/90", per90(left.career?.goals, left.career?.minutes), per90(right.career?.goals, right.career?.minutes)),
    cmpNumber("Asist/90", per90(left.career?.assists, left.career?.minutes), per90(right.career?.assists, right.career?.minutes))
  ].filter(Boolean);
  if (!lines.length) return ["Karşılaştırmalık sayı yok. Eksik alanlar Veri yok olarak bırakıldı."];
  return lines;
}

function radarMetrics(left, right) {
  const rows = [
    ["Gol/90", per90(left.career?.goals, left.career?.minutes), per90(right.career?.goals, right.career?.minutes)],
    ["Asist/90", per90(left.career?.assists, left.career?.minutes), per90(right.career?.assists, right.career?.minutes)],
    ["Pas %", left.technical?.passAccuracy, right.technical?.passAccuracy],
    ["Müdahale/90", per90(left.technical?.tackles, left.career?.minutes), per90(right.technical?.tackles, right.career?.minutes)],
    ["Kurtarış/90", per90(left.technical?.saves, left.career?.minutes), per90(right.technical?.saves, right.career?.minutes)]
  ];
  return rows.filter((row) => row[1] != null && row[2] != null);
}

function radarSvg(metrics) {
  if (metrics.length < 3) {
    return `<p class="cmp-missing">Radar için iki oyuncuda da dolu olan en az üç metrik yok. Veri yok.</p>`;
  }
  const cx = 140;
  const cy = 132;
  const radius = 86;
  const point = (index, scale) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / metrics.length;
    return [cx + Math.cos(angle) * radius * scale, cy + Math.sin(angle) * radius * scale];
  };
  const polygon = (index) => metrics.map((row, i) => {
    const max = Math.max(Number(row[1]), Number(row[2]), 0.0001);
    const scale = Number(row[index]) / max;
    return point(i, scale).map((n) => n.toFixed(1)).join(",");
  }).join(" ");
  const rings = [0.35, 0.7, 1].map((scale) => {
    const points = metrics.map((_, i) => point(i, scale).map((n) => n.toFixed(1)).join(",")).join(" ");
    return `<polygon points="${points}" fill="none" stroke="currentColor" stroke-opacity="0.18"/>`;
  }).join("");
  const labels = metrics.map((row, i) => {
    const [x, y] = point(i, 1.18);
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle">${escapeHtml(row[0])}</text>`;
  }).join("");
  return `<svg class="cmp-radar" viewBox="0 0 280 270" role="img" aria-label="Normalize edilmiş radar">
    ${rings}
    <polygon points="${polygon(1)}" fill="#0f8a5f" fill-opacity="0.35" stroke="#0f8a5f"/>
    <polygon points="${polygon(2)}" fill="#1287a8" fill-opacity="0.28" stroke="#1287a8"/>
    ${labels}
  </svg>
  <p class="cmp-note">Eksen, çiftin kendi içinde büyük olan değere göre 1'e çekilir. Eksik metrik eksene girmez.</p>`;
}

function barRow(label, left, right) {
  const max = Math.max(Number(left) || 0, Number(right) || 0, 1);
  const width = (value) => (value == null ? 0 : Math.max(4, Math.round((Number(value) / max) * 100)));
  return `<div class="cmp-bar">
    <div class="cmp-bar-label"><span>${escapeHtml(label)}</span><span>${left == null ? "Veri yok" : escapeHtml(left)} · ${right == null ? "Veri yok" : escapeHtml(right)}</span></div>
    <div class="cmp-track"><span><i style="width:${width(left)}%"></i></span><span><i style="width:${width(right)}%"></i></span></div>
  </div>`;
}

function timeline(player) {
  const stints = [...(player.careerClubs?.stints || [])].sort((a, b) => String(b.from || "").localeCompare(String(a.from || "")));
  if (!stints.length) return `<p class="cmp-missing">Veri yok</p>`;
  return `<ol class="cmp-timeline">${stints.map((stint) => {
    const shirts = Array.isArray(stint.shirtNumbers) && stint.shirtNumbers.length ? stint.shirtNumbers.join(", ") : null;
    const when = [stint.seasonJoined, stint.seasonLeft].filter(Boolean).join(" – ") || [stint.from, stint.until || "devam"].filter(Boolean).join(" – ");
    const flags = [
      stint.isLoan === true ? "Kiralık" : stint.isLoan === false ? "Kiralık değil" : null,
      stint.level === "youth" ? "Altyapı" : null
    ].filter(Boolean).join(" · ");
    return `<li>
      <strong>${show(stint.club)}</strong>
      <div>${show(when)}</div>
      <div>Forma no: ${show(shirts)} · Lig/yarışma: ${show(stint.competition)}</div>
      <div>${flags ? escapeHtml(flags) : `<span class="cmp-missing">Kiralık / altyapı ayrımı: Veri yok</span>`}</div>
    </li>`;
  }).join("")}</ol>`;
}

function sources(blocks) {
  const rows = blocks.filter((block) => block && block.sourceUrl);
  if (!rows.length) return `<p class="cmp-missing">Veri yok</p>`;
  return `<ul class="cmp-sources">${rows.map((block) => `<li><a href="${escapeHtml(block.sourceUrl)}" rel="nofollow noopener">${escapeHtml(block.label)}</a> · ${escapeHtml(dateLabel(block.retrievedAt) || "Veri yok")}</li>`).join("")}</ul>`;
}

function playerSources(player) {
  return sources([
    { label: "Kimlik (Transfermarkt oyuncu kaydı)", sourceUrl: player.identity?.sourceUrl, retrievedAt: player.identity?.retrievedAt },
    { label: "Uyruk / altyapı (Transfermarkt transfer sayfası)", sourceUrl: player.identity?.nationalitySourceUrl || player.careerClubs?.youthSourceUrl, retrievedAt: player.retrievedAt },
    { label: "Maç dökümü ve türetilmiş toplamlar", sourceUrl: player.career?.sourceUrl, retrievedAt: player.career?.retrievedAt },
    { label: "Kulüp geçmişi", sourceUrl: player.careerClubs?.sourceUrl, retrievedAt: player.careerClubs?.retrievedAt }
  ]);
}

function identityCard(player, base) {
  const id = player.identity || {};
  const fields = [
    ["Kulüp", id.club],
    ["Lig", id.league],
    ["Mevki", positionLabel(id.position)],
    ["Tercih edilen ayak", footLabel(id.preferredFoot)],
    ["Boy", id.heightCm == null ? null : `${id.heightCm} cm`],
    ["Kilo", id.weightKg == null ? null : `${id.weightKg} kg`],
    ["Doğum", id.birthDate],
    ["Yaş", id.ageYears == null ? null : `${id.ageYears} (${dateLabel(player.retrievedAt)} itibarıyla)`],
    ["Uyruk", id.nationality],
    ["Forma no", id.shirtNumber]
  ];
  return `<article class="cmp-card">
    <h2>${escapeHtml(player.name)}</h2>
    <dl class="cmp-kvs">${fields.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${show(value)}</dd></div>`).join("")}</dl>
    <p><a href="${base}oyuncu-karsilastirma/${escapeHtml(player.slug)}">Oyuncu kartı</a></p>
  </article>`;
}

function head({ title, description, canonical, base, jsonLd }) {
  return `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="canonical" href="${escapeHtml(canonical)}" />
  ${robotsMeta(true)}
  <meta property="og:type" content="website" />
  <meta property="og:locale" content="tr_TR" />
  <meta property="og:site_name" content="FutbolRadar" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${escapeHtml(canonical)}" />
  <meta property="og:image" content="${domain}/assets/og-image.png" />
  <meta property="og:image:type" content="image/png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${domain}/assets/og-image.png" />
  <link rel="icon" href="${base}favicon.svg" type="image/svg+xml" />
  <link rel="manifest" href="${base}site.webmanifest" />
  <link rel="stylesheet" href="${base}page.css" />
  <link rel="stylesheet" href="${base}comparison-module.css" />
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head>`;
}

function shell(inner, base) {
  return `${siteHeader({ base })}
    <main class="container cmp-wrap">
      ${inner}
    </main>
    ${siteFooter({ base })}
    <script src="${base}site.js" defer></script>`;
}

function breadcrumb(items) {
  const html = items.map((item, index) => (
    index === items.length - 1
      ? `<span>${escapeHtml(item.name)}</span>`
      : `<a href="${escapeHtml(item.href)}">${escapeHtml(item.name)}</a><span>/</span>`
  )).join("");
  const ld = {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.abs
    }))
  };
  return { html: `<nav class="breadcrumb" aria-label="Sayfa yolu">${html}</nav>`, ld };
}

function writeBoth(relative, html) {
  for (const file of [path.join(root, relative), path.join(root, "public", relative)]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, html, "utf8");
  }
}

function personNode(player, url) {
  const node = { "@type": "Person", name: player.name, url };
  if (player.identity?.birthDate) node.birthDate = player.identity.birthDate;
  if (player.identity?.nationality) node.nationality = player.identity.nationality;
  if (player.identity?.heightCm) node.height = `${player.identity.heightCm} cm`;
  if (player.identity?.club) {
    node.memberOf = { "@type": "SportsTeam", name: player.identity.club, sport: "Soccer" };
  }
  return node;
}

function seasonTable(player) {
  const rows = player.seasons?.rows || [];
  if (!rows.length) return `<p class="cmp-missing">Veri yok</p>`;
  return `<div class="cmp-table-wrap"><table class="cmp-table"><thead><tr><th>Sezon</th><th>Yarışma</th><th>Maç</th><th>Gol</th><th>Asist</th><th>Dk</th><th>Sarı</th><th>Kırmızı</th></tr></thead><tbody>
    ${rows.map((row) => `<tr><td>${show(row.season)}</td><td>${show(row.competition)}</td><td>${show(row.appearances)}</td><td>${show(row.goals)}</td><td>${show(row.assists)}</td><td>${show(row.minutes)}</td><td>${show(row.yellowCards)}</td><td>${show(row.redCards)}</td></tr>`).join("")}
  </tbody></table></div>`;
}

function matchTable(player) {
  const rows = (player.matches?.rows || []).filter((row) => row.played);
  if (!rows.length) return `<p class="cmp-missing">Veri yok</p>`;
  return `<div class="cmp-table-wrap"><table class="cmp-table"><thead><tr><th>Tarih</th><th>Yarışma</th><th>Rakip</th><th>Dk</th><th>Gol</th><th>Asist</th><th>Sarı</th><th>Kırmızı</th><th>Skor</th></tr></thead><tbody>
    ${rows.map((row) => {
      const score = row.teamGoals == null || row.opponentGoals == null ? null : `${row.teamGoals}-${row.opponentGoals}`;
      return `<tr><td>${show(row.date)}</td><td>${show(row.competition)}</td><td>${show(row.opponent)}</td><td>${show(row.minutes)}</td><td>${show(row.goals)}</td><td>${show(row.assists)}</td><td>${show(row.yellow)}</td><td>${show(row.red)}</td><td>${show(score)}</td></tr>`;
    }).join("")}
  </tbody></table></div>`;
}

function last5(player) {
  const rows = player.last5?.rows || [];
  if (!rows.length) return `<p class="cmp-missing">Veri yok</p>`;
  return `<div class="cmp-form">${rows.map((row) => {
    const score = row.teamGoals == null || row.opponentGoals == null ? "Veri yok" : `${row.teamGoals}-${row.opponentGoals}`;
    return `<b title="${escapeHtml(row.opponent || "Veri yok")}">${escapeHtml(score)}<br>${escapeHtml(row.goals ?? "–")}</b>`;
  }).join("")}</div>`;
}

function playerPage(player, pairs) {
  const base = "../";
  const canonical = `${domain}/oyuncu-karsilastirma/${player.slug}`;
  const title = `${player.name} oyuncu kartı | FutbolRadar`;
  const goals = player.career?.goals;
  const description = goals == null
    ? `${player.name} kartı: kulüp, ayak, boy ve kariyer kulüpleri. İstatistik toplamı henüz yok. Kaynak Transfermarkt, ${player.retrievedAt}.`
    : `${player.name} kartı: ${player.identity?.club || "kulüp yok"}, ${goals} gol, ${player.career.assists ?? "asist yok"} asist. Kaynak Transfermarkt, ${player.retrievedAt}.`;
  const crumbs = breadcrumb([
    { name: "Ana Sayfa", href: `${base}index.html`, abs: `${domain}/` },
    { name: "Oyuncu karşılaştırma", href: `${base}oyuncu-karsilastirma`, abs: `${domain}/oyuncu-karsilastirma` },
    { name: player.name, href: `${base}oyuncu-karsilastirma/${player.slug}`, abs: canonical }
  ]);
  const related = pairs.filter((pair) => pair.left.slug === player.slug || pair.right.slug === player.slug).slice(0, 8);
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage", name: title, url: canonical, inLanguage: "tr-TR", description },
      crumbs.ld,
      personNode(player, canonical)
    ]
  };
  const career = player.career || {};
  return `${head({ title, description, canonical, base, jsonLd })}
<body class="subpage" data-fr-module="${MARKER}">
${shell(`
      ${crumbs.html}
      <section class="hero"><div class="hero-row"><div>
        <span class="eyebrow">Kaynaklı oyuncu kartı</span>
        <h1>${escapeHtml(player.name)}</h1>
        <p class="lead">${escapeHtml(description)}</p>
      </div></div></section>
      ${identityCard(player, base)}
      <section class="cmp-panel"><h2>Kariyer toplamı</h2>
        <dl class="cmp-kvs">
          <div><dt>Maç</dt><dd>${show(career.appearances)}</dd></div>
          <div><dt>Gol</dt><dd>${show(career.goals)}</dd></div>
          <div><dt>Asist</dt><dd>${show(career.assists)}</dd></div>
          <div><dt>Dakika</dt><dd>${show(career.minutes)}</dd></div>
          <div><dt>Sarı</dt><dd>${show(career.yellowCards)}</dd></div>
          <div><dt>Kırmızı</dt><dd>${show(career.redCards)}</dd></div>
          <div><dt>Gol/90</dt><dd>${show(per90(career.goals, career.minutes))}</dd></div>
          <div><dt>Asist/90</dt><dd>${show(per90(career.assists, career.minutes))}</dd></div>
        </dl>
        <p class="cmp-note">Toplamlar maç dökümünden hesaplanır. Ayrı bir resmi kariyer satırı yoksa ikinci bir sayı üretilmez.</p>
      </section>
      <section class="cmp-panel"><h2>Teknik</h2>
        <dl class="cmp-kvs">
          <div><dt>Pas isabeti</dt><dd>${show(player.technical?.passAccuracy, player.technical?.passAccuracy == null ? "" : "%")}</dd></div>
          <div><dt>Pas</dt><dd>${show(player.technical?.passes)}</dd></div>
          <div><dt>İsabetli pas</dt><dd>${show(player.technical?.passesReached)}</dd></div>
          <div><dt>Müdahale</dt><dd>${show(player.technical?.tackles)}</dd></div>
          <div><dt>Kurtarış</dt><dd>${show(player.technical?.saves)}</dd></div>
          <div><dt>Dribling</dt><dd>${show(player.technical?.dribbles)}</dd></div>
          <div><dt>Top kaybı</dt><dd>${show(player.technical?.dispossessed)}</dd></div>
          <div><dt>xG</dt><dd>${show(player.technical?.xg)}</dd></div>
          <div><dt>xA</dt><dd>${show(player.technical?.xa)}</dd></div>
        </dl>
      </section>
      <section class="cmp-panel"><h2>Son 5 maç</h2>${last5(player)}</section>
      <section class="cmp-panel"><h2>Sezon sezon</h2>${seasonTable(player)}</section>
      <section class="cmp-panel"><h2>Kulüp geçmişi</h2>${timeline(player)}</section>
      <section class="cmp-panel"><h2>Maç maç</h2>${matchTable(player)}</section>
      <section class="cmp-panel"><h2>Karşılaştırmalar</h2>
        <div class="cmp-results">${related.map((pair) => `<a class="cmp-pair-link" href="${base}karsilastirma/${escapeHtml(pair.slug)}"><strong>${escapeHtml(pair.left.name)} vs ${escapeHtml(pair.right.name)}</strong></a>`).join("") || `<p class="cmp-missing">Veri yok</p>`}</div>
      </section>
      <section class="cmp-panel"><h2>Kaynaklar</h2>${playerSources(player)}</section>
`, base)}
</body></html>
`;
}

function pairPage(pair, allPairs) {
  const { left, right, slug } = pair;
  const base = "../";
  const canonical = `${domain}/karsilastirma/${slug}`;
  const title = `${left.name} vs ${right.name} | FutbolRadar`;
  const lines = analysis(left, right);
  const description = `${left.name} ve ${right.name} kıyası. ${lines[0]} Kaynak Transfermarkt, ${left.retrievedAt}.`.slice(0, 160);
  const crumbs = breadcrumb([
    { name: "Ana Sayfa", href: `${base}index.html`, abs: `${domain}/` },
    { name: "Oyuncu karşılaştırma", href: `${base}oyuncu-karsilastirma`, abs: `${domain}/oyuncu-karsilastirma` },
    { name: `${left.name} vs ${right.name}`, href: `${base}karsilastirma/${slug}`, abs: canonical }
  ]);
  const metrics = radarMetrics(left, right);
  const more = allPairs.filter((item) => item.slug !== slug && [item.left.slug, item.right.slug].some((id) => id === left.slug || id === right.slug)).slice(0, 6);
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage", name: title, url: canonical, inLanguage: "tr-TR", description },
      crumbs.ld,
      { "@type": "ItemList", itemListElement: [left, right].map((player, index) => ({ "@type": "ListItem", position: index + 1, item: personNode(player, `${domain}/oyuncu-karsilastirma/${player.slug}`) })) }
    ]
  };
  return `${head({ title, description, canonical, base, jsonLd })}
<body class="subpage" data-fr-module="${MARKER}">
${shell(`
      ${crumbs.html}
      <section class="hero"><div class="hero-row"><div>
        <span class="eyebrow">Oyuncu karşılaştırma</span>
        <h1>${escapeHtml(left.name)} vs ${escapeHtml(right.name)}</h1>
        <p class="lead">${escapeHtml(description)}</p>
      </div></div></section>
      <section class="cmp-split">${identityCard(left, base)}${identityCard(right, base)}</section>
      <section class="cmp-panel"><h2>Radar</h2>${radarSvg(metrics)}</section>
      <section class="cmp-panel"><h2>Sütunlar</h2>
        ${barRow("Maç", left.career?.appearances, right.career?.appearances)}
        ${barRow("Gol", left.career?.goals, right.career?.goals)}
        ${barRow("Asist", left.career?.assists, right.career?.assists)}
        ${barRow("Dakika", left.career?.minutes, right.career?.minutes)}
        ${barRow("Sarı kart", left.career?.yellowCards, right.career?.yellowCards)}
        ${barRow("Kırmızı kart", left.career?.redCards, right.career?.redCards)}
        ${barRow("Pas isabeti %", left.technical?.passAccuracy, right.technical?.passAccuracy)}
        ${barRow("Müdahale", left.technical?.tackles, right.technical?.tackles)}
        ${barRow("Kurtarış", left.technical?.saves, right.technical?.saves)}
        ${barRow("xG", left.technical?.xg, right.technical?.xg)}
      </section>
      <section class="cmp-panel"><h2>Sayıdan çıkan kıyas</h2><ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>
        <p class="cmp-note">Cümleler yalnızca iki karttaki sayıların karşılaştırmasıdır.</p>
      </section>
      <section class="cmp-split">
        <section class="cmp-panel"><h2>${escapeHtml(left.name)} son 5</h2>${last5(left)}</section>
        <section class="cmp-panel"><h2>${escapeHtml(right.name)} son 5</h2>${last5(right)}</section>
      </section>
      <section class="cmp-split">
        <section class="cmp-panel"><h2>${escapeHtml(left.name)} kulüpler</h2>${timeline(left)}</section>
        <section class="cmp-panel"><h2>${escapeHtml(right.name)} kulüpler</h2>${timeline(right)}</section>
      </section>
      <section class="cmp-panel"><h2>Diğer kıyaslar</h2><div class="cmp-results">${more.map((item) => `<a class="cmp-pair-link" href="${base}karsilastirma/${escapeHtml(item.slug)}">${escapeHtml(item.left.name)} vs ${escapeHtml(item.right.name)}</a>`).join("")}</div></section>
      <section class="cmp-panel"><h2>Kaynaklar</h2>${playerSources(left)}${playerSources(right)}</section>
`, base)}
</body></html>
`;
}

function hubPage(players, pairs) {
  const base = "./";
  const canonical = `${domain}/oyuncu-karsilastirma`;
  const title = "Oyuncu karşılaştırma | FutbolRadar";
  const description = `Süper Lig ve Avrupa'dan ${players.length} oyuncuyu yan yana kıyasla. Radar, kariyer ve kulüp geçmişi. Kaynak Transfermarkt, ${players[0]?.retrievedAt || "2026-11-14"}.`;
  const crumbs = breadcrumb([
    { name: "Ana Sayfa", href: `${base}index.html`, abs: `${domain}/` },
    { name: "Oyuncu karşılaştırma", href: `${base}oyuncu-karsilastirma`, abs: canonical }
  ]);
  const catalog = players.map((player) => ({
    slug: player.slug,
    name: player.name,
    club: player.identity?.club || "",
    league: player.identity?.league || "",
    position: positionLabel(player.identity?.position) || ""
  }));
  const pairIndex = pairs.map((pair) => ({ slug: pair.slug, left: pair.left.slug, right: pair.right.slug, label: `${pair.left.name} vs ${pair.right.name}` }));
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "CollectionPage", name: title, url: canonical, description, inLanguage: "tr-TR" },
      crumbs.ld,
      {
        "@type": "ItemList",
        itemListElement: players.slice(0, 30).map((player, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: player.name,
          url: `${domain}/oyuncu-karsilastirma/${player.slug}`
        }))
      }
    ]
  };
  return `${head({ title, description, canonical, base, jsonLd })}
<body class="subpage" data-fr-module="${MARKER}">
${shell(`
      ${crumbs.html}
      <section class="hero"><div class="hero-row"><div>
        <span class="eyebrow">Oyuncu karşılaştırma</span>
        <h1>Oyuncu karşılaştırma</h1>
        <p class="lead">${escapeHtml(description)}</p>
      </div><span class="hero-meta">${players.length} oyuncu · ${pairs.length} kıyas</span></div></section>
      <section class="cmp-panel"><h2>Oyuncu seç</h2>
        <div class="cmp-picker">
          <input class="cmp-search" id="cmp-search" type="search" placeholder="Oyuncu veya kulüp ara" aria-label="Oyuncu ara" />
          <div class="cmp-results" id="cmp-results"></div>
          <p class="cmp-note" id="cmp-status">İki oyuncu seç. Hazır sayfa varsa açılır.</p>
        </div>
      </section>
      <section class="cmp-panel"><h2>Hazır kıyaslar</h2>
        <div class="cmp-grid cols-3">${pairs.map((pair) => `<a class="cmp-pair-link" href="./karsilastirma/${escapeHtml(pair.slug)}"><strong>${escapeHtml(pair.left.name)} vs ${escapeHtml(pair.right.name)}</strong><small>${escapeHtml(pair.left.identity?.club || "Veri yok")} · ${escapeHtml(pair.right.identity?.club || "Veri yok")}</small></a>`).join("")}</div>
      </section>
      <section class="cmp-panel"><h2>Oyuncular</h2>
        <div class="cmp-grid cols-3">${players.map((player) => `<a class="cmp-player-hit" href="./oyuncu-karsilastirma/${escapeHtml(player.slug)}"><strong>${escapeHtml(player.name)}</strong><small>${escapeHtml(player.identity?.club || "Veri yok")} · ${escapeHtml(player.identity?.league || "Veri yok")}</small></a>`).join("")}</div>
      </section>
      <section class="cmp-panel"><h2>Kaynak ve tarih</h2>
        <p>Kimlik, maç dökümü ve kulüp geçmişi Transfermarkt kayıtlarından ${escapeHtml(dateLabel(players[0]?.retrievedAt) || "Veri yok")} tarihinde alındı. Dolu olmayan kutu Veri yok'tur.</p>
      </section>
`, base)}
<script>
(function () {
  var players = ${JSON.stringify(catalog)};
  var pairs = ${JSON.stringify(pairIndex)};
  var selected = [];
  var input = document.getElementById("cmp-search");
  var results = document.getElementById("cmp-results");
  var status = document.getElementById("cmp-status");
  function pairFor(a, b) {
    return pairs.find(function (pair) {
      return (pair.left === a && pair.right === b) || (pair.left === b && pair.right === a);
    });
  }
  function render(query) {
    var q = (query || "").toLocaleLowerCase("tr");
    results.innerHTML = "";
    players.filter(function (player) {
      return !q || (player.name + " " + player.club + " " + player.league).toLocaleLowerCase("tr").indexOf(q) !== -1;
    }).slice(0, 12).forEach(function (player) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "cmp-player-hit";
      button.textContent = player.name + " · " + (player.club || "Veri yok");
      button.addEventListener("click", function () {
        if (selected.indexOf(player.slug) === -1) selected.push(player.slug);
        if (selected.length > 2) selected = selected.slice(-2);
        var found = selected.length === 2 ? pairFor(selected[0], selected[1]) : null;
        status.textContent = found ? "Kıyas açılıyor." : (selected.length === 2 ? "Bu çift için hazır sayfa yok." : "İkinci oyuncuyu seç.");
        if (found) window.location.href = "./karsilastirma/" + found.slug;
      });
      results.appendChild(button);
    });
  }
  input.addEventListener("input", function () { render(input.value); });
  render("");
})();
</script>
</body></html>
`;
}

function injectBlock(relative, block) {
  for (const file of [path.join(root, relative), path.join(root, "public", relative)]) {
    if (!fs.existsSync(file)) continue;
    const original = fs.readFileSync(file, "utf8").replace(LINK_RE, "");
    if (!/<\/main>/i.test(original)) continue;
    const next = original.replace(/<\/main>/i, `${block}\n</main>`);
    if (next !== fs.readFileSync(file, "utf8")) fs.writeFileSync(file, next, "utf8");
  }
}

function linkExistingProfiles(players, pairs) {
  let table = { entries: [] };
  const tablePath = path.join(root, "data", "player-url-slugs.json");
  if (fs.existsSync(tablePath)) table = JSON.parse(fs.readFileSync(tablePath, "utf8"));
  for (const player of players) {
    const entry = (table.entries || []).find((row) => row.slug === player.slug || row.fullName === player.name);
    const relative = `futbolcu/${entry?.slug || player.slug}.html`;
    if (!fs.existsSync(path.join(root, relative))) continue;
    const related = pairs.filter((pair) => pair.left.slug === player.slug || pair.right.slug === player.slug).slice(0, 4);
    const links = [`<li><a href="../oyuncu-karsilastirma/${player.slug}">Kaynaklı oyuncu kartı</a></li>`]
      .concat(related.map((pair) => `<li><a href="../karsilastirma/${pair.slug}">${escapeHtml(pair.left.name)} vs ${escapeHtml(pair.right.name)}</a></li>`));
    injectBlock(relative, `${LINK_START}\n<nav class="cmp-panel" aria-label="Karşılaştırma"><h2>Karşılaştırma</h2><ul>${links.join("")}</ul></nav>\n${LINK_END}\n`);
  }
}

function linkTeams(players) {
  for (const [relative, pattern] of TEAM_PAGES) {
    const squad = players.filter((player) => pattern.test(player.identity?.club || ""));
    if (!squad.length || !fs.existsSync(path.join(root, relative))) continue;
    const links = [`<li><a href="../oyuncu-karsilastirma">Oyuncu karşılaştırma</a></li>`]
      .concat(squad.map((player) => `<li><a href="../oyuncu-karsilastirma/${player.slug}">${escapeHtml(player.name)}</a></li>`));
    injectBlock(relative, `${LINK_START}\n<nav class="cmp-panel" aria-label="Oyuncu karşılaştırma"><h2>Oyuncu karşılaştırma</h2><ul>${links.join("")}</ul></nav>\n${LINK_END}\n`);
  }
  for (const relative of ["oyuncu-karsilastirmalari.html"]) {
    if (!fs.existsSync(path.join(root, relative))) continue;
    injectBlock(relative, `${LINK_START}\n<nav class="cmp-panel" aria-label="Kaynaklı kıyas"><h2>Kaynaklı kıyas</h2><p><a href="./oyuncu-karsilastirma">Transfermarkt kayıtlı oyuncu karşılaştırması</a></p></nav>\n${LINK_END}\n`);
  }
}

function upsertSitemap(pages) {
  const freshness = createFreshnessTracker(root);
  const locs = pages.map((page) => ({
    loc: `${domain}/${page.url}`,
    file: page.file
  }));
  fs.writeFileSync(path.join(root, "data", "comparison-module", "published-locs.json"), `${JSON.stringify(locs.map((row) => row.loc), null, 2)}\n`);
  for (const sitemapPath of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) {
    if (!fs.existsSync(sitemapPath)) continue;
    const current = fs.readFileSync(sitemapPath, "utf8");
    const owned = new Set(locs.flatMap((row) => [row.loc, `${row.loc}.html`]));
    const retained = (current.match(URL_ENTRY_RE) || []).filter((entry) => {
      const loc = (entry.match(/<loc>([^<]+)<\/loc>/) || [])[1];
      return !owned.has(loc);
    });
    const entries = locs.map((row) => {
      const lastmod = freshness.lastmodForFile(row.url, path.join(root, row.file));
      return `  <url>\n    <loc>${row.loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.7</priority>\n  </url>`;
    });
    fs.writeFileSync(sitemapPath, wrapUrlset(retained.concat(entries)), "utf8");
  }
  freshness.save();
}

function reverseMap(pairs) {
  const map = {};
  for (const pair of pairs) {
    const parts = pair.slug.split("-vs-");
    if (parts.length !== 2) continue;
    const reverse = `${parts[1]}-vs-${parts[0]}`;
    if (reverse !== pair.slug) map[reverse] = pair.slug;
  }
  return map;
}

function writeCanonicalMiddleware(pairs) {
  const map = reverseMap(pairs);
  const body = `/**
 * Ters kıyas adresini kanoniğe taşır.
 *
 * Çift başına vercel.json yönlendirmesi Vercel'in 1024 kural sınırını aşar
 * (scripts/inject-player-redirects.mjs). Eşleşme yoksa istek statik sayfaya düşer.
 */
const CANONICAL = ${JSON.stringify(map, null, 2)};

export const config = {
  matcher: ["/karsilastirma/:path*"]
};

export default function middleware(request) {
  const url = new URL(request.url);
  const slug = url.pathname.replace(/^\\/karsilastirma\\//, "").replace(/\\.html$/, "");
  const canonical = CANONICAL[slug];
  if (!canonical) return;
  url.pathname = \`/karsilastirma/\${canonical}\`;
  url.search = "";
  return Response.redirect(url, 301);
}
`;
  fs.writeFileSync(path.join(root, "middleware.js"), body, "utf8");
}

function updateVercel(pairs) {
  const file = path.join(root, "vercel.json");
  const previousPath = path.join(root, "data", "comparison-module", "redirect-sources.json");
  const previous = fs.existsSync(previousPath) ? JSON.parse(fs.readFileSync(previousPath, "utf8")) : [];
  let raw = fs.readFileSync(file, "utf8");
  for (const source of previous) {
    const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`\\n    \\{\\n      "source": "${escaped}",\\n      "destination": "[^"]+",\\n      "permanent": true\\n    \\},?`);
    raw = raw.replace(pattern, "");
  }
  raw = raw.replace(/,(\s*\],\s*\n\s*"rewrites")/, "$1");
  if (!raw.includes('"/oyuncu-karsilastirma"')) {
    raw = raw.replace(
      `    {\n      "source": "/oyuncu-karsilastirmalari",\n      "destination": "/oyuncu-karsilastirmalari.html"\n    },`,
      `    {\n      "source": "/oyuncu-karsilastirmalari",\n      "destination": "/oyuncu-karsilastirmalari.html"\n    },\n    {\n      "source": "/oyuncu-karsilastirma",\n      "destination": "/oyuncu-karsilastirma.html"\n    },\n    {\n      "source": "/oyuncu-karsilastirma/:slug",\n      "destination": "/oyuncu-karsilastirma/:slug.html"\n    },`
    );
  }
  const config = JSON.parse(raw);
  if (config.redirects.length > 1024) {
    throw new Error(`vercel redirects ${config.redirects.length} > 1024`);
  }
  fs.writeFileSync(file, raw.endsWith("\n") ? raw : `${raw}\n`, "utf8");
  fs.writeFileSync(previousPath, "[]\n");
  writeCanonicalMiddleware(pairs);
}

function missingReport(players) {
  const fields = [
    ["Kulüp", (player) => player.identity?.club],
    ["Lig", (player) => player.identity?.league],
    ["Mevki", (player) => player.identity?.position],
    ["Ayak", (player) => player.identity?.preferredFoot],
    ["Boy", (player) => player.identity?.heightCm],
    ["Kilo", (player) => player.identity?.weightKg],
    ["Doğum", (player) => player.identity?.birthDate],
    ["Uyruk", (player) => player.identity?.nationality],
    ["Maç", (player) => player.career?.appearances],
    ["Gol", (player) => player.career?.goals],
    ["Asist", (player) => player.career?.assists],
    ["Dakika", (player) => player.career?.minutes],
    ["Sarı", (player) => player.career?.yellowCards],
    ["Kırmızı", (player) => player.career?.redCards],
    ["Pas isabeti", (player) => player.technical?.passAccuracy],
    ["Dribling", (player) => player.technical?.dribbles],
    ["Top kaybı", (player) => player.technical?.dispossessed],
    ["xG", (player) => player.technical?.xg],
    ["xA", (player) => player.technical?.xa],
    ["Son 5", (player) => (player.last5?.rows || []).length || null],
    ["Kulüp geçmişi", (player) => (player.careerClubs?.stints || []).length || null]
  ];
  return players.map((player) => ({
    slug: player.slug,
    name: player.name,
    club: player.identity?.club || null,
    league: player.identity?.league || null,
    missing: fields.filter(([, read]) => read(player) == null).map(([label]) => label)
  }));
}

const players = readPlayers();
if (players.length < 30) {
  console.error(`stat-comparison: ${players.length} oyuncu var, en az 30 gerekli. Önce collect-comparison-module.mjs çalıştırın.`);
  process.exit(1);
}
const pairs = selectPairs(players);
const protectedSlugs = new Set(pairs.map((pair) => `${pair.slug}.html`));
for (const directory of [path.join(root, "karsilastirma"), path.join(root, "public", "karsilastirma")]) {
  if (!fs.existsSync(directory)) continue;
  for (const file of fs.readdirSync(directory)) {
    if (!file.endsWith(".html") || protectedSlugs.has(file)) continue;
    const full = path.join(directory, file);
    if (fs.readFileSync(full, "utf8").includes(`data-fr-module="${MARKER}"`)) fs.unlinkSync(full);
  }
}
for (const player of players) writeBoth(`oyuncu-karsilastirma/${player.slug}.html`, playerPage(player, pairs));
for (const pair of pairs) writeBoth(`karsilastirma/${pair.slug}.html`, pairPage(pair, pairs));
writeBoth("oyuncu-karsilastirma.html", hubPage(players, pairs));
linkTeams(players);
linkExistingProfiles(players, pairs);
const pages = [
  { url: "oyuncu-karsilastirma", file: "oyuncu-karsilastirma.html" },
  ...players.map((player) => ({ url: `oyuncu-karsilastirma/${player.slug}`, file: `oyuncu-karsilastirma/${player.slug}.html` })),
  ...pairs.map((pair) => ({ url: `karsilastirma/${pair.slug}`, file: `karsilastirma/${pair.slug}.html` }))
];
upsertSitemap(pages);
updateVercel(pairs);
fs.writeFileSync(path.join(root, "data", "comparison-module", "missing.json"), `${JSON.stringify(missingReport(players), null, 2)}\n`);
const css = fs.readFileSync(path.join(root, "comparison-module.css"));
if (fs.existsSync(path.join(root, "public"))) fs.writeFileSync(path.join(root, "public", "comparison-module.css"), css);
console.log(`stat-comparison: ${players.length} oyuncu, ${pairs.length} kıyas sayfası`);
