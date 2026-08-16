// A CLASS-PINNED CONST flowing into a construct-signature slot.
//
// 4211 made a direct `classRef` reach an OPTIONAL construct-signature
// field. zapo does not pass the class directly: it passes
// `WaMobileTcpSocketCtor`, a module const bound to the class
// (`export const WaMobileTcpSocketCtor: RawWebSocketConstructor =
// WaMobileTcpSocket`), and both construct-thunk sites gated on
// `expr.kind === "classRef"` — so the value arrived as a varRef and no
// rung could fire:
//   SC2003 union types must match exactly: expected '(string, string[] |
//   string | undefined) => { … } | undefined', got 'typeof TcpSock'
//
// The gate's REASON is "provably this class" (a plain `classval:C` may
// hold a strict descendant, and the thunk names the class statically).
// A const whose initializer was a direct class reference satisfies that
// reason exactly, and the proof was already being computed in order to
// PIN the binding's type — castAliasedClassRefOf at file scope,
// lowerVarDecl's classval adoption at function scope. Only the
// conclusion was thrown away; pinnedClassValueOf reads it back.
//
// The same declaration also meant two different things at the two
// scopes: the FUNCTION-scope `const c: SockCtor = TcpSock` already
// compiled on base (lowerVarDecl consults the annotation before the
// classval adoption), while its file-scope twin did not.

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

interface Cfg {
  readonly url: string
  readonly rawWebSocketConstructor?: SockCtor
}

// THE REFUSAL on base, one: the ANNOTATED module const — zapo's spelling.
const TcpSockCtor: SockCtor = TcpSock
function buildAnnotated(url: string): Cfg {
  return { url, rawWebSocketConstructor: TcpSockCtor }
}
{
  const cfg = buildAnnotated("tcp://annotated")
  const k = cfg.rawWebSocketConstructor
  console.log("annotated", cfg.url, k !== undefined)
  if (k !== undefined) {
    const s = new k("tcp://annotated")
    console.log("annotated ready", s.readyState)
    s.send("one")
  }
}

// THE REFUSAL on base, two: the UNANNOTATED module const. The binding's
// declared type IS the class value here, so nothing but the pin can make
// the flow legal.
const BareCtor = TcpSock
function buildBare(url: string): Cfg {
  return { url, rawWebSocketConstructor: BareCtor }
}
{
  const cfg = buildBare("tcp://bare")
  const k = cfg.rawWebSocketConstructor
  console.log("bare", cfg.url, k !== undefined)
  if (k !== undefined) {
    new k("tcp://bare").send("two")
  }
}

// THE REFUSAL on base, three: a const bound to ANOTHER pinned const. The
// second binding's initializer is not a class reference at all, so its
// own slot takes the annotation and the CONVERSION happens right at the
// declaration rather than at the field.
const Aliased = TcpSock
const ViaAlias: SockCtor = Aliased
{
  const cfg: Cfg = { url: "tcp://alias", rawWebSocketConstructor: ViaAlias }
  const k = cfg.rawWebSocketConstructor
  console.log("alias", cfg.url, k !== undefined)
  if (k !== undefined) {
    new k("tcp://alias").send("three")
  }
}

// THE REFUSAL on base, four: a REQUIRED field takes the same const. The
// optional spelling is not what mattered — the const was.
interface CfgReq {
  readonly url: string
  readonly rawWebSocketConstructor: SockCtor
}
{
  const req: CfgReq = { url: "tcp://req", rawWebSocketConstructor: TcpSockCtor }
  new req.rawWebSocketConstructor("tcp://req").send("four")
}

// THE CONTROL, one: FUNCTION scope, annotated. Compiled on base; must
// still, and must still mean the same thing.
function buildLocalAnnotated(url: string): Cfg {
  const local: SockCtor = TcpSock
  return { url, rawWebSocketConstructor: local }
}
{
  const k = buildLocalAnnotated("tcp://local").rawWebSocketConstructor
  if (k !== undefined) new k("tcp://local").send("five")
}

// THE CONTROL, two: FUNCTION scope, UNANNOTATED — a base refusal, and the
// function-scope face of the pin.
function buildLocalBare(url: string): Cfg {
  const local = TcpSock
  return { url, rawWebSocketConstructor: local }
}
{
  const k = buildLocalBare("tcp://localbare").rawWebSocketConstructor
  if (k !== undefined) new k("tcp://localbare").send("six")
}

// THE CONTROL, three: the pin must not have changed what the const IS.
// `new` THROUGH the const still builds a real class instance — the
// classval route, not the thunk — so a field the interface never
// declared is still readable off it.
{
  const direct = new TcpSockCtor("tcp://direct")
  console.log("direct", direct.readyState)
  direct.send("seven")
  const still = new BareCtor("tcp://still")
  console.log("still", still.url, still.readyState)
}

// THE CONTROL, four: the omitted arm is still genuinely optional.
function buildNone(url: string): Cfg {
  return { url }
}
console.log("none", buildNone("tcp://none").rawWebSocketConstructor === undefined)

// A ternary over the two arms, with the const on the present side: the
// union is real at runtime, not folded away by the pin.
function pick(on: boolean): Cfg {
  return on ? { url: "on", rawWebSocketConstructor: TcpSockCtor } : { url: "off" }
}
for (const on of [true, false]) {
  const c = pick(on)
  const k = c.rawWebSocketConstructor
  console.log(c.url, k === undefined ? "none" : String(new k("u").readyState))
}

// Two coercions of the same PINNED const into the same slot shape both
// construct, and the instances are independent. (Comparing two construct
// VALUES for identity is its own pre-existing fence — SC1043 — so this
// checks behaviour rather than `===`.)
const a = buildAnnotated("tcp://x").rawWebSocketConstructor
const b = buildAnnotated("tcp://y").rawWebSocketConstructor
if (a !== undefined && b !== undefined) {
  const ia = new a("tcp://x")
  const ib = new b("tcp://y")
  ia.readyState = 3
  console.log(ia.readyState, ib.readyState, ia === ib)
  ia.send("eight")
  ib.send("nine")
}
