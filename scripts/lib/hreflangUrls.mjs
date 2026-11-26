/**
 * hreflang ADRESLERİNİN TEK KURALI: alternate adres, sayfanın kendi
 * `rel="canonical"` adresiyle AYNI olmalı.
 *
 * Eskiden adres rota haritasındaki dosya yolundan türetiliyordu
 * (`kose-yazilari/x.html` → `.../kose-yazilari/x.html`). Sayfanın kanonik
 * adresi ise uzantısız (`.../kose-yazilari/x`). Canlı denetimde 94 köşe yazısı
 * çiftinin ve form tablosu sayfasının hreflang etiketleri kanonikle
 * eşleşmiyordu: Google, alternate'in kanonik olmayan bir adrese işaret
 * ettiği çiftleri yok sayabilir.
 *
 * Kural: sayfa dosyası okunabiliyor ve mutlak, bu alan adına ait bir
 * canonical taşıyorsa hreflang o adresi kullanır; aksi hâlde eski türetme
 * (`pairUrl`) devreye girer.
 */
const DOMAIN = "https://www.futbolradar.com";

/** HTML metninden kanonik adres; bu alan adında değilse ya da yoksa boş. */
export function canonicalOfHtml(html) {
  const tag = String(html || "").match(/<link\s+[^>]*rel=["']canonical["'][^>]*>/i);
  if (!tag) return "";
  const href = tag[0].match(/href=["']([^"']+)["']/i);
  const value = href ? href[1].trim() : "";
  return value === DOMAIN || value.startsWith(`${DOMAIN}/`) ? value : "";
}

/**
 * @param {{tr: string, en: string}} route  rota haritası satırı
 * @param {(relativePath: string) => string} readHtml  dosya içeriği ("" = yok)
 * @param {(route: object, locale: "tr"|"en") => string} fallback  `pairUrl`
 */
export function alternateUrls(route, readHtml, fallback) {
  const pick = (locale) => canonicalOfHtml(readHtml(route[locale])) || fallback(route, locale);
  return { tr: pick("tr"), en: pick("en") };
}
