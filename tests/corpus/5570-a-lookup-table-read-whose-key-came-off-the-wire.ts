// A lookup TABLE read with a runtime key — the signature-free half of
// ABORT.real, and the author's own miss handler it used to pre-empt.
//
// tsc types an index-signature read by the signature's VALUE type, and the
// binding rules already widen that read so an absent key answers `undefined`
// (keyedReadLocalAtDynWidth for a scalar, keyedReadLocalAtUndefinedArm for a
// composite). Both rungs asked the shape for an INDEX SIGNATURE, because
// both were written for `Record<string, T>`.
//
// A signature-free record read with a RUNTIME key has the very same miss
// path: `recordKeyGetHelper` compares the declared fields and then traps.
// zapo has nineteen of the fifty-one ABORT.real call sites in exactly that
// shape, and two of them sit one line above the author's own handler:
//
//     const uploadPath = MEDIA_UPLOAD_PATHS[uploadType as keyof typeof MEDIA_UPLOAD_PATHS]
//     if (!uploadPath) { throw new Error(`unknown media upload type: ...`) }
//                                              client/messaging/messages.ts:725
//
//     const result = RETRY_PAYLOAD_ENC_TYPE_REVERSE[value as keyof typeof ...]
//     if (!result) { throw new Error(`invalid retry encrypted encType code`) }
//                                              retry/codec.ts:80
//
// `value` there is `readUint8(raw, offset, 'encType')` — a byte OFF THE
// WIRE. `as keyof typeof T` is an ASSERTION and not a proof: it is written
// exactly where membership is in doubt. Node runs the author's line and
// takes the author's branch; scriptc ABORTED the process one line earlier,
// past every catch clause, with no [SCxxxx] tag on it.
//
// Every `r0*` line below ABORTS on base with
// `scriptc: TypeError: record has no key '...'`.
//
// Dial: `SCRIPTC_TABLEARM_OFF=1` ablates the relaxation alone (the shape
// gate `keyedReadShapeOk`) and every miss row below aborts again, while the
// index-signature rows and every present-key control stay put.

// ---------------------------------------------- a SCALAR table (dyn width)
const MEDIA_UPLOAD_PATHS = { image: "/mms/image", video: "/mms/video", audio: "/mms/audio" }

function resolveUploadPath(uploadType: string): string {
  const uploadPath = MEDIA_UPLOAD_PATHS[uploadType as keyof typeof MEDIA_UPLOAD_PATHS]
  if (!uploadPath) {
    return "unknown:" + uploadType
  }
  return uploadPath
}
console.log("r01", resolveUploadPath("image"))
console.log("r02", resolveUploadPath("sticker"))

// the `=== undefined` spelling of the same question, on a NUMBER table
const RETRY_STATE_RANK = { pending: 0, delivered: 1, read: 2, played: 3 }

function rank(state: string): number {
  const r = RETRY_STATE_RANK[state as keyof typeof RETRY_STATE_RANK]
  return r === undefined ? -1 : r
}
console.log("r03", rank("read"), rank("ineligible"))

// typeof, the purest form of "is the key there at all"
function kindOf(state: string): string {
  const r = RETRY_STATE_RANK[state as keyof typeof RETRY_STATE_RANK]
  return typeof r
}
console.log("r04", kindOf("played"), kindOf("nope"))

// the wire-shaped one: a NUMERIC key decoded from a byte
const ENC_TYPE_REVERSE = { 1: "msg", 2: "pkmsg", 3: "skmsg" }

function decodeEncryptedType(value: number): string {
  const result = ENC_TYPE_REVERSE[value as keyof typeof ENC_TYPE_REVERSE]
  if (!result) {
    return "invalid:" + String(value)
  }
  return result
}
console.log("r05", decodeEncryptedType(2), decodeEncryptedType(9))

// ------------------------------------------- a COMPOSITE table (arm width)
interface Cfg {
  readonly code: number
  readonly dflt: string
}
const AB_PROP_CONFIGS: { readonly alpha: Cfg; readonly beta: Cfg } = {
  alpha: { code: 1, dflt: "a" },
  beta: { code: 2, dflt: "b" },
}

function configCode(name: string): number {
  const config = AB_PROP_CONFIGS[name as keyof typeof AB_PROP_CONFIGS]
  if (!config) {
    return -1
  }
  return config.code
}
console.log("r06", configCode("beta"), configCode("gamma"))

// the annotated composite declaration — the author wrote the arm down
function configDflt(name: string): string {
  const config: Cfg | undefined = AB_PROP_CONFIGS[name as keyof typeof AB_PROP_CONFIGS]
  if (config === undefined) {
    return "missing"
  }
  return config.dflt
}
console.log("r07", configDflt("alpha"), configDflt("gamma"))

// -------------------------------------------------- a BYTES table (arm width)
const HKDF_INFO = {
  image: new Uint8Array([1, 2]),
  video: new Uint8Array([3, 4]),
}

function hkdfLen(mediaType: string): number {
  const info = HKDF_INFO[mediaType as keyof typeof HKDF_INFO]
  if (!info) {
    return -1
  }
  return info.length
}
console.log("r08", hkdfLen("video"), hkdfLen("document"))

// ------------------------------- the `??` destination over the same table
function pathOr(uploadType: string): string {
  return MEDIA_UPLOAD_PATHS[uploadType as keyof typeof MEDIA_UPLOAD_PATHS] ?? "/mms/other"
}
console.log("r09", pathOr("audio"), pathOr("ptv"))

// ------------------------------------------------------------- CONTROLS
// A PROVEN key: `state` names exactly the declared fields, so the read can
// never miss and the widened width answers the value it always did.
type Known = "pending" | "delivered" | "read" | "played"
function rankKnown(state: Known): number {
  return RETRY_STATE_RANK[state]
}
console.log("r10", rankKnown("delivered"), rankKnown("played"))

// The INDEX-SIGNATURE half, which already worked: it must not move.
const attrs: Record<string, string> = { id: "yes" }
const a1 = attrs["nope"]
console.log("r11", a1 === undefined, typeof a1, !a1)
console.log("r12", attrs["id"], attrs["id"].length)

// A TUPLE keeps the array OOB policy and is not a table.
const pair: [string, number] = ["x", 7]
console.log("r13", pair[0], pair[1])

// Present keys everywhere, so a widening that lost the HIT is caught too.
console.log("r14", resolveUploadPath("video"), rank("pending"), decodeEncryptedType(1))
console.log("r15", configCode("alpha"), configDflt("beta"), hkdfLen("image"), pathOr("image"))

console.log("r99 still running")
