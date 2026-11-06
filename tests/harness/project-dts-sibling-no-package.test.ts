/* A relative import that resolves to a project declaration file (`q.d.ts`) whose runtime sibling (`q.js`) sits beside it,
 * in a tree NO package.json claims.
 *
 * Node's require loads `q.js`. The declaration-twin resolution used to need the entry to have a package.json (its
 * "realm"): without one the declaration answered alone, the module had a type surface and an empty body, and a method
 * called through a field of that type dispatched at RUN time over a value that carried no such member -- the build passed
 * and the binary died saying `this.q.push is not a function` where Node answers. A tree with no package.json is its own
 * realm, so the sibling joins the program.
 *
 * The program is written to a fresh directory under the temp dir (the repository's own package.json would otherwise be
 * the realm) and both backends are compared with a string recorded from Node. */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const execFileAsync = promisify(execFile);
const root = mkdtempSync(join(tmpdir(), "dts-sibling-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function claimedByPackageJson(dir: string): boolean {
  for (let d = dir; ; d = dirname(d)) {
    if (existsSync(join(d, "package.json"))) return true;
    if (dirname(d) === d) return false;
  }
}

const QD = `declare class Q {
  length: number;
  constructor();
  push(item: number): number;
  shift(): number | undefined;
}
export = Q;
`;
const QJ = `"use strict";
function Q() {
  this._items = [];
  this._head = 0;
}
Q.prototype.push = function push(item) {
  this._items.push(item);
  return this._items.length - this._head;
};
Q.prototype.shift = function shift() {
  if (this._head >= this._items.length) return undefined;
  return this._items[this._head++];
};
Object.defineProperty(Q.prototype, "length", {
  get: function length() {
    return this._items.length - this._head;
  },
});
module.exports = Q;
`;
const MAIN = `const Q = require("./q");
class Box {
  constructor() {
    this.q = new Q();
  }
  add(x) {
    this.q.push(x);
  }
  drain() {
    const out = [];
    let it;
    while ((it = this.q.shift())) out.push(it);
    return out;
  }
  size() {
    return this.q.length;
  }
}
const b = new Box();
b.add(1);
b.add(2);
b.add(3);
console.log(b.size(), b.drain().join(","), b.size());
`;
const EXPECTED = "3 1,2,3 0\n";

describe("a project declaration twin in a tree no package.json claims", () => {
  test.skipIf(claimedByPackageJson(root))("the sibling js runs (c and llvm)", async () => {
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "q.d.ts"), QD);
    writeFileSync(join(root, "q.js"), QJ);
    writeFileSync(join(root, "main.js"), MAIN);
    for (const backend of ["c", "llvm"] as const) {
      const outPath = join(root, exeName(`main-${backend}`));
      const result = await compile(join(root, "main.js"), { outPath, outDir: root, dynamic: false, backend });
      if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
      const { stdout } = await execFileAsync(outPath, [], { encoding: "utf8" });
      expect(stdout, backend).toBe(EXPECTED);
    }
  }, 300_000);
});
