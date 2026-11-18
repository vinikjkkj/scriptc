/* The twin of a listener named by a const arrow (emitter-twin.ts declTwin) is inserted right after that statement. A program written
 * without semicolons ends the statement at its closing brace, so the twin declaration used to follow on the SAME line
 * (`} const __sctwin_0 = ...`), a syntax error: the twin load was refused by preflight and the typed listener silently served a dynamic
 * emit (a TypeError at run time where Node prints the value). The insertion now ends the statement first.
 *   - positive control: the twin load of the semicolon-free program passes preflight, and the insertion carries the `;`;
 *   - negative control: the same program written WITH semicolons gets no extra `;` (its twin text is unchanged). */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { checkPreflight, loadProgram } from "../src/frontend/program.js";
import { lowerToIr } from "../src/frontend/lowering/lowerer.js";

const BODY = (semi: string): string => `
import { EventEmitter } from "node:events"${semi}
class Box extends EventEmitter { n = 0${semi} }
const b = new Box()${semi}
const hold: { v: any } = { v: b }${semi}
const listener = (v: number) => {
  console.log("ident", typeof v, v + 1)${semi}
}${semi}
b.on("x", listener)${semi}
hold.v.emit.apply(hold.v, ["x", "5"])${semi}
`;

function twin(src: string): { edits: string[]; clean: boolean } {
  const dir = mkdtempSync(join(tmpdir(), "scriptc-twinasi-"));
  const file = join(dir, "main.ts");
  writeFileSync(file, src);
  const first = loadProgram(file);
  let edits: ReturnType<typeof lowerToIr>["twinReload"];
  try {
    expect(checkPreflight(first)).toEqual([]);
    edits = lowerToIr(first.program, first.entry, first.moduleOrder, { noPinReload: true }).twinReload;
  } finally {
    first.dispose();
  }
  expect(edits).toBeDefined();
  const texts = [...edits!.values()].flatMap((l) => l.map((e) => e.text));
  const again = loadProgram(file, { twinEdits: edits! });
  try {
    return { edits: texts, clean: checkPreflight(again).length === 0 };
  } finally {
    again.dispose();
  }
}

test("a semicolon-free const listener gets a twin whose load is valid syntax", () => {
  const r = twin(BODY(""));
  expect(r.edits.some((t) => t.startsWith("; const __sctwin_"))).toBe(true);
  expect(r.clean).toBe(true);
}, 120_000);

test("the same program with semicolons keeps its twin text (no extra ;)", () => {
  const r = twin(BODY(";"));
  expect(r.edits.some((t) => t.startsWith(" const __sctwin_"))).toBe(true);
  expect(r.edits.some((t) => t.startsWith(";"))).toBe(false);
  expect(r.clean).toBe(true);
}, 120_000);
