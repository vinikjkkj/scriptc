/* String-arm unions in the LLVM lane. A union box whose arm is a string goes through scr_union_new_str, which shares one immortal box per tag for the
 * empty string (scr_union.c). The C emission gets this from a macro in scr_runtime.h that folds a comparison of two address constants; LLVM has no
 * macros, and the ~35 emit sites all spell the same call with the same operand shapes, so the finished module text is rewritten here in one place:
 * a call that names the string arm's retain and release entry points becomes the two-operand call (fewer arguments than before). Any other call is
 * left alone. */

const STR_UNION_CALL =
  /call ptr @scr_union_new_ref\(i32 ([^,()]+), ptr ([^,()]+), ptr @scr_str_retain_v, ptr @scr_str_release_v, ptr null\)/g;
const UNION_DECL = "declare ptr @scr_union_new_ref(i32, ptr, ptr, ptr, ptr)";

export function rewriteStringUnions(text: string): string {
  const out = text.replace(STR_UNION_CALL, (_m, tag: string, v: string) => `call ptr @scr_union_new_str(i32 ${tag}, ptr ${v})`);
  if (out === text) return text;
  return out.split(UNION_DECL).join(`${UNION_DECL}\ndeclare ptr @scr_union_new_str(i32, ptr)`);
}
