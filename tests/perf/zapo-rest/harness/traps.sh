#!/bin/sh
# Count traps and [SCxxxx] deferred-refusal throws in the EMITTED C for the
# shipped entry. Scans every emitted TU including .scrh headers -- a scan that
# looks at one .c reads zero mechanically. Reports n/a, never 0, when there is
# nothing to scan.
set -u
DIR=${1:-/g/blocks/restapi/out}

echo "=== emitted translation units under $DIR ==="
FILES=$(find "$DIR" -maxdepth 2 \( -name '*.c' -o -name '*.scrh' -o -name '*.h' \) 2>/dev/null | sort)
if [ -z "$FILES" ]; then
  echo "NO EMITTED C FOUND -> every count below is n/a (a build that produced no TU cannot be scanned)"
  exit 0
fi
for f in $FILES; do printf '  %10s  %s\n' "$(wc -c < "$f")" "$f"; done

total_sc=0
total_trap=0
echo
printf '%-60s %10s %10s\n' file '[SCxxxx]' 'scr_trap'
for f in $FILES; do
  sc=$(LC_ALL=C grep -a -o -E '\[SC[0-9]{4}' "$f" 2>/dev/null | wc -l)
  tr=$(LC_ALL=C grep -a -o -E 'scr_trap|__scr_trap' "$f" 2>/dev/null | wc -l)
  total_sc=$((total_sc + sc))
  total_trap=$((total_trap + tr))
  printf '%-60s %10s %10s\n' "$(basename "$f")" "$sc" "$tr"
done
echo
echo "TOTAL [SCxxxx] deferred-refusal sites : $total_sc"
echo "TOTAL trap sites                      : $total_trap"
echo
echo "=== the distinct [SCxxxx] codes present, with counts ==="
for f in $FILES; do LC_ALL=C grep -a -o -E '\[SC[0-9]{4}[^]]*\]' "$f" 2>/dev/null; done \
  | sed -E 's/\[(SC[0-9]{4}).*/\1/' | sort | uniq -c | sort -rn
echo
echo "=== the distinct refusal MESSAGES (first 40, deduplicated) ==="
for f in $FILES; do LC_ALL=C grep -a -o -E "'[^']{5,120}' is part of the standard library types[^\"]{0,80}" "$f" 2>/dev/null; done \
  | sort -u | head -40
