// The lru.min body shape: parallel any[] slot tables with holes, indexed reads and writes.
// Member signatures are unknown; the slot tables themselves are any[] (the item under test).
type Slot = { key: unknown; value: unknown };

function makeTable(max: number) {
  const keyList: (any | undefined)[] = new Array(max).fill(undefined);
  const valList: (any | undefined)[] = new Array(max).fill(undefined);
  const next: number[] = new Array(max).fill(0);
  let size = 0;
  return {
    put(i: number, k: unknown, v: unknown): void {
      keyList[i] = k;
      valList[i] = v;
      next[i] = i + 1;
      size++;
    },
    slot(i: number): Slot {
      return { key: keyList[i], value: valList[i] };
    },
    size(): number {
      return size;
    },
    capacity(): number {
      return keyList.length;
    },
  };
}

const t = makeTable(4);
t.put(0, "a", 1);
t.put(2, "c", "three");
for (let i = 0; i < 4; i++) {
  const s = t.slot(i);
  console.log(i, String(s.key), String(s.value));
}
console.log(t.size(), t.capacity());
