import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { entityTypeForPath, evaluateEntitySeoPage } = require("../services/entitySeoQualityService.js");

const canonicalUrl = "https://www.futbolradar.com/mac/ornek.html";
const html = `<!doctype html><html><head>
  <link rel="canonical" href="${canonicalUrl}">
  <meta name="robots" content="index,follow">
  <script type="application/ld+json">{"@context":"https://schema.org"}</script>
</head><body><a href="../index.html">Ana sayfa</a><a href="../super-lig-fikstur.html">Fikstur</a><a href="../oyuncular/a.html">Oyuncu</a><h1>Ornek mac</h1><p>${"Dogrulanmis baglam. ".repeat(30)}</p></body></html>`;

const result = evaluateEntitySeoPage({ html, canonicalUrl });
assert.equal(result.indexable, true);
assert.equal(entityTypeForPath("/mac/ornek.html"), "match");
assert.equal(entityTypeForPath("/oyuncular/ornek.html"), "player");
assert.equal(entityTypeForPath("/kose-yazilari/ornek.html"), "editorial");
assert.equal(entityTypeForPath("/super-lig-fikstur.html"), null);

const thin = evaluateEntitySeoPage({ html: "<h1>Eksik</h1>", canonicalUrl });
assert.equal(thin.indexable, false);
assert.deepEqual(thin.issueCodes.sort(), [
  "canonical-mismatch",
  "missing-structured-data",
  "not-indexable",
  "thin-content",
  "weak-internal-linking"
]);
console.log("Entity SEO quality tests passed");
