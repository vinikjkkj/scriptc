/* The chunk census's positive control, and the ONE property that matters.
 *
 * A census of how full the arena's chunks are is only worth running if it
 * can tell a full chunk from a nearly empty one. "160 chunks at 90% is
 * nothing to recover; 160 at 5% is 9 MiB sitting there" is the whole
 * reason the instrument exists, so a self-test that merely proves it can
 * see SOME chunks proves nothing at all -- it is the case the reader
 * already believed, and tests/perf/u16census records what happens when a
 * census is trusted on that basis (it printed a well-formed table of
 * nothing for a build whose runtime carried no hook).
 *
 * So this program is run TWICE against the same binary, and the two runs
 * differ only in KC_KEEP:
 *
 *   KC_KEEP=1    every node built is retained. The class's chunks must
 *                come back at or near 100% occupancy and the page ceiling
 *                must be ~0: there is nothing to recover and the census
 *                must say so.
 *   KC_KEEP=10   one node in ten is retained, and the survivors are spread
 *                across the chunks by construction (they are taken from
 *                the build order, and the arena carves in that order). The
 *                same chunk count must come back at roughly a TENTH of the
 *                occupancy, with a large page ceiling.
 *
 * A chunk is released only when COMPLETELY empty, so the sparse arm is not
 * a synthetic curiosity: it is exactly the retention shape the arena work
 * left behind, reduced to something that runs in seconds and whose answer
 * is arithmetic rather than a judgement.
 *
 * KC_N=0 is the NEGATIVE control: no nodes, and the report must say
 * NO-CHUNKS rather than printing a row of zeros.
 *
 * THE SELF-EDGE IS WHAT MAKES THE DROP REAL. Every node points at itself,
 * so a dropped node is a cycle the refcount can never free and only the
 * collector can -- which is the same path the real workload's garbage
 * takes. Run with SCR_CYCLE_IDLE_PACE=0 so a pass happens at every loop
 * quiescence (cycstat's documented positive control); otherwise the pacing
 * can leave the garbage uncollected and the sparse arm reads like the
 * dense one for reasons that have nothing to do with this census.
 *
 * THE TIMER IS NOT DECORATION. The census samples at scr_loop_run's sleep
 * seam, so the program has to reach the loop with its population live. A
 * program that returned from main would be measured only by the exit
 * snapshot, at which point the teardown has already run.
 */
type Node = { v: number; next: Node | null; self: Node | null };

const N = Number(
  process.env["KC_N"] !== undefined ? process.env["KC_N"] : "40000"
);
const KEEP = Number(
  process.env["KC_KEEP"] !== undefined ? process.env["KC_KEEP"] : "1"
);
const HOLD_MS = Number(
  process.env["KC_HOLD_MS"] !== undefined ? process.env["KC_HOLD_MS"] : "3000"
);

function main(): void {
  const built: Node[] = [];
  for (let i = 0; i < N; i++) {
    /* `next` is deliberately NEVER linked, and the field is kept only so
     * the record's size class is what a linked one would be.
     *
     * An earlier version of this control chained the nodes (next = prev),
     * copying tests/fixtures/cycle-arena/churn.ts. That made the sparse
     * arm a lie: holding every tenth node transitively retained its whole
     * prefix through `next`, so KC_KEEP=10 retained all 40,000 and the
     * census reported it at 97.7% occupancy -- identical to the dense arm.
     * The census was right both times; the control was wrong. The
     * self-test caught it because it requires the two arms to DIFFER, and
     * a self-test that had only checked "the dense arm reads full" would
     * have passed and certified an instrument against a case it never
     * exercised.
     *
     * `self` stays: it makes each node a cycle the refcount alone can
     * never free, so a dropped node reaches the collector, which is the
     * path the real workload's garbage takes. */
    const node: Node = { v: i, next: null, self: null };
    node.self = node;
    built.push(node);
  }
  /* WHERE THE SURVIVORS SIT, which is a separate question from how many
   * of them there are, and the page ceiling turns entirely on it.
   *
   * "stride"  keep every KEEPth node. The survivors land on every page of
   *           every chunk, so a chunk can be 90% free and still have no
   *           single WHOLE free page. This is the shape a history sync
   *           leaves behind.
   * "prefix"  keep the first N/KEEP nodes, contiguous in carve order, so
   *           the free space is contiguous too and most pages come free.
   *
   * Both arms retain the SAME NUMBER of nodes. They exist as a pair
   * because a ceiling that reads ~0 on every input it is ever given is
   * indistinguishable from a ceiling that is not being computed at all --
   * a check that can only say "no" needs a control that makes it say
   * "yes", exactly as one that can only say "yes" needs the reverse. */
  const MODE = process.env["KC_MODE"] !== undefined ? process.env["KC_MODE"] : "stride";
  const held: Node[] = [];
  if (MODE === "prefix") {
    const keepN = Math.floor(built.length / KEEP);
    for (let i = 0; i < keepN; i++) held.push(built[i]!);
  } else {
    for (let i = 0; i < built.length; i += KEEP) held.push(built[i]!);
  }
  built.length = 0;

  let sink = 0;
  for (let i = 0; i < held.length; i += 997) sink += held[i]!.v;
  /* Reach the loop and stay there while the census samples, with `held`
   * still referenced after the timer so nothing can drop it early. */
  setTimeout((): void => {
    console.log(
      "kcctl n=" + String(N) + " keep=" + String(KEEP) +
      " held=" + String(held.length) + " sink=" + String(sink)
    );
    /* EXIT FROM INSIDE THE CALLBACK, with `held` still referenced by this
     * closure. Returning instead would let the loop reach its teardown,
     * which releases everything and then takes one more seam sample -- and
     * that sample, being the LAST in the file, is the one a reader picks.
     * The first version of this control did exactly that and reported the
     * dense arm at 0% occupancy: the census was right and the program had
     * simply stopped holding anything by the time it was asked. */
    process.exit(0);
  }, HOLD_MS);
}

main();
