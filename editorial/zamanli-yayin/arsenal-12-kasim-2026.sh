#!/usr/bin/env bash
# ZAMANLI YAYIN YARDIMCISI — yalnızca PR #691 dalında durur, main'e girmez.
#
# 12 Kasım 2026 20:00 TSİ'de, sahibin açık onayıyla, Arsenal köşe yazısını
# yayına alır. Taze ve temiz bir main çalışma kopyasında, repo kökünden:
#
#   bash <(git show origin/claude/arsenal-kose-yazisi-12-kasim-2026:editorial/zamanli-yayin/arsenal-12-kasim-2026.sh)
#
# Yaptığı: daldaki kaydı main'in data/columns.json'una `published` olarak
# ekler; sitenin üreticisi + postprocess zinciriyle TR/EN yazı sayfalarını ve
# public kopyalarını üretir; İngilizce köşe listesine (en/columns.html ve
# public kopyası) yalnızca bu yazının kartını ekler; diğer tüm üretim
# gürültüsünü geri alır. Commit ve push ETMEZ.
set -euo pipefail

BRANCH="origin/claude/arsenal-kose-yazisi-12-kasim-2026"
ID="arsenal-futbol-akli-22-yillik-hasret-hale-end-transfer-12-kasim-2026"
EN="arsenals-football-brain-22-year-wait-hale-end-transfers-12-november-2026"
WORK="$(mktemp -d)"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Çalışma kopyası temiz değil; dur." >&2
  exit 1
fi

git show "$BRANCH:data/columns.json" > "$WORK/branch-columns.json"

python3 -I - "$WORK/branch-columns.json" data/columns.json "$ID" <<'PY'
import json, sys
from collections import OrderedDict
from datetime import datetime

src, dst, entry_id = sys.argv[1:4]
branch = json.load(open(src, encoding="utf-8"), object_pairs_hook=OrderedDict)
entry = next(c for c in branch["columns"] if c.get("id") == entry_id)
if entry.get("status") == "archived":
    sys.exit("Daldaki kayıt archived; yayın iptal.")
entry["status"] = "published"
entry["date"] = "2026-11-12T20:00:00+03:00"
when = datetime.fromisoformat(entry["date"])

store = json.load(open(dst, encoding="utf-8"), object_pairs_hook=OrderedDict)
columns = [c for c in store["columns"] if c.get("id") != entry_id]

def stamp(column):
    try:
        return datetime.fromisoformat(column.get("date", ""))
    except ValueError:
        return None

index = next((i for i, c in enumerate(columns) if stamp(c) and stamp(c) < when), len(columns))
columns.insert(index, entry)
store["columns"] = columns
try:
    current = datetime.fromisoformat(store.get("updatedAt", ""))
except ValueError:
    current = None
if current is None or current < when:
    store["updatedAt"] = entry["date"]

with open(dst, "w", encoding="utf-8") as fh:
    fh.write(json.dumps(store, ensure_ascii=False, indent=2) + "\n")
print(f"kayıt {index}. sıraya published olarak eklendi")
PY

cp data/columns.json "$WORK/columns.json"

node scripts/generate-column-pages.mjs
node scripts/generate-en-pages.mjs

# İngilizce liste kartını ham üretici çıktısından al.
python3 -I - "$EN" en/columns.html "$WORK/en-card.html" <<'PY'
import re, sys
slug, page, out = sys.argv[1:4]
html = open(page, encoding="utf-8").read()
for match in re.finditer(r'<article class="column-card"', html):
    end = html.find("</article>", match.start())
    block = html[match.start():end + len("</article>")]
    if f"en/columns/{slug}.html" in block:
        open(out, "w", encoding="utf-8").write(block)
        print("İngilizce kart alındı")
        break
else:
    sys.exit("İngilizce kart üretilmedi; dur.")
PY

node scripts/postprocess.mjs
node scripts/sync-public-assets.mjs

KEEP=(
  "kose-yazilari/$ID.html"
  "en/columns/$EN.html"
  "public/kose-yazilari/$ID.html"
  "public/en/columns/$EN.html"
  "data/en-route-map.json"
)
for file in "${KEEP[@]}"; do
  test -s "$file" || { echo "Üretilmedi: $file" >&2; exit 1; }
  mkdir -p "$WORK/keep/$(dirname "$file")"
  cp "$file" "$WORK/keep/$file"
done

# Üretim gürültüsünü at, yalnızca bu yazının dosyalarını geri koy.
git checkout -q -- .
git clean -fdq
cp "$WORK/columns.json" data/columns.json
cp -R "$WORK/keep/." .

python3 -I - "$WORK/en-card.html" en/columns.html public/en/columns.html <<'PY'
import sys
card = open(sys.argv[1], encoding="utf-8").read()
anchor = '<div class="column-grid">'
for page in sys.argv[2:]:
    html = open(page, encoding="utf-8").read()
    if "arsenals-football-brain-22-year-wait" in html:
        print(f"{page}: kart zaten var")
        continue
    if html.count(anchor) != 1:
        sys.exit(f"{page}: liste çapası bulunamadı")
    open(page, "w", encoding="utf-8").write(html.replace(anchor, anchor + card, 1))
    print(f"{page}: kart eklendi")
PY

node scripts/test-columns.mjs
node scripts/test-source-links.mjs
if node scripts/test-en-language-purity.mjs 2>&1 | grep FAIL | grep -E "$ID|$EN"; then
  echo "İngilizce dil testi bu yazı için hata verdi; dur." >&2
  exit 1
fi

git status --short
echo "Hazır: yukarıdaki dosyalar commit'e girecek."
