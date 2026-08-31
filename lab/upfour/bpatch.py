"""Binary in-place patch that preserves each file's own line endings.

Reads a JSON edit list from argv[1]: [{"file":..., "old":..., "new":...}, ...]

`old` and `new` are spelled with LF. The file's DOMINANT ending decides how
both are rewritten before matching/splicing, because a single-line `old` gives
no evidence at all: it matches identically under either spelling, and the
insertion then lands with the wrong endings inside it. Every file in this repo
is either pure LF, pure CRLF, or mixed (lower-exprs.ts has 27 LF-only lines in
20296) -- for mixed files the CRLF form is tried first and the LF form second,
and whichever matched decides `new`.

Fails loudly on 0 or >1 matches, and NEVER rewrites bytes outside the span.
"""
import json
import sys


def crlf(b: bytes) -> bytes:
    return b.replace(b"\n", b"\r\n")


edits = json.load(open(sys.argv[1], encoding="utf-8"))
for e in edits:
    path = e["file"]
    with open(path, "rb") as fh:
        data = fh.read()
    cr = data.count(b"\r\n")
    lf = data.count(b"\n")
    # Dominant ending first; the other as a fallback for a mixed file.
    order = ["crlf", "lf"] if cr * 2 >= lf else ["lf", "crlf"]
    old, new = e["old"].encode("utf-8"), e["new"].encode("utf-8")
    for form in order:
        o = crlf(old) if form == "crlf" else old
        n = crlf(new) if form == "crlf" else new
        c = data.count(o)
        if c > 1:
            sys.exit(f"FAIL {path}: {c} matches ({form})")
        if c == 1:
            data = data.replace(o, n)
            print(f"OK  {path}  ({form})")
            break
    else:
        sys.exit(f"FAIL {path}: no match for:\n{e['old'][:400]}")
    with open(path, "wb") as fh:
        fh.write(data)
print("done")
