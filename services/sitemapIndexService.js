const SITEMAP_NAMESPACES = {
  urlset: "http://www.sitemaps.org/schemas/sitemap/0.9",
  index: "http://www.sitemaps.org/schemas/sitemap/0.9"
};

const SITEMAP_GROUPS = [
  {
    id: "matches",
    fileName: "sitemap-matches.xml",
    label: "Mac sayfalari",
    matches: (pathname) => pathname.startsWith("/mac/") || pathname.startsWith("/mac-raporu/")
  },
  {
    id: "players",
    fileName: "sitemap-players.xml",
    label: "Oyuncu sayfalari",
    matches: (pathname) => (
      pathname.startsWith("/oyuncular/") ||
      pathname.startsWith("/players/") ||
      pathname.startsWith("/karsilastirma/") ||
      pathname.includes("oyuncu-karsilastir") ||
      pathname.includes("oyuncu-radari")
    )
  },
  {
    id: "editorial",
    fileName: "sitemap-editorial.xml",
    label: "Haber ve editoryal sayfalar",
    matches: (pathname) => (
      pathname.startsWith("/haber/") ||
      pathname.startsWith("/kose-yazilari/") ||
      pathname.startsWith("/yazarlar/") ||
      pathname.startsWith("/analizler/") ||
      pathname.startsWith("/rehber/")
    )
  },
  {
    id: "core",
    fileName: "sitemap-core.xml",
    label: "Cekirdek, lig ve kesif sayfalari",
    matches: () => true
  }
];

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function parseSitemapEntries(xml) {
  return Array.from(String(xml || "").matchAll(/<url>\s*([\s\S]*?)\s*<\/url>/g))
    .map((match) => {
      const body = match[1];
      const location = (body.match(/<loc>([^<]+)<\/loc>/) || [])[1];
      const lastmod = (body.match(/<lastmod>([^<]+)<\/lastmod>/) || [])[1] || null;
      if (!location) {
        return null;
      }

      try {
        return {
          location,
          lastmod,
          pathname: new URL(location).pathname,
          xml: match[0]
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function groupSitemapEntries(entries) {
  const grouped = Object.fromEntries(SITEMAP_GROUPS.map((group) => [group.id, []]));
  const seen = new Set();

  for (const entry of entries) {
    if (seen.has(entry.location)) {
      continue;
    }
    seen.add(entry.location);
    const group = SITEMAP_GROUPS.find((candidate) => candidate.matches(entry.pathname));
    grouped[group.id].push(entry);
  }

  return grouped;
}

function sitemapUrlset(entries) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<urlset xmlns="${SITEMAP_NAMESPACES.urlset}">`,
    ...entries.map((entry) => entry.xml),
    "</urlset>",
    ""
  ].join("\n");
}

function latestLastmod(entries) {
  return entries
    .map((entry) => entry.lastmod)
    .filter(Boolean)
    .sort()
    .at(-1) || null;
}

function sitemapIndexXml({ domain, groupedEntries }) {
  const entries = SITEMAP_GROUPS
    .filter((group) => groupedEntries[group.id].length > 0)
    .map((group) => {
      const lastmod = latestLastmod(groupedEntries[group.id]);
      return [
        "  <sitemap>",
        `    <loc>${escapeXml(`${domain}/${group.fileName}`)}</loc>`,
        lastmod ? `    <lastmod>${escapeXml(lastmod)}</lastmod>` : null,
        "  </sitemap>"
      ].filter(Boolean).join("\n");
    });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<sitemapindex xmlns="${SITEMAP_NAMESPACES.index}">`,
    ...entries,
    "</sitemapindex>",
    ""
  ].join("\n");
}

module.exports = {
  SITEMAP_GROUPS,
  parseSitemapEntries,
  groupSitemapEntries,
  sitemapUrlset,
  sitemapIndexXml
};
