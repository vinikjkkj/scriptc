/* What a typed emitter listener without an erased twin says (SC6005), and what it does NOT say.
 *   - a registration in a class field initializer has no statement position for the twin: SC6005 names the shape, the build succeeds;
 *   - a body the erased copy cannot lower (destructuring an `any` value): the twin load is refused by the lowering, the build keeps the typed
 *     listener and says so with SC6005 naming the first refusal;
 *   - a callback written inside a listener body (`v.tags.map((t) => t.length)`) is implicitly `any` in the copy: that is NOT a reason to refuse
 *     the twin (the copy is not the author's text), so the listener is twinned and no SC6005 appears;
 *   - negative control: a listener with an ordinary body and an ordinary position gets no SC6005. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { runFrontend } from "../src/index.js";
import { renderAll } from "../src/diagnostics/render.js";

const HEAD = `
import { EventEmitter } from "node:events";
class Box extends EventEmitter { n = 0; }
interface R { id: number; tags: string[] }
`;

function advice(src: string): { codes: string[]; messages: string[]; ok: boolean } {
  const dir = mkdtempSync(join(tmpdir(), "scriptc-twinadv-"));
  const file = join(dir, "main.ts");
  writeFileSync(file, src);
  const fe = runFrontend(file);
  try {
    expect(fe.preflight).toEqual([]);
    const r = fe.lower({});
    const adv = r.advisories.filter((a) => a.code === "SC6005");
    return { codes: adv.map((a) => a.code), messages: adv.map((a) => a.message), ok: r.module !== null && r.diagnostics.length === 0 };
  } finally {
    fe.dispose();
  }
}

const EMIT = `const hold: { v: any } = { v: b }; hold.v.emit.apply(hold.v, ["x", { id: 1, tags: ["a"] }]);`;

test("a class field initializer cannot host the twin: SC6005, build succeeds", () => {
  const r = advice(`${HEAD}
class Holder { seen = 0; box = new Box(); hook = this.box.on("x", (v: R) => { this.seen += v.id; }); }
const h = new Holder(); const b = h.box; ${EMIT}
`);
  expect(r.ok).toBe(true);
  expect(r.messages.some((m) => m.includes("no statement position"))).toBe(true);
}, 120_000);

test("a body the erased copy cannot lower keeps the typed listener and says why", () => {
  const r = advice(`${HEAD}
const b = new Box();
b.on("x", (v: R) => { const { id, ...rest } = v; console.log(id, Object.keys(rest).length); });
${EMIT}
`);
  expect(r.ok).toBe(true);
  expect(r.messages.some((m) => m.includes("does not lower"))).toBe(true);
}, 120_000);

test("an implicitly-any callback inside the copy does not refuse the twin", () => {
  const r = advice(`${HEAD}
const b = new Box();
b.on("x", (v: R) => { console.log(v.tags.map((t) => t.length).join(",")); });
${EMIT}
`);
  expect(r.ok).toBe(true);
  expect(r.codes).toEqual([]);
}, 120_000);

test("negative control: an ordinary listener gets no SC6005", () => {
  const r = advice(`${HEAD}
const b = new Box();
b.on("x", (v: R) => { console.log(v.id); });
${EMIT}
`);
  expect(r.ok).toBe(true);
  expect(r.codes).toEqual([]);
}, 120_000);

test("SC6005 renders with its code frame and hint (snapshot)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "scriptc-twinadv-"));
  const file = join(dir, "main.ts");
  writeFileSync(file, `${HEAD}
class Holder { seen = 0; box = new Box(); hook = this.box.on("x", (v: R) => { this.seen += v.id; }); }
const h = new Holder(); const b = h.box; ${EMIT}
`);
  const fe = runFrontend(file);
  try {
    const r = fe.lower({});
    const adv = r.advisories.filter((a) => a.code === "SC6005");
    expect(adv.length).toBe(1);
    const rendered = renderAll(adv, fe.sourceTexts(), { color: false }).replaceAll(dir + "/", "");
    await expect(rendered).toMatchFileSnapshot("__snapshots__/twin-advice-sc6005.txt");
  } finally {
    fe.dispose();
  }
}, 120_000);
