/* Every surface that reads a dyn OBJECT, on both backends, byte-exact
 * against this machine's Node.
 *
 * WHY THIS FILE EXISTS. `ScrDyn` is the central runtime value — every
 * dynamic object, every static/dyn crossing and every property table goes
 * through it — so a change to its REPRESENTATION has the whole language
 * surface as its blast radius. The failure mode is not a crash. It is a
 * silent wrong answer on ONE projection of an object that every other
 * projection still gets right: a block closed SEVEN of them in one session
 * that all came from one missing attribute in `scr_dyn_obj_key_order`, and
 * every one of them exited 0.
 *
 * What makes that possible is that the member table is read by ten
 * consumers with three different contracts:
 *
 *   own + ENUMERABLE only   Object.keys / values / entries, for...in,
 *                           spread, Object.assign, JSON.stringify,
 *                           structuredClone
 *   own, enumerable or not  Object.getOwnPropertyNames, Object.hasOwn,
 *                           delete, a keyed read
 *   the whole chain         a keyed read that misses, and `in`
 *
 * and by ONE ordering rule none of them may disagree about: JS lists
 * integer-like own keys FIRST in ascending numeric order, then every other
 * key in insertion order. `"01"`, `"1e2"`, `"-1"` and `"4294967295"` are
 * NOT integer-like and belong in the insertion run; `"4294967294"` is.
 * Case 1 carries all four, because a representation change that quietly
 * re-sorts the table gets the common cases right.
 *
 * ONE SURFACE PER CASE, deliberately. The first draft of this file was ten
 * programs, one per theme, and all twenty cells came back as refusals on
 * unmodified main — one unsupported construct per program hid every
 * answer beside it. A cell has to be MATCH before it can protect anything.
 *
 * BOTH BACKENDS, always. The C emitter writes field accesses by NAME and
 * recompiles with whatever the runtime header says; the LLVM backend
 * hardcodes ScrDyn's byte offsets. A layout change is therefore never
 * runtime-only here, and a one-backend probe would ship a garbage length
 * with the C lane green — which is what happened to the 16-byte cycle
 * header before `cycMarkLiveIr()` unified its three hardcoded copies.
 *
 * The oracle is `process.execPath`, not a recorded string: an expectation
 * written down here would be a second thing that can be wrong, and it
 * would rot silently.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";

interface Case {
  readonly name: string;
  readonly src: string;
}

const CASES: readonly Case[] = [
  { name: "Object.keys order, integer-like first", src: `"use strict";
const o = {};
o.zeta = 1; o["10"] = 2; o.alpha = 3; o["2"] = 4; o["0"] = 5;
console.log(JSON.stringify(Object.keys(o)));
` },
  { name: "Object.keys order, the four non-index edges", src: `"use strict";
const o = {};
o.a = 1; o["-1"] = 2; o["01"] = 3; o["1e2"] = 4; o["4294967295"] = 5; o["4294967294"] = 6;
console.log(JSON.stringify(Object.keys(o)));
` },
  { name: "Object.values in key order", src: `"use strict";
const o = {}; o.z = "z"; o["3"] = "three"; o.a = "a"; o["1"] = "one";
console.log(JSON.stringify(Object.values(o)));
` },
  { name: "Object.entries in key order", src: `"use strict";
const o = {}; o.z = 1; o["3"] = 2; o.a = 3; o["1"] = 4;
console.log(JSON.stringify(Object.entries(o)));
` },
  { name: "JSON.stringify in key order", src: `"use strict";
const o = {}; o.z = 1; o["3"] = 2; o.a = 3; o["1"] = 4;
console.log(JSON.stringify(o));
` },
  { name: "for...in in key order", src: `"use strict";
const o = JSON.parse('{"z":1,"3":2,"a":3,"1":4}');
const seen = [];
for (const k in o) seen.push(k);
console.log(JSON.stringify(seen));
` },
  { name: "Object.assign copies own enumerable in key order", src: `"use strict";
const o = {}; o.z = 1; o["3"] = 2; o.a = 3;
const c = Object.assign({}, o);
console.log(JSON.stringify(Object.keys(c)), JSON.stringify(c));
` },
  { name: "spread copies own enumerable in key order", src: `"use strict";
const o = {}; o.z = 1; o["3"] = 2; o.a = 3;
const c = { ...o };
console.log(JSON.stringify(Object.keys(c)), JSON.stringify(c));
` },
  { name: "structuredClone keeps key order", src: `"use strict";
const o = {}; o.z = 1; o["3"] = 2; o.a = 3;
const c = structuredClone(o);
console.log(JSON.stringify(Object.keys(c)), JSON.stringify(c));
` },
  { name: "util.inspect renders a plain object", src: `"use strict";
const util = require("node:util");
const o = {}; o.z = 1; o.a = "s"; o.b = true;
console.log(util.inspect(o));
` },
  { name: "Object.getOwnPropertyNames in key order", src: `"use strict";
const o = {}; o.z = 1; o["3"] = 2; o.a = 3;
console.log(JSON.stringify(Object.getOwnPropertyNames(o)));
` },
  { name: "keyed read, `in`, hasOwn", src: `"use strict";
const o = {}; o.a = 1; o.b = "two";
console.log(o.a, o.b, o.nope === undefined);
console.log("a" in o, "nope" in o);
console.log(Object.hasOwn(o, "a"), Object.hasOwn(o, "nope"));
` },
  { name: "delete then re-add puts the key LAST", src: `"use strict";
const o = JSON.parse('{"a":1,"b":2,"c":3}');
delete o.b;
console.log(JSON.stringify(Object.keys(o)));
o.b = 9;
console.log(JSON.stringify(Object.keys(o)), JSON.stringify(o));
` },
  { name: "overwrite keeps the original position", src: `"use strict";
const o = {}; o.a = 1; o.b = 2; o.c = 3;
o.a = 100;
console.log(JSON.stringify(Object.keys(o)), JSON.stringify(o));
` },
  { name: "nested objects read and stringify", src: `"use strict";
const o = JSON.parse('{"a":{"b":{"c":1}},"d":[1,2,{"e":"x"}]}');
console.log(JSON.stringify(o));
console.log(o.a.b.c, o.d[2].e, o.d.length);
` },
  { name: "an array's length, index and JSON", src: `"use strict";
const a = JSON.parse('[1,"two",true,null,[3,4]]');
console.log(a.length, JSON.stringify(a), a[1], a[4][0]);
` },
  { name: "a dyn array grown past its first buffer", src: `"use strict";
const a = JSON.parse('[]');
for (let i = 0; i < 100; i++) a.push(i * 2);
console.log(a.length, a[0], a[99], JSON.stringify(a).length);
` },
  { name: "scalars round-tripping through a dyn member", src: `"use strict";
const o = { n: null, t: true, f: false, z: 0, x: 1.5, s: "str", e: "" };
console.log(JSON.stringify(o), JSON.stringify(Object.keys(o)));
console.log(typeof o.n, typeof o.t, typeof o.z, typeof o.s);
` },
  { name: "defineProperty: a non-enumerable data property is not an own key", src: `"use strict";
const o = { visible: 1 };
Object.defineProperty(o, "hidden", { value: 2, writable: true, configurable: true });
console.log(JSON.stringify(Object.keys(o)), JSON.stringify(o));
console.log(o.hidden, "hidden" in o, Object.hasOwn(o, "hidden"));
` },
  { name: "defineProperty: an accessor reads and writes through", src: `"use strict";
const o = { visible: 1 };
let backing = 10;
Object.defineProperty(o, "acc", {
  get() { return backing; }, set(v) { backing = v; }, configurable: true,
});
console.log(JSON.stringify(Object.keys(o)), JSON.stringify(o));
console.log(o.acc);
o.acc = 21;
console.log(o.acc, backing, "acc" in o);
` },
  { name: "the prototype chain answers a read and not a key", src: `"use strict";
function F(v) { this.own = v; }
F.prototype.inherited = "p";
const f = new F("x");
console.log(JSON.stringify(Object.keys(f)), JSON.stringify(f));
console.log(f.own, f.inherited, "inherited" in f, Object.hasOwn(f, "inherited"));
` },
  { name: "Object.create(null) is a dictionary with keys and JSON", src: `"use strict";
const d = Object.create(null);
d.b = 1; d.a = 2; d["3"] = 3;
console.log(JSON.stringify(Object.keys(d)), JSON.stringify(d));
console.log(d.a, d["3"], d.nope === undefined);
` },
  { name: "a function value's name and length", src: `"use strict";
function named(a, b) { return a + b; }
const arrow = (a, b, c) => a + b + c;
console.log(named.name, named.length, typeof named);
console.log(arrow.name, arrow.length, arrow(1, 2, 3));
` },
  { name: "a wide object: 65 members past every entries doubling", src: `"use strict";
const o = {};
for (let i = 0; i < 65; i++) o["k" + i] = i;
const keys = Object.keys(o);
console.log(keys.length, keys[0], keys[64], o["k64"], JSON.stringify(o).length);
` },
  { name: "a long key past any inline-key window", src: `"use strict";
const o = {};
o["a".repeat(120)] = "long";
o.b = 1;
const keys = Object.keys(o);
console.log(keys.length, keys[0].length, o[keys[0]], JSON.stringify(o).length);
` },
  { name: "40 levels of nesting build and release", src: `"use strict";
let deep = JSON.parse('{"leaf":1}');
for (let i = 0; i < 40; i++) { const n = JSON.parse('{"leaf":' + i + '}'); n.child = deep; deep = n; }
let walk = deep, depth = 0;
while (walk.child !== undefined) { walk = walk.child; depth++; }
console.log(depth, walk.leaf, JSON.stringify(deep).length);
` },
  { name: "JSON.parse builds the same table the boundary does", src: `"use strict";
const o = JSON.parse('{"z":1,"10":2,"a":{"nested":[1,2,{"deep":true}]},"2":3,"s":"str"}');
console.log(JSON.stringify(Object.keys(o)));
console.log(JSON.stringify(o));
console.log(o.a.nested[2].deep, o["10"], o.s.length);
` },
  { name: "many objects made and dropped: the freelist recycles", src: `"use strict";
let last = "";
for (let i = 0; i < 2000; i++) {
  const o = JSON.parse('{"a":' + i + ',"b":{"c":"x"},"d":[1,2,3]}');
  last = JSON.stringify(Object.keys(o)) + JSON.stringify(o.d) + o.b.c + o.a;
}
console.log(last);
` },
];

const BACKENDS = ["c", "llvm"] as const;

describe("every dyn object surface, both backends, byte-exact against node", () => {
  for (const backend of BACKENDS) {
    for (const [i, c] of CASES.entries()) {
      test(`${c.name} (${backend})`, { timeout: 300_000 }, async () => {
        const dir = mkdtempSync(join(tmpdir(), `scr-dynobj${i}-${backend}-`));
        // A .js entry: these are dynamic programs, and the JS route is what
        // puts every value through ScrDyn rather than through a record.
        const src = join(dir, "prog.js");
        writeFileSync(src, c.src);

        const result = await compile(src, {
          // The extension matters on Windows: the driver names the artifact
          // from this path, and a bare "prog" is not executable there.
          outPath: join(dir, `prog${process.platform === "win32" ? ".exe" : ""}`),
          outDir: dir,
          backend,
        });
        if (!result.ok) {
          throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
        }

        const want = execFileSync(process.execPath, [src], { encoding: "utf8", timeout: 120_000 });

        let got = "";
        let stderr = "";
        let status = 0;
        try {
          got = execFileSync(result.binaryPath, {
            encoding: "utf8",
            timeout: 120_000,
            stdio: ["ignore", "pipe", "pipe"],
          });
        } catch (e) {
          const err = e as { status?: number; stdout?: string; stderr?: string };
          status = err.status ?? -1;
          got = err.stdout ?? "";
          stderr = err.stderr ?? "";
        }
        expect(status, `exited ${status}; stderr:\n${stderr}`).toBe(0);
        expect(got).toBe(want);
      });
    }
  }
});
