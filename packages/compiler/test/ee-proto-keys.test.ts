/* The EventEmitter prototype's enumerable keys, as for-in visits them after an
 * EventEmitter subclass instance's own keys. The runtime keeps its own copy of the
 * list (packages/runtime/src/scr_dyn_class.c, SCR_EE_PROTO_KEYS); this test reads that
 * copy and fails if the pinned Node's answer differs, so a Node version change is
 * loud instead of a silent for-in divergence. */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const runtimeSource = readFileSync(
  join(import.meta.dirname, "../../runtime/src/scr_dyn_class.c"),
  "utf8",
);

function runtimeKeyList(): string[] {
  const m = /static const char \*const SCR_EE_PROTO_KEYS\[\] = \{([\s\S]*?)\};/.exec(runtimeSource);
  if (m === null) throw new Error("SCR_EE_PROTO_KEYS not found in scr_dyn_class.c");
  return [...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
}

describe("EventEmitter prototype for-in keys", () => {
  test("the runtime table equals the pinned Node's for-in over EventEmitter.prototype", () => {
    const script =
      'const EE = require("events").EventEmitter; const ks = []; for (const k in EE.prototype) ks.push(k); process.stdout.write(ks.join("\\n"));';
    const nodeKeys = execFileSync(process.execPath, ["-e", script], { encoding: "utf8" })
      .split("\n")
      .filter((k) => k.length > 0);
    expect(runtimeKeyList()).toEqual(nodeKeys);
  });
});
