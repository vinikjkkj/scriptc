// An `async` function whose return type is `Promise<R | null>`, returning a
// record literal with a nested literal field.
//
// An async return position types the literal `T | PromiseLike<T>` (the lib's
// await-unwrapping contract) and lowerObjectLiteral strips the PromiseLike
// arm through the checker's awaited type before it builds the shape. The
// ts7 CheckerFacade shims `getAwaitedType` (7.0.2 dropped it) by unwrapping
// Promise references and distributing over unions, and it answered UNDEFINED
// whenever the arms unwrapped to more than one distinct type — which is
// exactly what `Promise<R | null>` produces: `PromiseLike<R | null> | R |
// null` unwraps to `{R | null, R, null}`. So the strip silently did not
// happen, `mapTypeOf` had no shape for a union carrying PromiseLike, and the
// literal fell back to its OWN inferred type. Its `node` field's own shape
// (`attrs: {}` — an EMPTY record) then met the value, which had lowered at
// the declared `BNode`:
//   SC2002 record shapes must match exactly or width-coerce: expected
//   '{ attrs: {}; content: {...}[]; tag: string }', got '{ attrs:
//   { [key: string]: string }; content: ...; tag: string }'
// The `expected` side reading like the narrow literal is the tell: the
// destination really WAS the literal's own shape. zapo's
// `message/crypto/reporting-token.ts:116` is that site.
//
// The shim can now answer, and only by naming a type it ALREADY HOLDS: the
// PromiseLike arm's own type argument, accepted only when its arms are
// exactly the arms of everything awaited. Two factors were independently
// necessary to reproduce — `async` AND a union payload — so both single-
// factor controls are below and both compiled on base.

interface BNode {
  readonly tag: string
  readonly attrs: Readonly<Record<string, string>>
  readonly content?: Uint8Array | string | readonly BNode[]
}
interface Result {
  readonly node: BNode
  readonly version: number
  readonly token: Uint8Array
}

// THE REFUSAL on base: async AND a `| null` payload.
// eslint-disable-next-line @typescript-eslint/require-await
async function build(version: number, token: Uint8Array): Promise<Result | null> {
  if (version === 0) return null
  return {
    node: {
      tag: "reporting",
      attrs: {},
      content: [{ tag: "reporting_token", attrs: { v: String(version) }, content: token }],
    },
    version,
    token,
  }
}

function show(r: Result | null): string {
  if (r === null) return "null"
  const inner = r.node.content
  const kids = Array.isArray(inner) ? inner.length : 0
  return r.node.tag + "/" + String(r.version) + "/" + String(kids) + "/" + String(r.token.length)
}

async function main(): Promise<void> {
  console.log(show(await build(0, new Uint8Array(0))))
  console.log(show(await build(7, new Uint8Array([1, 2, 3]))))

  // The nested literal really did build at the DECLARED shape: `attrs` is an
  // index-signature record, so a key written into it reads back.
  const r = await build(9, new Uint8Array([9]))
  if (r !== null) {
    const inner = r.node.content
    if (Array.isArray(inner)) {
      for (const kid of inner) {
        console.log(kid.tag, Object.keys(kid.attrs).join("|"), Object.keys(kid.attrs).length)
      }
    }
    console.log(Object.keys(r.node.attrs).length)
  }

  // `| undefined` instead of `| null` is the same shape and was the same
  // refusal on base.
  // eslint-disable-next-line @typescript-eslint/require-await
  async function buildU(v: number): Promise<Result | undefined> {
    if (v === 0) return undefined
    return { node: { tag: "u", attrs: {}, content: "x" }, version: v, token: new Uint8Array(1) }
  }
  const u = await buildU(3)
  console.log(u === undefined ? "undef" : u.node.tag + ":" + String(u.version))
  console.log((await buildU(0)) === undefined)

  // A THREE-arm payload: the shim's rule is "the candidate's arms are
  // exactly the arms of everything awaited", which holds for any width.
  // eslint-disable-next-line @typescript-eslint/require-await
  async function build3(v: number): Promise<Result | null | undefined> {
    if (v === 0) return null
    if (v === 1) return undefined
    return { node: { tag: "three", attrs: {}, content: "y" }, version: v, token: new Uint8Array(2) }
  }
  console.log((await build3(0)) === null, (await build3(1)) === undefined)
  const t = await build3(5)
  console.log(t === null || t === undefined ? "-" : t.node.tag)

  // THE CONTROL, one: the same body, SYNC. Compiled on base.
  function buildSync(v: number): Result | null {
    if (v === 0) return null
    return {
      node: { tag: "sync", attrs: {}, content: [{ tag: "leaf", attrs: { v: String(v) }, content: "z" }] },
      version: v,
      token: new Uint8Array(1),
    }
  }
  console.log(show(buildSync(0)), show(buildSync(4)))

  // THE CONTROL, two: async with NO union payload. Compiled on base.
  // eslint-disable-next-line @typescript-eslint/require-await
  async function buildTotal(v: number): Promise<Result> {
    return { node: { tag: "total", attrs: {}, content: "w" }, version: v, token: new Uint8Array(1) }
  }
  console.log((await buildTotal(2)).node.tag)

  // THE CONTROL, three: the literal hoisted to an annotated const, which is
  // where the value's type and the slot's agreed on base.
  // eslint-disable-next-line @typescript-eslint/require-await
  async function buildAnnotated(v: number): Promise<Result | null> {
    if (v === 0) return null
    const node: BNode = { tag: "annot", attrs: {}, content: "q" }
    return { node, version: v, token: new Uint8Array(1) }
  }
  const an = await buildAnnotated(6)
  console.log(an === null ? "null" : an.node.tag)

  // The rejection path is untouched by any of this.
  // eslint-disable-next-line @typescript-eslint/require-await
  async function boom(): Promise<Result | null> {
    throw new Error("nope")
  }
  try {
    await boom()
  } catch (e) {
    console.log("caught " + (e instanceof Error ? e.message : "?"))
  }
}

void main()
