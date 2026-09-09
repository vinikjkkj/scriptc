/* A spike of cycle-headered objects, dropped, then steady churn around a
 * small live set.
 *
 * This is the shape the cycle arena's chunk reclamation exists for, reduced
 * to something a gate can run in seconds: each round builds a large graph of
 * self-referencing nodes (so the collector, not the refcount, is what frees
 * them), drops the whole thing, and the next round starts again. A chunk
 * that cannot be returned makes the high-water permanent; a chunk that can
 * makes each round reuse the last one's.
 *
 * THE SURVIVORS ARE DELIBERATE. `held` keeps a few hundred nodes alive for
 * the whole run, and the churn loop touches them, so some chunks stay
 * pinned by one live block — which is the case a per-chunk live count has
 * to get right and a whole-arena high-water never sees.
 *
 * Read by tests/harness/cycle-arena.test.ts, which drives SCR_CYCLE_ARENA
 * and reads the [cycstat] arena line. The program prints one deterministic
 * line, so a failure there is always about the arena and never about this
 * file's output. */
type Node = { v: number; next: Node | null; self: Node | null };

const ROUNDS = Number(
  process.env["ARENA_ROUNDS"] !== undefined ? process.env["ARENA_ROUNDS"] : "3"
);
const SPIKE = Number(
  process.env["ARENA_SPIKE"] !== undefined ? process.env["ARENA_SPIKE"] : "30000"
);
const CHURN = Number(
  process.env["ARENA_CHURN"] !== undefined ? process.env["ARENA_CHURN"] : "80000"
);
const HELD = Number(
  process.env["ARENA_HELD"] !== undefined ? process.env["ARENA_HELD"] : "300"
);
/* WHERE THE SURVIVORS SIT, which is a different question from how many of
 * them there are, and the page ceiling turns entirely on it.
 *
 * 0 (the default) keeps the behaviour this fixture has always had: `held`
 * is built in one run of consecutive allocations, so the survivors are
 * CLUSTERED and the chunks between them empty completely and are returned.
 *
 * N > 1 builds HELD*N nodes and keeps every Nth, so the SAME NUMBER of
 * survivors is spread across N times as many chunks. No chunk empties, so
 * none is returned, and the free space is chopped into holes the size of
 * one block.
 *
 * The pair is what makes the ceiling credible in both directions: a number
 * that read near zero for every input would be indistinguishable from one
 * that was never computed. Varying the survivor COUNT (ARENA_HELD) cannot
 * show that, because it moves live bytes and free pages together. */
const SCATTER = Number(
  process.env["ARENA_SCATTER"] !== undefined ? process.env["ARENA_SCATTER"] : "0"
);

/* A chain plus a self-edge on every node: the self-edge is what makes each
 * node a cycle the refcount alone can never free. */
function build(n: number): Node[] {
  const out: Node[] = [];
  let prev: Node | null = null;
  for (let i = 0; i < n; i++) {
    const node: Node = { v: i, next: prev, self: null };
    node.self = node;
    out.push(node);
    prev = node;
  }
  return out;
}

function main(): void {
  let sink = 0;
  for (let r = 0; r < ROUNDS; r++) {
    const big = build(SPIKE);
    for (let i = 0; i < big.length; i += 1000) sink += big[i]!.v;
    big.length = 0;
  }
  let held: Node[];
  if (SCATTER > 1) {
    const wide = build(HELD * SCATTER);
    held = [];
    for (let i = 0; i < wide.length; i += SCATTER) {
      const n = wide[i]!;
      /* THE CHAIN HAS TO BE CUT, and forgetting it does not fail loudly.
       * build() links every node to its predecessor through `next`, so a
       * survivor transitively retains its ENTIRE prefix: keeping every
       * 20th would retain all 20/20 of them, the arena would report the
       * scattered arm as full, and it would look identical to the
       * clustered one. That is not hypothetical — it is the exact defect
       * that made an earlier version of this control read 97.7%
       * occupancy on both arms. `self` is left alone: it is what makes a
       * dropped node a cycle only the collector can free, which is the
       * path the real workload's garbage takes. */
      n.next = null;
      held.push(n);
    }
    wide.length = 0;
  } else {
    held = build(HELD);
  }
  for (let i = 0; i < CHURN; i++) {
    const small = build(3);
    sink += small[0]!.v + held[i % held.length]!.v;
    small.length = 0;
  }
  console.log("arena " + String(sink) + " " + String(held.length));
}

main();
