#!/usr/bin/env node
/**
 * SAĞLAYICI SÖZLEŞMESİ — ÇAĞRILAN HER METOT GERÇEKTEN VAR MI?
 *
 * Bu denetim iki ayrı üretim arızasından sonra yazıldı. İkisi de aynı
 * biçimdeydi: bir betik, sağlayıcıda HİÇ TANIMLI OLMAYAN bir metodu
 * çağırıyordu.
 *
 *   scripts/validate-player-photos.mjs  -> normalizePlayerPhoto (yok)
 *   scripts/sync-turkish-player-profiles.mjs
 *       -> getPlayersPaginated (yok), getProviderRateLimit (yok)
 *
 * Hatanın sessiz kalmasının sebebi şu: bu çağrılar `hasConfig()` kapısının
 * ARKASINDA duruyor. Anahtar olmayan her ortamda (yerel geliştirme, sandbox,
 * `npm test`) kod o satıra hiç ulaşmıyor; anahtarın bulunduğu tek yer olan
 * zamanlanmış GitHub Actions çalışmasında ise ilk döngü turunda
 * `TypeError: ... is not a function` ile 353 ms'de düşüyordu. Yani hata
 * yalnızca kimsenin bakmadığı yerde görünüyordu — haftalık derin zenginleştirme
 * adımı bu yüzden HİÇ çalışmadı.
 *
 * Tip denetleyicisi olmayan bir kod tabanında bu sınıfı yakalayacak tek şey
 * statik bir sözleşme denetimidir: sağlayıcı modülünü gerçekten yükle,
 * `module.exports` anahtarlarını al, sonra sağlayıcıyı içe aktaran her
 * dosyada `binding.metot` kullanımlarını bul ve dışa aktarılanlarla karşılaştır.
 * Ağ, anahtar ya da çalıştırma gerekmez.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const PROVIDER_DIR = path.join(root, "services", "providers");
const SCAN_DIRS = ["scripts", "services", "api"];

/**
 * `foo.bar` kullanımı her zaman metot çağrısı değildir; bunlar sağlayıcı
 * nesnesinde değil, JavaScript'in kendisinde tanımlıdır.
 */
const INTRINSIC_MEMBERS = new Set([
  "call", "apply", "bind", "toString", "constructor", "hasOwnProperty", "prototype", "then", "catch"
]);

/**
 * Üye taramasından önce yorumları ve tırnaklı dizeleri boşalt.
 *
 * Aksi hâlde içe aktarma yolunun kendisi eşleşiyor: `require(".../
 * apiFootballProvider.js")` dizesi `apiFootballProvider.js` desenini
 * karşıladığı için tarayıcı "js" adında olmayan bir metot rapor ediyordu.
 * Aynı şekilde bir yorum satırındaki örnek çağrı da yanlış alarm üretirdi.
 * Şablon dizeleri KORUNUR — `${provider.getX()}` gerçek bir çağrıdır.
 */
function strippedSource(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/(["'])(?:\\.|(?!\1)[^\\\r\n])*\1/g, '""');
}

function failures() {
  const problems = [];

  const providerExports = new Map();
  for (const file of fs.readdirSync(PROVIDER_DIR).filter((name) => name.endsWith(".js"))) {
    let loaded = null;
    try {
      loaded = require(path.join(PROVIDER_DIR, file));
    } catch (error) {
      problems.push(`services/providers/${file} yüklenemedi: ${error.message}`);
      continue;
    }
    if (!loaded || typeof loaded !== "object") continue;
    providerExports.set(file, new Set(Object.keys(loaded)));
  }

  if (!providerExports.size) {
    problems.push("Hiçbir sağlayıcı modülü yüklenemedi; denetim anlamsız.");
    return problems;
  }

  const files = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(mjs|cjs|js)$/.test(entry.name)) files.push(full);
    }
  };
  SCAN_DIRS.forEach((dir) => walk(path.join(root, dir)));

  const importRe = new RegExp(
    // const NAME = require(".../providers/FILE.js") — the negative lookahead excludes
    // const NAME = require("...").someMethod(), where NAME is bound to that call's
    // RESULT (e.g. an array), not to the provider module; without it, a legitimate
    // Array method on NAME (like .push) is misreported as an unknown provider method.
    "(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*require\\(\\s*[\"']([^\"']*providers/([A-Za-z0-9_.-]+\\.js))[\"']\\s*\\)(?!\\s*\\.)" +
    "|" +
    // import NAME from ".../providers/FILE.js"
    "import\\s+([A-Za-z_$][\\w$]*)\\s+from\\s*[\"']([^\"']*providers/([A-Za-z0-9_.-]+\\.js))[\"']",
    "g"
  );
  const destructureRe = new RegExp(
    "(?:const|let|var)\\s*\\{([^}]*)\\}\\s*=\\s*require\\(\\s*[\"'][^\"']*providers/([A-Za-z0-9_.-]+\\.js)[\"']\\s*\\)",
    "g"
  );

  let scanned = 0;
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    if (!source.includes("providers/")) continue;
    const relative = path.relative(root, file);
    const body = strippedSource(source);
    scanned += 1;

    importRe.lastIndex = 0;
    let match;
    while ((match = importRe.exec(source))) {
      const binding = match[1] || match[4];
      const providerFile = match[3] || match[6];
      const exported = providerExports.get(providerFile);
      if (!binding || !exported) continue;

      const memberRe = new RegExp(`\\b${binding.replace(/\$/g, "\\$")}\\.([A-Za-z_$][\\w$]*)`, "g");
      const seen = new Set();
      let member;
      while ((member = memberRe.exec(body))) {
        const name = member[1];
        if (seen.has(name) || INTRINSIC_MEMBERS.has(name)) continue;
        seen.add(name);
        if (!exported.has(name)) {
          problems.push(`${relative}: ${providerFile} içinde olmayan "${name}" çağrılıyor`);
        }
      }
    }

    destructureRe.lastIndex = 0;
    while ((match = destructureRe.exec(source))) {
      const exported = providerExports.get(match[2]);
      if (!exported) continue;
      for (const raw of match[1].split(",")) {
        const name = raw.split(":")[0].split("=")[0].trim();
        if (!name || name.startsWith("...")) continue;
        if (!exported.has(name)) {
          problems.push(`${relative}: ${match[2]} içinde olmayan "${name}" destructure ediliyor`);
        }
      }
    }
  }

  if (!scanned) problems.push("Sağlayıcı içe aktaran hiçbir dosya bulunamadı; tarayıcı bozulmuş olabilir.");
  return problems;
}

const problems = failures();
if (problems.length) {
  console.error("Provider contract check FAILED:");
  problems.forEach((line) => console.error(`  - ${line}`));
  process.exitCode = 1;
} else {
  console.log("Provider contract check passed: çağrılan tüm sağlayıcı metotları dışa aktarılmış.");
}
