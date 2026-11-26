/**
 * Actions dakika korumaları: PR CI kapısı (taslak / yalnız operasyonel dosya),
 * kapının iş akışına bağlanışı ve zamanlanmış koşu sayısı üst sınırları.
 */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { decideCi } from "./lib/ciGate.mjs";

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
let failures = 0;
function expect(condition, message) {
  if (!condition) {
    failures += 1;
    console.error(`FAIL: ${message}`);
  }
}

// --- Karar ---
expect(decideCi({ event: "push" }).run, "main'e push her zaman çalışır");
expect(decideCi({ event: "workflow_dispatch" }).run, "elle tetikleme her zaman çalışır");
expect(decideCi({ event: "schedule" }).run, "bilinmeyen olay çalışır (kapalı-hata)");
for (const draft of [true, "true", "TRUE"]) {
  const d = decideCi({ event: "pull_request", draft, files: ["app.js"] });
  expect(!d.run && d.reason === "draft-pull-request", `taslak PR atlanır (draft=${draft})`);
}
expect(decideCi({ event: "pull_request", draft: false, files: ["app.js"] }).run, "hazır PR + kaynak değişikliği çalışır");
expect(decideCi({ event: "pull_request", draft: "false", files: ["page.css", "docs/x.md"] }).run, "karışık değişiklik çalışır");
{
  const d = decideCi({ event: "pull_request", draft: false, files: ["docs/a.md", "README.md", ".github/workflows/x.yml", "editorial/q.json", "outputs/o.json"] });
  expect(!d.run && d.reason === "operational-files-only", "yalnız operasyonel dosya atlanır");
}
expect(decideCi({ event: "pull_request", draft: false, files: null }).run, "dosya listesi yoksa çalışır (kapalı-hata)");
expect(decideCi({ event: "pull_request", draft: false, files: [] }).run, "boş dosya listesi çalışır (kapalı-hata)");
expect(decideCi({ event: "pull_request", draft: false, files: ["data/news.json"] }).run, "veri/içerik değişikliği çalışır");
expect(decideCi({ event: "pull_request", draft: false, files: ["docs/a.md", "sitemap.xml"] }).run, "tek bir genel dosya bile CI'ı çalıştırır");

// --- İş akışı bağlantısı ---
const ci = read(".github/workflows/interaction-checks.yml");
expect(/types: \[opened, synchronize, reopened, ready_for_review\]/.test(ci), "ready_for_review dinleniyor (taslak hazır olunca CI koşar)");
expect(/\n  gate:\n/.test(ci) && /id: decide/.test(ci) && /node scripts\/ci-gate\.mjs/.test(ci), "gate işi ve karar adımı var");
expect(/pull-requests: read/.test(ci), "gate işi PR dosyalarını okuyabilir");
expect(/\n  production:\n    needs: gate\n    if: needs\.gate\.outputs\.run == 'true'/.test(ci), "production işi kapıya bağlı");
expect(/sparse-checkout:/.test(ci) && /scripts\/lib\/ciGate\.mjs/.test(ci) && /scripts\/lib\/buildDecision\.mjs/.test(ci), "kapı yalnızca gereken dosyaları çeker");
expect(/push:\n    branches: \[main\]/.test(ci) && /workflow_dispatch:/.test(ci), "main push'u ve elle tetikleme korunuyor");
expect(/group: interactions-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}\n  cancel-in-progress: true/.test(ci), "aynı PR'daki eski koşu iptal edilmeye devam ediyor");
expect(/timeout-minutes: 90/.test(ci), "production işinin süre sınırı korunuyor");
expect(!/\n  production:[\s\S]*?\n  gate:/.test(ci), "gate, production'dan önce tanımlı");
// İzleyici yalnızca main koşularını okur; kapı main'i hiçbir koşulda atlamaz.
expect(/branch=main/.test(read("scripts/monitor-operations.mjs")), "izleyici main koşularına bakıyor");

// --- Zamanlama üst sınırları ---
const hoursOf = (expr) => expr.split(",").flatMap((part) => {
  const [from, to] = part.split("-").map(Number);
  return Number.isInteger(to) ? Array.from({ length: to - from + 1 }, (_, i) => from + i) : [from];
});
const runsPerDay = (file) => {
  const text = read(file);
  const crons = [...text.matchAll(/- cron: ["']([^"']+)["']/g)].map((m) => m[1]);
  return crons.reduce((sum, cron) => {
    const [minute, hour, dom, mon, dow] = cron.split(/\s+/);
    if (minute.startsWith("*") || dom !== "*" || mon !== "*") return sum + 1000; // bilinmeyen biçim → reddet
    const hours = hour === "*" ? 24 : hoursOf(hour).length;
    return sum + hours;
  }, 0);
};
expect(runsPerDay(".github/workflows/match-analysis.yml") <= 21, `match-analysis günlük koşu ≤ 21 (şimdi ${runsPerDay(".github/workflows/match-analysis.yml")})`);
expect(runsPerDay(".github/workflows/daily-health-check.yml") <= 24, "sağlık kontrolü günde en çok 24 koşu");
expect(!/cron: "\d+ \* \* \* \*"/.test(read(".github/workflows/match-analysis.yml")), "match-analysis'te saatte-bir joker yok");

if (failures) {
  console.error(`${failures} test failed.`);
  process.exit(1);
}
console.log("workflow cost tests passed");
