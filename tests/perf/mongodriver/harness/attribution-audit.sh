#!/bin/sh
# Attribution + language audit, run as its OWN step, never chained to a commit
# or merge and never behind `||`. Twice in this project a forbidden trailer
# reached main because the audit was chained.
#
# It has a POSITIVE CONTROL: a synthetic bad message is fed through the same
# patterns first, and the audit fails loudly if the patterns do not catch it.
set -u
RANGE="${1:-origin/main..HEAD}"

# It must be IMPOSSIBLE to pass by looking at nothing. Run from a non-repo
# directory, the first version of this file printed "commits in range: 0" and
# then AUDIT PASS -- an empty result is not absence.
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "REFUSING: not inside a git work tree. cd to the worktree first." >&2
  exit 2
fi
if ! git rev-parse --verify --quiet "${RANGE%%..*}" >/dev/null 2>&1; then
  echo "REFUSING: the range base '${RANGE%%..*}' does not resolve." >&2
  exit 2
fi
BAD='Co-Authored-By|Co-authored-by|Claude|Anthropic|claude\.ai|noreply@anthropic|Generated with'
# Portuguese markers that do not occur in this repo's English commit prose.
PT='\bnão\b|\bção\b|\bpara o\b|\bcom o\b|\bque a\b|\bfoi\b|\bestá\b|\bmuito\b|\bagora\b|\bmas\b|\bpois\b'

fail=0

echo "== positive control: the patterns must CATCH a known-bad message =="
CTL='feat: something

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Generated with Claude Code'
if printf '%s' "$CTL" | grep -Eq "$BAD"; then
  echo "  ok: trailer pattern caught the control"
else
  echo "  CONTROL FAILED: trailer pattern did not catch a known-bad message"; fail=1
fi
CTLPT='fix: isso não foi corrigido, mas agora está pronto'
if printf '%s' "$CTLPT" | grep -Eqi "$PT"; then
  echo "  ok: Portuguese pattern caught the control"
else
  echo "  CONTROL FAILED: Portuguese pattern did not catch a known-bad message"; fail=1
fi
CTLGOOD='test(mongodriver): one line gates the operations subsystem'
if printf '%s' "$CTLGOOD" | grep -Eq "$BAD"; then
  echo "  CONTROL FAILED: trailer pattern fired on a clean message"; fail=1
else
  echo "  ok: trailer pattern does NOT fire on a clean message"
fi

echo
echo "== audit: $RANGE =="
N=$(git log --oneline "$RANGE" | wc -l)
echo "  commits in range: $N"
if [ "$N" -eq 0 ]; then echo "  nothing to audit"; fi
HITS=$(git log --format='%H%n%B' "$RANGE" | grep -En "$BAD" || true)
if [ -n "$HITS" ]; then echo "  FORBIDDEN TRAILER / ATTRIBUTION:"; echo "$HITS"; fail=1; else echo "  ok: no Claude/Anthropic/Co-Authored-By attribution"; fi
PTHITS=$(git log --format='%H%n%B' "$RANGE" | grep -Eni "$PT" || true)
if [ -n "$PTHITS" ]; then echo "  POSSIBLE PORTUGUESE:"; echo "$PTHITS"; fail=1; else echo "  ok: no Portuguese markers"; fi
AUTH=$(git log --format='%an <%ae>' "$RANGE" | sort -u)
echo "  authors: $AUTH"
echo "$AUTH" | grep -Eqi 'claude|anthropic' && { echo "  FORBIDDEN AUTHOR"; fail=1; }

echo
[ "$fail" -eq 0 ] && echo "AUDIT PASS" || echo "AUDIT FAIL"
exit "$fail"
