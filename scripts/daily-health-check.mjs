#!/usr/bin/env node
/**
 * GÜNLÜK SAĞLIK KONTROLÜ — YÖNETİCİ BETİK.
 *
 * GitHub Actions'ın her gün 05:05 TSİ'de çalıştırdığı iş bu betiği çağırır
 * (bkz. .github/workflows/daily-health-check.yml). Üç görevi birleştirir:
 *
 *   1. Bayat maç kartlarını temizler   → scripts/prune-stale-match-analyses.mjs
 *   2. Üç günden eski ticker öğelerini
 *      temizler                       → scripts/refresh-news-ticker.mjs
 *   3. Sayfayı kontrol eder + canlı skor
 *      gecikmesini ölçer              → GET /api/daily-health-check (üretim)
 *
 * NEDEN 1-2 YEREL, 3 UZAK. İlk ikisi bu depodaki JSON dosyalarını DEĞİŞTİRİR;
 * bu değişiklik ancak bir git checkout'unda anlamlıdır ve commit'e dönüşmesi
 * gerekir — sunucusuz bir işlevin dosya sistemi salt okunur ve orada yapılan
 * bir yazım hiçbir zaman depoya yansımaz (bkz. services/
 * dailyHealthCheckService.js başlığı). Üçüncüsü ise TERSİNE yalnızca
 * ÜRETİMDE anlamlıdır: canlı skor gecikmesi services/liveEventLatency.js
 * üzerinden Supabase'e yazılıyor ve yalnızca üretimdeki Vercel işlevi o
 * kimlik bilgilerine sahip — bu betiğin çalıştığı CI ortamı değil. Üretim
 * uç noktasını HTTP ile çağırmak, gerçek üretim verisini ölçmenin tek yolu.
 *
 * Kullanım:
 *   node scripts/daily-health-check.mjs            (kuru koşu — hiçbir şey yazmaz)
 *   node scripts/daily-health-check.mjs --apply     (alt betikleri --apply ile
 *                                                     çalıştırır, raporu yazar)
 *
 * Ortam değişkenleri:
 *   SITE_URL                  Varsayılan https://www.futbolradar.com
 *   DAILY_HEALTH_CHECK_SECRET Boşsa uzak kontrol atlanır (hata değil, not).
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const apply = process.argv.includes("--apply");

const SITE_URL = String(process.env.SITE_URL || "https://www.futbolradar.com").trim();
const SECRET = String(process.env.DAILY_HEALTH_CHECK_SECRET || "").trim();
const REPORT_PATH = path.join(root, "data", "daily-health-check-report.json");
const PUBLIC_REPORT_PATH = path.join(root, "public", "data", "daily-health-check-report.json");
const REMOTE_TIMEOUT_MS = 10000;

function log(line) {
  console.log(`[daily-health-check] ${line}`);
}

function readItemsCount(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (Array.isArray(parsed)) return parsed.length;
    if (Array.isArray(parsed.items)) return parsed.items.length;
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Bir bakım betiğini alt süreç olarak çalıştırır, stdout'u aynen konsola
 * yazar (görünürlük kaybolmasın) ve kendi özet satırından sayıları ayrıştırır.
 * Betik BEKLENMEDİK biçimde çökerse (ör. bozuk JSON) hata YUTULMAZ —
 * `ok: false` ile raporlanır ve çağıran süreç sonunda bunu hataya çevirir.
 */
function runMaintenanceScript(scriptRelativePath, { parse }) {
  const scriptPath = path.join(root, scriptRelativePath);
  const args = apply ? [scriptPath, "--apply"] : [scriptPath];

  try {
    const stdout = execFileSync(process.execPath, args, { encoding: "utf8", cwd: root });
    process.stdout.write(stdout);
    return { ok: true, applied: apply, ...parse(stdout) };
  } catch (error) {
    const stdout = String((error && error.stdout) || "");
    if (stdout) process.stdout.write(stdout);
    return {
      ok: false,
      applied: apply,
      error: String((error && error.message) || error).slice(0, 300)
    };
  }
}

function cleanStaleMatchCards() {
  log("bayat maç kartları taranıyor (scripts/prune-stale-match-analyses.mjs)...");
  const before = readItemsCount(path.join(root, "data", "match-analyses.json"));
  const result = runMaintenanceScript("scripts/prune-stale-match-analyses.mjs", {
    parse(stdout) {
      const match = stdout.match(/\[prune\] (\d+) kayıt incelendi · (\d+) bayat · (\d+) korundu/);
      if (!match) return { staleFound: null, note: "özet satırı ayrıştırılamadı" };
      return { totalBefore: Number(match[1]), staleFound: Number(match[2]), kept: Number(match[3]) };
    }
  });
  const after = readItemsCount(path.join(root, "data", "match-analyses.json"));
  return { ...result, totalBefore: before, totalAfter: after };
}

function cleanStaleTickerItems() {
  log("üç günden eski ticker öğeleri taranıyor (scripts/refresh-news-ticker.mjs)...");
  const before = readItemsCount(path.join(root, "data", "news-ticker.json"));
  const result = runMaintenanceScript("scripts/refresh-news-ticker.mjs", {
    parse(stdout) {
      const match = stdout.match(/sonuç: (\d+) yayına hazır kayıt, (\d+) raf ömrü doldu, (\d+) yinelenen, (\d+) geçersiz\./);
      if (!match) return { staleFound: null, note: "özet satırı ayrıştırılamadı" };
      return {
        readyForPublish: Number(match[1]),
        staleFound: Number(match[2]),
        deduped: Number(match[3]),
        invalid: Number(match[4])
      };
    }
  });
  const after = readItemsCount(path.join(root, "data", "news-ticker.json"));
  return { ...result, totalBefore: before, totalAfter: after };
}

/**
 * Sayfa kontrolü + canlı skor gecikmesi ÜRETİMDEN okunur — bkz. dosya
 * başlığındaki "neden 1-2 yerel, 3 uzak" notu. Sır tanımlı değilse (yerel
 * geliştirme, sırsız bir CI koşusu) çağrı hiç denenmez; bu bir hata değil,
 * açıkça bildirilen bir atlama.
 */
async function fetchRemoteHealthReport() {
  if (!SECRET) {
    log("DAILY_HEALTH_CHECK_SECRET tanımsız; uzak sayfa/gecikme kontrolü atlandı.");
    return { attempted: false, note: "DAILY_HEALTH_CHECK_SECRET tanımsız" };
  }

  const url = `${SITE_URL.replace(/\/$/, "")}/api/daily-health-check`;
  log(`üretim kontrol ediliyor: ${url}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { "x-health-check-secret": SECRET },
      signal: controller.signal
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok || !payload || payload.ok !== true) {
      return {
        attempted: true,
        ok: false,
        statusCode: response.status,
        error: (payload && payload.error && payload.error.message) || `HTTP ${response.status}`
      };
    }

    return { attempted: true, ok: true, statusCode: response.status, report: payload.data };
  } catch (error) {
    return { attempted: true, ok: false, error: String((error && error.message) || error).slice(0, 300) };
  } finally {
    clearTimeout(timer);
  }
}

const matchCards = cleanStaleMatchCards();
const ticker = cleanStaleTickerItems();
const remote = await fetchRemoteHealthReport();

const generatedAt = new Date().toISOString();
const overallOk = matchCards.ok && ticker.ok && (!remote.attempted || remote.ok);

const finalReport = {
  generatedAt,
  status: overallOk ? "healthy" : "degraded",
  applied: apply,
  cleanup: {
    matchCards,
    ticker
  },
  remote
};

log(
  `özet: maç kartı bayat=${matchCards.staleFound ?? "?"} · ticker bayat=${ticker.staleFound ?? "?"} · ` +
  `uzak kontrol=${remote.attempted ? (remote.ok ? "ok" : "başarısız") : "atlandı"}`
);

if (!apply) {
  log("kuru koşu — rapor dosyası yazılmadı. Yazmak için --apply.");
} else {
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(finalReport, null, 2)}\n`, "utf8");
  log(`yazıldı: ${path.relative(root, REPORT_PATH)}`);

  if (fs.existsSync(path.dirname(PUBLIC_REPORT_PATH))) {
    fs.writeFileSync(PUBLIC_REPORT_PATH, `${JSON.stringify(finalReport, null, 2)}\n`, "utf8");
    log(`yazıldı: ${path.relative(root, PUBLIC_REPORT_PATH)}`);
  }
}

console.log(JSON.stringify(finalReport, null, 2));

if (!overallOk) {
  console.error("[daily-health-check] HATA: bir ya da daha fazla kontrol başarısız oldu (yukarıya bakın).");
  process.exit(1);
}
