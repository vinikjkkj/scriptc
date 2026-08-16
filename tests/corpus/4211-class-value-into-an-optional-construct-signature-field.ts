// A CLASS VALUE flowing into an OPTIONAL construct-signature field.
//
// `widthCoerce` already turns a `classRef` into a construct THUNK for a
// PLAIN `new (...) => Iface` slot (classCtorThunk), and a binding of the
// class the program `new`s through lowers too. Making the field OPTIONAL
// turns the destination into the two-arm union `new (...) => Iface |
// undefined`, and coerceToExpected's union path had a rung for a promise
// value against one promise arm, a rung for a function value against one
// func arm, and a rung for a derived CLASS VALUE against a base classval
// arm — but none for a class value against a CONSTRUCT-SIGNATURE arm. On
// base the required spelling compiles and the optional one refuses:
//   SC2003 union types must match exactly: expected '(string, string[] |
//   string | undefined) => { readyState: number; send: (string) => void }
//   | undefined', got 'typeof TcpSock'
// zapo's `credentials-flow.ts:204` is exactly that site
// (`rawWebSocketConstructor: WaMobileTcpSocketCtor` into
// `readonly rawWebSocketConstructor?: RawWebSocketConstructor`).
//
// The thunk is interned per (class, signature) and ZERO-CAPTURE, so the
// identity block at the end is the control: two coercions of the same class
// into the same slot shape are the same runtime value.

interface Sock {
  readyState: number
  send(d: string): void
}
type SockCtor = new (url: string, protocols?: string | readonly string[]) => Sock

class TcpSock implements Sock {
  public readyState = 0
  public readonly url: string
  public constructor(url: string) {
    this.url = url
  }
  public send(d: string): void {
    console.log("send " + this.url + " " + d)
  }
}

// THE REFUSAL on base: the field is OPTIONAL, so the slot is a union.
interface Cfg {
  readonly url: string
  readonly rawWebSocketConstructor?: SockCtor
}
function make(url: string): Cfg {
  return { url, rawWebSocketConstructor: TcpSock }
}
const cfg = make("tcp://a")
console.log(cfg.url, cfg.rawWebSocketConstructor !== undefined)
const ctor = cfg.rawWebSocketConstructor
if (ctor !== undefined) {
  const s = new ctor("tcp://a")
  console.log(s.readyState)
  s.send("hello")
}

// THE CONTROL, one: the same value into the same signature made REQUIRED.
// It lowered on base and must still.
interface CfgReq {
  readonly url: string
  readonly rawWebSocketConstructor: SockCtor
}
const req: CfgReq = { url: "tcp://b", rawWebSocketConstructor: TcpSock }
const s2 = new req.rawWebSocketConstructor("tcp://b")
s2.send("required")

// THE CONTROL, two: a plain binding of the construct signature. Also base.
const bound: SockCtor = TcpSock
const s3 = new bound("tcp://c")
s3.send("bound")

// The union arm is genuinely optional: an omitted field stays undefined and
// the undefined arm is what comes out.
function makeBare(url: string): Cfg {
  return { url }
}
console.log(makeBare("tcp://d").rawWebSocketConstructor === undefined)

// A ternary over the two arms — the union is real at runtime, not folded.
function pick(on: boolean): Cfg {
  return on ? { url: "on", rawWebSocketConstructor: TcpSock } : { url: "off" }
}
for (const on of [true, false]) {
  const c = pick(on)
  const k = c.rawWebSocketConstructor
  console.log(c.url, k === undefined ? "none" : String(new k("u").readyState))
}

// Two coercions of the same class into the same slot shape both construct,
// and the instances are independent. (Comparing the two construct VALUES for
// identity is its own pre-existing fence — SC1043, comparing non-number,
// non-string values — so this checks behaviour rather than `===`.)
const a = make("tcp://x").rawWebSocketConstructor
const b = make("tcp://y").rawWebSocketConstructor
if (a !== undefined && b !== undefined) {
  const ia = new a("tcp://x")
  const ib = new b("tcp://y")
  ia.readyState = 3
  console.log(ia.readyState, ib.readyState, ia === ib)
  ia.send("first")
  ib.send("second")
}
