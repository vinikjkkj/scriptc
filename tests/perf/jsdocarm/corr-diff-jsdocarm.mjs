/**
 * corr-diff-jsdocarm.mjs - the two correspondences, diffed.
 *
 * `corr-jsdocarm.mjs` derives the declared-member <-> function-expression
 * correspondence from the AST (what a compiler can do). `corr-oracle-
 * jsdocarm.mjs` derives it from the live object graph in Node (what is
 * actually true at run time). This prints where they disagree, member by
 * member, and the FALSE POSITIVE / FALSE NEGATIVE counts that follow:
 *
 *   false negative  a member the oracle sees that the AST pass did not find,
 *                   or found at a different source position;
 *   false positive  a member the AST pass claims that the oracle does not
 *                   have at that path, or whose ARITY it gets wrong.
 *
 * A position disagreement is counted as a false positive too: pointing at
 * the wrong function expression is the one failure that miscompiles
 * silently, so it is never merely "unmatched".
 *
 * Usage: node corr-diff-jsdocarm.mjs <ast.json> <oracle.json>
 */
import { readFileSync } from "node:fs";

const [astPath, oraPath] = process.argv.slice(2);
if (!astPath || !oraPath) { console.error("usage: corr-diff-jsdocarm.mjs <ast.json> <oracle.json>"); process.exit(2); }
const ast = JSON.parse(readFileSync(astPath, "utf8"));
const ora = JSON.parse(readFileSync(oraPath, "utf8"));

/* the oracle's members, keyed path.member */
const oraM = new Map();
const oraPaths = new Set();
for (const c of ora.ctors) {
  oraPaths.add(c.path);
  oraM.set(c.path + ".#ctor", { arity: c.ctorArity, at: c.ctorAt });
  for (const s of c.statics) oraM.set(c.path + "." + s.name, { arity: s.arity, at: s.at, len: s.len });
}

/* the AST pass's members, from its per-class rows */
const astM = new Map();
for (const [path, rec] of Object.entries(ast.astMembers ?? {})) {
  for (const [name, m] of Object.entries(rec)) astM.set(path + "." + name, m);
}

const fn = [], fp = [], posMismatch = [], arityMismatch = [];
for (const [k, o] of oraM) {
  const a = astM.get(k);
  if (!a) { fn.push(k); continue; }
  if (a.arity !== o.arity) arityMismatch.push({ k, ast: a.arity, oracle: o.arity });
  if (o.at >= 0 && a.pos !== undefined && a.pos !== o.at) posMismatch.push({ k, ast: a.pos, oracle: o.at });
}
for (const k of astM.keys()) if (!oraM.has(k)) fp.push(k);

const res = {
  oracle: { ctors: ora.summary.ctors, members: oraM.size },
  ast: { classes: ast.classes.matched, members: astM.size },
  falseNegatives: fn.length, falseNegativeSample: fn.slice(0, 12),
  falsePositives: fp.length, falsePositiveSample: fp.slice(0, 12),
  positionMismatch: posMismatch.length, positionSample: posMismatch.slice(0, 8),
  arityMismatchAgainstOracle: arityMismatch.length, aritySample: arityMismatch.slice(0, 8),
};
console.log(JSON.stringify(res, null, 2));
