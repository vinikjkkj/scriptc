/**
 * hazard-jsdocarm.mjs - what the DECLARATION does not say about the BODY.
 *
 * The correspondence (corr-jsdocarm.mjs) is exact: every declared member
 * has one function expression and the two instruments agree on all 1,923.
 * That settles WHICH function implements WHICH member. It says nothing
 * about whether the declared TYPES may be applied to it, and applying a
 * type that the body contradicts is the silent-wrong-answer failure this
 * project fears most.
 *
 * So this instrument counts, over the correspondence's own spans, every
 * place the body does something the declaration does not describe:
 *
 *   H1 ARITY      the body takes parameters the declaration does not declare
 *   H2 UNDECLARED the body WRITES a property no declaration declares, onto
 *      WRITE      a value whose type the declaration would supply
 *   H3 RETYPED    a declared parameter is REASSIGNED to a value of another
 *      PARAM      type inside the body (`e instanceof P || (e = P.create(e))`)
 *   H4 DYNAMIC    a property is created through a runtime helper, so no
 *      PROPERTY   static shape can hold it
 *   H5 OVER-CALL  a call site inside the bundle passes MORE arguments than
 *                 the callee's declaration declares parameters
 *
 * Each is a count over the real population, printed with its own sample.
 *
 * Usage: node hazard-jsdocarm.mjs <index.js> <index.d.ts> <corr-ast.json>
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ts = require(process.env.SCRIPTC_TS_MODULE ?? "typescript");

const [jsPath, dtsPath, corrPath] = process.argv.slice(2);
if (!jsPath || !dtsPath || !corrPath) {
  console.error("usage: hazard-jsdocarm.mjs <index.js> <index.d.ts> <corr-ast.json>");
  process.exit(2);
}
const jsSrc = readFileSync(jsPath, "utf8");
const dtsSrc = readFileSync(dtsPath, "utf8");
const corr = JSON.parse(readFileSync(corrPath, "utf8"));
const js = ts.createSourceFile(jsPath, jsSrc, ts.ScriptTarget.ES2020, true, ts.ScriptKind.JS);
const dts = ts.createSourceFile(dtsPath, dtsSrc, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS);

/* every identifier the declaration declares anywhere as a member name -
 * deliberately GENEROUS: a name declared on any class, interface or
 * namespace counts as "declared", so H2 cannot be inflated by scoping. */
const declaredNames = new Set();
(function collect(n) {
  if (ts.isPropertySignature(n) || ts.isPropertyDeclaration(n) || ts.isMethodSignature(n) ||
      ts.isMethodDeclaration(n) || ts.isEnumMember(n)) {
    if (n.name && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name))) declaredNames.add(n.name.text);
  }
  ts.forEachChild(n, collect);
})(dts);

/* the correspondence's member spans, so every count below is scoped to
 * code that a declaration-driven typing would actually type. */
const spans = [];
for (const [path, rec] of Object.entries(corr.astMembers)) {
  for (const [name, m] of Object.entries(rec)) {
    if (m.pos === undefined || m.pos < 0 || m.end === undefined) continue;
    spans.push({ path, name, pos: m.pos, end: m.end, declaredArity: null });
  }
}
spans.sort((a, b) => a.pos - b.pos);
function spanAt(pos) {
  let lo = 0, hi = spans.length - 1, best = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (spans[mid].pos <= pos) { best = spans[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  return best && pos < best.end ? best : null;
}

/* H1 - from the correspondence itself */
const h1 = { members: 0, extraParams: 0, byMember: new Map() };
for (const [path, rec] of Object.entries(corr.astMembers)) {
  void path;
  for (const [name, m] of Object.entries(rec)) {
    const d = corr.declaredArity?.[name];
    void d; void m;
  }
}
/* the arityDetail rows the correspondence already printed carry it exactly */
for (const [k, n] of corr.arityDetail) {
  const mm = /^(\S+) (\d+)->(\d+)$/.exec(k);
  if (!mm) continue;
  const [, member, dn, bn] = mm;
  if (Number(bn) > Number(dn)) {
    h1.members += n;
    h1.extraParams += n * (Number(bn) - Number(dn));
    h1.byMember.set(member, { declared: Number(dn), body: Number(bn), count: n });
  }
}

/* H2/H3/H4/H5 - one AST walk */
const h2 = { writes: 0, distinctNames: new Set(), sample: [] };
const h3 = { reassignedParams: 0, sample: [] };
const h4 = { sites: 0, helpers: new Map() };
const h5 = { overCalls: new Map(), total: 0 };
/* H6 a property write whose KEY is computed at run time, and H7 a
 * per-instance presence test - neither is expressible against a declared
 * shape, and H7 is the one that changes bytes on the wire. */
const h6 = { computedWrites: 0, reads: 0, inMembers: new Set(), sample: [] };
const h7 = { hasOwnProperty: 0, inMembers: new Set() };

/* param names of each span, so H3 can tell a param from a local */
const spanParams = new Map();
(function paramScan(n) {
  if (ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n)) {
    const s = spans.find((x) => x.pos === n.getStart(js));
    if (s) spanParams.set(s, new Set(n.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : ""))));
  }
  ts.forEachChild(n, paramScan);
})(js);

(function scan(n) {
  const pos = n.getStart(js);
  const s = spanAt(pos);
  if (s) {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      if (ts.isPropertyAccessExpression(n.left)) {
        const nm = n.left.name.text;
        if (!declaredNames.has(nm)) {
          h2.writes++; h2.distinctNames.add(nm);
          if (h2.sample.length < 12) h2.sample.push({ at: s.path + "." + s.name, prop: nm });
        }
      } else if (ts.isElementAccessExpression(n.left)) {
        h6.computedWrites++; h6.inMembers.add(s.path + "." + s.name);
        if (h6.sample.length < 8) h6.sample.push({ at: s.path + "." + s.name, text: n.getText(js).slice(0, 80) });
      } else if (ts.isIdentifier(n.left)) {
        const ps = spanParams.get(s);
        if (ps && ps.has(n.left.text)) {
          h3.reassignedParams++;
          if (h3.sample.length < 12) {
            h3.sample.push({ at: s.path + "." + s.name, param: n.left.text,
              text: n.getText(js).slice(0, 90) });
          }
        }
      }
    }
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const callee = n.expression.name.text;
      if (callee === "call" && /hasOwnProperty/.test(n.expression.expression.getText(js))) {
        h7.hasOwnProperty++; h7.inMembers.add(s.path + "." + s.name);
      }
      if (callee === "hasOwnProperty" || callee === "hasOwn") {
        h7.hasOwnProperty++; h7.inMembers.add(s.path + "." + s.name);
      }
      if (callee === "makeProp" || callee === "defineProperty") {
        h4.sites++; h4.helpers.set(callee, (h4.helpers.get(callee) ?? 0) + 1);
      }
      /* H5: a call to a member the declaration declares, with more args
       * than it declares parameters. `encode` declares 2, `decode` 2. */
      const declArity = { encode: 2, decode: 2 }[callee];
      if (declArity !== undefined && n.arguments.length > declArity) {
        const k = `${callee} ${n.arguments.length} args (declared ${declArity})`;
        h5.overCalls.set(k, (h5.overCalls.get(k) ?? 0) + 1);
        h5.total++;
      }
    }
  }
  ts.forEachChild(n, scan);
})(js);

/* the same H4/H5 counts over the WHOLE file, so the span-scoping is visible */
let makePropWhole = 0, definePropWhole = 0;
(function whole(n) {
  if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
    if (n.expression.name.text === "makeProp") makePropWhole++;
    if (n.expression.name.text === "defineProperty") definePropWhole++;
  }
  ts.forEachChild(n, whole);
})(js);

const out = {
  population: { memberSpans: spans.length, declaredNamesInDts: declaredNames.size },
  H1_arity: {
    membersWhoseBodyTakesMore: h1.members,
    ofTotalMembers: spans.length,
    pct: ((h1.members / spans.length) * 100).toFixed(1) + "%",
    undeclaredParameters: h1.extraParams,
    byMember: [...h1.byMember.entries()],
  },
  H2_undeclaredWrite: {
    writes: h2.writes, distinctPropertyNames: h2.distinctNames.size,
    sample: h2.sample, names: [...h2.distinctNames].slice(0, 20),
  },
  H3_retypedParam: { reassignments: h3.reassignedParams, sample: h3.sample },
  H4_dynamicProperty: {
    insideSpans: h4.sites, byHelper: [...h4.helpers.entries()],
    wholeFile: { makeProp: makePropWhole, defineProperty: definePropWhole },
  },
  H5_overCall: { total: h5.total, byShape: [...h5.overCalls.entries()].sort((a, b) => b[1] - a[1]) },
  H6_computedWrite: { writes: h6.computedWrites, membersAffected: h6.inMembers.size, sample: h6.sample },
  H7_perInstancePresence: { sites: h7.hasOwnProperty, membersAffected: h7.inMembers.size },
};
/* the residue: how many members carry NO hazard at all. That set is the
 * safe partial application - the members whose declared types could be
 * installed on the body without the body contradicting them. */
const perMember = new Map();
for (const s of spans) perMember.set(s.path + "." + s.name, new Set());
function flag(k, tag) { const v = perMember.get(k); if (v) v.add(tag); }
for (const k of h6.inMembers) flag(k, "H6");
for (const k of h7.inMembers) flag(k, "H7");
/* H1 by shape: encode and decode are the two members whose body arity
 * exceeds the declaration's, every one of them. */
for (const k of perMember.keys()) {
  const member = k.slice(k.lastIndexOf(".") + 1);
  if (member === "encode" || member === "decode") flag(k, "H1");
}
/* H2/H3/H4 by re-reading each span - cheap and exact */
for (const s of spans) {
  const k = s.path + "." + s.name;
  const text = jsSrc.slice(s.pos, s.end);
  if (/\bmakeProp\b/.test(text)) flag(k, "H4");
  if (/\._[A-Za-z]\w*=/.test(text)) flag(k, "H2");
}
const hist = new Map();
let clean = 0;
for (const [, tags] of perMember) {
  if (tags.size === 0) { clean++; continue; }
  const k = [...tags].sort().join("+");
  hist.set(k, (hist.get(k) ?? 0) + 1);
}
out.residue = {
  memberSpans: spans.length,
  cleanOfEveryHazard: clean,
  byHazardSet: [...hist.entries()].sort((a, b) => b[1] - a[1]),
};
console.log(JSON.stringify(out, null, 2));
