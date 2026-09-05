// A THREE-LEVEL chain where the MIDDLE class widens, and the leaf below it
// overrides again. Both non-root entries are thunks spelled at the root's
// slot, so a root-typed dispatch answers each class's own body with the
// omitted optional's `undefined` — and `super.pick(n)` inside the leaf is a
// DIRECT call of the middle's own (widened) signature, so it carries the
// argument through.
class Root {
  pick(): unknown {
    return 'root';
  }
}

class Mid extends Root {
  override pick(n?: number): string {
    return 'mid' + String(n ?? 0);
  }
}

class Leaf extends Mid {
  override pick(n?: number): string {
    return 'leaf:' + super.pick(n);
  }
}

// A sibling of Mid that does NOT widen: its entry is the raw method.
class Plain extends Root {
  override pick(): unknown {
    return 'plain';
  }
}

const rs: Root[] = [new Root(), new Mid(), new Leaf(), new Plain()];
for (const r of rs) console.log(r.pick());

// At the LEAF's own type the call devirtualizes and the argument is real.
const leaf = new Leaf();
console.log(leaf.pick(3), leaf.pick(), leaf.pick(0));

// A dispatch typed at the WIDENING class — `m.pick()` or `m.pick(9)` where
// `m: Mid` and Leaf overrides below — has no spelling: the slot carries
// neither the extra parameter nor the narrowed return, and the runtime
// object could be either class. It fences; see
// tests/diagnostics/override-widened-mid-chain-dispatch.ts. The calls at
// Root (the slot's own signature) and at Leaf (where the receiver's static
// class IS its exact class, so the call devirtualizes) are the two above.

// The whole chain through one base-typed function, twice, so the vtable is
// actually read rather than folded.
function twice(r: Root): string {
  return String(r.pick()) + '/' + String(r.pick());
}
for (const r of rs) console.log(twice(r));

console.log(leaf instanceof Mid, leaf instanceof Root, new Mid() instanceof Leaf);
