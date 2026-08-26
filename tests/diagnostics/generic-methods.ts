// Generic METHODS (own type parameters) monomorphize per call site with
// STATIC dispatch — the forms that would need dynamic machinery keep
// specific fences.

// A receiver whose runtime class may hold an override: generic methods
// have no per-instantiation vtable slot, so only statically-exact
// receivers resolve the override set.
class VBase {
  m<T>(x: T): string {
    return `b:${String(x)}`;
  }
}
class VLeaf extends VBase {
  m<T>(x: T): string {
    return `l:${String(x)}`;
  }
}
function throughBase(r: VBase): string {
  return r.m(1);
}
console.log(throughBase(new VLeaf()));

// Mixing generic and non-generic declarations of one name across the
// hierarchy: the two dispatch worlds cannot see each other's overrides.
class PlainBase {
  f(x: number): number {
    return x;
  }
}
class GenericOver extends PlainBase {
  f<T>(x: T): T {
    return x;
  }
}
new GenericOver();

// `this` in an object-literal generic method is the receiver object —
// records don't model it.
const withThis = {
  n: 1,
  m<T>(x: T): T {
    const self = this;
    return x;
  },
};
console.log(withThis.m(2));

// The defining literal must sit at module scope: compiled instances are
// plain module functions and cannot capture the enclosing frame.
function makeObj(): number {
  const local = { m<T>(x: T): T { return x; } };
  return local.m(3);
}
console.log(makeObj());

// Static resolution needs a never-reassigned binding: this let is written
// again with a same-typed literal whose body differs — resolving against
// the first would silently call the wrong body.
let rebindable = { m<T>(x: T): T { return x; } };
console.log(rebindable.m(4));
rebindable = { m<T>(x: T): T { return x; } };

// An interface-typed receiver: the checker's property symbol is the
// interface's signature-only MethodSignature, but the BINDING still names
// the defining literal, and the receiver rule above is what proves it.
// Resolving through the receiver compiles this one — the annotation was
// never what decided, the never-reassigned-const-holding-the-literal rule
// is (corpus 7122).
interface HasGeneric {
  m<T>(x: T): T;
}
const viaInterface: HasGeneric = { m<T>(x: T): T { return x; } };
console.log(viaInterface.m(5));

// Generic methods as VALUES: bound-method references stay fenced (class
// receivers), and an unpinned object-literal reference keeps the
// generic-value fence.
class Inst {
  g<T>(x: T): T {
    return x;
  }
}
const bound = new Inst().g;
const util = { id<T>(x: T): T { return x; } };
const unpinned = util.id;
