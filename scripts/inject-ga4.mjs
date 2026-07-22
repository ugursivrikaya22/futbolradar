import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const placeholderId = "G-XXXXXXXXXX";
const measurementId = String(process.env.GA4_MEASUREMENT_ID || placeholderId).trim() || placeholderId;
const marker = "data-futbolradar-ga4";

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if ([".git", ".agents", ".codex", ".vercel", "node_modules", "work", "outputs"].includes(entry.name)) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      files.push(fullPath);
    }
  }

  return files;
}

function escapeInline(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function analyticsTag(id) {
  const safeId = escapeInline(id);
  const shouldLoad = id !== placeholderId && /^G-[A-Z0-9]+$/i.test(id);
  const loader = shouldLoad
    ? `
    var measurementId = "${safeId}";
    var script = document.createElement("script");
    script.async = true;
    script.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(measurementId);
    document.head.appendChild(script);`
    : "";

  return `  <script ${marker}>
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", "${safeId}", { anonymize_ip: true });${loader}
  </script>`;
}

let injected = 0;
for (const file of walk(root)) {
  if (file.includes(`${path.sep}widgets${path.sep}`)) {
    continue;
  }
  const html = fs.readFileSync(file, "utf8");
  if (html.includes(marker)) {
    continue;
  }

  if (!html.includes("</head>")) {
    console.warn(`Skipped HTML without </head>: ${path.relative(root, file)}`);
    continue;
  }

  const next = html.replace("</head>", `${analyticsTag(measurementId)}\n  </head>`);
  fs.writeFileSync(file, next, "utf8");
  injected += 1;
}

console.log(`GA4 tag checked: ${injected} HTML files updated (${measurementId === placeholderId ? "placeholder" : "configured ID"})`);
