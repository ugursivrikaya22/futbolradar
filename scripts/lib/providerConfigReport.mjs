/**
 * SAĞLAYICI YAPILANDIRMASI EKSİKKEN NE OLUR?
 *
 * Kadro senkronu API-Football yapılandırması olmadan hiçbir şey yazamaz.
 * Bu, veri uydurmamak için doğru davranış — ama script bunu güven verici bir
 * cümleyle ve sıfır çıkış koduyla bildirdiği için, eksiklik CI günlüğünde
 * fark edilmeden aylarca sürebiliyordu. Sonuç, on üç takımın rapor
 * sayfasının sessizce boş kalmasıydı.
 *
 * Buradaki amaç davranışı değiştirmek değil, görünürlüğü değiştirmek:
 *
 *   • hangi değişkenin eksik olduğu tek tek adıyla yazılır,
 *   • GitHub Actions altında koşuluyorsa ::warning:: ek açıklaması üretilir
 *     (koşu özetinin başında görünür, günlüğün içinde kaybolmaz),
 *   • koşu özetine (GITHUB_STEP_SUMMARY) ne yapılması gerektiği eklenir.
 *
 * Çıkış kodu bilerek 0 bırakılır: bu adım, maç sonuçları senkronu ve site
 * derlemesiyle aynı doğrusal zincirde. Kırmızıya düşürmek eksik bir secret
 * yüzünden sitenin tüm güncellemesini durdururdu.
 */

import fs from "node:fs";

/**
 * Süper Lig kadro senkronu için gereken yapılandırma.
 *
 * Lig kimliği artık zorunlu bir env değişkeni değil: env'de yoksa
 * services/leagueResolver.js sağlayıcının /leagues uç noktasından çözer.
 * Bu yüzden burada yalnızca ÇÖZÜLEMEYEN durum bir engeldir ve engelin
 * gerekçesi çözümlemeden gelir — "tanımlı değil" ile "sağlayıcı iki aday
 * döndürdü" tamamen farklı iki sorun, aynı cümleyle bildirilemezler.
 */
export function missingSquadSyncConfig({ hasKey, leagueResolution }) {
  const missing = [];

  if (!hasKey) {
    missing.push({
      env: "APIFOOTBALL_API_KEY",
      why: "API-Football kimlik anahtarı; kadro ve oyuncu verisi bu anahtar olmadan çekilemez. " +
        "Tanımlandığında lig kimliği de kendiliğinden çözülür."
    });
    return missing;
  }

  if (leagueResolution && leagueResolution.status !== "resolved") {
    missing.push({
      env: "APIFOOTBALL_LEAGUE_ID",
      why: leagueIdReason(leagueResolution)
    });
  }

  return missing;
}

function leagueIdReason(resolution) {
  if (resolution.reason === "ambiguous-match") {
    return "Sağlayıcı Süper Lig adıyla birden fazla lig döndürdü; yanlış ligi seçmek on sekiz takımın " +
      "kadrosunu yanlış ligden doldururdu, bu yüzden tahmin edilmiyor. Adaylar: " +
      resolution.candidates.map((item) => `${item.id} (${item.name})`).join(", ") + ". " +
      "APIFOOTBALL_LEAGUE_ID ile hangisi olduğunu belirt.";
  }

  if (resolution.reason === "no-match") {
    return "Sağlayıcı katalogunda Süper Lig bulunamadı; genellikle paketin ilgili sezona erişimi yok. " +
      "APIFOOTBALL_LEAGUE_ID ile elle tanımlanabilir.";
  }

  if (String(resolution.reason || "").startsWith("provider-error:")) {
    return `Lig kimliği sorulurken sağlayıcı hata döndü (${resolution.reason}). ` +
      "Ayrıntı için: node scripts/preflight-api-football.mjs --probe";
  }

  return "Lig kimliği ne env'de tanımlı ne de sağlayıcıdan çözülebildi. " +
    "Lig bilerek koda gömülmedi (docs/football-data-coverage.md).";
}

function annotate(line) {
  // GitHub Actions ek açıklaması yalnızca CI'da anlamlı; yerelde gürültü olur.
  if (process.env.GITHUB_ACTIONS === "true") console.log(`::warning::${line}`);
}

function appendSummary(markdown) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  try {
    fs.appendFileSync(file, `${markdown}\n`, "utf8");
  } catch {
    /* Özet yazılamazsa adım yine de çalışır; yalnızca rapor kaybolur. */
  }
}

/**
 * Eksik yapılandırmayı hem günlüğe hem koşu özetine dürüstçe bildirir.
 * @param {{task: string, missing: Array<{env: string, why: string}>, impact: string}} report
 */
export function reportMissingProviderConfig({ task, missing, impact }) {
  if (!missing.length) return;

  const names = missing.map((item) => item.env).join(", ");
  console.log(`${task} atlandı: ${names} tanımlı değil. Hiçbir dosya yazılmadı.`);
  for (const item of missing) console.log(`  - ${item.env}: ${item.why}`);
  console.log(`  Etki: ${impact}`);

  annotate(`${task} atlandı — eksik yapılandırma: ${names}. ${impact}`);

  appendSummary([
    `### ⚠️ ${task} atlandı`,
    "",
    `Eksik yapılandırma: ${missing.map((item) => `\`${item.env}\``).join(", ")}`,
    "",
    ...missing.map((item) => `- **${item.env}** — ${item.why}`),
    "",
    `**Etki:** ${impact}`,
    "",
    "Depo → Settings → Secrets and variables → Actions altına eklendiğinde bu adım " +
      "bir sonraki koşuda kendiliğinden gerçek veriyle çalışır; kod değişikliği gerekmez."
  ].join("\n"));
}
