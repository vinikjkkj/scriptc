/* Structure-walking helper EMITTERS: interned per-type C helper functions
 * for JSON serialization, dyn matching/validation (dynCheck), dyn value
 * descriptions, and whole-union truthiness/equality. Each helper is emitted
 * once per type shape and cached in the emitter's registries (jsonWriters,
 * dynMatchers, dynBuilders, unionTruthyFns, unionEqFns, walkerProtos/Defs) —
 * interning ORDER is part of the emitted C, so the registries stay on
 * CEmitter and these functions only consult them through it. */
import type { CEmitter } from "./emitter.js";
import { rcSitesRequested } from "./emitter.js";
import { bytesAliasOnExtract } from "../../ir/nodes.js";
import { CLASS_PROPS_FIELD, armDiscrimLits, canAdaptDynFuncTo, canBoxClassIntoDyn, canBoxFuncIntoDyn, dynCheckArmOrder, internalSlotFields, isUndefinedArmedUnion, nullProtoRule, OWNMASK_SRC_NULL_PROTO, OWNMASK_VALID, ownMaskKeyBit, slotStorageKey, unionHasDiscrim, DYN_BYTES_KINDS, DYN_HANDLE_KINDS, IrType, isRefCounted, strandedFuncReason, typeEquals, typeKey } from "../../ir/nodes.js";
import { cDecl, cStringLiteral, cType, elemAccess, releaseCallC, retainCallC, vAdapters } from "./emit-types.js";
import { mangleClassStruct, mangleField, mangleRecordNew, mangleRecordStruct } from "../mangle.js";
import { KINDGATE_WIDE_KINDS, kindgateWideLane } from "../kindgate.js";
import { OVERFLOW_MEMBER, OWNMASK_MEMBER, SRCPROTO_MEMBER, TOSTR_MEMBER, nullProtoCondC, ownPresentCondC } from "./emit-shapes.js";

/** The refusal text a dyn-to-record check uses when the receiver carries
 * no INTERNAL SLOT for a field declaredOrder omits (internalSlotFields).
 *
 * It names the RECEIVER rather than the field on purpose. The field is
 * not a key: no program can see it, list it, or supply it, so "expected
 * number at $.%dtype" both leaked the reserved spelling into a
 * user-facing message and told the reader to add a key that would not
 * have helped. Node's answer to the same program is a TypeError as well
 * ("back.isFile is not a function"), so the two lanes agree in KIND;
 * the texts differ, which is the documented uncaught-report divergence.
 *
 * Both backends spell this one constant — llvm/dyn.ts imports it — so a
 * lane cannot invent its own wording. */
export const INTERNAL_SLOT_WANT_TEXT =
  "a value this runtime built (its internal state is missing)";
const INTERNAL_SLOT_WANT = cStringLiteral(Buffer.from(INTERNAL_SLOT_WANT_TEXT, "utf8"));

/** Can a record FIELD of this type end up holding a callable?
 *
 * Only such a field takes the binding member read (an inherited method
 * comes back bound to the receiver, +1); every other field keeps the
 * borrowed one, so the emitted TU pays two extra lines per callable
 * field and nothing anywhere else. Nested records and arrays are NOT
 * included on purpose: each has its own builder, which reads from its
 * own receiver and binds there.
 *
 * `dyn` ('unknown') is not included either, and that is a real gap
 * rather than a decision: an `unknown` field is retained as-is, so an
 * inherited method reached through one is still unbound. Calling it
 * needs a second cast, which lands on a func target with no receiver in
 * hand. Named in tests/fixtures/npm/cases/4061. */
function typeMayHoldFunc(E: CEmitter, t: IrType): boolean {
  if (t.kind === "func") return true;
  if (t.kind === "union") {
    const def = E.unionsById.get(t.unionId);
    return def ? def.arms.some((a) => a.kind === "func") : false;
  }
  return false;
}

/** The SCR_DYN_OBJINST boxing descriptor for one class:
 * `static const ScrDynClass sc_dcl_<n>` in the emitted TU, interned per
 * class name and referenced by address from the to-dyn converter.
 *
 * Every field is READ, not restated. `pre`/`post`/`hierarchy` come from
 * the emitter's ClassMeta — the same preorder numbering `instanceof`
 * compares against, so a box can never disagree with a static
 * `x instanceof C`; `retain`/`release` come from vAdapters, i.e. from
 * the rcAdapters table, so a boxed instance is torn down by exactly the
 * pair a container slot would have used (which for a hierarchy class
 * dispatches on the vtable, so a base-typed box still frees the derived
 * object). Nothing here is a second copy of a class fact.
 *
 * The runtime error hierarchy never reaches this — canBoxClassIntoDyn
 * keeps it on the error encoding — and the guard says so out loud rather
 * than emitting a descriptor the OUT direction would refuse to match. */
  export function dynClassDesc(E: CEmitter, className: string): string {
    const existing = E.dynClassDescs.get(className);
    if (existing) return existing;
    if (!canBoxClassIntoDyn(className)) {
      throw new Error(`emitter bug: dyn box descriptor for non-boxable class ${className}`);
    }
    const meta = E.classMeta.get(className);
    if (!meta) throw new Error(`emitter bug: dyn box descriptor for unknown class ${className}`);
    const name = `sc_dcl_${E.dynClassDescs.size}`;
    E.dynClassDescs.set(className, name);
    const rc = vAdapters({ kind: "object", className });
    const display = className.startsWith("%") ? className.slice(1) : className;
    // A static const with internal linkage, beside the walker prototypes:
    // emitStructDefs has already declared the `_v` thunks by then, and the
    // converters that take its address are emitted after.
    E.walkerProtos.push(
      `static const ScrDynClass ${name} = { ${cStringLiteral(Buffer.from(display, "utf8"))}, ` +
        `${meta.pre}, ${meta.post}, ${meta.hierarchy ? "true" : "false"}, ` +
        `&${rc.retain}, &${rc.release} }; /* dyn box: class ${className} */`,
    );
    return name;
  }

/** Short human description of a dynCheck target for error messages
   * ("expected number | string at $.items[2]"). Records read as "object" —
   * the path already says where; the full shape would bloat messages. */
  export function dynDesc(E: CEmitter, t: IrType): string {
    switch (t.kind) {
      case "f64":
        return "number";
      case "string":
        return "string";
      case "bool":
        return "boolean";
      case "record":
        // Tuples read as "array": that IS the JSON representation the
        // caller must supply (arity failures carry their own message).
        return E.recordsById.get(t.shapeId)?.tuple ? "array" : "object";
      case "array":
        return "array";
      case "nullT":
        return "null";
      // Reachable through optional-flavored record fields ("expected
      // string | undefined at $.a" — honest: the fix is a string value OR
      // omitting the key).
      case "undefinedT":
        return "undefined";
      // dyn fields accept any dyn value — only reachable in messages as a
      // sibling of a failing field, never as the failure itself.
      case "dyn":
        return "unknown";
      // "expected bigint at $.v, got number" — the typeof word, since a
      // bigint is a primitive with no class name to give.
      case "bigint":
        return "bigint";
      case "bytes": {
        const bk = DYN_BYTES_KINDS.get(t.elem);
        // The other element widths never reach a dynCheck target (the
        // predicates refuse them), so naming Uint8Array for them would
        // only ever mislead a future reader of this line.
        return bk ? bk.cls : "Uint8Array";
      }
      // A class target — the %Error extraction (an instanceof-Error
      // narrow / cast on an unknown value) or the instance box's
      // interval-checked unwrap: the failure names the class, like
      // caughtCheck's.
      case "object":
        return t.className.replace(/^%/, "");
      case "union": {
        const def = E.unionsById.get(t.unionId);
        if (!def) throw new Error(`emitter bug: dynDesc of unknown union ${t.unionId}`);
        return def.arms.map((a) => E.dynDesc(a)).join(" | ");
      }
      // Function targets (the checked-dynamic function boundary): the
      // failure names the expected callability, not the full signature —
      // the path already says where.
      case "func":
        return "function";
      // Map/Set-valued index signatures (Record<string, Map<K, V>>): only
      // reachable through the keyed-read miss trap's message — no dynCheck
      // ever expects one.
      case "map":
        return "Map";
      case "set":
        return "Set";
      default: {
        // Runtime HANDLE targets name the class ("expected
        // IncomingMessage at $, got string").
        const h = DYN_HANDLE_KINDS.get(t.kind);
        if (h) return h.cls;
        throw new Error(`emitter bug: dynDesc of non-JSON type ${t.kind}`);
      }
    }
  }

/** The per-union ToBoolean helper (interned per unionId): switch on the
   * runtime tag — unit arms false, f64 arms 0/NaN-falsy, string arms
   * empty-falsy, bool arms by payload, ref arms always true (JS objects),
   * jsval arms answered by the engine. Borrows the operand. */
  export function unionTruthyHelper(E: CEmitter, unionId: string): string {
    const existing = E.unionTruthyFns.get(unionId);
    if (existing) return existing;
    const def = E.unionsById.get(unionId);
    if (!def) throw new Error(`emitter bug: truthiness of unknown union ${unionId}`);
    const name = `sc_ut_${E.unionTruthyFns.size}`;
    E.unionTruthyFns.set(unionId, name);
    const sig = `static bool ${name}(ScrUnion *v)`;
    E.walkerProtos.push(`${sig}; /* ToBoolean ${unionId} */`);
    const d: string[] = [`${sig} { /* ToBoolean ${unionId} */`, `  switch (v->tag) {`];
    def.arms.forEach((arm, i) => {
      switch (arm.kind) {
        case "undefinedT":
        case "nullT":
          d.push(`  case ${i}: return false;`);
          break;
        case "f64":
          d.push(`  case ${i}: { double x = scr_union_get_f64(v); return x == x && x != 0; }`);
          break;
        case "bool":
          d.push(`  case ${i}: return scr_union_get_bool(v);`);
          break;
        case "string":
          d.push(`  case ${i}: return ((ScrStr *)scr_union_peek(v))->len != 0;`);
          break;
        case "jsval":
          d.push(`  case ${i}: return scr_jsval_truthy((ScrJsval *)scr_union_peek(v)) != 0;`);
          break;
        default:
          // Arrays, maps, sets, records, objects, functions, promises,
          // regexes, ...: JS objects are always truthy — [] and {} included.
          d.push(`  case ${i}: return true; /* ${arm.kind} */`);
      }
    });
    d.push(
      `  default: ${E.badTagAbortC()};`,
      `  }`,
      `}`,
      ``,
    );
    E.walkerDefs.push(...d);
    return name;
  }

/** The per-union strict-equality helper (interned per unionId, with a
   * separate SameValue variant per unionId when Object.is reaches it):
   * different tags are never equal; equal tags compare the arm values —
   * unit arms equal, f64 with C == (NaN !== NaN, +0 === -0) or SameValue
   * (NaN equals NaN, +0 differs from -0) under the sameValue flag,
   * strings by bytes, bools by value, ref arms by POINTER identity (JS
   * object equality). Borrows both operands. */
  export function unionEqHelper(E: CEmitter, unionId: string, sameValue: boolean): string {
    const key = sameValue ? `sv:${unionId}` : unionId;
    const existing = E.unionEqFns.get(key);
    if (existing) return existing;
    const def = E.unionsById.get(unionId);
    if (!def) throw new Error(`emitter bug: equality of unknown union ${unionId}`);
    const name = `sc_ue_${E.unionEqFns.size}`;
    E.unionEqFns.set(key, name);
    const what = sameValue ? "SameValue" : "strict equality";
    const sig = `static bool ${name}(ScrUnion *a, ScrUnion *b)`;
    E.walkerProtos.push(`${sig}; /* ${what} ${unionId} */`);
    const d: string[] = [
      `${sig} { /* ${what} ${unionId} */`,
      `  if (a->tag != b->tag) return false;`,
      `  switch (a->tag) {`,
    ];
    def.arms.forEach((arm, i) => {
      switch (arm.kind) {
        case "undefinedT":
        case "nullT":
          d.push(`  case ${i}: return true;`);
          break;
        case "f64":
          d.push(
            sameValue
              ? `  case ${i}: return scr_num_same_value(scr_union_get_f64(a), scr_union_get_f64(b));`
              : `  case ${i}: return scr_union_get_f64(a) == scr_union_get_f64(b);`,
          );
          break;
        case "bool":
          d.push(`  case ${i}: return scr_union_get_bool(a) == scr_union_get_bool(b);`);
          break;
        case "string":
          d.push(
            `  case ${i}: return scr_str_eq((ScrStr *)scr_union_peek(a), (ScrStr *)scr_union_peek(b));`,
          );
          break;
        default:
          // Ref arms: pointer identity, exactly JS object equality.
          d.push(`  case ${i}: return scr_union_peek(a) == scr_union_peek(b); /* ${arm.kind} */`);
      }
    });
    d.push(
      `  default: ${E.badTagAbortC()};`,
      `  }`,
      `}`,
      ``,
    );
    E.walkerDefs.push(...d);
    return name;
  }

/** The per-union ToString helper (interned per unionId): switch on the
   * runtime tag — unit arms return the interned "undefined"/"null" texts,
   * string arms retain the payload, f64/bool arms go through the JS-exact
   * formatters (String(x) semantics). Ref arms never arrive (the frontend
   * fences unions with object arms from string conversion — JS would print
   * "[object Object]"). Borrows the operand; the result is owned (+1). */
  export function unionToStrHelper(E: CEmitter, unionId: string): string {
    const existing = E.unionToStrFns.get(unionId);
    if (existing) return existing;
    const def = E.unionsById.get(unionId);
    if (!def) throw new Error(`emitter bug: ToString of unknown union ${unionId}`);
    const name = `sc_us_${E.unionToStrFns.size}`;
    E.unionToStrFns.set(unionId, name);
    const sig = `static ScrStr *${name}(ScrUnion *v)`;
    E.walkerProtos.push(`${sig}; /* ToString ${unionId} */`);
    const d: string[] = [`${sig} { /* ToString ${unionId} */`, `  switch (v->tag) {`];
    def.arms.forEach((arm, i) => {
      switch (arm.kind) {
        case "undefinedT":
        case "nullT": {
          const lit = E.internLiteral(arm.kind === "undefinedT" ? "undefined" : "null");
          d.push(`  case ${i}: return scr_str_retain((ScrStr *)&${lit});`);
          break;
        }
        case "string":
          d.push(`  case ${i}: return scr_str_retain((ScrStr *)scr_union_peek(v));`);
          break;
        case "f64":
          d.push(`  case ${i}: return scr_f64_to_scrstr(scr_union_get_f64(v));`);
          break;
        case "bool":
          d.push(`  case ${i}: return scr_bool_to_scrstr(scr_union_get_bool(v));`);
          break;
        case "bytes": {
          // Buffer.toString() IS the utf8 decode (Node's default
          // encoding) — the `Buffer | string` chunk idiom.
          const enc = E.internLiteral("utf8");
          d.push(`  case ${i}: return scr_bytes_to_str((ScrBytes *)scr_union_peek(v), (ScrStr *)&${enc});`);
          break;
        }
        case "record": {
          // A plain data record arm: the shape's HIDDEN per-instance
          // toString slot where it armed one, and Object.prototype
          // .toString's constant otherwise — the SAME branch the
          // LONE-record ToString takes (emit-exprs.ts's `toString` case),
          // which is what makes `${rec}` and `${num | rec}` answer alike.
          // The frontend admits an arm here only when the shape is not a
          // tuple and declares no `toString` FIELD, so the slot (or the
          // constant it defaults to) is the whole answer.
          //
          // This arm is why zapo's `Long.toString` was a refusal: the
          // helper is emitted from the union DEF alone and had no call in
          // it, so the METHOD spelling could not be admitted while the
          // conversion spelling folded the constant. One slot moves both.
          const shape = E.recordsById.get(arm.shapeId);
          if (shape?.tostr === true) {
            d.push(`  case ${i}: return scr_rec_tostr(((${mangleRecordStruct(arm.shapeId)} *)scr_union_peek(v))->${TOSTR_MEMBER});`);
            break;
          }
          const sym = E.internLiteral("[object Object]");
          d.push(`  case ${i}: return scr_str_retain((ScrStr *)&${sym});`);
          break;
        }
        default:
          throw new Error(`emitter bug: ToString of union with a ${arm.kind} arm (frontend fences these)`);
      }
    });
    d.push(
      `  default: ${E.badTagAbortC()};`,
      `  }`,
      `}`,
      ``,
    );
    E.walkerDefs.push(...d);
    return name;
  }

/** The per-union array-join helper (interned per unionId): Array.prototype
   * .join over union elements — undefined/null arms print EMPTY (exactly
   * JS's join, which silences only the nullish elements), every other arm
   * goes through the per-union ToString walker (string arms verbatim,
   * f64/bool via the JS-exact formatters). The frontend admits only unions
   * of f64/string/bool/unit arms here. Borrows the array and separator;
   * the result is owned (+1). */
  export function unionJoinHelper(E: CEmitter, unionId: string): string {
    const existing = E.unionJoinFns.get(unionId);
    if (existing) return existing;
    const def = E.unionsById.get(unionId);
    if (!def) throw new Error(`emitter bug: join of unknown union ${unionId}`);
    const name = `sc_uj_${E.unionJoinFns.size}`;
    E.unionJoinFns.set(unionId, name);
    const toStr = unionToStrHelper(E, unionId);
    const unitTags = def.arms.flatMap((a, i) =>
      a.kind === "undefinedT" || a.kind === "nullT" ? [i] : [],
    );
    const sig = `static ScrStr *${name}(ScrArr *a, ScrStr *sep)`;
    E.walkerProtos.push(`${sig}; /* join ${unionId} */`);
    E.walkerDefs.push(
      `${sig} { /* Array#join over ${unionId}: nullish arms print empty */`,
      `  ScrJsonBuf b;`,
      `  scr_jb_init(&b);`,
      `  size_t n = (size_t)scr_arr_len(a);`,
      `  for (size_t i = 0; i < n; i++) {`,
      `    if (i) for (size_t j = 0; j < sep->len; j++) scr_jb_putc(&b, sep->data[j]);`,
      `    ScrUnion *u = (ScrUnion *)scr_arr_get_ref(a, (double)i);`,
      ...(unitTags.length > 0
        ? [`    if (${unitTags.map((t) => `u->tag == ${t}`).join(" || ")}) { scr_union_release(u); continue; }`]
        : []),
      `    ScrStr *s = ${toStr}(u);`,
      `    for (size_t j = 0; j < s->len; j++) scr_jb_putc(&b, s->data[j]);`,
      `    scr_str_release(s);`,
      `    scr_union_release(u);`,
      `  }`,
      `  return scr_jb_finish(&b);`,
      `}`,
      ``,
    );
    return name;
  }

/** The dyn ToString helper pair (interned once, type-independent):
   * Node's String() over a dyn value — "undefined"/"null" texts, bools,
   * JS-exact number formatting (NaN/Infinity spelled out — NOT the JSON
   * null), strings verbatim, arrays via Array.prototype.toString (join
   * with ","; null/undefined ELEMENTS print empty, nested arrays flatten
   * through the recursion — JS-exact), plain objects as
   * "[object Object]". The operand is borrowed; the result is owned (+1). */
  export function dynToStrHelper(E: CEmitter): string {
    if (E.dynToStrFn) return E.dynToStrFn;
    const name = "sc_ds";
    E.dynToStrFn = name;
    E.walkerProtos.push(
      `static void ${name}_buf(ScrJsonBuf *b, const ScrDyn *d); /* String(unknown) walker */`,
      `static ScrStr *${name}(const ScrDyn *d); /* String(unknown) */`,
    );
    E.walkerDefs.push(
      `static void ${name}_buf(ScrJsonBuf *b, const ScrDyn *d) { /* String(unknown), recursive */`,
      `  switch (d->kind) {`,
      `  case SCR_DYN_UNDEF: scr_jb_puts(b, "undefined"); break;`,
      `  case SCR_DYN_NULL: scr_jb_puts(b, "null"); break;`,
      `  case SCR_DYN_BOOL: scr_jb_puts(b, d->v.b ? "true" : "false"); break;`,
      `  case SCR_DYN_NUM: {`,
      `    ScrStr *s = scr_f64_to_scrstr(d->v.num); /* String(n): NaN/Infinity spelled out, not JSON null */`,
      `    for (size_t i = 0; i < s->len; i++) scr_jb_putc(b, s->data[i]);`,
      `    scr_str_release(s);`,
      `    break;`,
      `  }`,
      `  case SCR_DYN_STR:`,
      `    for (size_t i = 0; i < d->v.str->len; i++) scr_jb_putc(b, d->v.str->data[i]);`,
      `    break;`,
      `  case SCR_DYN_ARR:`,
      `    /* Array.prototype.toString: join(",") — null/undefined ELEMENTS`,
      `     * print empty (unlike top level), nested arrays flatten. An`,
      `     * element's own toString can throw, and JS's join stops there:`,
      `     * the REMAINING elements' toStrings must not run, because they`,
      `     * are user code with side effects Node never executes. The`,
      `     * caller's pending check turns this into the real unwind. */`,
      `    for (size_t i = 0; i < d->v.arr.len; i++) {`,
      `      if (i > 0) scr_jb_putc(b, ',');`,
      `      const ScrDyn *e = d->v.arr.items[i];`,
      `      if (e->kind == SCR_DYN_UNDEF || e->kind == SCR_DYN_NULL) continue;`,
      `      ${name}_buf(b, e);`,
      `      if (scr_exc_pending()) return;`,
      `    }`,
      `    break;`,
      `  case SCR_DYN_OBJ: {`,
      `    /* Object.prototype.toString UNLESS the object's own members or`,
      `     * its PROTOTYPE CHAIN carry a callable toString — \`K.prototype`,
      `     * .toString = fn\` is where JS programs put one — and, failing`,
      `     * that, the checked-dynamic tree's error encoding, whose chain`,
      `     * reaches %Error.prototype% — so the "failing that" is really`,
      `     * Error.prototype.toString found the way JS finds it.`,
      `     * All three live in scr_dyn_to_string in that order, so this arm`,
      `     * DELEGATES rather than repeating any of them: this walker is a`,
      `     * per-program COPY of the runtime's ToString table and a copy`,
      `     * that answers a value differently from the original is one`,
      `     * value with two answers. The error pre-check that used to`,
      `     * sit HERE, ahead of the protocol, was exactly that`,
      `     * disagreement — a caught error carrying its own toString`,
      `     * answered the encoded form through String(e) and the toString`,
      `     * through e.toString(). A throw inside the protocol leaves the`,
      `     * exception pending and appends the empty string, the JSVAL`,
      `     * arm's convention. */`,
      `    ScrStr *s = scr_dyn_to_string(d, NULL);`,
      `    for (size_t i = 0; i < s->len; i++) scr_jb_putc(b, s->data[i]);`,
      `    scr_str_release(s);`,
      `    break;`,
      `  }`,
      `  case SCR_DYN_BYTES: {`,
      `    /* Buffer-flavored values (stream chunks) coerce utf8 (Node's`,
      `     * Buffer.toString); plain Uint8Array joins its elements. */`,
      `    if (d->buffer) {`,
      `      ScrStr *enc = scr_str_new("utf8", 4);`,
      `      ScrStr *txt = scr_bytes_to_str(d->v.bytes, enc);`,
      `      scr_str_release(enc);`,
      `      for (size_t i = 0; i < txt->len; i++) scr_jb_putc(b, txt->data[i]);`,
      `      scr_str_release(txt);`,
      `      break;`,
      `    }`,
      `    for (size_t i = 0; i < d->v.bytes->len; i++) {`,
      `      if (i > 0) scr_jb_putc(b, ',');`,
      `      char n[16];`,
      `      snprintf(n, sizeof n, "%u", (unsigned)d->v.bytes->data[i]);`,
      `      scr_jb_puts(b, n);`,
      `    }`,
      `    break;`,
      `  }`,
      `  case SCR_DYN_FUNC: {`,
      `    /* Function.prototype.toString answers the function's SOURCE`,
      `     * TEXT, which the box carries (fn.src) when the boxing site`,
      `     * could prove the value's creation site. This walker is a`,
      `     * per-program COPY of the runtime's ToString table and a copy`,
      `     * that answers differently from the original is one value with`,
      `     * two answers — so it delegates, exactly as the OBJ and HANDLE`,
      `     * arms do. Never NULL: a box that carries no honest answer`,
      `     * TRAPS inside the renderer rather than leaving a pending`,
      `     * exception this arm's caller would never check. */`,
      `    ScrStr *fs = scr_fn_to_string(d);`,
      `    for (size_t i = 0; i < fs->len; i++) scr_jb_putc(b, fs->data[i]);`,
      `    scr_str_release(fs);`,
      `    break;`,
      `  }`,
      `  case SCR_DYN_HANDLE: {`,
      `    /* Object.prototype.toString for the I/O classes`,
      `     * (IncomingMessage/ServerResponse/Socket), but RegExp owns its`,
      `     * own toString — so ask the runtime rather than repeating the`,
      `     * constant here. This walker is a per-program COPY of the`,
      `     * runtime's ToString table, and a copy that answers a kind`,
      `     * differently from the original is the same value giving two`,
      `     * answers depending on which spelling reached it: the OBJ arm`,
      `     * above already delegates for exactly that reason. */`,
      `    ScrStr *hs = scr_dyn_to_string(d, NULL);`,
      `    for (size_t i = 0; i < hs->len; i++) scr_jb_putc(b, hs->data[i]);`,
      `    scr_str_release(hs);`,
      `    break;`,
      `  }`,
      `  case SCR_DYN_OBJINST: {`,
      `    /* A class instance may OVERRIDE toString, and the box carries no`,
      `     * member table to dispatch the override through — so the honest`,
      `     * answer is the loud ladder, not "[object Object]". Delegated to`,
      `     * the runtime like the OBJ, HANDLE and FUNC arms: this walker is`,
      `     * a per-program COPY of the ToString table, and the copy having`,
      `     * no arm at all for a kind is how a value came out EMPTY here`,
      `     * while every other spelling threw. The throw is left pending,`,
      `     * the JSVAL arm's convention. */`,
      `    ScrStr *is = scr_dyn_to_string(d, NULL);`,
      `    for (size_t i = 0; i < is->len; i++) scr_jb_putc(b, is->data[i]);`,
      `    scr_str_release(is);`,
      `    break;`,
      `  }`,
      `  case SCR_DYN_PROMISE:`,
      `    /* Object.prototype.toString with the Promise @@toStringTag. */`,
      `    scr_jb_puts(b, "[object Promise]");`,
      `    break;`,
      `  case SCR_DYN_JSVAL:`,
      `    /* Island-held: the engine's own ToString (a bridged failure`,
      `     * leaves the exception pending and appends nothing). */`,
      `    scr_dyn_isl_tostr_buf(b, d);`,
      `    break;`,
      `  default:`,
      `    /* EVERY kind with no arm above — today SCR_DYN_ARRBUF, whose`,
      `     * answer is "[object ArrayBuffer]", and tomorrow whatever gets`,
      `     * appended to ScrDynKind next.`,
      `     *`,
      `     * This default is the point, more than the kind that prompted`,
      `     * it. The switch had none, so a kind the emitter did not know`,
      `     * about appended NOTHING and String(u) quietly answered "" —`,
      `     * while every other spelling of the same question threw or`,
      `     * printed. That is not a missing feature, it is one value with`,
      `     * two answers, and it went unnoticed because a silent wrong`,
      `     * answer has no symptom. A per-program COPY of the runtime's`,
      `     * ToString table must fall back to the ORIGINAL, never to`,
      `     * nothing; then the worst a forgotten kind can cost is the`,
      `     * inlining, not the semantics. */`,
      `    {`,
      `      ScrStr *ds = scr_dyn_to_string(d, NULL);`,
      `      for (size_t i = 0; i < ds->len; i++) scr_jb_putc(b, ds->data[i]);`,
      `      scr_str_release(ds);`,
      `    }`,
      `    break;`,
      `  }`,
      `}`,
      `static ScrStr *${name}(const ScrDyn *d) { /* String(unknown) -> owned (+1) */`,
      `  if (d->kind == SCR_DYN_STR) return scr_str_retain(d->v.str);`,
      `  ScrJsonBuf b;`,
      `  scr_jb_init(&b);`,
      `  ${name}_buf(&b, d);`,
      `  return scr_jb_finish(&b);`,
      `}`,
      ``,
    );
    return name;
  }

/** The caught→dyn converter (interned once, type-independent): a catch
   * binding flowing into an `unknown` slot — the typed→unknown deep-copy
   * stance over the exception snapshot's runtime kind. Scalar payloads
   * convert exactly; an Error-family OBJ payload becomes the checked-dynamic tree's error
   * encoding — Node's own shape: a [[Prototype]] link to %Error.prototype%
   * plus NON-ENUMERABLE `message` (and `name` only when it was assigned,
   * `code` enumerable like Node's system errors), so `instanceof Error`,
   * the %Error extraction, String() AND every enumeration surface answer
   * like Node; every other payload (REF — records, arrays,
   * closures, unions — and non-Error hierarchy objects, type-erased at
   * runtime) becomes an EMPTY dyn object (SEMANTICS.md 67). Borrows the
   * snapshot; the result is a fresh tree (+1). Never throws. */
  export function caughtToDynHelper(E: CEmitter): string {
    if (E.caughtToDynFn) return E.caughtToDynFn;
    const name = "sc_cd";
    E.caughtToDynFn = name;
    const sig = `static ScrDyn *${name}(const ScrCaught *c)`;
    E.walkerProtos.push(`${sig}; /* caught -> unknown */`);
    E.walkerDefs.push(
      `${sig} { /* caught -> unknown (+1, fresh tree) */`,
      `  switch (c->kind) {`,
      `  case SCR_EXC_F64: return scr_dyn_new_num(c->f64);`,
      `  case SCR_EXC_BOOL: return scr_dyn_new_bool(c->b);`,
      `  case SCR_EXC_STR: return scr_dyn_new_str((ScrStr *)c->payload); /* _new_str retains */`,
      `  case SCR_EXC_OBJ:`,
      `    if (scr_error_is(c->payload)) {`,
      `      /* The identity-cached crossing (scr_json.c): the SAME error`,
      `       * instance boxes to ONE dyn node however it crosses, so a`,
      `       * caught dyn compares reference-equal to the thrown error's`,
      `       * other boxings, like Node. */`,
      `      return scr_dyn_from_error((const ScrError *)c->payload);`,
      `    }`,
      `    /* FALLTHROUGH: a non-Error hierarchy object is type-erased */`,
      `  case SCR_EXC_REF:`,
      `    /* A thrown dyn value passes back BY REFERENCE (identity with`,
      `     * every other holder of the node — the traced-throw shape). */`,
      `    if (c->retain_fn == scr_dyn_retain_v) return scr_dyn_retain((ScrDyn *)c->payload);`,
      `    /* FALLTHROUGH */`,
      `  default:`,
      `    /* non-dyn REF and non-Error objects: the "[object Object]"`,
      `     * approximation — truthy, typeof "object", fields unreadable. */`,
      `    return scr_dyn_new_obj();`,
      `  }`,
      `}`,
      ``,
    );
    return name;
  }

/** The pretty-print re-indenter (interned once, type-independent):
   * `JSON.stringify(v, null, space)` output as a REWRITE of the compact
   * serializer text — Node's gap algorithm exactly. Structural '{'/'[' open
   * a newline + one-deeper indent (unless immediately closed: `{}` and `[]`
   * stay inline, like Node), '}'/']' close onto their own line at the outer
   * depth, ',' breaks the line at the current depth, and the key ':' gains
   * one space. String state (with escape skipping) keeps literal braces,
   * commas, and colons inside JSON strings untouched. Compact input is
   * BORROWED; the result is a fresh string (+1). An empty indent (space 0,
   * "", null) never reaches here — the frontend drops the property. */
  export function jsonIndentHelper(E: CEmitter): string {
    if (E.jsonIndentFn) return E.jsonIndentFn;
    const name = "sc_ji";
    E.jsonIndentFn = name;
    const sig = `static ScrStr *${name}(ScrStr *compact, const char *indent, size_t ilen)`;
    E.walkerProtos.push(`${sig}; /* stringify space re-indent */`);
    E.walkerDefs.push(
      `${sig} { /* stringify space re-indent (Node's gap algorithm) */`,
      `  ScrJsonBuf b;`,
      `  scr_jb_init(&b);`,
      `  const char *s = compact->data;`,
      `  size_t n = compact->len;`,
      `  size_t depth = 0;`,
      `  bool instr = false;`,
      `#define SCR_JI_INDENT() do { \\`,
      `    scr_jb_putc(&b, '\\n'); \\`,
      `    for (size_t td = 0; td < depth; td++) \\`,
      `      for (size_t tk = 0; tk < ilen; tk++) scr_jb_putc(&b, indent[tk]); \\`,
      `  } while (0)`,
      `  for (size_t i = 0; i < n; i++) {`,
      `    char c = s[i];`,
      `    if (instr) {`,
      `      scr_jb_putc(&b, c);`,
      `      if (c == '\\\\' && i + 1 < n) { scr_jb_putc(&b, s[++i]); }`,
      `      else if (c == '"') instr = false;`,
      `      continue;`,
      `    }`,
      `    switch (c) {`,
      `    case '"': instr = true; scr_jb_putc(&b, c); break;`,
      `    case '{': case '[':`,
      `      scr_jb_putc(&b, c);`,
      `      if (i + 1 < n && s[i + 1] == (c == '{' ? '}' : ']')) {`,
      `        scr_jb_putc(&b, s[++i]); /* empty {} / [] stay inline, like Node */`,
      `        break;`,
      `      }`,
      `      depth++;`,
      `      SCR_JI_INDENT();`,
      `      break;`,
      `    case '}': case ']':`,
      `      depth--;`,
      `      SCR_JI_INDENT();`,
      `      scr_jb_putc(&b, c);`,
      `      break;`,
      `    case ',':`,
      `      scr_jb_putc(&b, ',');`,
      `      SCR_JI_INDENT();`,
      `      break;`,
      `    case ':':`,
      `      scr_jb_putc(&b, ':');`,
      `      scr_jb_putc(&b, ' ');`,
      `      break;`,
      `    default:`,
      `      scr_jb_putc(&b, c);`,
      `    }`,
      `  }`,
      `#undef SCR_JI_INDENT`,
      `  return scr_jb_finish(&b);`,
      `}`,
      ``,
    );
    return name;
  }

export function jsonWriteHelper(E: CEmitter, t: IrType): string {
    const key = typeKey(t);
    const existing = E.jsonWriters.get(key);
    if (existing) return existing;
    const name = `sc_jw_${E.jsonWriters.size}`;
    E.jsonWriters.set(key, name);
    const sig = `static void ${name}(ScrJsonBuf *b, ${cDecl(t, "v")})`;
    E.walkerProtos.push(`${sig}; /* stringify ${key} */`);
    const d: string[] = [`${sig} { /* stringify ${key} */`];
    switch (t.kind) {
      case "f64":
        d.push(`  scr_jb_put_f64(b, v); /* NaN/Infinity -> null, -0 -> 0, like JS */`);
        break;
      case "bool":
        d.push(`  scr_jb_puts(b, v ? "true" : "false");`);
        break;
      case "string":
        d.push(`  scr_jb_put_json_str(b, v);`);
        break;
      case "record": {
        const shape = E.recordsById.get(t.shapeId);
        if (!shape) throw new Error(`emitter bug: jsonStringify of unknown shape ${t.shapeId}`);
        // CYCLE-CAPABLE shapes (recursive record types — the collector-
        // fixpoint set) bracket the walk with the circular-detection
        // stack: a value already being serialized above throws V8's exact
        // circular-structure TypeError (scr_jb_enter). Edge labels stamp
        // only before members whose walk can re-enter (cycle-capable
        // types); acyclic shapes pay nothing.
        const cyclic = E.traceAdapterC(t) !== null;
        const edgeable = (ft: IrType): boolean => cyclic && E.traceAdapterC(ft) !== null;
        if (cyclic) d.push(`  if (!scr_jb_enter(b, v, ${shape.tuple ? "true" : "false"})) return; /* circular: pending TypeError */`);
        // A tuple serializes as a JSON ARRAY in index order — JS-exact
        // (JSON.stringify(["a", 1]) is `["a",1]`). Every position is
        // required, so labels/commas are static like all-required records.
        if (shape.tuple) {
          const byIndex = [...shape.fields].sort((a, b) => Number(a.name) - Number(b.name));
          d.push(`  scr_jb_putc(b, '[');`);
          byIndex.forEach((f, i) => {
            if (i > 0) d.push(`  scr_jb_putc(b, ',');`);
            if (edgeable(f.type)) d.push(`  scr_jb_edge_idx(b, ${i});`);
            d.push(`  ${E.jsonWriteHelper(f.type)}(b, v->${mangleField(f.name)});`);
          });
          d.push(`  scr_jb_putc(b, ']');`);
          if (cyclic) d.push(`  scr_jb_leave(b);`);
          break;
        }
        // Fields serialize in DECLARED order — JS insertion order, exactly
        // Node for objects constructed in declaration order (SEMANTICS.md
        // 36 documents the divergence when they are not) — never the
        // canonical (sorted) struct order. declaredOrder may omit internal
        // '%'-fields (Dirent's %dtype): those are hidden from JSON exactly
        // like every other key-order surface. Shapes interned WITHOUT an
        // order (the CJS export-table literal, accessor-narrowed JS
        // shapes) keep the canonical order — their construction paths
        // document the divergence.
        const order = shape.declaredOrder ?? shape.fields.map((f) => f.name);
        const inOrder = new Set(order);
        if (shape.fields.some((f) => !inOrder.has(f.name) && !f.name.startsWith("%"))) {
          throw new Error(`emitter bug: declaredOrder of shape ${t.shapeId} omits a non-internal field`);
        }
        const byName = new Map(shape.fields.map((f) => [f.name, f]));
        const emitFields = order.map((n) => byName.get(n)).filter((f) => f !== undefined);
        // Optional-flavored fields (undefined-armed unions) DROP from the
        // output while they hold the undefined arm — exactly Node — so as
        // soon as one exists, comma placement turns dynamic (a `first`
        // flag); all-required shapes keep the static prefix labels. An
        // overflow portion forces the dynamic path too (entry count is
        // runtime state).
        // An ARMED shape is droppable by construction: any member can turn
        // out not to have been the source object's own key.
        const droppable =
          emitFields.some((f) => E.undefinedArmTag(f.type) >= 0) ||
          !!shape.indexValue ||
          shape.ownmask === true;
        d.push(`  scr_jb_putc(b, '{');`);
        if (!droppable) {
          emitFields.forEach((f, i) => {
            const label = cStringLiteral(Buffer.from(`${i > 0 ? "," : ""}"${f.name}":`, "utf8"));
            d.push(`  scr_jb_puts(b, ${label});`);
            if (edgeable(f.type)) d.push(`  scr_jb_edge_prop(b, ${cStringLiteral(Buffer.from(f.name, "utf8"))});`);
            // Refcounted fields are BORROWED straight off the struct (the
            // record itself is borrowed for the whole call).
            d.push(`  ${E.jsonWriteHelper(f.type)}(b, v->${mangleField(f.name)});`);
          });
        } else {
          d.push(`  bool first = true;`);
          for (const f of emitFields) {
            const label = cStringLiteral(Buffer.from(`"${f.name}":`, "utf8"));
            const utag = E.undefinedArmTag(f.type);
            // The own-key question, one spelling: an undefined-valued
            // field drops like Node, and on a shape a crossing wrote, so
            // does a member the source object only INHERITED.
            const cond = ownPresentCondC(shape, f.name, "v", utag, true);
            const pad = cond !== null ? "    " : "  ";
            if (cond !== null) {
              d.push(`  if (${cond}) { /* not an own key of the value: dropped, like Node */`);
            }
            d.push(`${pad}if (!first) scr_jb_putc(b, ',');`);
            d.push(`${pad}first = false;`);
            d.push(`${pad}scr_jb_puts(b, ${label});`);
            if (edgeable(f.type)) d.push(`${pad}scr_jb_edge_prop(b, ${cStringLiteral(Buffer.from(f.name, "utf8"))});`);
            d.push(`${pad}${E.jsonWriteHelper(f.type)}(b, v->${mangleField(f.name)});`);
            if (cond !== null) d.push(`  }`);
          }
          // Overflow entries follow the declared fields, themselves in JS
          // OWN-KEY order — integer-like keys ascending first, then the
          // rest in insertion order (scr_map_keys_js_order, the same
          // enumeration Object.keys answers; number-keyed signatures make
          // integer-like overflow keys ordinary). SEMANTICS.md documents
          // the declared-canonical-then-overflow divergence from JS's one
          // interleaved key order. Keys escape like any JSON string;
          // undefined-valued entries drop, exactly the optional-field rule.
          if (shape.indexValue) {
            const iv = shape.indexValue;
            const m = `v->${OVERFLOW_MEMBER}`;
            d.push(`  {`);
            d.push(`    ScrArr *ks = scr_map_keys_js_order(${m});`);
            d.push(`    for (size_t i = 0; i < ks->len; i++) {`);
            d.push(`      ScrStr *k = (ScrStr *)scr_arr_get_ref(ks, (double)i);`);
            if (iv.kind === "f64" || iv.kind === "bool") {
              d.push(`      ${cDecl(iv, "e")} = 0;`);
              d.push(`      scr_map_get_str_${iv.kind === "f64" ? "f64" : "bool"}(${m}, k, &e);`);
            } else {
              d.push(`      ${cDecl(iv, "e")} = (${cType(iv).trim()})scr_map_get_str_ref(${m}, k);`);
            }
            const skipUndef =
              iv.kind === "dyn"
                ? `e->kind == SCR_DYN_UNDEF`
                : E.undefinedArmTag(iv) >= 0
                  ? `e->tag == ${E.undefinedArmTag(iv)}`
                  : null;
            if (skipUndef) {
              d.push(`      if (${skipUndef}) { /* undefined-valued entry: dropped, like Node */`);
              d.push(`        ${releaseCallC(iv, "e")};`);
              d.push(`        scr_str_release(k);`);
              d.push(`        continue;`);
              d.push(`      }`);
            }
            d.push(`      if (!first) scr_jb_putc(b, ',');`);
            d.push(`      first = false;`);
            d.push(`      scr_jb_put_json_str(b, k);`);
            d.push(`      scr_jb_putc(b, ':');`);
            if (edgeable(iv)) d.push(`      scr_jb_edge_key(b, k);`);
            d.push(`      ${E.jsonWriteHelper(iv)}(b, e);`);
            d.push(`      scr_str_release(k);`);
            if (isRefCounted(iv)) d.push(`      ${releaseCallC(iv, "e")};`);
            d.push(`    }`);
            d.push(`    scr_arr_release(ks);`);
            d.push(`  }`);
          }
        }
        d.push(`  scr_jb_putc(b, '}');`);
        if (cyclic) d.push(`  scr_jb_leave(b);`);
        break;
      }
      case "dyn":
        // Overflow values under an `unknown` index signature: the checked-dynamic tree
        // serializes itself (runtime walker) — object members holding
        // undefined drop, array slots holding undefined print null,
        // exactly Node. Bare JSON.stringify of dyn stays frontend-fenced;
        // this writer is reachable only through overflow entries.
        d.push(`  scr_jb_put_dyn(b, v);`);
        break;
      case "array": {
        const elem = t.elem;
        const w = E.jsonWriteHelper(elem);
        // A cycle-capable array (elements can point back at it) joins the
        // circular-detection stack exactly like a cycle-capable record.
        const cyclic = E.traceAdapterC(t) !== null;
        if (cyclic) d.push(`  if (!scr_jb_enter(b, v, true)) return; /* circular: pending TypeError */`);
        d.push(`  scr_jb_putc(b, '[');`);
        d.push(`  for (size_t i = 0; i < v->len; i++) {`);
        d.push(`    if (i > 0) scr_jb_putc(b, ',');`);
        if (cyclic) d.push(`    scr_jb_edge_idx(b, i);`);
        if (elem.kind === "f64") {
          d.push(`    ${w}(b, scr_arr_get_f64(v, (double)i));`);
        } else if (elem.kind === "bool") {
          d.push(`    ${w}(b, scr_arr_get_bool(v, (double)i));`);
        } else {
          // _get_ref returns +1; release after writing.
          d.push(`    ${cDecl(elem, "e")} = (${cType(elem).trim()})scr_arr_get_ref(v, (double)i);`);
          d.push(`    ${w}(b, e);`);
          d.push(`    ${releaseCallC(elem, "e")};`);
        }
        d.push(`  }`);
        d.push(`  scr_jb_putc(b, ']');`);
        if (cyclic) d.push(`  scr_jb_leave(b);`);
        break;
      }
      case "union": {
        const def = E.unionsById.get(t.unionId);
        if (!def) throw new Error(`emitter bug: jsonStringify of unknown union ${t.unionId}`);
        d.push(`  switch (v->tag) {`);
        def.arms.forEach((arm, i) => {
          if (arm.kind === "nullT") {
            // Payload-less arm: JSON.stringify(null) is the text `null`,
            // exactly like Node.
            d.push(`  case ${i}: scr_jb_puts(b, "null"); break;`);
            return;
          }
          if (arm.kind === "undefinedT") {
            // Reachable only as a record FIELD's serializer (bare
            // undefined-armed unions are fenced from stringify), and the
            // record writer drops the field while it holds this tag before
            // calling — so the tag can never arrive here.
            d.push(`  case ${i}: /* undefined arm: the field dropped at the record level */`);
            d.push(`    ${E.stringifyUndefAbortC()};`);
            return;
          }
          const w = E.jsonWriteHelper(arm);
          if (arm.kind === "f64") {
            d.push(`  case ${i}: ${w}(b, scr_union_get_f64(v)); break;`);
          } else if (arm.kind === "bool") {
            d.push(`  case ${i}: ${w}(b, scr_union_get_bool(v)); break;`);
          } else {
            // Payload is BORROWED out of the box for the write.
            d.push(`  case ${i}: ${w}(b, (${cType(arm).trim()})scr_union_peek(v)); break;`);
          }
        });
        d.push(`  default: ${E.badTagAbortC()};`);
        d.push(`  }`);
        break;
      }
      default:
        throw new Error(`emitter bug: jsonStringify of non-JSON type ${t.kind}`);
    }
    d.push(`}`, ``);
    E.walkerDefs.push(...d);
    return name;
  }

/** The emitted match predicate for one dynCheck target type:
   * `static bool sc_dm_<n>(const ScrDyn *d)` — does this dyn fit T?
   * Never throws, builds nothing; union builders use it to try arms in
   * canonical order (first FULL match wins). Records are width-tolerant
   * here too: extra keys are ignored, only declared fields are examined. */
  export function dynMatchHelper(E: CEmitter, t: IrType): string {
    const key = typeKey(t);
    const existing = E.dynMatchers.get(key);
    if (existing) return existing;
    const name = `sc_dm_${E.dynMatchers.size}`;
    E.dynMatchers.set(key, name);
    const sig = `static bool ${name}(const ScrDyn *d)`;
    E.walkerProtos.push(`${sig}; /* matches ${key} */`);
    const d: string[] = [`${sig} { /* matches ${key} */`];
    switch (t.kind) {
      case "f64":
        d.push(`  return d->kind == SCR_DYN_NUM;`);
        break;
      case "string":
        d.push(`  return d->kind == SCR_DYN_STR;`);
        break;
      case "bool":
        d.push(`  return d->kind == SCR_DYN_BOOL;`);
        break;
      case "nullT":
        // JSON null matches exactly the nullT arm (reachable only as a
        // union-arm matcher — bare null is not a valid dynCheck target).
        d.push(`  return d->kind == SCR_DYN_NULL;`);
        break;
      case "undefinedT":
        // JSON text never parses to undefined, but the checked-dynamic tree can HOLD it now
        // (overflow reads/conversions under `unknown` index signatures):
        // the undefined dyn value matches exactly the undefined arm.
        d.push(`  return d->kind == SCR_DYN_UNDEF;`);
        break;
      case "dyn":
        // An `unknown` target: every dyn value fits, undefined included.
        d.push(`  (void)d;`);
        d.push(`  return true;`);
        break;
      case "bigint":
        // A KIND test, and a sound one for the reason the bytes arm
        // below spells out: bigint is its OWN kind, so no other value
        // can wear its tag. Riding SCR_DYN_NUM with a flag — the cheap
        // alternative — would have let a plain 5 match a `bigint` arm of
        // `bigint | number`, and the union would then have carried a
        // double under a bigint tag.
        d.push(`  return d->kind == SCR_DYN_BIG;`);
        break;
      case "bytes": {
        // A KIND test, and it is a sound one again only because the two
        // admitted element kinds are two kinds. While `bytes<buf>` was
        // going to ride SCR_DYN_BYTES with an element tag, this line was
        // the sharpest hazard in the whole change: an `ArrayBuffer` arm
        // would have matched a `Uint8Array` value, the union would have
        // taken the ArrayBuffer tag, and every later read of it would
        // have been confidently wrong. Distinct kinds make the obvious
        // test the correct one.
        const bk = DYN_BYTES_KINDS.get(t.elem);
        if (!bk) throw new Error(`emitter bug: dynMatch of bytes<${t.elem}>`);
        d.push(`  return d->kind == ${bk.kind};`);
        break;
      }
      case "record": {
        const shape = E.recordsById.get(t.shapeId);
        if (!shape) throw new Error(`emitter bug: dynCheck of unknown shape ${t.shapeId}`);
        // A tuple matches a JSON ARRAY of EXACTLY its arity whose elements
        // match positionally (arity is part of the type — width tolerance
        // is an object-key concept and does not apply).
        if (shape.tuple) {
          const byIndex = [...shape.fields].sort((a, b) => Number(a.name) - Number(b.name));
          d.push(`  if (d->kind != SCR_DYN_ARR || d->v.arr.len != ${byIndex.length}) return false;`);
          byIndex.forEach((f, i) => {
            d.push(`  if (!${E.dynMatchHelper(f.type)}(d->v.arr.items[${i}])) return false;`);
          });
          d.push(`  return true;`);
          break;
        }
        d.push(`  if (d->kind != SCR_DYN_OBJ) return false;`);
        // dyn ('unknown') fields match ANY value, present or missing (a
        // missing key builds the undefined dyn value) — no test to emit.
        if (shape.fields.some((f) => f.type.kind !== "dyn")) d.push(`  const ScrDyn *m;`);
        const matchInternal = new Set(internalSlotFields(shape));
        for (const f of shape.fields) {
          if (f.type.kind === "dyn") continue;
          const keyLit = cStringLiteral(Buffer.from(f.name, "utf8"));
          const keyLen = Buffer.byteLength(f.name, "utf8");
          // An INTERNAL SLOT is not a key, so the predicate asks the slot
          // table — the same question the builder asks, so the two cannot
          // disagree about which values are of this shape.
          if (matchInternal.has(f.name)) {
            // ...under its STORAGE key, which is the Node symbol
            // description when the shape names one (slotStorageKey).
            const sk = slotStorageKey(shape, f.name);
            const slotLit = cStringLiteral(Buffer.from(sk, "utf8"));
            const slotLen = Buffer.byteLength(sk, "utf8");
            d.push(`  m = scr_dyn_obj_slot_get(d, ${slotLit}, ${slotLen}); /* internal slot */`);
            d.push(`  if (!m || !${E.dynMatchHelper(f.type)}(m)) return false;`);
            continue;
          }
          // JS's [[Get]] minus accessors: own data, else the prototype
          // chain. An own-only read made every INHERITED member invisible
          // to the predicate, so a class instance never matched a record
          // arm that named one of its methods — the shape protobufjs's
          // Long has, and the shape every JS class has.
          d.push(`  m = scr_dyn_obj_data_get(d, ${keyLit}, ${keyLen});`);
          if (E.undefinedArmTag(f.type) >= 0) {
            // Optional-flavored field: a MISSING key is the undefined arm
            // (a match); a PRESENT key must fit the union as usual.
            d.push(`  if (m && !${E.dynMatchHelper(f.type)}(m)) return false;`);
          } else {
            d.push(`  if (!m || !${E.dynMatchHelper(f.type)}(m)) return false;`);
          }
        }
        // Index-signature shapes: UNDECLARED keys must fit the overflow
        // value type (the builder CAPTURES them — width tolerance became
        // width capture). A dyn value type accepts anything; concrete
        // types check every extra entry.
        if (shape.indexValue && shape.indexValue.kind !== "dyn") {
          const skip = shape.fields
            .map((f) => {
              const keyLit = cStringLiteral(Buffer.from(f.name, "utf8"));
              const keyLen = Buffer.byteLength(f.name, "utf8");
              return `(e->key_len == ${keyLen} && memcmp(e->key, ${keyLit}, ${keyLen}) == 0)`;
            })
            .join(" || ");
          d.push(`  for (size_t i = 0; i < d->v.obj.len; i++) {`);
          d.push(`    const ScrDynEntry *e = &d->v.obj.entries[i];`);
          if (shape.fields.length > 0) d.push(`    if (${skip}) continue;`);
          d.push(`    if (!${E.dynMatchHelper(shape.indexValue)}(e->value)) return false;`);
          d.push(`  }`);
        }
        d.push(`  return true;`);
        break;
      }
      case "array": {
        const m = E.dynMatchHelper(t.elem);
        d.push(`  if (d->kind != SCR_DYN_ARR) return false;`);
        d.push(`  for (size_t i = 0; i < d->v.arr.len; i++) {`);
        d.push(`    if (!${m}(d->v.arr.items[i])) return false;`);
        d.push(`  }`);
        d.push(`  return true;`);
        break;
      }
      case "union": {
        const def = E.unionsById.get(t.unionId);
        if (!def) throw new Error(`emitter bug: dynCheck of unknown union ${t.unionId}`);
        // The undefined arm participates: parsed JSON never contains
        // undefined (a MISSING record key was the arm's only source), but
        // the checked-dynamic tree can hold the undefined value now — overflow entries
        // under `unknown` index signatures — and it matches exactly the
        // undefined arm.
        const arms = def.arms.map((a) => `${E.dynMatchHelper(a)}(d)`);
        d.push(`  return ${arms.join(" || ")};`);
        break;
      }
      case "func": {
        // The FUNCTION leaf (a callable record field — the protobuf
        // Long's `toNumber`, a codec's `Reader`). The checked-dynamic
        // tree's function box carries the interned typeKey of the type it
        // was boxed FROM, so "is this dyn a T?" has an exact answer and
        // this asks for exactly that: the identical signature.
        //
        // dynCheckHelper's func builder is more permissive — it will also
        // wrap a DIFFERENT signature in the per-target adapter — and the
        // narrower rule here is deliberate, in both directions that
        // matter:
        //   * match still implies the builder succeeds (the builder's
        //     first branch IS this strcmp), which is the invariant the
        //     union builder relies on: "the matched arm's builder can no
        //     longer fail".
        //   * discrimination stays honest. Matching on callable-KIND
        //     alone would make every function fit every function arm, so
        //     `{a: () => number} | {a: () => string}` would take arm 0 for
        //     a string-returning value and only throw later, inside the
        //     adapter, with the union already wearing the wrong tag. The
        //     signature test picks the arm the value actually is.
        const sigLit = cStringLiteral(Buffer.from(key, "utf8"));
        d.push(`  if (d->kind != SCR_DYN_FUNC) return false;`);
        d.push(`  return strcmp(d->v.fn.sig, ${sigLit}) == 0;`);
        break;
      }
      case "map":
      case "set": {
        // The MAP box's matcher, and it is the FUNC arm's argument
        // verbatim: a kind test alone is NOT sound here, because ScrMap
        // names no IR type. `Map<string, number>` and `Set<string>` are
        // the SAME scr_map_new call — SCR_MAP_KEY_STR, SCR_MAP_VAL_F64,
        // all three RC hooks NULL — so a kind-only match would give a
        // union the wrong tag for two values JS does not even give the
        // same methods. The box carries the interned typeKey precisely so
        // this line can be an exact test.
        const tkeyLit = cStringLiteral(Buffer.from(key, "utf8"));
        d.push(`  if (d->kind != SCR_DYN_MAP) return false;`);
        d.push(`  return strcmp(d->v.map.tkey, ${tkeyLit}) == 0;`);
        break;
      }
      case "object": {
        // "Is this dyn an instance of C?" — the SAME preorder-interval
        // test `x instanceof C` compiles to, asked of the box's instance
        // rather than of a static pointer. A hierarchy class reads the
        // instance's OWN vtable inside the runtime helper, so a box made
        // from a base-typed slot still matches the derived arm; a
        // standalone class has no subclasses and matches only itself.
        //
        // %Error keeps the checked-dynamic tree's ERROR ENCODING, so it
        // gets its own arm rather than an interval: scr_dyn_is_error_encoding,
        // which is EXACTLY the test dynCheckHelper's %Error branch performs.
        // Match and check ask the same question, so no union arm can be
        // matched here and then fail to build below — the property the
        // union builder relies on.
        // Before the nested %Error leaf was admitted this line threw
        // "dynMatch of unknown class %Error", because classMeta has no
        // entry for it; a leaf admitted by the predicate and unemittable
        // here would have traded a fence for an emitter crash.
        //
        // The test used to be spelled INLINE, as a lookup of the reserved
        // key "%error" — here, in the dynCheck branch below, and twice
        // more in the LLVM lane. Four copies of a question whose answer
        // was wrong in both directions (a user's own "%error" key passed
        // it; the marker it looked for was an own ENUMERABLE property of
        // every error the program could enumerate) is why it is now one
        // runtime call that the C and LLVM lanes both emit.
        if (t.className === "%Error") {
          d.push(`  return scr_dyn_is_error_encoding(d);`);
          break;
        }
        const meta = E.classMeta.get(t.className);
        if (!meta) throw new Error(`emitter bug: dynMatch of unknown class ${t.className}`);
        // The descriptor is interned here as well as at the to-dyn site:
        // a program may narrow to a class it never widens FROM (an arm
        // matched out of a union it received), and the accounting stays
        // per class either way.
        E.dynClassDesc(t.className);
        d.push(`  return scr_dyn_objinst_is(d, ${meta.pre}, ${meta.post});`);
        break;
      }
      default:
        throw new Error(`emitter bug: dynMatch of non-JSON type ${t.kind}`);
    }
    d.push(`}`, ``);
    // SCRIPTC_KINDGATE_MATCH does NOT live here any more, and where it went
    // is the whole point. Before `block/matcherbuild` merged the matcher
    // into the builder, widening arm selection meant widening THIS function
    // and widening the builder meant editing a different one, so the two
    // halves of the trade were two edits in two places. On the merged shape
    // the arm decision is dynWalkerBody's SOFT body, so the control is one
    // boolean there (`soft ? E.kindgateMatch : E.kindgateWide`) and this
    // generator is left exactly as it was. Only 3 matchers survive on the C
    // lane at all -- the may-hold-a-function member decision, where the raw
    // read and the bound value genuinely differ -- and widening those is not
    // what "widen the matcher" means.
    E.walkerDefs.push(...d);
    return name;
  }

/** The emitted keyed read on a dyn value:
   * `static ScrDyn *sc_dyn_key_get(ScrDyn *d, ScrStr *k, bool opt)` —
   * OBJ answers the member (+1) or the undefined singleton (own-property
   * answer); ARR answers `length` and canonical in-range indices, STR
   * answers `length` (UTF-16-exact via scr_str_utf16_len), both
   * undefined otherwise; NUM/BOOL/BYTES answer undefined. undefined/null
   * receivers THROW the catchable Node-shaped TypeError, or answer the
   * undefined singleton when `opt` is set (a `?.` step). Borrows d and k;
   * the result is +1. Interned once (the memo key can never collide with
   * a typeKey — no IR type spells "%"). */
  /** The emitted STRING-LITERAL DISCRIMINANT predicate for one union
   * arm: `static bool sc_dlit_<n>(const ScrDyn *d)` — does this dyn hold
   * exactly the strings the arm pins? Never throws, builds nothing, and
   * reads the SAME [[Get]]-minus-accessors walk the match predicate uses,
   * so an inherited discriminant answers here too.
   *
   * Interned by the (field, value) pairs rather than by a typeKey: the
   * constraint belongs to a union ARM, not to a type, and two unions
   * pinning `operation` to `set` share one predicate. The memo lives in
   * dynBuilders behind a '%'-prefixed key, which no typeKey can spell
   * (dynDestrCheckHelper below is the precedent). */
  export function dynLitHelper(E: CEmitter, lits: Record<string, string[]>): string {
    const names = Object.keys(lits).sort();
    const pairs = names.map((n) => [n, lits[n]]);
    const memoKey = `%dlit:${JSON.stringify(pairs)}`;
    const existing = E.dynBuilders.get(memoKey);
    if (existing) return existing;
    const name = `sc_dlit_${E.dynBuilders.size}`;
    E.dynBuilders.set(memoKey, name);
    const sig = `static bool ${name}(const ScrDyn *d)`;
    // The pairs ride into a C BLOCK comment, so a literal spelling `*/`
    // would end it early and the rest of the predicate would be code no
    // one wrote. Neutralised here rather than trusted not to happen.
    const note = JSON.stringify(pairs).split("*/").join("*\\/");
    E.walkerProtos.push(`${sig}; /* pins ${note} */`);
    const d: string[] = [`${sig} { /* pins ${note} */`];
    d.push(`  const ScrDyn *m;`);
    d.push(`  if (d->kind != SCR_DYN_OBJ) return false;`);
    for (const n of names) {
      const vs = lits[n];
      if (vs === undefined || vs.length === 0) continue;
      const keyLit = cStringLiteral(Buffer.from(n, "utf8"));
      const keyLen = Buffer.byteLength(n, "utf8");
      d.push(`  m = scr_dyn_obj_data_get(d, ${keyLit}, ${keyLen});`);
      d.push(`  if (!m || m->kind != SCR_DYN_STR) return false;`);
      // SET membership: the arm's own values, any one of which is a hit.
      // Several schema keys share one IR shape, so a single value would
      // have to be dropped where a set still separates.
      const tests = vs.map((v) => {
        const valLit = cStringLiteral(Buffer.from(v, "utf8"));
        const valLen = Buffer.byteLength(v, "utf8");
        return `(m->v.str->len == ${valLen} && memcmp(m->v.str->data, ${valLit}, ${valLen}) == 0)`;
      });
      d.push(`  if (!(${tests.join(` || `)})) return false;`);
    }
    d.push(`  return true;`);
    d.push(`}`, ``);
    E.walkerDefs.push(...d);
    return name;
  }

  /** RequireObjectCoercible with V8's destructuring TypeError (the
   * dynDestrCheck node): nullish throws "Cannot destructure 'SPELL' as it
   * is undefined." (or "…null."), the property form "Cannot destructure
   * property 'PROP' of 'SPELL' …" when firstProp is non-NULL — V8's exact
   * strings, source spelling included. Non-nullish values pass silently. */
  export function dynDestrCheckHelper(E: CEmitter): string {
    const memoKey = "%dynDestrCheck";
    const existing = E.dynBuilders.get(memoKey);
    if (existing) return existing;
    const name = "sc_dyn_destr_check";
    E.dynBuilders.set(memoKey, name);
    const sig = `static void ${name}(const ScrDyn *d, const char *spell, const char *firstProp)`;
    E.walkerProtos.push(`${sig}; /* destructuring RequireObjectCoercible */`);
    E.walkerDefs.push(
      `${sig} { /* destructuring RequireObjectCoercible */`,
      `  if (d->kind != SCR_DYN_UNDEF && d->kind != SCR_DYN_NULL) return;`,
      `  ScrJsonBuf b;`,
      `  scr_jb_init(&b);`,
      `  if (firstProp) {`,
      `    scr_jb_puts(&b, "Cannot destructure property '");`,
      `    scr_jb_puts(&b, firstProp);`,
      `    scr_jb_puts(&b, "' of '");`,
      `    scr_jb_puts(&b, spell);`,
      `    scr_jb_puts(&b, "' as it is ");`,
      `  } else {`,
      `    scr_jb_puts(&b, "Cannot destructure '");`,
      `    scr_jb_puts(&b, spell);`,
      `    scr_jb_puts(&b, "' as it is ");`,
      `  }`,
      `  scr_jb_puts(&b, d->kind == SCR_DYN_UNDEF ? "undefined." : "null.");`,
      `  scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&b));`,
      `}`,
      ``,
    );
    return name;
  }

  /** GetIterator + first-N steps over a dyn value (the dynIterN node), as
   * array destructuring sees it: arrays step by index, strings by CODE
   * POINT (the string iterator — astral chars arrive unsplit), Buffers by
   * byte; everything else throws V8's exact not-iterable TypeError
   * ("undefined is not iterable …", "object null is not iterable …",
   * "number 1 is not iterable …", "boolean true …", "object …",
   * "function …" — each with the "(cannot read property
   * Symbol(Symbol.iterator))" tail). Returns a fresh +1 dyn array of
   * exactly n elements, undefined-padded past the end. */
  export function dynIterNHelper(E: CEmitter): string {
    const memoKey = "%dynIterN";
    const existing = E.dynBuilders.get(memoKey);
    if (existing) return existing;
    const name = "sc_dyn_iter_n";
    E.dynBuilders.set(memoKey, name);
    const sig = `static ScrDyn *${name}(const ScrDyn *d, size_t n)`;
    E.walkerProtos.push(`${sig}; /* destructuring GetIterator + N steps */`);
    E.walkerDefs.push(
      `${sig} { /* destructuring GetIterator + N steps */`,
      `  if (d->kind == SCR_DYN_JSVAL) {`,
      `    /* An engine array IS iterable — the not-iterable TypeError below`,
      `     * would be a wrong claim. Loud fence (lane dyn-routing-ops). */`,
      `    scr_dyn_isl_fence(d, "iteration");`,
      `    return NULL;`,
      `  }`,
      `  if (d->kind != SCR_DYN_ARR && d->kind != SCR_DYN_STR && d->kind != SCR_DYN_BYTES) {`,
      `    ScrJsonBuf b;`,
      `    scr_jb_init(&b);`,
      `    switch (d->kind) {`,
      `    case SCR_DYN_UNDEF: scr_jb_puts(&b, "undefined"); break;`,
      `    case SCR_DYN_NULL: scr_jb_puts(&b, "object null"); break;`,
      `    case SCR_DYN_BOOL: scr_jb_puts(&b, d->v.b ? "boolean true" : "boolean false"); break;`,
      `    case SCR_DYN_NUM: {`,
      `      scr_jb_puts(&b, "number ");`,
      `      ScrStr *s = scr_f64_to_scrstr(d->v.num);`,
      `      for (size_t i = 0; i < s->len; i++) scr_jb_putc(&b, s->data[i]);`,
      `      scr_str_release(s);`,
      `      break;`,
      `    }`,
      `    case SCR_DYN_FUNC: scr_jb_puts(&b, "function"); break;`,
      `    default: scr_jb_puts(&b, "object"); break;`,
      `    }`,
      `    scr_jb_puts(&b, " is not iterable (cannot read property Symbol(Symbol.iterator))");`,
      `    scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&b));`,
      `    return NULL;`,
      `  }`,
      `  ScrDyn *out = scr_dyn_new_arr();`,
      `  for (size_t i = 0; i < n; i++) {`,
      `    ScrDyn *item = NULL;`,
      `    if (d->kind == SCR_DYN_ARR) {`,
      `      item = i < d->v.arr.len ? scr_dyn_retain(d->v.arr.items[i]) : scr_dyn_retain(scr_dyn_undefined());`,
      `    } else if (d->kind == SCR_DYN_BYTES) {`,
      `      item = i < d->v.bytes->len ? scr_dyn_new_num((double)d->v.bytes->data[i]) : scr_dyn_retain(scr_dyn_undefined());`,
      `    } else {`,
      `      /* String iteration: whole code POINTS (astral chars arrive`,
      `       * unsplit — the string iterator, not charAt). */`,
      `      double len = scr_str_utf16_len(d->v.str);`,
      `      double at = 0;`,
      `      for (size_t step = 0; step < i && at < len; step++) {`,
      `        ScrStr *cp = scr_str_cp_at(d->v.str, at);`,
      `        at += scr_str_utf16_len(cp);`,
      `        scr_str_release(cp);`,
      `      }`,
      `      if (at < len) {`,
      `        ScrStr *cp = scr_str_cp_at(d->v.str, at);`,
      `        item = scr_dyn_new_str(cp);`,
      `        scr_str_release(cp);`,
      `      } else {`,
      `        item = scr_dyn_retain(scr_dyn_undefined());`,
      `      }`,
      `    }`,
      `    scr_dyn_arr_push(out, item); /* push takes ownership */`,
      `  }`,
      `  return out;`,
      `}`,
      ``,
    );
    return name;
  }

  export function dynKeyGetHelper(E: CEmitter): string {
    const memoKey = "%dynKeyGet";
    const existing = E.dynBuilders.get(memoKey);
    if (existing) return existing;
    const name = "sc_dyn_key_get";
    E.dynBuilders.set(memoKey, name);
    const sig = `static ScrDyn *${name}(ScrDyn *d, ScrStr *k, bool opt)`;
    E.walkerProtos.push(`${sig}; /* d[k] on dyn */`);
    const d: string[] = [`${sig} { /* d[k] on dyn */`];
    d.push(`  if (d->kind == SCR_DYN_UNDEF || d->kind == SCR_DYN_NULL) {`);
    d.push(`    if (opt) return scr_dyn_retain(scr_dyn_undefined());`);
    d.push(`    const char *base = d->kind == SCR_DYN_UNDEF`);
    d.push(`      ? "Cannot read properties of undefined (reading '"`);
    d.push(`      : "Cannot read properties of null (reading '";`);
    d.push(`    ScrStr *head = scr_str_new(base, strlen(base));`);
    d.push(`    ScrStr *withKey = scr_str_concat(head, k);`);
    d.push(`    scr_str_release(head);`);
    d.push(`    ScrStr *tail = scr_str_new("')", 2);`);
    d.push(`    ScrStr *msg = scr_str_concat(withKey, tail);`);
    d.push(`    scr_str_release(withKey);`);
    d.push(`    scr_str_release(tail);`);
    d.push(`    scr_throw_error(SCR_ERR_TYPE, msg); /* takes ownership */`);
    d.push(`    return NULL;`);
    d.push(`  }`);
    d.push(`  if (d->kind == SCR_DYN_OBJ) {`);
    d.push(`    /* JS's [[Get]], whole, in ONE runtime entry point: own`);
    d.push(`     * member, own ACCESSOR (its getter called with \`this\` = d),`);
    d.push(`     * then the same two up the PROTOTYPE CHAIN, then the`);
    d.push(`     * \`constructor\` fence. The LLVM backend calls the same`);
    d.push(`     * function, so the two lanes cannot answer differently.`);
    d.push(`     * Own-only consumers (Object.keys, hasOwn, JSON,`);
    d.push(`     * structuredClone) call scr_dyn_obj_get directly and are`);
    d.push(`     * unaffected — an accessor is not in the member table. */`);
    d.push(`    ScrDyn *m = scr_dyn_obj_key_get(d, k->data, k->len);`);
    d.push(`    if (m == NULL || m->kind != SCR_DYN_UNDEF) return m;`);
    d.push(`    /* The walk MISSED, so the question left is Object.prototype's,`);
    d.push(`     * which this runtime holds as C branches in scr_dyn_invoke.c`);
    d.push(`     * and not as a stored chain — the reason \`o[k]("hasOwnProperty")\``);
    d.push(`     * answered true while \`typeof o[k]\` answered undefined. */`);
    d.push(`    { ScrDyn *im = scr_dyn_intrinsic_method_get(d, k); if (im) { scr_dyn_release(m); return im; } }`);
    d.push(`    return m;`);
    d.push(`  }`);
    d.push(`  if (d->kind == SCR_DYN_JSVAL) {`);
    d.push(`    /* Island-held: o[k] reads the REAL engine property (getters`);
    d.push(`     * included, throws bridged catchably) and the result wraps`);
    d.push(`     * back scalar-normalized — the routed keyed read that retired`);
    d.push(`     * the fence (and before it, the fence box's .length -> 0). */`);
    d.push(`    return scr_dyn_isl_key_get(d, k);`);
    d.push(`  }`);
    d.push(`  if (d->kind == SCR_DYN_HANDLE) {`);
    d.push(`    /* Native handles: the tag's modeled properties (req.url,`);
    d.push(`     * res.statusCode, ...) answer boxed values through the`);
    d.push(`     * installed ops; the rest is the undefined singleton or the`);
    d.push(`     * loud not-supported ladder (scr_json.c). */`);
    d.push(`    return scr_dyn_handle_key_get(d, k);`);
    d.push(`  }`);
    d.push(`  if (d->kind == SCR_DYN_ARRBUF) {`);
    d.push(`    /* ArrayBuffer: 'byteLength' answers, and 'length' and every`);
    d.push(`     * index answer UNDEFINED — Node's real answers, not a fence`);
    d.push(`     * standing in for one. This is the arm the typed-array`);
    d.push(`     * branch below would have gotten wrong in three ways at`);
    d.push(`     * once had the two shared a kind. */`);
    d.push(`    return scr_dyn_arrbuf_key_get(d, k);`);
    d.push(`  }`);
    d.push(`  if (d->kind == SCR_DYN_BYTES) {`);
    d.push(`    /* Buffer-shaped dyn (a stream's 'data' chunk in the JS lane):`);
    d.push(`     * .length and canonical-index byte reads answer like Node. */`);
    d.push(`    if (k->len == 6 && memcmp(k->data, "length", 6) == 0) {`);
    d.push(`      return scr_dyn_new_num((double)d->v.bytes->len);`);
    d.push(`    }`);
    // `b.constructor` — the %Uint8Array% singleton, which is what makes
    // protobufjs's `new this.buf.constructor(0)` (Reader.prototype.raw)
    // build a typed array instead of throwing on undefined. A Buffer or
    // a non-u8 element kind refuses by name there rather than answering
    // the wrong constructor. The LLVM lane calls the same function.
    d.push(`    if (k->len == 11 && memcmp(k->data, "constructor", 11) == 0) {`);
    d.push(`      return scr_dyn_bytes_constructor(d);`);
    d.push(`    }`);
    d.push(`    if (k->len > 0 && !(k->len > 1 && k->data[0] == '0')) {`);
    d.push(`      size_t idx = 0; bool digits = true;`);
    d.push(`      for (size_t i = 0; i < k->len; i++) {`);
    d.push(`        if (k->data[i] < '0' || k->data[i] > '9' || idx > (SIZE_MAX - 9) / 10) { digits = false; break; }`);
    d.push(`        idx = idx * 10 + (size_t)(k->data[i] - '0');`);
    d.push(`      }`);
    d.push(`      if (digits && idx < d->v.bytes->len) return scr_dyn_new_num((double)d->v.bytes->data[idx]);`);
    d.push(`    }`);
    d.push(`  }`);
    d.push(`  if (d->kind == SCR_DYN_BIG) {`);
    d.push(`    /* A primitive with a real prototype: (5n).toString is a`);
    d.push(`     * function and (5n).nope is undefined, and the box carries`);
    d.push(`     * no table to tell those apart. Falling through to the`);
    d.push(`     * undefined tail would answer undefined for the methods`);
    d.push(`     * Node returns — the silent wrong answer the OBJINST arm`);
    d.push(`     * below refuses for the same reason. */`);
    d.push(`    scr_dyn_big_fence(d, "a property read");`);
    d.push(`    return NULL;`);
    d.push(`  }`);
    d.push(`  if (d->kind == SCR_DYN_OBJINST) {`);
    d.push(`    /* A class instance's DECLARED members are struct fields the`);
    d.push(`     * box has no table for. Falling through to the undefined tail`);
    d.push(`     * would be a SILENT wrong answer for a property Node reads`);
    d.push(`     * fine, so those stay the loud ladder, named by class.`);
    d.push(`     *`);
    d.push(`     * What the box CAN answer is the run-time-keyed properties`);
    d.push(`     * Object.defineProperty put in the instance's %props table,`);
    d.push(`     * and it must: that table is the receiver row of`);
    d.push(`     * defineProperty, its keys are exactly the ones that name no`);
    d.push(`     * declared member (cls.propsDefine refuses the collision), and`);
    d.push(`     * every other surface over it — \`in\`, util.inspect's frame,`);
    d.push(`     * the enumerable count — already reads it. [[Get]] was the one`);
    d.push(`     * that did not, so scr_cls_props_get shipped end to end with no`);
    d.push(`     * caller while \`c[k]\` refused a property the program had just`);
    d.push(`     * defined on c. */`);
    for (const [cname, meta] of E.classMeta) {
      // Which classes get an arm, and what the box must prove first.
      //
      // A box's `cls` is the descriptor of the STATIC type the value was
      // boxed FROM, so a Derived instance in a Base-typed slot boxes as
      // Base. Trusting THAT descriptor to name the struct is unsound --
      // and refusing every hierarchy class because of it, which is what
      // this loop used to do, refuses zapo's own WaClientImpl, the only
      // class in its 3M-line TU that carries a table at all. Neither is
      // necessary, because the descriptor is not the only thing the box
      // carries: a hierarchy instance carries its VTABLE, and
      // scr_dyn_objinst_pre reads the class's own preorder position out
      // of it -- which is exactly how `instanceof` narrows a base-typed
      // box to the derived class. scr_dyn_objinst_ptr_of tests that
      // RUN-TIME position against this descriptor's interval, so the
      // answer depends on what the object IS and never on the declared
      // type of a slot it passed through. That last clause is the whole
      // reason the static-descriptor test was not shippable.
      //
      // The INTERVAL and not equality because a subclass's layout opens
      // with its base chain's fields as an IDENTICAL prefix (that is what
      // makes an upcast a reinterpret), so this class's %props sits at
      // this index in every class below it too.
      //
      // WHAT THE INTERVAL DOES NOT BUY TODAY: the frontend refuses a table
      // on a class that HAS A SUBCLASS (SC2020 -- the closed member set its
      // collision check reads would not be exact), so every table-carrying
      // class is a LEAF and its interval is a single point. The interval is
      // still what belongs here rather than `==`: it is the predicate
      // instanceof already uses, it needs no second runtime entry point,
      // and it is what stays correct if that leaf rule is ever relaxed.
      // tests/harness/class-runtime-property-table.test.ts pins the
      // refusal, so the day it lifts is a day this arm is already right.
      if (!meta.def.fields.some((f) => f.name === CLASS_PROPS_FIELD)) continue;
      // A class whose BASE already carries the field needs no arm: the
      // field is the base's, at the base's index, and the base's arm
      // covers this class's whole interval. lower-classes.ts adds %props
      // only when the base chain has none, so the field is never
      // duplicated and "the base's index" is the only index there is.
      if (meta.base?.def.fields.some((f) => f.name === CLASS_PROPS_FIELD)) continue;
      if (!canBoxClassIntoDyn(cname)) continue;
      const desc = E.dynClassDesc(cname);
      const struct = mangleClassStruct(cname);
      const fld = mangleField(CLASS_PROPS_FIELD);
      d.push(`    { void *po = scr_dyn_objinst_ptr_of(d, &${desc}); /* ${cname}'s %props table */`);
      d.push(`    if (po != NULL) {`);
      d.push(`      ScrDyn *pv = scr_cls_props_get(((${struct} *)po)->${fld}, k);`);
      // NULL means two different things — "no such key" and "the getter
      // threw" — and only the pending exception tells them apart. Reading
      // the miss as a throw would swallow a real one into the fence's
      // message; reading the throw as a miss would REPLACE it with the
      // fence, which is the louder-but-wrong answer.
      d.push(`      if (pv != NULL || scr_exc_pending()) return pv;`);
      d.push(`    } }`);
    }
    d.push(`    scr_dyn_objinst_fence(d, "a property read");`);
    d.push(`    return NULL;`);
    d.push(`  }`);
    d.push(`  if (d->kind == SCR_DYN_MAP) {`);
    d.push(`    /* A Map's entries are internal slots and its size/get/has/add`);
    d.push(`     * live on a prototype the box carries no table for. The`);
    d.push(`     * undefined tail would answer undefined for 'size' and for`);
    d.push(`     * every method Node returns — the OBJINST arm's silent wrong`);
    d.push(`     * answer, one kind over. Loud ladder, named Map or Set.`);
    d.push(`     *`);
    d.push(`     * Note this arm must come BEFORE any v.obj read: v.map`);
    d.push(`     * OVERLAYS v.obj in the payload union, so an unguarded`);
    d.push(`     * d->v.obj.len on a MAP box reads the ScrMap pointer as a`);
    d.push(`     * length. Every reader below is kind-guarded; this arm keeps`);
    d.push(`     * it that way by construction. */`);
    d.push(`    scr_dyn_map_fence(d, "a property read");`);
    d.push(`    return NULL;`);
    d.push(`  }`);
    d.push(`  if (d->kind == SCR_DYN_FUNC) {`);
    d.push(`    /* own props (defineProperties writes), then name/length —`);
    d.push(`     * the function-instance members test/common copies. */`);
    d.push(`    ScrDyn *m = scr_dyn_fn_get(d, k->data, k->len);`);
    d.push(`    if (m) return m;`);
    d.push(`  }`);
    d.push(`  if (d->kind == SCR_DYN_ARR || d->kind == SCR_DYN_STR) {`);
    d.push(`    if (k->len == 6 && memcmp(k->data, "length", 6) == 0) {`);
    d.push(`      return scr_dyn_new_num(d->kind == SCR_DYN_ARR ? (double)d->v.arr.len : scr_str_utf16_len(d->v.str));`);
    d.push(`    }`);
    d.push(`    if (k->len > 0 && !(k->len > 1 && k->data[0] == '0')) {`);
    d.push(`      /* canonical index: digits only, no leading zero — array`);
    d.push(`       * elements, and the string's 1-code-unit char ("abc"[1] is`);
    d.push(`       * "b" in JS; out of range reads as an absent key). */`);
    d.push(`      size_t idx = 0; bool digits = true;`);
    d.push(`      for (size_t i = 0; i < k->len; i++) {`);
    d.push(`        if (k->data[i] < '0' || k->data[i] > '9' || idx > (SIZE_MAX - 9) / 10) { digits = false; break; }`);
    d.push(`        idx = idx * 10 + (size_t)(k->data[i] - '0');`);
    d.push(`      }`);
    d.push(`      if (digits && d->kind == SCR_DYN_ARR && idx < d->v.arr.len) return scr_dyn_retain(d->v.arr.items[idx]);`);
    d.push(`      if (digits && d->kind == SCR_DYN_STR && (double)idx < scr_str_utf16_len(d->v.str)) {`);
    d.push(`        ScrStr *c = scr_str_char_at(d->v.str, (double)idx);`);
    d.push(`        ScrDyn *r = scr_dyn_new_str(c);`);
    d.push(`        scr_str_release(c);`);
    d.push(`        return r;`);
    d.push(`      }`);
    d.push(`    }`);
    d.push(`  }`);
    /* The kinds whose PROTOTYPE this runtime models as dispatch arms
     * rather than as a stored chain — a string's trim, an array's push, a
     * number's toString, a promise's then. Each read `undefined` where
     * Node says `function`, which is what makes `if (s[k])` take the
     * wrong branch in silence. Answers only names the CALL also answers
     * or fences loudly by name, so the two spellings agree. */
    d.push(`  { ScrDyn *im = scr_dyn_intrinsic_method_get(d, k); if (im) return im; }`);
    d.push(`  return scr_dyn_retain(scr_dyn_undefined());`);
    d.push(`}`, ``);
    E.walkerDefs.push(...d);
    return name;
  }

  /** The record builder's WIDE LANE, shared by every record shape that has
   * one, in two emitted functions and a per-shape key table.
   *
   * `as T` is ERASED in JS, so Node answers a DECLARED member from any
   * receiver that has one: `["a","b","c"] as {length:number}` reads 3,
   * `"abcd" as {length:number}` reads 4, `new Uint8Array([1,2,3])` reads 3.
   * The builder's kind gate (`d->kind != SCR_DYN_OBJ`) refused all three
   * before any member was looked at. Over a generated 108-case population
   * (18 receiver kinds x 6 record targets) whose every expectation is
   * Node's own answer, that gate alone accounted for 66 of 96 divergences.
   *
   * The lane PROJECTS the shape's declared keys off the receiver into a
   * plain object and lets the ordinary OBJ body validate THAT, so the
   * per-field types, the `$.k` paths and the refusal messages are the ones
   * the OBJ lane already produces and nothing is written twice. The read is
   * `sc_dyn_key_get` - the very entry point the JS lane's `d[k]` takes - so
   * a widened cast cannot answer a member differently from a plain property
   * read of the same value, on either backend.
   *
   * Three boundaries, each of which is a REFUSAL that stays:
   *
   * - the MATCHER (`dynMatchHelper`) is untouched. Union arms are chosen
   *   there, so `{length:number} | string[]` still gives an array the
   *   `string[]` tag. A builder is only ever reached at a direct cast site,
   *   as a record field's child, as an array element's, or through an arm
   *   its matcher already picked - so widening it is MONOTONE: it can turn
   *   a refusal into an answer and it can change no union tag.
   *
   * - the kinds whose members this runtime cannot ANSWER stay refused:
   *   OBJINST, MAP and BIG carry no member table, and `sc_dyn_key_get`
   *   fences on all three rather than fabricate `undefined` for a property
   *   Node reads fine. Routing them here would trade a catchable
   *   `TypeError: expected object at $, got Holder` for a catchable
   *   `Error: a property read on a dynamic Holder is not supported yet` -
   *   a different loud, not a right answer.
   *
   * - null and undefined stay refused HERE rather than through the read,
   *   because Node's message names the property the program reached for
   *   first and a projection reaches for the shape's first declared field.
   *   `expected object at $, got null` is the documented divergence; a
   *   plausible-looking "Cannot read properties of null (reading 'a')" for
   *   a program that never mentioned `a` would not be. */
  export function recordWideHelper(E: CEmitter): string {
    const memoKey = "%recWide";
    const existing = E.dynBuilders.get(memoKey);
    if (existing) return existing;
    const name = "sc_dyn_rec_wide";
    E.dynBuilders.set(memoKey, name);
    const kg = dynKeyGetHelper(E);
    const okSig = `static bool sc_dyn_rec_wideable(const ScrDyn *d)`;
    const sig = `static ScrDyn *${name}(const ScrDyn *d, const char *const *keys, const unsigned *lens, size_t n)`;
    E.walkerProtos.push(`${okSig}; /* record builder: a receiver whose members can be read */`);
    E.walkerProtos.push(`${sig}; /* record builder: the non-OBJ receiver's declared members */`);
    // The admitted kinds come from backend/kindgate.ts, spelled here as
    // enum names and on the LLVM lane as DK numbers: a kind admitted on
    // one lane cannot be refused on the other, because there is only one
    // list. Three to a row, which is the shape this text always had.
    const kindRows: string[] = [];
    for (let i = 0; i < KINDGATE_WIDE_KINDS.length; i += 3) {
      kindRows.push(
        `    ${KINDGATE_WIDE_KINDS.slice(i, i + 3)
          .map((k) => `case SCR_DYN_${k}:`)
          .join(" ")}`,
      );
    }
    kindRows[kindRows.length - 1] += ` return true;`;
    E.walkerDefs.push(
      `${okSig} { /* record builder: a receiver whose members can be read */`,
      `  switch (d->kind) {`,
      ...kindRows,
      `    default: return false;`,
      `  }`,
      `}`,
      ``,
      `${sig} { /* record builder: the non-OBJ receiver's declared members */`,
      `  ScrDyn *o = scr_dyn_new_obj();`,
      `  for (size_t i = 0; i < n; i++) {`,
      `    ScrStr *k = scr_str_new(keys[i], lens[i]);`,
      `    ScrDyn *v = ${kg}((ScrDyn *)d, k, false);`,
      `    scr_str_release(k);`,
      `    if (v == NULL) { scr_dyn_release(o); return NULL; } /* the read threw */`,
      `    /* An UNDEFINED answer IS JS's absent-property read, and the OBJ`,
      `     * body's own absent handling is exactly what should decide it: a`,
      `     * required field takes the documented "got undefined" refusal, an`,
      `     * optional-flavored one takes the undefined arm. So the key is`,
      `     * simply not written, and no second stance is invented here. */`,
      `    /* scr_dyn_obj_set OWNS the value it is handed (the static->dyn`,
      `     * converters push +1 into it and never release), so the +1 the`,
      `     * read answered moves in on the write path and is dropped by hand`,
      `     * on the other. */`,
      `    if (v->kind != SCR_DYN_UNDEF) scr_dyn_obj_set(o, keys[i], lens[i], v);`,
      `    else scr_dyn_release(v);`,
      `  }`,
      `  return o;`,
      `}`,
      ``,
    );
    return name;
  }

/** The emitted checked builder for one dynCheck target type:
   * `static T sc_dc_<n>(const ScrDyn *d, const ScrDynPath *path)` —
   * validate the checked-dynamic tree against T and BUILD the typed value (+1), or throw a
   * catchable, path-annotated TypeError-shaped string through the exception
   * cell and return a dummy (0/false/NULL) with the pending flag set.
   * Recursive calls propagate a pending exception by releasing the
   * partially-built value and returning — the same pending-check discipline
   * emitted function bodies follow. */
  export function dynCheckHelper(E: CEmitter, t: IrType): string {
    const key = typeKey(t);
    const existing = E.dynBuilders.get(key);
    if (existing) return existing;
    const name = `sc_dc_${E.dynBuilders.size}`;
    E.dynBuilders.set(key, name);
    const sig = `static ${cType(t)}${cType(t).endsWith("*") ? "" : " "}${name}(const ScrDyn *d, const ScrDynPath *path)`;
    E.walkerProtos.push(`${sig}; /* check ${key} */`);
    const d: string[] = [`${sig} { /* check ${key} */`];
    dynWalkerBody(E, t, name, d, false);
    d.push(`}`, ``);
    E.walkerDefs.push(...d);
    return name;
  }

/** The emitted ARM walker for one union-arm type — the MERGE of the
   * match predicate and the checked builder into ONE function:
   * `static T sc_da_<n>(const ScrDyn *d, const ScrDynPath *path, bool *ok)`.
   *
   * It walks the value ONCE. A type mismatch sets `*ok = false` and
   * returns the dummy (0/false/NULL) WITHOUT touching the exception cell,
   * so the union builder simply tries the next arm; a success returns the
   * built value (+1) with `*ok` untouched. `*ok` is true on entry, set by
   * the caller.
   *
   * Why this exists at all. A union arm used to be spelled
   * `if (sc_dm_T(d)) return union_new(i, sc_dc_T(d, path))` — a matcher
   * that walked the whole subtree to DECIDE, then a builder that walked
   * the identical subtree again to CONSTRUCT, with the builder's own
   * refusals kept alive only by the invariant "the matched arm's builder
   * can no longer fail". That invariant was maintained by two
   * INDEPENDENTLY GENERATED functions, and this tree has already watched
   * them diverge over the accessor read. One function that decides while
   * it builds cannot disagree with itself: the invariant is not trusted
   * here, it is gone.
   *
   * The decision this function makes is the MATCHER's, statement for
   * statement, and NOT the builder's — deliberately, because the two are
   * not the same rule and the difference decides which union ARM a value
   * takes:
   *   * a func arm tests the exact signature (the matcher's strcmp), NOT
   *     the builder's exact-or-adapt: adapting here would let
   *     `{a: () => number} | {a: () => string}` take arm 0 for a
   *     string-returning value and wear the wrong tag in silence;
   *   * a REQUIRED record member is the data read alone, with no accessor
   *     probe: the matcher demands the key present as DATA, so an arm
   *     whose member only a getter provides was never matched, and the
   *     builder's accessor probe sat behind a condition that could not
   *     hold;
   *   * an OPTIONAL member keeps BOTH halves, because the matcher and the
   *     builder genuinely differ there and today's answer is the
   *     builder's: a present key is decided softly (the matcher tested
   *     it), an accessor-provided one is built by the HARD builder and
   *     still throws — the one documented place where a matched arm's
   *     builder could fail;
   *   * a member that may hold a FUNCTION keeps its matcher call, because
   *     the builder reads it through scr_dyn_obj_member_get, which hands
   *     an INHERITED method back BOUND (signature "()"), while the matcher
   *     tests the raw member's own signature. The decision stays on the
   *     raw read and the value still comes from the bound one.
   *
   * A hard failure reached through those two paths sets `*ok = false` as
   * well and leaves the exception pending, so one test at the call site
   * separates "try the next arm" from "propagate": `!ok` with nothing
   * pending is a soft miss. */
  export function dynArmHelper(E: CEmitter, t: IrType): string {
    const key = typeKey(t);
    const existing = E.dynArmBuilders.get(key);
    if (existing) return existing;
    const name = `sc_da_${E.dynArmBuilders.size}`;
    E.dynArmBuilders.set(key, name);
    const sig = `static ${cType(t)}${cType(t).endsWith("*") ? "" : " "}${name}(const ScrDyn *d, const ScrDynPath *path, bool *ok)`;
    E.walkerProtos.push(`${sig}; /* arm ${key} */`);
    const d: string[] = [`${sig} { /* arm ${key} */`];
    dynWalkerBody(E, t, name, d, true);
    d.push(`}`, ``);
    E.walkerDefs.push(...d);
    return name;
  }

/** The ONE body generator behind both walkers above. `soft` picks the
   * failure discipline and nothing else, so the two can never drift: a
   * hard body refuses with the path-annotated catchable TypeError
   * (scr_dyn_check_fail — the statement the census counts as DYNCHECK), a
   * soft one sets `*ok = false` and returns. Every recursive edge follows
   * the mode it is in. */
  function dynWalkerBody(
    E: CEmitter,
    t: IrType,
    name: string,
    d: string[],
    soft: boolean,
  ): void {
    const key = typeKey(t);
    const want = cStringLiteral(Buffer.from(E.dynDesc(t), "utf8"));
    /* One refusal, in whichever discipline this body is emitted for. The
     * dial's ordinal is ALLOCATED by dcHitC and closed by dcFailC, so the
     * hard arm spells them in that order inside one template literal and
     * the soft arm spells neither — a soft body plants no census
     * statement because it plants no way to die. */
    const fail = (
      ind: string,
      shape: string,
      cond: string,
      dummy: string,
      rel = "",
      wantX: string = want,
      valX = "d",
      pathX = "path",
    ): string =>
      soft
        ? `${ind}if (${cond}) { *ok = false; ${rel}return ${dummy}; }`
        : `${ind}${E.dcHitC(name, shape)}if (${cond}) { ${E.dcFailC()}scr_dyn_check_fail(${pathX}, ${wantX}, ${valX}); ${rel}return ${dummy}; }`;
    /* A recursive edge, in this body's own mode. */
    const childC = (ct: IrType): string => (soft ? E.dynArmHelper(ct) : E.dynCheckHelper(ct));
    const childArg = soft ? ", ok" : "";
    /* After a recursive edge: a soft child reports BOTH failure kinds
     * through `*ok`, so one test covers the miss and the throw. */
    const afterChild = (ind: string, rel: string, dummy: string): string =>
      soft
        ? `${ind}if (!*ok) { ${rel}return ${dummy}; }`
        : `${ind}if (scr_exc_pending()) { ${rel}return ${dummy}; }`;
    /* After a HARD edge inside a soft body (the optional-accessor and
     * may-hold-func paths): the throw is real and propagates, and `*ok`
     * carries it out so the caller needs one test, not two. */
    const afterHard = (ind: string, rel: string, dummy: string): string =>
      `${ind}if (scr_exc_pending()) { ${soft ? "*ok = false; " : ""}${rel}return ${dummy}; }`;
    switch (t.kind) {
      case "f64":
        if (soft) d.push(`  (void)path;`);
        d.push(fail(`  `, "prim.f64", `d->kind != SCR_DYN_NUM`, `0`));
        d.push(`  return d->v.num;`);
        break;
      case "bool":
        if (soft) d.push(`  (void)path;`);
        d.push(fail(`  `, "prim.bool", `d->kind != SCR_DYN_BOOL`, `false`));
        d.push(`  return d->v.b;`);
        break;
      case "string":
        if (soft) d.push(`  (void)path;`);
        d.push(fail(`  `, "prim.string", `d->kind != SCR_DYN_STR`, `NULL`));
        d.push(`  return scr_str_retain(d->v.str);`);
        break;
      case "dyn":
        // An `unknown` slot (a dyn record field): the checked-dynamic tree subtree passes
        // through as-is — nothing to validate, nothing to build. The arm
        // form matches every value, exactly as the predicate for `dyn` did.
        d.push(`  (void)path;`);
        if (soft) d.push(`  (void)ok;`);
        d.push(`  return scr_dyn_retain((ScrDyn *)d);`);
        break;
      case "bigint":
        // `u as bigint`, and the bigint arm of a checked union: the SAME
        // digits back, retained. Not a copy — the u8 arm below copies
        // because a typed array is mutable and the two sides must not
        // alias, and neither reason applies to an immutable value.
        // The arm form pre-tests exactly the kind the unbox would have
        // refused on, so the unbox behind it can no longer fail.
        if (soft) d.push(`  if (d->kind != SCR_DYN_BIG) { *ok = false; return NULL; }`);
        d.push(`  return scr_dyn_big_unbox(d, path, ${want});`);
        break;
      case "bytes": {
        const bk = DYN_BYTES_KINDS.get(t.elem);
        if (!bk) throw new Error(`emitter bug: dynCheck of bytes<${t.elem}>`);
        if (bk.dk === "ARRBUF") {
          // `u as ArrayBuffer`: the SAME payload back, retained — the
          // opposite of the u8 arm below, and deliberately. A copy would
          // silently detach every view already taken over the buffer,
          // and an ArrayBuffer with no views is a value nobody wants.
          if (soft) d.push(`  if (d->kind != ${bk.kind}) { *ok = false; return NULL; }`);
          d.push(`  return scr_dyn_arrbuf_unbox(d, path, ${want});`);
          break;
        }
        // `u as Uint8Array` / `u as Buffer`: kind check, then the SAME
        // payload back, retained. The ARRBUF arm above states the reason
        // and this arm used to contradict it: the inbound direction has
        // always aliased (scr_dyn_new_bytes_ref), so a copy here made the
        // round trip lose the object. `(u as Buffer) === b` answered
        // false against Node's true, a write through the recovered value
        // landed on a copy, and a subarray came back detached from its
        // backing buffer.
        if (soft) d.push(`  (void)path;`);
        d.push(
          fail(
            `  `,
            "prim.bytes",
            soft ? `d->kind != ${bk.kind}` : `d->kind != SCR_DYN_BYTES`,
            `NULL`,
          ),
        );
        d.push(
          `  return ${bytesAliasOnExtract() ? "scr_dyn_bytes_unbox" : "scr_dyn_bytes_copy_out"}(d);`,
        );
        break;
      }
      case "map":
      case "set": {
        // `u as Map<K, V>` / a map-typed record field validated out of a
        // dyn: kind test, typeKey strcmp, then a RETAINED unwrap (+1 —
        // the SAME ScrMap, no copy, so `unbox(box(m)) === m`, which is
        // the half of this kind that makes it worth having). A miss —
        // including a map of a DIFFERENT element type, which is the case
        // a kind-only test would get silently wrong — is the usual
        // path-annotated catchable TypeError; in the arm form the
        // pre-test is the match predicate verbatim and the miss is soft.
        const tkeyLit = cStringLiteral(Buffer.from(key, "utf8"));
        if (soft) {
          d.push(
            `  if (d->kind != SCR_DYN_MAP || strcmp(d->v.map.tkey, ${tkeyLit}) != 0) { *ok = false; return NULL; }`,
          );
        }
        d.push(`  return scr_dyn_map_unbox(d, ${tkeyLit}, path, ${want});`);
        break;
      }
      case "object":
        // A CLASS TARGET, two representations apart. Everything but
        // %Error is the instance box's interval-checked unwrap;
        // %Error is the checked-dynamic tree's error encoding, whose
        // story is on its own branch below.
        if (t.className !== "%Error") {
          // Every other class: an interval-checked REFERENCE unwrap. The
          // pointer that comes back is the one that went in (+1), so
          // `unbox(box(x)) === x` — which is the half of this kind that
          // makes it worth having. A miss is the usual path-annotated
          // TypeError, and the arm form's pre-test is the SAME preorder
          // interval the unwrap would have refused on.
          const meta = E.classMeta.get(t.className);
          if (!meta) throw new Error(`emitter bug: dynCheck of unknown class ${t.className}`);
          E.dynClassDesc(t.className);
          if (soft) {
            d.push(
              `  if (!scr_dyn_objinst_is(d, ${meta.pre}, ${meta.post})) { *ok = false; return NULL; }`,
            );
          }
          d.push(
            `  return (${cType(t).trim()})scr_dyn_objinst_unbox(d, ${meta.pre}, ${meta.post}, path, ${want});`,
          );
          break;
        }
        // The %Error extraction (an instanceof-Error narrow on unknown):
        // validate the checked-dynamic tree's error encoding — its
        // [[Prototype]] link to %Error.prototype%, which is what
        // scr_dyn_is_error_encoding reads — and extract through the
        // runtime's IDENTITY CACHE (scr_error_from_dyn): a dyn error that
        // came from a runtime ScrError answers that very instance, so
        // out-and-back crossings compare reference-equal (the tracing
        // suite's shape); alien error objects rebuild once and cache the
        // pair.
        if (soft) d.push(`  (void)path;`);
        d.push(
          fail(
            `  `,
            "class.Error",
            `!scr_dyn_is_error_encoding(d)`,
            `NULL`,
          ),
        );
        d.push(`  return scr_error_from_dyn(d);`);
        break;
      case "record": {
        const shape = E.recordsById.get(t.shapeId);
        if (!shape) throw new Error(`emitter bug: dynCheck of unknown shape ${t.shapeId}`);
        // The wide lane owns a projection that every exit has to release;
        // `rel` is the one spelling every early return already goes
        // through, so the release rides it rather than being repeated at
        // seven return sites and forgotten at the eighth. Empty until the
        // lane is actually taken (a tuple shape returns above it).
        let projRel = "";
        const rel = (v: string) => `${releaseCallC(t, v)}${projRel}`;
        // Tuple targets: a JSON ARRAY of exactly the arity, validated and
        // extracted positionally with index paths ("$.pairs[3][1]").
        if (shape.tuple) {
          const byIndex = [...shape.fields].sort((a, b) => Number(a.name) - Number(b.name));
          const arityWant = cStringLiteral(
            Buffer.from(`array of length ${byIndex.length}`, "utf8"),
          );
          d.push(fail(`  `, "array.kind", `d->kind != SCR_DYN_ARR`, `NULL`));
          d.push(
            fail(`  `, "tuple.arity", `d->v.arr.len != ${byIndex.length}`, `NULL`, ``, arityWant),
          );
          d.push(`  ${cDecl(t, "r")} = ${mangleRecordNew(t.shapeId)}();`);
          byIndex.forEach((f, i) => {
            d.push(`  {`);
            d.push(`    ScrDynPath p = { path, NULL, ${i} };`);
            d.push(
              `    r->${mangleField(f.name)} = ${childC(f.type)}(d->v.arr.items[${i}], &p${childArg});`,
            );
            d.push(afterChild(`    `, `${rel("r")}; `, `NULL`));
            d.push(`  }`);
          });
          d.push(`  return r;`);
          break;
        }
        // The KIND GATE, and the WIDE LANE beside it (recordWideHelper
        // above carries the whole argument). A receiver whose kind is not
        // SCR_DYN_OBJ but whose members this runtime can read has its
        // DECLARED keys projected into a plain object, and the body below
        // validates that projection - so `["a","b","c"] as {length:number}`
        // answers 3 the way Node does instead of refusing at the first
        // statement.
        //
        // WHICH DISCIPLINE THE LANE IS EMITTED IN IS THE WHOLE CONTROL, and
        // on this shape it is one boolean. Before the matcher and the
        // builder became one walk, a union arm was picked by `sc_dm_` and
        // built by `sc_dc_`, so editing the builder's gate COULD NOT reach
        // arm selection: widening it was monotone by construction. Now both
        // come out of this generator and `soft` is the only thing that
        // separates them - so the same edit reaches the arm decision unless
        // it says not to, and the SAFE edit is the one that has to be
        // spelled out:
        //
        //   SCRIPTC_KINDGATE_WIDE   the HARD body only (!soft) - the
        //                           builder. Cannot move a union tag,
        //                           because the arm walker is untouched.
        //   SCRIPTC_KINDGATE_MATCH  the SOFT body as well - the arm
        //                           decision. This is what manufactures a
        //                           silently wrong union tag, and it is a
        //                           control, never a shipped default.
        //
        // Everything else about the gate is unchanged: the statement is
        // still one `record.kind` site in the hard body and none in the
        // soft one, the refusal is still the same catchable path-annotated
        // TypeError, and a shape that cannot take the lane (a tuple, an
        // index signature, a fieldless shape) still meets
        // `d->kind != SCR_DYN_OBJ` alone.
        // The split itself is NOT spelled here any more: `kindgateWideLane`
        // in backend/kindgate.ts is the one definition, and
        // backend/llvm/dyn.ts asks the identical question at the identical
        // point of its own record body. Restating `soft ? match : wide` in
        // two files is exactly the drift this gate is a warning about.
        const wide = kindgateWideLane(E.kindgateDials, soft, shape)
          ? E.recordWideHelper()
          : null;
        if (wide) {
          const keysName = `sc_kgk_${t.shapeId}`;
          const lensName = `sc_kgl_${t.shapeId}`;
          if (!E.recWideTables.has(t.shapeId)) {
            E.recWideTables.add(t.shapeId);
            E.walkerProtos.push(
              `static const char *const ${keysName}[] = { ${shape.fields
                .map((f) => cStringLiteral(Buffer.from(f.name, "utf8")))
                .join(", ")} };`,
            );
            E.walkerProtos.push(
              `static const unsigned ${lensName}[] = { ${shape.fields
                .map((f) => String(Buffer.byteLength(f.name, "utf8")))
                .join(", ")} };`,
            );
          }
          d.push(`  ScrDyn *sc_proj = NULL;`);
          // The refusal rides `fail`, so the dial ordinal, the message and
          // the hard/soft discipline all come from the shared helper and
          // this lane cannot invent a second stance for any of them. The
          // condition is the base condition AND "the kind cannot answer",
          // so a shape with no wide lane emits the base statement verbatim.
          d.push(
            fail(
              `  `,
              "record.kind",
              `d->kind != SCR_DYN_OBJ && !sc_dyn_rec_wideable(d)`,
              `NULL`,
            ),
          );
          d.push(`  if (d->kind != SCR_DYN_OBJ) {`);
          d.push(`    sc_proj = ${wide}(d, ${keysName}, ${lensName}, ${shape.fields.length});`);
          d.push(
            `    if (sc_proj == NULL) { ${soft ? "*ok = false; " : ""}return NULL; } /* the read threw */`,
          );
          d.push(`    d = sc_proj;`);
          d.push(`  }`);
          projRel = "; if (sc_proj) scr_dyn_release(sc_proj)";
        } else {
          d.push(fail(`  `, "record.kind", `d->kind != SCR_DYN_OBJ`, `NULL`));
        }
        d.push(`  ${cDecl(t, "r")} = ${mangleRecordNew(t.shapeId)}();`);
        // The HIDDEN per-instance OWN-KEY MASK. This builder is the ONE
        // point that still holds both halves of JS's answer: the member's
        // VALUE (read through [[Get]], so a prototype-carried default is
        // seen — which is what makes protobufjs's Long and every JS class
        // match a record arm at all) and whether the source object carried
        // the key ITSELF. The struct slot can hold one of them, and the
        // undefined arm — a record's only presence signal — is a fact about
        // the VALUE, so writing "absent" there for an inherited member
        // would fix Object.keys and break the read. Byte 0 says the mask
        // was written; the bits say which members were OWN, and the
        // enumeration surfaces read them instead of the declared field
        // list.
        //
        // Byte 0 also carries the SOURCE object's own [[Prototype]]-is-null
        // fact (OWNMASK_SRC_NULL_PROTO), and it belongs here for the same
        // reason the bits do: this is the last point that still holds it.
        // A record shape is STRUCTURAL, so `Object.create(null)`-ness
        // cannot live on the shape — os.userInfo() builds a null-prototype
        // object and `JSON.parse(s) as os.UserInfo` does not, and they
        // share the shape.
        if (shape.ownmask) {
          d.push(
            `  r->${OWNMASK_MEMBER}[0] = scr_dyn_is_null_proto(d) ? ${OWNMASK_VALID | OWNMASK_SRC_NULL_PROTO} : ${OWNMASK_VALID};`,
          );
        }
        // ...and the source object's own [[Prototype]] LINK, which is the
        // one thing a monomorphic struct has nowhere to keep and which the
        // mask made observable: a member the source only INHERITED is no
        // longer written as an own key, so unless the chain travels with
        // the record it stops existing at the crossing. IrRecordShape's
        // srcproto comment carries the whole argument.
        if (shape.srcproto) {
          d.push(`  r->${SRCPROTO_MEMBER} = scr_dyn_obj_proto_ref(d); /* the SOURCE's [[Prototype]] */`);
        }
        // The HIDDEN per-instance toString slot. MATERIALIZING is what
        // loses a JS object's toString: `x as LongLike` is the identity in
        // JS, so String(x) still reaches the prototype method, while this
        // builder copies the declared members into a struct and every
        // later ToString folded Object.prototype's constant over a method
        // that exists. scr_dyn_tostr_closure captures the SOURCE object
        // and answers NULL unless it really carries a callable toString
        // and no valueOf of its own (the one slot is read by `${r}`,
        // String(r), r.toString() AND `r + ""`, and only a valueOf-free
        // value gives those the same answer).
        if (shape.tostr) {
          d.push(`  r->${TOSTR_MEMBER} = scr_dyn_tostr_closure(d);`);
        }
        const buildInternal = new Set(internalSlotFields(shape));
        for (const f of shape.fields) {
          const keyLit = cStringLiteral(Buffer.from(f.name, "utf8"));
          const keyLen = Buffer.byteLength(f.name, "utf8");
          const fieldWant = cStringLiteral(Buffer.from(E.dynDesc(f.type), "utf8"));
          // An INTERNAL SLOT reads from the slot table and from nowhere
          // else: no own-data walk, no prototype, no accessor probe. The
          // failure names the RECEIVER, not the field, because the field
          // is not a key any program can see or supply — a receiver
          // carrying no slot is simply not a value this runtime built,
          // however it is spelled. Node's own answer for the same program
          // is a TypeError too ("back.isFile is not a function"), so the
          // two agree in kind; the texts differ, which is the documented
          // uncaught-report divergence.
          if (buildInternal.has(f.name)) {
            const sk = slotStorageKey(shape, f.name);
            const slotLit = cStringLiteral(Buffer.from(sk, "utf8"));
            const slotLen = Buffer.byteLength(sk, "utf8");
            d.push(`  {`);
            d.push(`    const ScrDyn *ms = scr_dyn_obj_slot_get(d, ${slotLit}, ${slotLen});`);
            d.push(fail(`    `, "record.slot", `!ms`, `NULL`, `${rel("r")}; `, INTERNAL_SLOT_WANT, `d`, `path`));
            d.push(`    r->${mangleField(f.name)} = ${childC(f.type)}(ms, path${childArg});`);
            d.push(afterChild(`    `, `${rel("r")}; `, `NULL`));
            d.push(`  }`);
            continue;
          }
          // Width tolerance: only declared fields are looked up — extra JSON
          // keys are simply never examined (check-and-extract, not shape
          // equality). A missing field fails as "got undefined" — except
          // optional-flavored fields (undefined-armed unions), where the
          // missing key IS the undefined arm: the interned immortal
          // instance, no retain owed (rc == SIZE_MAX).
          const utag = f.type.kind === "union" ? E.undefinedArmTag(f.type) : -1;
          // A field that can hold a FUNCTION takes the binding read: an
          // inherited method comes back bound to `d`, because the record
          // field is a COPY and calling it would otherwise leave `this`
          // undefined. It answers +1, so the field's read is scoped and
          // released; every other field keeps the borrowed read.
          const bind = typeMayHoldFunc(E, f.type);
          const readFn = bind ? "scr_dyn_obj_member_get" : "scr_dyn_obj_data_get";
          const mDecl = bind ? "ScrDyn *m" : "const ScrDyn *m";
          const drop = bind ? `    scr_dyn_release(m);` : null;
          d.push(`  {`);
          d.push(`    ScrDynPath p = { path, ${keyLit}, 0 };`);
          // The OWN half of the read the field itself takes through
          // [[Get]], asked of the same receiver and stopping before the
          // prototype chain.
          //
          // No '%'-spelling test, and there used to be one. An INTERNAL
          // SLOT left this loop above (buildInternal / internalSlotFields),
          // so a field reaching this line is a KEY however it is spelled —
          // a user's own "%dtype" included, and the record-to-dyn walker
          // masks that key too. The two have to ask internalSlotFields the
          // SAME question: a key the builder never stamps and the walker
          // does mask is DEMOTED to the prototype on every crossing.
          const maskBit = ownMaskKeyBit(shape, f.name);
          const setOwnC = maskBit
            ? `r->${OWNMASK_MEMBER}[${maskBit.byte}] |= ${maskBit.bit};`
            : null;
          if (setOwnC) {
            // scr_dyn_obj_get, NOT scr_dyn_obj_data_get and not
            // scr_dyn_obj_own_data: the member table alone is the OWN and
            // ENUMERABLE set — the prototype chain is what this whole slot
            // exists to exclude, and the `hidden` table holds the
            // NON-enumerable own properties, which Object.keys does not
            // list either. It is also, exactly, the table
            // Object.keys/JSON/assign iterate when the value stays
            // checked-dynamic, so the record's key list and the dyn
            // value's cannot disagree.
            d.push(`    if (scr_dyn_obj_get(d, ${keyLit}, ${keyLen})) ${setOwnC}`);
          }
          if (soft && f.type.kind !== "dyn") {
            // The ARM form's decision, and it is the MATCHER's, not the
            // builder's — dynArmHelper's own comment says why the two
            // differ and why this half has to be the predicate's.
            if (bind) {
              // The value comes from the BINDING read below, which hands
              // an inherited method back wrapped (signature "()"); the
              // DECISION has to stay on the raw member, which is what the
              // predicate tested. The one place a matcher call survives.
              d.push(`    const ScrDyn *raw = scr_dyn_obj_data_get(d, ${keyLit}, ${keyLen});`);
              if (utag >= 0) {
                d.push(
                  `    if (raw && !${E.dynMatchHelper(f.type)}(raw)) { *ok = false; ${rel("r")}; return NULL; }`,
                );
              } else {
                d.push(
                  `    if (!raw || !${E.dynMatchHelper(f.type)}(raw)) { *ok = false; ${rel("r")}; return NULL; }`,
                );
              }
              d.push(`    ${mDecl} = ${readFn}(d, ${keyLit}, ${keyLen});`);
              if (utag >= 0 && f.type.kind === "union") {
                d.push(`    if (!m) {`);
                d.push(`      m = scr_dyn_obj_accessor_get(d, ${keyLit}, ${keyLen});`);
                d.push(afterHard(`      `, `${rel("r")}; `, `NULL`));
                d.push(`    }`);
                d.push(`    if (!m) {`);
                d.push(
                  `      r->${mangleField(f.name)} = ${E.unitInstanceRef(f.type.unionId, utag)}; /* absent key -> the undefined arm */`,
                );
                d.push(`    } else {`);
                d.push(`      r->${mangleField(f.name)} = ${E.dynCheckHelper(f.type)}(m, &p);`);
                if (drop) d.push(`  ${drop}`);
                d.push(afterHard(`      `, `${rel("r")}; `, `NULL`));
                d.push(`    }`);
              } else {
                d.push(`    if (!m) { *ok = false; ${rel("r")}; return NULL; }`);
                d.push(`    r->${mangleField(f.name)} = ${E.dynCheckHelper(f.type)}(m, &p);`);
                if (drop) d.push(drop);
                d.push(afterHard(`    `, `${rel("r")}; `, `NULL`));
              }
            } else if (utag >= 0 && f.type.kind === "union") {
              // Optional, and the two halves part company HERE: a key
              // present as DATA is what the predicate tested, so it is
              // decided softly; a key only an ACCESSOR provides is what
              // the predicate never saw, so it keeps the builder's answer
              // — including its throw.
              d.push(`    ${mDecl} = ${readFn}(d, ${keyLit}, ${keyLen});`);
              d.push(`    if (m) {`);
              d.push(`      r->${mangleField(f.name)} = ${childC(f.type)}(m, &p${childArg});`);
              d.push(afterChild(`      `, `${rel("r")}; `, `NULL`));
              d.push(`    } else {`);
              d.push(`      ScrDyn *acc = scr_dyn_obj_accessor_get(d, ${keyLit}, ${keyLen});`);
              d.push(afterHard(`      `, `${rel("r")}; `, `NULL`));
              d.push(`      if (acc) {`);
              d.push(`        r->${mangleField(f.name)} = ${E.dynCheckHelper(f.type)}(acc, &p);`);
              d.push(`        scr_dyn_release(acc);`);
              d.push(afterHard(`        `, `${rel("r")}; `, `NULL`));
              d.push(`      } else {`);
              d.push(
                `        r->${mangleField(f.name)} = ${E.unitInstanceRef(f.type.unionId, utag)}; /* absent key -> the undefined arm */`,
              );
              d.push(`      }`);
              d.push(`    }`);
            } else {
              // Required, and no accessor probe: the predicate demands the
              // key present as DATA, so an arm whose member only a getter
              // provides never matched and the probe sat behind a
              // condition that could not hold.
              d.push(`    ${mDecl} = ${readFn}(d, ${keyLit}, ${keyLen});`);
              d.push(`    if (!m) { *ok = false; ${rel("r")}; return NULL; }`);
              d.push(`    r->${mangleField(f.name)} = ${childC(f.type)}(m, &p${childArg});`);
              d.push(afterChild(`    `, `${rel("r")}; `, `NULL`));
            }
            d.push(`  }`);
            continue;
          }
          // The same [[Get]]-minus-accessors read the predicate above
          // takes, and it has to be the same one for the DATA half.
          d.push(`    ${mDecl} = ${readFn}(d, ${keyLit}, ${keyLen});`);
          // ... and, ONLY when that read missed, the ACCESSOR half of
          // [[Get]] the borrow-only read above cannot answer. A field a
          // getter provides read as ABSENT: a required one threw
          // `expected string at $.a, got undefined` where Node answers the
          // getter's value, and an OPTIONAL one built the undefined arm
          // SILENTLY, which is the worse half. The probe sits on the miss
          // path alone, so a field the data read already answered runs no
          // getter and nothing that works today changes.
          d.push(`    ScrDyn *acc = NULL;`);
          d.push(`    if (!m) {`);
          d.push(`      acc = scr_dyn_obj_accessor_get(d, ${keyLit}, ${keyLen});`);
          d.push(afterHard(`      `, `${rel("r")}; `, `NULL`));
          d.push(`      m = acc;`);
          d.push(`    }`);
          // The +1 the accessor read owes, released exactly where the
          // binding read's own +1 is (and never twice: in the binding case
          // `m` IS `acc`, so `drop` is the one release).
          const dropAcc = bind ? null : `    if (acc) scr_dyn_release(acc);`;
          if (f.type.kind === "dyn") {
            // An `unknown` field: a present key passes through, a missing
            // one IS the undefined dyn value (JS's missing-property read).
            d.push(`    (void)p;`);
            d.push(
              `    r->${mangleField(f.name)} = scr_dyn_retain(m ? (ScrDyn *)m : scr_dyn_undefined());`,
            );
            if (dropAcc) d.push(dropAcc);
          } else if (utag >= 0 && f.type.kind === "union") {
            const unit = E.unitInstanceRef(f.type.unionId, utag);
            d.push(`    if (!m) {`);
            d.push(`      r->${mangleField(f.name)} = ${unit}; /* absent key -> the undefined arm */`);
            d.push(`    } else {`);
            d.push(`      r->${mangleField(f.name)} = ${E.dynCheckHelper(f.type)}(m, &p);`);
            if (drop) d.push(`  ${drop}`);
            if (dropAcc) d.push(`  ${dropAcc}`);
            d.push(`      if (scr_exc_pending()) { ${rel("r")}; return NULL; }`);
            d.push(`    }`);
          } else {
            d.push(fail(`    `, "record.field", `!m`, `NULL`, `${rel("r")}; `, fieldWant, `NULL`, `&p`));
            d.push(`    r->${mangleField(f.name)} = ${E.dynCheckHelper(f.type)}(m, &p);`);
            if (drop) d.push(drop);
            if (dropAcc) d.push(dropAcc);
            d.push(`    if (scr_exc_pending()) { ${rel("r")}; return NULL; }`);
          }
          d.push(`  }`);
        }
        // Index-signature shapes CAPTURE undeclared keys into the overflow
        // map (width tolerance became width capture — plain shapes above
        // keep ignoring extras). dyn value types retain the checked-dynamic tree subtree
        // as-is; concrete types validate each entry with its key path.
        if (shape.indexValue) {
          const iv = shape.indexValue;
          const skip = shape.fields
            .map((f) => {
              const keyLit = cStringLiteral(Buffer.from(f.name, "utf8"));
              const keyLen = Buffer.byteLength(f.name, "utf8");
              return `(e->key_len == ${keyLen} && memcmp(e->key, ${keyLit}, ${keyLen}) == 0)`;
            })
            .join(" || ");
          d.push(`  for (size_t i = 0; i < d->v.obj.len; i++) {`);
          d.push(`    const ScrDynEntry *e = &d->v.obj.entries[i];`);
          if (shape.fields.length > 0) d.push(`    if (${skip}) continue;`);
          if (iv.kind === "dyn") {
            d.push(`    ${cDecl(iv, "ev")} = scr_dyn_retain(e->value);`);
          } else {
            d.push(`    ScrDynPath p = { path, e->key, 0 };`);
            d.push(`    ${cDecl(iv, "ev")} = ${childC(iv)}(e->value, &p${childArg});`);
            d.push(afterChild(`    `, `${rel("r")}; `, `NULL`));
          }
          d.push(`    ScrStr *ek = scr_str_new(e->key, e->key_len);`);
          if (iv.kind === "f64" || iv.kind === "bool") {
            d.push(
              `    scr_map_set_str_${iv.kind === "f64" ? "f64" : "bool"}(r->${OVERFLOW_MEMBER}, ek, ev);`,
            );
          } else {
            d.push(`    scr_map_set_str_ref(r->${OVERFLOW_MEMBER}, ek, ev);`);
          }
          d.push(`    scr_str_release(ek);`);
          d.push(`  }`);
        }
        if (wide) d.push(`  if (sc_proj) scr_dyn_release(sc_proj);`);
        d.push(`  return r;`);
        break;
      }
      case "array": {
        const elem = t.elem;
        const c = childC(elem);
        d.push(fail(`  `, "array.kind", `d->kind != SCR_DYN_ARR`, `NULL`));
        d.push(`  ScrArr *a = ${E.arrNewC(elem, "d->v.arr.len")};`);
        d.push(`  for (size_t i = 0; i < d->v.arr.len; i++) {`);
        d.push(`    ScrDynPath p = { path, NULL, i };`);
        d.push(`    ${cDecl(elem, "e")} = ${c}(d->v.arr.items[i], &p${childArg});`);
        d.push(afterChild(`    `, `scr_arr_release(a); `, `NULL`));
        d.push(`    scr_arr_push_${elemAccess(elem)}(a, e);`);
        d.push(`  }`);
        d.push(`  return a;`);
        break;
      }
      case "union": {
        const def = E.unionsById.get(t.unionId);
        if (!def) throw new Error(`emitter bug: dynCheck of unknown union ${t.unionId}`);
        // Arms MOST SPECIFIC FIRST, first FULL match wins (dynCheckArmOrder:
        // a record match ignores extra keys, so an arm whose field set is a
        // SUBSET of another's would shadow it in canonical order).
        //
        // An arm used to be spelled `if (sc_dm_T(d)) return union_new(i,
        // sc_dc_T(d, path))` — one walk to decide, a second to build, and
        // the builder's own refusals kept alive by an invariant that two
        // independently generated functions had to maintain between them.
        // It is ONE walk now: the arm walker decides while it builds and
        // reports a miss through `aok`, so the next arm is tried with no
        // second opinion to disagree with and nothing to keep in lockstep.
        // A THROW inside a matched arm still propagates — `aok` false with
        // an exception pending — and a union with no surviving arm still
        // ends at its own union.nomatch below, so no way to die was
        // removed.
        //
        // And the CHECKED form of a union is now that arm walker plus its
        // refusal, not a second copy of the chain. It can be, for a reason
        // that holds for unions and for nothing else: a union's refusal
        // names the UNION at the union's OWN path — `expected number |
        // string at $.items[2]` — and never the arm that got furthest, so
        // the message a wrapper writes is the message the chain wrote,
        // byte for byte. A record could not do this (its refusal names the
        // MEMBER, at the member's path) and neither could an array (the
        // element index), which is why only this branch delegates.
        //
        // Without the delegation a union reachable BOTH as an arm and
        // directly emitted the whole chain twice, and on zapo that cost
        // more C than the merge saved.
        if (!soft) {
          const a = E.dynArmHelper(t);
          d.push(`  bool ok = true;`);
          d.push(`  ${cDecl(t, "v")} = ${a}(d, path, &ok);`);
          d.push(`  if (ok) return v;`);
          d.push(`  if (scr_exc_pending()) return NULL;`);
          d.push(
            `  ${E.dcHitC(name, "union.nomatch")}${E.dcFailC()}scr_dyn_check_fail(path, ${want}, d);`,
          );
          d.push(`  return NULL;`);
          break;
        }
        const order = dynCheckArmOrder(def, (id) => E.recordsById.get(id));
        // TWO PASSES when the union carries STRING-LITERAL DISCRIMINANTS,
        // one otherwise.
        //
        // Pass 1 walks the same widest-first order, but an arm that PINS a
        // property to a literal has to match that literal too, so a
        // `remove` value stops being taken by the structurally wider `set`
        // arm whose fields it also fits. Pass 2 is the old chain verbatim:
        // a value contradicting EVERY arm's literals still lands exactly
        // where it landed before, so nothing that compiles today starts
        // throwing on a value the asserted type never described.
        //
        // Which selector wins when the two disagree: inside a pass WIDTH
        // decides, across the passes the DISCRIMINANT does. The literal
        // predicate is tested BEFORE the arm is walked rather than after,
        // which is the same answer and strictly less work: an arm whose
        // discriminant contradicts the value is no longer walked at all.
        const passes = unionHasDiscrim(def) ? [true, false] : [false];
        for (const withLits of passes) {
          order.forEach((i) => {
            const arm = def.arms[i]!;
            const lits = withLits ? armDiscrimLits(def, i) : {};
            const litTest = Object.keys(lits).length > 0 ? `${dynLitHelper(E, lits)}(d)` : null;
            if (arm.kind === "undefinedT" || arm.kind === "nullT") {
              // A matched unit arm builds nothing: the result is THE interned
              // immortal instance (rc == SIZE_MAX — RC entry points and the
              // collector both skip it, so no retain is owed). The kind test
              // is inline because the whole of the predicate for these two
              // arms WAS that kind test. Parsed JSON never matches the
              // undefined one (no undefined in JSON text — a MISSING record
              // key builds it in the record builder above), but the
              // undefined dyn value can arrive from `unknown`
              // index-signature overflows.
              const k = arm.kind === "nullT" ? "SCR_DYN_NULL" : "SCR_DYN_UNDEF";
              const test = litTest ? `d->kind == ${k} && ${litTest}` : `d->kind == ${k}`;
              d.push(`  if (${test}) {`);
              d.push(`    return ${E.unitInstanceRef(t.unionId, i)};`);
              d.push(`  }`);
              return;
            }
            const a = E.dynArmHelper(arm);
            d.push(litTest ? `  if (${litTest}) {` : `  {`);
            d.push(`    bool aok = true;`);
            d.push(`    ${cDecl(arm, "av")} = ${a}(d, path, &aok);`);
            if (arm.kind === "f64") {
              d.push(`    if (aok) return scr_union_new_f64(${i}, av);`);
            } else if (arm.kind === "bool") {
              d.push(`    if (aok) return scr_union_new_bool(${i}, av);`);
            } else {
              const rc = vAdapters(arm);
              d.push(
                `    if (aok) return scr_union_new_ref(${i}, av, &${rc.retain}, &${rc.release}, ${E.traceArgC(arm)});`,
              );
            }
            d.push(`    if (scr_exc_pending()) { *ok = false; return NULL; }`);
            d.push(`  }`);
          });
        }
        // No arm survived. The refusal belongs to the CHECKED form above,
        // which is the only caller that has a message to write; here the
        // union simply reports the miss and the caller tries its own next
        // arm.
        d.push(`  *ok = false;`);
        d.push(`  return NULL;`);
        break;
      }
      case "func": {
        // The checked-dynamic function boundary, OUT direction: a
        // non-function kind fails like any dynCheck; an IDENTICAL boxed
        // signature (the interned typeKey — same key ⇔ same IR type ⇔
        // same ABI) unwraps the closure directly (identity preserved:
        // `mustCall(fn)` handed back to a slot of fn's own type IS fn's
        // wrapper, retained); anything else wraps in the per-target
        // adapter closure, which keeps the two things it needs from the
        // dyn value SEPARATELY: the CLOSURE in a FUNC box (caps[0]) and
        // that closure's thunk in a scalar box (caps[1]).
        //
        // It kept the whole ScrDyn in ONE untraced obj-box until now.
        // ScrDyn carries no cycle header, so that edge was invisible to
        // the collector — and one invisible strong reference is all trial
        // deletion needs to declare a dead ring externally referenced. A
        // listener registered through this adapter had rc 2 (the emitter
        // registry's traced `orig` and the adapter's untraced dyn),
        // markGray reached one of them, scan saw rc > 0 and blackened the
        // whole subgraph: the client graph behind the listener leaked. A
        // FUNC box is traced by construction and a function pointer owns
        // nothing and closes no ring, so both edges are now accounted.
        // NON-adaptable targets have no adapter to wrap in: exact unwrap
        // or the path-annotated TypeError (the frontend's unwrap-only
        // cast semantics — only a value boxed from the slot's own type
        // can honestly fill it).
        const sigLit = cStringLiteral(Buffer.from(key, "utf8"));
        if (soft) {
          // The ARM form is the PREDICATE's rule and stops at the exact
          // signature: the adapter below would make every function fit
          // every function arm, so `{a: () => number} | {a: () => string}`
          // would take arm 0 for a string-returning value and only throw
          // later, inside the adapter, with the union already wearing the
          // wrong tag. Behind a match the adapter branch was unreachable
          // anyway — the predicate had already demanded this strcmp.
          d.push(`  (void)path;`);
          d.push(
            `  if (d->kind != SCR_DYN_FUNC || strcmp(d->v.fn.sig, ${sigLit}) != 0) { *ok = false; return NULL; }`,
          );
          d.push(`  return scr_closure_retain(d->v.fn.clo);`);
          break;
        }
        d.push(fail(`  `, "func.kind", `d->kind != SCR_DYN_FUNC`, `NULL`));
        d.push(`  if (strcmp(d->v.fn.sig, ${sigLit}) == 0) return scr_closure_retain(d->v.fn.clo);`);
        if (canAdaptDynFuncTo(t, (id) => E.recordsById.get(id), (id) => E.unionsById.get(id))) {
          const adapter = dynFuncAdapterHelper(E, t);
          d.push(`  {`);
          d.push(`    ScrClosure *a = scr_closure_new((void *)&${adapter}, 2);`);
          d.push(`    a->caps[0] = scr_box_new(SCR_BOX_FUNC); /* TRACED — the ring closes here */`);
          d.push(`    scr_box_set_ref(a->caps[0], scr_closure_retain(d->v.fn.clo));`);
          d.push(`    a->caps[1] = scr_box_new(SCR_BOX_F64); /* the call descriptor: owns nothing */`);
          d.push(`    scr_box_set_thunk(a->caps[1], d->v.fn.thunk);`);
          d.push(`    return a;`);
          d.push(`  }`);
        } else {
          d.push(
            `  ${E.dcHitC(name, "func.noadapt")}${E.dcFailC()}scr_dyn_check_fail(path, ${want}, d);`,
          );
          d.push(`  return NULL;`);
        }
        break;
      }
      default: {
        // Runtime HANDLE targets: a tag-checked reference unwrap (+1 —
        // identity, no copy; the runtime throws the path-annotated
        // TypeError on any other kind or tag). No union arm can be one:
        // the match predicate refused these kinds outright, so the arm
        // form refuses them in exactly the same place and with the same
        // shape of message.
        const h = DYN_HANDLE_KINDS.get(t.kind);
        if (h && !soft) {
          d.push(`  return (${cType(t).trim()})scr_dyn_handle_unbox(d, ${h.tag}, path, ${want});`);
          break;
        }
        throw new Error(`emitter bug: ${soft ? "dynArm" : "dynCheck"} of non-JSON type ${t.kind}`);
      }
    }
  }

/** The emitted static→dyn converter for one type:
   * `static ScrDyn *sc_td_<n>(<T> v)` — build a fresh dyn value from a
   * static one (+1), DEEP-COPYING composites (a dyn value never aliases
   * static storage — the jsMarshal stance; bytes are the ONE exception,
   * see the `bytes` arm). Domain: the JSON-safe kinds
   * plus undefined-armed unions (the undefined arm becomes the undefined
   * dyn singleton) and index-signature records (whose overflow entries
   * copy over). The operand is borrowed. Never throws. */
  export function toDynHelper(E: CEmitter, t: IrType): string {
    const key = typeKey(t);
    const existing = E.toDynFns.get(key);
    if (existing) return existing;
    const name = `sc_td_${E.toDynFns.size}`;
    E.toDynFns.set(key, name);
    const sig = `static ScrDyn *${name}(${cDecl(t, "v")})`;
    E.walkerProtos.push(`${sig}; /* to-dyn ${key} */`);
    const d: string[] = [`${sig} { /* to-dyn ${key} */`];
    switch (t.kind) {
      case "f64":
        d.push(`  return scr_dyn_new_num(v);`);
        break;
      case "bool":
        d.push(`  return scr_dyn_new_bool(v);`);
        break;
      case "string":
        d.push(`  return scr_dyn_new_str(v); /* retains v */`);
        break;
      case "undefinedT":
        // A bare unit field (`x: undefined` in a record — the tls
        // options-record's explicit-absent member): the dyn unit value.
        d.push(`  (void)v; return scr_dyn_retain(scr_dyn_undefined());`);
        break;
      case "nullT":
        d.push(`  (void)v; return scr_dyn_new_null();`);
        break;
      case "object":
        // %Error keeps the checked-dynamic tree's ERROR ENCODING ({%error,
        // name, message, code?}), the representation every caught value
        // and rejection reason already arrives as.
        if (t.className === "%Error") {
          d.push(`  return scr_dyn_from_error(v);`);
          break;
        }
        // Every other class instance boxes BY REFERENCE — no copy, so the
        // dyn value and the static one are the same object and a write
        // through either is seen by both (the bytes arm's aliasing, for
        // the same reason: one representation, not two). The descriptor
        // carries the class's own RC pair, so the box's +1 is the
        // ordinary one and the operand stays borrowed.
        d.push(`  return scr_dyn_new_objinst(v, &${E.dynClassDesc(t.className)});`);
        break;
      case "dyn":
        // A dyn member of a converting composite (a dyn record field): the
        // dyn value passes through by reference — already a dyn, already
        // immutable-through-copies.
        d.push(`  return scr_dyn_retain(v);`);
        break;
      case "bigint":
        // The digits, RETAINED rather than copied. Sharing is
        // unobservable here in a way it is not for arrays and records: a
        // bigint is immutable, so there is no write through either side
        // for the other to miss. The constructor lives in the GATED
        // bigint unit (it installs the ops table the always-linked dyn
        // core dispatches through), which is sound because a program
        // that can reach this line necessarily uses bigint and therefore
        // links that unit.
        d.push(`  return scr_dyn_from_big(v);`);
        break;
      case "bytes":
        // bytes<u8> → the checked-dynamic tree's bytes kind, payload SHARED
        // by reference. A typed array is the one composite whose two
        // representations are the SAME object — ScrBytes is refcounted and
        // already aliasable (the `backing` view chain) — so the boundary
        // has no reason to copy, and copying is observably wrong: JS's
        // `write(val, buf, pos) { buf[pos] = val }` writes the CALLER's
        // buffer. Retaining keeps the deep-copy stance's ownership
        // contract (the operand stays borrowed) and adds Node's aliasing.
        // bytes<buf> (ArrayBuffer) shares that argument exactly — same
        // ScrBytes, same aliasing, so `new Uint8Array(buf)` taken on
        // either side sees the other's writes — and lands in its OWN dyn
        // kind rather than this one. Not a stylistic split: an
        // ArrayBuffer has no length, no indices and no elements, and
        // every reader of SCR_DYN_BYTES assumes all three.
        {
          const bk = DYN_BYTES_KINDS.get(t.elem);
          if (!bk) throw new Error(`emitter bug: to-dyn of bytes<${t.elem}>`);
          d.push(bk.dk === "ARRBUF"
            ? `  return scr_dyn_new_arrbuf_ref(v);`
            : `  return scr_dyn_new_bytes_ref(v);`);
        }
        break;
      case "map":
      case "set":
        // A Map/Set boxes BY REFERENCE — the same ScrMap, retained, so a
        // write through either side is seen by both (the bytes and
        // instance arms' aliasing, for the same reason: one
        // representation, not two). The second argument is the interned
        // typeKey of THIS type, the static literal that makes the box's
        // matcher and its unwrap exact; see the kind's comment in
        // scr_runtime.h for the Map<string,number>/Set<string> collision
        // that makes it necessary rather than tidy.
        d.push(`  return scr_dyn_new_map_ref(v, ${cStringLiteral(Buffer.from(key, "utf8"))});`);
        break;
      case "record": {
        const shape = E.recordsById.get(t.shapeId);
        if (!shape) throw new Error(`emitter bug: to-dyn of unknown shape ${t.shapeId}`);
        // CYCLE-CAPABLE shapes guard the deep copy: a cyclic value has no
        // finite dyn copy, so enter TRAPS on re-entry (SEMANTICS.md — Node
        // shares the reference instead of copying).
        const cyclicRec = E.traceAdapterC(t) !== null;
        if (cyclicRec) d.push(`  scr_dyn_from_enter(v);`);
        if (shape.tuple) {
          // A tuple converts as the JSON ARRAY it is everywhere else.
          const byIndex = [...shape.fields].sort((a, b) => Number(a.name) - Number(b.name));
          d.push(`  ScrDyn *d = scr_dyn_new_arr();`);
          for (const f of byIndex) {
            d.push(`  scr_dyn_arr_push(d, ${E.toDynHelper(f.type)}(v->${mangleField(f.name)}));`);
          }
          if (cyclicRec) d.push(`  scr_dyn_from_leave();`);
          d.push(`  return d;`);
          break;
        }
        // A shape the frontend interned from a BUILTIN carries how Node
        // RENDERS it (IrRecordShape.builtin). Both halves already existed
        // in the dyn encoding and neither was ever set from a record:
        // null_proto is Object.create(null)'s flag, and `cname` is the
        // name `new F()` copies onto its instances and scr_insp_dyn
        // already prints as the `F { ... }` prefix.
        // ...and on an ARMED shape the claim is asked of the INSTANCE
        // (nullProtoRule / nullProtoCondC), not folded away for the whole
        // shape. It used to be folded away, and that was a silent PASS:
        // a module that also MATERIALISES this shape out of a dynamic
        // value armed it, the whole shape stopped claiming a null
        // prototype, and `deepStrictEqual(os.userInfo(), {…the same five
        // members…})` compared EQUAL where Node throws — because
        // scr_assert.c's own-object arm gates on ScrDyn.null_proto first.
        // Mask byte 0 carries the source object's answer
        // (OWNMASK_SRC_NULL_PROTO), so both kinds of instance are right:
        // a runtime-built one keeps the claim, a crossed one answers about
        // its own source. Nothing here can leave null_proto set behind a
        // live [[Prototype]] either — a crossed instance whose source had
        // a chain reports false, and scr_dyn_obj_set_proto now retracts
        // the flag as well, so the two fields cannot disagree.
        {
          const rule = nullProtoRule(shape);
          d.push(
            rule.kind === "const"
              ? rule.value
                ? `  ScrDyn *d = scr_dyn_new_obj_null_proto();`
                : `  ScrDyn *d = scr_dyn_new_obj();`
              : `  ScrDyn *d = scr_dyn_new_obj_flavor(${nullProtoCondC(shape, "v")});`,
          );
        }
        if (shape.builtin?.ctorName) {
          d.push(`  scr_dyn_obj_set_ctor_name(d, ${cStringLiteral(Buffer.from(shape.builtin.ctorName, "utf8"))});`);
        }
        // The INHERITED half of an armed shape's members, built lazily and
        // linked as the fresh object's [[Prototype]] at the end (see the
        // per-field arm below). NULL whenever the value carried no
        // inherited member, which is every record built anywhere but a
        // crossing - those emit nothing extra at all.
        if (shape.ownmask) d.push(`  ScrDyn *sc_proto = NULL;`);
        // Keys insert in DECLARED order — the dyn object's insertion order
        // is observable (Object.keys/for-in over checked-dynamic values,
        // dyn JSON), so it must be JS's (SEMANTICS.md 36's stance, same as
        // the JSON writer above).
        //
        // Fields declaredOrder OMITS are INTERNAL SLOTS and go to
        // scr_dyn_obj_set_slot, not into the member table. They used to be
        // appended to `entries` after the visible keys, deliberately, "so a
        // record→dyn→record round trip keeps their data" — a real
        // requirement met in the one place that could not hold it, because
        // `entries` IS Object.keys, for-in, spread, Object.assign,
        // Object.entries, JSON.stringify, structuredClone and
        // util.inspect at once. Measured: a Dirent through `unknown`
        // listed "%dtype" on thirteen surfaces and printed
        // {"name":…,"parentPath":…,"%dtype":1}. The slot table keeps the
        // round trip and answers none of them — and, in the other
        // direction, a user object that merely SPELLS "%dtype" carries no
        // slot, so it is no longer mistaken for a Dirent.
        {
          const byName = new Map(shape.fields.map((f) => [f.name, f]));
          const order = shape.declaredOrder ?? shape.fields.map((f) => f.name);
          const internal = new Set(internalSlotFields(shape));
          const dynFields = [
            ...order.map((n) => byName.get(n)).filter((f) => f !== undefined),
            ...shape.fields.filter((f) => internal.has(f.name)),
          ];
          for (const f of dynFields) {
            const keyLit = cStringLiteral(Buffer.from(f.name, "utf8"));
            const keyLen = Buffer.byteLength(f.name, "utf8");
            // toDynExprC, not the converter directly: a FUNCTION field boxes
            // through the closure path (anonymous — the static name is gone
            // by the time a field flows through here), which the per-type
            // converter has no case for.
            const fv = f.type.kind === "func"
              ? dynFuncFieldBoxC(E, f.type, `v->${mangleField(f.name)}`, f.name)
              : toDynExprC(E, f.type, `v->${mangleField(f.name)}`);
            // An UNDEFINED-ARMED field's key exists exactly when its
            // run-time tag is not the undefined arm — the same rule the
            // frontend's interned keys helper writes for a record RECEIVER
            // (recordKeysArrayCall's tag test). Setting it unconditionally
            // answered the shape's declared field list instead of the
            // value's own keys: `{a: 1}` widened to `object` listed
            // "a,b,c", and Object.values/entries aborted in the boundary
            // validator on the undefined it then had to walk. The
            // presence-gated store is the whole fix, and it is spelled as a
            // DIFFERENT function rather than a rule inside scr_dyn_obj_set
            // because a checked-dynamic object really can hold an
            // undefined-valued key.
            // Fields declaredOrder OMITS are INTERNAL SLOTS and leave before
            // any of this: not JS keys at all, so they take neither the
            // undefined-arm rule nor the own-key mask, and
            // scr_dyn_obj_set_slot keeps the record-to-dyn-to-record round
            // trip (Dirent's %dtype) without putting them in the member
            // table.
            //
            // THIS TEST USED TO READ f.name.startsWith("%") ON THIS BRANCH,
            // and internalSlotFields is not the same test spelled another
            // way - it is the STRICTER one, and the difference is a real
            // program. A user's own { "%dtype": 7, name: "n" } IS in its
            // shape's declaredOrder, so it is an ordinary key and has to
            // take the mask like any other; the spelling test exempted it,
            // which would have written it unconditionally and re-listed an
            // INHERITED "%dtype" as own after a crossing - this block's own
            // defect, surviving in the one namespace nobody would look at.
            //
            // The slot travels under its STORAGE key, which is the Node
            // symbol description when the shape names one (slotStorageKey,
            // ir/nodes.ts) and the field name otherwise. That is a question
            // about WHERE the cell lives, and the exemption above is still
            // internalSlotFields and nothing else: the two questions look
            // alike and are not, which is the defect the merge above
            // describes, one namespace over.
            if (internal.has(f.name)) {
              const sk = slotStorageKey(shape, f.name);
              const slotLit = cStringLiteral(Buffer.from(sk, "utf8"));
              const slotLen = Buffer.byteLength(sk, "utf8");
              d.push(`  scr_dyn_obj_set_slot(d, ${slotLit}, ${slotLen}, ${fv}); /* internal slot: no key */`);
              continue;
            }
            const setBase = isUndefinedArmedUnion(f.type, (id) => E.unionsById.get(id))
              ? `scr_dyn_obj_set_present(d, ${keyLit}, ${keyLen}, sc_fv);`
              : `scr_dyn_obj_set(d, ${keyLit}, ${keyLen}, sc_fv);`;
            const bit = ownMaskKeyBit(shape, f.name);
            if (!bit) {
              d.push(
                isUndefinedArmedUnion(f.type, (id) => E.unionsById.get(id))
                  ? `  scr_dyn_obj_set_present(d, ${keyLit}, ${keyLen}, ${fv});`
                  : `  scr_dyn_obj_set(d, ${keyLit}, ${keyLen}, ${fv});`,
              );
            } else {
              // The crossing MATERIALISES the key list, so it is the last
              // place the source object's own keys can still be told from
              // the shape's declared field list. An instance a dynCheck
              // builder wrote carries the answer in its mask; every other
              // instance falls through to the undefined-arm rule, which is
              // the line above, unchanged.
              //
              // AND AN INHERITED MEMBER IS NOT DELETED, IT IS DEMOTED. The
              // first cut dropped it, which made Object.keys right and
              // broke every READ on the far side: zapo's own app-state sync
              // lost its keys and a receipt read threw "expected object |
              // undefined at $, got object", because a member the source
              // carried on its prototype simply stopped existing once the
              // value crossed. JS does not lose it — "x as T" is the
              // identity and [[Get]] still walks the chain — so the
              // conversion rebuilds that chain: own members become KEYS of
              // the fresh object, inherited ones become members of a
              // PROTOTYPE object linked behind it (scr_dyn_obj_set_proto,
              // one of the runtime's five set_proto call sites and the only
              // one a crossing reaches). Object.keys, JSON, hasOwn and
              // assign iterate the own entries and see exactly the own set;
              // [[Get]], "in" and the next dynCheck walk the chain and find
              // the value, which is what JavaScript answers.
              const m = `v->${OWNMASK_MEMBER}`;
              d.push(`  {`);
              d.push(`    ScrDyn *sc_fv = ${fv};`);
              d.push(`    if (${m}[0]) {`);
              d.push(`      if (${m}[${bit.byte}] & ${bit.bit}) {`);
              d.push(`        scr_dyn_obj_set(d, ${keyLit}, ${keyLen}, sc_fv);`);
              d.push(`      } else if (sc_fv != NULL && sc_fv->kind != SCR_DYN_UNDEF) {`);
              if (shape.srcproto) {
                // The SOURCE's own chain still answers this member, so
                // linking it below is the whole demotion and there is
                // nothing to synthesise. That is what keeps [[Prototype]]
                // IDENTITY: two crossed values of one shape share one
                // prototype object, which is what deepStrictEqual compares
                // and what Node answers.
                d.push(`        if (scr_dyn_proto_has(v->${SRCPROTO_MEMBER}, ${keyLit}, ${keyLen})) {`);
                d.push(`          scr_dyn_release(sc_fv); /* the source's own chain carries it */`);
                d.push(`        } else {`);
                // A member the source carried as a NON-ENUMERABLE own
                // property is on neither table: not an own key, and not on
                // the chain either. Dropping it would lose a value, so it
                // is demoted the old way and the source's chain is linked
                // BEHIND the synthesised object.
                d.push(`          if (sc_proto == NULL) sc_proto = scr_dyn_new_obj(); /* not on the source's chain */`);
                d.push(`          scr_dyn_obj_set(sc_proto, ${keyLit}, ${keyLen}, sc_fv);`);
                d.push(`        }`);
              } else {
                d.push(`        if (sc_proto == NULL) sc_proto = scr_dyn_new_obj(); /* inherited members */`);
                d.push(`        scr_dyn_obj_set(sc_proto, ${keyLit}, ${keyLen}, sc_fv);`);
              }
              d.push(`      } else {`);
              d.push(`        scr_dyn_release(sc_fv); /* absent on the source object entirely */`);
              d.push(`      }`);
              d.push(`    } else {`);
              d.push(`      ${setBase}`);
              d.push(`    }`);
              d.push(`  }`);
            }
          }
        }
        if (shape.indexValue) {
          const iv = shape.indexValue;
          const m = `v->${OVERFLOW_MEMBER}`;
          // JS OWN-KEY order (integer-like keys ascending first) — the same
          // enumeration Object.keys and the JSON writer answer.
          d.push(`  {`);
          d.push(`    ScrArr *ks = scr_map_keys_js_order(${m});`);
          d.push(`    for (size_t i = 0; i < ks->len; i++) {`);
          d.push(`      ScrStr *k = (ScrStr *)scr_arr_get_ref(ks, (double)i);`);
          if (iv.kind === "f64" || iv.kind === "bool") {
            d.push(`      ${cDecl(iv, "sv")} = 0;`);
            d.push(`      scr_map_get_str_${iv.kind === "f64" ? "f64" : "bool"}(${m}, k, &sv);`);
            d.push(`      scr_dyn_obj_set(d, k->data, k->len, scr_dyn_new_${iv.kind === "f64" ? "num" : "bool"}(sv));`);
          } else if (iv.kind === "dyn") {
            // get_str_ref returns +1 — exactly the ownership obj_set takes.
            d.push(`      scr_dyn_obj_set(d, k->data, k->len, (ScrDyn *)scr_map_get_str_ref(${m}, k));`);
          } else {
            d.push(`      ${cDecl(iv, "e")} = (${cType(iv).trim()})scr_map_get_str_ref(${m}, k);`);
            d.push(`      scr_dyn_obj_set(d, k->data, k->len, ${E.toDynHelper(iv)}(e));`);
            d.push(`      ${releaseCallC(iv, "e")};`);
          }
          d.push(`      scr_str_release(k);`);
          d.push(`    }`);
          d.push(`    scr_arr_release(ks);`);
          d.push(`  }`);
        }
        // The [[Prototype]] link, once, after every member has been placed:
        // scr_dyn_obj_set_proto RETAINS, so the builder's own +1 is
        // released here and the chain is owned by `d` alone.
        if (shape.ownmask) {
          d.push(`  if (sc_proto != NULL) {`);
          if (shape.srcproto) {
            // The SOURCE's chain goes BEHIND the synthesised object, so a
            // member that was on neither the member table nor the chain
            // (a non-enumerable own property) is still reachable AND every
            // inherited one still resolves to the one object it came from.
            d.push(`    if (v->${SRCPROTO_MEMBER} != NULL) scr_dyn_obj_set_proto(sc_proto, v->${SRCPROTO_MEMBER});`);
          }
          d.push(`    scr_dyn_obj_set_proto(d, sc_proto); /* the members the source only INHERITED */`);
          d.push(`    scr_dyn_release(sc_proto);`);
          if (shape.srcproto) {
            // ...and with nothing synthesised the chain IS the source's,
            // one object, which is what restores [[Prototype]] identity.
            d.push(`  } else if (v->${SRCPROTO_MEMBER} != NULL) {`);
            d.push(`    scr_dyn_obj_set_proto(d, v->${SRCPROTO_MEMBER}); /* the SOURCE's own chain, one object */`);
          }
          d.push(`  }`);
        }
        if (cyclicRec) d.push(`  scr_dyn_from_leave();`);
        d.push(`  return d;`);
        break;
      }
      case "array": {
        const elem = t.elem;
        // Cycle-capable arrays guard the deep copy like records above.
        const cyclicArr = E.traceAdapterC(t) !== null;
        if (cyclicArr) d.push(`  scr_dyn_from_enter(v);`);
        d.push(`  ScrDyn *d = scr_dyn_new_arr();`);
        d.push(`  for (size_t i = 0; i < v->len; i++) {`);
        if (elem.kind === "f64") {
          d.push(`    scr_dyn_arr_push(d, scr_dyn_new_num(scr_arr_get_f64(v, (double)i)));`);
        } else if (elem.kind === "bool") {
          d.push(`    scr_dyn_arr_push(d, scr_dyn_new_bool(scr_arr_get_bool(v, (double)i)));`);
        } else {
          d.push(`    ${cDecl(elem, "e")} = (${cType(elem).trim()})scr_arr_get_ref(v, (double)i);`);
          d.push(`    scr_dyn_arr_push(d, ${E.toDynHelper(elem)}(e));`);
          d.push(`    ${releaseCallC(elem, "e")};`);
        }
        d.push(`  }`);
        if (cyclicArr) d.push(`  scr_dyn_from_leave();`);
        d.push(`  return d;`);
        break;
      }
      case "union": {
        const def = E.unionsById.get(t.unionId);
        if (!def) throw new Error(`emitter bug: to-dyn of unknown union ${t.unionId}`);
        d.push(`  switch (v->tag) {`);
        def.arms.forEach((arm, i) => {
          if (arm.kind === "undefinedT") {
            d.push(`  case ${i}: return scr_dyn_retain(scr_dyn_undefined());`);
          } else if (arm.kind === "nullT") {
            d.push(`  case ${i}: return scr_dyn_new_null();`);
          } else if (arm.kind === "f64") {
            d.push(`  case ${i}: return scr_dyn_new_num(scr_union_get_f64(v));`);
          } else if (arm.kind === "bool") {
            d.push(`  case ${i}: return scr_dyn_new_bool(scr_union_get_bool(v));`);
          } else if (arm.kind === "func") {
            // A boxable function arm crosses through the checked-dynamic
            // function boundary (the dynFrom func special case, sans name).
            d.push(`  case ${i}: return ${dynFuncBoxHelper(E, arm)}((ScrClosure *)scr_union_peek(v), NULL, NULL);`);
          } else {
            d.push(`  case ${i}: return ${E.toDynHelper(arm)}((${cType(arm).trim()})scr_union_peek(v));`);
          }
        });
        d.push(`  default: ${E.badTagAbortC()};`);
        d.push(`  }`);
        break;
      }
      case "promise": {
        // Promises box by REFERENCE (SCR_DYN_PROMISE — identity is the
        // promise): promise<dyn> carries its ScrPromise directly (the
        // payload is already a dyn value); any other inner boxes an
        // ADAPTER promise whose settle callback converts the payload
        // (rejections copy raw inside the runtime's cb-waiter machinery).
        if (t.inner.kind === "dyn") {
          d.push(`  return scr_dyn_new_promise(v);`);
          break;
        }
        d.push(`  return scr_dyn_new_promise_adapting(v, &${promiseDynAdapterHelper(E, t.inner)});`);
        break;
      }
      default: {
        // Runtime HANDLE kinds box by REFERENCE (identity — no copy):
        // scr_dyn_new_handle retains the borrowed operand through the
        // tag's installed ops.
        const h = DYN_HANDLE_KINDS.get(t.kind);
        if (h) {
          d.push(`  return scr_dyn_new_handle(v, ${h.tag});`);
          break;
        }
        throw new Error(`emitter bug: to-dyn of unsupported type ${t.kind}`);
      }
    }
    d.push(`}`, ``);
    E.walkerDefs.push(...d);
    return name;
  }

/** The checked-dynamic tree-promise settle adapter for one fulfillment payload type:
   * `static void sc_pda_<n>(ScrPromise *dst, ScrPromise *src)` — read
   * src's fulfilled payload by its compile-time kind, convert it to a dyn
   * value, and fulfill dst with it (scr_dyn_new_promise_adapting's
   * callback; rejections never reach an adapter — the runtime copies them
   * raw). Interned per inner typeKey. */
  export function promiseDynAdapterHelper(E: CEmitter, inner: IrType): string {
    const key = typeKey(inner);
    const existing = E.promiseDynAdapters.get(key);
    if (existing) return existing;
    const name = `sc_pda_${E.promiseDynAdapters.size}`;
    E.promiseDynAdapters.set(key, name);
    const sig = `static void ${name}(ScrPromise *dst, ScrPromise *src)`;
    E.walkerProtos.push(`${sig}; /* dyn-box settle adapter for promise<${key}> */`);
    const d: string[] = [`${sig} { /* dyn-box settle adapter for promise<${key}> */`];
    const fulfill = (expr: string) =>
      `  scr_promise_fulfill_ref(dst, ${expr}, scr_dyn_retain_v, scr_dyn_release_v, NULL);`;
    switch (inner.kind) {
      case "void":
      case "undefinedT":
        d.push(`  (void)src;`);
        d.push(fulfill(`scr_dyn_retain(scr_dyn_undefined())`));
        break;
      case "nullT":
        d.push(`  (void)src;`);
        d.push(fulfill(`scr_dyn_new_null()`));
        break;
      case "f64":
        d.push(fulfill(`scr_dyn_new_num(scr_promise_payload_f64(src))`));
        break;
      case "bool":
        d.push(fulfill(`scr_dyn_new_bool(scr_promise_payload_bool(src))`));
        break;
      case "string":
        d.push(`  ScrStr *s = scr_promise_payload_str(src);`);
        d.push(`  ScrDyn *dv = scr_dyn_new_str(s); /* retains s */`);
        d.push(`  scr_str_release(s);`);
        d.push(fulfill(`dv`));
        break;
      default: {
        // Ref-payload inners (records, arrays, bytes, %Error, unions,
        // nested promises, handles): extract (+1 via the stored retain),
        // convert through the shared to-dyn spelling, release the extract.
        d.push(`  ${cDecl(inner, "pv")} = (${cType(inner).trim()})scr_promise_payload_ref(src);`);
        d.push(`  ScrDyn *dv = ${toDynExprC(E, inner, "pv")};`);
        if (isRefCounted(inner)) d.push(`  ${releaseCallC(inner, "pv")};`);
        d.push(fulfill(`dv`));
        break;
      }
    }
    d.push(`}`, ``);
    E.walkerDefs.push(...d);
    return name;
  }

/* ── the checked-dynamic function boundary (nodes.ts) ─────────────────
   * Three interned per-signature helpers:
   *
   *   sc_dfk_<n> — the CALL THUNK a dyn-boxed closure carries: validate
   *   each dyn argument into the declared param type (JS arity: extras
   *   ignored, missing args are the undefined dyn value — a param type
   *   the undefined value fails checks throws the path-annotated
   *   TypeError), call through the closure, convert the result back to a
   *   dyn value (+1).
   *
   *   sc_dfb_<n> — the BOX builder dynFrom emits: a fresh SCR_DYN_FUNC
   *   node carrying the retained closure, the thunk, the arity, the
   *   interned signature key (typeKey — dynCheck's exact-unwrap fast
   *   path), and the best-effort name.
   *
   *   sc_dfa_<n> — the ADAPTER a func-targeted dynCheck wraps a
   *   NON-identical boxed signature in: a closure of the TARGET type
   *   whose body converts each typed argument INTO dyn, calls the boxed
   *   thunk, and validates the dyn result into the target's return type.
   */

/** The dyn argument spelling of one static value (thunk results, adapter
   * arguments): dyn passes through (+1 via retain — callers own the
   * result uniformly), funcs box (anonymous — the static name is gone by
   * the time a value flows through an adapter; SEMANTICS.md), everything
   * else rides the toDyn converter. `expr` is BORROWED in every arm. */
  function toDynExprC(E: CEmitter, t: IrType, expr: string): string {
    if (t.kind === "dyn") return `scr_dyn_retain(${expr})`;
    if (t.kind === "func") return `${E.dynFuncBoxHelper(t)}(${expr}, NULL, NULL)`;
    // An island value wraps by reference (scalar-normalizing) — the
    // jsval-returning callback shape of the routed-dispatch lane.
    if (t.kind === "jsval") return `scr_dyn_from_jsval(${expr})`;
    return `${E.toDynHelper(t)}(${expr})`;
  }

/** The call thunk for one closure signature (see the block comment). */
  export function dynFuncThunkHelper(E: CEmitter, t: IrType & { kind: "func" }): string {
    const key = typeKey(t);
    const existing = E.dynFuncThunks.get(key);
    if (existing) return existing;
    const name = `sc_dfk_${E.dynFuncThunks.size}`;
    E.dynFuncThunks.set(key, name);
    const sig = `static ScrDyn *${name}(ScrClosure *c, ScrDyn *const *args, size_t argc)`;
    E.walkerProtos.push(`${sig}; /* dyn call thunk for ${key} */`);
    const d: string[] = [`${sig} { /* dyn call thunk for ${key} */`];
    if (t.params.length === 0) d.push(`  (void)args;`);
    d.push(`  (void)argc;`);
    t.params.forEach((p, i) => {
      // JS arity: a missing argument IS the undefined dyn value; the
      // param's own check decides whether that flies (dyn params take
      // anything; a number param throws the catchable TypeError).
      d.push(`  ${cDecl(p, `a${i}`)};`);
      d.push(`  {`);
      d.push(`    const ScrDyn *ad = ${i} < argc ? args[${i}] : scr_dyn_undefined();`);
      if (p.kind === "dyn") {
        d.push(`    a${i} = scr_dyn_retain((ScrDyn *)ad);`);
      } else if (p.kind === "jsval") {
        // A checker-'any' param: the dyn argument enters the island —
        // wrapped cells unwrap by reference, data deep-copies, boxed
        // functions cross through the host shim; a kind with no crossing
        // throws the catchable TypeError (NULL + pending).
        d.push(`    a${i} = scr_jsval_from_dyn(ad);`);
        const undo = t.params
          .slice(0, i)
          .flatMap((q, j) => (isRefCounted(q) ? [`${releaseCallC(q, `a${j}`)};`] : []));
        d.push(`    if (!a${i}) { ${undo.join(" ")}${undo.length > 0 ? " " : ""}return NULL; }`);
      } else {
        d.push(`    ScrDynPath pp = { NULL, NULL, ${i} };`);
        d.push(`    a${i} = ${E.dynCheckHelper(p)}(ad, &pp);`);
        const undo = t.params
          .slice(0, i)
          .flatMap((q, j) => (isRefCounted(q) ? [`${releaseCallC(q, `a${j}`)};`] : []));
        d.push(`    if (scr_exc_pending()) { ${undo.join(" ")}${undo.length > 0 ? " " : ""}return NULL; }`);
      }
      d.push(`  }`);
    });
    // VARIADIC (rest-marked) signatures: one extra trailing dyn-array
    // param carries the call's arguments from index params.length on —
    // the mustCall wrapper's `arguments`, a JS `...args`. Built fresh per
    // call (+1, moved into the callee like every param).
    if (t.rest) {
      d.push(`  ScrDyn *rest = scr_dyn_new_arr();`);
      d.push(`  for (size_t ri = ${t.params.length}; ri < argc; ri++) {`);
      d.push(`    scr_dyn_arr_push(rest, scr_dyn_retain((ScrDyn *)args[ri]));`);
      d.push(`  }`);
    }
    // The closure CONSUMES its params (+1 each moved in — exactly what the
    // builders above returned).
    const castParams = ["ScrClosure *", ...t.params.map((p) => cType(p).trim()), ...(t.rest ? ["ScrDyn *"] : [])].join(", ");
    const call = `((${cType(t.ret).trim()} (*)(${castParams}))c->fn)(${["c", ...t.params.map((_, i) => `a${i}`), ...(t.rest ? ["rest"] : [])].join(", ")})`;
    if (t.ret.kind === "void") {
      d.push(`  ${call};`);
      d.push(`  if (scr_exc_pending()) return NULL;`);
      d.push(`  return scr_dyn_retain(scr_dyn_undefined());`);
    } else if (t.ret.kind === "dyn") {
      d.push(`  ScrDyn *r = ${call};`);
      d.push(`  if (scr_exc_pending()) return NULL;`);
      d.push(`  return r;`);
    } else {
      d.push(`  ${cDecl(t.ret, "r")} = ${call};`);
      d.push(`  if (scr_exc_pending()) return NULL;`);
      d.push(`  ScrDyn *out = ${toDynExprC(E, t.ret, "r")};`);
      if (isRefCounted(t.ret)) d.push(`  ${releaseCallC(t.ret, "r")};`);
      d.push(`  return out;`);
    }
    d.push(`}`, ``);
    E.walkerDefs.push(...d);
    return name;
  }

/** The box builder for a CARRIED function field whose signature has no dyn
   * call thunk — a parameter the checked-dynamic side cannot validate back
   * (a record holding bytes, say). The field is still boxed, so the object
   * keeps the key and `"m" in v` answers what Node answers; only CALLING it
   * through the dyn side throws, which is the stranded stance
   * funcCoerceAdapter already takes for a slot whose pieces cannot convert.
   *
   * Only reachable from the record walker. A bare function, or a union arm,
   * keeps the compile-time fence: there the value exists to be called, and a
   * runtime trap would be a worse answer than a named refusal. */
  function strandedDynFuncBoxHelper(E: CEmitter, t: IrType & { kind: "func" }, field: string): string {
    const key = typeKey(t);
    // Interned per (SIGNATURE, FIELD NAME), not per signature alone. The
    // field name is the only attribution this site has (a shape's fields
    // carry `{ name, type }` and NO loc — IrRecordShape, ir/nodes.ts:1232),
    // and naming it in the message is worthless if two different fields of
    // the same signature share one box and one message: the survivor would
    // name whichever field was emitted first. Keying on both makes each
    // message true of every call site that reaches it. In zapo this is free
    // — its five stranded fields have five distinct signatures, so the box
    // count is 5 either way (measured, block/rank123).
    // NUL, spelled as an escape so it is visible in the source: a typeKey
    // and a field name can each contain any character, so the separator must
    // be one neither can hold.  (This line held a RAW 0x00 for two commits --
    // tsc, both backends and both zapo builds were green with it.)
    const ikey = `${key}\u0000${field}`;
    const existing = E.strandedDynFuncBoxes.get(ikey);
    if (existing) return existing;
    const name = `sc_dfs_${E.strandedDynFuncBoxes.size}`;
    E.strandedDynFuncBoxes.set(ikey, name);
    const thunkName = `${name}_thunk`;
    const thunkSig = `static ScrDyn *${thunkName}(ScrClosure *c, ScrDyn *const *args, size_t argc)`;
    // CENSUS: this used to be an UNCODED refusal - scr_throw_error_msg carries
    // no SC code at all, so it was invisible to the bracket census, to the
    // scr_trap census, AND to SCRIPTC_TRAP_TRACE, whose hook
    // (scr_trap_trace_note, called from scr_throw_error_msg_code and nowhere
    // else) returns early unless the code is SC-numeric.  zapo's TU holds
    // five of these, on the pre-key and app-state store members, and no
    // instrument in this project could see any of them.
    //
    // It carries SC2009 now - componentTypeDiag's code, whose own definition
    // already names "function parameters/returns" as one of its slots, so a
    // function shape whose component cannot fill the checked-dynamic slot is
    // exactly what that code is for.  There is still no `[SCxxxx at
    // file:line]` bracket, and there CANNOT be one from here: the record
    // walker is emitted per SHAPE, and a shape's fields carry a name and a
    // type and no location at all.  What the message CAN carry, and now
    // does, is the FIELD the value was carried in - which is what every
    // instrument in this project has had to recover by hand out of the
    // emitted C.
    const msg =
      `a '${key}' function carried into 'unknown' in field '${field}' cannot be called through it: ` +
      strandedFuncReason(t, (id: string) => E.recordsById.get(id), (id: string) => E.unionsById.get(id));
    const msgLit = cStringLiteral(Buffer.from(msg, "utf8"));
    E.walkerProtos.push(`${thunkSig}; /* stranded dyn call thunk for ${key} */`);
    E.walkerDefs.push(
      `${thunkSig} { /* stranded dyn call thunk for ${key} */`,
      `  (void)c; (void)args; (void)argc;`,
      `  scr_throw_error_msg_code(SCR_ERR_TYPE, ${msgLit}, ${Buffer.byteLength(msg, "utf8")}, "SC2009");`,
      `  return NULL;`,
      `}`,
      ``,
    );
    const sig = `static ScrDyn *${name}(ScrClosure *v, const char *fname, const char *fsrc)`;
    E.walkerProtos.push(`${sig}; /* box ${key} into dyn (uncallable) */`);
    const sigLit = cStringLiteral(Buffer.from(key, "utf8"));
    E.walkerDefs.push(
      `${sig} { /* box ${key} into dyn (uncallable) */`,
      `  return scr_dyn_new_func_src(scr_closure_retain(v), &${thunkName}, ${t.params.length}, ${sigLit}, fname, fsrc);`,
      `}`,
      ``,
    );
    return name;
  }

/** How a record FIELD of function type boxes: the ordinary thunk when the
   * signature has one, the stranded box otherwise.
   *
   * THE `NULL, NULL` IS CORRECT, AND THE STANDING NOTE THAT IT IS AN
   * ATTRIBUTION DEFECT IS WRONG.  estado-todas24.md §2.1/§3.9/§6.1 rank 1
   * reads the two arguments as "the two parameters that exist precisely to
   * name the value's origin", prices filling them at one line, and calls it
   * a change with no behaviour.  Neither half survives reading what the two
   * slots ARE:
   *
   *   fname  is the boxed value's JS `.name` PROPERTY.  Read at
   *          scr_json.c:5154 (the `name` member of a SCR_DYN_FUNC), and by
   *          the inspect walker (scr_inspect.c:845), the assert renderer
   *          (scr_assert.c:646) and the "is not a function" message
   *          (scr_json.c:1472).  Not a location.
   *   fsrc   is the `Function.prototype.toString()` ANSWER — the function's
   *          source TEXT, or one of the SCR_FN_SRC_* sentinel addresses
   *          (scr_fn_to_string, scr_json.c:1354).  Not a location either.
   *
   * So filling them cannot give any row a source location: tu-census.mjs
   * attributes REFUSAL.tagged from a `[SCxxxx at file:line]` bracket in the
   * message TEXT, and these are arguments to the box builder.  And filling
   * them with the field name would be a WRONG ANSWER, measured against Node
   * v25.9.0 rather than argued (block/rank123, repro/fname.ts):
   *
   *     const bag = { inline: (n) => n + 1, aliased: helper, method(n) {...} };
   *     console.log(bag as unknown);
   *
   *     Node    { inline: [Function: inline], aliased: [Function: helper],
   *               method: [Function: method] }
   *     scriptc { inline: [Function (anonymous)], ... }   <- today
   *     "fix"   { inline: [Function: inline],
   *               aliased: [Function: aliased],           <- WRONG, Node says
   *               method: [Function: method] }               `helper`
   *
   * JS names a function at its CREATION site.  The field name agrees for an
   * inline arrow, an inline function expression and a method, and DISAGREES
   * for `{ m: someOtherFn }` and for anything assigned into the field later.
   * This walker is emitted per SHAPE and sees a struct field read, so it
   * cannot tell those apart — the field name here is a guess, and trading
   * `[Function (anonymous)]` (visibly no answer) for a confident wrong name
   * is the direction the standing bar forbids.  `fsrc` has no honest value
   * at all: NULL makes scr_fn_to_string refuse loudly, the field name would
   * make `String(f)` answer `"getOrGenPreKeys"`, and SCR_FN_SRC_NATIVE would
   * be the "silent lie about a function that HAS source" scr_json.c:1356
   * names.
   *
   * The `[Function (anonymous)]` divergence above IS a real bug, and closing
   * it means carrying the name on the CLOSURE from its creation site (where
   * the lowering already proves one — dynFrom's `fnName`/`fnSrc`,
   * ir/nodes.ts:5490-5511) and letting the box fall back to it.  ScrClosure
   * has no such slot today.  That is a runtime-representation change in both
   * backends, not a one-line argument fix.
   *
   * What this site CAN do, and now does, is thread the FIELD NAME into the
   * stranded box's refusal MESSAGE — real attribution, no runtime value
   * changes, and the census categories do not move.  zapo's five rows are
   * getOrGenPreKeys, getOrGenSinglePreKey, getCollectionState,
   * getCollectionStates and setCollectionStates, boxed for
   * `destroyIfSupported(value: unknown)` at src/store/createStore.ts:104,
   * which only ever asks `'destroy' in value`. */
  export function dynFuncFieldBoxC(E: CEmitter, t: IrType & { kind: "func" }, expr: string, field: string): string {
    const boxable = canBoxFuncIntoDyn(t, (id: string) => E.recordsById.get(id), (id: string) => E.unionsById.get(id));
    const helper = boxable ? E.dynFuncBoxHelper(t) : strandedDynFuncBoxHelper(E, t, field);
    return `${helper}(${expr}, NULL, NULL)`;
  }

/** The box builder dynFrom emits for one closure signature. */
  export function dynFuncBoxHelper(E: CEmitter, t: IrType & { kind: "func" }): string {
    const key = typeKey(t);
    const existing = E.dynFuncBoxes.get(key);
    if (existing) return existing;
    const name = `sc_dfb_${E.dynFuncBoxes.size}`;
    E.dynFuncBoxes.set(key, name);
    const sig = `static ScrDyn *${name}(ScrClosure *v, const char *fname, const char *fsrc)`;
    E.walkerProtos.push(`${sig}; /* box ${key} into dyn */`);
    const thunk = dynFuncThunkHelper(E, t);
    const sigLit = cStringLiteral(Buffer.from(key, "utf8"));
    E.walkerDefs.push(
      `${sig} { /* box ${key} into dyn */`,
      `  return scr_dyn_new_func_src(scr_closure_retain(v), &${thunk}, ${t.params.length}, ${sigLit}, fname, fsrc);`,
      `}`,
      ``,
    );
    return name;
  }

/** The adapter closure body for one TARGET signature: the emitted C
   * function a func-targeted dynCheck wraps a non-identical boxed
   * signature in. caps[0] is an untraced obj-box owning the dyn function
   * value. */
  export function dynFuncAdapterHelper(E: CEmitter, t: IrType & { kind: "func" }): string {
    const key = typeKey(t);
    const existing = E.dynFuncAdapters.get(key);
    if (existing) return existing;
    const name = `sc_dfa_${E.dynFuncAdapters.size}`;
    E.dynFuncAdapters.set(key, name);
    // RC-audit per-SITE attribution: an adapter has no source position of
    // its own -- its identity is the target signature it adapts to.
    if (rcSitesRequested()) E.closureSites.set(name, `<dyn fn adapter to ${key}>`);
    const params = ["ScrClosure *sc_env", ...t.params.map((p, i) => cDecl(p, `a${i}`))].join(", ");
    const sig = `static ${cType(t.ret)}${cType(t.ret).endsWith("*") ? "" : " "}${name}(${params})`;
    E.walkerProtos.push(`${sig}; /* dyn fn adapter to ${key} */`);
    const dummy =
      t.ret.kind === "void" ? "" : t.ret.kind === "f64" ? "0" : t.ret.kind === "bool" ? "false" : "NULL";
    const d: string[] = [`${sig} { /* dyn fn adapter to ${key} */`];
    // caps[0] is the adapted function's CLOSURE (a FUNC box — traced, so
    // a ring through this adapter is collectable), caps[1] its thunk.
    d.push(`  ScrClosure *sc_fn = (ScrClosure *)scr_box_get_ref(sc_env->caps[0]); /* +1 */`);
    d.push(`  ScrDynThunk sc_th = scr_box_get_thunk(sc_env->caps[1]);`);
    // The adapter OWNS its params (closure ABI); each converts to a dyn
    // argument (toDynExprC borrows) and releases.
    if (t.params.length > 0) {
      d.push(`  ScrDyn *sc_args[${t.params.length}];`);
      t.params.forEach((p, i) => {
        d.push(`  sc_args[${i}] = ${toDynExprC(E, p, `a${i}`)};`);
        if (isRefCounted(p)) d.push(`  ${releaseCallC(p, `a${i}`)};`);
      });
    }
    // The kind was FUNC by construction (the dynCheck that built this
    // adapter tested it), which is exactly why the dyn value itself is
    // not kept: scr_dyn_call's only remaining work on a FUNC dyn is the
    // thunk call, and the "not a function" arm was unreachable from here.
    d.push(
      `  ScrDyn *sc_r = sc_th(sc_fn, ${t.params.length > 0 ? "sc_args" : "NULL"}, ${t.params.length});`,
    );
    d.push(`  scr_closure_release(sc_fn);`);
    t.params.forEach((_, i) => d.push(`  scr_dyn_release(sc_args[${i}]);`));
    d.push(`  if (scr_exc_pending()) return ${dummy};`.replace("return ;", "return;"));
    if (t.ret.kind === "void") {
      d.push(`  scr_dyn_release(sc_r);`);
      d.push(`  return;`);
    } else if (t.ret.kind === "dyn") {
      d.push(`  return sc_r;`);
    } else {
      // Validate the dyn result into the target's return type — a lying
      // wrapper throws the catchable TypeError here (path "$"), exactly
      // the dynCheck stance; the dummy result rides the pending unwind.
      d.push(`  ${cDecl(t.ret, "out")} = ${E.dynCheckHelper(t.ret)}(sc_r, NULL);`);
      d.push(`  scr_dyn_release(sc_r);`);
      d.push(`  return out;`);
    }
    d.push(`}`, ``);
    E.walkerDefs.push(...d);
    return name;
  }

/** The emitted dynamic-keyed READ helper for one (shape, result type):
   * `static <T> sc_rkg_<n>(<struct> *r, ScrStr *k)` — declared fields
   * answer first (string comparisons in canonical order; the frontend
   * proved each surfaces as T: identity, a to-dyn conversion, or an
   * arm-into-union wrap), then the overflow map on index-signature shapes.
   * A MISSING key yields the undefined dyn value (T dyn), the undefined
   * arm (T undefined-armed union), or TRAPS with the key text (the array
   * OOB policy — the checker claimed T and no undefined is representable).
   * Borrows both; refcounted results are owned (+1). */
  export function recordKeyGetHelper(E: CEmitter, shapeId: string, t: IrType, overflowOnly = false): string {
    const key = `${shapeId}|${typeKey(t)}${overflowOnly ? "|ovf" : ""}`;
    const existing = E.recordKeyGetFns.get(key);
    if (existing) return existing;
    const shape = E.recordsById.get(shapeId);
    if (!shape) throw new Error(`emitter bug: keyed read of unknown shape ${shapeId}`);
    const name = `sc_rkg_${E.recordKeyGetFns.size}`;
    E.recordKeyGetFns.set(key, name);
    const struct = mangleRecordStruct(shapeId);
    const sig = `static ${cType(t)}${cType(t).endsWith("*") ? "" : " "}${name}(${struct} *r, ScrStr *k)`;
    E.walkerProtos.push(`${sig}; /* r[k] on ${shapeId} as ${typeKey(t)} */`);
    const d: string[] = [`${sig} { /* r[k] on ${shapeId} as ${typeKey(t)} */`];
    // How a value of type `vt` (a field, or the overflow hit) surfaces as T.
    const surface = (vt: IrType, expr: string, owned: boolean): string => {
      if (typeEquals(vt, t)) {
        return owned || !isRefCounted(vt) ? expr : retainCallC(vt, expr);
      }
      if (t.kind === "dyn") {
        // toDyn borrows — an owned operand would leak; callers pass borrowed.
        return `${E.toDynHelper(vt)}(${expr})`;
      }
      if (t.kind === "union") {
        const def = E.unionsById.get(t.unionId);
        const tag = def?.arms.findIndex((a) => typeEquals(a, vt)) ?? -1;
        if (tag < 0) throw new Error(`emitter bug: keyed read arm for ${typeKey(vt)} in ${typeKey(t)}`);
        if (vt.kind === "f64") return `scr_union_new_f64(${tag}, ${expr})`;
        if (vt.kind === "bool") return `scr_union_new_bool(${tag}, ${expr})`;
        const rc = vAdapters(vt);
        const payload = owned ? expr : retainCallC(vt, expr);
        return `scr_union_new_ref(${tag}, ${payload}, &${rc.retain}, &${rc.release}, ${E.traceArgC(vt)})`;
      }
      throw new Error(`emitter bug: keyed read cannot surface ${typeKey(vt)} as ${typeKey(t)}`);
    };
    // overflowOnly (a literal key naming no declared field): the declared
    // switch can never hit — only the overflow answers.
    for (const f of overflowOnly ? [] : shape.fields) {
      const lit = E.internLiteral(f.name);
      d.push(`  if (scr_str_eq(k, (ScrStr *)&${lit})) { /* ${f.name} */`);
      d.push(`    return ${surface(f.type, `r->${mangleField(f.name)}`, false)};`);
      d.push(`  }`);
    }
    const iv = shape.indexValue;
    if (iv) {
      const m = `r->${OVERFLOW_MEMBER}`;
      if (iv.kind === "f64" || iv.kind === "bool") {
        const acc = iv.kind === "f64" ? "f64" : "bool";
        d.push(`  ${cDecl(iv, "hit")};`);
        d.push(`  if (scr_map_get_str_${acc}(${m}, k, &hit)) {`);
        d.push(`    return ${surface(iv, "hit", true)};`);
        d.push(`  }`);
      } else {
        d.push(`  ${cDecl(iv, "hit")} = (${cType(iv).trim()})scr_map_get_str_ref(${m}, k);`);
        d.push(`  if (hit) {`);
        if (typeEquals(iv, t)) {
          d.push(`    return hit; /* get returned +1 */`);
        } else if (t.kind === "union") {
          d.push(`    return ${surface(iv, "hit", true)};`);
        } else if (t.kind === "dyn") {
          // A dyn JOIN over a non-dyn overflow (the slot-width read: the
          // key's value converts here instead of one step later, so an
          // ABSENT key can answer undefined below). toDyn BORROWS, and the
          // map get returned +1 — convert, then drop the hit's reference.
          d.push(`    ${cDecl(t, "out")} = ${surface(iv, "hit", false)};`);
          d.push(`    ${releaseCallC(iv, "hit")};`);
          d.push(`    return out;`);
        } else {
          throw new Error(`emitter bug: keyed read overflow ${typeKey(iv)} as ${typeKey(t)}`);
        }
        d.push(`  }`);
      }
    }
    // The miss path — and before it, the SOURCE object's [[Prototype]]
    // chain, because `r[k]` is JS's [[Get]] and [[Get]] does not stop at
    // the own keys. A record materialised at a crossing carries that chain
    // (IrRecordShape.srcproto); every other record's slot is NULL and this
    // costs one predictable branch. Only the dyn RESULT takes it: a typed
    // result would have to re-check the prototype's value against the
    // index signature, and the shapes this defect was measured through are
    // all `Record<string, unknown>`.
    if (shape.srcproto && t.kind === "dyn") {
      d.push(`  {`);
      d.push(`    ScrDyn *pm = scr_dyn_proto_get_str(r->${SRCPROTO_MEMBER}, k);`);
      d.push(`    if (pm != NULL) return pm; /* inherited: [[Get]] walks the chain */`);
      d.push(`  }`);
    }
    if (t.kind === "dyn") {
      d.push(`  return scr_dyn_retain(scr_dyn_undefined());`);
    } else if (t.kind === "union" && E.undefinedArmTag(t) >= 0) {
      d.push(`  return ${E.unitInstanceRef(t.unionId, E.undefinedArmTag(t))};`);
    } else {
      // JS would answer undefined; T has no way to say it (the checker
      // claimed T without noUncheckedIndexedAccess) — trap like an array
      // OOB read instead of corrupting a typed slot (SEMANTICS.md).
      d.push(`  scr_trap_fmt("scriptc: TypeError: record has no key '%.*s' (typed '${E.dynDesc(t)}' — no undefined is representable)\\n", (int)k->len, k->data);`);
      // This helper is in the ABORT.real population: its miss path is the
      // untagged process abort.  Recorded so a CALL SITE can ask, and so
      // SCRIPTC_RKG_COUNT counts the sites that can really die and not the
      // ones that answer undefined.
      E.recordKeyGetAborts.add(name);
    }
    d.push(`}`, ``);
    E.walkerDefs.push(...d);
    return name;
  }

/** The emitted dynamic-keyed WRITE helper for one index-signature shape:
   * `static void sc_rks_<n>(<struct> *r, ScrStr *k, <V> v)` — a declared
   * key writes THROUGH to the struct slot (dyn values validate against the
   * field's type first via the dynCheck walker: a mismatch throws the
   * catchable TypeError and leaves the field untouched — JS would store
   * anything, the documented divergence; typed values store directly),
   * an undeclared key inserts/replaces in the overflow map. Borrows r and
   * k; OWNS v (+1 moves in — released on the validation-failure path). */
  export function recordKeySetHelper(E: CEmitter, shapeId: string): string {
    const existing = E.recordKeySetFns.get(shapeId);
    if (existing) return existing;
    const shape = E.recordsById.get(shapeId);
    // Signature-free shapes dispatch over their (one-typed) declared
    // fields and TRAP on a miss (scr_record_key_miss — JS would add the
    // property, which a monomorphic struct cannot); overflow shapes keep
    // the map insert tail.
    const iv = shape?.indexValue ?? shape?.fields[0]?.type;
    if (!shape || !iv) throw new Error(`emitter bug: keyed write on field-free non-overflow shape ${shapeId}`);
    const name = `sc_rks_${E.recordKeySetFns.size}`;
    E.recordKeySetFns.set(shapeId, name);
    const struct = mangleRecordStruct(shapeId);
    const sig = `static void ${name}(${struct} *r, ScrStr *k, ${cDecl(iv, "v")})`;
    E.walkerProtos.push(`${sig}; /* r[k] = v on ${shapeId} */`);
    const d: string[] = [`${sig} { /* r[k] = v on ${shapeId} */`];
    for (const f of shape.fields) {
      const lit = E.internLiteral(f.name);
      const member = `r->${mangleField(f.name)}`;
      d.push(`  if (scr_str_eq(k, (ScrStr *)&${lit})) { /* ${f.name} */`);
      if (iv.kind === "dyn" && shape.indexValue) {
        const keyLit = cStringLiteral(Buffer.from(f.name, "utf8"));
        d.push(`    ScrDynPath p = { NULL, ${keyLit}, 0 };`);
        d.push(`    ${cDecl(f.type, "nv")} = ${E.dynCheckHelper(f.type)}(v, &p);`);
        d.push(`    scr_dyn_release(v);`);
        d.push(`    if (scr_exc_pending()) return; /* mismatched write: TypeError, field untouched */`);
        d.push(`    ${isRefCounted(f.type) ? `if (${member}) ${releaseCallC(f.type, member)};` : `(void)0;`}`);
        d.push(`    ${member} = nv;`);
      } else {
        // typeEquals(f.type, iv) — the frontend fences everything else.
        if (isRefCounted(f.type)) {
          d.push(`    if (${member}) ${releaseCallC(f.type, member)};`);
        }
        d.push(`    ${member} = v;`);
      }
      d.push(`    return;`);
      d.push(`  }`);
    }
    if (!shape.indexValue) {
      // The MISS on a fixed shape: release the moved-in value, throw the
      // catchable TypeError naming the key (JS would add the property —
      // the documented monomorphic-struct divergence).
      if (isRefCounted(iv)) d.push(`  if (v) ${releaseCallC(iv, "v")};`);
      d.push(`  scr_record_key_miss(k);`);
    } else {
      const m = `r->${OVERFLOW_MEMBER}`;
      if (iv.kind === "f64" || iv.kind === "bool") {
        d.push(`  scr_map_set_str_${iv.kind === "f64" ? "f64" : "bool"}(${m}, k, v);`);
      } else {
        d.push(`  scr_map_set_str_ref(${m}, k, v); /* v moves in */`);
      }
    }
    d.push(`}`, ``);
    E.walkerDefs.push(...d);
    return name;
  }
