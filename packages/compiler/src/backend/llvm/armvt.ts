/* Arm descriptors for the LLVM lane: the post-pass that turns every `scr_union_new_ref` / `scr_box_new_obj` call into a call that
 * names one constant descriptor.
 *
 * A ref-armed union or a SCR_BOX_OBJ box used to receive its (retain, release, trace) function pointers as three call arguments and
 * store them in the instance (24 of its 48 bytes). They are per-TYPE facts, so the instance now stores a 32-bit offset to a
 * constant ScrArmVt { retain, release } (scr_runtime.h has the encoding) plus the has-trace bit. The call sites are rewritten here, in
 * one place over the finished module text, rather than at each of the ~35 emit sites: they all spell the same call with the same
 * operand shapes, and a site this pass cannot read (an operand that is not a global symbol or null) is sent to the runtime's general
 * form (`_rt`), which interns the pair in a static table, so nothing is ever left calling a function that no longer exists.
 *
 * Descriptors are `internal constant { ptr, ptr }` with align 8 (bit 0 of the offset is the trace flag) and are deduplicated by
 * (retain, release). */

const UNION_CALL = /call ptr @scr_union_new_ref\(i32 ([^,()]+), ptr ([^,()]+), ptr ([^,()]+), ptr ([^,()]+), ptr ([^,()]+)\)/g;
const BOX_CALL = /call ptr @scr_box_new_obj\(ptr ([^,()]+), ptr ([^,()]+), ptr ([^,()]+)\)/g;
const UNION_DECL = "declare ptr @scr_union_new_ref(i32, ptr, ptr, ptr, ptr)";
const BOX_DECL = "declare ptr @scr_box_new_obj(ptr, ptr, ptr)";

const isGlobal = (op: string): boolean => op.startsWith("@");

export function rewriteArmDescriptors(text: string): string {
  const descs = new Map<string, string>();
  const nameOf = (retain: string, release: string): string => {
    const key = `${retain}|${release}`;
    let name = descs.get(key);
    if (name === undefined) {
      name = `@sc_armvt_${descs.size}`;
      descs.set(key, name);
    }
    return name;
  };
  let out = text.replace(UNION_CALL, (m, tag: string, v: string, retain: string, release: string, trace: string) => {
    if (!isGlobal(retain) || !isGlobal(release) || (trace !== "null" && !isGlobal(trace))) {
      return `call ptr @scr_union_new_ref_rt(i32 ${tag}, ptr ${v}, ptr ${retain}, ptr ${release}, ptr ${trace})`;
    }
    return `call ptr @scr_union_new_refd(i32 ${tag}, ptr ${v}, ptr ${nameOf(retain, release)}, i1 ${trace === "null" ? "false" : "true"})`;
  });
  out = out.replace(BOX_CALL, (m, retain: string, release: string, trace: string) => {
    if (!isGlobal(retain) || !isGlobal(release) || (trace !== "null" && !isGlobal(trace))) {
      return `call ptr @scr_box_new_obj_rt(ptr ${retain}, ptr ${release}, ptr ${trace})`;
    }
    return `call ptr @scr_box_new_objd(ptr ${nameOf(retain, release)}, i1 ${trace === "null" ? "false" : "true"})`;
  });
  out = out.split(UNION_DECL).join(
    [
      "declare ptr @scr_union_new_refd(i32, ptr, ptr, i1 zeroext)",
      "declare ptr @scr_union_new_ref_rt(i32, ptr, ptr, ptr, ptr)",
    ].join("\n"),
  );
  out = out.split(BOX_DECL).join(
    ["declare ptr @scr_box_new_objd(ptr, i1 zeroext)", "declare ptr @scr_box_new_obj_rt(ptr, ptr, ptr)"].join("\n"),
  );
  if (descs.size === 0) return out;
  const rows: string[] = ["", "; arm descriptors: one constant { retain, release } per distinct pair, see backend/llvm/armvt.ts"];
  for (const [key, name] of descs) {
    const [retain, release] = key.split("|");
    rows.push(`${name} = internal constant { ptr, ptr } { ptr ${retain}, ptr ${release} }, align 8`);
  }
  rows.push("");
  return out + rows.join("\n");
}
