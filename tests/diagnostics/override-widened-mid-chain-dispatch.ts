// An override may WIDEN the vtable slot — append trailing optional
// parameters, or return something the slot's `unknown` boxes — because the
// entry becomes a thunk spelled at the slot. What has no spelling is a
// VIRTUAL dispatch typed at the widening class itself: the call would push
// an argument the slot has no place for, and the runtime object could be
// the subclass below.
//
// Both diagnostics below are that case. The same calls at `Root` (the slot's
// own signature) and at `Leaf` (where the exact class is the receiver's
// static class, so the call devirtualizes) compile.
abstract class Root {
  abstract pick(): unknown;
}

class Mid extends Root {
  override pick(n?: number): string {
    return 'mid' + String(n ?? 0);
  }
}

class Leaf extends Mid {
  override pick(n?: number): string {
    return 'leaf' + String(n ?? 0);
  }
}

function throughMid(m: Mid): string {
  return m.pick(5);
}

function alsoThroughMid(m: Mid): string {
  return m.pick();
}

console.log(throughMid(new Mid()), throughMid(new Leaf()), alsoThroughMid(new Leaf()));
