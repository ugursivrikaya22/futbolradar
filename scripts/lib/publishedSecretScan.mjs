/**
 * YAYIMLANAN ÇIKTIDA SIR TARAMASI — tek yetkili tarama.
 *
 * NEDEN AYRI BİR DOSYA. Bu tarama daha önce yalnızca
 * scripts/test-supabase-layer.mjs içinde yaşıyordu ve orada kalması bir
 * yanılsama üretiyordu: testler `npm run build` ve Vercel dağıtım zincirinin
 * PARÇASI DEĞİL. Yani sızıntıyı yakalayacağı söylenen koruma, sızıntının
 * gerçekten olabileceği tek yerde — üretim derlemesinde — hiç çalışmıyordu.
 * Anahtarsız CI'da test boşuna geçiyor, anahtarlı derlemede hiç koşmuyordu.
 *
 * Artık aynı tarama iki yerden çağrılıyor ve kural TEK YERDE yaşıyor:
 *   • scripts/verify-published-secrets.mjs — derleme zincirinin son adımı.
 *   • scripts/test-supabase-layer.mjs      — sözleşmenin testi.
 *
 * NE ARANIR. Ne anahtar DEĞERİ (JWT ya da sb_secret_ biçimi) ne de servis
 * anahtarının DEĞİŞKEN ADI yayımlanan hiçbir dosyada geçmemeli. Ad tek başına
 * bir sır değil ama saldırgana hangi değişkeni hedefleyeceğini söyler; sırrın
 * yanında duran bir işaret levhasıdır.
 *
 * KAPSAM ÜRETİLEN HER SAYFA. Yalnızca kökteki sayfalara bakmak yetmez:
 * mac/, oyuncular/, mac-raporu/ ve karsilastirma/ altındaki binlerce sayfa da
 * aynı üreticilerden çıkıyor ve aynı biçimde tarayıcıya gidiyor. Dar bir
 * tarama, "hepsine baktım" diyen ama bakmayan bir korumadır.
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { SERVICE_KEY_ENV_NAMES } = require("../../services/supabase/config.js");

/** JWT biçimi: sızmış bir anahtarı metin içinde tanımak için. */
export const JWT_PATTERN = /\bey[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/;

/** Supabase'in yeni gizli anahtar biçimi. */
export const SECRET_KEY_PATTERN = /\bsb_secret_[A-Za-z0-9_-]{10,}\b/;

/** Tarayıcıya giden dosya uzantıları. */
const SCANNED_EXTENSIONS = new Set([".html", ".js"]);

/**
 * Taramanın dışında kalan dizinler.
 *
 * Kaynak dosyalar (services/, scripts/, api/) BİLEREK dışarıda: servis
 * anahtarının adı orada geçmek ZORUNDA, okunduğu yer orası. Tarama
 * yayımlanan çıktıyı sorgular, kaynağı değil.
 */
const SKIPPED_DIRECTORIES = new Set([
  ".git", "node_modules", "services", "scripts", "api", "server", "lib",
  "components", "supabase", "docs", "rules", "templates", "data", ".github", ".claude"
]);

function collect(directory, root, found) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      // Üst düzeyde kaynak dizinleri atlanır; alt düzeyde aynı adlar
      // üretilmiş sayfa klasörü olabileceği için atlanmaz.
      if (path.dirname(full) === root && SKIPPED_DIRECTORIES.has(entry.name)) continue;
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      collect(full, root, found);
      continue;
    }
    if (entry.isFile() && SCANNED_EXTENSIONS.has(path.extname(entry.name))) found.push(full);
  }
  return found;
}

/** Taranacak dosyaların tamamı — depo köküne göre mutlak yollar. */
export function publishedFiles(root) {
  return collect(root, root, []);
}

/**
 * Yayımlanan çıktıyı tarar.
 *
 * @returns {{files: number, problems: string[]}} problems boşsa çıktı temiz.
 *          Gerekçe Türkçe ve dosya adıyla birlikte döner; "bir yerde sızıntı
 *          var" demek, düzeltecek kişiye hiçbir şey söylemez.
 */
export function scanPublishedOutput(root) {
  const files = publishedFiles(root);
  const problems = [];

  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    const name = path.relative(root, file);

    for (const envName of SERVICE_KEY_ENV_NAMES) {
      if (content.includes(envName)) {
        problems.push(`${name}: servis anahtarı değişken adı "${envName}" yayımlanan dosyada geçiyor`);
      }
    }

    if (JWT_PATTERN.test(content)) {
      problems.push(`${name}: JWT biçiminde bir değer sızmış olabilir`);
    }
    if (SECRET_KEY_PATTERN.test(content)) {
      problems.push(`${name}: sb_secret_ biçiminde anahtar sızmış`);
    }
  }

  return { files: files.length, problems };
}
