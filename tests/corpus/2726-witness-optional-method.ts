// An interface with an OPTIONAL method, projected out of a class that
// implements it.
//
// The constructor-witness projection turns a class instance into the
// record an interface maps to. It required every method field to be a
// plain function type, so `destroy?(): void` -- a union of the signature
// and undefined -- made it refuse the whole class, including the members
// it had no trouble with. The class implements the method outright; the
// projection now wraps it into the arm.
//
// Both directions matter: a class that HAS the optional member projects
// the bound method, and one that omits it projects the undefined arm, so
// a presence test answers what Node answers.
interface Store {
  load(): string;
  destroy?(): string;
  readonly label: string;
}

class Full implements Store {
  readonly label = "full";
  private v = "alive";
  load(): string {
    return this.v;
  }
  destroy(): string {
    this.v = "dead";
    return this.v;
  }
}

class Bare implements Store {
  readonly label = "bare";
  load(): string {
    return "bare";
  }
}

function describe(make: () => Store): string {
  const s = make();
  return `${s.label}:${s.load()}:${s.destroy === undefined ? "no-destroy" : "has-destroy"}`;
}

console.log(describe(() => new Full()));
console.log(describe(() => new Bare()));

// The optional member's presence is per CLASS, not per slot: the same
// parameter takes both and answers differently.
console.log(describe(() => new Full()), describe(() => new Bare()));

// (An arrow that ANNOTATES its return as the interface -- `(): Store =>
// new Full()` -- coerces in its own body rather than through the adapter,
// and that site still fences. Different path, not covered here.)
