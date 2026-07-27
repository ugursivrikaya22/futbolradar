/**
 * MAÇ SONU ZENGİNLEŞTİRME — SUNUM KATMANI (salt okunur).
 *
 * `data/match-enrichment.json` bugüne kadar hiçbir yerde OKUNMUYORDU:
 * yazıcısı, testi ve dokümanı dışında dosyaya dokunan yoktu. Yani kuru
 * koşunun ürettiği kayıt, yazılsa bile hiçbir sayfaya ulaşmayacaktı. Bu
 * modül o boşluğu kapatıyor.
 *
 * Modül SAF: dosya okumaz, ağ çağırmaz, hiçbir şey yazmaz. Girdi olarak
 * tek bir zenginleştirme kaydı alır, HTML döndürür.
 *
 * Üç kural, sırayla:
 *
 *   1. KAYIT YOKSA BÖLÜM DE YOK. Zenginleştirilmemiş maçın raporunda boş
 *      bir "veri bekleniyor" kutusu açmıyoruz; o maç için sağlayıcıdan
 *      veri İSTENMEDİ, gelmemiş değil. İkisi farklı şeyler.
 *   2. DOLU BÖLÜM KÖKENİNİ TAŞIR. Hangi sağlayıcı, hangi fikstür, ne
 *      zaman gözlendi — üçü birden yazılır. Kökensiz sayı basılmaz.
 *   3. EKSİK BÖLÜM SAYI TAŞIMAZ. "0 diziliş" ile "diziliş verisi gelmedi"
 *      aynı şey değil; birincisi ölçüm iddiasıdır. Eksik bölüm için
 *      HİÇBİR rakam üretilmez, yalnızca bekleme cümlesi yazılır.
 */

const SECTION_ORDER = ["summary", "goals", "events", "lineups", "teamStats", "playerStats"];

const STATUS_LABELS = {
  complete: "Tüm bölümler doğrulandı",
  partial: "Kısmi doğrulanmış veri",
  unavailable: "Doğrulanmış veri bekleniyor"
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatObservedAt(value) {
  const parsed = new Date(String(value || ""));
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat("tr-TR", {
    day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul"
  }).format(parsed);
}

/**
 * Dolu bir bölümün ÖLÇÜLMÜŞ büyüklüğü.
 *
 * Yalnızca gerçekten sayılabilen şeyi sayar. Sayılamıyorsa null döner ve
 * çağıran taraf hiçbir rakam basmaz — uydurma bir "0" üretmez.
 */
function measuredCount(key, value) {
  if (value === null || value === undefined) return null;
  if (key === "teamStats") {
    const rows = Array.isArray(value.statistics) ? value.statistics.length : 0;
    return rows > 0 ? `${rows} istatistik satırı` : null;
  }
  if (key === "playerStats") {
    const players = (Array.isArray(value) ? value : [])
      .reduce((total, team) => total + ((team && Array.isArray(team.players) ? team.players.length : 0)), 0);
    return players > 0 ? `${players} oyuncu` : null;
  }
  if (key === "lineups") {
    return Array.isArray(value) && value.length ? `${value.length} takım kadrosu` : null;
  }
  if (key === "goals") {
    return Array.isArray(value) && value.length ? `${value.length} gol` : null;
  }
  if (key === "events") {
    return Array.isArray(value) && value.length ? `${value.length} olay` : null;
  }
  // summary: sayılabilir bir büyüklüğü yok, kökeni var.
  return null;
}

function provenanceLine(section) {
  const provenance = section && section.provenance;
  if (!provenance) return "";
  const observed = formatObservedAt(provenance.observedAt);
  const parts = [escapeHtml(provenance.source)];
  if (provenance.fixtureId) parts.push(`fikstür ${escapeHtml(String(provenance.fixtureId))}`);
  if (observed) parts.push(escapeHtml(observed));
  return `<small class="enrichment-provenance">${parts.join(" · ")}</small>`;
}

function sectionRow(section) {
  if (!section) return "";
  const label = escapeHtml(section.label || section.key);

  if (section.status === "ready") {
    // Rakam yalnızca ÖLÇÜLDÜĞÜNDE basılır; ölçülemiyorsa satır rakamsız kalır.
    const count = measuredCount(section.key, section.value);
    const measure = count ? `<span class="enrichment-measure">${escapeHtml(count)}</span>` : "";
    return `<li class="enrichment-row is-ready" data-section="${escapeHtml(section.key)}" data-status="ready">
      <span class="enrichment-label">${label}</span>
      ${measure}
      ${provenanceLine(section)}
    </li>`;
  }

  // EKSİK BÖLÜM: hiçbir rakam yok, yalnızca ne beklendiğini söyleyen cümle.
  const message = section.message || `${section.label} için doğrulanmış veri gelmedi.`;
  return `<li class="enrichment-row is-awaiting" data-section="${escapeHtml(section.key)}" data-status="awaiting">
    <span class="enrichment-label">${label}</span>
    <small class="enrichment-awaiting">${escapeHtml(message)}</small>
  </li>`;
}

/**
 * Tek bir maçın zenginleştirme bölümünü üretir.
 *
 * @param {object|null} enrichment data/match-enrichment.json'daki kayıt
 * @returns {string} HTML; kayıt yoksa boş dize
 */
function enrichmentSection(enrichment) {
  if (!enrichment || !enrichment.sections) return "";

  const sections = SECTION_ORDER
    .map((key) => enrichment.sections[key])
    .filter(Boolean);
  if (!sections.length) return "";

  const filled = Number(enrichment.filledSections) || 0;
  const total = Number(enrichment.totalSections) || SECTION_ORDER.length;
  const coverage = Number(enrichment.coverage) || 0;
  const statusLabel = STATUS_LABELS[enrichment.dataStatus] || STATUS_LABELS.unavailable;

  const partial = enrichment.partialMessage
    ? `<p class="enrichment-partial">${escapeHtml(enrichment.partialMessage)}</p>`
    : "";

  const fixtureLine = enrichment.fixtureId
    ? `<small class="enrichment-fixture">API-Football fikstür kimliği: ${escapeHtml(String(enrichment.fixtureId))}</small>`
    : "";

  return `<section class="post-match-section enrichment-section" aria-labelledby="rapor-saglayici-veri"
    data-enrichment-status="${escapeHtml(enrichment.dataStatus || "unavailable")}"
    data-enrichment-coverage="${escapeHtml(String(coverage))}">
    <div class="section-head"><div class="section-title">
      <span class="section-kicker">Sağlayıcı verisi</span>
      <h2 id="rapor-saglayici-veri">Doğrulanmış maç sonu verisi</h2>
      <p>Bölüm bölüm hangi verinin sağlayıcıdan doğrulandığı, hangisinin beklendiği.</p>
    </div></div>
    <article class="card enrichment-card">
      <p class="enrichment-coverage"><strong>${escapeHtml(statusLabel)}</strong> · ${escapeHtml(String(filled))}/${escapeHtml(String(total))} bölüm (%${escapeHtml(String(coverage))})</p>
      ${partial}
      <ul class="enrichment-list">${sections.map(sectionRow).join("")}</ul>
      ${fixtureLine}
    </article>
  </section>`;
}

module.exports = {
  SECTION_ORDER,
  STATUS_LABELS,
  measuredCount,
  enrichmentSection
};
