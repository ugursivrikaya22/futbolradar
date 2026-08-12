/**
 * OTOMATİK BANT BAKIMI TESTLERİ (scripts/refresh-news-ticker.mjs)
 *
 * Betiğin işi bandı TAZE TUTMAK, doldurmak değil. O yüzden buradaki testler
 * iki soruyu ayrı ayrı sınıyor:
 *
 *   1. Bayat olanı gerçekten atıyor mu? (tarihi geçen duyuru, raf ömrü dolan
 *      kayıt, sönmüş son dakika işareti, aynı haberin ikinci yazımı)
 *   2. Atmaması gerekeni koruyor mu? (geçerli kayıt, geçersiz ama editoryal
 *      içerik) — ve HİÇBİR KOŞULDA içerik uydurmuyor mu?
 *
 * Betik `process.cwd()` altındaki `data/` klasörünü okuduğu için testler
 * geçici bir çalışma dizininde koşuyor; depodaki gerçek veri dosyalarına
 * dokunulmuyor.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, "refresh-news-ticker.mjs");

/** Şu andan `hours` saat önce/sonra, ISO biçiminde. */
function offsetHours(hours) {
  return new Date(Date.now() + hours * 3600000).toISOString();
}

function entry(overrides = {}) {
  return {
    id: "ornek",
    category: "official",
    confidence: "confirmed",
    text: "Kulüp resmî açıklama yayımladı",
    timestamp: offsetHours(-3),
    // "official" kategorisi resmî kaynak gerektirir.
    source: { name: "Kaynak", url: "https://www.galatasaray.org/haber/ornek" },
    ...overrides
  };
}

/**
 * Betiği geçici bir çalışma dizininde koşturur.
 *
 * @returns {{status: number, stdout: string, ticker: Object}}
 */
function run({ ticker = { items: [] }, news = [], apply = true, strict = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "futbolradar-ticker-"));
  const dataDir = path.join(dir, "data");
  fs.mkdirSync(dataDir);
  fs.writeFileSync(path.join(dataDir, "news-ticker.json"), JSON.stringify(ticker, null, 2), "utf8");
  fs.writeFileSync(path.join(dataDir, "news.json"), JSON.stringify(news, null, 2), "utf8");

  const args = [SCRIPT];
  if (apply) args.push("--apply");
  if (strict) args.push("--strict");
  // `spawnSync`, çıkış kodundan bağımsız olarak her iki akışı da veriyor.
  // Uyarılar `console.warn` ile stderr'e gittiği için ikisi birlikte okunmalı:
  // betik artık geçersiz kayıtta 0 dönüyor ve `execFileSync` o durumda
  // stderr'i hiç göstermiyordu.
  const result = spawnSync(process.execPath, args, {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  const status = typeof result.status === "number" ? result.status : 1;
  const stdout = `${result.stdout || ""}${result.stderr || ""}`;

  const written = JSON.parse(fs.readFileSync(path.join(dataDir, "news-ticker.json"), "utf8"));
  fs.rmSync(dir, { recursive: true, force: true });

  return { status, stdout, ticker: written };
}

const idsOf = (payload) => (payload.items || []).map((row) => row.id);

// ── 1. Tarihi geçen duyuru banttan düşer ───────────────────────────────────
//
// "5 Ağustos'ta oynanacak" duyurusu 6 Ağustos'ta yanlıştır. Kalıcı
// duyuruların bantta süresiz asılı kalmasını engelleyen kural budur.
{
  const { ticker } = run({
    ticker: {
      items: [
        entry({ id: "gecerli", category: "fixture", expiresAt: offsetHours(48) }),
        entry({ id: "tarihi-gecmis", category: "fixture", expiresAt: offsetHours(-2) })
      ]
    }
  });

  assert.deepEqual(idsOf(ticker), ["gecerli"], "tarihi geçen duyuru dosyadan düşmeli");
}

// ── 2. Raf ömrü dolan kayıt düşer, dolmayan kalır ──────────────────────────
{
  const { ticker } = run({
    ticker: {
      items: [
        // İddianın raf ömrü 7 gün; 10 günlük iddia çoktan çürütülmüş olabilir.
        entry({
          id: "bayat-iddia",
          category: "transfer-rumour",
          confidence: "rumour",
          text: "Görüşmelerin sürdüğü öne sürüldü",
          timestamp: offsetHours(-24 * 10)
        }),
        // Varsayılan raf ömrü üç gün; resmî açıklama da bundan muaf değil.
        entry({ id: "resmi", category: "official", timestamp: offsetHours(-24 * 10) }),
        // Üç günün içindeki kayıt kalmalı.
        entry({ id: "taze-resmi", category: "official", timestamp: offsetHours(-24) })
      ]
    }
  });

  assert.deepEqual(
    idsOf(ticker),
    ["taze-resmi"],
    "üç günden eski her kayıt düşmeli — resmî açıklama da dahil"
  );
}

// ── 3. Son dakika işareti DOSYADAN da söner ────────────────────────────────
//
// Yalnızca ekranda gizlemek yetmez: dosya "bu son dakika" demeye devam
// ederse iddia her okumada yeniden canlanır.
{
  const { ticker } = run({
    ticker: {
      items: [
        entry({ id: "taze-son-dakika", text: "Galatasaray kadro kararını duyurdu", breaking: true, timestamp: offsetHours(-2) }),
        entry({ id: "sonmus", text: "Fenerbahçe stat düzenlemesini paylaştı", breaking: true, timestamp: offsetHours(-30) }),
        entry({ id: "suren-gelisme", text: "Trabzonspor kongre takvimini yayımladı", breaking: true, developing: true, timestamp: offsetHours(-30) })
      ]
    }
  });

  const byId = Object.fromEntries(ticker.items.map((row) => [row.id, row]));

  assert.equal(byId["taze-son-dakika"].breaking, true, "24 saat içindeki işaret korunmalı");
  assert.equal(byId["sonmus"].breaking, undefined, "penceresi dolan işaret dosyadan silinmeli");
  assert.equal(byId["sonmus"].developing, undefined, "sönen işaretle birlikte developing de gitmeli");
  assert.equal(byId["suren-gelisme"].breaking, true, "gelişme sürüyorsa işaret korunmalı");

  // Kayıt DÜŞMEZ, yalnızca rütbe iner: haber hâlâ doğru.
  assert.equal(ticker.items.length, 3, "rütbesi inen kayıt banttan atılmamalı");
}

// ── 4. Aynı haberin ikinci yazımı elenir ───────────────────────────────────
{
  const { ticker } = run({
    ticker: {
      items: [
        entry({
          id: "iddia-surumu",
          category: "transfer-rumour",
          confidence: "rumour",
          text: "Galatasaray'ın Jamal Musiala iddialarını yalanladığı öne sürüldü"
        }),
        entry({
          id: "resmi-surum",
          category: "official",
          confidence: "confirmed",
          text: "Galatasaray, Jamal Musiala iddialarını resmen yalanladı"
        })
      ]
    }
  });

  assert.deepEqual(idsOf(ticker), ["resmi-surum"], "doğrulanmış sürüm kalmalı, iddia sürümü elenmeli");
}

// ── 5. Sıra editoryal: dört büyükler önce ──────────────────────────────────
//
// Dosyadaki sıra ile ekrandaki sıra ayrışırsa dosyayı açan kişi yanılır.
{
  const { ticker } = run({
    ticker: {
      items: [
        entry({ id: "avrupa", team: "Real Madrid", text: "Real Madrid duyuru yaptı", timestamp: offsetHours(-1) }),
        entry({ id: "sonradan", team: "Samsunspor", text: "Samsunspor duyuru yaptı", timestamp: offsetHours(-2) }),
        entry({ id: "dort-buyukler", team: "Trabzonspor", text: "Trabzonspor duyuru yaptı", timestamp: offsetHours(-5) })
      ]
    }
  });

  assert.deepEqual(
    idsOf(ticker),
    ["dort-buyukler", "sonradan", "avrupa"],
    "sıra tazeliğe değil editoryal rütbeye göre olmalı"
  );
}

// ── 6. data/news.json bandı besler ─────────────────────────────────────────
//
// Editör TEK dosya günceller, bant peşinden gelir. Ana sayfadaki haber
// ızgarası ile bandın çelişmesi böylece yapısal olarak imkânsızlaşır.
{
  const { ticker } = run({
    news: [
      {
        id: "resmi-aciklama",
        title: "Kulüp kadro açıklaması yaptı",
        publishedAt: offsetHours(-4),
        url: "https://example.com/kulup",
        sourceName: "Kulüp",
        status: "verified",
        team: "Beşiktaş",
        ticker: { category: "official", confidence: "confirmed" }
      },
      // `ticker` bloğu olmayan doğrulanmış haber banda GİRMEZ: güven
      // seviyesini tahmin etmek tam olarak önlemeye çalıştığımız şey.
      {
        id: "blogsuz",
        title: "Bant bloğu olmayan haber",
        publishedAt: offsetHours(-4),
        url: "https://example.com/diger",
        sourceName: "Kaynak",
        status: "verified"
      },
      // Doğrulanmamış haber hiçbir koşulda geçmez.
      {
        id: "dogrulanmamis",
        title: "Doğrulanmamış haber",
        publishedAt: offsetHours(-4),
        url: "https://example.com/taslak",
        sourceName: "Kaynak",
        status: "draft",
        ticker: { category: "official", confidence: "confirmed" }
      }
    ]
  });

  assert.deepEqual(idsOf(ticker), ["news-resmi-aciklama"], "yalnızca ticker bloğu taşıyan doğrulanmış haber yansımalı");
  assert.equal(ticker.items[0].origin, "news.json", "yansıtılan kayıt kaynağıyla işaretlenmeli");
  assert.equal(ticker.items[0].team, "Beşiktaş", "takım bilgisi haberden taşınmalı");
}

// ── 7. Yansıtılan kayıtlar her koşuda YENİDEN üretilir ─────────────────────
//
// Haber kaydı düzenlendiğinde ya da silindiğinde bandın peşinden gelmesi
// gerekir; eski kopya dosyada kalırsa bant haber ızgarasıyla çelişir.
{
  const stale = {
    id: "news-silinmis",
    origin: "news.json",
    category: "official",
    confidence: "confirmed",
    text: "Artık var olmayan haber",
    timestamp: offsetHours(-4),
    source: { name: "Kaynak", url: "https://example.com/eski" }
  };

  const { ticker } = run({ ticker: { items: [stale, entry({ id: "elle-yazilmis" })] }, news: [] });

  assert.deepEqual(idsOf(ticker), ["elle-yazilmis"], "kaynağı kalmayan yansıma silinmeli, elle yazılmış kayıt korunmalı");
}

// ── 8. İÇERİK UYDURMAZ ─────────────────────────────────────────────────────
//
// Bandın en kritik sözleşmesi. Kaynak boşalırsa betik boş bırakır; bandın
// "son doğrulanmış içeriği koru" yedeği (scripts/lib/tickerFeed.mjs) devreye
// girer ve okuyucu gerçek ama eski bir başlık görür, sahte bir "son dakika"
// görmez.
{
  const { ticker, stdout } = run({ ticker: { items: [] }, news: [] });

  assert.deepEqual(ticker.items, [], "kaynak boşken uydurma kayıt üretilmemeli");
  assert.ok(/UYARI/.test(stdout), "boş bant sessizce geçilmemeli, uyarı basılmalı");
}

// ── 9. Geçersiz kayıt SİLİNMEZ, bildirilir ─────────────────────────────────
//
// Silmek editoryal içeriği kimse bakmadan yok eder; bırakmak testte kırmızı
// yanar ve düzeltilir.
{
  const broken = { id: "bozuk", category: "official", text: "Güven alanı olmayan kayıt", timestamp: offsetHours(-2) };
  const { ticker, status, stdout } = run({ ticker: { items: [broken, entry({ id: "saglam" })] } });

  assert.ok(idsOf(ticker).includes("bozuk"), "geçersiz kayıt dosyada kalmalı");
  assert.ok(idsOf(ticker).includes("saglam"), "geçerli kayıt etkilenmemeli");
  assert.ok(/GEÇERSİZ/.test(stdout), "gerekçe günlüğe düşmeli");

  // Dağıtım hattında koşu DÜŞMEZ: tek bir editoryal yazım hatası ilgisiz her
  // dağıtımı bloke etmemeli. Geçersiz kayıt zaten banda giremiyor ve asıl
  // kapı test aşamasında (scripts/test-news-ticker.mjs).
  assert.equal(status, 0, "varsayılan koşu geçersiz kayıt yüzünden düşmemeli");

  const strictRun = run({ ticker: { items: [broken] }, strict: true });
  assert.equal(strictRun.status, 1, "--strict ile geçersiz kayıt koşuyu düşürmeli");
}

// ── 10. Kuru koşu yazmaz ───────────────────────────────────────────────────
{
  const items = [entry({ id: "tarihi-gecmis", category: "fixture", expiresAt: offsetHours(-2) })];
  const { ticker } = run({ ticker: { items }, apply: false });

  assert.deepEqual(idsOf(ticker), ["tarihi-gecmis"], "--apply olmadan dosya değişmemeli");
}

console.log("Bant tazeleme testleri geçti (expiresAt, raf ömrü, son dakika sönümü, tekleştirme, editoryal sıra, news.json aynası, uydurma yasağı, kuru koşu).");
