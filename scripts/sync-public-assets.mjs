import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const publicDir = path.join(root, "public");
for (const file of ["page.css", "app.js", "site.js", "site.webmanifest"]) {
  fs.copyFileSync(path.join(root, file), path.join(publicDir, file));
}
console.log("Synced public assets");
