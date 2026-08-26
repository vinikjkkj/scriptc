// A generic method in an ANNOTATED object literal, whose type parameter
// carries NO constraint.
//
// `{ pick<T>(x: T): T { return x } }` monomorphizes per call site against
// the defining literal -- and did, until an annotation was put on the
// binding. Then the checker's property symbol for `c.pick` became the
// INTERFACE's MethodSignature, which is signature-only and has no body to
// monomorphize, and the call was refused with advice to "bind the receiver
// to a const initialized with its 'new' expression" -- which the receiver
// already was, only to an object literal rather than to a `new`. So two
// spellings of one program disagreed on the annotation alone.
//
// An UNCONSTRAINED parameter has no constraint instantiation, so this
// member genuinely has no closure slot: monomorphization is the only home,
// and the literal is right there. Resolving through the receiver finds it;
// the receiver discipline is unchanged (a never-reassigned binding whose
// initializer IS the defining literal), which is what the last two cases
// below hold in place.

interface Pick1 {
  pick<T>(x: T): T;
}
interface Pick2 {
  pick<T>(x: string): T | null;
}

const p1: Pick1 = {
  pick<T>(x: T): T {
    return x;
  },
};
console.log('p1s=' + p1.pick<string>('a'));
console.log('p1n=' + String(p1.pick<number>(7)));

const p2: Pick2 = {
  pick<T>(x: string): T | null {
    return x === 'z' ? null : ({ v: x } as unknown as T);
  },
};
const got = p2.pick<{ v: string }>('c');
console.log('p2=' + (got === null ? 'null' : got.v));
console.log('p2z=' + (p2.pick<{ v: string }>('z') === null ? 'null' : '?'));

// The UNANNOTATED spelling of the same thing, as the A/A control.
const p3 = {
  pick<T>(x: T): T {
    return x;
  },
};
console.log('p3=' + p3.pick<string>('d') + String(p3.pick<number>(8)));

// A generic method beside data and non-generic members in one annotated
// literal: the shape keeps the data, the generic member is monomorphized.
interface Mixed {
  readonly tag: string;
  plain(n: number): number;
  wrap<T>(x: T): { readonly tag: string; readonly value: T };
}
const mixed: Mixed = {
  tag: 'm',
  plain(n: number): number {
    return n * 2;
  },
  wrap<T>(x: T): { readonly tag: string; readonly value: T } {
    return { tag: 'w', value: x };
  },
};
console.log('mixed=' + mixed.tag + String(mixed.plain(21)));
const ws = mixed.wrap<string>('s');
console.log('wrap-s=' + ws.tag + '/' + ws.value);
const wn = mixed.wrap<number>(5);
console.log('wrap-n=' + wn.tag + '/' + String(wn.value));
