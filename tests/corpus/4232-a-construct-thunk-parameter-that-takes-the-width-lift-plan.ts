// A CONSTRUCT THUNK whose parameter needs the WIDTH-LIFT plan.
//
// classCtorThunk completes each constructor argument from the same-
// position slot parameter, and it did that with `widthCoerce` alone —
// which has record→record, tuple→array and class-value rungs but NO
// union rung. zapo's slot parameter
//
//   options?: { headers?: Readonly<Record<string, string>>
//               dispatcher?: WaProxyDispatcher; agent?: WaProxyAgent }
//
// against the constructor's own `_options?: WaRawWebSocketInit` is two
// OPTIONAL records differing by one further optional field, so both
// sides are unions and widthCoerce answered null — the whole class value
// declined, on a conversion `widthLiftPlan` already answers `retag` for.
// That plan is what this function's own caller uses one rung over (the
// union destination in coerceToExpected), so the thunk was refusing what
// the compiler knows how to build.
//
// The interesting half is runtime, not the diagnostic: the retag must
// carry the FIELDS ACROSS. A conversion that compiled but handed the
// constructor an empty record would print exactly the same shape of
// output with every value missing, so every field is read back out.

interface Init {
  readonly protocols?: string
  readonly label?: string
  readonly retries?: number
}
interface Sock {
  readyState: number
  describe(): string
}
// The SLOT signature's third parameter is NARROWER than the class's:
// no `protocols`.
type SockCtor = new (
  url: string,
  protocols?: string | readonly string[],
  options?: { label?: string; retries?: number },
) => Sock

class TcpSock implements Sock {
  public readyState = 0
  public readonly url: string
  public readonly label: string
  public readonly retries: number
  public readonly protocols: string
  public constructor(url: string, _protocols?: unknown, options?: Init) {
    this.url = url
    this.label = options?.label ?? "<nolabel>"
    this.retries = options?.retries ?? -1
    this.protocols = options?.protocols ?? "<noprotocols>"
  }
  public describe(): string {
    return this.url + "|" + this.label + "|" + String(this.retries) + "|" + this.protocols
  }
}

interface Cfg {
  readonly url: string
  readonly rawWebSocketConstructor?: SockCtor
}
const Ctor: SockCtor = TcpSock
function build(url: string): Cfg {
  return { url, rawWebSocketConstructor: Ctor }
}

// The option record actually reaches the constructor.
{
  const k = build("tcp://opts").rawWebSocketConstructor
  if (k !== undefined) {
    console.log(new k("tcp://opts", "p1", { label: "L", retries: 4 }).describe())
    console.log(new k("tcp://opts", "p1", { label: "onlylabel" }).describe())
    console.log(new k("tcp://opts", "p1", { retries: 0 }).describe())
    console.log(new k("tcp://opts", "p1", {}).describe())
  }
}

// The parameter is genuinely optional on BOTH sides: omitted at the slot,
// and the class sees its own undefined.
{
  const k = build("tcp://bare").rawWebSocketConstructor
  if (k !== undefined) {
    console.log(new k("tcp://bare").describe())
    console.log(new k("tcp://bare", "p2").describe())
  }
}

// An explicit `undefined` in the option position is not the same
// statement as omitting it, and both must answer the same way.
{
  const k = build("tcp://undef").rawWebSocketConstructor
  if (k !== undefined) {
    console.log(new k("tcp://undef", undefined, undefined).describe())
  }
}

// The value flowing in is a BINDING, not a literal, so the conversion is
// a real runtime one rather than a shape the literal could have been
// built into directly.
{
  const opts = { label: "bound", retries: 7 }
  const k = build("tcp://bound").rawWebSocketConstructor
  if (k !== undefined) {
    console.log(new k("tcp://bound", "p3", opts).describe())
    // …and the source is not aliased away by the copy.
    console.log(opts.label, opts.retries)
  }
}

// The class's OWN extra optional field (`protocols`, which the slot
// signature has no parameter for) completes to undefined, not to a
// stale or zeroed value.
{
  const k = build("tcp://extra").rawWebSocketConstructor
  if (k !== undefined) {
    const s = new k("tcp://extra", "ignored", { label: "x", retries: 1 })
    console.log(s.describe(), s.readyState)
  }
}

// Direct construction through the class is unchanged: the class's own
// third parameter still takes its own wider record.
{
  const direct = new TcpSock("tcp://direct", "p4", { protocols: "P", label: "D", retries: 9 })
  console.log(direct.describe())
}
