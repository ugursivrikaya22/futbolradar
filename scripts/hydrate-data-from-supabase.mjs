#!/usr/bin/env node
/**
 * PREBUILD: Vercel Cron'un Supabase'e yazdığı taze veri dosyalarını
 * (cron_data_artifacts) build başlamadan `data/` üzerine KOŞULLU uygular.
 *
 * - API-Football'a HİÇBİR istek atmaz; yalnızca Supabase okur.
 * - Supabase ortamı yoksa, tablo yoksa ya da okuma başarısızsa hiçbir şey
 *   yapmaz, çıkış kodu 0: build bugünkü gibi depo verisiyle devam eder.
 * - Depo dosyası eserin atası değilse (elle/Actions commit'i) DEPO KAZANIR.
 * - `FUTBOLRADAR_SKIP_SUPABASE_HYDRATE=1` ile tamamen kapatılabilir.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

async function main() {
  if (process.env.FUTBOLRADAR_SKIP_SUPABASE_HYDRATE === "1") {
    console.log("[hydrate] FUTBOLRADAR_SKIP_SUPABASE_HYDRATE=1; atlandı.");
    return;
  }
  const { hydrateDataDir } = require("../services/cron/hydrate.js");
  const result = await hydrateDataDir({ root: process.cwd(), log: (m) => console.log(m) });
  if (!result.configured) console.log("[hydrate] Supabase yapılandırılmamış; depo verisi kullanılıyor.");
  for (const e of result.errors) console.warn(`[hydrate] uyarı: ${e}`);
}

main().catch((error) => {
  console.warn(`[hydrate] beklenmeyen hata, depo verisiyle devam: ${error && error.message}`);
  process.exitCode = 0;
});
