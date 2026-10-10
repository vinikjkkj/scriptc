#!/bin/sh
# ATTRIBUTION AUDIT -- its own call, never chained to a merge or to `||`.
# Twice a trailer reached main because this was chained. Controls run and are
# REPORTED BEFORE the verdict, so a detector that cannot fail cannot pass.
#
# THIS FILE LIVES IN THE REPO ON PURPOSE. It used to live in a gate rig under
# G:\blocks, and on 2026-10-10 a routine scratch purge deleted the rig and took
# the auditor with it, minutes before a landing that needed it. A tool the
# merge criterion depends on does not belong in scratch.
#
# Usage:  REPO=/path/to/worktree sh scripts/attribution-audit.sh <range>
# There is deliberately NO default range and NO default repo: a wrong default
# audits someone else's history and reports GREEN about the wrong thing.
RANGE="$1"
if [ -z "$RANGE" ]; then
  echo "usage: REPO=<worktree> sh scripts/attribution-audit.sh <range>" >&2
  echo "       e.g. REPO=\$PWD sh scripts/attribution-audit.sh origin/main..HEAD" >&2
  exit 9
fi
if [ -z "$REPO" ]; then
  echo "attribution-audit: REPO is unset -- refusing to guess which tree to audit" >&2
  exit 9
fi
cd "$REPO" || exit 9
FAIL=0

BAD='Co-Authored-By|Claude-Session|Generated with \[?Claude|claude\.ai/code|Co-authored-by: Claude|🤖'
PT='\b(que|para|com|não|uma|dos|das|pelo|pela|mas|porque|então|aqui|isso|está|são|foi|tem|fatia|medir|medição|recusa|janela)\b'
WANT='vinikjkkj <contact@vinicius.email>'

echo "=== CONTROLS (all four + liveness, BEFORE the verdict) ==="

# C0 LIVENESS. A range with zero commits passes every check vacuously.
N=$(git rev-list --count "$RANGE" 2>/dev/null)
if [ "${N:-0}" -ge 1 ]; then echo "C0 LIVENESS   PASS  range=$RANGE commits=$N (non-vacuous)"
else echo "C0 LIVENESS   FAIL  range=$RANGE commits=${N:-0} -- NOTHING AUDITED"; FAIL=$((FAIL+1)); fi

# C1 SENSITIVITY. The trailer detector must read RED on a planted trailer.
if printf 'subject\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>\n' | grep -Eq "$BAD"
then echo "C1 SENSITIVITY PASS  planted trailer detected (detector can fail)"
else echo "C1 SENSITIVITY FAIL  planted trailer NOT detected -- detector is blind"; FAIL=$((FAIL+1)); fi

# C2 SPECIFICITY. It must read GREEN on a clean message.
if printf 'feat(coro): the forOf loop state joins the LLVM lane -- 75 of 80 planned\n\nbody text\n' | grep -Eq "$BAD"
then echo "C2 SPECIFICITY FAIL  clean message flagged -- detector is noise"; FAIL=$((FAIL+1))
else echo "C2 SPECIFICITY PASS  clean message not flagged"; fi

# C3 LANGUAGE detector, both directions.
if printf 'esta fatia nao pode medir porque a janela esta fechada\n' | grep -Eiq "$PT"
then echo "C3 LANG-SENS  PASS  planted Portuguese detected"
else echo "C3 LANG-SENS  FAIL  planted Portuguese NOT detected"; FAIL=$((FAIL+1)); fi
if printf 'the forOf loop state joins the LLVM lane\n' | grep -Eiq "$PT"
then echo "C3 LANG-SPEC  FAIL  clean English flagged"; FAIL=$((FAIL+1))
else echo "C3 LANG-SPEC  PASS  clean English not flagged"; fi

echo
if [ "$FAIL" -gt 0 ]; then
  echo "AUDIT-VERDICT = ABORT (controls failed: $FAIL) -- no verdict issued over an unproven detector"
  exit 2
fi

echo "=== THE RANGE ==="
git log --format='%h %an <%ae> | %cn <%ce> | %s' "$RANGE"
echo
echo "=== FINDINGS ==="
HITS=$(git log --format='%H%n%B' "$RANGE" | grep -En "$BAD")
if [ -n "$HITS" ]; then echo "TRAILERS: FOUND"; echo "$HITS"; FAIL=$((FAIL+1)); else echo "trailers:    none"; fi

PTHITS=$(git log --format='%B' "$RANGE" | grep -Ein "$PT")
if [ -n "$PTHITS" ]; then echo "PORTUGUESE: FOUND"; echo "$PTHITS"; FAIL=$((FAIL+1)); else echo "language:    English only"; fi

WRONG=$(git log --format='%an <%ae>|%cn <%ce>' "$RANGE" | grep -v "^$WANT|$WANT\$")
if [ -n "$WRONG" ]; then echo "AUTHORSHIP: UNEXPECTED"; echo "$WRONG"; FAIL=$((FAIL+1)); else echo "authorship:  $WANT on both author and committer"; fi

echo
if [ "$FAIL" -gt 0 ]; then echo "AUDIT-VERDICT = RED ($FAIL finding(s)) -- DO NOT MERGE"; exit 1; fi
echo "AUDIT-VERDICT = GREEN -- range $RANGE clean on trailers, language and authorship"
