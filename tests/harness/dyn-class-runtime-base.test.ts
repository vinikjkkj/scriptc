/* A class whose base is RUNTIME-PROVIDED must not answer for its members
 * through a dyn box — it must keep the loud fence.
 *
 * This file exists because the opposite shipped and had to be taken back
 * out. When the SCR_DYN_OBJINST member table landed it was built from
 * `def.fields`, and a user Error subclass's layout PREFIX is ScrError's
 * own cells — so the table listed name/message/code beside the user's own
 * fields with nothing able to tell them apart. Node makes `name` and
 * `message` own NON-ENUMERABLE properties. Measured against node v25.9.0
 * (the nvm binary, not the PATH one), on both lanes:
 *
 *   class MyErr extends Error { constructor() { super("boom"); this.code = "X" } }
 *   JSON.stringify(x)   node  {"code":"X"}
 *                       was   Uncaught Error: JSON.stringify on a dynamic MyErr …  exit 1
 *                       then  {"name":"Error","message":"boom","code":"X"}         exit 0
 *
 * JSON.stringify and String() each went from a LOUD refusal to a SILENTLY
 * WRONG answer at exit 0. A corpus sweep cannot catch that — it proves the
 * corpus holds no such program, not that the shape is safe — so the guard
 * belongs here, in a file whose whole subject is the refusal.
 *
 * The emitter and stream hierarchies carry the same hazard with the sign
 * flipped: their prefixes (_events, _eventsCount, _maxListeners) are cells
 * Node DOES list, holding values this representation does not have.
 *
 * WHAT IS PINNED is that the refusal stays LOUD, not its message text. A
 * later change that makes these answer Node-exactly is welcome and will
 * replace these rows with corpus programs; what must never happen again is
 * a partial object at exit 0.
 */
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const LANES = ["c", "llvm"] as const;
type Lane = (typeof LANES)[number];

const ERR_HEAD =
  "class MyErr extends Error {\n" +
  "  code: string\n" +
  "  constructor() { super('boom'); this.code = 'X' }\n" +
  "}\n";
const BUS_HEAD =
  "import { EventEmitter } from 'node:events'\n" +
  "class Bus extends EventEmitter {\n" +
  "  n: number\n" +
  "  constructor() { super(); this.n = 1 }\n" +
  "}\n";

/** Every row must COMPILE — the refusal belongs at run time, where the
 * value is known — and must then DIE rather than print an answer. */
const ROWS: readonly { name: string; src: string; forbidden: string[] }[] = [
  {
    name: "JSON.stringify of a boxed Error subclass",
    src:
      ERR_HEAD +
      "function use(x: any): string { return JSON.stringify(x) }\n" +
      "console.log('OUT ' + use(new MyErr()))\n",
    // The exact strings the regression printed. `message` alone would also
    // catch a partial answer that happened to drop `name`.
    forbidden: ["OUT", "message", "name"],
  },
  {
    name: "util.inspect of a boxed Error subclass",
    src:
      ERR_HEAD +
      "function use(x: any): void { console.log(x) }\n" +
      "use(new MyErr())\n",
    forbidden: ["MyErr {", "code:"],
  },
  {
    name: "JSON.stringify of a boxed EventEmitter subclass",
    src:
      BUS_HEAD +
      "function use(x: any): string { return JSON.stringify(x) }\n" +
      "console.log('OUT ' + use(new Bus()))\n",
    // `{"n":1}` is the shape a table would have produced here: real, and
    // missing every internal cell Node lists.
    forbidden: ["OUT"],
  },
];

/** Object.keys of an EventEmitter subclass answers Node's key list: the emitter's own
 * enumerable prefix (_events, _eventsCount, _maxListeners; checked against node v24.15.0), then
 * the program's fields. The empty answer this row used to pin was a divergence. The value
 * surfaces (JSON, inspect, values, entries) keep their loud fence. */
const KEYS_EMPTY: readonly { name: string; src: string }[] = [
  {
    name: "Object.keys of a boxed EventEmitter subclass",
    src:
      BUS_HEAD +
      "function use(x: any): string { return Object.keys(x).join(',') }\n" +
      "console.log('KEYS[' + use(new Bus()) + ']')\n",
  },
];

/** Rows that ANSWER, Node-exactly (checked against node v24.15.0): an Error
 * subclass IS a ScrError, so the runtime answers its cells and its own keys
 * from the box itself -- the refusal these two used to pin is closed. The
 * answer is the point: `String(e)` is Error.prototype.toString and the own
 * keys are the user's assigned `code` (`name` and `message` are not own
 * enumerable). */
const ANSWERS: readonly { name: string; src: string; out: string }[] = [
  {
    name: "String() of a boxed Error subclass",
    src:
      ERR_HEAD +
      "function use(x: any): string { return String(x) }\n" +
      "console.log('OUT ' + use(new MyErr()))\n",
    out: "OUT Error: boom\n",
  },
  {
    name: "Object.keys of a boxed Error subclass",
    src:
      ERR_HEAD +
      "function use(x: any): string { return Object.keys(x).join(',') }\n" +
      "console.log('KEYS[' + use(new MyErr()) + ']')\n",
    out: "KEYS[code]\n",
  },
];

let lab = "";
interface Built {
  ok: boolean;
  diags: { code: string; message: string }[];
  binaryPath?: string;
}
const BUILT = new Map<string, Built>();

async function build(name: string, src: string, backend: Lane): Promise<Built> {
  const dir = join(lab, `${name.replace(/[^a-z0-9]+/gi, "-").slice(0, 60)}-${backend}`);
  await mkdir(dir, { recursive: true });
  const file = join(dir, "main.ts");
  await writeFile(file, src, "utf8");
  const res = await compile(file, { outPath: join(dir, exeName("program")), outDir: dir, backend });
  return {
    ok: res.ok,
    diags: (res.diagnostics ?? []).map((d) => ({ code: d.code, message: d.message })),
    ...(res.ok ? { binaryPath: res.binaryPath } : {}),
  };
}

function run(bin: string): { stdout: string; status: number | null } {
  try {
    return {
      stdout: execFileSync(bin, [], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }),
      status: 0,
    };
  } catch (e) {
    const err = e as { status?: number; stdout?: string };
    return { stdout: err.stdout ?? "", status: err.status ?? null };
  }
}

beforeAll(async () => {
  lab = await mkdtemp(join(tmpdir(), "scriptc-dyn-class-rtbase-"));
  for (const backend of LANES) {
    for (const p of ROWS) BUILT.set(`F:${p.name}:${backend}`, await build(p.name, p.src, backend));
    for (const p of ANSWERS) BUILT.set(`A:${p.name}:${backend}`, await build(p.name, p.src, backend));
    for (const p of KEYS_EMPTY) BUILT.set(`K:${p.name}:${backend}`, await build(p.name, p.src, backend));
  }
}, 1_800_000);

describe("a class whose base is runtime-provided keeps the boxed fence", () => {
  test.for(ANSWERS.map((p) => [p.name, p] as const))("answers Node-exactly: %s", ([, p]) => {
    for (const backend of LANES) {
      const b = BUILT.get(`A:${p.name}:${backend}`)!;
      expect(
        b.ok,
        `${p.name} (${backend}) did not compile: ` + b.diags.map((d) => `${d.code} ${d.message.slice(0, 160)}`).join(" | "),
      ).toBe(true);
      const r = run(b.binaryPath!);
      expect(r.status, `${p.name} (${backend}) exit code`).toBe(0);
      expect(r.stdout, `${p.name} (${backend}) stdout`).toBe(p.out);
    }
  });

  test.for(ROWS.map((p) => [p.name, p] as const))("refuses LOUDLY: %s", ([, p]) => {
    for (const backend of LANES) {
      const b = BUILT.get(`F:${p.name}:${backend}`)!;
      expect(
        b.ok,
        `${p.name} (${backend}) must COMPILE — the refusal belongs at run time. ` +
          b.diags.map((d) => `${d.code} ${d.message.slice(0, 160)}`).join(" | "),
      ).toBe(true);
      const r = run(b.binaryPath!);
      expect(
        r.status,
        `${p.name} (${backend}) must exit NONZERO — a partial answer at exit 0 is the regression this file pins`,
      ).not.toBe(0);
      for (const bad of p.forbidden) {
        expect(
          r.stdout,
          `${p.name} (${backend}) printed a fabricated answer containing ${JSON.stringify(bad)}`,
        ).not.toContain(bad);
      }
    }
  });

  test.for(KEYS_EMPTY.map((p) => [p.name, p] as const))(
    "answers Node's key list, prefix included: %s",
    ([, p]) => {
      for (const backend of LANES) {
        const b = BUILT.get(`K:${p.name}:${backend}`)!;
        expect(
          b.ok,
          `${p.name} (${backend}) did not compile: ` +
            b.diags.map((d) => `${d.code} ${d.message.slice(0, 160)}`).join(" | "),
        ).toBe(true);
        const r = run(b.binaryPath!);
        expect(r.status, `${p.name} (${backend}) exit code`).toBe(0);
        expect(r.stdout, `${p.name} (${backend}) list the runtime prefix`).toBe("KEYS[_events,_eventsCount,_maxListeners,n]\n");
      }
    },
  );
});
