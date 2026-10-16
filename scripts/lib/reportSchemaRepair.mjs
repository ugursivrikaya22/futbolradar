/**
 * MAÇ RAPORU ŞEMASI — ESKİ SAYFALARIN ONARIMI.
 *
 * `generate-post-match-pages.mjs` yalnızca son pencerenin raporlarını yeniden
 * yazar; `mac-raporu/` altındaki daha eski ~6.300 dosya üretici değiştiğinde
 * ESKİ biçimiyle kalır. Bu yüzden üretici bir şema hatasını düzelttiğinde
 * düzeltme eski sayfalara hiç ulaşmaz. Bu işlev eski sayfalardaki bilinen
 * üç hatayı yerinde onarır (idempotent: ikinci çağrı aynı metni döndürür):
 *
 *   • `eventStatus: EventCompleted` — schema.org'da böyle bir değer yok;
 *     Google alanı geçersiz sayar. Oynanmış maç için doğru değer
 *     `EventScheduled` ("planlandığı gibi gerçekleşti").
 *   • `location.address: ""` — boş zorunlu alan. Adres bilinmiyorsa alan
 *     HİÇ yazılmaz (uydurulmaz).
 *   • `location.name: "Bilinmiyor"/"Açıklanmadı"` — yer tutucu stat adı;
 *     stat bilinmiyorsa `location` düşer.
 *   • `Article` tipinde `author` yok — rapor kurum tarafından üretilir,
 *     tür `NewsArticle` olur ve yazar FutbolRadar kurumudur (üreticiyle aynı).
 */
const BLOCK_RE = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
const PLACEHOLDER_VENUES = new Set(["bilinmiyor", "açıklanmadı", "aciklanmadi", "unknown"]);
const DOMAIN = "https://www.futbolradar.com";

function repairNode(node) {
  let changed = false;
  if (!node || typeof node !== "object") return changed;
  const type = node["@type"];

  if (type === "SportsEvent") {
    if (node.eventStatus === "https://schema.org/EventCompleted") {
      node.eventStatus = "https://schema.org/EventScheduled";
      changed = true;
    }
    const location = node.location;
    if (location && typeof location === "object") {
      if (PLACEHOLDER_VENUES.has(String(location.name || "").trim().toLocaleLowerCase("tr"))) {
        delete node.location;
        changed = true;
      } else if ("address" in location && !String(location.address || "").trim()) {
        delete location.address;
        changed = true;
      }
    }
  }

  if (type === "Article" && typeof node.mainEntityOfPage === "string" && /\/mac-raporu\/|\/mac\//.test(node.mainEntityOfPage)) {
    node["@type"] = "NewsArticle";
    changed = true;
  }
  if ((node["@type"] === "NewsArticle") && !node.author && typeof node.mainEntityOfPage === "string" && /\/mac-raporu\/|\/mac\//.test(node.mainEntityOfPage)) {
    node.author = { "@type": "Organization", name: "FutbolRadar", url: DOMAIN };
    changed = true;
  }
  return changed;
}

/** @returns {string} onarılmış HTML (değişiklik yoksa aynı dize) */
export function repairReportJsonLd(html) {
  if (!html.includes("application/ld+json")) return html;
  // Hızlı çıkış: bilinen hataların hiçbiri yoksa ayrıştırma yapılmaz.
  if (!/EventCompleted|"address":""|Bilinmiyor|Açıklanmadı|"@type":"Article"/.test(html)) return html;
  return html.replace(BLOCK_RE, (block, raw) => {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return block;
    }
    const nodes = Array.isArray(parsed["@graph"]) ? parsed["@graph"] : [parsed];
    let changed = false;
    for (const node of nodes) changed = repairNode(node) || changed;
    return changed ? `<script type="application/ld+json">${JSON.stringify(parsed)}</script>` : block;
  });
}

/**
 * ESKİ RAPOR SAYFALARINDAKİ OYUNCU BAĞLANTILARI.
 *
 * Tam isimli adrese taşınan oyuncunun `../oyuncular/<id>.html` bağlantısı 301
 * verir; kanonik `../futbolcu/<slug>` doğrudan açılır. Üretici yeni sayfalarda
 * zaten doğru adresi yazıyor, eski sayfalar için burada yerinde düzeltilir.
 *
 * @param {(id: string, prefix: string) => string} resolveHref `playerLink` işlevi
 */
export function repairPlayerLinks(html, resolveHref) {
  if (!html.includes("oyuncular/")) return html;
  return html.replace(/href="((?:\.\.\/|\.\/)+)oyuncular\/([a-z0-9-]+)\.html"/g, (match, prefix, id) => {
    const href = resolveHref(id, prefix);
    return href && href !== `${prefix}oyuncular/${id}.html` ? `href="${href}"` : match;
  });
}
