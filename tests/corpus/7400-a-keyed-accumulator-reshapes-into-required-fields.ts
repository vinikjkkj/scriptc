// A `Record<string, V>` accumulator returned AS a record whose fields are
// REQUIRED — the keyed read's other half.
//
// 7397 pins the arm for an OPTIONAL-flavoured target field: the read's
// `V | undefined` lifts into a slot that has an undefined arm to hold "the
// map does not have this key". A REQUIRED field has no such arm, and until
// now the pair declined whenever the signature's value type was anything
// but `unknown` — the `unknown` case alone was granted the CHECKED
// extraction (dynOut, the validated dynCheck the `as T` cast path already
// applies to a dyn).
//
// `string | undefined` into `string` is the SAME position one type-world
// over, and its checked extraction is `narrow` — narrowedArmHelper, exactly
// `x!`. So it is offered here on dynOut's own terms: the value comes out
// for every key the map HOLDS, and a key it does not hold throws the
// catchable TypeError instead of the unconditional throw the pair used to
// strand on. Nothing else widthLiftPlan would answer is offered to a
// required field — a plain copy could put a missing key's undefined into a
// slot with nowhere to keep it, and that would be silent.
//
// The site is zapo's fake-server bench store factory:
//
//   function buildProviders<B extends string>(name: B): ProvidersFor<B> {
//     const out: Record<string, B> = {}
//     for (const d of PERSISTENT_DOMAINS) out[d] = name
//     …
//     return out as ProvidersFor<B>
//   }
//
// where `ProvidersFor<B>` is `Required<…>` over eleven domain names. The
// loop fills every one, so the extraction never throws — and that is the
// case this program prints: a fully populated map read back through the
// required shape, field by field, in declaration order.

type ProvidersFor<B extends string> = {
  auth: B
  signal: B
  session: B
}

type Providers = ProvidersFor<string>

const DOMAINS = ["auth", "signal", "session"] as const

function buildProviders<B extends string>(name: B): ProvidersFor<B> {
  const out: Record<string, B> = {}
  for (const d of DOMAINS) out[d] = name
  return out as ProvidersFor<B>
}

const p = buildProviders("sqlite")
console.log(p.auth, p.signal, p.session)

// The same reshape over a map built by hand. No overflow key is written:
// the width family's DROP of one (JS's narrowed value is the same object
// and keeps it; the struct copy ends it) is a divergence of its own and is
// pinned where it belongs, not smuggled in here.
function asProviders(m: Record<string, string>): Providers {
  return m as Providers
}

const hand: Record<string, string> = {}
hand["auth"] = "memory"
hand["signal"] = "memory"
hand["session"] = "memory"
const q = asProviders(hand)
console.log(q.auth, q.signal, q.session)
console.log(JSON.stringify(q))

// A second value type: the arm is about the READ's union, not about strings.
type Counts = {
  a: number
  b: number
}

function asCounts(m: Record<string, number>): Counts {
  return m as Counts
}

const nums: Record<string, number> = {}
nums["a"] = 1
nums["b"] = 2
const c = asCounts(nums)
console.log(c.a + c.b, JSON.stringify(c))
