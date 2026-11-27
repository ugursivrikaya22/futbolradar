"use strict";

const clock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23"
});
const months = "ocak subat mart nisan mayis haziran temmuz agustos eylul ekim kasim aralik".split(" ");
const weekdays = "pazartesi|sali|carsamba|persembe|cuma|cumartesi|pazar";
const dateHeading = new RegExp("^([0-9]{1,2}) (" + months.join("|") + ") ([0-9]{4})(?: (?:" + weekdays + "))?$");
const incompleteHeading = new RegExp("^(?:" + weekdays + ")$|^[0-9]{1,2} (?:" + months.join("|") + ")\\b");

function key(s) {
  return String(s || "").normalize("NFD").replace(/\p{M}/gu, "").replace(/ı/g, "i").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim();
}

const aliases = new Map([
  ["c rizespor", "rizespor"], ["caykur rizespor", "rizespor"],
  ["corendon alanyaspor", "alanyaspor"], ["tumosan konyaspor", "konyaspor"]
]);
function teamKey(s) {
  const name = key(s).replace(/^(?:fc|ac|cf|sc|sk) /, "")
    .replace(/ (?:spor kulubu|kulubu|sk|as|fk|fc|cf|ac|sc)$/, "");
  return aliases.get(name) || name;
}

function dateKey(text) {
  const m = dateHeading.exec(key(text));
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? text
    : m && [m[3], String(months.indexOf(m[2]) + 1).padStart(2, "0"), m[1].padStart(2, "0")].join("-");
  if (!date) return "";
  const parsed = new Date(date + "T12:00:00Z");
  return Number.isFinite(+parsed) && parsed.toISOString().startsWith(date + "T") ? date : "";
}

function programmeLines(html) {
  // Inline markup stays inside its row; neighbouring block text never joins it.
  const input = String(html || "");
  const entities = { nbsp: " ", amp: "&", ndash: "–", mdash: "—", vert: "|",
    ccedil: "ç", scedil: "ş", uuml: "ü", ouml: "ö", gbreve: "ğ", inodot: "ı" };
  return (/<[a-z][^>]*>/i.test(input) ? input.replace(/\r?\n/g, " ") : input)
    .replace(/<!--[\s\S]*?-->|<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<\/(?:td|th)\s*>/gi, " | ")
    .replace(/<\/?(?:article|section|main|header|footer|nav|div|p|li|ul|ol|tr|h[1-6]|br)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:#([0-9]+)|#x([0-9a-f]+)|([a-z][a-z0-9]*));/gi, (all, dec, hex, name) => {
      if (name) {
        const v = Object.hasOwn(entities, name.toLowerCase()) ? entities[name.toLowerCase()] : "";
        return v ? (name[0] === name[0].toUpperCase() ? v.toUpperCase() : v) : all;
      }
      const cp = dec ? Number(dec) : parseInt(hex, 16);
      return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : all;
    })
    .split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function readChannel(broadcaster, field) {
  const label = field.replace(/\s+/g, " ").trim();
  if (broadcaster?.key === "bein-sports") {
    const m = /^bein\s*sports?\s+(max\s+[1-9]\d*|[1-9]\d*|haber)(?:\s*[-–—]\s*4k)?$/i.exec(label);
    return m ? "beIN SPORTS " + m[1].toUpperCase() : (/^bein\s*connect$/i.test(label) ? "beIN CONNECT" : "");
  }
  const channels = {
    trt: { "trt 1": "TRT 1", "trt spor": "TRT Spor", "trt spor yildiz": "TRT Spor Yıldız" },
    tabii: { tabii: "Tabii", "tabii spor": "Tabii Spor" },
    "s-sport": { "s sport": "S Sport", "s sport 2": "S Sport 2", "s sport plus": "S Sport Plus" },
    exxen: { exxen: "Exxen" }
  };
  const options = channels[broadcaster?.key] || {};
  return Object.hasOwn(options, key(label)) ? options[key(label)] : "";
}

function programmeRows(html, broadcaster) {
  const rows = [];
  let headingDate = "";
  for (const line of programmeLines(html)) {
    const fields = line.split("|").map((field) => field.trim());
    if (fields.length > 1 && fields.at(-1) === "") fields.pop();
    if (fields.length === 1) {
      const heading = dateKey(fields[0]);
      if (heading || incompleteHeading.test(key(fields[0])) || /^\d{4}-\d{2}-\d{2}$/.test(fields[0])) headingDate = heading;
      continue;
    }
    const explicitDate = fields.length >= 4 ? dateKey(fields[0]) : "";
    if (explicitDate) fields.shift();
    const date = explicitDate || headingDate;
    if (!date || fields.length < 3 || fields.length > 4) continue;
    const time = /^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(fields[0]) ? fields[0].padStart(5, "0") : "";
    const sides = fields.length === 4 ? fields.slice(1, 3) : fields[1].split(/\s+-\s+|\s*[–—]\s*/u);
    const channel = readChannel(broadcaster, fields.at(-1));
    if (!time || !channel || sides.length !== 2) continue;
    const [home, away] = sides.map(teamKey);
    if (home && away && home !== away) rows.push({ date, time, home, away, channel });
  }
  return rows;
}

function channelForMatch(rows, match, day) {
  const raw = String(match?.kickoff || "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(raw)) return "";
  const kickoff = new Date(raw);
  if (!Number.isFinite(+kickoff)) return "";
  const parts = Object.fromEntries(clock.formatToParts(kickoff).map(({ type, value }) => [type, value]));
  const date = parts.year + "-" + parts.month + "-" + parts.day;
  if (date !== day) return "";
  const time = parts.hour + ":" + parts.minute;
  const home = teamKey(match.homeTeam);
  const away = teamKey(match.awayTeam);
  const channels = new Set(rows.filter((row) => row.date === date && row.time === time && row.home === home && row.away === away).map((row) => row.channel));
  return channels.size === 1 ? channels.values().next().value : "";
}

module.exports = { programmeRows, channelForMatch };
