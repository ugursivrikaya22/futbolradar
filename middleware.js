/**
 * VERCEL ROUTING MIDDLEWARE — biten maçların eski adreslerini kalıcı arşive
 * 301 ile yönlendirir. Yalnız /mac/* ve /mac-raporu/* isteklerinde çalışır
 * (matcher); diğer tüm site statik olarak, middleware'siz sunulur.
 *
 *   /mac/<ev>-<dep>-<gün>-<ay>-<yıl>(.html)   → /mac/<YYYY-MM-DD>/<ev>-<dep>
 *   /mac-raporu/<ev>-<dep>-<YYYY-MM-DD>.html → /mac/<YYYY-MM-DD>/<ev>-<dep>
 *
 * Tablo build'de üretilir (scripts/generate-match-archive-pages.mjs →
 * services/matchArchiveRedirects.generated.mjs). Tabloda olmayan adres
 * (başlamamış/canlı maç, hafta sayfası, yeni arşiv adresi) hiç dokunulmadan
 * statik dosyaya geçer. vercel.json'daki ~2.048 yönlendirme sınırına takılmaz.
 */
import { RAPOR_KURAL, ISTISNA } from "./services/matchArchiveRedirects.generated.mjs";

export const config = {
  matcher: ["/mac/:path*", "/mac-raporu/:path*"]
};

export function resolveLegacyMatchPath(pathname) {
  const clean = String(pathname || "").replace(/^\/+/, "").replace(/\/+$/, "").replace(/\.html$/, "");
  if (/^mac\/\d{4}-\d{2}-\d{2}\//.test(clean)) return null; // zaten arşiv adresi
  if (Object.prototype.hasOwnProperty.call(ISTISNA, clean)) return `/mac/${ISTISNA[clean]}`;
  if (clean.startsWith("mac-raporu/")) {
    const key = clean.slice("mac-raporu/".length);
    const m = /^(.+)-(\d{4}-\d{2}-\d{2})$/.exec(key);
    if (m && RAPOR_KURAL.has(key)) return `/mac/${m[2]}/${m[1]}`;
  }
  return null;
}

export default function middleware(request) {
  const url = new URL(request.url);
  const target = resolveLegacyMatchPath(url.pathname);
  if (!target) return undefined;
  const destination = new URL(target + url.search, url.origin);
  return new Response(null, {
    status: 301,
    headers: { Location: destination.toString(), "Cache-Control": "public, max-age=86400, s-maxage=31536000" }
  });
}
