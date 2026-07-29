/**
 * SUPABASE SAĞLIĞI — yapılandırma ve bağlantı durumu, ANAHTARSIZ.
 *
 * Üç ayrı soruyu ayırır, çünkü üçü farklı sebeplerle bozulur:
 *
 *   1. YAPILANDIRMA  Değişkenler tanımlı mı, doğru isimde mi, biçimi sağlam mı?
 *   2. BAĞLANTI      Adres ve anahtarla gerçekten konuşabiliyor muyuz?
 *   3. ŞEMA          Tablolar kurulu mu, RLS açık mı, kaç satır var?
 *
 * "Anahtar tanımlı" ile "anahtar çalışıyor" farklı şeyler: doğru biçimde ama
 * süresi dolmuş, yanlış projeye ait ya da yetkisi alınmış bir anahtar da
 * tanımlı görünür. Bu yüzden bağlantı ayrı ölçülür.
 *
 * HİÇBİR ANAHTAR DEĞERİ YANITA GİRMEZ. Yalnızca uzunluk, biçim geçerliliği
 * ve hangi değişken adının okunduğu raporlanır — api/health.js'deki
 * API-Football deseninin aynısı.
 */

const { describeConfig, hasAnonConfig } = require("./config.js");
const { getReadClient, isEnabled } = require("./serverClient.js");

/** Sağlığın sorduğu tablolar. Şema göçleriyle aynı liste. */
const EXPECTED_TABLES = Object.freeze([
  "teams", "players", "matches", "transfers",
  "match_reports", "analysis_rules", "radar_scores",
  "data_coverage_logs", "analysis_jobs",
  "ai_memory_documents", "ai_memory_chunks"
]);

/** Bağlantı denemesi bu süreden uzun sürerse sağlık ucu beklemez. */
const PROBE_TIMEOUT_MS = 4000;

function nowIso() {
  return new Date().toISOString();
}

/**
 * Bağlantı denemesi. Tek ve ucuz bir sorgu: en küçük tablodan tek satır.
 *
 * Hata YUTULMAZ — sağlığın işi sorunu göstermek. Ama hata mesajı sağlayıcıdan
 * geldiği gibi taşınır, başlıklar taşınmaz (anahtar oradaydı).
 */
async function probeConnection() {
  if (!isEnabled()) {
    return { attempted: false, ok: false, reason: "Supabase yapılandırılmadı" };
  }

  const client = getReadClient();
  if (!client) {
    return { attempted: false, ok: false, reason: "Okuma istemcisi kurulamadı" };
  }

  const started = Date.now();
  try {
    await client.from("analysis_rules").select({ columns: "id", limit: 1 });
    return { attempted: true, ok: true, latencyMs: Date.now() - started, reason: "" };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      latencyMs: Date.now() - started,
      reason: error && error.message ? error.message : "Bilinmeyen hata",
      code: (error && error.code) || null,
      status: (error && error.status) || null
    };
  }
}

/**
 * Tablo durumu: var mı, kaç satır?
 *
 * Bir tablo okunamıyorsa bu iki şeyden biri demek: ya kurulmamış (göç
 * çalıştırılmamış) ya da RLS onu kapatıyor. İkisi farklı sorunlar ve hata
 * kodu ayırt etmemizi sağlıyor; bu yüzden gerekçe olduğu gibi taşınıyor.
 */
async function probeTables(options = {}) {
  if (!isEnabled()) {
    return { attempted: false, tables: [], reason: "Supabase yapılandırılmadı" };
  }

  const client = getReadClient();
  if (!client) return { attempted: false, tables: [], reason: "Okuma istemcisi kurulamadı" };

  const wanted = Array.isArray(options.tables) ? options.tables : EXPECTED_TABLES;
  const tables = [];

  for (const table of wanted) {
    try {
      const count = await client.from(table).count();
      tables.push({ table, reachable: true, rows: count, reason: "" });
    } catch (error) {
      tables.push({
        table,
        reachable: false,
        rows: null,
        reason: (error && error.message) || "okunamadı",
        code: (error && error.code) || null
      });
    }
  }

  return { attempted: true, tables, reason: "" };
}

/**
 * RLS durumu. 0005 göçündeki rls_status() fonksiyonunu çağırır.
 *
 * "Kurdum sanıyordum" ile "kurulu" arasındaki farkı ölçer: politikası olmayan
 * ama RLS'i açık bir tablo okunamaz; RLS'i kapalı bir tablo ise herkese açıktır
 * ve bu ikincisi sessiz bir felakettir.
 */
async function probeRls() {
  if (!isEnabled()) return { attempted: false, rows: [], reason: "Supabase yapılandırılmadı" };

  const client = getReadClient();
  if (!client) return { attempted: false, rows: [], reason: "Okuma istemcisi kurulamadı" };

  try {
    const rows = await client.rpc("rls_status", {});
    const list = Array.isArray(rows) ? rows : [];
    return {
      attempted: true,
      rows: list,
      // RLS'i kapalı tablo varsa bu bir uyarıdır, bir ayrıntı değil.
      unprotected: list.filter((row) => row && row.rls_enabled === false).map((row) => row.table_name),
      reason: ""
    };
  } catch (error) {
    return {
      attempted: true,
      rows: [],
      unprotected: [],
      reason: (error && error.message) || "rls_status() çağrılamadı — 0005 göçü uygulanmamış olabilir"
    };
  }
}

/**
 * Tam sağlık raporu.
 *
 * @param {{probe?: boolean, tables?: Array<string>}} [options]
 *   `probe` verilmezse yalnızca yapılandırma raporlanır ve AĞA ÇIKILMAZ —
 *   her sağlık isteğinin veritabanına gitmesi gereksiz yük olurdu.
 */
async function supabaseHealth(options = {}) {
  const config = describeConfig();

  const report = {
    checkedAt: nowIso(),
    // Üç durumdan biri: yapılandırılmadı / hazır ama denenmedi / denendi.
    mode: config.configured ? "configured" : "not-configured",
    config,
    // Bu satır kritik: servis anahtarı "public" ön ekli bir adla tanımlanmışsa
    // yapılandırma baştan yanlıştır ve bunu sessizce geçmemek gerekir.
    warnings: []
  };

  if (config.serviceKey && config.serviceKey.publiclyNamed) {
    report.warnings.push(
      "Servis anahtarı 'NEXT_PUBLIC_'/'PUBLIC_' ön ekli bir değişkende tanımlı görünüyor. " +
      "Bu ön ekler değeri istemci paketine gömmek içindir; servis anahtarı bu şekilde " +
      "adlandırılmamalıdır."
    );
  }

  if (!hasAnonConfig()) {
    report.warnings.push("Anon anahtar ya da proje adresi tanımlı değil; okuma istemcisi kurulamaz.");
  }

  if (!options.probe) {
    report.connection = { attempted: false, ok: false, reason: "Denenmedi (?probe=1 ile denenir)" };
    return report;
  }

  report.connection = await probeConnection();

  if (report.connection.ok) {
    report.schema = await probeTables(options);
    report.rls = await probeRls();

    const missing = (report.schema.tables || []).filter((row) => !row.reachable).map((row) => row.table);
    if (missing.length) {
      report.warnings.push(
        `Okunamayan tablo: ${missing.join(", ")}. Göçler uygulanmamış ya da RLS erişimi kapatıyor olabilir.`
      );
    }
    if (report.rls.unprotected && report.rls.unprotected.length) {
      report.warnings.push(
        `RLS KAPALI tablo: ${report.rls.unprotected.join(", ")}. Bu tablolar anon anahtarla herkese açıktır.`
      );
    }
  }

  return report;
}

module.exports = {
  EXPECTED_TABLES,
  PROBE_TIMEOUT_MS,
  probeConnection,
  probeRls,
  probeTables,
  supabaseHealth
};
