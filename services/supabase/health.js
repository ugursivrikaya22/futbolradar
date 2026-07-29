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

/**
 * SORGU BÜTÇESİ — sağlık ucu bu süreden uzun beklemez.
 *
 * Bu sabit bir süre yalnızca YAZILIYDI, hiçbir yerde uygulanmıyordu: gerçek
 * zaman aşımı restClient'ın istek BAŞINA uyguladığı 6 saniyeydi ve tablolar
 * sırayla sorgulanıyordu. On bir tablo, en kötü durumda altmış saniyeden uzun
 * sürebiliyordu — yani "sağlık ucu beklemez" cümlesi kodun uygulamadığı bir
 * sınırı anlatıyordu. Sunucusuz işlev süre sınırını aşan bir sağlık ucu ise
 * "sorunu bildirmek onun işi" sözünü boşa çıkarır: kendisi sorun olur.
 *
 * Artık bütçe GERÇEKTEN uygulanıyor ve TOPLAM: bağlantı denemesi ve tablo
 * taraması bu süreyi birlikte paylaşır. Bütçe dolduğunda yanıtı gelmemiş
 * tablolar SESSİZCE DÜŞMEZ — `reachable: null` ile "ölçülemedi" olarak
 * işaretlenir. "Okunamadı" ile "ölçülemedi" farklı cevaplardır; ikisini
 * birleştirmek, ölçmediğimiz bir tabloyu bozuk ilan etmek olurdu.
 */
const PROBE_TIMEOUT_MS = 4000;

function nowIso() {
  return new Date().toISOString();
}

/**
 * Verilen sürede bitmezse `fallback` ile dönen yarış.
 *
 * Söz İPTAL EDİLMEZ — JavaScript'te bir sözü iptal etmenin yolu yok; yarışı
 * kaybeden istek arka planda sürer ve sonucu yok sayılır. Önemli olan
 * ÇAĞIRANIN beklememesi.
 *
 * Zamanlayıcı `unref` EDİLMEZ: unref'lenmiş bir zamanlayıcı olay döngüsünü
 * ayakta tutmaz, dolayısıyla başka iş kalmadığında hiç ateşlenmez ve bütçe
 * sessizce çalışmaz olurdu — yani tam olarak düzeltmeye çalıştığımız hata.
 * Yarış bittiği anda `finally` zamanlayıcıyı zaten temizliyor.
 */
function withBudget(promise, budgetMs, fallback) {
  let timer = null;
  const budget = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), Math.max(0, budgetMs));
  });
  return Promise.race([promise, budget]).finally(() => clearTimeout(timer));
}

/**
 * Bağlantı denemesi. Tek ve ucuz bir sorgu: kural tablosundan tek satır.
 *
 * Tablo seçimi boyuta göre değil ERİŞİLEBİLİRLİĞE göre: `analysis_rules`
 * her kurulumda dolu olması beklenen ve anon'a okumaya açık tek tablo, yani
 * "bağlanabiliyor muyuz?" sorusunu en az başka sebeple bulandıran seçenek.
 * `limit: 1` sayesinde satır sayısı sorgunun maliyetini değiştirmiyor.
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
 *
 * SORGULAR PARALEL. On bir tabloyu sırayla sormak, tek bir yavaş tablonun
 * kalan onunu da beklettiği anlamına geliyordu; oysa bunlar birbirinden
 * bağımsız sayım sorguları. Paralel çalışınca toplam süre en yavaş tablonun
 * süresi kadar oluyor ve bütçe gerçekten bir üst sınır hâline geliyor.
 */
async function probeTables(options = {}) {
  if (!isEnabled()) {
    return { attempted: false, tables: [], reason: "Supabase yapılandırılmadı" };
  }

  const client = getReadClient();
  if (!client) return { attempted: false, tables: [], reason: "Okuma istemcisi kurulamadı" };

  const wanted = Array.isArray(options.tables) ? options.tables : EXPECTED_TABLES;
  const budgetMs = Number.isFinite(options.budgetMs) ? options.budgetMs : PROBE_TIMEOUT_MS;

  // Başlangıç değeri "ölçülemedi": bütçe dolduğunda yanıtı gelmemiş tablo bu
  // hâliyle kalır. Sessizce listeden düşseydi, sorulmamış bir tablo sorunsuz
  // görünürdü.
  const results = new Map(wanted.map((table) => [table, {
    table,
    reachable: null,
    rows: null,
    reason: `ölçülemedi: sorgu bütçesi (${budgetMs} ms) doldu`
  }]));

  const queries = wanted.map(async (table) => {
    try {
      const count = await client.from(table).count();
      results.set(table, { table, reachable: true, rows: count, reason: "" });
    } catch (error) {
      results.set(table, {
        table,
        reachable: false,
        rows: null,
        reason: (error && error.message) || "okunamadı",
        code: (error && error.code) || null
      });
    }
  });

  const completed = await withBudget(Promise.all(queries).then(() => true), budgetMs, false);

  return {
    attempted: true,
    tables: wanted.map((table) => results.get(table)),
    budgetMs,
    budgetExhausted: !completed,
    reason: ""
  };
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

  // BÜTÇE TOPLAM. Bağlantı denemesi ne kadar sürdüyse tablo taramasına o kadar
  // az kalır; sağlık ucunun toplam süresi PROBE_TIMEOUT_MS'i aşmaz.
  const budgetMs = Number.isFinite(options.budgetMs) ? options.budgetMs : PROBE_TIMEOUT_MS;
  const startedAt = Date.now();

  report.connection = await withBudget(
    probeConnection(),
    budgetMs,
    { attempted: true, ok: false, reason: `Bağlantı denemesi ${budgetMs} ms bütçesini aştı` }
  );

  if (report.connection.ok) {
    const remainingMs = Math.max(0, budgetMs - (Date.now() - startedAt));
    report.schema = await probeTables({ ...options, budgetMs: remainingMs });
    report.rls = await withBudget(
      probeRls(),
      Math.max(0, budgetMs - (Date.now() - startedAt)),
      { attempted: true, rows: [], unprotected: [], reason: "ölçülemedi: sorgu bütçesi doldu" }
    );

    // "Okunamadı" ile "ölçülemedi" ayrı raporlanır: ilki bir arıza, ikincisi
    // bir boşluk. İkisini birleştirmek, hiç sormadığımız tabloyu bozuk ilan
    // etmek olurdu.
    const missing = (report.schema.tables || [])
      .filter((row) => row.reachable === false).map((row) => row.table);
    const unmeasured = (report.schema.tables || [])
      .filter((row) => row.reachable === null).map((row) => row.table);

    if (missing.length) {
      report.warnings.push(
        `Okunamayan tablo: ${missing.join(", ")}. Göçler uygulanmamış ya da RLS erişimi kapatıyor olabilir.`
      );
    }
    if (unmeasured.length) {
      report.warnings.push(
        `Ölçülemeyen tablo: ${unmeasured.join(", ")}. Sorgu bütçesi doldu; bu tabloların durumu ` +
        "bilinmiyor — sağlam oldukları anlamına GELMEZ."
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
  supabaseHealth,
  withBudget
};
