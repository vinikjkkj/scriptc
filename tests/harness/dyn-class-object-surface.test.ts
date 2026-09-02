/* THE OBJECT SURFACE OF A CLASS INSTANCE SITTING IN A DYN SLOT.
 *
 * A class instance boxes into the checked-dynamic tree by reference and
 * carries a compiler-emitted MEMBER TABLE (backend/dyn-members.ts). The
 * table landed the READ surface — `x.get()` and `x.v` through an untyped
 * JavaScript parameter — and left its neighbours answering from before
 * the table existed. Two of them answered WRONGLY AND SILENTLY, which is
 * the shape this tier refuses everywhere else:
 *
 *     { ...inst }                 {}          exit 0   (Node: {"v":7,"w":8})
 *     delete inst.v; keys(inst)   ["v","w"]   exit 0   (Node: ["w"])
 *
 * and two more threw where Node prints or answers a boolean
 * (`util.inspect`, `Object.hasOwn`). This file is the guard for all of
 * it, and it is arranged so that a REGRESSION NAMES THE SURFACE rather
 * than only saying something broke.
 *
 * SCORED AGAINST A LIVE NODE. Every program is plain JavaScript that Node
 * runs unchanged, so the oracle is `process.execPath` executing the very
 * file that was compiled. A transcribed expectation can rot into
 * agreement with a wrong compiler; a live one cannot.
 *
 * BOTH LANES, because the member table is rendered by two emitters off
 * one row decision and the whole point of that arrangement is that they
 * cannot disagree. A row green on C and red on LLVM is the defect this
 * layer is built around.
 *
 * BOTH SPELLINGS of the class, because they reach the box by different
 * routes and the answer must not depend on which:
 *   - a DECLARED `class` in a .js file, whose instance crosses into a dyn
 *     slot through an untyped parameter; and
 *   - a JavaScript PRE-CLASS CONSTRUCTOR under SCRIPTC_PROTOCLASS=1,
 *     which the frontend synthesizes into a class whose IR name is
 *     `%pc<offset>.<name>` — the spelling that made the descriptor's
 *     display name a compiler name, and `util.inspect` print
 *     `pc32.Box { v: 7 }` where Node prints `Box { v: 7 }`.
 *
 * THE TWO ROWS THAT DO NOT ANSWER are here on purpose, pinned as named
 * gaps: a class instance has a FIXED LAYOUT, so a property ADD and a
 * property DELETE have no representation. Both refuse loudly. If one goes
 * green the layout gained a side table and this file says so out loud.
 */
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const LANES = ["c", "llvm"] as const;
type Lane = (typeof LANES)[number];

/** The DECLARED-class spelling: the instance reaches the dyn slot through
 * `see`'s untyped parameter, which is what makes the box the receiver. */
const DECL =
  "class Box { constructor(v) { this.v = v; this.w = v + 1 } get() { return this.v } }\n";

/** The PRE-CLASS-CONSTRUCTOR spelling. Under SCRIPTC_PROTOCLASS=1 the
 * frontend synthesizes a class from it; with the arm off it lowers to a
 * plain dyn object and never reaches the box at all, which is why the arm
 * state is a dimension of this file rather than a footnote. */
const PROTO =
  "function Box(v) { this.v = v; this.w = v + 1 }\nBox.prototype.get = function () { return this.v }\n";

/** One surface per row. `body` receives the instance through an untyped
 * parameter, so the value under test is always the BOX. `gap` non-null
 * means the row is pinned as a divergence: it must NOT match. */
const SURFACES: readonly { name: string; body: string; gap: string | null }[] = [
  { name: "Object.keys", body: "return JSON.stringify(Object.keys(x))", gap: null },
  { name: "Object.values", body: "return JSON.stringify(Object.values(x))", gap: null },
  { name: "Object.entries", body: "return JSON.stringify(Object.entries(x))", gap: null },
  { name: "JSON.stringify", body: "return JSON.stringify(x)", gap: null },
  // THE SILENT ONE. Object spread is CopyDataProperties, the same walk
  // Object.keys runs; the box copied nothing and answered a fabricated {}.
  { name: "object spread", body: "return JSON.stringify({ ...x })", gap: null },
  { name: "Object.assign onto a fresh object", body: "return JSON.stringify(Object.assign({}, x))", gap: null },
  // A method is NON-enumerable in JS, so it is absent from keys/spread and
  // present to `in` — one table, two answers, and they must not drift.
  {
    name: "Object.hasOwn and `in` disagree exactly where JS does",
    body: "return String(Object.hasOwn(x, 'v')) + ',' + String(Object.hasOwn(x, 'get')) + ',' + String('get' in x) + ',' + String('nope' in x)",
    gap: null,
  },
  { name: "hasOwnProperty spelled as a method", body: "return String(x.hasOwnProperty('v')) + ',' + String(x.hasOwnProperty('get'))", gap: null },
  // The class NAME is in this output, which is what pins the descriptor's
  // display name to the JS-visible one rather than the IR name.
  { name: "util.inspect", body: "return require('node:util').inspect(x)", gap: null },
  { name: "the member read and the method call the table landed", body: "return String(x.v) + ',' + String(x.get())", gap: null },
  {
    name: "a field DELETED off the instance",
    body: "delete x.v; return JSON.stringify(Object.keys(x))",
    gap: "a class instance has a fixed layout and no representation for a removed field",
  },
  {
    name: "an EXPANDO written onto the instance",
    body: "x.z = 3; return JSON.stringify(Object.keys(x))",
    gap: "a class instance has a fixed layout and no slot for a property the class does not declare",
  },
];

const program = (head: string, body: string): string =>
  head + `function see(x) { ${body} }\nconsole.log(String(see(new Box(7))))\n`;

interface Built {
  ok: boolean;
  binaryPath?: string;
  diags: string;
  oracle: string;
}

let lab = "";
const BUILT = new Map<string, Built>();

const slug = (s: string): string => s.replace(/[^a-z0-9]+/gi, "-").slice(0, 60);

async function build(name: string, src: string, backend: Lane): Promise<Built> {
  const dir = join(lab, `${slug(name)}-${backend}`);
  await mkdir(dir, { recursive: true });
  // `.js` deliberately: an untyped parameter is what puts the instance in a
  // dyn slot, and in TypeScript the checker would have a declared type there.
  const file = join(dir, "main.js");
  await writeFile(file, src, "utf8");
  const res = await compile(file, { outPath: join(dir, exeName("program")), outDir: dir, backend });
  return {
    ok: res.ok,
    ...(res.ok ? { binaryPath: res.binaryPath } : {}),
    diags: res.ok ? "" : (res.diagnostics ?? []).map((d) => `${d.code} ${d.message.slice(0, 200)}`).join(" | "),
    oracle: execFileSync(process.execPath, [file], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
  };
}

function run(bin: string): { stdout: string; status: number | null } {
  try {
    return { stdout: execFileSync(bin, [], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }), status: 0 };
  } catch (e) {
    const err = e as { status?: number; stdout?: string };
    return { stdout: err.stdout ?? "", status: err.status ?? null };
  }
}

/** The two class spellings, and the arm state each needs. */
const SPELLINGS = [
  { tag: "declared class", head: DECL, arm: false },
  { tag: "pre-class constructor, SCRIPTC_PROTOCLASS=1", head: PROTO, arm: true },
] as const;

const ARM = "SCRIPTC_PROTOCLASS";
const key = (tag: string, surface: string, lane: Lane): string => `${tag}|${surface}|${lane}`;

beforeAll(async () => {
  lab = await mkdtemp(join(process.env["TMPDIR"] ?? process.env["TMP"] ?? ".", "scriptc-dynclass-"));
  const prev = process.env[ARM];
  try {
    for (const sp of SPELLINGS) {
      if (sp.arm) process.env[ARM] = "1";
      else delete process.env[ARM];
      for (const s of SURFACES) {
        for (const lane of LANES) {
          BUILT.set(key(sp.tag, s.name, lane), await build(`${sp.tag}-${s.name}`, program(sp.head, s.body), lane));
        }
      }
    }
  } finally {
    if (prev === undefined) delete process.env[ARM];
    else process.env[ARM] = prev;
  }
}, 3_600_000);

describe("a class instance in a dyn slot", () => {
  // THE SELF-TEST. A harness that cannot report "the oracle disagreed"
  // cannot be trusted when it reports agreement. Every oracle string must be
  // non-empty, and they must not collapse to one constant — if the node runs
  // silently produced nothing, every comparison below would pass vacuously.
  test("the oracle is live: every program printed, and the outputs differ", () => {
    const seen = new Set<string>();
    for (const sp of SPELLINGS) {
      for (const s of SURFACES) {
        const b = BUILT.get(key(sp.tag, s.name, "c"))!;
        expect(b.oracle, `node printed nothing for: ${sp.tag} / ${s.name}`).not.toBe("");
        seen.add(b.oracle);
      }
    }
    expect(
      seen.size,
      "every program produced the same oracle string — the oracle is not live",
    ).toBeGreaterThan(SURFACES.length / 2);
  });

  for (const sp of SPELLINGS) {
    test.for(
      SURFACES.filter((s) => s.gap === null).map((s) => [`${sp.tag} — ${s.name}`, s] as const),
    )("answers Node-exactly: %s", ([, s]) => {
      for (const lane of LANES) {
        const b = BUILT.get(key(sp.tag, s.name, lane))!;
        expect(b.ok, `${sp.tag} / ${s.name} (${lane}) did not compile: ${b.diags}`).toBe(true);
        const r = run(b.binaryPath!);
        expect(
          `${r.stdout}|exit ${String(r.status)}`,
          `${sp.tag} / ${s.name} (${lane}) must print exactly what ${process.execPath} prints`,
        ).toBe(`${b.oracle}|exit 0`);
      }
    });

    test.for(
      SURFACES.filter((s) => s.gap !== null).map((s) => [`${sp.tag} — ${s.name}`, s] as const),
    )("NAMED GAP, still open: %s", ([, s]) => {
      for (const lane of LANES) {
        const b = BUILT.get(key(sp.tag, s.name, lane))!;
        const r = b.ok ? run(b.binaryPath!) : { stdout: "", status: null };
        const matched = b.ok && r.status === 0 && r.stdout === b.oracle;
        // Pinned as a divergence ON PURPOSE. Green here means the layout
        // gained a representation for the surface — move the row up.
        expect(
          matched,
          `${sp.tag} / ${s.name} (${lane}) now MATCHES — the gap (${s.gap!}) is CLOSED. ` +
            `Move this row into the answering set. exit ${String(r.status)} stdout ` +
            `${JSON.stringify(r.stdout)} oracle ${JSON.stringify(b.oracle)}`,
        ).toBe(false);
        // …and it must refuse LOUDLY. A fabricated shape at exit 0 is the
        // failure mode this whole file exists to keep closed: the delete row
        // used to answer the pre-delete key list, and the spread row a bare
        // `{}`, both with no diagnostic.
        expect(
          !b.ok || r.status !== 0,
          `${sp.tag} / ${s.name} (${lane}) exited 0 with a WRONG answer instead of refusing: ` +
            `stdout ${JSON.stringify(r.stdout)} oracle ${JSON.stringify(b.oracle)}`,
        ).toBe(true);
      }
    });
  }
});
