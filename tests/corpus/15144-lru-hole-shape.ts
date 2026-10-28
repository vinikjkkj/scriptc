// The lru.min index shape, numbers only: next/prev grow by `.length =`,
// are refilled with fill(0, start), and are walked by index. The reads of
// the grown tail are holes that become undefined in number locals.
function createIndexLists(initial: number) {
  let max = initial;
  let head = 0;
  let tail = 0;
  let size = 0;
  const next: number[] = new Array(max).fill(0);
  const prev: number[] = new Array(max).fill(0);

  const grow = (newMax: number): void => {
    next.length = newMax;
    prev.length = newMax;
    next.fill(0, max);
    prev.fill(0, max);
    max = newMax;
  };

  const shrink = (newMax: number): void => {
    next.length = newMax;
    prev.length = newMax;
    if (tail >= newMax) tail = newMax - 1;
    max = newMax;
  };

  const link = (index: number): void => {
    next[tail] = index;
    prev[index] = tail;
    next[index] = 0;
    tail = index;
    size++;
  };

  return {
    grow,
    shrink,
    link,
    walk: (): string => {
      let out = "";
      let cur = head;
      for (let i = 0; i < size; i++) {
        out += `${cur}>`;
        cur = next[cur];
      }
      return out;
    },
    growRaw: (n: number): void => {
      next.length = n;
      prev.length = n;
    },
    state: () => ({ max, head, tail, size, len: next.length, lenP: prev.length }),
    probe: (i: number): string => {
      const n = next[i];
      const p = prev[i];
      return `${n === undefined} ${p === undefined} ${n} ${typeof p} ${n ?? -1} ${Number.isNaN(n)}`;
    },
  };
}

const lists = createIndexLists(2);
lists.link(1);
console.log(JSON.stringify(lists.state()), lists.walk());
lists.grow(5);
console.log(JSON.stringify(lists.state()));
lists.link(3);
lists.link(4);
console.log(lists.probe(2));
console.log(lists.probe(4));
lists.shrink(3);
console.log(JSON.stringify(lists.state()));
lists.grow(6);
console.log(lists.probe(5), lists.probe(0));

lists.growRaw(9);
console.log(lists.probe(7), lists.probe(8));
let hole = next0();
console.log(hole, hole === undefined, typeof hole, hole ?? 42);
function next0(): number {
  const arr: number[] = new Array(1).fill(3);
  arr.length = 4;
  return arr[2];
}
