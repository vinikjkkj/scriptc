/* An object or array literal built from `any` members and handed to a parameter declared `any` or `unknown` (inspect-any-literal.ts isDynArgLiteral).
 * The erased twin of a typed emitter listener (emitter-twin.ts) sees every event field as `any`, so `push(kind, { qr: e.qr })` over its parameter was refused (SC2001) and the
 * whole twin load with it: the typed listener stayed on the checked boundary (a TypeError for a payload outside the declared type, where Node carries on).
 *   - positive control: the twin load of the listener lowers with no diagnostic (it carries SC2001 without the change);
 *   - the plain function over an `any` parameter compiles too (the twin is only the way real programs meet the shape). */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { checkPreflight, loadProgram } from "../src/frontend/program.js";
import { lowerToIr } from "../src/frontend/lowering/lowerer.js";

function lowerCodes(src: string, twin: boolean): string[] {
  const dir = mkdtempSync(join(tmpdir(), "scriptc-twinany-"));
  const file = join(dir, "main.ts");
  writeFileSync(file, src);
  let edits: ReturnType<typeof lowerToIr>["twinReload"];
  if (twin) {
    const first = loadProgram(file);
    try {
      edits = lowerToIr(first.program, first.entry, first.moduleOrder, { noPinReload: true }).twinReload;
    } finally {
      first.dispose();
    }
    expect(edits).toBeDefined();
  }
  const load = loadProgram(file, edits === undefined ? undefined : { twinEdits: edits });
  try {
    expect(checkPreflight(load)).toEqual([]);
    return lowerToIr(load.program, load.entry, load.moduleOrder, { noPinReload: true, noTwinReload: true }).diagnostics.map((d) => d.code);
  } finally {
    load.dispose();
  }
}

const LISTENER = `
import { EventEmitter } from "node:events";
interface Ev { qr: string; ttlMs: number }
class Client extends EventEmitter {
  on(event: "auth_qr", l: (e: Ev) => void): this;
  on(event: string, l: (...a: any[]) => void): this { return super.on(event, l); }
}
function push(kind: string, data: unknown): void { console.log(kind, JSON.stringify(data)); }
const c = new Client();
const hold: { v: any } = { v: c };
c.on("auth_qr", (e) => { push("auth_qr", { qr: e.qr, ttlMs: e.ttlMs, both: [e.qr, e.ttlMs] }); });
hold.v.emit.apply(hold.v, ["auth_qr", { qr: "Q", ttlMs: 7 }]);
`;

test("the erased twin that builds a literal from any members for an unknown parameter lowers", () => {
  expect(lowerCodes(LISTENER, true)).toEqual([]);
}, 120_000);

test("a plain function over an any parameter hands such a literal to unknown and any parameters", () => {
  const src = `
function push(kind: string, data: unknown): void { console.log(kind, JSON.stringify(data)); }
function pushAny(kind: string, data: any): void { console.log(kind, JSON.stringify(data)); }
function h(e: any) { push("k", { qr: e.qr }); pushAny("k", [e.qr, { z: e.z }]); }
h({ qr: "Q", z: 1 });
`;
  expect(lowerCodes(src, false)).toEqual([]);
}, 120_000);
