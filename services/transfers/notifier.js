/**
 * BİLDİRİCİ — sessiz başarısızlığı imkânsız kılar.
 *
 * Hattın çıktısı yalnızca yayımlanan transferler değil; NE OLMADIĞI da
 * çıktıdır. Bir kaynak düştüğünde, bir kayıt ayrıştırılamadığında ya da
 * resmî bir transfer yalanlandığında biri haberdar olmalı.
 *
 * İki kanal, ikisi de zorunlu değil ama ikisi de sessiz kalmaz:
 *   • Telegram — projenin zaten kullandığı mekanizma (services/telegramNotifier).
 *     Değişkenler tanımlı değilse GÖNDERİLMEZ ama koşu çökmez ve eksik
 *     değişkenin adı koşu özetine yazılır.
 *   • Koşu özeti — GitHub Actions job summary'sine yazılan markdown. Telegram
 *     yoksa bile olay kaydı bir yerde durur.
 */

const { statusLabel } = require("./statusModel.js");

/** Bildirim gerektiren olaylar. Her biri bir sebep taşır. */
const EVENTS = Object.freeze({
  major_official: { severity: "info", title: "Büyük kulüpten resmî transfer" },
  rumor_to_official: { severity: "info", title: "İddia resmîleşti" },
  official_denied: { severity: "warn", title: "Resmî kayıt yalanlandı/iptal edildi" },
  source_unreachable: { severity: "warn", title: "Kaynak okunamadı" },
  parse_failed: { severity: "warn", title: "Kayıt ayrıştırılamadı" },
  duplicate_uncertain: { severity: "warn", title: "Tekilleştirme belirsiz" },
  automation_failed: { severity: "error", title: "Otomasyon hatası" }
});

const MAJOR_CLUBS = ["Galatasaray", "Fenerbahçe", "Beşiktaş", "Trabzonspor"];

function isMajorClub(name) {
  const { fold } = require("./normalizer.js");
  const target = fold(name);
  return MAJOR_CLUBS.some((club) => fold(club) === target);
}

/**
 * Koşu sonucundan bildirilecek olayları çıkarır.
 * @returns {Array<{event: string, severity: string, message: string}>}
 */
function collectEvents(runReport) {
  const events = [];
  const report = runReport || {};

  for (const failure of report.sourceFailures || []) {
    events.push({
      event: "source_unreachable",
      severity: EVENTS.source_unreachable.severity,
      message: `${failure.sourceId}: ${failure.error}`
    });
  }

  for (const item of report.rejected || []) {
    events.push({
      event: "parse_failed",
      severity: EVENTS.parse_failed.severity,
      message: `${item.playerName || "(oyuncusuz)"}: ${(item.reasons || []).join("; ")}`
    });
  }

  for (const item of report.quarantined || []) {
    events.push({
      event: "duplicate_uncertain",
      severity: EVENTS.duplicate_uncertain.severity,
      message: `${item.playerName || "(oyuncusuz)"}: ${(item.reasons || []).join("; ")}`
    });
  }

  for (const change of report.statusChanges || []) {
    if (change.to === "official") {
      const major = isMajorClub(change.toTeam) || isMajorClub(change.fromTeam);
      events.push({
        event: change.from && change.from !== "official" ? "rumor_to_official" : "major_official",
        severity: "info",
        message:
          `${change.playerName}: ${statusLabel(change.from) || "yeni"} -> ${statusLabel(change.to)}` +
          `${major ? " (büyük kulüp)" : ""}`
      });
    }
    if (change.to === "denied" || change.to === "cancelled") {
      events.push({
        event: "official_denied",
        severity: EVENTS.official_denied.severity,
        message: `${change.playerName}: ${statusLabel(change.from)} -> ${statusLabel(change.to)}`
      });
    }
  }

  if (report.failed) {
    events.push({
      event: "automation_failed",
      severity: EVENTS.automation_failed.severity,
      message: String(report.failureReason || "bilinmeyen hata")
    });
  }

  return events;
}

/** GitHub Actions koşu özeti için markdown. */
function summaryMarkdown(runReport, events) {
  const report = runReport || {};
  const lines = [
    "## Transfer otomasyonu koşusu",
    "",
    `- Koşu: \`${report.cadence || "-"}\` · ${report.startedAt || "-"}`,
    `- Yoklanan kaynak: ${report.sourcesChecked ?? 0} (başarısız: ${(report.sourceFailures || []).length})`,
    `- Yeni transfer: ${report.created ?? 0} · güncellenen: ${report.updated ?? 0}`,
    `- Yinelenen atlandı: ${report.duplicatesSkipped ?? 0} · reddedilen: ${(report.rejected || []).length} · karantina: ${(report.quarantined || []).length}`,
    `- Ortalama alım gecikmesi: ${report.averageDelaySeconds ?? "-"} sn`,
    ""
  ];

  if (report.latestOfficial) {
    lines.push(`- Son resmî transfer: **${report.latestOfficial}**`, "");
  }

  if (!events.length) {
    lines.push("Bildirilecek olay yok.");
    return lines.join("\n");
  }

  lines.push("### Olaylar", "");
  for (const event of events) {
    const icon = event.severity === "error" ? "🔴" : event.severity === "warn" ? "🟠" : "🟢";
    lines.push(`- ${icon} **${EVENTS[event.event]?.title || event.event}** — ${event.message}`);
  }

  return lines.join("\n");
}

/** Telegram mesajı: kısa, olay odaklı. */
function telegramText(runReport, events) {
  const notable = events.filter((event) => event.severity !== "info" || event.event !== "parse_failed");
  if (!notable.length) return "";

  const lines = ["*Transfer otomasyonu*", ""];
  for (const event of notable.slice(0, 12)) {
    lines.push(`• ${EVENTS[event.event]?.title || event.event}: ${event.message}`);
  }
  if (notable.length > 12) lines.push(`• ... ve ${notable.length - 12} olay daha`);
  return lines.join("\n");
}

/**
 * Bildirimleri gönderir. HİÇBİR KOŞULDA fırlatmaz — bildirim gönderilememesi
 * alım hattını düşürmemeli; ama sonucu döner ki çağıran özete yazsın.
 */
async function notify(runReport, options = {}) {
  const events = collectEvents(runReport);
  const summary = summaryMarkdown(runReport, events);
  const result = { events, summary, telegram: { sent: false, reason: "" } };

  const text = telegramText(runReport, events);
  if (!text) {
    result.telegram.reason = "bildirilecek olay yok";
    return result;
  }

  try {
    const { sendTelegramMessage, telegramConfig } = require("../telegramNotifier.js");
    const config = telegramConfig(options.env);
    if (!config.ready) {
      result.telegram.reason = `eksik değişken: ${config.missing.join(", ")}`;
      return result;
    }
    const sent = await sendTelegramMessage(
      { text, parseMode: "Markdown" },
      { env: options.env, dryRun: options.dryRun }
    );
    result.telegram.sent = Boolean(sent && sent.sent);
    result.telegram.reason = sent && sent.reason ? sent.reason : "";
  } catch (error) {
    result.telegram.reason = String((error && error.message) || error);
  }

  return result;
}

module.exports = {
  EVENTS,
  MAJOR_CLUBS,
  collectEvents,
  isMajorClub,
  notify,
  summaryMarkdown,
  telegramText
};
