// Overload sets whose IMPLEMENTATION is generic. The resolved signature is
// then not the one tsc checked the body under -- and need not be parallel to
// it (here overload 1 is non-generic and takes an OPTIONAL parameter the
// generic overload requires), so the instance compiles the implementation
// signature with each type parameter at its constraint, and the return
// reconciles back to what the call site was told.
type Store = { name: string; n: number };

export function make(options?: { readonly tag?: undefined }): Store;
export function make<B extends string>(options: { readonly tag: B }): Store;
export function make<B extends string>(options?: { readonly tag?: B }): Store {
  return { name: options?.tag ?? "mem", n: 1 };
}

// A narrower resolved RETURN than the implementation's: the overload promises
// one arm of the implementation's union, so the call carries the checked
// extraction rather than a misread payload.
export function pick(k: "a"): string;
export function pick<T extends number>(k: T): string | number;
export function pick<T extends number | "a">(k: T): string | number {
  return k === "a" ? "letter" : 42;
}

const a = make({});
const b = make({ tag: "disk" });
console.log(a.name, a.n, b.name, b.n);
console.log(pick("a").toUpperCase());
console.log(pick(7));
