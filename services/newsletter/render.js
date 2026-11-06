/** Bülten e-postası: duyarlı HTML (tablo + satır içi stil) ve düz metin, Türkçe. */
function esc(v) {
  return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
const TZ = "Europe/Istanbul";
const dayLabel = (iso) => new Date(iso).toLocaleDateString("tr-TR", { day: "numeric", month: "long", timeZone: TZ });
const dayTime = (iso) => new Date(iso).toLocaleString("tr-TR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TZ });
const withUtm = (url) => url + (url.includes("?") ? "&" : "?") + "utm_source=bulten&utm_medium=email&utm_campaign=haftalik";

function subject(issue) {
  return `FutbolRadar Süper Lig haftalık bülten · ${dayLabel(issue.range.to)}`;
}

function renderHtml(issue, { name = "", unsubscribeUrl = "#" } = {}) {
  const site = issue.site;
  const greeting = name ? `Merhaba ${esc(name)},` : "Merhaba,";
  const cell = "padding:8px 6px;border-bottom:1px solid #e6ece9;font-size:14px;";
  const results = issue.results.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${issue.results.map((r) => `<tr><td style="${cell}color:#6b7c76;white-space:nowrap;width:1%">${esc(dayTime(r.kickoff))}</td><td style="${cell}text-align:right">${esc(r.homeTeam)}</td><td style="${cell}text-align:center;font-weight:700;white-space:nowrap;width:1%">${esc(r.home)} – ${esc(r.away)}</td><td style="${cell}">${esc(r.awayTeam)}</td></tr>`).join("")}</table>`
    : `<p style="font-size:14px;color:#6b7c76;margin:0">Bu hafta doğrulanmış Süper Lig sonucu yok.</p>`;
  const st = issue.standings.rows;
  const standings = st.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr><th align="left" style="${cell}color:#6b7c76;font-weight:600">#</th><th align="left" style="${cell}color:#6b7c76;font-weight:600">Takım</th><th style="${cell}color:#6b7c76;font-weight:600">O</th><th style="${cell}color:#6b7c76;font-weight:600">Av</th><th style="${cell}color:#6b7c76;font-weight:600">P</th></tr>${st.map((r) => `<tr><td style="${cell}width:1%">${esc(r.rank)}</td><td style="${cell}">${esc(r.team)}</td><td style="${cell}text-align:center">${esc(r.played ?? "")}</td><td style="${cell}text-align:center">${r.goalDifference == null ? "" : esc(r.goalDifference > 0 ? "+" + r.goalDifference : r.goalDifference)}</td><td style="${cell}text-align:center;font-weight:700">${esc(r.points)}</td></tr>`).join("")}</table>${issue.standings.updatedAt ? `<p style="font-size:12px;color:#6b7c76;margin:6px 0 0">Son güncelleme: ${esc(new Date(issue.standings.updatedAt).toLocaleString("tr-TR", { timeZone: TZ }))} TSİ</p>` : ""}`
    : `<p style="font-size:14px;color:#6b7c76;margin:0">Puan durumu şu an mevcut değil.</p>`;
  const columns = issue.columns.length
    ? issue.columns.map((c) => `<div style="padding:10px 0;border-bottom:1px solid #e6ece9"><a href="${esc(withUtm(c.href))}" style="color:#086a43;font-weight:700;font-size:15px;text-decoration:none">${esc(c.title)}</a>${c.excerpt ? `<p style="margin:4px 0 0;font-size:13px;color:#3f4f49;line-height:1.45">${esc(c.excerpt)}</p>` : ""}<p style="margin:4px 0 0;font-size:12px;color:#6b7c76">${esc(dayLabel(c.date))}</p></div>`).join("")
    : `<p style="font-size:14px;color:#6b7c76;margin:0">Bu hafta yeni köşe yazısı yok.</p>`;
  const h2 = "font-size:17px;margin:24px 0 8px;color:#0f1c17";
  return `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(subject(issue))}</title></head>
<body style="margin:0;padding:0;background:#f4f7f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f1c17">
<div style="display:none;max-height:0;overflow:hidden">Haftanın Süper Lig sonuçları, puan durumu ve köşe yazıları.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7f5"><tr><td align="center" style="padding:16px 8px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:14px">
<tr><td style="padding:20px 20px 0"><a href="${esc(withUtm(site + "/"))}" style="text-decoration:none;font-size:20px;color:#0f1c17"><b style="color:#0b8f5a">Futbol</b>Radar</a><p style="margin:4px 0 0;font-size:12px;color:#6b7c76">Süper Lig haftalık bülten · ${esc(dayLabel(issue.range.from))} – ${esc(dayLabel(issue.range.to))}</p></td></tr>
<tr><td style="padding:12px 20px 20px">
<p style="font-size:15px;margin:8px 0">${greeting} haftanın Süper Lig özeti aşağıda.</p>
<h2 style="${h2}">⚽ Haftanın sonuçları</h2>${results}
<h2 style="${h2}">📊 Puan durumu</h2>${standings}
<p style="margin:10px 0 0"><a href="${esc(withUtm(site + "/super-lig-puan-durumu.html"))}" style="color:#086a43;font-size:14px">Tam puan durumu →</a></p>
<h2 style="${h2}">✍️ Köşe yazıları</h2>${columns}
<p style="margin:20px 0 0;text-align:center"><a href="${esc(withUtm(site + "/"))}" style="display:inline-block;background:#0b8f5a;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px">FutbolRadar'a git</a></p>
</td></tr>
<tr><td style="padding:16px 20px;border-top:1px solid #e6ece9;font-size:12px;color:#6b7c76;line-height:1.5">
Bu e-postayı FutbolRadar haftalık bültenine onaylı (çift onay) abone olduğunuz için alıyorsunuz. Veriler futbolradar.com'daki mevcut maç ve puan durumu kayıtlarından otomatik derlenir.<br>
<a href="${esc(unsubscribeUrl)}" style="color:#6b7c76">Abonelikten tek tıkla çık</a> · <a href="${esc(site)}/gizlilik.html" style="color:#6b7c76">Gizlilik / KVKK</a> · <a href="${esc(site)}/iletisim.html" style="color:#6b7c76">İletişim</a><br>FutbolRadar · futbolradar.com
</td></tr></table></td></tr></table></body></html>`;
}

function renderText(issue, { name = "", unsubscribeUrl = "" } = {}) {
  const lines = [];
  lines.push(`FutbolRadar · Süper Lig haftalık bülten (${dayLabel(issue.range.from)} – ${dayLabel(issue.range.to)})`, "");
  lines.push(name ? `Merhaba ${name},` : "Merhaba,", "", "HAFTANIN SONUÇLARI");
  if (issue.results.length) issue.results.forEach((r) => lines.push(`- ${dayTime(r.kickoff)}  ${r.homeTeam} ${r.home}-${r.away} ${r.awayTeam}`));
  else lines.push("- Bu hafta doğrulanmış Süper Lig sonucu yok.");
  lines.push("", "PUAN DURUMU");
  if (issue.standings.rows.length) issue.standings.rows.forEach((r) => lines.push(`${String(r.rank).padStart(2)}. ${r.team} — ${r.points} puan (${r.played ?? "-"} maç)`));
  else lines.push("Puan durumu şu an mevcut değil.");
  lines.push(`Tam tablo: ${issue.site}/super-lig-puan-durumu.html`, "", "KÖŞE YAZILARI");
  if (issue.columns.length) issue.columns.forEach((c) => lines.push(`- ${c.title}`, `  ${c.href}`));
  else lines.push("- Bu hafta yeni köşe yazısı yok.");
  lines.push("", `${issue.site}/`, "", "Bu e-postayı FutbolRadar haftalık bültenine onaylı abone olduğunuz için alıyorsunuz.", `Abonelikten çık: ${unsubscribeUrl}`, `Gizlilik / KVKK: ${issue.site}/gizlilik.html`);
  return lines.join("\n");
}

function confirmEmail({ name = "", confirmUrl, site }) {
  const hi = name ? `Merhaba ${name},` : "Merhaba,";
  return {
    subject: "FutbolRadar bülten aboneliğini onayla",
    html: `<!doctype html><html lang="tr"><body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f4f7f5;padding:16px"><div style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;padding:20px"><p>${esc(hi)}</p><p>FutbolRadar haftalık Süper Lig bültenine abone olmak için aşağıdaki düğmeye dokun. Bağlantı 48 saat geçerlidir.</p><p style="text-align:center"><a href="${esc(confirmUrl)}" style="display:inline-block;background:#0b8f5a;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px">Aboneliği onayla</a></p><p style="font-size:12px;color:#6b7c76">Bu isteği sen yapmadıysan e-postayı yok say; onaylanmayan adreslere bülten gönderilmez. <a href="${esc(site)}/gizlilik.html">Gizlilik / KVKK</a></p></div></body></html>`,
    text: `${hi}\n\nFutbolRadar haftalık Süper Lig bültenine abone olmak için bu bağlantıyı aç (48 saat geçerli):\n${confirmUrl}\n\nBu isteği sen yapmadıysan e-postayı yok say.\n${site}/gizlilik.html`
  };
}

module.exports = { subject, renderHtml, renderText, confirmEmail, withUtm };
