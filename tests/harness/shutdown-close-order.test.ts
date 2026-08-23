/* The RATE half of the shutdown close-order contract.
 *
 * server.test.ts runs every server fixture ONCE against Node. That is the
 * right shape for a deterministic divergence and the wrong shape for this
 * family: the defect this file was written for — a drained server's
 * 'close' emitted after the sweep pass instead of before it — surfaced in
 * http-proxy-pipe as a swap of the last two stdout lines that happened
 * some of the time. Measured on main at 67c6ee82 it reversed 1 run in 100
 * on an idle host, and a block that met it while the host was building
 * three trees at once measured 17 in 100. A single-sample gate scores that
 * as green ~99 times out of 100 here and ~83 out of 100 there, so the red
 * lands on whoever is unlucky and reads as their own regression. Two of
 * them spent an hour on it before it was named.
 *
 * So this file repeats. It takes the Node lane's answer ONCE (Node is the
 * oracle and does not reverse — measured 100/100), then runs the compiled
 * lane REPEATS times and requires every single run to be byte-identical to
 * it across the whole compared triple: the server's stdout, the server's
 * exit code, and the driver's stdout. Bucketing the triple rather than
 * eyeballing the last two lines is deliberate — an event that fires TWICE,
 * an event that never fires at all, and a socket closed while the driver
 * still needed it are each their own outcome here rather than all folding
 * into "reversed".
 *
 * What REPEATS can and cannot do, stated rather than implied: at 15 runs
 * this catches a 17%-per-run defect ~94 times in 100 and a 1%-per-run
 * defect ~14 times in 100. It is a rate net, not a proof. The proof that
 * the mechanism is gone is the deterministic pair in
 * tests/fixtures/server/cases/net-close-order-drained (reversed on EVERY
 * run before the fix) and its non-regression control
 * net-close-order-request; this file is what keeps a future rate from
 * creeping back under them. */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const repoRoot = join(import.meta.dirname, "../..");
const fixturesRoot = join(repoRoot, "tests/fixtures/server/cases");
const cacheDir = join(repoRoot, "node_modules/.cache/scriptc-tests");

/** Runs long enough to net a rate, short enough to keep the file cheap:
 * REPEATS spawns of the compiled lane per case, plus one Node lane. */
const REPEATS = 15;

interface Lane {
  stdout: string;
  exitCode: number | string;
  driverStdout: string;
  driverExit: number | null;
}

/* The PORT protocol and the three compared legs, exactly as
 * server.test.ts's runLane defines them — kept a separate copy on purpose:
 * this file must not change behavior if that harness's spawn shape moves,
 * or a rate measured here would silently be a rate of something else. */
function runLane(cmd: string, args: string[], driver: string | null): Promise<Lane> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let errText = "";
    let driverStdout = "";
    let driverStarted = false;
    let driverDone: Promise<number | null> = Promise.resolve(null);
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`server program timed out\nstderr so far:\n${errText}`));
    }, 60_000);
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c: Buffer) => {
      errText += c.toString("utf8");
      if (driver !== null && !driverStarted) {
        const m = /^PORT (\d+)$/m.exec(errText);
        if (m) {
          driverStarted = true;
          driverDone = new Promise<number | null>((res) => {
            const d = spawn("node", [driver, m[1]!], { stdio: ["ignore", "pipe", "inherit"] });
            d.stdout.on("data", (c: Buffer) => (driverStdout += c.toString("utf8")));
            d.on("close", (code) => res(code));
          });
        }
      }
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (signal) {
        reject(new Error(`server program died to ${signal}\nstderr:\n${errText}`));
        return;
      }
      if (driver !== null && !driverStarted) {
        reject(new Error(`server program exited without a PORT line\nstderr:\n${errText}`));
        return;
      }
      driverDone.then(
        (dcode) =>
          resolve({
            stdout: Buffer.concat(out).toString("utf8"),
            exitCode: code ?? 0,
            driverStdout,
            driverExit: dcode,
          }),
        reject,
      );
    });
  });
}

async function build(entry: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(entry).update(readFileSync(entry));
  const key = hash.update("plain").digest("hex").slice(0, 16);
  const outDir = join(cacheDir, `server-${key}`);
  mkdirSync(outDir, { recursive: true });
  const result = await compile(entry, {
    outPath: join(outDir, exeName("program")),
    outDir,
    sanitize: false,
    // Pinned to the C lane for the same reason server.test.ts pins it: a
    // moving default backend would turn a rate into a lane change.
    backend: "c",
  });
  if (!result.ok) {
    throw new Error(
      "fixture failed to compile:\n" +
        result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"),
    );
  }
  return result.binaryPath;
}

const cases = [
  // The one that carried the defect as a RATE.
  "http-proxy-pipe",
  // The same program with the coincidence pinned, so it carried the defect
  // on every run instead of some of them.
  "http-proxy-close-order",
  // The one that carries it deterministically; repeated here too, so a
  // future defect that makes IT intermittent is caught by the same net.
  "net-close-order-drained",
  // The non-regression control: close-request order among servers that
  // were all drained already.
  "net-close-order-request",
  // The socket-vs-server queue: two busy servers drained in one turn with
  // a drained one between them, and the three cases that pin the close
  // PHASE itself -- that it comes last, that it is LIFO, and that a socket
  // destroyed inside its own event closes an iteration ahead.
  "net-close-order-two-busy",
  "net-close-order-many",
  "net-close-order-phase",
  "net-close-order-self",
  // The guard on the other side: a server closed while a client socket is
  // still draining, where the socket's 'close' comes FIRST because it
  // belonged to an earlier loop iteration.
  "net-close-order-drain",
  "net-close-order-last-conn",
  // Both queues at once: a tick between two close callbacks, and a second
  // server draining in the poll phase of the iteration between them.
  "net-close-order-tick-between",
  // The same program with the resume() taken back OUT: it hung on both
  // sides until a consumer-less socket started noticing its peer's FIN,
  // and it is the case that proves the FIN lands in the right loop
  // iteration rather than merely eventually.
  "net-read-arm-tick-between",
];

describe(`shutdown close order (${REPEATS} runs per case)`, () => {
  test.for(cases)(
    "%s",
    async (name) => {
      const entry = join(fixturesRoot, name, "main.ts");
      const driverPath = join(fixturesRoot, name, "driver.mjs");
      const driver = existsSync(driverPath) ? driverPath : null;
      const binary = await build(entry);

      const oracle = await runLane("node", [entry], driver);
      const want = JSON.stringify(oracle);

      const buckets = new Map<string, number>();
      for (let i = 0; i < REPEATS; i++) {
        const got = await runLane(binary, [], driver);
        const k = JSON.stringify(got);
        buckets.set(k, (buckets.get(k) ?? 0) + 1);
      }
      const matched = buckets.get(want) ?? 0;
      if (matched !== REPEATS) {
        // The failure message carries the RATE and every distinct wrong
        // answer, because "it failed once" is the least useful thing a
        // rate defect can tell you.
        const others = [...buckets.entries()]
          .filter(([k]) => k !== want)
          .map(([k, n]) => `  ${n}/${REPEATS} ${k}`)
          .join("\n");
        expect.unreachable(
          `${name}: ${matched}/${REPEATS} runs matched Node.\nNode:\n  ${want}\nothers:\n${others}`,
        );
      }
      expect(matched).toBe(REPEATS);
    },
    240_000,
  );
});
