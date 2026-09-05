#!/bin/sh
# Count deferred refusals and traps in the EMITTED translation units for an
# entry. Scans every emitted TU (.c/.ll/.scrh/.h) -- a scan that looks at one
# file reads zero mechanically. Reports n/a, never 0, when there is nothing to
# scan.
#
# Two numbers, and the difference matters:
#
#   [SCxxxx]  a per-statement refusal that --best-effort DEFERRED into a
#             runtime throw. This is the real "what does not compile" count.
#             Under a strict (no --best-effort) build these are build errors
#             instead, so a strict build's error list is the other arm and
#             BOTH must be reported.
#
#   scr_trap  the runtime's general abort facility. EVERY program carries a
#             baseline of these -- one `declare` plus the out-of-memory and
#             bad-tag call sites -- so a raw total is not a defect count.
#             The breakdown below names each trap's message symbol; anything
#             beyond sc_oom_msg / sc_bad_tag_msg is program-specific.
set -u
DIR=${1:-/g/blocks/restapi/out}
ONLY=${2:-}

FILES=$(find "$DIR" -maxdepth 2 \( -name '*.c' -o -name '*.ll' -o -name '*.scrh' -o -name '*.h' \) 2>/dev/null | sort)
if [ -n "$ONLY" ]; then FILES=$(echo "$FILES" | grep -F "$ONLY"); fi
if [ -z "$FILES" ]; then
  echo "NO EMITTED TU FOUND under $DIR${ONLY:+ matching '$ONLY'}"
  echo "-> every count below is n/a (a build that produced no TU cannot be scanned)"
  exit 0
fi

echo "=== emitted translation units ==="
for f in $FILES; do printf '  %12s  %s\n' "$(wc -c < "$f")" "$f"; done

total_sc=0
echo
printf '%-52s %10s %10s\n' file '[SCxxxx]' 'scr_trap'
for f in $FILES; do
  sc=$(LC_ALL=C grep -a -o -E '\[SC[0-9]{4}' "$f" 2>/dev/null | wc -l)
  tr=$(LC_ALL=C grep -a -o -E '\bscr_trap\b' "$f" 2>/dev/null | wc -l)
  total_sc=$((total_sc + sc))
  printf '%-52s %10s %10s\n' "$(basename "$f")" "$sc" "$tr"
done

echo
echo "TOTAL [SCxxxx] deferred-refusal sites : $total_sc"
if [ "$total_sc" -eq 0 ]; then
  echo "  (zero under --best-effort means zero DEFERRED sites in this TU set;"
  echo "   it does NOT by itself mean the strict build is clean -- run the strict arm)"
fi

echo
echo "=== trap call sites by message symbol (baseline = sc_oom_msg, sc_bad_tag_msg) ==="
for f in $FILES; do
  LC_ALL=C grep -a -o -E 'scr_trap\(ptr @[a-zA-Z_0-9]+|scr_trap\(&?[a-zA-Z_0-9]+' "$f" 2>/dev/null
done | sed -e 's/.*@//' -e 's/.*scr_trap(&*//' | sort | uniq -c | sort -rn

echo
echo "=== distinct [SCxxxx] codes, with counts ==="
if [ "$total_sc" -eq 0 ]; then echo "  (none)"; else
for f in $FILES; do LC_ALL=C grep -a -o -E '\[SC[0-9]{4}' "$f" 2>/dev/null; done \
  | sed -E 's/\[//' | sort | uniq -c | sort -rn
fi

echo
echo "=== distinct refusal messages ==="
if [ "$total_sc" -eq 0 ]; then echo "  (none)"; else
for f in $FILES; do
  LC_ALL=C grep -a -o -E "'[^']{3,140}' is part of the standard library types[^\"]{0,60}|'[^']{3,140}' is not supported yet" "$f" 2>/dev/null
done | sed -E 's/ \[SC[0-9]{4}.*//' | sort -u | head -60
fi
