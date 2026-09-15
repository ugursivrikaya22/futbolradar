#!/usr/bin/env node
/**
 * MAÇ SAYFASI İÇİN HAFİF HABER DİZİNİ.
 *
 * `data/news.json` ~940 KB: her haberin tam gövdesi, iç bağlantıları ve
 * kaynak listesi içinde. Maç sayfasındaki "ilgili haberler" bölümü bunların
 * HİÇBİRİNE bakmıyor — yalnızca başlık, özet, takım, etiket ve tarih
 * eşleştiriyor. Tam dosyayı indirmek, kullanılmayan 750 KB'ı her okuyucuya
 * yollamak demekti.
 *
 * Bu betik yalnızca eşleştirmeye giren alanları taşıyan bir dizin üretir
 * (~170 KB, sıkıştırılmış hâli çok daha küçük) ve dizin ancak bölüm ekrana
 * girdiğinde çekilir (bkz. match-hub.js#whenVisible).
 *
 * `--check` ile yazmaz, yalnızca dizinin güncel olup olmadığını söyler.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const SOURCE = path.join(root, "data", "news.json");
const OUTPUTS = [
  path.join(root, "data", "match-news-index.json"),
  path.join(root, "public", "data", "match-news-index.json")
];

/** Eşleştirmenin okuduğu alanlar. Buraya yazılmayan alan dizine girmez. */
function slim(item) {
  return {
    id: item.id || null,
    slug: item.slug || null,
    title: item.title || "",
    summary: item.summary || item.spot || "",
    publishedAt: item.publishedAt || null,
    team: item.team || null,
    category: item.category || null,
    tags: Array.isArray(item.tags) ? item.tags : [],
    sourceName: item.sourceName || null,
    status: item.status || null,
    url: item.url || null
  };
}

function build() {
  const payload = JSON.parse(fs.readFileSync(SOURCE, "utf8"));
  const items = Array.isArray(payload) ? payload : (payload.items || payload.news || []);
  const index = {
    _comment: "ÜRETİLMİŞ DOSYA — kaynak: data/news.json, üretici: scripts/build-match-news-index.mjs. Elle düzenlemeyin.",
    updatedAt: new Date().toISOString(),
    items: items.filter((item) => item && item.title).map(slim)
  };
  return JSON.stringify(index, null, 0);
}

// Zaman damgası her koşuda değişiyor; "güncel mi" denetimi yalnızca
// İÇERİĞE bakmalı, yoksa her derleme dosyayı bayat ilan ederdi.
function contentOf(text) {
  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(parsed.items || []);
  } catch {
    return "";
  }
}

const bundle = build();

if (process.argv.includes("--check")) {
  const stale = OUTPUTS.filter((file) => !fs.existsSync(file) ||
    contentOf(fs.readFileSync(file, "utf8")) !== contentOf(bundle));
  if (stale.length) {
    console.error(`[match-news-index] dizin güncel değil: ${stale.map((file) => path.relative(root, file)).join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log("[match-news-index] dizin güncel.");
  }
} else {
  for (const file of OUTPUTS) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bundle, "utf8");
  }
  console.log(`[match-news-index] ${JSON.parse(bundle).items.length} kayıt, ${OUTPUTS.length} konuma yazıldı (${bundle.length} bayt).`);
}
