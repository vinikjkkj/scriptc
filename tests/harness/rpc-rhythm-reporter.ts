/* Measure the RHYTHM of RPC traffic arriving at the main thread.
 *
 * WHY THIS AND NOT SOMETHING CHEAPER. Shard 3 reddens with
 * `[vitest-worker]: Timeout calling "onTaskUpdate"` -- the worker waited on
 * the main thread. Six explanations are already buried, each with its bar
 * declared before the number:
 *
 *   per-shard load            tested, does not order
 *   12-worker contract        p=0.165, confounded with time of day
 *   sync-spawn density        p=0.1569 (K=38 over the 220-file partition)
 *   longest-test domination   NOT an outlier -- two GREEN shards run longer
 *   corpus-sweep presence     p=0.1341
 *   content, as a class       shard 3's membership CHANGED between the two
 *                             reds and it reddened both times
 *
 * So the cause is not how long a test runs, not which files are present, and
 * not how many workers there are. What is left is WHEN the traffic arrives.
 *
 * WHAT THIS MEASURES: arrival times of onTaskUpdate at the main thread,
 * aggregated per run into the inter-arrival distribution -- the longest quiet
 * gap, and how many updates co-arrive in the window right after it. That is
 * the one quantity consistent with all six refutations.
 *
 * WHAT IT DOES NOT MEASURE, stated so nobody reads silence as absence:
 *   - whether the main thread stalled for an unrelated reason: GC pause,
 *     disk stall, antivirus. A long gap here is consistent with all of them.
 *   - it sees arrivals, never the queue depth inside vitest. Depth is the
 *     direct cause; observing it would mean instrumenting vitest's internals
 *     rather than watching their edge.
 *   - PAYLOAD SIZE is recorded for one reason only: without it, "twelve
 *     workers flushed together" and "one worker flushed something enormous"
 *     are indistinguishable, and an instrument that cannot separate two
 *     mechanisms will confidently name the wrong one.
 *
 * HOW TO READ IT: by COMPARISON, never against an absolute number. Shard 3
 * against a green shard of the SAME run. The last property measured here had
 * a declared threshold of 120s; shard 3 cleared it at 308s and was still the
 * THIRD largest, behind two green shards. The absolute bar was wrong and only
 * the control caught it.
 *
 * AGGREGATED IN PROCESS, one summary line at the end. A row per update would
 * be thousands of writes into the main thread whose responsiveness is the
 * subject -- the instrument landing inside the system it measures, which has
 * already cost this front twice today.
 *
 *   vitest run --reporter=default --reporter=./tests/harness/rpc-rhythm-reporter.ts
 *
 * Absent unless named on the command line: nothing to disable, nothing to
 * believe about its cost when it is not there.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const NL = String.fromCharCode(10);

interface Arrival {
  readonly t: number;
  readonly packs: number;
  readonly bytes: number;
}

export default class RpcRhythmReporter {
  private readonly arrivals: Arrival[] = [];
  private t0 = 0;

  onInit(): void {
    this.t0 = Date.now();
  }

  /* vitest calls this on the MAIN thread as each worker's update lands, so
   * the timestamps are arrivals at the contended side -- which is the side
   * that timed out. */
  onTaskUpdate(packs: unknown[]): void {
    let bytes = 0;
    try {
      bytes = JSON.stringify(packs).length;
    } catch {
      bytes = -1; /* circular or huge: recorded as unknown, never as zero */
    }
    this.arrivals.push({
      t: Date.now() - this.t0,
      packs: Array.isArray(packs) ? packs.length : 0,
      bytes,
    });
  }

  onFinished(): void {
    const dir = process.env["SCRIPTC_RPC_RHYTHM"] ?? ".";
    const shard = process.env["SCRIPTC_TEST_SHARD"] ?? "unknown";
    const a = this.arrivals;
    if (a.length < 2) {
      this.write(dir, "RPC-RHYTHM shard=" + shard + " arrivals=" + a.length + " (too few to characterise)");
      return;
    }
    const gaps: number[] = [];
    for (let i = 1; i < a.length; i++) gaps.push(a[i]!.t - a[i - 1]!.t);
    const sorted = [...gaps].sort((x, y) => x - y);
    const q = (p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
    const maxGap = sorted[sorted.length - 1]!;
    const at = gaps.indexOf(maxGap) + 1;

    /* CO-ARRIVAL WAS ATTEMPTED AND REMOVED. Two drafts failed:
     *
     *   1. arrivals in a fixed 1000ms window after the longest gap. Its
     *      self-test refused it -- at a steady 100ms cadence four arrivals
     *      fall in that second legitimately, so even traffic reads as a
     *      burst. The absolute-threshold error property 1 already made.
     *   2. the same count normalised by maxGap/median. Worse: it reported
     *      0.08 for a planted quiet-then-burst and 2.0 for even cadence --
     *      backwards. It only "passed" because that case's assertion had no
     *      teeth, which is a self-test green by construction, in the
     *      instrument built to catch green by construction.
     *
     * No fixture separated burst from cadence without assuming the
     * mechanism, so the metric is not shipped. A quantity that cannot be
     * proved to discriminate is not evidence, and shipping it would put a
     * confident number next to a thing it does not measure.
     *
     * What remains is what a fixture CAN pin: how anomalous the longest
     * silence is against this run's own cadence. 1.0 is ordinary. */
    const med = Math.max(1, q(0.5));
    const gapRatio = maxGap / med;
    const maxBytes = a.reduce((m, x) => Math.max(m, x.bytes), 0);
    const totalBytes = a.reduce((m, x) => m + Math.max(0, x.bytes), 0);

    this.write(dir, [
      "RPC-RHYTHM shard=" + shard,
      "arrivals=" + a.length,
      "spanMs=" + a[a.length - 1]!.t,
      "gapMedianMs=" + q(0.5),
      "gapP95Ms=" + q(0.95),
      "gapMaxMs=" + maxGap,
      "gapMaxAtMs=" + a[at]!.t,
      "gapRatio=" + gapRatio.toFixed(2),
      "maxUpdateBytes=" + maxBytes,
      "totalBytes=" + totalBytes,
    ].join(" "));
  }

  private write(dir: string, line: string): void {
    try {
      mkdirSync(dir, { recursive: true });
      appendFileSync(join(dir, "rpc-rhythm.log"), line + NL);
    } catch {
      /* never let the instrument fail the run it is observing */
    }
    console.log(line);
  }
}
