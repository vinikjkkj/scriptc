// `return []` against a declared array return type.
//
// An empty array literal has no element type of its own, so it takes the
// type of the slot it flows into -- which every other typed slot already
// did (lowerExprExpecting), but the RETURN slot did not: it lowered the
// literal bare, got the never[] f64 representation, and then failed to
// coerce it into the declared element type. The fence blamed a 'number[]'
// the source never wrote.
//
// The async cases matter as much as the sync ones: that is the shape zapo
// writes (`async reconcileCompanions(): Promise<readonly string[]>` with
// three early `return []` guards), and an async function's return slot is
// the AWAITED type, so it goes through the same path.

export {};

function names(on: boolean): string[] {
  if (!on) {
    return [];
  }
  return ["a", "b"];
}

function readonlyNames(on: boolean): readonly string[] {
  if (!on) return [];
  return ["x"];
}

async function asyncNames(on: boolean): Promise<readonly string[]> {
  if (!on) {
    return [];
  }
  return ["p", "q"];
}

// A nested element type, so the rule is not just about strings.
function rows(on: boolean): string[][] {
  if (!on) return [];
  return [["r"]];
}

class Store {
  private readonly kept: string[] = ["k"];

  async drain(on: boolean): Promise<readonly string[]> {
    if (!on) {
      return [];
    }
    return this.kept;
  }
}

const out: string[] = [];
out.push(`names:${names(false).length}/${names(true).join("+")}`);
out.push(`ro:${readonlyNames(false).length}/${readonlyNames(true).join("+")}`);
out.push(`rows:${rows(false).length}/${rows(true).length}`);
console.log(out.join(" "));

const a = await asyncNames(false);
const b = await asyncNames(true);
console.log(`async:${a.length}/${b.join("+")}`);

const store = new Store();
console.log(`drain:${(await store.drain(false)).length}/${(await store.drain(true)).join("+")}`);
