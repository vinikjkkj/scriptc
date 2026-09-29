#!/usr/bin/env bash
# MUTATION CONTROL for the fragment suite.
#
# 72 tests passed on the first run of 830 lines written without a compiler.
# That is the moment to distrust, not to celebrate: a test that has never
# said no is indistinguishable from a test that was not executed. Each mutant
# below breaks one property the suite claims to pin; a SURVIVING mutant means
# that property is decorative.
#
# The implementation is mutated, never the test -- mutating the test would
# only prove the test file is loaded.
set -u
WT=/g/blocks/libcache/wt
FRAG=$WT/packages/compiler/src/frontend/lowering/fragment.ts
FORM=$WT/packages/compiler/src/frontend/lowering/structural-form.ts
FILES="packages/compiler/test/lowering-fragment.test.ts packages/compiler/test/structural-form.test.ts"
cp "$FRAG" /g/blocks/libcache/frag.orig
cp "$FORM" /g/blocks/libcache/form.orig
restore() { cp /g/blocks/libcache/frag.orig "$FRAG"; cp /g/blocks/libcache/form.orig "$FORM"; }

run() { cd "$WT" && npx vitest run $FILES --reporter=dot 2>&1 | grep -cE "^ *(FAIL|×)| [0-9]+ failed" ; }

mutate() { # name file python-expr
  local name="$1" file="$2" py="$3"
  restore
  python3 - "$file" <<PYEOF
import io,sys
p=sys.argv[1]
s=io.open(p,encoding="utf-8",newline="").read()
$py
io.open(p,"w",encoding="utf-8",newline="").write(s)
PYEOF
  cd "$WT"
  out=$(npx vitest run $FILES --reporter=dot 2>&1 | tail -20)
  if echo "$out" | grep -qE "[0-9]+ failed"; then
    echo "  CAUGHT    $name"
  else
    echo "  SURVIVED  $name   <-- the property it breaks is not actually pinned"
  fi
}

echo "=== mutation control: each mutant must be CAUGHT ==="
mutate "collision guard always returns none"  "$FRAG" 's=s.replace("  const byForm = new Map<string, string[]>();","  if (true) return [];\n  const byForm = new Map<string, string[]>();",1)'
mutate "id-leak guard never throws"           "$FORM" 's=s.replace("  if (form.includes(\x27\"shapeId\":\"\x27) || form.includes(\x27\"unionId\":\"\x27)) {","  if (false) {",1)'
mutate "canonicalJson stops sorting keys"     "$FRAG" 's=s.replace("for (const k of Object.keys(o).sort())","for (const k of Object.keys(o))",1)'
mutate "collection assertion never throws"    "$FRAG" 's=s.replace("  if (owned.length === 0) return;","  if (true) return;",1)'
mutate "census never counts a refusal"        "$FRAG" 's=s.replace("  for (const r of refusals) census.refusedByCode[r.code]++;","  for (const r of refusals) void r;",1)'
mutate "unresolvable-id scan finds nothing"   "$FRAG" 's=s.replace("  const re = /\"(?:shapeId|unionId)\":\"([ru][0-9]+)\"/g;","  const re = /__never_matches__/g;",1)'
mutate "structural form drops declaredOrder"  "$FORM" 's=s.replace("  if (shape.declaredOrder !== undefined) out += `|order${J(shape.declaredOrder)}`;","",1)'
mutate "structural form INCLUDES ownmask"     "$FORM" 's=s.replace("  if (shape.tostr === true) out += \"|tostr\";","  if (shape.tostr === true) out += \"|tostr\";\n  if (shape.ownmask === true) out += \"|ownmask\";",1)'
restore
echo "=== restored ==="
