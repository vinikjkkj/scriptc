/* classify.mjs — split the mongodb+bson blockers three ways.
 *
 *   node classify.mjs <record.json>
 *
 * The three buckets the brief asks for:
 *
 *   CASCADE      the compiler labels it (SC2004), or the message says the site
 *                is downstream of another site's refusal ("see its own
 *                diagnostic", "the class declaration itself was rejected", the
 *                instantiation-context suffix). NOTE the known blind spot:
 *                "extending classes not declared in the program ('X')" carries
 *                NO cascade marker and is cascade whenever X is a class in the
 *                program that failed -- so it is listed separately rather than
 *                folded in, and the arms decide it.
 *
 *   REPRESENTATION  a decision with semantics attached: a standard-library or
 *                @types/node surface with no lowering (Date, WeakMap, BigInt,
 *                globalThis, Object.freeze, Symbol.dispose, JSON reviver...),
 *                a container whose element/key kind is outside the supported
 *                domain, or a type with no static representation at all. These
 *                are the Date-shaped and handle-shaped family the brief says to
 *                step past, not argue into scope.
 *
 *   CAPABILITY   a language/lowering construct the compiler names and could
 *                learn: field redeclaration, generic-class instantiation,
 *                `this.constructor`, assignment-in-expression, `export =`,
 *                generator methods, bound method references, and the rest.
 *
 * Every rule is a message match, printed with its bucket, so a reader can
 * disagree with a specific line rather than with a total. UNCLASSIFIED is
 * printed loudly rather than silently folded anywhere -- a classifier that
 * cannot say "I do not know" reports a clean split that is not real.
 */
import { readFileSync } from 'node:fs'
import { ownerOf, family } from './own.mjs'

const rec = JSON.parse(readFileSync(process.argv[2], 'utf8'))
if (!Array.isArray(rec.sites)) throw new Error('BLIND: no sites array')

const sites = rec.sites
  .filter((s) => s.section === 'blocker')
  .filter((s) => ownerOf(s.file) === 'mongodb' || ownerOf(s.file) === 'bson')
if (sites.length === 0) throw new Error('BLIND: no mongodb/bson blocker sites read')

const RULES = [
  // --- cascade the compiler labels ---
  ['CASCADE', /^uses of '.*' inherit the blocker on its declaration$/, 'SC2004, the labelled cascade marker'],
  ['CASCADE', /the class declaration itself was rejected — see its own diagnostic/, 'constructing through a class the compiler already refused'],
  ['CASCADE', /without a compiled concrete instantiation \(the type arguments must map — see the instantiation's own diagnostic\)/, 'extends a generic base whose instantiation failed'],
  ['CASCADE-UNLABELLED', /^extending classes not declared in the program \('.*'\) is not supported yet$/, 'the base class is IN the program but failed to compile -- no cascade code'],
  ['CASCADE', /cannot be compiled: the union shape is supported, but its arm '.*' does not compile$/, 'the union arm has its own site'],
  ['CASCADE', /cannot be compiled: the record shape is supported, but its member '.*' has type '.*', which does not compile$/, 'the member type has its own site'],

  // --- representation decisions with semantics ---
  // `this.constructor` takes SC2020 because `constructor` is an Object.prototype
  // member typed by the stdlib -- but reading a static through the runtime
  // constructor is a LOWERING the compiler could learn, not a representation
  // decision like Date or WeakMap. The message does not distinguish the two;
  // this rule does, and sits ABOVE the generic stdlib rule so it wins.
  ['CAPABILITY', /^'this.constructor' is part of the standard library types/, 'reading a static through this.constructor'],

  ['REPRESENTATION', /is typed by @types\/node but has no scriptc lowering yet$/, '@types/node surface with no lowering'],
  ['REPRESENTATION', /is part of the standard library types but has no scriptc lowering yet/, 'stdlib surface with no lowering'],
  ['REPRESENTATION', /have no static representation but run in the embedded dynamic engine/, 'no static representation exists for the type'],
  ['REPRESENTATION', /cannot be compiled yet \(supported: number, string, boolean, arrays/, 'outside the compilable type set'],
  ['REPRESENTATION', /the (Set|Map) shape is supported, but (elements|keys) are limited to/, 'container element/key kind outside the domain'],
  ['REPRESENTATION', /^(Set elements|Map keys) of type /, 'container element/key kind outside the domain'],
  ['REPRESENTATION', /this index signature is outside the supported shape/, 'index-signature value domain'],
  ['REPRESENTATION', /^operators on 'unknown' values/, 'operators on unknown'],

  // --- capability gaps ---
  ['CAPABILITY', /^redeclaring inherited fields at a different type/, 'field redeclaration at a different record shape'],
  ['CAPABILITY', /^extending generic classes are not supported yet$/, 'generic-class inheritance'],
  ['CAPABILITY', /^generic classes as values/, 'a generic class as a value'],
  ['CAPABILITY', /^record shapes must match exactly or width-coerce/, 'record width coercion at this site'],
  ['CAPABILITY', /^comparing non-number, non-string values/, 'comparison over non-scalar operands'],
  ['CAPABILITY', /^the reference to '.*' \(a binding form with no lowering\)/, 'binding form with no lowering'],
  ['CAPABILITY', /^the static member '.*' of class /, 'static accessor / initializer-less static field'],
  ['CAPABILITY', /^functions with optional or defaulted parameters as values/, 'optional-parameter function as a value'],
  ['CAPABILITY', /^typeof expressions on statically-typed values/, 'typeof on a statically-typed value'],
  ['CAPABILITY', /^super\(\) calls anywhere but as a top-level constructor statement/, 'super() outside a top-level constructor statement'],
  ['CAPABILITY', /^statically-decided Array\.isArray on computed arguments/, 'Array.isArray on a computed argument'],
  ['CAPABILITY', /^reading '.*' from a value of type /, 'property read the lowering declines'],
  ['CAPABILITY', /^method calls like /, 'method call the lowering declines'],
  ['CAPABILITY', /^index signatures are not supported yet$/, 'index signatures'],
  ['CAPABILITY', /^generator methods /, 'generator methods'],
  ['CAPABILITY', /^Error constructor options /, "Error's `cause` option"],
  ['CAPABILITY', /^increment\/decrement /, 'increment/decrement forms'],
  ['CAPABILITY', /^'in' on /, "`in` on a union receiver"],
  ['CAPABILITY', /^bound method references /, 'bound method references'],
  ['CAPABILITY', /^assignment to non-variables/, 'assignment to a non-variable'],
  ['CAPABILITY', /^'instanceof' on values other than class instances/, 'instanceof on a non-class-instance'],
  ['CAPABILITY', /^using the result of request\.end/, 'using a void result'],
  ['CAPABILITY', /^module namespace objects as values/, 'a module namespace object as a value'],
  ['CAPABILITY', /^Function\.prototype\.call on a compiled function value/, 'Function.prototype.call on a compiled function'],
  ['CAPABILITY', /^library functions as values/, 'a library function as a value'],
  ['CAPABILITY', /^'export =' assignments/, '`export =`'],
  ['CAPABILITY', /^export = assignments/, '`export =`'],
]

const buckets = new Map()
const unclassified = []
const byReason = new Map()
for (const s of sites) {
  const hit = RULES.find((r) => r[1].test(s.message))
  if (!hit) { unclassified.push(s); continue }
  buckets.set(hit[0], (buckets.get(hit[0]) ?? 0) + 1)
  const k = `${hit[0]}${hit[2]}`
  byReason.set(k, (byReason.get(k) ?? 0) + 1)
}

console.log(`record: ${rec.entry}`)
console.log(`mongodb+bson blocker sites: ${sites.length}`)
console.log(`distinct message families  : ${new Set(sites.map((s) => `${ownerOf(s.file)} ${s.code} ${family(s.message)}`)).size}`)
console.log('\n# three-way split')
for (const b of ['CASCADE', 'CASCADE-UNLABELLED', 'REPRESENTATION', 'CAPABILITY']) {
  console.log(`  ${String(buckets.get(b) ?? 0).padStart(4)}  ${b}`)
}
console.log(`  ${String(unclassified.length).padStart(4)}  UNCLASSIFIED  <- must be 0 for the split to be trusted`)

console.log('\n# by reason')
for (const e of [...byReason].sort((a, b) => b[1] - a[1])) {
  const [b, why] = e[0].split('')
  console.log(`  ${String(e[1]).padStart(4)}  ${b.padEnd(19)} ${why}`)
}

if (unclassified.length > 0) {
  console.log('\n# UNCLASSIFIED sites (a classifier that cannot say "I do not know" reports a split that is not real)')
  for (const s of unclassified) console.log(`  ${s.code} ${s.message.slice(0, 160)}`)
  process.exit(1)
}
