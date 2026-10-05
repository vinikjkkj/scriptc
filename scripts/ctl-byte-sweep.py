"""Sweep the tree for control bytes that should not be in source.

WHY. scr_async.c:2221 holds a raw 0x00 inside a char literal where '\\0' was
meant. This project has a recorded failure mode where latin1 patching mangles
UTF-8 and leaves control bytes riding all the way into dist with every gate
green -- so the question is not "is that one byte bad" but "does it have
siblings".

WHAT COUNTS. C0 controls other than TAB/LF/CR, plus DEL and the C1 range
0x80-0x9F when the file is otherwise valid UTF-8 (a lone C1 is the classic
latin1-round-trip signature). TAB/LF/CR are legitimate; a BOM is reported
separately because it is a different problem.

The scan is over BYTES, not text: a decode-then-search would normalise away
exactly the damage being looked for.
"""
import io, os, sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else "."

# Source-ish extensions only. Binary assets legitimately contain anything.
EXTS = {".c", ".h", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".md",
        ".sh", ".py", ".yml", ".yaml", ".toml", ".txt", ".ll", ".s"}
SKIP_DIRS = {"node_modules", ".git", "dist", "zig-out", ".scriptc",
             "zig-cache", ".zig-cache", "__snapshots__"}

BAD = set(range(0x00, 0x20)) - {0x09, 0x0A, 0x0D}
BAD.add(0x7F)
C1 = set(range(0x80, 0xA0))

def utf8_bad_offsets(b):
    """Byte offsets where UTF-8 decoding actually FAILS.

    An earlier version of this flagged every 0x80-0x9F byte in any file that
    did not decode, which over-reported by 338 to 1: a single stray cp1252
    byte makes the whole file invalid, and every legitimate continuation byte
    of every real multi-byte character then looks guilty. The decoder's own
    error positions are the only honest answer."""
    out, start = [], 0
    while True:
        try:
            b[start:].decode("utf-8")
            return out
        except UnicodeDecodeError as e:
            off = start + e.start
            out.append(off)
            start = off + 1
            if start >= len(b) or len(out) > 500:
                return out

hits = []
nfiles = 0
for dirpath, dirnames, filenames in os.walk(ROOT):
    dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
    for fn in filenames:
        ext = os.path.splitext(fn)[1].lower()
        if ext not in EXTS:
            continue
        p = os.path.join(dirpath, fn)
        try:
            data = io.open(p, "rb").read()
        except OSError:
            continue
        nfiles += 1
        rel = os.path.relpath(p, ROOT).replace("\\", "/")

        if data.startswith(b"\xef\xbb\xbf"):
            hits.append((rel, 0, "BOM", "utf-8 BOM at offset 0"))
            data = data[3:]

        bad_utf8 = set(utf8_bad_offsets(data))
        line = 1
        for i, byte in enumerate(data):
            flagged = None
            if byte in BAD:
                flagged = "CTRL 0x%02X" % byte
            elif i in bad_utf8:
                # A byte the UTF-8 decoder itself rejected: the cp1252
                # round-trip signature (a lone 0x97 em dash, 0x92 quote...).
                flagged = "BADUTF8 0x%02X" % byte
            if flagged:
                s = max(0, i - 45)
                ctx = data[s:i + 25]
                ctx = "".join(chr(c) if 32 <= c < 127 else "." for c in ctx)
                hits.append((rel, line, flagged, ctx))
            if byte == 0x0A:
                line += 1

print("scanned %d source files under %s" % (nfiles, os.path.abspath(ROOT)))
if not hits:
    print("NO control-byte hits")
    sys.exit(0)

print("%d hit(s):\n" % len(hits))
bykind = {}
for rel, line, kind, ctx in hits:
    bykind.setdefault(kind.split()[0], []).append((rel, line, kind, ctx))
for k in sorted(bykind):
    rows = bykind[k]
    print("== %s : %d hit(s) in %d file(s)" % (k, len(rows), len(set(r[0] for r in rows))))
    for rel, line, kind, ctx in rows[:40]:
        print("   %s:%d  %s  |%s|" % (rel, line, kind, ctx))
    if len(rows) > 40:
        print("   ... and %d more" % (len(rows) - 40))
    print()
