/** Closed-world fence on `Object.create(null)` flowing into a typed RECORD.
 *
 * `Object.create(null)` lowers to a checked-dynamic object (dyn.objCreateNullProto,
 * or dyn.objCreateNullDescs with a descriptor map). A typed destination with
 * declared members (`const EJSON: { parse: typeof parse } = Object.create(null)`,
 * then `EJSON.parse = parse`: bson's table idiom) converts that dyn object into
 * the record when the binding is initialised. The conversion reads each declared
 * member off the dyn object at that moment, and a member the program has not
 * written yet is absent there: the converter throws `expected function at $.parse,
 * got undefined` (MEASURED on main ed4896803, C and LLVM), where Node answers
 * `undefined` and goes on. A record cannot represent "absent" for a member whose
 * type does not admit undefined, so no runtime answer is exact.
 *
 * A record with declared members also cannot keep the object's insertion order:
 * Object.keys of the record reports the declared order, and Node reports the
 * order the program wrote (MEASURED: `B.b = 2; B.a = 1` with `{ a?, b? }`, Node
 * prints `b,a`, the record `a,b`). So every such crossing is refused at compile
 * time, by name. A dyn object with NO declared members (an index-signature
 * record, `{}`) is not refused: it keeps its keys and Node's shape exactly.
 *
 * The walk runs once over the final IR, after the whole module is lowered, the
 * same way dyn-record-fence.ts does, so every function is seen. Limit: only a
 * DIRECT source is recognised (the dynCheck's value is the Object.create libCall
 * itself). A null-prototype object that reaches a record through a variable is
 * not in this fence; it converts at the same dynCheck with the same absent-member
 * throw and is reported as an open route, not claimed closed.
 */
import { type IrType, type IrModule, type IrRecordShape, type SrcLoc } from "../../ir/nodes.js";
import type { ScrDiagnostic } from "../../diagnostics/diagnostic.js";
import { unsupportedDiag } from "../../diagnostics/diagnostic.js";

export interface NullProtoFenceHost {
  shapeGet(id: string): IrRecordShape | undefined;
  unionGet?(id: string): { arms: IrType[] } | undefined;
}

const NULL_PROTO_LIBS = new Set(["dyn.objCreateNullProto", "dyn.objCreateNullDescs"]);

/** The first record shape with declared members that a target type reaches,
 * through union arms (`{ ... } | undefined`). Null when none does. */
function membered(host: NullProtoFenceHost, t: IrType, seen: Set<string>): IrRecordShape | null {
  if (t.kind === "union") {
    if (seen.has(`u:${t.unionId}`)) return null;
    seen.add(`u:${t.unionId}`);
    for (const a of host.unionGet?.(t.unionId)?.arms ?? []) {
      const hit = membered(host, a, seen);
      if (hit !== null) return hit;
    }
    return null;
  }
  if (t.kind !== "record") return null;
  const shape = host.shapeGet(t.shapeId);
  if (shape === undefined) return null;
  return shape.fields.length > 0 ? shape : null;
}

export function fenceNullProtoRecordCasts(
  host: NullProtoFenceHost,
  mod: IrModule,
  pushDiag: (d: ScrDiagnostic) => void,
): number {
  let refused = 0;
  const seenObj = new Set<object>();
  // ITERATIVE (explicit stack): the IR of a deeply nested program must not
  // overflow the JS stack in a fence that runs after lowering.
  // Roots pushed in reverse so functions are visited first, as before.
  const stack: unknown[] = [mod.globals ?? [], mod.classes ?? [], mod.functions];
  while (stack.length > 0) {
    const v = stack.pop();
    if (v === null || typeof v !== "object") continue;
    if (seenObj.has(v)) continue;
    seenObj.add(v);
    const o = v as Record<string, unknown>;
    if (o["kind"] === "dynCheck" && o["type"] !== undefined) {
      const value = o["value"] as { kind?: unknown; fn?: unknown } | undefined;
      if (value?.kind === "libCall" && typeof value.fn === "string" && NULL_PROTO_LIBS.has(value.fn)) {
        const shape = membered(host, o["type"] as IrType, new Set());
        if (shape !== null) {
          refused++;
          const loc = o["loc"] as SrcLoc;
          const names = shape.fields.map((f) => f.name).slice(0, 4).join(", ");
          pushDiag(unsupportedDiag(
            "SC1090",
            loc,
            "Object.create(null) assigned to a typed record with declared member",
            `the record declares { ${names}${shape.fields.length > 4 ? ", ..." : ""} }: a member must exist when the binding is initialised ` +
              `(a member not written yet is absent there, where Node reads undefined), and the record keeps the declared key order ` +
              `where Object.create(null) keeps the order the program writes. Leave the table untyped ` +
              `(const table = Object.create(null)), or type it as a dictionary (Record<string, T>).`,
          ));
        }
      }
    }
    // Children pushed in reverse so the pop order is the recursive preorder.
    const kids: unknown[] = Array.isArray(v) ? v : Object.values(o);
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
  return refused;
}
