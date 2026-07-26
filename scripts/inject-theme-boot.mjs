/**
 * Tema önyükleme etiketini her sayfanın <head>'ine yerleştirir.
 *
 * Neden <head> ve neden senkron: tema tercihi sayfa ilk boyanmadan ÖNCE
 * uygulanmalıdır. Bu kod app.js gibi gövde sonunda çalışsaydı, koyu tema
 * seçmiş bir kullanıcı her sayfa açılışında önce beyaz bir ekran görür,
 * ardından sayfa koyuya dönerdi (FOUC). Senkron ve <head> içinde olduğu için
 * ilk boyama doğru temayla yapılır.
 *
 * Öncelik: kayıtlı tercih > sistem tercihi > açık tema. Kayıtlı tercih yoksa
 * data-theme yazılmaz; böylece CSS'teki prefers-color-scheme bloğu devrede
 * kalır ve kullanıcı sistem temasını değiştirdiğinde site onu izler.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const marker = "data-futbolradar-theme";

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if ([".git", ".agents", ".codex", ".vercel", "node_modules", "work", "outputs"].includes(entry.name)) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      files.push(fullPath);
    }
  }

  return files;
}

const themeTag = `  <script ${marker}>
    (function () {
      try {
        var stored = window.localStorage.getItem("futbolradar-theme");
        if (stored === "dark" || stored === "light") {
          document.documentElement.setAttribute("data-theme", stored);
        }
      } catch (error) {
        /* localStorage kapalıysa sistem tercihi geçerli kalır. */
      }
    })();
  </script>`;

let injected = 0;
for (const file of walk(root)) {
  const html = fs.readFileSync(file, "utf8");
  if (html.includes(marker)) {
    continue;
  }

  if (!html.includes("</head>")) {
    continue;
  }

  fs.writeFileSync(file, html.replace("</head>", `${themeTag}\n  </head>`), "utf8");
  injected += 1;
}

console.log(`Theme boot script checked: ${injected} HTML files updated`);
