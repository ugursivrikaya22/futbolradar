/**
 * DERLEME SONRASI ZİNCİRİ — TEK KAYNAK.
 *
 * Üreticiler sayfaları sıfırdan yazar. Ortak yerleşim, tema açılışı, ölçüm
 * kodu, site doğrulaması, çekirdek şema ve hreflang blokları o çıktının
 * ÜZERİNE sonradan işlenir. Yani bir sayfa yeniden üretildiğinde bu zincir de
 * yeniden koşmak zorundadır; koşmazsa sayfa üreticinin bıraktığı çıplak hâlde
 * yayına gider.
 *
 * Bu liste daha önce iki yerde ayrı ayrı yazılıydı: `package.json` içindeki
 * `postprocess` betiği ve `scripts/run-scheduled-update.mjs` içindeki saatlik
 * derleme adımları. İkisi zamanla ayrıştı — saatlik yol `inject-hreflang` ve
 * `inject-core-page-schema` adımlarını hiç çağırmıyordu. Saatlik iş maç
 * sayfalarını yeniden ürettiği için TR tarafındaki `alternate` blokları her
 * saat siliniyor, yalnızca haftalık tam derlemede geri geliyordu. Google
 * karşılıklı olmayan bir alternate bildirimini yok sayar: İngilizce sürüm
 * kopya sayılıp indeksten düşebilir.
 *
 * Bu yüzden zincir tek yerde durur ve iki yol da buradan okur. Sıra önemlidir:
 * `apply-shared-layout` sayfanın `<head>`ini yeniden kurar, enjektörler ondan
 * SONRA gelmek zorundadır.
 */

/** @type {{ id: string, script: string, args: string[], timeoutMinutes: number }[]} */
export const POSTPROCESS_STEPS = [
  { id: "ticker-refresh", script: "refresh-news-ticker.mjs", args: ["--apply"], timeoutMinutes: 5 },
  { id: "shared-layout", script: "apply-shared-layout.mjs", args: [], timeoutMinutes: 12 },
  { id: "theme-boot", script: "inject-theme-boot.mjs", args: [], timeoutMinutes: 5 },
  { id: "analytics", script: "inject-ga4.mjs", args: [], timeoutMinutes: 5 },
  { id: "site-verification", script: "inject-site-verification.mjs", args: [], timeoutMinutes: 5 },
  { id: "core-page-schema", script: "inject-core-page-schema.mjs", args: [], timeoutMinutes: 5 },
  { id: "hreflang", script: "inject-hreflang.mjs", args: [], timeoutMinutes: 8 }
];

/** Zincirin komut satırı hâli — insan okuması ve testler için. */
export function postprocessCommandLine() {
  return POSTPROCESS_STEPS
    .map((step) => ["node", `scripts/${step.script}`, ...step.args].join(" "))
    .join(" && ");
}
