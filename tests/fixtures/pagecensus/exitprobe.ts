/* A program that leaves through process.exit(0), which is what zapo-rest does
 * and what made every exit-time census on it report nothing at all.
 *
 * process.exit lowers to _Exit, which skips atexit. A census that registers
 * only an atexit handler therefore writes NO FILE -- not the output, not the
 * stderr fallback, not the ARMED line whose entire job is to prove the hooks
 * compiled. That is indistinguishable from "the census found nothing", so it
 * has to be tested causally rather than reasoned about.
 *
 * Allocates enough cycle-headered objects to take real arena chunks first, so
 * a report that does appear has something in it to report.
 */
type Node = { v: number; self: Node | null };

function main(): void {
  const held: Node[] = [];
  let sink = 0;
  for (let i = 0; i < 20000; i++) {
    const n: Node = { v: i, self: null };
    n.self = n;
    if (i % 50 === 0) held.push(n);
    sink += n.v;
  }
  console.log("exitprobe " + String(sink) + " " + String(held.length));
  process.exit(0);
}

main();
