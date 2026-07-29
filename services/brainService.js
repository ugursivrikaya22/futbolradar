/**
 * KURAL BEYNİ — kayıt defterini okuyan ve boru hattının gerçek durumunu ölçen servis.
 *
 * SORUN. Bu depoda kurallar tek yetkili karar noktalarında yaşıyor
 * (matchEligibility, matchPriorityService, matchReportStages…) ve her biri
 * kendi dosyasında NEDEN var olduğunu anlatıyor. Ama bütünü gören bir yer
 * yoktu. "Bir maç neden görünmüyor?", "bu rapor neden hâlâ hazırlanıyor
 * diyor?", "hangi eşik nerede tanımlı?" sorularının cevabı 48 servise
 * dağılmıştı; cevabı bulmanın tek yolu kaynağı okumaktı.
 *
 * ÇÖZÜM İKİ PARÇA:
 *
 *   1. rules/registry.json — kuralların MAKİNE OKUNUR dizini. Kuralı
 *      UYGULAMAZ; kuralın hangi dosyada yaşadığını, hangi eşiklerle
 *      çalıştığını, hangi Türkçe metinleri basabildiğini ve hangi testin
 *      koruduğunu söyler. Yetki hâlâ servis dosyasındadır — defter bir
 *      ikinci karar noktası değil, bir dizindir.
 *   2. Bu servis — defteri okur, defterin KENDİSİNİ kaynağa karşı doğrular
 *      ve boru hattının o anki durumunu GERÇEK VERİDEN ölçer.
 *
 * DEFTER YANLIŞSA SESSİZ KALMAZ. verifyRegistry her kaydın module dosyasını,
 * o dosyadaki entry adının gerçekten dışa aktarıldığını ve test yolunu
 * denetler. Var olmayan bir dosyaya işaret eden kayıt, olmayan bir kuralı
 * varmış gibi gösterir; bu, hiç defter tutmamaktan daha zararlıdır.
 *
 * UYDURMA SAYI YOK. pipelineHealth ve brainState hiçbir sayıyı tahmin etmez.
 * Bir kaynak okunamadığında 0 ya da null döndürmek "ölçtük, sıfır çıktı"
 * demektir — oysa doğru cevap "bilmiyoruz"dur. Bu yüzden her ölçüm bloğu
 * `measured` alanı taşır: `measured: false` ise blokta sayı değil, neden
 * ölçülemediğini anlatan Türkçe bir `reason` bulunur.
 */

const fs = require("node:fs");
const path = require("node:path");

// Defter `require` ile okunuyor: Vercel'in dosya izleyicisi yalnızca
// require edilen varlıkları işleve kopyalar. fs.readFileSync ile okunsaydı
// dosya sunucusuz derlemeye hiç girmez ve api/analysis-brain.js boş dönerdi.
const registry = require("../rules/registry.json");

const {
  hasReportableCore,
  isReportableFinal,
  REPORT_STATUS,
  statusByKey
} = require("./matchReportStages.js");
const { buildMatchReport } = require("./matchReportService.js");
const { buildRetryQueue, ACTION } = require("./reportRetrySchedule.js");
const { rankAgenda, TIER } = require("./agendaService.js");
const { evaluateAnalysisRecord } = require("./matchAnalysisAvailability.js");

/**
 * Depo kökü. process.cwd() değil __dirname kullanılıyor: derleme betikleri,
 * testler ve sunucusuz işlevler farklı çalışma dizinlerinden çağırıyor —
 * cwd'ye güvenmek kaynağı bazen bulup bazen bulamamak demek.
 */
const ROOT = path.join(__dirname, "..");

/** Boru hattının okuduğu kayıt dosyaları. Yol tek yerde tanımlı. */
const DATA_FILES = Object.freeze({
  matches: "data/matches.json",
  transfers: "data/transfers.json",
  statements: "data/statements.json",
  analyses: "data/match-analyses.json",
  retryLedger: "data/report-retry-ledger.json"
});

/* ------------------------------------------------------------------ */
/* Ölçüm bloğu yardımcıları                                            */
/* ------------------------------------------------------------------ */

/**
 * "Ölçemedik" bloğu. Sayı yerine gerekçe taşır.
 *
 * Bir dosya okunamadığında `total: 0` yazmak, okuyucuya ölçüm yapıldığını
 * ve sonucun sıfır olduğunu söyler. İkisi aynı şey değildir; panelde de
 * ayrı görünmeleri gerekir.
 */
function unmeasured(source, reason) {
  return { measured: false, source, reason };
}

/** "Ölçtük" bloğu. Alanlar yalnızca gerçekten sayılmış değerleri taşır. */
function measured(source, fields) {
  return { measured: true, source, ...fields };
}

function readJsonFile(relativePath) {
  const absolute = path.join(ROOT, relativePath);
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(absolute, "utf8")) };
  } catch (error) {
    return { ok: false, reason: `okunamadı (${relativePath}): ${error.code || error.message}` };
  }
}

/** Dizi ya da {matches:[…]} / {statements:[…]} sarmalayıcısı — ikisi de var. */
function asArray(payload, ...keys) {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) {
    if (payload && Array.isArray(payload[key])) return payload[key];
  }
  return null;
}

function toDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (value === undefined || value === null || value === "") return null;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

function resolveNow(options) {
  const given = options && toDate(options.now);
  return given || new Date();
}

/* ------------------------------------------------------------------ */
/* Kayıt defteri erişimi                                               */
/* ------------------------------------------------------------------ */

/**
 * Kayıt defterinin tamamı.
 *
 * Nesne donduruluyor: defter bir okuma kaynağıdır, çağıran taraf üzerinde
 * düzeltme yapmamalı. Aksi hâlde bir yüzeyin belleğe yazdığı düzeltme
 * dosyaya hiç yansımadan diğer yüzeyleri de etkilerdi.
 */
function loadRegistry() {
  return deepFreeze(registry);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return value;
}

/** Kural alanları (domains). */
function ruleDomains() {
  return loadRegistry().domains;
}

/** Tüm kurallar — alan ayrımı olmadan. */
function allRules() {
  return loadRegistry().rules;
}

/** Bir alanın kuralları. Tanınmayan alan için boş dizi döner, hata değil. */
function rulesByDomain(domainId) {
  const wanted = String(domainId || "");
  return allRules().filter((rule) => rule.domain === wanted);
}

/** Tek kural. Bulunamazsa null — uydurma bir kayıt üretilmez. */
function ruleById(ruleId) {
  const wanted = String(ruleId || "");
  return allRules().find((rule) => rule.id === wanted) || null;
}

/* ------------------------------------------------------------------ */
/* Defter denetimi                                                     */
/* ------------------------------------------------------------------ */

function directoryExists(relativePath) {
  try {
    return fs.statSync(path.join(ROOT, relativePath)).isDirectory();
  } catch {
    return false;
  }
}

function fileExists(relativePath) {
  try {
    return fs.statSync(path.join(ROOT, relativePath)).isFile();
  } catch {
    return false;
  }
}

/** Bir modülün dışa aktardığı adlar. Yüklenemezse gerekçesiyle döner. */
function moduleExports(relativePath) {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const loaded = require(path.join(ROOT, relativePath));
    return { ok: true, names: Object.keys(loaded || {}) };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

/**
 * Defteri kaynağa karşı doğrular.
 *
 * NEDEN. Kayıt defteri kaynak koddan bağımsız yaşayan bir metin dosyasıdır:
 * bir fonksiyon yeniden adlandırıldığında ya da bir test silindiğinde defter
 * kendiliğinden bozulur ve kimse fark etmez. Bozuk defter, olmayan bir
 * kuralı varmış gibi gösterdiği için hiç defter tutmamaktan daha zararlıdır.
 *
 * DENETLENEMEYEN, "GEÇTİ" SAYILMAZ. Sunucusuz derlemede yalnızca require
 * edilen dosyalar bulunur; scripts/ dizini oraya hiç kopyalanmaz. Böyle bir
 * ortamda "test dosyası yok" demek yanlış bir suçlama olurdu. Bu yüzden
 * yapılamayan denetimler `problems` içine değil `skipped` içine yazılır:
 * `ok`, "denetlenebilen her kayıt geçti" demektir; `skipped` neyin
 * denetlenemediğini adıyla söyler.
 *
 * @returns {{ok: boolean, problems: string[], skipped: string[], checked: object}}
 */
function verifyRegistry() {
  const data = loadRegistry();
  const problems = [];
  const skipped = [];

  const domainIds = new Set();
  for (const domain of data.domains) {
    if (domainIds.has(domain.id)) problems.push(`alan kimliği yinelenmiş: ${domain.id}`);
    domainIds.add(domain.id);
  }

  const canCheckModules = directoryExists("services");
  const canCheckTests = directoryExists("scripts");
  if (!canCheckModules) skipped.push("services/ dizini bu ortamda yok; module ve entry alanları denetlenemedi");
  if (!canCheckTests) skipped.push("scripts/ dizini bu ortamda yok; test alanları denetlenemedi");

  const seenIds = new Set();
  const checked = { rules: 0, modules: 0, entries: 0, tests: 0 };

  for (const rule of data.rules) {
    checked.rules += 1;

    if (seenIds.has(rule.id)) problems.push(`kural kimliği yinelenmiş: ${rule.id}`);
    seenIds.add(rule.id);

    if (!domainIds.has(rule.domain)) {
      problems.push(`${rule.id}: tanınmayan alan "${rule.domain}"`);
    }

    if (canCheckModules) {
      if (!fileExists(rule.module)) {
        problems.push(`${rule.id}: module dosyası yok — ${rule.module}`);
      } else {
        checked.modules += 1;
        const exported = moduleExports(rule.module);
        if (!exported.ok) {
          problems.push(`${rule.id}: module yüklenemedi (${rule.module}) — ${exported.reason}`);
        } else if (!exported.names.includes(rule.entry)) {
          problems.push(`${rule.id}: "${rule.entry}" ${rule.module} dosyasından dışa aktarılmıyor`);
        } else {
          checked.entries += 1;
        }
      }
    }

    // Boş test alanı bir hata değil, kabul edilmiş bir boşluktur: kuralın
    // henüz testi yok ve defter bunu gizlemek yerine yazıyor. Uydurma bir
    // test yolu ise defteri yalancı yapardı.
    if (rule.test && canCheckTests) {
      if (!fileExists(rule.test)) {
        problems.push(`${rule.id}: test dosyası yok — ${rule.test}`);
      } else {
        checked.tests += 1;
      }
    }
  }

  return { ok: problems.length === 0, problems, skipped, checked };
}

/* ------------------------------------------------------------------ */
/* Boru hattı sağlığı                                                  */
/* ------------------------------------------------------------------ */

/** Rapor durumu anahtarından Türkçe etiket. Bilinmeyen anahtar uydurulmaz. */
function statusLabelOf(key) {
  const status = statusByKey(key);
  return status ? status.text : "";
}

/**
 * Rapor aşamaları: hangi maç hangi durumda?
 *
 * Sayım, sayfaların basıldığı hattın kendisinden okunuyor (buildMatchReport
 * → evaluateReportStage). Ayrı bir "eksik mi?" kuralı yazılsaydı panel ile
 * yayımlanan sayfa zamanla ayrışır ve panel yanlış bir tabloyu doğru
 * sanarak gösterirdi.
 */
function reportHealth(matches, now) {
  const byStatus = {};
  for (const key of Object.keys(REPORT_STATUS)) {
    const status = REPORT_STATUS[key];
    byStatus[status.key] = { label: status.text, tone: status.tone, count: 0 };
  }

  const reports = {};
  let reportable = 0;
  let withoutCore = 0;
  let unlabelled = 0;

  for (const match of matches) {
    if (!hasReportableCore(match)) withoutCore += 1;
    if (!isReportableFinal(match, now)) continue;

    reportable += 1;
    const report = buildMatchReport(match, { now, generatedAt: now.toISOString() });
    if (!report) continue;

    reports[match.id] = report;
    if (byStatus[report.status]) byStatus[report.status].count += 1;
    // Tanınmayan durum anahtarı sessizce kaybolmaz; ayrı sayılır ki
    // defterle kaynak arasında bir ayrışma olduğu görünsün.
    else unlabelled += 1;
  }

  return {
    reports,
    health: measured(DATA_FILES.matches, {
      total: matches.length,
      reportable,
      withoutCore,
      generated: Object.keys(reports).length,
      unlabelled,
      byStatus
    })
  };
}

/**
 * Yeniden deneme kuyruğu: sağlayıcıya bu koşuda kim sorulacak?
 *
 * Deneme defteri (data/report-retry-ledger.json) henüz oluşmamış olabilir —
 * plan betiği hiç koşmadıysa dosya yoktur. Bu durumda "0 deneme" yazmıyoruz:
 * defter yoksa kaç kez denendiğini BİLMİYORUZ ve takvim de her maçı ilk
 * deneme sayar. Panelin bunu bir ölçüm gibi göstermesi yanlış olurdu.
 */
function retryHealth(matches, reports, now) {
  const ledgerFile = readJsonFile(DATA_FILES.retryLedger);
  const ledgerEntries = ledgerFile.ok && ledgerFile.value && typeof ledgerFile.value.matches === "object"
    ? ledgerFile.value.matches
    : null;

  const ledger = ledgerEntries
    ? measured(DATA_FILES.retryLedger, {
        tracked: Object.keys(ledgerEntries).length,
        updatedAt: (ledgerFile.value && ledgerFile.value.updatedAt) || null
      })
    : unmeasured(DATA_FILES.retryLedger, "deneme defteri yok: hiçbir maçın kaç kez denendiği bilinmiyor");

  const { queue, skipped, waiting, done, counts } = buildRetryQueue(matches, {
    now,
    reports,
    attempts: ledgerEntries || {}
  });

  const byAction = {};
  for (const key of Object.keys(ACTION)) byAction[ACTION[key]] = 0;
  for (const entry of [...queue, ...waiting, ...done]) {
    if (byAction[entry.plan.action] !== undefined) byAction[entry.plan.action] += 1;
  }

  return {
    ledger,
    queue: measured(DATA_FILES.matches, {
      counts,
      byAction,
      // Kırpılan iş sessiz düşmez: kaç kayıt hangi gerekçeyle sınıra takıldı.
      skipped: skipped.map((item) => ({ id: item.id, action: item.action, reason: item.reason })),
      next: queue.slice(0, 10).map((entry) => ({
        id: entry.id,
        action: entry.plan.action,
        reason: entry.plan.reason,
        attempt: entry.plan.attempt,
        priority: entry.plan.priority
      }))
    })
  };
}

/**
 * Gündem bantları: hangi tür kaç kayıtla temsil ediliyor?
 *
 * Bant sıralaması ana sayfanın ve bültenin sırasını belirliyor. Bir bandın
 * boş olması bir arıza değil ama görünmesi gerekir: örneğin transfer bandı
 * boşsa "Kesinleşmiş transfer" hiç basılmıyor demektir ve bunun sebebi ya
 * gerçekten transfer olmaması ya da transfer hattının durmasıdır.
 */
function agendaHealth(matches, transfers, statements, reports, now) {
  const entries = [
    ...matches.map((match) => ({ type: "match", at: match.kickoff, match })),
    ...transfers.map((transfer) => ({ type: "transfer", at: transfer.date, record: transfer })),
    ...statements.map((statement) => ({ type: "statement", at: statement.publishedAt, record: statement })),
    ...Object.values(reports).map((report) => ({ type: "report", at: report.generatedAt, record: report }))
  ];

  const byTier = {};
  for (const tier of Object.keys(TIER)) byTier[tier] = { score: TIER[tier], count: 0 };
  byTier.unknown = { score: 0, count: 0 };

  for (const entry of rankAgenda(entries, { now })) {
    const tier = entry.agenda.tier;
    if (!byTier[tier]) byTier[tier] = { score: entry.agenda.tierScore, count: 0 };
    byTier[tier].count += 1;
  }

  return measured("data/matches.json + data/transfers.json + data/statements.json", {
    total: entries.length,
    byTier
  });
}

/** Transfer kayıtlarının doğrulama durumu — kaç kayıt hangi güvende. */
function transferHealth(transfers) {
  const byStatus = {};
  const bySourceType = {};
  for (const transfer of transfers) {
    const status = String(transfer.status || "") || "belirtilmemiş";
    const sourceType = String(transfer.sourceType || "") || "belirtilmemiş";
    byStatus[status] = (byStatus[status] || 0) + 1;
    bySourceType[sourceType] = (bySourceType[sourceType] || 0) + 1;
  }
  return measured(DATA_FILES.transfers, { total: transfers.length, byStatus, bySourceType });
}

/** Maç sonu açıklamaları — bant ve rapor sayfaları bu havuzdan besleniyor. */
function statementHealth(statements) {
  const byStatus = {};
  for (const statement of statements) {
    const status = String(statement.status || "") || "belirtilmemiş";
    byStatus[status] = (byStatus[status] || 0) + 1;
  }
  return measured(DATA_FILES.statements, { total: statements.length, byStatus });
}

/**
 * Analiz kayıtları: kaçı gerçekten "Derin analiz" düğmesi almaya yetiyor?
 *
 * Karar matchAnalysisAvailability'de veriliyor; burada yalnızca sayılıyor.
 * Hazır olmayanların gerekçesi de taşınıyor — panelde "3 kayıt hazır değil"
 * demek yetmez, hangi eşiğe takıldığı görünmezse boşluk kapatılamaz.
 */
function analysisHealth(analyses) {
  const notReady = [];
  let ready = 0;

  for (const record of analyses) {
    const verdict = evaluateAnalysisRecord(record);
    if (verdict.ready) ready += 1;
    else notReady.push({ id: record.fixtureId || record.slug || "?", reason: verdict.reason });
  }

  return measured(DATA_FILES.analyses, { total: analyses.length, ready, notReady });
}

/**
 * Boru hattının o anki durumu — hepsi gerçek kayıtlardan.
 *
 * @param {{now?: Date|string}} [options] `now` verilmezse sistem saati.
 * @returns {object} her alt blok `measured` bayrağı taşır.
 */
function pipelineHealth(options = {}) {
  const now = resolveNow(options);

  const matchesFile = readJsonFile(DATA_FILES.matches);
  const matches = matchesFile.ok ? asArray(matchesFile.value, "matches") : null;

  const transfersFile = readJsonFile(DATA_FILES.transfers);
  const transfers = transfersFile.ok ? asArray(transfersFile.value, "transfers") : null;

  const statementsFile = readJsonFile(DATA_FILES.statements);
  const statements = statementsFile.ok ? asArray(statementsFile.value, "statements") : null;

  const analysesFile = readJsonFile(DATA_FILES.analyses);
  const analyses = analysesFile.ok ? asArray(analysesFile.value, "analyses") : null;

  // Maç kaydı okunamadığında rapor, kuyruk ve gündem ölçümlerinin hiçbiri
  // yapılamaz. Bunlara sıfır yazmak, boru hattının boş olduğunu iddia etmek
  // olurdu; oysa bilinmeyen bir şey var.
  const matchesReason = matchesFile.ok
    ? "maç kaydı dizi değil: data/matches.json beklenen biçimde değil"
    : matchesFile.reason;

  if (!matches) {
    return {
      generatedAt: now.toISOString(),
      reports: unmeasured(DATA_FILES.matches, matchesReason),
      retry: {
        ledger: unmeasured(DATA_FILES.retryLedger, "maç kaydı olmadan kuyruk kurulamaz"),
        queue: unmeasured(DATA_FILES.matches, matchesReason)
      },
      agenda: unmeasured(DATA_FILES.matches, matchesReason),
      transfers: transfers
        ? transferHealth(transfers)
        : unmeasured(DATA_FILES.transfers, transfersFile.reason || "transfer kaydı dizi değil"),
      statements: statements
        ? statementHealth(statements)
        : unmeasured(DATA_FILES.statements, statementsFile.reason || "açıklama kaydı dizi değil"),
      analyses: analyses
        ? analysisHealth(analyses)
        : unmeasured(DATA_FILES.analyses, analysesFile.reason || "analiz kaydı dizi değil")
    };
  }

  const { reports, health } = reportHealth(matches, now);

  return {
    generatedAt: now.toISOString(),
    reports: health,
    retry: retryHealth(matches, reports, now),
    agenda: transfers && statements
      ? agendaHealth(matches, transfers, statements, reports, now)
      : unmeasured(
          "data/matches.json + data/transfers.json + data/statements.json",
          "gündem bandı yalnızca maç, transfer ve açıklama kayıtlarının üçü birden okunduğunda ölçülebilir"
        ),
    transfers: transfers
      ? transferHealth(transfers)
      : unmeasured(DATA_FILES.transfers, transfersFile.reason || "transfer kaydı dizi değil"),
    statements: statements
      ? statementHealth(statements)
      : unmeasured(DATA_FILES.statements, statementsFile.reason || "açıklama kaydı dizi değil"),
    analyses: analyses
      ? analysisHealth(analyses)
      : unmeasured(DATA_FILES.analyses, analysesFile.reason || "analiz kaydı dizi değil")
  };
}

/* ------------------------------------------------------------------ */
/* Bütünleşik durum                                                    */
/* ------------------------------------------------------------------ */

/** Defterin özeti: kaç kural, kaç eşik, kaçı testli. */
function registrySummary() {
  const data = loadRegistry();
  const rules = data.rules;

  const domains = data.domains.map((domain) => ({
    id: domain.id,
    title: domain.title,
    summary: domain.summary,
    ruleCount: rules.filter((rule) => rule.domain === domain.id).length
  }));

  // Testi olmayan kural gizlenmiyor: korumasız bir kural, ilk yeniden
  // düzenlemede sessizce kaybolabilecek bir karardır ve bu görünmelidir.
  const untested = rules.filter((rule) => !rule.test).map((rule) => rule.id);

  return {
    version: data.version,
    total: rules.length,
    domains,
    thresholds: rules.reduce((sum, rule) => sum + rule.thresholds.length, 0),
    vocabulary: rules.reduce((sum, rule) => sum + rule.vocabulary.length, 0),
    tested: rules.length - untested.length,
    untested,
    verification: verifyRegistry()
  };
}

/** Kayıt dosyalarının varlığı ve son değişme zamanı. */
function dataInventory() {
  return Object.keys(DATA_FILES).map((key) => {
    const relativePath = DATA_FILES[key];
    try {
      const stat = fs.statSync(path.join(ROOT, relativePath));
      return {
        key,
        path: relativePath,
        exists: true,
        bytes: stat.size,
        updatedAt: stat.mtime.toISOString()
      };
    } catch {
      // Dosya yoksa boyut ve tarih uydurulmaz; "yok" bilgisi tek başına
      // doğru ve yeterlidir.
      return { key, path: relativePath, exists: false, bytes: null, updatedAt: null };
    }
  });
}

/**
 * Beynin tek çağrıda okunabilir hâli: kurallar + boru hattı + kayıt dosyaları.
 *
 * Yönetim paneli ve api/analysis-brain.js bu tek fonksiyonu kullanır; iki
 * yüzeyin ayrı ayrı toplama yapması, aynı sayının iki farklı yerde iki
 * farklı değer göstermesi demek olurdu.
 *
 * @param {{now?: Date|string}} [options]
 */
function brainState(options = {}) {
  const now = resolveNow(options);
  return {
    generatedAt: now.toISOString(),
    rules: registrySummary(),
    pipeline: pipelineHealth({ now }),
    data: { files: dataInventory() }
  };
}

module.exports = {
  loadRegistry,
  ruleDomains,
  rulesByDomain,
  ruleById,
  verifyRegistry,
  pipelineHealth,
  brainState,
  // Yardımcı dışa aktarımlar: panel ve testler defterin özetini ve kayıt
  // envanterini ayrı ayrı da isteyebiliyor.
  allRules,
  registrySummary,
  dataInventory,
  statusLabelOf
};
