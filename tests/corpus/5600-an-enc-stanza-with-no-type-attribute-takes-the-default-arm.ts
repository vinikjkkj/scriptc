// A `switch` over an index-signature keyed read: the author's own
// `default:` is the arm a missing key belongs in, and the process used to
// die one expression earlier instead.
//
// zapo `src/message/primitives/incoming.ts:541`:
//
//     for (const child of nodeContent) {
//         if (child.tag !== WA_MESSAGE_TAGS.ENC) { continue }
//         ...
//         switch (child.attrs.type) {
//             case 'skmsg': { ... break }
//             case 'msg':
//             case 'pkmsg': { ... break }
//             case 'msmsg': { ... break }
//             default:
//                 continue
//         }
//
// `child` is an `<enc>` element of an INBOUND `<message>` stanza and
// `child.attrs` is `Record<string, string>`. tsc types an index-signature
// read by the signature's VALUE type, so the discriminant is spelled
// `string`; a stanza that omits `type=` therefore reaches a keyed read
// whose miss path is `scr_trap_fmt` — a process ABORT, exit 127, with no
// [SCxxxx] tag on it and past every one of zapo's 206 catch clauses. Node
// evaluates `switch (undefined)`, matches no case, and takes `default`,
// which the author WROTE for exactly this input. The site executes on
// every paired run and survives only because the fake server always sends
// the attribute.
//
// Two things had to move. The discriminant reads at the undefined-armed
// width now (switchDiscAtUndefinedArm) — a switch discriminant STORES
// nothing and is read by nothing but its own case tests, every one of
// which already discriminates, so it is a keep-case in exactly the sense
// `??`'s right operand and `typeof` already were. And the union desugar
// learned that `case 'x': { ...; break }` ends in the same exit break as
// `case 'x': break` — braces are how a case body gets a scope for its
// `const`s, and all four of zapo's cases wear them.
//
// Every `r0*` miss row below ABORTS the process on base.
//
// Dials: `SCRIPTC_SWITCHARM_OFF=1` ablates the widening (every miss row
// aborts again); `SCRIPTC_CASEBRACE_OFF=1` ablates the braced-body half
// alone (the braced switches decline the widening and abort, the unbraced
// ones still take their default).

type WaNode = { tag: string; attrs: Record<string, string> }

// -------------------------------------- the shape, braces and all
function encKind(children: WaNode[]): string[] {
  const out: string[] = []
  for (const child of children) {
    if (child.tag !== "enc") { continue }
    switch (child.attrs.type) {
      case "skmsg": {
        out.push("group")
        break
      }
      case "msg":
      case "pkmsg": {
        const encType: "msg" | "pkmsg" = child.attrs.type === "msg" ? "msg" : "pkmsg"
        out.push(encType)
        break
      }
      case "msmsg": {
        out.push("bot")
        break
      }
      default:
        continue
    }
    out.push("|")
  }
  return out
}

console.log("r00", encKind([{ tag: "enc", attrs: { type: "msg" } }]).join(" "))
console.log("r01", encKind([{ tag: "enc", attrs: { v: "2" } }]).join(" "))
console.log("r02", encKind([{ tag: "enc", attrs: {} }]).join(" "))
console.log(
  "r03",
  encKind([
    { tag: "enc", attrs: { type: "skmsg" } },
    { tag: "enc", attrs: { note: "no type here" } },
    { tag: "enc", attrs: { type: "pkmsg" } },
  ]).join(" "),
)

// ------------------------------- the UNBRACED spelling, same question
function tagOf(attrs: Record<string, string>): string {
  switch (attrs.type) {
    case "a":
      return "A"
    case "b":
      return "B"
    default:
      return "?"
  }
}
console.log("r04", tagOf({ type: "a" }), tagOf({ type: "b" }), tagOf({ x: "1" }))

// --------------------------- a `default` that is NOT last in source
function defaultFirst(attrs: Record<string, string>): string {
  switch (attrs.k) {
    default:
      return "fallback"
    case "hit":
      return "hit"
  }
}
console.log("r05", defaultFirst({ k: "hit" }), defaultFirst({ k: "other" }), defaultFirst({}))

// ------------------------ NO default at all: JS falls straight out
function noDefault(attrs: Record<string, string>): string {
  let seen = "none"
  switch (attrs.type) {
    case "x": {
      seen = "X"
      break
    }
    case "y": {
      seen = "Y"
      break
    }
  }
  return seen
}
console.log("r06", noDefault({ type: "x" }), noDefault({ type: "y" }), noDefault({ z: "0" }))

// ------------------- a record with DECLARED fields plus a signature
type Stanza = { id: string; [k: string]: string }
function stanzaKind(s: Stanza): string {
  switch (s.type) {
    case "receipt": {
      return "receipt:" + s.id
    }
    default:
      return "other:" + s.id
  }
}
console.log("r07", stanzaKind({ id: "1", type: "receipt" }), stanzaKind({ id: "2" }))

// ------------------------------------------------------- CONTROLS
// A discriminant that is a PLAIN FIELD, not a keyed read: untouched.
type Typed = { kind: string }
function plainField(t: Typed): string {
  switch (t.kind) {
    case "one": {
      return "1"
    }
    default:
      return "?"
  }
}
console.log("r10", plainField({ kind: "one" }), plainField({ kind: "two" }))

// A NON-LITERAL case test declines the widening: `undefined` matching no
// case would then be a bet about a runtime value, not a fact about the
// program. The key is present on every row, so today's lowering answers.
const CASE_A = "alpha"
function nonLiteralTest(attrs: Record<string, string>): string {
  switch (attrs.type) {
    case CASE_A: {
      return "A"
    }
    default:
      return "?"
  }
}
console.log("r11", nonLiteralTest({ type: "alpha" }), nonLiteralTest({ type: "beta" }))

// FALL-THROUGH between bodies has no if/else shape, so the widening
// declines and the primitive switch keeps it. Present keys only.
function fallsThrough(attrs: Record<string, string>): string {
  let out = ""
  switch (attrs.type) {
    case "p":
      out += "P"
    case "q":
      out += "Q"
      break
    default:
      out += "?"
  }
  return out
}
console.log("r12", fallsThrough({ type: "p" }), fallsThrough({ type: "q" }), fallsThrough({ type: "z" }))

// A CONDITIONAL early break would rebind to an enclosing loop once the
// switch is a chain of ifs, so that declines too. Present keys only.
function earlyBreak(attrs: Record<string, string>): string {
  let out = ""
  switch (attrs.type) {
    case "e": {
      if (attrs.stop === "yes") { break }
      out += "E"
      break
    }
    default:
      out += "?"
  }
  return out
}
console.log("r13", earlyBreak({ type: "e", stop: "yes" }), earlyBreak({ type: "e", stop: "no" }), earlyBreak({ type: "f" }))

// A NUMERIC switch over a numeric signature is a different width and is
// not this rung's business; the key is present.
const codes: Record<string, number> = { ok: 200, gone: 410 }
function codeName(k: string): string {
  switch (codes[k]) {
    case 200: {
      return "ok"
    }
    case 410: {
      return "gone"
    }
    default:
      return "?"
  }
}
console.log("r14", codeName("ok"), codeName("gone"))

// Present keys everywhere, so a widening that lost the HIT is caught too.
console.log("r15", encKind([{ tag: "enc", attrs: { type: "msmsg" } }]).join(" "), tagOf({ type: "b" }))

// ------------------------------------------------------ SCOPES
// A braced case body is a SCOPE, exactly as in the real switch: the same
// `const` name in two bodies must not collide once both are if/else arms.
function twoConsts(a: Record<string, string>): string {
  let shared = "-"
  switch (a.type) {
    case "one": {
      const v = "1"
      shared = v
      break
    }
    case "two": {
      const v = "2"
      shared = v + shared
      break
    }
    default:
      shared = "d"
  }
  return shared
}
console.log("r16", twoConsts({ type: "one" }), twoConsts({ type: "two" }), twoConsts({ type: "zzz" }), twoConsts({}))

// And the switch's ONE shared clause-level scope is still one scope: a bare
// `let` in an unbraced clause is visible in the next clause.
function sharedScope(a: Record<string, string>): string {
  let out = ""
  switch (a.type) {
    case "a":
      let x = "A"
      out += x
      break
    case "b":
      out += "B"
      break
    default:
      out += "?"
  }
  return out
}
console.log("r17", sharedScope({ type: "a" }), sharedScope({ type: "b" }), sharedScope({}))

console.log("r99 still running")
