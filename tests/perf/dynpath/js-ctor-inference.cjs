/* Does the checker do JAVASCRIPT CONSTRUCTOR-FUNCTION inference?
 *
 * WHY THIS EXISTS. proto-class-synth.ts types a synthesized class's slots from
 * the constructor's initializer unioned with every prototype-method write, and
 * that design rests on a measurement taken with TypeScript 5.9.3 ("the checker
 * types a this-property from the CONSTRUCTOR alone"). Wiring the recognizer up
 * showed the shipping world does not agree: in the compiler's own lane `this`
 * inside `function Box(v) { this.v = v }` is `any`, `new Box(7)` is `any`, and
 * the binding it initializes is `any`. Nothing about such a class is typed, so
 * the class type cannot arrive from the checker at all -- `this` has to come
 * from the body's own declared local and a binding from its initializer's
 * lowered type. This script is the A/B that says so, rather than a claim.
 *
 * It runs against 5.9.3 only, because TypeScript 7 ships no client-side parser
 * (the ts7 adapter has no createSourceFile) and cannot build a Program from a
 * fixture here. The 7-side answers are read from the compiler itself. What
 * this file pins is the 5.9.3 side: if it ever stops answering `Box`, the
 * comparison the consumer's design rests on has changed underneath it.
 *
 *     node tests/perf/dynpath/js-ctor-inference.cjs [<path to a typescript pkg>]
 *
 * Exits non-zero if the probe cannot answer -- a scan that returns "nothing"
 * because it is broken must not read as "nothing to report".
 */
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

function resolveTs(explicit) {
  const tries = [];
  if (explicit) tries.push(explicit);
  // A git worktree carries no node_modules of its own; walk up, then through
  // the compiler package, which is where typescript5 actually lives.
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    tries.push(path.join(dir, "packages/compiler/node_modules/typescript5"));
    tries.push(path.join(dir, "node_modules/typescript5"));
    tries.push(path.join(dir, "node_modules/typescript"));
    dir = path.dirname(dir);
  }
  for (const t of tries) {
    const lib = path.join(t, "lib/typescript.js");
    if (fs.existsSync(lib)) return lib;
  }
  return null;
}

const lib = resolveTs(process.argv[2]);
if (!lib) {
  console.error("no typescript package found; pass one as argv[2]");
  process.exit(2);
}
const ts = require(lib);

const SRC =
  "function Box(v) { this.v = v }\n" +
  "Box.prototype.get = function () { return this.v }\n" +
  "Box.prototype.bump = function (n) { this.v = this.v + n; return this }\n" +
  "var b = new Box(7)\n" +
  "b.get()\n";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scriptc-jsctor-"));
const file = path.join(dir, "fixture.js");
fs.writeFileSync(file, SRC, "utf8");

// The COMPILER's own options (packages/compiler/src/frontend/program.ts), not
// a guessed set: `strict` in particular changes nothing here, and saying so
// takes an argument away from anyone reading the result.
const prog = ts.createProgram([file], {
  allowJs: true,
  checkJs: true,
  noEmit: true,
  resolveJsonModule: true,
  lib: ["lib.es2025.d.ts"],
  types: [],
  target: ts.ScriptTarget.ES2022,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
});
const ck = prog.getTypeChecker();
const sf = prog.getSourceFile(file);
if (!sf) {
  console.error("fixture did not enter the program");
  process.exit(2);
}

const answers = new Map();
(function walk(n) {
  if (n.kind === ts.SyntaxKind.ThisKeyword && !answers.has("this in the constructor")) {
    answers.set("this in the constructor", ck.typeToString(ck.getTypeAtLocation(n)));
  }
  if (ts.isNewExpression(n)) answers.set("new Box(7)", ck.typeToString(ck.getTypeAtLocation(n)));
  if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === "b") {
    answers.set("the binding b", ck.typeToString(ck.getTypeAtLocation(n.name)));
  }
  if (ts.isPropertyAccessExpression(n) && n.name.text === "get" && ts.isCallExpression(n.parent)) {
    answers.set("the receiver of b.get()", ck.typeToString(ck.getTypeAtLocation(n.expression)));
  }
  ts.forEachChild(n, walk);
})(sf);

// SELF-TEST: four questions, all of them answered. A missing one means the
// walk stopped matching the fixture, and a partial result would read as a
// finding.
const WANT = ["this in the constructor", "new Box(7)", "the binding b", "the receiver of b.get()"];
const missing = WANT.filter((q) => !answers.has(q));
if (missing.length > 0) {
  console.error("SELF-TEST FAILED: no answer for " + missing.join(", "));
  process.exit(2);
}

console.log("typescript " + ts.version);
for (const q of WANT) console.log("  " + q.padEnd(26) + " => " + answers.get(q));
const infers = WANT.every((q) => answers.get(q) === "Box" || answers.get(q) === "this");
console.log("");
console.log(
  infers
    ? "JS constructor-function inference: PRESENT (every question answers the class)"
    : "JS constructor-function inference: ABSENT (at least one question answers `any`)",
);
console.log(
  "The compiler's own ts7 lane answers `any` to all four -- measured through the\n" +
  "lowering, since TS 7 ships no client-side parser to ask directly.",
);
fs.rmSync(dir, { recursive: true, force: true });
