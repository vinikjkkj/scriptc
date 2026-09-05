// BOTH widenings on one override: a trailing optional parameter the slot
// does not carry AND a return the slot's `unknown` boxes. The thunk fills
// the argument and boxes the result in one step.
abstract class Cell {
  abstract show(): unknown;
  abstract kind(): string;
}

class IntCell extends Cell {
  v: number;
  constructor(v: number) {
    super();
    this.v = v;
  }
  override show(o?: { hex?: boolean }): number | string {
    if (o !== undefined && o.hex === true) return '0x' + this.v.toString(16);
    return this.v;
  }
  override kind(): string {
    return 'int';
  }
}

class ListCell extends Cell {
  items: string[];
  constructor(items: string[]) {
    super();
    this.items = items;
  }
  override show(o?: { joined?: boolean }): string | string[] {
    if (o !== undefined && o.joined === true) return this.items.join(',');
    return this.items;
  }
  override kind(): string {
    return 'list';
  }
}

const cells: Cell[] = [new IntCell(255), new ListCell(['a', 'b', 'c'])];
for (const c of cells) console.log(c.kind(), c.show());
for (const c of cells) console.log(JSON.stringify(c.show()));

const i = new IntCell(255);
console.log(i.show(), i.show({}), i.show({ hex: true }));
const l = new ListCell(['x', 'y']);
console.log(l.show(), l.show({ joined: true }), l.show({}).length);

// The boxed values flow on: a dyn from the slot compares and prints like
// the value it holds.
function first(cs: Cell[]): unknown {
  return cs[0]!.show();
}
console.log(first(cells) === 255, String(first(cells)));

// An array of the boxed results — every element boxed by a different
// class's thunk.
const boxed: unknown[] = [];
for (const c of cells) boxed.push(c.show());
console.log(boxed.length, JSON.stringify(boxed));
