#!/usr/bin/env python3
"""Re-embed wiki_data.json into index.html (HaulCore wiki maintenance pattern).

Edit wiki_data.json first, then:  python3 wikiupdate.py
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "wiki_data.json")
PAGE = os.path.join(HERE, "index.html")

with open(DATA, encoding="utf-8") as f:
    payload = json.load(f)
raw = json.dumps(payload, indent=1, ensure_ascii=False).replace("</", "<\\/")
with open(PAGE, encoding="utf-8") as f:
    page = f.read()
start = page.index('<script id="wiki-data" type="application/json">') + len('<script id="wiki-data" type="application/json">')
end = page.index("</script>", start)
page = page[:start] + raw + page[end:]
with open(PAGE, "w", encoding="utf-8") as f:
    f.write(page)
print("re-embedded", DATA, "into index.html")
