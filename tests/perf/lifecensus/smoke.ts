// lifecensus smoke arm: a population whose answer is known by construction.
//
// Two kinds, two allocation sites, and a survivor rule that is arithmetic:
//   Keeper  allocated at keep(), every one of them retained -> lifetime is
//           censored, every one is a survivor.
//   Churn   allocated at churn(), none retained -> every one dies, and dies
//           young because the next loop turn drops it.
// So a census that cannot separate these two has not separated anything.
// The retained set is deliberately SPARSE: one keeper per 500 churns, which
// is the pinning shape the real question is about.
//
// BOTH CLASSES HOLD A FIELD OF THEIR OWN TYPE, and that is not decoration:
// only a type that can take part in a reference cycle is cycle-GRADED, and
// only a graded object goes through scr_cyc_alloc and lands in an arena
// chunk. An earlier version of this file had plain data classes, allocated
// 400,000 objects, and the census correctly reported NO CHUNKS -- nothing
// reached the arena at all.

class Keeper {
  self: Keeper | null = null;
  constructor(public a: number, public b: string) {}
}
class Churn {
  self: Churn | null = null;
  constructor(public x: number, public y: string) {}
}

const held: Keeper[] = [];

function keep(i: number): Keeper {
  const k = new Keeper(i, "k" + i);
  k.self = k;
  return k;
}
function churn(i: number): Churn {
  const c = new Churn(i, "c" + i);
  c.self = c;
  return c;
}

function main(): void {
  let sink = 0;
  for (let i = 0; i < 400000; i++) {
    const c = churn(i);
    sink += c.x;
    c.self = null;
    if (i % 500 === 0) held.push(keep(i));
  }
  console.log("held=" + held.length + " sink=" + sink);
}

main();
