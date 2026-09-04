// `PromiseLike<T>` maps to the promise slot (frontend/types.ts states the
// boundary and why it is honest), and the price of that answer is that
// every OTHER inhabitant of PromiseLike — any object with a `then` — must
// be refused where it is written. These are those sites.
//
// The refusals are not new machinery: three of the four are the ordinary
// structural ones a record/class/function offered at a promise type has
// always taken. What is pinned here is that they still fire once the TYPE
// spells, and that the object-literal case names the THENABLE rather than
// blaming `PromiseLike<T>` for having no lowering — which it no longer
// does, so the old wording would send the reader after the wrong thing.

// A — an object literal whose `then` matches the lib signature exactly, so
// the checker accepts it with no assertion. Node adopts it; this compiler
// has no lowering for a bare thenable and says so.
const a: PromiseLike<number> = {
  then<TResult1 = number, TResult2 = never>(
    onfulfilled?: ((value: number) => TResult1 | PromiseLike<TResult1>) | null,
    _onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(onfulfilled!(5) as TResult1 | TResult2);
  },
};

// B — the same thing as a CLASS instance. A class is not the promise type,
// so the assignment is refused on the value's own shape.
class Thenable implements PromiseLike<number> {
  then<TResult1 = number, TResult2 = never>(
    onfulfilled?: ((value: number) => TResult1 | PromiseLike<TResult1>) | null,
    _onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(onfulfilled!(6) as TResult1 | TResult2);
  }
}
const b: PromiseLike<number> = new Thenable();

// C — a hand-rolled thenable smuggled past the CHECKER with a double
// assertion, which is how this reaches the lowerer with a record type in
// hand rather than a PromiseLike-shaped one.
const c: PromiseLike<number> = {
  then(cb: (v: number) => void): void {
    cb(1);
  },
} as unknown as PromiseLike<number>;

// D — a thenable offered at a PromiseLike PARAMETER.
async function take(p: PromiseLike<number>): Promise<number> {
  return await p;
}
const d = {
  then<TResult1 = number, TResult2 = never>(
    onfulfilled?: ((value: number) => TResult1 | PromiseLike<TResult1>) | null,
    _onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(onfulfilled!(7) as TResult1 | TResult2);
  },
};

async function main(): Promise<void> {
  console.log(await a, await b, await c, await take(d));
}
void main();
