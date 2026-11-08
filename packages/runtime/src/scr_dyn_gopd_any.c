/* Object.getOwnPropertyDescriptor over an UNTYPED key (a key that may be a symbol handle): the one call that reaches BOTH halves, the string-key
 * answer in scr_dyn_gopd.c and the symbol-key answer in scr_symbol.c. It is a unit of its own so neither half names the other: the compiler
 * links it only for a program that lowers sym.anyGetOwnDesc (moduleUsesDynGopdAny), which implies both units (RUNTIME_UNIT_DEPS). Folded into
 * scr_dyn_gopd.c it left scr_dyn_sym_get_own_desc undefined for every program that links the string half without the symbol unit, which a
 * lenient ELF link hides and lld-link refuses. */
#include "scr_runtime.h"

ScrDyn *scr_dyn_any_get_own_desc(ScrDyn *recv, ScrDyn *key, ScrStr *keystr) {
  const bool is_sym = key->kind == SCR_DYN_HANDLE && key->v.handle.tag == SCR_DYNH_SYMBOL && key->v.handle.ptr != NULL;
  return is_sym ? scr_dyn_sym_get_own_desc(recv, (ScrSym *)key->v.handle.ptr) : scr_dyn_get_own_desc(recv, keystr);
}
