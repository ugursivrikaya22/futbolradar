const ENTITY_RULES = [
  { type: "match", matches: (pathname) => pathname.startsWith("/mac/") || pathname.startsWith("/mac-raporu/") },
  { type: "player", matches: (pathname) => pathname.startsWith("/oyuncular/") || pathname.startsWith("/players/") },
  { type: "editorial", matches: (pathname) => pathname.startsWith("/haber/") || pathname.startsWith("/kose-yazilari/") || pathname.startsWith("/yazarlar/") }
];

function stripHtml(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function evaluateEntitySeoPage({ html, canonicalUrl }) {
  const bodyText = stripHtml(html);
  const issueCodes = [];
  const canonical = (String(html).match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i) || [])[1] || "";
  const robots = (String(html).match(/<meta\s+name=["']robots["']\s+content=["']([^"']+)["']/i) || [])[1] || "";
  const h1Count = (String(html).match(/<h1\b[^>]*>/gi) || []).length;
  const jsonLdCount = (String(html).match(/<script\s+type=["']application\/ld\+json["']/gi) || []).length;
  const internalLinks = (String(html).match(/href=["'](?:\.\.\/|\.\/|\/)/gi) || []).length;

  if (canonical !== canonicalUrl) issueCodes.push("canonical-mismatch");
  if (!/index,follow/i.test(robots)) issueCodes.push("not-indexable");
  if (h1Count !== 1) issueCodes.push("h1-count");
  if (!jsonLdCount) issueCodes.push("missing-structured-data");
  if (bodyText.length < 350) issueCodes.push("thin-content");
  if (internalLinks < 3) issueCodes.push("weak-internal-linking");

  return {
    indexable: issueCodes.length === 0,
    issueCodes,
    metrics: {
      bodyTextLength: bodyText.length,
      h1Count,
      jsonLdCount,
      internalLinks
    }
  };
}

function entityTypeForPath(pathname) {
  return ENTITY_RULES.find((rule) => rule.matches(pathname))?.type || null;
}

module.exports = {
  entityTypeForPath,
  evaluateEntitySeoPage
};
