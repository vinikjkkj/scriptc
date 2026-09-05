#!/bin/sh
# Count DEFERRED REFUSALS and TRAPS in the emitted translation units for an
# entry.
#
#   usage: traps.sh <dir> [expected-TU-count]
#
# ARMING. A scan that looks at one file reads zero mechanically, so this
# enumerates every emitted TU under <dir> and ABORTS when it finds fewer
# than the caller says the build produced. It also aborts when it finds
# none: n/a, never 0. Pass the count the build actually wrote — the LLVM
# lane emits one module, the C lane splits the program into parts.
#
# TWO SPELLINGS, and the difference cost a measurement. `--best-effort`
# defers a refusal into a runtime throw, and the throw carries its
# [SCxxxx] code as a SEPARATE ARGUMENT:
#
#   scr_fence_fatal(<message>, <len>, "SC2020")
#   scr_throw_error_msg_code(<kind>, <message>, <len>, "SC1090")
#
# Only some of those messages ALSO spell "[SC2020 at file:line]" inside the
# text. A scan that greps for the bracket therefore UNDERCOUNTS: on one
# measured build it read 1 where the emitted module held 4 (one bracketed
# fence plus three EventEmitter-member refusals that carry the code only as
# an argument). Both numbers are printed below, each labelled, and the
# SITES number is the one to quote.
#
# scr_trap is the runtime's general abort facility and is NOT a defect
# count: every call site of it lives inside one of the compiler's own
# shared helpers (sc_oom, sc_bad_tag, sc_bad_key), one per program that
# links them. The breakdown names the enclosing function for each, so a
# trap emitted into PROGRAM code — which would be a real finding — is
# visible as a site whose host is not one of those helpers.
set -u
DIR=${1:-.}
EXPECT=${2:-1}

FILES=$(find "$DIR" -maxdepth 2 \( -name '*.c' -o -name '*.ll' -o -name '*.scrh' -o -name '*.h' \) 2>/dev/null | sort)
N=$(echo "$FILES" | grep -c .)
if [ -z "$FILES" ]; then
  echo "NO EMITTED TU FOUND under $DIR"
  echo "-> every count below is n/a (a build that produced no TU cannot be scanned)"
  exit 2
fi
echo "=== emitted translation units (found $N, expected $EXPECT) ==="
if [ "$N" -lt "$EXPECT" ]; then
  echo "ABORT: found $N TU(s), the build produced $EXPECT -- a partial scan is not a count"
  exit 2
fi
for f in $FILES; do printf '  %12s  %s\n' "$(wc -c < "$f")" "$f"; done

# The code constants a deferred refusal names. Both backends emit the code
# as its own NUL-terminated string constant; collect the ones that are
# refusal codes (SC1xxx/SC2xxx) rather than runtime-error codes (SC9xxx).
codes_of () {
  LC_ALL=C grep -a -o -E '"SC[0-9]{4}' "$1" | sed -E 's/"//' | sort -u | grep -v -E '^SC9'
}

echo
printf '%-46s %10s %10s %10s\n' file 'sites' '[bracket]' 'trapcalls'
total_sites=0
total_brack=0
total_trap=0
for f in $FILES; do
  sites=$(LC_ALL=C grep -a -o -E '(scr_fence_fatal|scr_throw_error_msg_code)\([^)]*"SC[12][0-9]{3}' "$f" | wc -l)
  if [ "$sites" -eq 0 ]; then
    # LLVM names the code through a constant instead of inlining it.
    sites=0
    for c in $(codes_of "$f"); do
      for sym in $(LC_ALL=C grep -a -o -E "@[a-zA-Z_0-9]+ = internal constant \[[0-9]+ x i8\] c\"$c" "$f" | sed -E 's/ =.*//;s/@//'); do
        n=$(LC_ALL=C grep -a -c -E "(scr_fence_fatal|scr_throw_error_msg_code)\(.*@$sym\)" "$f")
        sites=$((sites + n))
      done
    done
  fi
  brack=$(LC_ALL=C grep -a -o -E '\[SC[0-9]{4}' "$f" | wc -l)
  tr=$(LC_ALL=C grep -a -E 'scr_trap' "$f" | grep -a -v -E '^[[:space:]]*declare' | wc -l)
  total_sites=$((total_sites + sites))
  total_brack=$((total_brack + brack))
  total_trap=$((total_trap + tr))
  printf '%-46s %10s %10s %10s\n' "$(basename "$f")" "$sites" "$brack" "$tr"
done

echo
echo "TOTAL deferred-refusal SITES          : $total_sites   <- quote this one"
echo "TOTAL [SCxxxx] bracket markers        : $total_brack   (a subset: only the messages that spell the code inline)"
echo "TOTAL scr_trap call sites             : $total_trap"

echo
echo "=== deferred refusals, by code ==="
if [ "$total_sites" -eq 0 ]; then echo "  (none)"; else
  for f in $FILES; do
    for c in $(codes_of "$f"); do
      n=0
      for sym in $(LC_ALL=C grep -a -o -E "@[a-zA-Z_0-9]+ = internal constant \[[0-9]+ x i8\] c\"$c" "$f" | sed -E 's/ =.*//;s/@//'); do
        n=$((n + $(LC_ALL=C grep -a -c -E "(scr_fence_fatal|scr_throw_error_msg_code)\(.*@$sym\)" "$f")))
      done
      n=$((n + $(LC_ALL=C grep -a -c -E "(scr_fence_fatal|scr_throw_error_msg_code)\([^)]*\"$c" "$f")))
      [ "$n" -gt 0 ] && printf '  %4s  %s\n' "$n" "$c"
    done
  done
fi

echo
echo "=== deferred refusal messages ==="
if [ "$total_sites" -eq 0 ]; then echo "  (none)"; else
  for f in $FILES; do
    LC_ALL=C grep -a -o -E "(is part of the standard library types but has no scriptc lowering yet|is not supported yet|as a VALUE)[^\"]{0,90}" "$f" \
      | sort -u | head -40
    LC_ALL=C grep -a -o -E "c\"[^\"]{10,200}\[SC[0-9]{4}[^\"]{0,90}" "$f" | sed 's/^c"//' | sort -u | head -40
  done | sort -u | head -60
fi

echo
echo "=== scr_trap call sites, with the function that hosts each ==="
for f in $FILES; do
  LC_ALL=C grep -a -n -E '^define |scr_trap' "$f" \
    | grep -a -v -E ':[[:space:]]*declare' \
    | awk -F: '/define /{ host=$0; sub(/^[0-9]+:/,"",host); next }
               /scr_trap/{ printf "  %s\n     in %s\n", substr($0,1,120), substr(host,1,90) }'
done
