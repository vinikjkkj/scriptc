// The same narrowed-receiver shape with a string-or-null body, read through
// a `??` default and as a bare chain value, on an object receiver that holds
// a null field (the body is null at run time, not the receiver).
class Named {
  label: string | null
  constructor(l: string | null) { this.label = l }
  name(): string | null { return this.label }
}

function make(label: string | null) {
  let nm: Named | null = null
  nm = new Named(label)
  const shown = (): string => nm?.name() ?? "anon"
  const raw = (): string | null => nm?.name() ?? null
  return { shown, raw }
}

const x = make("zed")
console.log("S1", x.shown(), x.raw())
const y = make(null)
console.log("S2", y.shown(), y.raw())

// An undefined-armed receiver whose body is itself the union.
let maybe: Named | undefined = undefined
const got = (): string | null => maybe?.name() ?? null
console.log("S3", got())
maybe = new Named("late")
console.log("S4", got())
