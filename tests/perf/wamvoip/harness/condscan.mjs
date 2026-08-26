#!/usr/bin/env node
/* condscan.mjs — BLAST RADIUS of adding the "node" export condition.
 *
 * For every installed package under the given roots, resolve every exports
 * subpath under the CURRENT condition set {types,import,default} and under
 * the PROPOSED set {types,node,import,default}, using the compiler's own
 * resolveExportsTypes semantics (exact keys, then '*' patterns, condition
 * objects in OBJECT KEY ORDER, arrays first-resolvable).
 *
 * Prints one row per subpath whose target CHANGES. A package that changes is
 * a package where the compiler today resolves a file Node would not.
 *
 * ARMED CONTROLS (printed first, and they must both hold):
 *   +  file-type "."   MUST change  ./core.d.ts -> ./index.d.ts
 *   -  zapo-js   "."   MUST NOT change (no "node" key anywhere)
 * A scan that reports "nothing changed" without the positive control firing
 * is a broken scan, not a clean tree. */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const CUR = new Set(["types", "import", "default"]);
const NEW = new Set(["types", "node", "import", "default"]);

/* A transcription of resolveExportsTypes from
 * packages/compiler/src/frontend/resolve.ts. Kept structurally identical so
 * a divergence here is a bug in the transcription, not in the answer. */
function resolveExportsTypes(exports, subpath, conditions) {
  const resolveTarget = (target, wildcard) => {
    if (typeof target === "string") {
      return wildcard === null ? target : target.split("*").join(wildcard);
    }
    if (Array.isArray(target)) {
      for (const t of target) {
        const r = resolveTarget(t, wildcard);
        if (r) return r;
      }
      return null;
    }
    if (target && typeof target === "object") {
      for (const [key, value] of Object.entries(target)) {
        if (key.startsWith(".")) continue;
        if (conditions.has(key)) {
          const r = resolveTarget(value, wildcard);
          if (r) return r;
        }
      }
    }
    return null;
  };
  if (typeof exports === "string" || Array.isArray(exports)) {
    return subpath === "." ? resolveTarget(exports, null) : null;
  }
  if (exports && typeof exports === "object") {
    const map = exports;
    const keys = Object.keys(map);
    if (!keys.every((k) => k.startsWith("."))) {
      return subpath === "." ? resolveTarget(exports, null) : null;
    }
    if (Object.prototype.hasOwnProperty.call(map, subpath)) {
      return resolveTarget(map[subpath], null);
    }
    let best = null;
    for (const key of keys) {
      const star = key.indexOf("*");
      if (star < 0) continue;
      const prefix = key.slice(0, star);
      const suffix = key.slice(star + 1);
      if (
        subpath.startsWith(prefix) &&
        subpath.endsWith(suffix) &&
        subpath.length >= prefix.length + suffix.length &&
        (best === null || prefix.length > best.prefix.length)
      ) {
        best = { key, prefix, suffix };
      }
    }
    if (best !== null) {
      const wildcard = subpath.slice(best.prefix.length, subpath.length - best.suffix.length);
      return resolveTarget(map[best.key], wildcard);
    }
  }
  return null;
}

/** Every literal subpath key an exports map declares (patterns kept as-is
 * so a '*' key is probed with a representative name too). */
function subpathsOf(exports) {
  if (typeof exports === "string" || Array.isArray(exports)) return ["."];
  if (!exports || typeof exports !== "object") return [];
  const keys = Object.keys(exports);
  if (!keys.every((k) => k.startsWith("."))) return ["."];
  return keys;
}

/** Does this exports map mention "node" ANYWHERE? Cheap prefilter, and also
 * the honest denominator: a package with no "node" key cannot move. */
function mentionsNode(v) {
  if (typeof v === "string") return false;
  if (Array.isArray(v)) return v.some(mentionsNode);
  if (v && typeof v === "object") {
    for (const [k, val] of Object.entries(v)) {
      if (k === "node" || k === "node-addons") return true;
      if (mentionsNode(val)) return true;
    }
  }
  return false;
}

function* packagesUnder(root) {
  const stack = [root];
  const seen = new Set();
  while (stack.length) {
    const nm = stack.pop();
    if (seen.has(nm)) continue;
    seen.add(nm);
    let entries;
    try {
      entries = readdirSync(nm, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory() && !e.isSymbolicLink()) continue;
      if (e.name === ".bin") continue;
      const dir = join(nm, e.name);
      // pnpm's CONTENT STORE. `node_modules/.pnpm/<pkg>@<ver>/node_modules/`
      // is where every real package lives in a pnpm install; the top level
      // is a symlink farm holding only the direct dependencies. A scan that
      // walks only the top level sees a fraction of the tree and reports a
      // blast radius far too small. (It did.)
      if (e.name === ".pnpm") {
        let vers;
        try {
          vers = readdirSync(dir, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const v of vers) {
          const inner = join(dir, v.name, "node_modules");
          if (existsSync(inner)) stack.push(inner);
        }
        continue;
      }
      if (e.name.startsWith(".")) continue;
      if (e.name.startsWith("@")) {
        let scoped;
        try {
          scoped = readdirSync(dir, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const s of scoped) {
          const sd = join(dir, s.name);
          yield [`${e.name}/${s.name}`, sd];
          const inner = join(sd, "node_modules");
          if (existsSync(inner)) stack.push(inner);
        }
        continue;
      }
      yield [e.name, dir];
      const inner = join(dir, "node_modules");
      if (existsSync(inner)) stack.push(inner);
    }
  }
}

const roots = process.argv.slice(2);
if (roots.length === 0) {
  console.error("usage: condscan.mjs <node_modules dir> ...");
  process.exit(2);
}

const changed = new Map(); // pkg -> [{subpath, cur, next}]
const withNode = new Set();
let pkgCount = 0;
const seenPkgVersion = new Set();

for (const root of roots) {
  for (const [name, dir] of packagesUnder(root)) {
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    } catch {
      continue;
    }
    const key = `${name}@${pkg.version ?? "?"}`;
    if (seenPkgVersion.has(key)) continue;
    seenPkgVersion.add(key);
    pkgCount++;
    if (pkg.exports === undefined) continue;
    if (!mentionsNode(pkg.exports)) continue;
    withNode.add(key);
    const rows = [];
    for (const sp of subpathsOf(pkg.exports)) {
      const probe = sp.includes("*") ? sp.split("*").join("PROBE") : sp;
      const cur = resolveExportsTypes(pkg.exports, probe, CUR);
      const next = resolveExportsTypes(pkg.exports, probe, NEW);
      if (cur !== next) rows.push({ subpath: probe, cur, next });
    }
    if (rows.length) changed.set(key, rows);
  }
}

console.log(`packages scanned (name@version, deduped): ${pkgCount}`);
console.log(`packages whose exports mention "node": ${withNode.size}`);
console.log(`packages whose RESOLUTION changes:      ${changed.size}`);
console.log("");
for (const [k, rows] of [...changed].sort()) {
  console.log(`${k}`);
  for (const r of rows) console.log(`    ${r.subpath.padEnd(28)} ${r.cur}  ->  ${r.next}`);
}

/* ── armed controls ──────────────────────────────────────────────────────
 * A scan whose answer is "nothing changes" is only believable if the scan
 * can be SHOWN to detect a change when one is present, and to leave alone a
 * package that must not move. Both run over the same trees as the corpus.
 *   POSITIVE  file-type "."  must move core -> index (the media-utils defect)
 *   NEGATIVE  zapo-js  "."   must be SEEN and must NOT move (no "node" key)
 * Either control missing from the scanned trees is itself a failure: an
 * absent control proves nothing. */
let ctlFail = 0;
const ft = [...changed].find(([k]) => k.startsWith("file-type@"));
if (!ft) {
  console.log("CONTROL FAIL  positive: file-type did not move (or was not scanned)");
  ctlFail++;
} else if (!(ft[1].some((r) => r.subpath === "." && /core/.test(r.cur) && /index/.test(r.next)))) {
  console.log(`CONTROL FAIL  positive: file-type moved, but not core -> index: ${JSON.stringify(ft[1])}`);
  ctlFail++;
} else {
  console.log("CONTROL ok    positive: file-type '.'  core -> index");
}
const zapoSeen = [...seenPkgVersion].some((k) => k.startsWith("zapo-js@"));
if (!zapoSeen) {
  console.log("CONTROL FAIL  negative: zapo-js was not in any scanned tree");
  ctlFail++;
} else if ([...changed].some(([k]) => k.startsWith("zapo-js@"))) {
  console.log("CONTROL FAIL  negative: zapo-js moved, and it has no \"node\" key");
  ctlFail++;
} else {
  console.log("CONTROL ok    negative: zapo-js seen, unmoved");
}
console.log(ctlFail === 0 ? "CONTROLS PASS" : `CONTROLS FAIL (${ctlFail})`);
process.exit(ctlFail === 0 ? 0 : 1);
