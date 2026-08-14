/**
 * `lastmod` — SAYFANIN GERÇEKTEN DEĞİŞTİĞİ TARİH.
 *
 * Site haritasındaki iki üretici tarihi SABİT yazıyordu:
 * `generate-static-seo-pages.mjs` içinde `const today = "2026-07-22"`,
 * `generate-player-comparison-pages.mjs` içinde `2026-07-13`. Site saatte
 * bir yeniden derlenmesine rağmen ana sayfanın `lastmod`u üç haftadır
 * kımıldamıyordu.
 *
 * Bunun bedeli sessiz ve tam ters yönde: `lastmod`, tarayıcıya "bu sayfaya
 * en son ne zaman bakman gerektiği"ni söyleyen sinyal. Donmuş bir tarih,
 * sayfa her saat değişirken bile "burada yeni bir şey yok" demek.
 *
 * ── AMA HER DERLEMEDE "BUGÜN" YAZMAK DA YANLIŞ ───────────────────────────
 * Kolay çözüm `new Date()` yazmaktı ve daha kötü olurdu: 1500 sayfanın
 * tamamına saatte bir "az önce değişti" demek, hiçbiri değişmemişken kurt
 * masalı okumaktır. Google, `lastmod` doğru çıkmadığında sinyale tamamen
 * güvenmeyi bırakıyor — yani yalan söyleyen bir site haritası, sinyali olan
 * bir siteyi sinyalsiz bırakır.
 *
 * Bu yüzden tarih İÇERİĞE bağlı: sayfanın özeti (hash) değiştiyse bugüne
 * çekilir, değişmediyse saklanan tarih korunur. Durum
 * `data/sitemap-lastmod.json` içinde tutulur ve depoya işlenir.
 *
 * ── NELER "DEĞİŞİM" SAYILMAZ ─────────────────────────────────────────────
 * İki parça her derlemede oynuyor ama sayfanın söylediği şeyi
 * değiştirmiyor; hash'ten önce çıkarılırlar:
 *
 *   • Varlık sürüm damgaları (`page.css?v=…`) — CSS değişince site
 *     genelinde oynar, sayfanın içeriğiyle ilgisi yoktur.
 *   • Ortak haber bandı — her sayfada aynı şerit; bandın tazelenmesi o
 *     sayfanın güncellendiği anlamına gelmez.
 *
 * Geri kalan her şey sayılır: ana sayfadaki anket kutusu belirdiğinde ya da
 * bir takım sayfasının verisi tazelendiğinde tarih gerçekten ilerler.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const STATE_FILE = path.join("data", "sitemap-lastmod.json");

/** Derleme başına tek tarih: aynı koşuda yazılan sayfalar aynı günü alsın. */
const BUILD_DATE = new Date().toISOString().slice(0, 10);

/** Hash'ten önce silinen, her derlemede oynayan parçalar. */
const VOLATILE = [
  /\?v=[0-9a-f]+/g,
  /<!-- shared-layout:ticker:start -->[\s\S]*?<!-- shared-layout:ticker:end -->/g
];

function fingerprint(html) {
  let text = String(html || "");
  for (const pattern of VOLATILE) text = text.replace(pattern, "");
  return crypto.createHash("sha1").update(text).digest("hex").slice(0, 16);
}

export function createFreshnessTracker(root) {
  const statePath = path.join(root, STATE_FILE);
  let state = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8"));
    if (parsed && typeof parsed === "object" && parsed.pages) state = parsed.pages;
  } catch { state = {}; }

  const next = {};

  return {
    /**
     * Sayfanın `lastmod` tarihi. `html` verilmezse (kaynak dosya elde
     * yoksa) saklanan tarih korunur — tarih UYDURULMAZ, hiç kayıt yoksa
     * derleme tarihi kullanılır çünkü sayfa ilk kez yayına giriyor.
     */
    lastmodFor(key, html) {
      const previous = state[key];
      if (html == null) {
        const kept = previous ? previous.lastmod : BUILD_DATE;
        next[key] = previous || { hash: null, lastmod: kept };
        return kept;
      }

      const hash = fingerprint(html);
      // İçerik aynıysa tarih DE aynı kalır: sayfa değişmedi demektir.
      const lastmod = previous && previous.hash === hash ? previous.lastmod : BUILD_DATE;
      next[key] = { hash, lastmod };
      return lastmod;
    },

    /** Diskteki sayfayı okuyup damgalar; dosya yoksa saklanan tarihi korur. */
    lastmodForFile(key, absolutePath) {
      let html = null;
      try {
        html = fs.readFileSync(absolutePath, "utf8");
      } catch { html = null; }
      return this.lastmodFor(key, html);
    },

    /**
     * Durumu yaz. Bu koşuda GÖRÜLMEYEN sayfalar korunur: her üretici site
     * haritasının yalnızca kendi bölümünü yazıyor, silmek diğerlerinin
     * geçmişini çöpe atmak olurdu.
     */
    save() {
      const merged = { ...state, ...next };
      const ordered = {};
      for (const key of Object.keys(merged).sort()) ordered[key] = merged[key];
      const payload = `${JSON.stringify({ updatedAt: BUILD_DATE, pages: ordered }, null, 2)}\n`;
      const previous = fs.existsSync(statePath) ? fs.readFileSync(statePath, "utf8") : null;
      if (previous !== payload) fs.writeFileSync(statePath, payload, "utf8");
    },

    buildDate: BUILD_DATE
  };
}
