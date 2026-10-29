// A class FIELD whose type is an object with spelled `any` members (bare `any`
// and `any | undefined`), written and read through a Record keyed by string, plus a
// base-typed receiver reading the subclass's any-valued slot.
type Slot = { name: string; value: any | undefined };
type Loose = { tag: number; payload: any };

class Store {
  readonly slots: Record<string, Slot | false | undefined> = Object.create(null);
  loose: Loose = { tag: 1, payload: undefined };
  put(name: string, value: unknown): void {
    this.slots[name] = { name, value };
  }
  get(name: string): unknown {
    const s = this.slots[name];
    if (s === false || s === undefined) return "missing";
    return s.value;
  }
  mark(name: string): void {
    this.slots[name] = false;
  }
}

class Child extends Store {
  readonly tagged = "child";
  override get(name: string): unknown {
    return "child:" + String(super.get(name));
  }
}

const s = new Store();
s.put("a", 42);
s.put("b", "text");
s.put("c", undefined);
s.mark("b");
console.log(s.get("a"), s.get("b"), s.get("c"), s.get("zz"));
console.log(s.loose.tag, s.loose.payload === undefined);
s.loose = { tag: 2, payload: { k: [1, 2] } };
console.log(s.loose.tag, JSON.stringify(s.loose.payload));
const c = new Child();
c.put("x", true);
const base: Store = c;
console.log(base.get("x"), c.tagged, base.get("nope"));
