/* LAB ONLY: a per-phase wall-time, memory and tsgo-round-trip ledger of ONE compile, written when SCRIPTC_PHASE_TIMES=<file> is set.
 *
 * Off by default and inert: with the variable unset `span` is `fn()` and every other entry point returns at the first line, so no clock is read and no
 * /proc file is opened. Nothing in the compiler reads the output back, and it never fails a build.
 *
 * WHAT IT RECORDS, per span (nested; `tapped()` in phase-tap.ts feeds the compiler's existing phase names, and the hook sites added with it name the
 * rest: load, preflight, lower.1st, lower.pin, load.twin, lower.twin, passes, ...):
 *   - t0, dt in milliseconds since the process started (performance.now()), so spans can be laid on one timeline;
 *   - the Node process's RSS at the end of the span and its high-water mark (process.resourceUsage().maxRSS: peak since process start, not per span),
 *     V8 heapUsed;
 *   - the tsgo child processes: RSS and VmHWM summed over the live ones (Linux: /proc/<pid>/status), count of live ones;
 *   - the tsgo API traffic that happened INSIDE the span: requests and round-trip milliseconds (the sync client's own TimingCollector, which Ts7Host
 *     turns on under this variable), so `dt - roundTripMs` is the compiler's own CPU for that span.
 * At exit one JSON line is appended with the span list, the per-method request totals and the top-level wall.
 *
 * THE POSITIVE CONTROL is built in: SCRIPTC_PHASE_PLANT=<span name>:<ms> sleeps that long INSIDE the named span (Atomics.wait), so a ledger that does not
 * show the planted time in that span is not measuring what it claims.
 *
 * THE SUM CONTROL: every span's EXCLUSIVE time (dt minus its children's dt) is reported, and the exclusive times of all spans plus the unattributed
 * root remainder add up to the root span's dt by construction; `wallMs` (process start to exit) minus the root dt is the node startup and teardown. */
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";

const OUT = process.env["SCRIPTC_PHASE_TIMES"];
export const phaseTimesOn: boolean = OUT !== undefined && OUT !== "";

interface Tsgo {
  pid: number | undefined;
  /** the sync client's TimingCollector.totals (live object) */
  totals: () => { requestCount: number; roundTripMs: number; bytesReceived: number; bytesSent: number; nodesMaterialized: number } | undefined;
  closed: boolean;
}

interface SpanRec {
  name: string;
  depth: number;
  t0: number;
  dt: number;
  excl: number;
  rssMb: number;
  maxRssMb: number;
  heapMb: number;
  tsgoLive: number;
  tsgoRssMb: number;
  tsgoHwmMb: number;
  req: number;
  rtMs: number;
  bytesIn: number;
}

const spans: SpanRec[] = [];
const stack: { name: string; childMs: number }[] = [];
const tsgos: Tsgo[] = [];
const closedTotals = { requestCount: 0, roundTripMs: 0, bytesReceived: 0, bytesSent: 0, nodesMaterialized: 0 };
const methods = new Map<string, { n: number; ms: number }>();
const plant = (() => {
  const v = process.env["SCRIPTC_PHASE_PLANT"];
  if (v === undefined) return null;
  const i = v.lastIndexOf(":");
  return i < 0 ? null : { name: v.slice(0, i), ms: Number(v.slice(i + 1)) };
})();
let installed = false;
const hashes: Record<string, string> = {};

/** Record the sha256 of one emitted artifact (the C translation units, the LLVM IR) so two builds can be compared byte for byte from their ledgers. */
export function noteHash(label: string, ...texts: (string | null | undefined)[]): void {
  if (!phaseTimesOn) return;
  const h = createHash("sha256");
  for (const t of texts) h.update(t ?? "\u0000");
  hashes[label] = h.digest("hex");
}

function statusKb(pid: number | undefined, key: string): number {
  if (pid === undefined || process.platform !== "linux") return 0;
  try {
    const m = new RegExp(`^${key}:\\s+(\\d+) kB`, "m").exec(readFileSync(`/proc/${pid}/status`, "utf8"));
    return m === null ? 0 : Number(m[1]);
  } catch {
    return 0;
  }
}

function liveTotals(): { req: number; rt: number; bytesIn: number } {
  let req = closedTotals.requestCount;
  let rt = closedTotals.roundTripMs;
  let bytesIn = closedTotals.bytesReceived;
  for (const t of tsgos) {
    if (t.closed) continue;
    const x = t.totals();
    if (x === undefined) continue;
    req += x.requestCount;
    rt += x.roundTripMs;
    bytesIn += x.bytesReceived;
  }
  return { req, rt, bytesIn };
}

function install(): void {
  if (installed) return;
  installed = true;
  process.on("exit", () => {
    try {
      const wall = performance.now();
      const root = spans.filter((s) => s.depth === 0);
      const rootMs = root.reduce((a, s) => a + s.dt, 0);
      const exclSum = spans.reduce((a, s) => a + s.excl, 0);
      const line = {
        pid: process.pid,
        argv: process.argv.slice(2),
        cli: process.argv[1],
        hashes,
        cpus: (globalThis as { navigator?: { hardwareConcurrency?: number } }).navigator?.hardwareConcurrency ?? 0,
        wallMs: wall,
        rootMs,
        exclusiveSumMs: exclSum,
        beforeAfterRootMs: wall - rootMs,
        maxRssMb: process.resourceUsage().maxRSS / 1024,
        spans: spans.map((s) => ({ ...s, t0: round(s.t0), dt: round(s.dt), excl: round(s.excl) })),
        methods: [...methods].sort((a, b) => b[1].ms - a[1].ms).slice(0, 25).map(([m, v]) => ({ method: m, n: v.n, ms: round(v.ms) })),
        tsgoTotal: { ...liveTotalsAtExit() },
      };
      appendFileSync(OUT!, JSON.stringify(line) + "\n");
    } catch {
      /* never fails a build */
    }
  });
}

function liveTotalsAtExit(): { req: number; rtMs: number; bytesIn: number } {
  const t = liveTotals();
  return { req: t.req, rtMs: round(t.rt), bytesIn: t.bytesIn };
}

function round(x: number): number {
  return Math.round(x * 10) / 10;
}

function sample(): Pick<SpanRec, "rssMb" | "maxRssMb" | "heapMb" | "tsgoLive" | "tsgoRssMb" | "tsgoHwmMb"> {
  let live = 0;
  let rss = 0;
  let hwm = 0;
  for (const t of tsgos) {
    if (t.closed) continue;
    live++;
    rss += statusKb(t.pid, "VmRSS");
    hwm += statusKb(t.pid, "VmHWM");
  }
  const mu = process.memoryUsage();
  return {
    rssMb: Math.round(mu.rss / 1048576),
    maxRssMb: Math.round(process.resourceUsage().maxRSS / 1024),
    heapMb: Math.round(mu.heapUsed / 1048576),
    tsgoLive: live,
    tsgoRssMb: Math.round(rss / 1024),
    tsgoHwmMb: Math.round(hwm / 1024),
  };
}

function finish(name: string, t0: number, before: { req: number; rt: number; bytesIn: number }): void {
  if (plant !== null && plant.name === name && plant.ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, plant.ms);
  const dt = performance.now() - t0;
  const me = stack.pop()!;
  const after = liveTotals();
  const parent = stack[stack.length - 1];
  if (parent !== undefined) parent.childMs += dt;
  spans.push({
    name,
    depth: stack.length,
    t0,
    dt,
    excl: dt - me.childMs,
    ...sample(),
    req: after.req - before.req,
    rtMs: round(after.rt - before.rt),
    bytesIn: after.bytesIn - before.bytesIn,
  });
}

/** Time a synchronous stage. `fn()` itself when the ledger is off. */
export function span<T>(name: string, fn: () => T): T {
  if (!phaseTimesOn) return fn();
  install();
  const t0 = performance.now();
  const before = liveTotals();
  stack.push({ name, childMs: 0 });
  try {
    return fn();
  } finally {
    finish(name, t0, before);
  }
}

/** Time an asynchronous stage. */
export async function spanAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (!phaseTimesOn) return fn();
  install();
  const t0 = performance.now();
  const before = liveTotals();
  stack.push({ name, childMs: 0 });
  try {
    return await fn();
  } finally {
    finish(name, t0, before);
  }
}

/** A stage whose duration was measured elsewhere (tapPhase): recorded as a span that ended now. */
export function pointSpan(name: string, ms: number): void {
  if (!phaseTimesOn) return;
  install();
  const t0 = performance.now() - ms;
  stack.push({ name, childMs: 0 });
  finish(name, t0, liveTotals());
}

/** Register a spawned tsgo server: its child pid and a reader of the sync client's timing totals. */
export function registerTsgo(api: unknown): Tsgo | null {
  if (!phaseTimesOn) return null;
  install();
  const client = (api as { client?: { channel?: { child?: { pid?: number } }; timing?: { totals: Tsgo["totals"] extends () => infer R ? NonNullable<R> : never }; recordTiming?: (m: string, s: number) => void } }).client;
  const t: Tsgo = {
    pid: client?.channel?.child?.pid,
    totals: () => client?.timing?.totals,
    closed: false,
  };
  // per-method buckets: the collector keeps totals only
  if (client !== undefined && typeof client.recordTiming === "function") {
    const orig = client.recordTiming.bind(client);
    const timing = client.timing as unknown as { record: (s: { method: string; roundTripMs: number }) => void } | undefined;
    if (timing !== undefined) {
      const rec = timing.record.bind(timing);
      timing.record = (s) => {
        const b = methods.get(s.method) ?? { n: 0, ms: 0 };
        b.n++;
        b.ms += s.roundTripMs;
        methods.set(s.method, b);
        rec(s as never);
      };
    }
    void orig;
  }
  tsgos.push(t);
  return t;
}

/** The server is closing: fold its totals into the closed ledger. */
export function closeTsgo(t: Tsgo | null): void {
  if (t === null || t.closed) return;
  const x = t.totals();
  if (x !== undefined) {
    closedTotals.requestCount += x.requestCount;
    closedTotals.roundTripMs += x.roundTripMs;
    closedTotals.bytesReceived += x.bytesReceived;
    closedTotals.bytesSent += x.bytesSent;
    closedTotals.nodesMaterialized += x.nodesMaterialized;
  }
  t.closed = true;
}
