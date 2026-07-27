/**
 * MAÇ SONU ZENGİNLEŞTİRME KOŞUSU (API-Football)
 *
 * Tamamlanmış her fikstür için sağlayıcı kimliğini çözer ve doğrulanmış
 * maç sonu verisini çeker: olaylar, dizilişler, takım istatistikleri,
 * oyuncu istatistikleri.
 *
 * Kullanım:
 *   node scripts/enrich-post-match.mjs             # dry-run (yazmaz)
 *   node scripts/enrich-post-match.mjs --apply     # data/match-enrichment.json'a yazar
 *   node scripts/enrich-post-match.mjs --match=<id>
 *
 * Anahtar yoksa koşu SESSİZ BİR NO-OP DEĞİLDİR: eksik yapılandırma adıyla
 * bildirilir, çıkış kodu 1 olur ve hiçbir dosya yazılmaz. Uydurma maç
 * verisi üretilmez.
 *
 * ÖNBELLEK: her fikstür için dört uç nokta çağrılıyor. Maç sonu verisi
 * BİTMİŞ bir maça ait, yani değişmez; bir kez çekildikten sonra tekrar
 * sorulması kotayı boşa harcar. Bu yüzden zenginleştirme deposu kalıcı
 * önbellek görevi görüyor: `--refresh` verilmedikçe zaten dolu bölümler
 * için sağlayıcıya gidilmiyor.
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { reportMissingProviderConfig } from "./lib/providerConfigReport.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);
const apiFootballProvider = require("../services/providers/apiFootballProvider.js");
const { fetchWithCache } = require("../services/providerCache.js");
const {
  SECTION_KEYS,
  isCompleted,
  resolveProviderFixture,
  buildEnrichment,
  shouldReplaceEnrichment
} = require("../services/postMatchEnrichmentService.js");

const MATCHES_PATH = path.join(root, "data", "matches.json");
const ENRICHMENT_PATH = path.join(root, "data", "match-enrichment.json");
const OVERRIDES_PATH = path.join(root, "data", "match-enrichment-overrides.json");

/** Sağlayıcı rate limit koruması — diğer senkronlarla aynı aralık. */
const PROVIDER_REQUEST_GAP_MS = 250;

function parseArgs(argv) {
  const args = { apply: false, refresh: false, match: null };
  for (const raw of argv) {
    if (raw === "--apply") args.apply = true;
    else if (raw === "--dry-run") args.apply = false;
    else if (raw === "--refresh") args.refresh = true;
    else if (raw.startsWith("--match=")) args.match = raw.slice("--match=".length);
  }
  return args;
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.warn(`[enrich] ${path.basename(filePath)} okunamadı: ${error.message}`);
    return fallback;
  }
}

function atomicWrite(filePath, data) {
  const tempPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tempPath, filePath);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Sağlayıcı çağrısı — önbellekli ve hata yutmayan. */
async function fetchSection(label, resource, params, run) {
  try {
    const { data } = await fetchWithCache(resource, params, run);
    return { ok: true, data };
  } catch (error) {
    console.warn(`[enrich]   ${label} alınamadı: ${error.message}`);
    return { ok: false, data: null, error: error.message };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Maç sonu uç noktalarının hepsi FİKSTÜR KİMLİĞİYLE çalışıyor
  // (/fixtures/events, /lineups, /statistics, /players). Lig kimliği
  // yalnızca tarih sorgusunu daraltmak için işe yarar ve zorunlu değil —
  // bu yüzden kadro senkronunun lig kontrolü burada uygulanmıyor.
  const hasKey = apiFootballProvider.hasConfig();
  const missing = hasKey ? [] : [{
    env: "APIFOOTBALL_API_KEY",
    why: "API-Football kimlik anahtarı; maç sonu olay, diziliş ve istatistik uç noktaları " +
      "bu anahtar olmadan çağrılamaz."
  }];

  if (missing.length) {
    reportMissingProviderConfig({
      task: "Maç sonu zenginleştirme",
      missing,
      impact: "Maç raporlarındaki olaylar, dizilişler, takım ve oyuncu istatistikleri " +
        "sağlayıcıdan çekilemiyor; bölümler 'veri bekleniyor' olarak kalıyor. " +
        "Uydurma olay, diziliş veya istatistik üretilmiyor."
    });
    process.exitCode = 1;
    return;
  }

  const matches = readJson(MATCHES_PATH, []);
  const store = readJson(ENRICHMENT_PATH, {});
  const overrides = readJson(OVERRIDES_PATH, {});

  let completed = matches.filter(isCompleted);
  if (args.match) completed = completed.filter((match) => match.id === args.match);

  console.log(`Tamamlanmış fikstür: ${completed.length}`);

  const next = { ...store };
  const summary = {
    resolved: 0, unresolved: 0, enriched: 0, skippedCached: 0,
    refused: 0, failed: 0, rejectedIds: 0
  };
  const unresolvedList = [];

  for (const match of completed) {
    const existing = store[match.id] || null;

    // ÖNBELLEK: bitmiş maçın verisi değişmez. Tam kapsamlı bir kayıt varsa
    // sağlayıcıya hiç gidilmez.
    if (!args.refresh && existing && existing.coverage === 100) {
      summary.skippedCached += 1;
      continue;
    }

    console.log(`\n[${match.id}]`);

    // 1. Sağlayıcı kimliğini çöz.
    //
    // Kayıtta sayısal bir `providerId` OLSA BİLE tarih listesi çekiliyor:
    // o kimlik artık doğrulanmadan kabul edilmiyor (bkz.
    // postMatchEnrichmentService/resolveProviderFixture). Aday listesi
    // olmadan doğrulama da yapılamaz, dolayısıyla liste her maç için
    // gerekli. Ek maliyet yok denecek kadar az: `fetchWithCache` aynı
    // tarihi paylaşan maçlar için tek çağrı yapıyor.
    const date = String(match.kickoff || "").slice(0, 10);
    let resolution = resolveProviderFixture(match, []);
    if (date) {
      const candidates = await fetchSection(
        "fikstür çözümlemesi",
        "match-detail",
        { date },
        () => apiFootballProvider.getFixturesByDate({ date })
      );
      await sleep(PROVIDER_REQUEST_GAP_MS);
      if (candidates.ok) {
        resolution = resolveProviderFixture(match, candidates.data);
        console.log(`  aday fikstür: ${Array.isArray(candidates.data) ? candidates.data.length : 0} (tarih ${date})`);
      }
    }

    // Kayıttaki kimlik doğrulamayı geçemediyse bunu ayrı bir satır olarak
    // basıyoruz. Sebep zaten `resolution.reason` içinde ama kürasyon
    // hatasının günlükte aranabilir tek bir etiketi olmalı: bu satır,
    // "data/matches.json'daki providerId yanlış" demenin kısa yolu.
    const curatedProviderId = String(match.providerId || "").trim();
    if (/^\d+$/.test(curatedProviderId) && curatedProviderId !== resolution.fixtureId) {
      summary.rejectedIds += 1;
      console.log(`  KAYITTAKİ KİMLİK KULLANILMADI: ${curatedProviderId} → ${resolution.fixtureId || "çözülemedi"}`);
    }

    if (!resolution.fixtureId) {
      summary.unresolved += 1;
      unresolvedList.push({ id: match.id, reason: resolution.reason });
      console.log(`  kimlik ÇÖZÜLEMEDİ — ${resolution.reason}`);
      continue;
    }

    summary.resolved += 1;
    console.log(`  fixtureId=${resolution.fixtureId} (${resolution.confidence}: ${resolution.reason})`);

    // 2. Dört uç noktayı çek.
    const fixtureId = resolution.fixtureId;
    const bundle = {};
    let failedFetches = 0;
    const endpoints = [
      ["events", "olaylar", () => apiFootballProvider.getFixtureEvents({ fixtureId })],
      ["lineups", "dizilişler", () => apiFootballProvider.getLineups({ fixtureId })],
      ["teamStats", "takım istatistikleri", () => apiFootballProvider.getFixtureStatistics({ fixtureId })],
      ["playerStats", "oyuncu istatistikleri", () => apiFootballProvider.getFixturePlayers({ fixtureId })]
    ];
    for (const [key, label, run] of endpoints) {
      const result = await fetchSection(label, "match-detail", { fixtureId, section: key }, run);
      if (!result.ok) failedFetches += 1;
      bundle[key] = result.ok ? result.data : null;
      await sleep(PROVIDER_REQUEST_GAP_MS);
    }

    // KESİNTİ, KAPSAM DEĞİLDİR.
    //
    // Dört uç noktanın DÖRDÜ de hata verdiyse elimizde "sağlayıcıda bu maç
    // için veri yok" bilgisi yok; "sağlayıcıya ulaşamadık" bilgisi var.
    // İkisini aynı kayda yazmak, geçici bir anahtar/kota sorununu kalıcı
    // bir kapsam olgusu gibi gösterirdi — sayfa "veri bekleniyor" derken
    // aslında beklenen şey veri değil, çalışan bir bağlantı.
    if (failedFetches === endpoints.length) {
      summary.failed += 1;
      console.log("  TÜM UÇ NOKTALAR HATA VERDİ — kesinti kapsam olarak yazılmıyor");
      continue;
    }

    // 3. Bölümleri kur (kürasyon geçersiz kılma dahil).
    const enrichment = buildEnrichment(match, bundle, {
      fixtureId,
      resolution,
      override: overrides[match.id] || null
    });

    // 4. Yarım çekim mevcut kaydı EZMEZ.
    const decision = shouldReplaceEnrichment(existing, enrichment);
    if (!decision.replace) {
      summary.refused += 1;
      console.log(`  YAZMA REDDEDİLDİ: ${decision.reason} — mevcut kayıt korundu`);
      continue;
    }

    next[match.id] = enrichment;
    summary.enriched += 1;

    // KURU KOŞUNUN ASIL ÇIKTISI BU SATIRLAR.
    //
    // Dry-run hiçbir şey yazmadığı için tek ürünü günlüktür: hangi maç
    // hangi fikstüre bağlandı, hangi bölüm doldu, hangisi boş kaldı.
    // "dolu: 3/6" demek yetmiyor — hangi üçü olduğu bilinmeden bağlamanın
    // doğru olup olmadığı ve neyin sağlayıcı sınırı olduğu ayırt edilemez.
    const ready = SECTION_KEYS.filter((key) => enrichment.sections[key].status === "ready");
    const awaiting = SECTION_KEYS.filter((key) => enrichment.sections[key].status !== "ready");
    console.log(`  kapsam %${enrichment.coverage} (${ready.length}/${SECTION_KEYS.length}) · durum: ${enrichment.dataStatus}`);
    console.log(`  DOLU  : ${ready.join(", ") || "—"}`);
    console.log(`  EKSİK : ${awaiting.join(", ") || "—"}`);
    if (failedFetches) {
      console.log(`  UÇ NOKTA HATASI: ${failedFetches}/${endpoints.length}`);
    }
    const overridden = SECTION_KEYS.filter((key) => enrichment.sections[key].overridden);
    if (overridden.length) {
      console.log(`  KÜRASYON MÜDAHALESİ: ${overridden.join(", ")}`);
    }
  }

  console.log(`\nÖzet: çözülen ${summary.resolved} · çözülemeyen ${summary.unresolved} · ` +
    `zenginleşen ${summary.enriched} · önbellekten atlanan ${summary.skippedCached} · ` +
    `reddedilen ${summary.refused} · sağlayıcı hatası ${summary.failed} · ` +
    `doğrulanamayan kayıt kimliği ${summary.rejectedIds}`);

  if (unresolvedList.length) {
    console.log("\nSağlayıcı kimliği çözülemeyen maçlar (kürasyonlu veri korunuyor):");
    for (const item of unresolvedList) console.log(`  - ${item.id}: ${item.reason}`);
  }

  // BÖLÜM BAZINDA KAPSAM TABLOSU.
  //
  // "Neyin sağlayıcı sınırı olduğu" sorusunun cevabı bu tablo: bir bölüm
  // maçların çoğunda boşsa bu bizim hatamız değil, sağlayıcının o turnuva
  // seviyesindeki kapsamıdır. Maç bazında bakarken bu örüntü görünmüyor.
  const evaluated = Object.values(next).filter((entry) => entry && entry.sections);
  if (evaluated.length) {
    console.log("\nBölüm bazında kapsam:");
    for (const key of SECTION_KEYS) {
      const filled = evaluated.filter((entry) => entry.sections[key] && entry.sections[key].status === "ready").length;
      const pct = Math.round((filled / evaluated.length) * 100);
      console.log(`  ${key.padEnd(12)} ${String(filled).padStart(2)}/${evaluated.length}  %${pct}`);
    }
  }

  if (!args.apply) {
    console.log("\nDry-run: değişiklik yazılmadı. Yazmak için --apply ekleyin.");
    return;
  }

  atomicWrite(ENRICHMENT_PATH, next);
  console.log(`\ndata/match-enrichment.json güncellendi · ${Object.keys(next).length} maç kaydı.`);
}

main().catch((error) => {
  console.error(`[enrich] beklenmeyen hata: ${error && error.stack || error}`);
  process.exitCode = 1;
});
