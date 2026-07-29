/**
 * KURAL BEYNİ TESTLERİ
 *
 * Sorun: bu depoda kurallar 48 servise dağılmış durumda ve her biri kendi
 * dosyasında yaşıyor. `rules/registry.json` bunların makine okunur dizini —
 * ama bir dizin, işaret ettiği şey değiştiğinde SESSİZCE yanlışa döner.
 * Bir fonksiyon yeniden adlandırılır, bir eşik 40'tan 50'ye çıkar, bir test
 * silinir; defter hâlâ eski hâlini anlatır. Yanlış defter, hiç defter
 * tutmamaktan daha zararlıdır: olmayan bir kuralı varmış gibi gösterir.
 *
 * Sözleşme:
 *   1. Defter kendi şemasına uyar (rules/schema.json, draft-07).
 *   2. Her kaydın module dosyası VARDIR ve entry adı GERÇEKTEN dışa aktarılır.
 *   3. Boş olmayan her test yolu var olan bir dosyayı gösterir.
 *   4. Kural kimlikleri benzersizdir; her kuralın alanı domains listesindedir.
 *   5. Defterdeki eşik KAYNAKTAKİ değerin aynısıdır — defter ikinci bir
 *      karar noktası değil, kaynağın aynasıdır.
 *   6. templates/*.json metinleri servislerdeki değerlerle BİREBİR aynıdır.
 *   7. brainService.verifyRegistry() temiz geçer.
 *   8. brainState() uydurma sayı taşımaz: NaN, undefined ve "bilinmiyor"
 *      yerine yazılmış sıfır yoktur.
 *   9. Yönetim paneli noindex'tir, site haritasında yer almaz, Türkçe konuşur
 *      ve ölçülmemiş bir bloğa sayı basmaz.
 *  10. Defterin söz dağarcığında bahis dili geçmez.
 *  11. api/analysis-brain.js ve api/report-status.js sözleşmelerini korur.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();

const brain = require("../services/brainService.js");
const registry = require("../rules/registry.json");
const schema = require("../rules/schema.json");
const utils = require("../api/_utils.js");
const brainHandler = require("../api/analysis-brain.js");
const reportStatusHandler = require("../api/report-status.js");

const NOW = new Date("2026-07-29T20:00:00+03:00");
const ADMIN_PAGE = "yonetim-paneli.html";

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

/* ------------------------------------------------------------------ */
/* 1. Şema doğrulaması — harici bağımlılık olmadan                     */
/* ------------------------------------------------------------------ */

/**
 * Draft-07'nin bu depoda KULLANILAN alt kümesi.
 *
 * Bir şema kütüphanesi (ajv) eklemek yerine elle doğrulanıyor: şema yalnızca
 * bizim yazdığımız anahtar sözcükleri kullanıyor ve tek bir bağımlılık için
 * derleme yüzeyini genişletmek, kazanılan güvenden pahalı. Tanımadığı bir
 * anahtar sözcükle karşılaşırsa test SESSİZ KALMAZ, hatayla durur — aksi
 * hâlde "doğrulandı" dediği yerde aslında hiçbir şeye bakmamış olurdu.
 */
const SUPPORTED_KEYWORDS = new Set([
  "$schema",
  "$id",
  "title",
  "description",
  "definitions",
  "type",
  "required",
  "additionalProperties",
  "properties",
  "items",
  "minItems",
  "minLength",
  "pattern",
  "anyOf",
  "$ref"
]);

function resolveRef(ref) {
  assert.ok(ref.startsWith("#/"), `desteklenmeyen $ref biçimi: ${ref}`);
  let node = schema;
  for (const segment of ref.slice(2).split("/")) {
    node = node[segment];
    assert.ok(node, `$ref çözülemedi: ${ref}`);
  }
  return node;
}

function validate(node, value, pointer, errors) {
  for (const keyword of Object.keys(node)) {
    assert.ok(
      SUPPORTED_KEYWORDS.has(keyword),
      `şema doğrulayıcısı "${keyword}" anahtar sözcüğünü tanımıyor (${pointer})`
    );
  }

  if (node.$ref) {
    validate(resolveRef(node.$ref), value, pointer, errors);
    return;
  }

  if (node.anyOf) {
    const matched = node.anyOf.some((option) => {
      const branch = [];
      validate(option, value, pointer, branch);
      return branch.length === 0;
    });
    if (!matched) errors.push(`${pointer}: anyOf dallarının hiçbirine uymuyor`);
    return;
  }

  if (node.type === "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      errors.push(`${pointer}: nesne bekleniyordu`);
      return;
    }
    for (const key of node.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        errors.push(`${pointer}: zorunlu alan eksik — ${key}`);
      }
    }
    for (const key of Object.keys(value)) {
      const child = node.properties && node.properties[key];
      if (!child) {
        if (node.additionalProperties === false && !key.startsWith("$comment")) {
          errors.push(`${pointer}: şemada tanımsız alan — ${key}`);
        }
        continue;
      }
      validate(child, value[key], `${pointer}/${key}`, errors);
    }
    return;
  }

  if (node.type === "array") {
    if (!Array.isArray(value)) {
      errors.push(`${pointer}: dizi bekleniyordu`);
      return;
    }
    if (typeof node.minItems === "number" && value.length < node.minItems) {
      errors.push(`${pointer}: en az ${node.minItems} öğe olmalı, ${value.length} var`);
    }
    if (node.items) {
      value.forEach((item, index) => validate(node.items, item, `${pointer}/${index}`, errors));
    }
    return;
  }

  if (node.type === "string") {
    if (typeof value !== "string") {
      errors.push(`${pointer}: dize bekleniyordu`);
      return;
    }
    if (typeof node.minLength === "number" && value.length < node.minLength) {
      errors.push(`${pointer}: en az ${node.minLength} karakter olmalı — "${value}"`);
    }
    if (node.pattern && !new RegExp(node.pattern).test(value)) {
      errors.push(`${pointer}: "${value}" deseni karşılamıyor (${node.pattern})`);
    }
    return;
  }

  if (node.type === "number" && typeof value !== "number") {
    errors.push(`${pointer}: sayı bekleniyordu`);
    return;
  }

  if (node.type === "boolean" && typeof value !== "boolean") {
    errors.push(`${pointer}: mantıksal değer bekleniyordu`);
  }
}

function testRegistryMatchesSchema() {
  assert.equal(schema.$schema, "http://json-schema.org/draft-07/schema#", "şema draft-07 olmalı");
  assert.equal(registry.$schema, "./schema.json", "defter kendi şemasına işaret etmeli");

  const errors = [];
  validate(schema, registry, "registry", errors);
  assert.deepEqual(errors, [], `kayıt defteri şemaya uymuyor:\n- ${errors.join("\n- ")}`);

  // Doğrulayıcının gerçekten bir şeye baktığını kanıtla: bozuk bir kayıt
  // hata üretmiyorsa yukarıdaki "geçti" bir şey ifade etmez.
  const broken = JSON.parse(JSON.stringify(registry));
  broken.rules[0].id = "BÜYÜK.HARF";
  delete broken.rules[0].rationale;
  const brokenErrors = [];
  validate(schema, broken, "registry", brokenErrors);
  assert.ok(brokenErrors.length >= 2, "şema doğrulayıcısı bozuk kaydı yakalamalı");
}

/* ------------------------------------------------------------------ */
/* 2. Defter kaynağa işaret ediyor mu?                                 */
/* ------------------------------------------------------------------ */

function testRuleIdentityIsUnique() {
  const seen = new Map();
  const domainIds = new Set(registry.domains.map((domain) => domain.id));

  for (const rule of registry.rules) {
    assert.ok(!seen.has(rule.id), `kural kimliği yinelenmiş: ${rule.id}`);
    seen.set(rule.id, rule);
    assert.ok(
      domainIds.has(rule.domain),
      `${rule.id}: "${rule.domain}" alanı domains listesinde yok`
    );
  }

  const domainSeen = new Set();
  for (const domain of registry.domains) {
    assert.ok(!domainSeen.has(domain.id), `alan kimliği yinelenmiş: ${domain.id}`);
    domainSeen.add(domain.id);
  }

  // Boş alan, arayüzde başlığı olup içi olmayan bir bölüm demektir.
  for (const domain of registry.domains) {
    assert.ok(
      brain.rulesByDomain(domain.id).length > 0,
      `${domain.id}: alana bağlı hiç kural yok`
    );
  }

  assert.equal(brain.ruleById("match.display.gate").domain, "match-visibility");
  assert.equal(brain.ruleById("olmayan.kural"), null, "bilinmeyen kimlik için null dönmeli");
  assert.deepEqual(brain.rulesByDomain("olmayan-alan"), [], "bilinmeyen alan için boş dizi dönmeli");
}

function testEveryRulePointsAtRealCode() {
  for (const rule of registry.rules) {
    assert.ok(exists(rule.module), `${rule.id}: module dosyası yok — ${rule.module}`);

    const loaded = require(path.join(root, rule.module));
    assert.ok(
      Object.prototype.hasOwnProperty.call(loaded, rule.entry),
      `${rule.id}: "${rule.entry}" ${rule.module} dosyasından dışa aktarılmıyor`
    );
    assert.notEqual(
      loaded[rule.entry],
      undefined,
      `${rule.id}: "${rule.entry}" dışa aktarılmış ama değeri undefined`
    );
  }
}

function testEveryDeclaredTestExists() {
  for (const rule of registry.rules) {
    if (!rule.test) continue;
    assert.ok(exists(rule.test), `${rule.id}: test dosyası yok — ${rule.test}`);
  }

  // Testli kuralın testi npm test zincirinde de koşmalı; koşmayan bir test
  // dosyası kuralı korumaz, yalnızca koruyormuş gibi görünür.
  const testScript = JSON.parse(read("package.json")).scripts.test;
  for (const rule of registry.rules) {
    if (!rule.test) continue;
    assert.ok(
      testScript.includes(rule.test),
      `${rule.id}: ${rule.test} package.json "test" betiğinde koşmuyor`
    );
  }
}

/* ------------------------------------------------------------------ */
/* 3. Eşikler kaynaktakiyle aynı mı?                                   */
/* ------------------------------------------------------------------ */

/**
 * Defterdeki eşiği kaynaktaki sabitle karşılaştıran örnekler.
 *
 * Defterin TAMAMINI otomatik karşılaştırmak mümkün değil: bazı eşikler
 * okunabilirlik için cümleyle yazılmış ("rank <= 4"), bazıları birden çok
 * sabitin türevi. Bu yüzden makine karşılaştırması yapılabilecek kayıtlar
 * elle seçildi — sayısal ve kümesel eşiklerin hepsi burada. Bir sabit
 * değişirse test defteri değil KAYNAĞI referans alır ve defterin
 * güncellenmesini ister.
 */
const THRESHOLD_PROBES = [
  { rule: "match.publish.stale-status", name: "STALE_STATUS_HOURS", export: "STALE_STATUS_HOURS" },
  { rule: "match.publish.approved-source", name: "APPROVED_SOURCES", export: "APPROVED_SOURCES" },
  { rule: "match.display.gate", name: "FINISHED_STATUSES", constant: "FINISHED_STATUSES" },
  { rule: "match.display.gate", name: "LIVE_STATUSES", constant: "LIVE_STATUSES" },
  { rule: "match.priority.high-interest-label", name: "HIGH_INTEREST_THRESHOLD", export: "HIGH_INTEREST_THRESHOLD" },
  { rule: "match.priority.score", name: "ELITE_CLUB_POPULARITY", export: "ELITE_CLUB_POPULARITY" },
  { rule: "match.priority.score", name: "GIANT_COMPETITION_WEIGHT", export: "GIANT_COMPETITION_WEIGHT" },
  { rule: "match.priority.club-floor", name: "DEFAULT_CLUB_POPULARITY", export: "DEFAULT_CLUB_POPULARITY" },
  { rule: "match.priority.club-floor", name: "TURKISH_BIG_FOUR", export: "TURKISH_BIG_FOUR" },
  { rule: "match.priority.competition-weight", name: "SUPER_LIG_WEIGHT", export: "SUPER_LIG_WEIGHT" },
  { rule: "match.signal.no-betting-language", name: "FORBIDDEN_TERMS", export: "FORBIDDEN_TERMS" },
  { rule: "match.signal.form-edge", name: "FORM_EDGE_POINTS", export: "FORM_EDGE_POINTS" },
  { rule: "match.signal.form-edge", name: "MIN_FORM_MATCHES", export: "MIN_FORM_MATCHES" },
  { rule: "analysis.button.coverage-gate", name: "MIN_COVERAGE", export: "MIN_COVERAGE" },
  { rule: "analysis.button.unready-status", name: "UNREADY_STATUS", export: "UNREADY_STATUS" },
  { rule: "report.final.label-and-time-gate", name: "FULL_TIME_AFTER_KICKOFF_MINUTES", export: "FULL_TIME_AFTER_KICKOFF_MINUTES" },
  { rule: "report.stage.status-sentence", name: "QUICK_WINDOW_MINUTES", export: "QUICK_WINDOW_MINUTES" },
  { rule: "report.stage.status-sentence", name: "FULL_WINDOW_HOURS", export: "FULL_WINDOW_HOURS" },
  { rule: "report.stage.status-sentence", name: "FULL_COVERAGE_RATIO", export: "FULL_COVERAGE_RATIO" },
  { rule: "report.retry.bounded-increasing-schedule", name: "RETRY_SCHEDULE_MINUTES", export: "RETRY_SCHEDULE_MINUTES" },
  { rule: "report.retry.bounded-increasing-schedule", name: "MAX_ATTEMPTS_PER_MATCH", export: "MAX_ATTEMPTS_PER_MATCH" },
  { rule: "report.retry.bounded-increasing-schedule", name: "MAX_ATTEMPTS_PER_RUN", export: "MAX_ATTEMPTS_PER_RUN" },
  { rule: "report.retry.minimum-gap", name: "MIN_RETRY_GAP_MINUTES", export: "MIN_RETRY_GAP_MINUTES" },
  { rule: "report.retry.missing-score-is-urgent", name: "BACKFILL_AFTER_HOURS", export: "BACKFILL_AFTER_HOURS" },
  { rule: "report.retry.missing-score-is-urgent", name: "BACKFILL_GIVE_UP_DAYS", export: "BACKFILL_GIVE_UP_DAYS" },
  { rule: "report.retry.missing-score-is-urgent", name: "MAX_BACKFILL_PER_RUN", export: "MAX_BACKFILL_PER_RUN" },
  { rule: "agenda.order.band-share", name: "BAND", export: "BAND" },
  { rule: "match.context.no-future-leak", name: "RECENT_FORM_LIMIT", value: 5 },
  { rule: "match.context.schedule-load", name: "SCHEDULE_LOAD_WINDOW_DAYS", value: 14 }
];

function thresholdValue(rule, name) {
  const found = rule.thresholds.find((threshold) => threshold.name === name);
  assert.ok(found, `${rule.id}: "${name}" eşiği defterde yok`);
  return found.value;
}

/** Set ve dizi aynı kümeyi anlatır; defter JSON olduğu için dizi yazar. */
function comparable(value) {
  if (value instanceof Set) return [...value];
  if (Array.isArray(value)) return [...value];
  return value;
}

/**
 * Dışa aktarılmayan sabitin değerini dosyadan okur.
 *
 * Bazı eşikler (FINISHED_STATUSES gibi) modüle özeldir ve dışa aktarılmaz —
 * dışa aktarmak, yalnızca test edilebilsin diye modülün yüzeyini genişletmek
 * olurdu. Bunun yerine tanım satırı okunuyor: defter, kaynakta HİÇ geçmeyen
 * bir değer yazamaz.
 */
function readSourceConstant(modulePath, name) {
  const source = read(modulePath);
  const match = source.match(new RegExp(`const ${name} = (new Set\\((\\[[\\s\\S]*?\\])\\)|\\[[\\s\\S]*?\\]|[-\\d.]+);`));
  assert.ok(match, `${modulePath}: "${name}" sabitinin tanımı okunamadı`);
  const literal = match[2] || match[1];
  return JSON.parse(literal.replace(/'/g, '"').replace(/,(\s*])/g, "$1"));
}

function testThresholdsMatchTheirSource() {
  assert.ok(THRESHOLD_PROBES.length >= 5, "en az beş eşik kaynağa karşı doğrulanmalı");

  for (const probe of THRESHOLD_PROBES) {
    const rule = brain.ruleById(probe.rule);
    assert.ok(rule, `örneklenen kural defterde yok: ${probe.rule}`);

    const recorded = thresholdValue(rule, probe.name);

    if (probe.export) {
      const modulePath = probe.from || rule.module;
      const source = require(path.join(root, modulePath));
      const actual = source[probe.export];
      assert.notEqual(actual, undefined, `${modulePath}: ${probe.export} dışa aktarılmıyor`);
      assert.deepEqual(
        recorded,
        comparable(actual),
        `${rule.id}: "${probe.name}" defterde ${JSON.stringify(recorded)}, kaynakta ${JSON.stringify(comparable(actual))}`
      );
      continue;
    }

    if (probe.constant) {
      const actual = readSourceConstant(rule.module, probe.constant);
      assert.deepEqual(
        recorded,
        actual,
        `${rule.id}: "${probe.name}" defterde ${JSON.stringify(recorded)}, ${rule.module} içinde ${JSON.stringify(actual)}`
      );
      continue;
    }

    // Sabit adı dışa aktarılmıyorsa değer dosyanın kendisinden okunur:
    // defterin yazdığı sayı kaynakta HİÇ geçmiyorsa kayıt uydurmadır.
    const source = read(rule.module);
    assert.ok(
      new RegExp(`${probe.name}\\s*=\\s*${probe.value}\\b`).test(source),
      `${rule.id}: "${probe.name} = ${probe.value}" ${rule.module} içinde bulunamadı`
    );
    assert.equal(recorded, probe.value, `${rule.id}: "${probe.name}" defterde yanlış yazılmış`);
  }

  // Ağırlık tablosu tek tek değil, tamamı karşılaştırılır: eksik bir ağırlık
  // da yanlış bir ağırlık kadar zararlıdır.
  const priorityRule = brain.ruleById("match.priority.score");
  const { WEIGHTS } = require(path.join(root, "services/matchPriorityService.js"));
  for (const key of ["clubs", "competition", "derby", "turkishInEurope", "titleRace", "relegationRace", "live", "today", "finished"]) {
    assert.equal(
      thresholdValue(priorityRule, `WEIGHTS.${key}`),
      WEIGHTS[key],
      `match.priority.score: WEIGHTS.${key} defterle kaynak arasında ayrışmış`
    );
  }

  // Vitrin bantları da tek tek değil TAMAMI karşılaştırılır: eksik bir bant,
  // yanlış bir bant kadar zararlı — defter var olmayan bir kademe anlatır ya
  // da var olanı gizler.
  const { SPOTLIGHT } = require(path.join(root, "services/matchPriorityService.js"));
  for (const key of ["EDITORIAL", "TOP", "TURKISH", "NONE"]) {
    assert.equal(
      thresholdValue(priorityRule, `SPOTLIGHT.${key}`),
      SPOTLIGHT[key],
      `match.priority.score: SPOTLIGHT.${key} defterle kaynak arasında ayrışmış`
    );
  }

  const tierRule = brain.ruleById("agenda.order.tier-boundary");
  const { TIER } = require(path.join(root, "services/agendaService.js"));
  for (const key of Object.keys(TIER)) {
    assert.equal(
      thresholdValue(tierRule, `TIER.${key}`),
      TIER[key],
      `agenda.order.tier-boundary: TIER.${key} defterle kaynak arasında ayrışmış`
    );
  }

  const coverageRule = brain.ruleById("report.stage.core-vs-extended-coverage");
  const stages = require(path.join(root, "services/matchReportStages.js"));
  assert.equal(thresholdValue(coverageRule, "CORE_SECTIONS.length"), stages.CORE_SECTIONS.length);
  assert.equal(thresholdValue(coverageRule, "EXTENDED_SECTIONS.length"), stages.EXTENDED_SECTIONS.length);
}

/* ------------------------------------------------------------------ */
/* 4. Şablonlar servislerle birebir aynı mı?                           */
/* ------------------------------------------------------------------ */

/**
 * templates/*.json YETKİLİ KAYNAK: servis metni oradan okur.
 *
 * Bu yüzden karşılaştırma iki yönlü: şablon serviste ne görünüyorsa odur
 * (bağlama testi) VE metinler tek tek beklenen cümlenin aynısıdır (içerik
 * testi). Yalnızca birincisi yazılsaydı şablondaki bir yazım değişikliği
 * hiçbir yerde uyarı üretmeden yayına çıkardı.
 */
const REPORT_STATUS_TEXTS = {
  quickReady: { key: "quick-ready", text: "Hızlı rapor hazır", tone: "ok" },
  fullProcessing: { key: "full-processing", text: "Tam analiz hazırlanıyor", tone: "progress" },
  fullReady: { key: "full-ready", text: "Tam analiz hazır", tone: "ok" },
  partialFinal: { key: "partial-final", text: "Kısmi rapor · veri tamamlanmadı", tone: "warn" },
  unavailable: { key: "unavailable", text: "Veri yok", tone: "warn" }
};

const TRUST_LABEL_TEXTS = {
  verified: "Doğrulandı",
  official: "Resmî açıklama",
  media: "Basın kaynağı",
  rumour: "Söylenti",
  incomplete: "Veri eksik",
  noScore: "Skor yok",
  transferConfirmed: "Transfer kesinleşti",
  live: "Canlı",
  awaiting: "Veri bekleniyor"
};

function testReportStatusTemplateMatchesService() {
  const template = require("../templates/report-status.json");
  const { REPORT_STATUS, statusByKey } = require("../services/matchReportStages.js");

  assert.deepEqual(
    Object.keys(REPORT_STATUS),
    Object.keys(template.statuses),
    "durum anahtarları ve sırası şablonla servis arasında ayrışmış"
  );

  for (const [name, expected] of Object.entries(REPORT_STATUS_TEXTS)) {
    const fromTemplate = template.statuses[name];
    const fromService = REPORT_STATUS[name];
    assert.ok(fromTemplate, `templates/report-status.json: "${name}" durumu yok`);
    assert.deepEqual(fromService, fromTemplate, `${name}: servis şablondan farklı bir nesne kullanıyor`);
    assert.equal(fromTemplate.key, expected.key, `${name}: durum anahtarı değişmiş`);
    assert.equal(fromTemplate.text, expected.text, `${name}: durum cümlesi değişmiş`);
    assert.equal(fromTemplate.tone, expected.tone, `${name}: durum tonu değişmiş`);
    assert.ok(
      typeof fromTemplate.detail === "string" && fromTemplate.detail.length > 20,
      `${name}: açıklama cümlesi eksik`
    );
    assert.equal(statusByKey(expected.key), fromService, `${expected.key}: anahtar aramasıyla eşleşmiyor`);
  }

  // Yayımlanan sayfa gerçekten şablondaki cümleyi basıyor mu?
  const home = read("index.html");
  if (home.includes("report-status")) {
    const printed = [...home.matchAll(/class="report-status is-[a-z]+">([^<]+)</g)].map((match) => match[1].trim());
    for (const text of printed) {
      assert.ok(
        Object.values(REPORT_STATUS_TEXTS).some((status) => status.text === text),
        `index.html: şablonda olmayan rapor durumu basılmış — "${text}"`
      );
    }
  }
}

function testTrustLabelTemplateMatchesService() {
  const template = require("../templates/trust-labels.json");
  const { TRUST_LABELS } = require("../services/trustLabels.js");
  const { SOURCE_TYPES } = require("../services/transferService.js");

  assert.deepEqual(
    Object.keys(TRUST_LABELS),
    Object.keys(template.labels),
    "güven etiketi anahtarları şablonla servis arasında ayrışmış"
  );
  assert.deepEqual(TRUST_LABELS, template.labels, "servis şablondan farklı bir etiket kümesi kullanıyor");

  for (const [key, text] of Object.entries(TRUST_LABEL_TEXTS)) {
    assert.equal(template.labels[key].text, text, `${key}: güven etiketi metni değişmiş`);
    assert.ok(template.labels[key].title, `${key}: etiketin açıklaması yok`);
  }

  // Şablonun kendi $comment'i bu eşliği vaat ediyor; vaat test edilmezse
  // yalnızca bir dilektir.
  for (const key of ["official", "media", "rumour"]) {
    assert.equal(
      template.labels[key].text,
      SOURCE_TYPES[key],
      `${key}: transfer kaynak türü etiketiyle güven etiketi ayrışmış`
    );
  }

  // app.js kural aynasını taşıyor; metin orada da aynı olmalı.
  const client = read("app.js");
  for (const text of Object.values(TRUST_LABEL_TEXTS)) {
    assert.ok(client.includes(text), `app.js aynasında güven etiketi eksik — "${text}"`);
  }
}

/**
 * Bir servis o metni gerçekten basabiliyor mu?
 *
 * Metin ya dosyanın kendisinde yazılıdır ya da servisin okuduğu bir şablonda
 * (services/trustLabels.js metnini templates/trust-labels.json'dan alıyor).
 * Yalnızca dosya içeriğine bakmak, şablona taşınmış her cümleyi "kayıp" ilan
 * ederdi; yalnızca şablona bakmak da doğrudan yazılmış cümleleri gözden
 * kaçırırdı.
 */
function moduleCanPrint(modulePath, text) {
  const source = read(modulePath);
  if (source.includes(text)) return true;

  for (const [, templatePath] of source.matchAll(/require\("\.\.\/(templates\/[A-Za-z0-9_.-]+\.json)"\)/g)) {
    if (exists(templatePath) && read(templatePath).includes(text)) return true;
  }

  return false;
}

function testAwaitingTemplateMatchesServices() {
  const template = require("../templates/awaiting.json");
  const entries = Object.entries(template.texts);
  assert.ok(entries.length >= 10, "\"veri bekleniyor\" ailesi eksik görünüyor");

  for (const [key, entry] of entries) {
    assert.ok(entry.text && entry.text.trim() === entry.text, `${key}: metin boş ya da kırpılmamış`);
    assert.ok(entry.usage && entry.usage.length > 10, `${key}: metnin nerede kullanıldığı yazılmamış`);
    assert.ok(Array.isArray(entry.modules) && entry.modules.length, `${key}: kaynak modül listelenmemiş`);

    // Şablon burada AYNA: metni servis üretiyor. Bir cümle listelenen
    // dosyaların hiçbirinde geçmiyorsa kayıt uydurmadır ve şablon,
    // basılmayan bir metni basılıyormuş gibi gösterir.
    for (const modulePath of entry.modules) {
      assert.ok(exists(modulePath), `${key}: listelenen dosya yok — ${modulePath}`);
      assert.ok(
        moduleCanPrint(modulePath, entry.text),
        `${key}: "${entry.text}" ${modulePath} içinde ya da okuduğu şablonda geçmiyor`
      );
    }
  }

  // Ailenin çekirdeği: eksik alanın yerine basılan tek cümle.
  const { AWAITING_LABEL } = require("../services/matchEligibility.js");
  assert.equal(template.texts.data.text, AWAITING_LABEL, "AWAITING_LABEL şablonla ayrışmış");
  assert.equal(template.texts.data.text, "Veri bekleniyor");

  // Ölçülmemiş alanın yerine sayı değil cümle basılır; şablonda sayı
  // görünmesi bu kuralın tersine dönmesi demektir.
  for (const [key, entry] of entries) {
    assert.ok(!/\d/.test(entry.text), `${key}: bekleme metni sayı taşıyor — "${entry.text}"`);
  }
}

/* ------------------------------------------------------------------ */
/* 5. Servis: denetim ve ölçüm                                         */
/* ------------------------------------------------------------------ */

function testVerifyRegistryPasses() {
  const verification = brain.verifyRegistry();
  assert.deepEqual(verification.problems, [], "defter denetimi sorun bildirdi");
  assert.equal(verification.ok, true, "verifyRegistry().ok true olmalı");
  assert.deepEqual(verification.skipped, [], "depo kökünde hiçbir denetim atlanmamalı");
  assert.equal(verification.checked.rules, registry.rules.length, "her kural denetlenmeli");
  assert.equal(verification.checked.entries, registry.rules.length, "her entry doğrulanmalı");

  const domains = brain.ruleDomains();
  assert.equal(domains.length, registry.domains.length);
  assert.throws(
    () => { brain.loadRegistry().rules.push({}); },
    "defter dondurulmuş olmalı: okuyan taraf üzerine yazamaz"
  );
}

/** Uydurma sayı avı: NaN, undefined ve "undefined" dizesi. */
function walkForInventedNumbers(value, pointer, found) {
  if (value === undefined) {
    found.push(`${pointer}: undefined`);
    return;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    found.push(`${pointer}: ${String(value)}`);
    return;
  }
  if (typeof value === "string") {
    if (/\b(NaN|undefined|\[object Object\])\b/.test(value)) found.push(`${pointer}: "${value}"`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkForInventedNumbers(item, `${pointer}[${index}]`, found));
    return;
  }
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      walkForInventedNumbers(value[key], `${pointer}.${key}`, found);
    }
  }
}

/** Blok gerçekten bir şey saymış mı? Sayı iç içe alanlarda da olabilir. */
function countsSomething(value, depth = 0) {
  if (typeof value === "number") return Number.isFinite(value);
  if (depth > 4 || !value || typeof value !== "object") return false;
  const entries = Array.isArray(value) ? value : Object.entries(value)
    .filter(([key]) => key !== "measured" && key !== "source")
    .map(([, item]) => item);
  return entries.some((item) => countsSomething(item, depth + 1));
}

function testBrainStateCarriesNoInventedNumbers() {
  const state = brain.brainState({ now: NOW });

  const found = [];
  walkForInventedNumbers(state, "brainState", found);
  assert.deepEqual(found, [], `brainState() uydurma değer taşıyor:\n- ${found.join("\n- ")}`);

  assert.equal(state.generatedAt, NOW.toISOString(), "ölçüm anı verilen saatten alınmalı");
  assert.equal(state.rules.total, registry.rules.length);
  assert.equal(state.rules.tested + state.rules.untested.length, registry.rules.length);
  assert.ok(Array.isArray(state.data.files) && state.data.files.length, "kayıt envanteri boş");

  // Her ölçüm bloğu ya sayı ya gerekçe taşır — ikisinin arasında bir yer yok.
  const blocks = [
    ["reports", state.pipeline.reports],
    ["retry.ledger", state.pipeline.retry.ledger],
    ["retry.queue", state.pipeline.retry.queue],
    ["agenda", state.pipeline.agenda],
    ["transfers", state.pipeline.transfers],
    ["statements", state.pipeline.statements],
    ["analyses", state.pipeline.analyses]
  ];

  for (const [name, block] of blocks) {
    assert.equal(typeof block.measured, "boolean", `${name}: measured bayrağı yok`);
    if (block.measured) {
      // Ölçüm bir sayı üretmelidir; sayısı olmayan bir "ölçtük" bildirimi
      // boş bir iddiadır.
      assert.ok(countsSomething(block), `${name}: ölçüldü deniyor ama hiçbir sayı yok`);
      assert.equal(block.reason, undefined, `${name}: ölçülen blokta gerekçe olmamalı`);
    } else {
      assert.ok(block.reason && block.reason.length > 10, `${name}: ölçülemedi ama gerekçesi yok`);
      // Ölçülemeyen bloğa sayı yazmak, "bilmiyoruz"u "sıfır"a çevirmektir.
      assert.ok(!countsSomething(block), `${name}: ölçülemeyen blokta sayı var`);
    }
  }

  // Rapor sayımı içeriden tutarlı: üretilen rapor sayısı raporlanabilir
  // maç sayısını aşamaz ve durum dağılımının toplamı üretileni geçemez.
  const reports = state.pipeline.reports;
  if (reports.measured) {
    assert.ok(reports.generated <= reports.reportable, "üretilen rapor, raporlanabilir maçtan çok olamaz");
    assert.ok(reports.reportable <= reports.total, "raporlanabilir maç, toplam maçtan çok olamaz");
    assert.equal(reports.unlabelled, 0, "tanınmayan rapor durumu üretilmiş");
    const summed = Object.values(reports.byStatus).reduce((sum, entry) => sum + entry.count, 0);
    assert.equal(summed, reports.generated, "durum dağılımı üretilen rapor sayısıyla uyuşmuyor");
  }

  // Aynı saatle iki çağrı aynı tabloyu vermeli; aksi hâlde panelde ve API'de
  // farklı sayılar görünürdü.
  assert.deepEqual(brain.brainState({ now: NOW }), state, "aynı saat için ölçüm kararsız");
}

/* ------------------------------------------------------------------ */
/* 6. Yönetim paneli                                                   */
/* ------------------------------------------------------------------ */

function testAdminPanelIsHiddenFromSearch() {
  const html = read(ADMIN_PAGE);
  assert.ok(
    /<meta\s+name="robots"\s+content="noindex,nofollow"\s*\/?>/.test(html),
    `${ADMIN_PAGE}: noindex,nofollow etiketi yok`
  );

  for (const sitemap of ["sitemap.xml", "public/sitemap.xml"]) {
    if (!exists(sitemap)) continue;
    assert.ok(
      !read(sitemap).includes(ADMIN_PAGE),
      `${sitemap}: noindex olan ${ADMIN_PAGE} site haritasında listelenmiş`
    );
  }

  // Arama dizininde de görünmemeli: panel bir operasyon aracı, içerik değil.
  if (exists("search-index.json")) {
    assert.ok(!read("search-index.json").includes(ADMIN_PAGE), `${ADMIN_PAGE} arama dizinine girmiş`);
  }

  // public/ aynası kökle aynı paneli göstermeli; ayrışırsa yayına başka bir
  // sayfa çıkar. Ölçüm damgaları karşılaştırma dışı: iki kopya derlemenin
  // farklı saniyelerinde yazılıyor ve saniye farkı bir ayrışma değil.
  if (exists(`public/${ADMIN_PAGE}`)) {
    const withoutStamps = (value) => value.replace(/<time[^>]*>[^<]*<\/time>/g, "<time/>");
    assert.equal(
      withoutStamps(read(`public/${ADMIN_PAGE}`)),
      withoutStamps(html),
      `public/${ADMIN_PAGE} kökteki panelle ayrışmış`
    );
  }
}

/**
 * Panelin kullanıcıya görünen metni Türkçe olmalı.
 *
 * Makine anahtarları (`quick-ready`, `bigFourMatch`), dosya yolları, sabit
 * ve tablo adları bu denetimin dışında: depo kuralı "kod, değişken adı,
 * dosya adı İngilizce olabilir" diyor ve bunların Türkçesi uydurulamaz.
 * Bu yüzden liste İNGİLİZCE İŞLEV SÖZCÜKLERİNDEN ve tipik arayüz
 * kopyasından oluşuyor: makine adı olabilecek isimler (players, data,
 * status…) bilerek dışarıda — onları da saymak, tablo adı listeleyen bir
 * satırı çeviri hatası sanmak olurdu.
 */
const ENGLISH_MARKERS = [
  "the", "and", "for", "with", "from", "this", "that", "these", "those",
  "are", "was", "were", "will", "would", "should", "please", "available",
  "loading", "error", "page", "dashboard", "pipeline", "summary",
  "unknown", "missing", "updated", "generated", "none", "true", "false"
];

function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<code[^>]*>[\s\S]*?<\/code>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:amp|lt|gt|quot|nbsp|#\d+);/gi, " ")
    // Dosya yolları, SABIT_ADLAR ve camelCase tanımlayıcılar kaynağın
    // adlarıdır; çeviri denetimine girmezler.
    .replace(/[A-Za-z0-9_.-]*\/[A-Za-z0-9_./-]+/g, " ")
    .replace(/\b[A-Z][A-Z0-9_]{2,}\b/g, " ")
    .replace(/\b[a-zA-Z]+[A-Z][A-Za-z]*\b/g, " ")
    .replace(/\b[A-Za-z]+\.(?:js|mjs|ts|json|html|css)\b/g, " ");
}

function testAdminPanelSpeaksTurkish() {
  const words = new Set(
    visibleText(read(ADMIN_PAGE))
      .split(/[^A-Za-zÀ-ÿçğıöşüÇĞİÖŞÜ]+/)
      .filter(Boolean)
      .map((word) => word.toLowerCase())
  );

  const leaked = ENGLISH_MARKERS.filter((marker) => words.has(marker));
  assert.deepEqual(leaked, [], `${ADMIN_PAGE}: çevrilmemiş İngilizce metin — ${leaked.join(", ")}`);

  assert.ok(read(ADMIN_PAGE).includes('lang="tr"'), `${ADMIN_PAGE}: sayfa dili Türkçe olmalı`);

  // Denetimin boş çalışmadığını kanıtla: çevrilmemiş bir cümle eklendiğinde
  // yakalanmalı. Aksi hâlde "geçti" hiçbir şey ifade etmezdi.
  const probeWords = new Set(
    visibleText("<p>Loading dashboard data, please wait.</p>")
      .split(/[^A-Za-zÀ-ÿçğıöşüÇĞİÖŞÜ]+/)
      .filter(Boolean)
      .map((word) => word.toLowerCase())
  );
  assert.ok(
    ENGLISH_MARKERS.some((marker) => probeWords.has(marker)),
    "İngilizce denetimi çevrilmemiş bir cümleyi yakalayamıyor"
  );
}

function testAdminPanelPrintsOnlyMeasuredNumbers() {
  const html = read(ADMIN_PAGE);
  const state = brain.brainState({ now: NOW });

  // PANEL HİDRE EDİLMEZ, ÖN RENDER EDİLİR.
  //
  // Bloklar eskiden `data-api-target="brain-…"` ve `data-static-fallback`
  // taşıyordu. Sitenin geri kalanında bunlar GERÇEK bir hidrasyon
  // sözleşmesidir: app.js o adları arar ve alanı canlı veriyle tazeler. Ama
  // "brain-" önekli hiçbir bağlantı tanımı yok — panelin kendi metni de
  // "canlı bir gösterge değil" diyor. Karşılığı olmayan bir sözleşme, bir
  // sonraki okuyucuyu var olmayan bir hidrasyon yolunu aramaya gönderir.
  // Bu yüzden bloklar artık ne olduklarını söyleyen bir adla işaretli.
  assert.ok(
    !/data-api-target="brain-/.test(html),
    "panel hidrasyon sözleşmesi taklit etmemeli: 'brain-' önekli bir data-api-target yok"
  );
  assert.ok(
    !html.includes("data-static-fallback"),
    "panelde canlı tazeleme yok; 'static fallback' işareti yanıltıcı"
  );

  // Ön render gerçekten çalışmış mı: her veri alanı dolu olmalı.
  const targets = [...html.matchAll(/data-prerender-block="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(targets.length >= 8, "panelde beklenen veri alanları yok");
  for (const target of targets) {
    const marker = new RegExp(`prerender:${target}:start([\\s\\S]*?)prerender:${target}:end`);
    const filled = html.match(marker);
    assert.ok(filled, `${target}: ön render işareti yok`);
    assert.ok(filled[1].replace(/<[^>]+>/g, "").trim().length > 0, `${target}: alan boş kalmış`);
  }

  // Defterin sayıları panelde AYNEN görünmeli; panel kendi toplamını yapmaz.
  assert.ok(
    html.includes(`<b>${state.rules.total}</b><span>Kayıtlı kural</span>`),
    "panel kayıtlı kural sayısını defterden almıyor"
  );
  assert.ok(
    html.includes(`<b>${state.rules.tested}</b><span>Testli kural</span>`),
    "panel testli kural sayısını defterden almıyor"
  );
  assert.ok(
    html.includes(`<b>${state.rules.untested.length}</b><span>Testsiz kural</span>`),
    "panel testsiz kural sayısını defterden almıyor"
  );

  // Ölçülemeyen her blokta panel sayı değil GEREKÇE basmalı.
  const blocks = [
    state.pipeline.reports,
    state.pipeline.retry.ledger,
    state.pipeline.retry.queue,
    state.pipeline.agenda,
    state.pipeline.transfers,
    state.pipeline.statements,
    state.pipeline.analyses
  ];
  for (const block of blocks) {
    if (block.measured) continue;
    assert.ok(
      html.includes(block.reason),
      `panel ölçülemeyen bloğun gerekçesini basmıyor — "${block.reason}"`
    );
  }

  // Sayfada dolaşan bozuk değer olmamalı.
  const text = visibleText(html);
  for (const poison of ["NaN", "undefined", "[object Object]", "Infinity"]) {
    assert.ok(!text.includes(poison), `${ADMIN_PAGE}: "${poison}" basılmış`);
  }

  // Bahis dili panelde de yasak.
  const lower = text.toLocaleLowerCase("tr");
  for (const term of ["banko", "kupon", "iddaa"]) {
    assert.ok(!lower.includes(term), `${ADMIN_PAGE}: bahis dili — "${term}"`);
  }
}

/* ------------------------------------------------------------------ */
/* 7. Söz dağarcığı                                                    */
/* ------------------------------------------------------------------ */

const BETTING_TERMS = ["banko", "kupon", "iddaa", "bahis", "oran"];

function testVocabularyHasNoBettingLanguage() {
  let printable = 0;

  for (const rule of registry.rules) {
    for (const text of rule.vocabulary) {
      printable += 1;
      const lower = text.toLocaleLowerCase("tr");
      for (const term of BETTING_TERMS) {
        assert.ok(!lower.includes(term), `${rule.id}: söz dağarcığında bahis dili — "${text}" (${term})`);
      }
      // Kullanıcıya görünen metinde uydurma yüzde/olasılık olamaz.
      assert.ok(
        !/%\s*\d/.test(text) && !/\d+\s*%/.test(text),
        `${rule.id}: söz dağarcığında sabit yüzde — "${text}"`
      );
    }
  }

  assert.ok(printable > 50, "defterde kayıtlı kullanıcı metni beklenenden az");

  // Defter kullanıcıya görünen metinlerin dizini olduğunu iddia ediyor;
  // iddia, kapalı söz dağarcıklarıyla karşılaştırılarak sınanır. Bir metnin
  // hangi kuralın altında yazıldığı serbest — basan kural hangisiyse orada
  // durur — ama defterde HİÇ görünmemesi, dizinin eksik olması demektir.
  const vocabulary = new Set(registry.rules.flatMap((rule) => rule.vocabulary));
  const { REPORT_STATUS } = require("../services/matchReportStages.js");
  const { TRUST_LABELS } = require("../services/trustLabels.js");

  for (const status of Object.values(REPORT_STATUS)) {
    assert.ok(vocabulary.has(status.text), `defterde eksik rapor durumu — "${status.text}"`);
    assert.ok(vocabulary.has(status.detail), `defterde eksik durum açıklaması — "${status.detail}"`);
  }
  // Güven etiketleri (services/trustLabels.js) HENÜZ deftere girmedi: defter
  // dört alanla sınırlı ve eksiksiz olduğunu iddia etmiyor. Etiketleri
  // koruyan test ayrı yaşıyor (scripts/test-trust-labels.mjs). Yine de gün
  // gelip bir kural o servisi işaret ederse, söz dağarcığı eksik girilmesin:
  // yarım bir kayıt, "bu metinler basılmıyor" gibi okunur.
  const trustRules = registry.rules.filter((rule) => rule.module === "services/trustLabels.js");
  for (const rule of trustRules) {
    for (const label of Object.values(TRUST_LABELS)) {
      assert.ok(
        rule.vocabulary.includes(label.text),
        `${rule.id}: güven etiketi söz dağarcığında yok — "${label.text}"`
      );
    }
  }

  // Metin basmayan kural boş söz dağarcığı taşır; bu bir eksiklik değil,
  // bilgidir: "bu kural karar verir, cümle kurmaz".
  assert.deepEqual(
    brain.ruleById("report.status.no-invented-label").vocabulary,
    [],
    "durum uydurmama kuralı kendi metnini basmaz"
  );
}

/* ------------------------------------------------------------------ */
/* 8. API sözleşmesi                                                   */
/* ------------------------------------------------------------------ */

let requestCounter = 0;

function fakeRequest(url, method = "GET") {
  requestCounter += 1;
  // Her istek ayrı bir istemciden geliyormuş gibi: hız sınırı testin
  // kendisini düşürmesin.
  return { url, method, headers: { "x-forwarded-for": `203.0.113.${requestCounter % 250}` } };
}

function fakeResponse() {
  const headers = {};
  return {
    statusCode: 200,
    headers,
    setHeader(key, value) { headers[key] = value; },
    getHeader(key) { return headers[key]; },
    end(body) { this.body = body; }
  };
}

async function call(handler, url, method = "GET") {
  const res = fakeResponse();
  await handler(fakeRequest(url, method), res);
  return { res, payload: JSON.parse(res.body) };
}

function testCachePoliciesAreDeclared() {
  for (const name of ["analysis-brain", "report-status"]) {
    assert.ok(utils.CACHE_POLICIES[name], `api/_utils.js: "${name}" önbellek politikası tanımsız`);
    const policy = utils.cacheControlFor(name);
    assert.ok(policy.cdn.includes("s-maxage="), `${name}: CDN penceresi tanımsız`);
  }
}

async function testAnalysisBrainEndpoint() {
  const { res, payload } = await call(brainHandler, "/api/analysis-brain");

  assert.equal(res.statusCode, 200);
  assert.equal(payload.ok, true, "beyin ucu ok:false döndü");
  assert.equal(payload.source, "FutbolRadar Kural Beyni");
  assert.equal(
    res.getHeader("CDN-Cache-Control"),
    utils.cacheControlFor("analysis-brain").cdn,
    "beyin ucu kendi önbellek penceresini kullanmıyor"
  );

  const state = Array.isArray(payload.data) ? payload.data[0] : payload.data;
  for (const key of ["generatedAt", "rules", "pipeline", "data"]) {
    assert.ok(state[key] !== undefined, `analysis-brain: yanıtta "${key}" yok`);
  }
  assert.equal(state.rules.total, registry.rules.length, "uç defterin tamamını bildirmiyor");
  assert.equal(state.rules.verification.ok, true, "uç bozuk bir defteri temiz gösteriyor");

  const found = [];
  walkForInventedNumbers(payload, "analysis-brain", found);
  assert.deepEqual(found, [], `analysis-brain uydurma değer taşıyor:\n- ${found.join("\n- ")}`);

  const rejected = await call(brainHandler, "/api/analysis-brain", "POST");
  assert.equal(rejected.res.statusCode, 405, "yazma isteği reddedilmeli");
  assert.equal(rejected.payload.error.code, "METHOD_NOT_ALLOWED");
}

async function testReportStatusEndpoint() {
  const all = await call(reportStatusHandler, "/api/report-status");
  assert.equal(all.payload.ok, true, "rapor durumu ucu ok:false döndü");
  assert.equal(all.payload.source, "FutbolRadar Rapor Durumu");
  assert.equal(
    all.res.getHeader("CDN-Cache-Control"),
    utils.cacheControlFor("report-status").cdn,
    "rapor durumu ucu kendi önbellek penceresini kullanmıyor"
  );
  assert.ok(Array.isArray(all.payload.data) && all.payload.data.length, "hiç maç kaydı dönmedi");
  assert.equal(all.payload.meta.counts.total, all.payload.data.length);

  const statusKeys = new Set(
    Object.values(require("../services/matchReportStages.js").REPORT_STATUS).map((status) => status.key)
  );

  for (const record of all.payload.data) {
    assert.ok(record.id, "kayıt kimliksiz döndü");
    assert.ok(statusKeys.has(record.report.status), `tanınmayan rapor durumu: ${record.report.status}`);
    assert.equal(typeof record.report.label, "string");
    assert.ok(record.report.label.length > 0, `${record.id}: durum cümlesi boş`);
    // Skor bilinmiyorsa null; 0-0 ile "bilinmiyor" aynı şey değildir.
    assert.ok(
      record.score === null || (Number.isFinite(record.score.home) && Number.isFinite(record.score.away)),
      `${record.id}: skor alanı ne null ne de tam sayı çifti`
    );
    assert.ok(record.retry.action, `${record.id}: yeniden deneme eylemi yok`);
    assert.ok(record.retry.reason, `${record.id}: yeniden deneme gerekçesi yok`);
  }

  const found = [];
  walkForInventedNumbers(all.payload, "report-status", found);
  assert.deepEqual(found, [], `report-status uydurma değer taşıyor:\n- ${found.join("\n- ")}`);

  // Tek maç süzgeci.
  const wanted = all.payload.data[0].id;
  const single = await call(reportStatusHandler, `/api/report-status?match=${encodeURIComponent(wanted)}`);
  assert.equal(single.payload.data.length, 1, "?match tek kayıt döndürmeli");
  assert.equal(single.payload.data[0].id, wanted);
  assert.equal(single.payload.meta.counts.total, all.payload.data.length, "süzgeç kümenin tamamını gizlememeli");

  // Bilinmeyen kimlik "raporu yok" değil, "kayıt yok" demektir.
  const missing = await call(reportStatusHandler, "/api/report-status?match=olmayan-mac");
  assert.equal(missing.payload.ok, false);
  assert.equal(missing.payload.error.code, "MATCH_NOT_FOUND");

  const rejected = await call(reportStatusHandler, "/api/report-status", "DELETE");
  assert.equal(rejected.res.statusCode, 405, "yazma isteği reddedilmeli");
}

/* ------------------------------------------------------------------ */
/* 12. Katalog defterin görünümü mü, üçüncü bir kopya mı?              */
/* ------------------------------------------------------------------ */

/**
 * DOKÜMAN ÜÇÜNCÜ BİR KARAR NOKTASI OLAMAZ.
 *
 * Denetim (2026-07): docs/rules-catalogue.md 49 kuralın sayısal eşiklerini
 * ELLE üçüncü kez yazıyordu (birinci: services/*.js, ikinci: defter). İlk
 * ikisinin eşliği testThresholdsMatchTheirSource ile korunuyordu; dokümanı
 * hiçbir test okumuyordu. Bir eşik serviste değiştiğinde defter ve test
 * güncelleniyor, doküman sessizce yalan söylemeye başlıyordu.
 *
 * Doküman artık defterden ÜRETİLİYOR. Bu test o sözleşmeyi koruyor: dosya,
 * üreticinin şu andaki çıktısıyla birebir aynı olmalı. Elle yapılmış bir
 * düzenleme burada görünür; sessizce kalamaz.
 */
async function testCatalogueIsGeneratedFromTheRegistry() {
  const { renderCatalogue, CATALOGUE_PATH } = await import("./generate-rules-catalogue.mjs");

  assert.ok(exists(CATALOGUE_PATH), `katalog dosyası yok — ${CATALOGUE_PATH}`);
  assert.equal(
    read(CATALOGUE_PATH),
    renderCatalogue(registry),
    `${CATALOGUE_PATH} defterden üretilmiş hâliyle ayrışmış — ` +
    "elle düzenlenmiş olabilir. `node scripts/generate-rules-catalogue.mjs` ile yenileyin."
  );

  // Üretim derleme zincirinde koşmalı; koşmayan bir üretici, dokümanı
  // güncellemediği hâlde güncelliyormuş gibi görünür.
  const build = JSON.parse(read("package.json")).scripts.build;
  assert.ok(
    build.includes("scripts/generate-rules-catalogue.mjs"),
    'katalog üreticisi package.json "build" zincirinde koşmalı'
  );

  // Üreticinin gerçekten defteri okuduğunu kanıtla: değişen bir defter,
  // değişen bir katalog üretmeli.
  const altered = JSON.parse(JSON.stringify(registry));
  altered.rules[0].title = "Denetim örneği: değişmiş başlık";
  assert.notEqual(
    renderCatalogue(altered),
    renderCatalogue(registry),
    "üretici defterdeki değişikliği yansıtmıyor"
  );
}

/* ------------------------------------------------------------------ */
/* 13. TypeScript okuyucusu şemayı UYGULAR, yeniden tanımlamaz          */
/* ------------------------------------------------------------------ */

/**
 * lib/analysis KATMANI ŞEMANIN İKİNCİ TANIMI OLAMAZ.
 *
 * Denetim (2026-07): `lib/analysis/ruleRegistry.ts` zorunlu alan listesini
 * elle sayıyordu — `["id","domain","title","statement","rationale","module",
 * "entry"]` — oysa `rules/schema.json` aynı listeyi artı dört alanla
 * tanımlıyordu. İki taraf arasında hiçbir bağ yoktu; şemaya yeni bir zorunlu
 * alan eklendiğinde TypeScript katmanı sessizce ayrışır ve eksik defteri
 * "geçerli" ilan ederdi. `tsc --noEmit` bunu göremez: derlenip derlenmediğine
 * bakar, ne doğruladığına değil.
 *
 * Bu test o bağın yerinde durduğunu doğrular. Katman derlenmeden okunuyor
 * (depoda TS çalışma zamanı yok); aranan şey davranış değil, KAYNAĞIN
 * şemadan türetiyor olması.
 */
function testTypedReaderDerivesItsRulesFromTheSchema() {
  const source = read("lib/analysis/ruleRegistry.ts");

  assert.ok(
    /import schemaDocument from "\.\.\/\.\.\/rules\/schema\.json"/.test(source),
    "tipli okuyucu rules/schema.json dosyasını okumalı"
  );
  assert.ok(
    /schemaDocument\.definitions\.rule\b[\s\S]{0,400}?\.required/.test(source),
    "zorunlu kural alanları şemadan türetilmeli"
  );
  assert.ok(
    /schemaDocument\.definitions\.domain\.required/.test(source),
    "zorunlu alan (domain) alanları şemadan türetilmeli"
  );
  assert.ok(
    /definitions\.rule[\s\S]{0,400}?\.properties/.test(source),
    "alanın türü (dize / dizi) de şemadan okunmalı"
  );

  // Elle sayılmış bir liste geri gelmemeli: şemadaki alan adlarından üç ya da
  // daha fazlası ARDIŞIK dize sabiti olarak yazılmışsa bu ikinci bir tanımdır.
  const hardcoded = source.match(/\[\s*(?:"[a-zA-Z]+"\s*,\s*){2,}"[a-zA-Z]+"\s*\]/g) || [];
  for (const literal of hardcoded) {
    const names = literal.match(/"([a-zA-Z]+)"/g).map((value) => value.replace(/"/g, ""));
    const fromSchema = names.filter((name) => schema.definitions.rule.required.includes(name));
    assert.ok(
      fromSchema.length < 3,
      `lib/analysis/ruleRegistry.ts şema alanlarını elle sayıyor: ${literal}`
    );
  }

  // Katmanın giriş noktası doğrulayıcıyı gerçekten dışa aktarmalı; aksi hâlde
  // "defter doğrulanıyor" cümlesinin karşılığı olmaz.
  const index = read("lib/analysis/index.ts");
  for (const symbol of ["registryProblems", "isRuleRegistry", "getRegistry"]) {
    assert.ok(index.includes(symbol), `lib/analysis/index.ts eksik: ${symbol}`);
  }
}

/* ------------------------------------------------------------------ */

const tests = [
  testRegistryMatchesSchema,
  testCatalogueIsGeneratedFromTheRegistry,
  testTypedReaderDerivesItsRulesFromTheSchema,
  testRuleIdentityIsUnique,
  testEveryRulePointsAtRealCode,
  testEveryDeclaredTestExists,
  testThresholdsMatchTheirSource,
  testReportStatusTemplateMatchesService,
  testTrustLabelTemplateMatchesService,
  testAwaitingTemplateMatchesServices,
  testVerifyRegistryPasses,
  testBrainStateCarriesNoInventedNumbers,
  testAdminPanelIsHiddenFromSearch,
  testAdminPanelSpeaksTurkish,
  testAdminPanelPrintsOnlyMeasuredNumbers,
  testVocabularyHasNoBettingLanguage,
  testCachePoliciesAreDeclared,
  testAnalysisBrainEndpoint,
  testReportStatusEndpoint
];

for (const test of tests) {
  await test();
}

console.log(`Analysis brain tests passed (${tests.length} senaryo: şema uyumu, benzersiz kimlik, ` +
  "gerçek modül ve entry, var olan test dosyası, kaynakla eşleşen eşikler, rapor durumu şablonu, " +
  "güven etiketi şablonu, bekleme metinleri, defter denetimi, uydurma sayı yok, panel gizliliği, " +
  "panelin Türkçesi, ölçülmüş sayı, bahis dili yasağı, önbellek politikaları, beyin ucu, rapor durumu ucu, " +
  "üretilmiş katalog, şemadan türeyen tipli okuyucu) — " +
  `${registry.rules.length} kural / ${registry.domains.length} alan doğrulandı.`);
