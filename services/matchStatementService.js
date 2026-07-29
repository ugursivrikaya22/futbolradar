/**
 * MAÇ SONU AÇIKLAMALARI — tek yetkili kural.
 *
 * Teknik direktör ve futbolcu sözleri iki yerde gösteriliyor: üst haber
 * bandında ve maç sayfalarındaki "Maç Sonu Açıklamaları" bölümünde. Kural
 * iki yerde ayrı yazılsaydı biri gevşediğinde diğeri fark etmez, bant ile
 * maç sayfası farklı şeyler söylerdi. Yayımlanabilirlik kararı SADECE
 * burada verilir.
 *
 * YAYIN KURALI — hatırlanan söz yayımlanmaz:
 *
 *   1. status "verified" olmalı. "draft" kayıt hiçbir yüzeyde görünmez.
 *   2. İzlenebilir kaynak olmalı: url (http/https) VE sourceName. Sözün
 *      nerede yayımlandığı gösterilemiyorsa söz de gösterilmez.
 *   3. Kimlik alanları tam olmalı: konuşan, rol, takım, söz, maç, tarih.
 *   4. Tarih okunabilir olmalı — "maç sonu" bir zaman iddiasıdır.
 *
 * Kural tutmazsa kayıt SESSİZCE atlanmaz, gerekçesiyle iç günlüğe yazılır.
 *
 * VERİ YOKSA: data/statements.json bugün boş. Bu bir hata değil, ölçülen
 * durum. Boşken "veri bekleniyor" yazılır; bölüm gizlenmez ve içine
 * temsili söz üretilmez.
 *
 * SONRADAN API: buradaki tek giriş noktası `publishableStatements`.
 * Sağlayıcı bağlandığında yalnızca `options.statements` ile beslenir;
 * kural ve sunum katmanı hiç değişmez.
 */

const fs = require("node:fs");
const path = require("node:path");

/** Yalnızca bu durum yayımlanır. */
const PUBLISHABLE_STATUS = "verified";

/** Kaynağı ya da kimliği eksik söz yayımlanmaz. */
const REQUIRED_FIELDS = ["matchId", "speaker", "role", "team", "quote", "publishedAt", "sourceName", "url"];

/** Tanınan roller. Bilinmeyen rol, etiketi uydurmak yerine reddedilir. */
const ROLES = Object.freeze({
  coach: "Teknik direktör",
  player: "Futbolcu",
  club: "Kulüp",
  official: "Yetkili"
});

function readStatements() {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), "data", "statements.json"), "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return Array.isArray(parsed && parsed.statements) ? parsed.statements : [];
  } catch {
    // Dosya yoksa ya da bozuksa bölüm "veri bekleniyor" der; çağıran çökmez.
    return [];
  }
}

function isTraceableUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Tek bir açıklamanın yayımlanabilirliği.
 * @returns {{publishable: boolean, reason: string}}
 */
function evaluateStatement(statement) {
  if (!statement || typeof statement !== "object") {
    return { publishable: false, reason: "kayıt yok" };
  }

  const status = String(statement.status || "").toLowerCase();
  if (status !== PUBLISHABLE_STATUS) {
    return { publishable: false, reason: `durum doğrulanmış değil: ${status || "belirtilmemiş"}` };
  }

  const missing = REQUIRED_FIELDS.filter((field) => !String(statement[field] ?? "").trim());
  if (missing.length) {
    return { publishable: false, reason: `zorunlu alan eksik: ${missing.join(", ")}` };
  }

  if (!ROLES[String(statement.role).toLowerCase()]) {
    return { publishable: false, reason: `tanınmayan rol: ${statement.role}` };
  }

  if (!isTraceableUrl(statement.url)) {
    return { publishable: false, reason: "kaynak bağlantısı izlenebilir değil" };
  }

  if (Number.isNaN(Date.parse(statement.publishedAt))) {
    return { publishable: false, reason: "yayım tarihi okunamıyor" };
  }

  return { publishable: true, reason: "" };
}

/** Rol etiketi. Bilinmeyen rol buraya hiç ulaşmaz (evaluateStatement eler). */
function roleLabel(role) {
  return ROLES[String(role || "").toLowerCase()] || "Açıklama";
}

/**
 * Aynı sözün iki kaynaktan gelmesi mümkün (kulüp sitesi + haber kaynağı).
 * Kimlik konuşan + maç + sözün ilk cümlesi üzerinden kurulur.
 */
function statementIdentity(statement) {
  return [
    String(statement.matchId).trim().toLowerCase(),
    String(statement.speaker).trim().toLocaleLowerCase("tr"),
    String(statement.quote).trim().toLocaleLowerCase("tr").slice(0, 80)
  ].join("|");
}

/**
 * Yayımlanabilir açıklamalar, tekilleştirilmiş ve yeniden eskiye sıralı.
 * @returns {{statements: Array, excluded: Array, duplicates: Array}}
 */
function publishableStatements(options = {}) {
  const source = Array.isArray(options.statements) ? options.statements : readStatements();
  const excluded = [];
  const duplicates = [];
  const byIdentity = new Map();

  for (const statement of source) {
    const verdict = evaluateStatement(statement);
    if (!verdict.publishable) {
      excluded.push({ id: (statement && statement.id) || "?", reason: verdict.reason });
      continue;
    }

    const identity = statementIdentity(statement);
    const existing = byIdentity.get(identity);
    if (existing) {
      duplicates.push({ id: statement.id, keptId: existing.id });
      continue;
    }

    byIdentity.set(identity, statement);
  }

  const statements = [...byIdentity.values()]
    .map((statement) => ({
      id: String(statement.id || statementIdentity(statement)),
      matchId: String(statement.matchId).trim(),
      speaker: String(statement.speaker).trim(),
      role: String(statement.role).toLowerCase(),
      roleLabel: roleLabel(statement.role),
      team: String(statement.team).trim(),
      quote: String(statement.quote).trim(),
      context: String(statement.context || "").trim(),
      publishedAt: statement.publishedAt,
      sourceName: String(statement.sourceName).trim(),
      url: statement.url
    }))
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));

  return { statements, excluded, duplicates };
}

/**
 * Tek bir maçın açıklamaları. Maç sayfası bunu çağırır; boş dizi dönmesi
 * normaldir ve sunum katmanı bunu "veri bekleniyor" olarak yazar.
 */
function statementsForMatch(matchId, options = {}) {
  const wanted = String(matchId || "").trim().toLowerCase();
  if (!wanted) return [];
  const { statements } = options.prepared || publishableStatements(options);
  return statements.filter((statement) => statement.matchId.toLowerCase() === wanted);
}

/** Elenen kayıtlar sessizce kaybolmasın: gerekçe iç günlüğe düşer. */
function logExcludedStatements(surface, excluded) {
  if (!Array.isArray(excluded) || !excluded.length) return;
  for (const item of excluded) {
    console.warn(`[statements:${surface}] "${item.id}" yayımlanmadı — ${item.reason}`);
  }
}

module.exports = {
  PUBLISHABLE_STATUS,
  REQUIRED_FIELDS,
  ROLES,
  evaluateStatement,
  logExcludedStatements,
  publishableStatements,
  readStatements,
  roleLabel,
  statementsForMatch
};
