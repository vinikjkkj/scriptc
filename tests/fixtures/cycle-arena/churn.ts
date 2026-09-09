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
  const held = build(HELD);
  for (let i = 0; i < CHURN; i++) {
    const small = build(3);
    sink += small[0]!.v + held[i % held.length]!.v;
    small.length = 0;
  }
  console.log("arena " + String(sink) + " " + String(held.length));
}

main();
