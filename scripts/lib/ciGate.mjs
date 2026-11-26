/**
 * PR CI KAPISI — 48 DAKİKALIK BUILD'İ KİM TETİKLEYEBİLİR?
 *
 * `Interaction checks` her PR push'unda siteyi baştan üretiyor (`npm run build`,
 * ~48 dk). Depo özel olduğundan bu dakikalar faturalanıyor ve ajan oturumları
 * taslak PR'a gün boyu push ediyor: aynı PR için onlarca 48 dakikalık koşu.
 *
 * Kural (hepsi KAPALI-HATA, yani şüphede CI çalışır):
 *   • PR değilse (main'e push, elle tetikleme) HER ZAMAN çalışır.
 *   • Taslak (draft) PR atlanır; "Ready for review" işaretlenince çalışır
 *     (workflow `ready_for_review` tipini dinler). Taslakta CI gerekirse
 *     Actions → Interaction checks → "Run workflow" ile o dalda elle koşturulur.
 *   • Yalnızca operasyonel dosya (docs/, outputs/, editorial/, .github/,
 *     README/AGENTS) değiştiren PR atlanır — Vercel'in build atlama kuralıyla
 *     (scripts/lib/buildDecision.mjs isOperationalOnly) AYNI tanım.
 *   • Değişen dosyalar alınamazsa çalışır.
 */
import { isOperationalOnly } from "./buildDecision.mjs";

/**
 * @param {{event?:string, draft?:boolean|string, files?:string[]|null}} input
 * @returns {{run:boolean, reason:string}}
 */
export function decideCi({ event = "", draft = false, files = null } = {}) {
  if (event !== "pull_request") return { run: true, reason: `event-${event || "unknown"}` };
  const isDraft = draft === true || String(draft).toLowerCase() === "true";
  if (isDraft) return { run: false, reason: "draft-pull-request" };
  if (!Array.isArray(files) || files.length === 0) return { run: true, reason: "changed-files-unavailable" };
  if (files.every(isOperationalOnly)) return { run: false, reason: "operational-files-only" };
  return { run: true, reason: "source-or-content-changed" };
}
