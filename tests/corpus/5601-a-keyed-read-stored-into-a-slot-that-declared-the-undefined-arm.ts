// `firstEncType = child.attrs.type` — the ASSIGNMENT one line above the
// switch of 5600, in the same loop over the `<enc>` children of an inbound
// `<message>`, and the reason fixing the switch alone "changed nothing in
// a compiled binary".
//
// zapo `src/message/primitives/incoming.ts:538`:
//
//     let firstEncType: string | undefined
//     ...
//     if (firstEncType === undefined) {
//         firstEncType = child.attrs.type
//     }
//     ...
//     if (encCount > 1 && firstEncType === 'skmsg') { ...warn... }
//
// The slot DECLARES the undefined arm in so many words; the read that
// feeds it is the same index-signature read, spelled `string` because tsc
// types a signature read by its value type; the key is absent on a stanza
// that omits `type=`; the miss path is `scr_trap_fmt`. Node stores
// `undefined` and the function's own `firstEncType === 'skmsg'` answers it
// three statements later.
//
// WHY THIS DESTINATION HAD TO EARN IT. recordKeyReadAtUndefinedArm refuses
// declarations, assignments and property writes on purpose, and the reason
// is exact: tsc narrows `string | undefined` away AFTER an assignment, so
// a read on the statements that follow lowers to an UNCHECKED unionNarrow
// and a stored undefined becomes a silent wrong value — worse than the
// abort it replaced. That hazard is a property of the READS, not of
// assignment, so it is now checked instead of assumed: every reference to
// the assigned binding inside its enclosing function is asked what the
// checker believes AT THAT OCCURRENCE, and one read that has lost the
// undefined arm declines the whole assignment. Deliberately conservative —
// one narrowed read anywhere, in any branch, and the loud abort stays.
//
// Every `r0*` miss row below ABORTS the process on base.
//
// Dial: `SCRIPTC_ASSIGNARM_OFF=1` ablates it and every miss row aborts
// again, while the declining controls and every present-key row stay put.

type WaNode = { tag: string; attrs: Record<string, string> }

// -------------------------------------------------- the shape itself
function firstEnc(children: WaNode[]): string {
  let firstEncType: string | undefined
  let encCount = 0
  for (const child of children) {
    if (child.tag !== "enc") { continue }
    encCount += 1
    if (firstEncType === undefined) {
      firstEncType = child.attrs.type
    }
  }
  const warn = encCount > 1 && firstEncType === "skmsg" ? " order!" : ""
  return encCount + ":" + String(firstEncType) + warn
}

console.log("r00", firstEnc([{ tag: "enc", attrs: { type: "msg" } }]))
console.log("r01", firstEnc([{ tag: "enc", attrs: { v: "2" } }]))
console.log("r02", firstEnc([
  { tag: "enc", attrs: { type: "skmsg" } },
  { tag: "enc", attrs: { type: "msg" } },
]))
console.log("r03", firstEnc([
  { tag: "enc", attrs: { note: "no type" } },
  { tag: "enc", attrs: { type: "pkmsg" } },
]))

// -------------------------------------------------------- CONTROLS
// WHAT THE GATE COSTS, stated as programs rather than as a claim: tsc
// narrows an assignment to the declared type filtered by the type of the
// value assigned, so the very NEXT read of `v` after `v = attrs.v` is
// already spelled `string` — even when that read is `v === undefined` or
// `v ?? d`, whose whole point is the arm the narrow just removed. Every
// shape below therefore DECLINES, and a miss in any of them still aborts.
// The rung fires only where the checker itself still admits `undefined` at
// every read, which is what zapo's own spelling gives it: the store sits
// under `if (firstEncType === undefined)` inside a loop, so the back edge
// merges the arm straight back in before either later read.
//
// Every row here supplies the key, so a decline is observable only as
// "the answer is still exactly what it was".
function labelOf(attrs: Record<string, string>): string {
  let label: string | undefined
  label = attrs.label
  if (label === undefined) return "(none)"
  return label
}
console.log("r10", labelOf({ label: "hi" }))

function withDefault(attrs: Record<string, string>): string {
  let v: string | undefined
  v = attrs.v
  return v ?? "dflt"
}
console.log("r11", withDefault({ v: "yes" }))

function elemSpelling(attrs: Record<string, string>, k: string): string {
  let v: string | undefined
  v = attrs[k]
  return v === undefined ? "miss" : "hit:" + v
}
console.log("r12", elemSpelling({ a: "1" }, "a"))

// A later read that DEREFERENCES the value: the store would sit behind an
// unchecked narrow, which is the hazard the gate exists for.
function narrowedAfter(attrs: Record<string, string>): number {
  let t: string | undefined
  t = attrs.type
  return t.length
}
console.log("r13", narrowedAfter({ type: "msg" }), narrowedAfter({ type: "skmsg" }))

// A slot with NO undefined arm is not this rung's business at all.
function noArm(attrs: Record<string, string>): string {
  let t = "start"
  t = attrs.type
  return t
}
console.log("r14", noArm({ type: "abc" }))

// A DECLARATION is still a declaration — its own rungs decide it, not this
// one, and the answer they already gave must not move.
function declared(attrs: Record<string, string>): string {
  const t = attrs.type
  return t === undefined ? "miss" : "hit:" + t
}
console.log("r15", declared({ type: "q" }), declared({}))

// A narrow the checker PROVED with a test is sound, and the gate still
// declines it: it asks what the checker believes at each occurrence, not
// why, and `const a = v === undefined ? "u" : v` puts a `string`-narrowed
// read in the false arm. Conservative on purpose — one narrowed read
// anywhere keeps the abort. Present key, so the decline is invisible.
function provenNarrow(children: WaNode[]): string {
  let v: string | undefined
  for (const c of children) {
    if (v === undefined) { v = c.attrs.v }
  }
  const a = v === undefined ? "u" : v
  return a
}
console.log("r16", provenNarrow([{ tag: "enc", attrs: { v: "first" } }]))

// The firing shape carries an ordinary string through the same slot: a
// widening that lost the HIT would show up here.
function laterString(children: WaNode[]): string {
  let v: string | undefined
  for (const c of children) {
    if (v === undefined) { v = c.attrs.v }
  }
  const seen = String(v)
  return seen + "/" + String(v === undefined)
}
console.log("r17", laterString([{ tag: "enc", attrs: { v: "first" } }]), laterString([{ tag: "enc", attrs: {} }]))

console.log("r99 still running")
