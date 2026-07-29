/**
 * SUPABASE KATMANI TESTLERİ
 *
 * EN ÖNEMLİ İDDİA: SERVİS ANAHTARI TARAYICIYA ULAŞAMAZ.
 *
 * Servis anahtarı satır düzeyi güvenliği tamamen baypas eder; tarayıcıya
 * ulaşması veritabanını internete açmakla aynı şeydir. Bu yüzden koruma tek
 * katman değil, üç katman ve üçü de burada ölçülüyor:
 *
 *   1. config.js/serverClient.js tarayıcı ortamında AÇIKÇA patlar.
 *   2. Tarayıcıya giden hiçbir dosya bu modülleri require etmez.
 *   3. Yayımlanan çıktının tamamında ne anahtar ADI ne de JWT biçiminde bir
 *      değer geçer.
 *
 * Diğer sözleşmeler:
 *   • Yapılandırma yokken hiçbir şey çökmez; katman "kapalı" der.
 *   • Hiçbir fonksiyon anahtar DEĞERİNİ döndürmez.
 *   • Filtresiz güncelleme/silme reddedilir.
 *   • Göç dosyaları RLS'i her tabloda açar.
 *   • Şema kısıtları uygulama kurallarıyla aynı şeyi söyler.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import {
  JWT_PATTERN,
  SECRET_KEY_PATTERN,
  scanPublishedOutput
} from "./lib/publishedSecretScan.mjs";

const require = createRequire(import.meta.url);
const root = process.cwd();

const config = require("../services/supabase/config.js");
const { SupabaseError, buildQuery, createClient } = require("../services/supabase/restClient.js");
const serverClient = require("../services/supabase/serverClient.js");
const { createBrowserClient } = require("../services/supabase/browserClient.js");
const {
  EXPECTED_TABLES,
  PROBE_TIMEOUT_MS,
  supabaseHealth,
  withBudget
} = require("../services/supabase/health.js");
const repositories = require("../services/supabase/repositories.js");

const MIGRATIONS_DIR = path.join(root, "supabase", "migrations");

/**
 * SERVİS ANAHTARI YAYIMLANAN ÇIKTIYA SIZMAMALI.
 *
 * Tarama artık scripts/lib/publishedSecretScan.mjs içinde yaşıyor ve DERLEME
 * ZİNCİRİ de aynı taramayı çağırıyor (scripts/verify-published-secrets.mjs).
 * Sebep: testler `npm run build` ve Vercel dağıtımının parçası değil, yani
 * tarama yalnızca burada dursaydı sızıntının gerçekten olabileceği tek yerde —
 * anahtarların tanımlı olduğu üretim derlemesinde — hiç çalışmazdı.
 *
 * Bu test o taramanın SÖZLEŞMESİNİ korur: çıktı temiz mi ve tarayıcı
 * gerçekten bir şeye bakıyor mu.
 */
function testServiceKeyNeverReachesTheBrowser() {
  const { files, problems } = scanPublishedOutput(root);

  assert.ok(files > 5, "ön koşul: taranacak yayımlanmış dosya olmalı");
  assert.deepEqual(problems, [], `yayımlanan çıktıda sır bulundu:\n- ${problems.join("\n- ")}`);

  // Tarayıcının gerçekten bir şeye baktığını kanıtla: sızıntı örneği
  // yakalanmıyorsa yukarıdaki "temiz" bir şey ifade etmez.
  const leak = `SUPABASE_SERVICE_ROLE_KEY = ey${"a".repeat(20)}.ey${"b".repeat(20)}.${"c".repeat(20)}`;
  assert.ok(JWT_PATTERN.test(leak), "JWT deseni örnek sızıntıyı yakalamalı");
  assert.ok(
    config.SERVICE_KEY_ENV_NAMES.some((name) => leak.includes(name)),
    "değişken adı listesi örnek sızıntıyı yakalamalı"
  );
  assert.ok(SECRET_KEY_PATTERN.test("sb_secret_abcdefghijklmno"), "sb_secret_ deseni yakalamalı");
}

/** Derleme zinciri sır taramasını gerçekten koşturmalı. */
function testSecretScanRunsInTheBuildChain() {
  const build = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).scripts.build;
  assert.ok(
    build.includes("scripts/verify-published-secrets.mjs"),
    'sır taraması package.json "build" zincirinde koşmalı — aksi hâlde üretimde hiç çalışmaz'
  );

  // Sıra da önemli: tarama, çıktıyı DEĞİŞTİREN son adımdan sonra gelmeli.
  assert.ok(
    build.indexOf("scripts/verify-published-secrets.mjs") > build.indexOf("npm run postprocess"),
    "sır taraması son işlemlerden SONRA koşmalı; erken koşarsa sonraki adımın sızdırdığını göremez"
  );
}

/** Tarayıcıya giden istemci betiği Supabase sunucu modüllerini çağırmamalı. */
function testClientBundleDoesNotImportServerModules() {
  const appJs = path.join(root, "app.js");
  if (!fs.existsSync(appJs)) return;
  const content = fs.readFileSync(appJs, "utf8");

  for (const forbidden of ["supabase/serverClient", "supabase/repositories", "readServiceKey"]) {
    assert.ok(!content.includes(forbidden), `app.js sunucu modülüne dokunuyor: ${forbidden}`);
  }
}

/** Servis anahtarı okuma denemesi tarayıcı ortamında PATLAMALI. */
function testServiceKeyReadThrowsInBrowser() {
  const original = globalThis.window;
  globalThis.window = {};
  try {
    assert.throws(() => config.readServiceKey(), /tarayıcıda okunamaz/i,
      "tarayıcı ortamında servis anahtarı okuması patlamalı");
    assert.throws(() => serverClient.getServiceClient(), /tarayıcıda kullanılamaz/i,
      "tarayıcı ortamında servis istemcisi kurulmamalı");
    assert.equal(config.hasServiceConfig(), false, "tarayıcıda servis yapılandırması yok sayılmalı");
    assert.equal(serverClient.isEnabled(), false, "tarayıcıda katman kapalı olmalı");
  } finally {
    if (original === undefined) delete globalThis.window;
    else globalThis.window = original;
    serverClient.resetClients();
  }
}

/** Tarayıcı istemcisine gizli anahtar verilirse reddetmeli. */
function testBrowserClientRejectsSecretKey() {
  assert.throws(
    () => createBrowserClient({ url: "https://ornek.supabase.co", anonKey: "sb_secret_abcdefghijkl" }),
    /servis \(secret\) anahtarı/i,
    "tarayıcı istemcisi gizli anahtarı reddetmeli"
  );

  // Anon anahtarla kurulabilmeli.
  const client = createBrowserClient({ url: "https://ornek.supabase.co", anonKey: "sb_publishable_abcdefghijkl" });
  assert.equal(typeof client.select, "function");
  assert.equal(client.rpc !== undefined, true);
  // Yazma yüzeyi HİÇ açılmamalı.
  assert.equal(client.insert, undefined, "tarayıcı istemcisinde yazma yüzeyi olmamalı");
  assert.equal(client.upsert, undefined);
  assert.equal(client.update, undefined);
}

/** Hiçbir fonksiyon anahtar DEĞERİNİ döndürmemeli. */
function testDescribeConfigNeverLeaksValues() {
  const previous = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const previousAnon = process.env.SUPABASE_ANON_KEY;
  const secret = "eyTESTHEADERvalue1234.eyTESTPAYLOADvalue1234.eyTESTSIGNATURE12345";

  process.env.SUPABASE_SERVICE_ROLE_KEY = secret;
  process.env.SUPABASE_ANON_KEY = secret;
  try {
    const described = JSON.stringify(config.describeConfig());
    assert.ok(!described.includes(secret), "describeConfig anahtar değerini sızdırmamalı");
    assert.ok(described.includes("SUPABASE_SERVICE_ROLE_KEY"), "hangi değişkenin okunduğu raporlanmalı");
    // Uzunluk raporlanabilir; değer raporlanamaz.
    assert.ok(described.includes(`"length":${secret.length}`), "biçim bilgisi taşınmalı");
  } finally {
    if (previous === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previous;
    if (previousAnon === undefined) delete process.env.SUPABASE_ANON_KEY;
    else process.env.SUPABASE_ANON_KEY = previousAnon;
  }
}

/** "PUBLIC" ön ekli servis anahtarı UYARI üretmeli. */
function testPubliclyNamedServiceKeyIsFlagged() {
  process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY = "eyAAAA.eyBBBB.eyCCCC";
  try {
    assert.equal(config.describeConfig().serviceKey.publiclyNamed, true,
      "public ön ekli servis anahtarı işaretlenmeli");
  } finally {
    delete process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;
  }
}

/** Yapılandırma yokken katman çökmez, "kapalı" der. */
async function testDegradesWithoutConfiguration() {
  serverClient.resetClients();
  assert.equal(serverClient.getServiceClient(), null, "yapılandırma yokken servis istemcisi null");
  assert.equal(serverClient.getReadClient(), null, "yapılandırma yokken okuma istemcisi null");
  assert.equal(serverClient.isEnabled(), false);

  // Depolar çökmez, atlandığını söyler.
  for (const save of [repositories.saveTeams, repositories.savePlayers,
    repositories.saveMatches, repositories.saveTransfers]) {
    const result = await save([]);
    assert.equal(result.skipped, true, "yapılandırma yokken yazma atlanmalı");
  }

  const health = await supabaseHealth({ probe: true });
  assert.equal(health.mode, "not-configured");
  assert.equal(health.connection.ok, false);
  assert.ok(health.warnings.length, "eksik yapılandırma uyarı üretmeli");
  // Sağlık raporu asla çökmemeli.
  assert.ok(health.checkedAt, "rapor zaman damgası taşımalı");
}

/** Filtresiz güncelleme ve silme reddedilmeli. */
async function testUnfilteredWritesAreRejected() {
  const client = createClient({
    url: "https://ornek.supabase.co",
    key: "sb_publishable_test",
    role: "service",
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => "[]" })
  });

  await assert.rejects(() => client.from("matches").update({ status: "X" }, {}),
    /Filtresiz güncelleme reddedildi/, "filtresiz güncelleme geçmemeli");
  await assert.rejects(() => client.from("matches").update({ status: "X" }),
    /Filtresiz güncelleme reddedildi/);
  await assert.rejects(() => client.from("matches").remove({}),
    /Filtresiz silme reddedildi/, "filtresiz silme geçmemeli");
}

/** Hata mesajı anahtarı taşımamalı. */
async function testErrorsDoNotCarryCredentials() {
  const secret = "sb_secret_leakcanary1234";
  const client = createClient({
    url: "https://ornek.supabase.co",
    key: secret,
    role: "service",
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ message: "Invalid API key", code: "PGRST301" })
    })
  });

  try {
    await client.from("teams").select();
    assert.fail("hata bekleniyordu");
  } catch (error) {
    assert.ok(error instanceof SupabaseError);
    const serialized = `${error.message} ${JSON.stringify(error)}`;
    assert.ok(!serialized.includes(secret), "hata nesnesi anahtarı taşımamalı");
    assert.equal(error.status, 401);
  }
}

/** Sorgu kurucu değerleri kaçırmalı. */
function testQueryBuilderEscapes() {
  const query = buildQuery({ select: "*", id: "eq.a b&c=d" });
  assert.ok(query.startsWith("?"), query);
  assert.ok(!query.includes("a b"), `boşluk kaçırılmalı: ${query}`);
  assert.ok(query.includes("%26") || query.includes("%2526"), `& kaçırılmalı: ${query}`);
  assert.equal(buildQuery({}), "", "boş parametre boş dize vermeli");
  assert.equal(buildQuery({ a: null, b: undefined }), "", "null/undefined atlanmalı");
}

// ── Göç dosyaları ───────────────────────────────────────────────────────────

function migrationSql() {
  assert.ok(fs.existsSync(MIGRATIONS_DIR), "göç dizini olmalı");
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith(".sql")).sort();
  assert.ok(files.length >= 5, `en az beş göç dosyası bekleniyor, ${files.length} bulundu`);
  return { files, sql: files.map((file) => fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8")).join("\n") };
}

/** İstenen her tablo göçlerde tanımlı olmalı. */
function testMigrationsDefineEveryTable() {
  const { sql } = migrationSql();
  for (const table of EXPECTED_TABLES) {
    assert.ok(
      new RegExp(`create table if not exists public\\.${table}\\b`).test(sql),
      `göçlerde eksik tablo: ${table}`
    );
  }
  // pgvector isteğe bağlı ama denenmeli.
  assert.ok(/create extension if not exists "vector"/.test(sql), "pgvector etkinleştirilmeye çalışılmalı");
  assert.ok(/vector\(1536\)/.test(sql), "gömme sütunu tanımlanmalı");
}

/**
 * RLS HER TABLODA AÇILMALI.
 *
 * RLS'i açmayı unutulan bir tablo, anon anahtarla herkese açıktır. Bu, bu
 * katmanda yapılabilecek en sessiz ve en ciddi hata.
 */
function testMigrationsEnableRlsEverywhere() {
  const { sql } = migrationSql();
  assert.ok(/enable row level security/.test(sql), "RLS açılmalı");
  assert.ok(/force row level security/.test(sql), "tablo sahibi de politikalara tabi olmalı");

  // Liste, beklenen tabloların tamamını kapsamalı.
  const rlsBlock = sql.slice(sql.indexOf("enable row level security") - 2000);
  for (const table of EXPECTED_TABLES) {
    assert.ok(rlsBlock.includes(`'${table}'`), `RLS listesinde eksik tablo: ${table}`);
  }

  // Anon'a YAZMA politikası yazılmamalı.
  assert.ok(
    !/create policy[\s\S]{0,200}for (insert|update|delete)[\s\S]{0,80}to anon/i.test(sql),
    "anon rolüne yazma politikası tanımlanmamalı"
  );
}

/** Şema kısıtları uygulama kurallarıyla aynı şeyi söylemeli. */
function testSchemaMirrorsApplicationRules() {
  const { sql } = migrationSql();

  // Rapor durumları services/matchReportStages.js ile aynı olmalı.
  const { REPORT_STATUS } = require("../services/matchReportStages.js");
  for (const status of Object.values(REPORT_STATUS)) {
    assert.ok(sql.includes(`'${status.key}'`), `şema rapor durumunu tanımıyor: ${status.key}`);
  }

  // Skor ya tam gelir ya hiç.
  assert.ok(/\(home_score is null\) = \(away_score is null\)/.test(sql),
    "yarım skoru reddeden kısıt olmalı");

  // Kaynağı olmayan transfer kesinleşmiş sayılamaz.
  assert.ok(/transfers_confirmed_needs_source/.test(sql), "kaynaksız onaylı transfer kısıtı olmalı");
  assert.ok(/transfers_rumour_is_not_confirmed/.test(sql), "söylenti kısıtı olmalı");

  // Kapsamı sıfır olan puan olamaz.
  assert.ok(/radar_scores_zero_coverage_has_no_score/.test(sql), "kapsamsız puan kısıtı olmalı");

  // Yer tutucu sağlayıcı kimliği veritabanına girmemeli.
  assert.ok(/players_provider_id_numeric/.test(sql), "sağlayıcı kimliği kısıtı olmalı");
}

/**
 * Takılı maç görünümü tanımlı VE OKUNABİLİR olmalı — sözün ölçüsü.
 *
 * Görünümün metinde var olması yetmiyordu: `security_invoker` olmadan
 * tanımlanmış bir görünüm SAHİBİNİN yetkisiyle çalışır ve 0005'in `force row
 * level security` uyguladığı tablolar üzerinde, gerçek durumdan bağımsız
 * olarak boş dönebilir. Boş dönen bir takılı-maç listesi "takılı maç yok"
 * diye okunur; ölçülmemiş bir sonucu ölçüm gibi sunmak tam olarak budur.
 */
function testStuckMatchViewExists() {
  const { sql } = migrationSql();
  assert.ok(/create or replace view public\.stuck_matches/.test(sql), "takılı maç görünümü olmalı");
  assert.ok(/full-processing/.test(sql), "görünüm takılı durumu tanımalı");

  assert.ok(
    /create or replace view public\.stuck_matches\s*\nwith \(security_invoker = true\)/.test(sql),
    "görünüm sorgulayanın kimliğiyle çalışmalı (security_invoker)"
  );
  assert.ok(
    /alter view public\.stuck_matches set \(security_invoker = true\)/.test(sql),
    "önceden kurulmuş veritabanları için de security_invoker uygulanmalı"
  );
}

/** Satır eşlemeleri şema kısıtlarını ihlal etmemeli. */
function testRowMappersRespectConstraints() {
  // Yarım skor gönderilmemeli.
  const half = repositories.matchRow({
    id: "x", homeTeam: "A", awayTeam: "B", score: { home: 2, away: null }
  });
  assert.equal(half.home_score, null, "yarım skor tam skor gibi yazılmamalı");
  assert.equal(half.away_score, null);

  const full = repositories.matchRow({
    id: "y", homeTeam: "A", awayTeam: "B", score: { home: 2, away: 1 }
  });
  assert.equal(full.home_score, 2);
  assert.equal(full.away_score, 1);

  // Yer tutucu sağlayıcı kimliği yazılmamalı.
  const mock = repositories.playerRow({ id: "p", name: "X", providerId: "mock-icardi-9" });
  assert.equal(mock.provider_id, null, "yer tutucu kimlik veritabanına gitmemeli");
  assert.equal(repositories.playerRow({ id: "p", name: "X", providerId: "276" }).provider_id, "276");

  // Ölçülmemiş sayı sıfıra çevrilmemeli.
  const bare = repositories.playerRow({ id: "p", name: "X" });
  assert.equal(bare.goals, null, "ölçülmemiş gol sayısı sıfır olmamalı");
  assert.equal(bare.minutes_played, null);
}

/** Radar satırı kapsamsız puan üretmemeli. */
function testRadarRowKeepsCoverageContract() {
  const row = repositories.radarScoreRow(
    { id: "z", homeTeam: "A", awayTeam: "B", kickoff: "belirsiz" },
    { now: new Date("2026-07-29T20:00:00+03:00") }
  );
  assert.equal(row.score, null, "gösterilemeyen maça puan yazılmamalı");
  assert.equal(row.coverage, 0);
}

/**
 * SORGU BÜTÇESİ YAZILI DEĞİL, UYGULANMIŞ OLMALI.
 *
 * PROBE_TIMEOUT_MS uzun süre yalnızca tanımlıydı ve bir yorumla GARANTİ diye
 * anlatılıyordu; hiçbir yerde kullanılmıyordu. Kodun uygulamadığı bir sınırı
 * anlatan yorum, olmayan bir korumayı varmış gibi gösterir. Bu test iki şeyi
 * birden korur: bütçe gerçekten yarışa giriyor mu ve sabit gerçekten
 * uygulamada okunuyor mu.
 */
async function testProbeBudgetIsEnforced() {
  assert.equal(typeof PROBE_TIMEOUT_MS, "number");
  assert.ok(PROBE_TIMEOUT_MS > 0, "bütçe pozitif bir süre olmalı");

  // Zamanında biten söz kendi değerini döndürür.
  assert.equal(await withBudget(Promise.resolve("bitti"), 1000, "bütçe"), "bitti");

  // Bitmeyen söz bütçeye takılır ve yedek değer döner — beklemeye devam etmez.
  const never = new Promise(() => {});
  const started = Date.now();
  assert.equal(await withBudget(never, 20, "bütçe doldu"), "bütçe doldu");
  assert.ok(Date.now() - started < 1000, "bütçe dolduğunda beklenmemeli");

  // Sabit gerçekten uygulamada okunuyor mu? Tanım ve dışa aktarım dışında en
  // az bir kullanım olmalı; yoksa "uygulanıyor" iddiası yine boşa düşer.
  const source = fs.readFileSync(path.join(root, "services/supabase/health.js"), "utf8");
  const uses = source.split("PROBE_TIMEOUT_MS").length - 1;
  assert.ok(uses >= 3, `PROBE_TIMEOUT_MS uygulamada kullanılmalı (bulunan: ${uses} geçiş)`);

  // Sağlık ucu da dış bir sınır koymalı: rapor üretmesi gereken uç, raporsuz
  // düşen bir isteğe dönüşmemeli.
  const route = fs.readFileSync(path.join(root, "api/[...route].js"), "utf8");
  assert.ok(
    /withTimeout\(\s*\n?\s*supabaseHealth\(/.test(route),
    "handleSupabaseHealth withTimeout ile sarılmalı"
  );
}

/** Beklenen tablo listesi göçlerle aynı olmalı. */
function testExpectedTablesMatchMigrations() {
  const { sql } = migrationSql();
  const declared = [...sql.matchAll(/create table if not exists public\.(\w+)/g)].map((match) => match[1]);
  for (const table of declared) {
    assert.ok(EXPECTED_TABLES.includes(table), `sağlık listesinde eksik tablo: ${table}`);
  }
}


/**
 * SENKRONUN YAZDIĞI DEĞERLER ŞEMANIN TANIDIĞI DEĞERLER OLMALI.
 *
 * Bu sınıf hatanın tamamı üretimde ortaya çıkar: Supabase yapılandırılmadan
 * hiçbir şey yazılmadığı için yerelde ve CI'da sessiz kalır, anahtar
 * tanımlandığı ilk gün yazma hatasına döner.
 *
 * Denetim (bu turda): senkron `severity: "error"` yazıyordu; şema yalnızca
 * info/warning/blocking tanıyor.
 */
function testSyncValuesMatchSchemaConstraints() {
  const sync = fs.readFileSync(path.join(root, "scripts", "sync-supabase.mjs"), "utf8");
  const { sql } = migrationSql();

  const allowed = (constraint) => {
    const match = sql.match(new RegExp(`${constraint}[\\s\\S]*?in \\(([^)]+)\\)`));
    assert.ok(match, `şemada kısıt bulunamadı: ${constraint}`);
    return match[1].split(",").map((value) => value.trim().replace(/^'|'$/g, ""));
  };

  const severities = allowed("data_coverage_severity_known");
  for (const [, value] of sync.matchAll(/severity:\s*"([^"]+)"/g)) {
    assert.ok(
      severities.includes(value),
      `senkron tanınmayan severity yazıyor: "${value}" (şema: ${severities.join(", ")})`
    );
  }

  // Aynı denetim depolar için de: rapor durumu ve güven değerleri.
  const repositoriesSource = fs.readFileSync(
    path.join(root, "services", "supabase", "repositories.js"), "utf8");
  const confidences = allowed("radar_scores_confidence_known");
  for (const [, value] of repositoriesSource.matchAll(/confidence:\s*"([^"]+)"/g)) {
    assert.ok(confidences.includes(value), `tanınmayan confidence: "${value}"`);
  }
}

const tests = [
  testServiceKeyNeverReachesTheBrowser,
  testSyncValuesMatchSchemaConstraints,
  testSecretScanRunsInTheBuildChain,
  testClientBundleDoesNotImportServerModules,
  testServiceKeyReadThrowsInBrowser,
  testBrowserClientRejectsSecretKey,
  testDescribeConfigNeverLeaksValues,
  testPubliclyNamedServiceKeyIsFlagged,
  testDegradesWithoutConfiguration,
  testUnfilteredWritesAreRejected,
  testErrorsDoNotCarryCredentials,
  testQueryBuilderEscapes,
  testMigrationsDefineEveryTable,
  testMigrationsEnableRlsEverywhere,
  testSchemaMirrorsApplicationRules,
  testStuckMatchViewExists,
  testRowMappersRespectConstraints,
  testRadarRowKeepsCoverageContract,
  testProbeBudgetIsEnforced,
  testExpectedTablesMatchMigrations
];

for (const test of tests) {
  await test();
}

console.log(`Supabase layer tests passed (${tests.length} senaryo: anahtar sızıntısı yok, derleme kapısı, istemci ayrımı, ` +
  "tarayıcı koruması, gizli anahtar reddi, değer sızdırmayan rapor, public ön ek uyarısı, " +
  "yapılandırmasız çalışma, filtresiz yazma reddi, temiz hata, sorgu kaçışı, tablo tanımları, " +
  "RLS kapsaması, şema-uygulama eşliği, takılı maç görünümü, satır eşlemeleri, kapsam sözleşmesi).");
