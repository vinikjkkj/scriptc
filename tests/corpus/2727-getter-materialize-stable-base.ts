// A pure-read getter satisfying a DATA property materializes the
// reference it names -- but only when that reference cannot be repointed.
//
// Freezing `get store() { return base }` into a data slot is unobservable
// while `base` keeps naming the same object: mutation reaches it through
// either path. It stops being unobservable the moment the BINDING is
// reassigned, because the live getter would start returning the new
// object and the materialized field would not. On a torn-down resource
// that is not just a stale read, it is a use-after-free -- and it is
// silent, which is why the base has to be a binding nothing reassigns.
interface Bundle {
  readonly store: { n: number };
  readonly label: string;
}

const fixed = { n: 1 };

const bundle: Bundle = {
  label: "b",
  get store() {
    return fixed;
  },
};

// Mutating THROUGH the reference is visible either way -- that is what
// makes materializing the reference sound.
fixed.n = 42;
console.log(bundle.label, bundle.store.n);

fixed.n += 1;
console.log(bundle.store.n, bundle.store === fixed);

// A second bundle over the same base, and a nested pure read.
const outer = { inner: fixed };
const nested: Bundle = {
  label: "n",
  get store() {
    return outer.inner;
  },
};
console.log(nested.label, nested.store.n, nested.store === fixed);

// (A getter over a LET that gets reassigned keeps the fence: the frozen
// reference would go stale. Not spelled here -- a corpus program has to
// compile -- but that is the boundary this case sits against.)
