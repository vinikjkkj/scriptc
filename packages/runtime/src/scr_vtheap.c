/* Per-evaluation vtable copies (see the block above ScrVt's API in
 * scr_runtime.h). Link-gated: only programs whose lowering evaluates a
 * class expression reference this unit, so every other program links the
 * same runtime set as before. Single-threaded like the rest of the core:
 * rc is a plain counter.
 *
 * Layout: [ScrVtHeap header][ScrVt copy of `bytes`]. The header sits
 * immediately before the vtable, at a fixed negative offset, so a ScrVt*
 * taken from an instance's `vt` reaches its rc without a second pointer.
 */
#include "scr_runtime.h"

#include <stdint.h>
#include <stdlib.h>
#include <string.h>

typedef struct ScrVtHeap {
  size_t rc;
  void *env;
  void (*env_release)(void *env);
  void *statics;
  void (*statics_release)(void *statics);
  size_t bytes; /* size of the vtable copy that follows the header */
} ScrVtHeap;

/* The header is padded to 16 bytes so the copy's alignment is the
 * allocator's (every slot is a pointer or size_t). */
#define SCR_VTHEAP_HDR ((sizeof(ScrVtHeap) + 15) & ~(size_t)15)

static size_t scr_vtheap_next_token = 1; /* identity tokens, never 0 */

#ifdef SCR_RC_AUDIT
static long scr_live_vtheaps = 0;
long scr_vtheap_live_count(void) { return scr_live_vtheaps; }
#endif

static ScrVtHeap *scr_vtheap_of(const ScrVt *vt) {
  return (ScrVtHeap *)((char *)vt - SCR_VTHEAP_HDR);
}

ScrVt *scr_vtheap_new(const ScrVt *proto, size_t bytes, const ScrVt *parent,
                      void *env, void (*env_release)(void *env),
                      void *statics, void (*statics_release)(void *statics)) {
  /* A copy is at least a ScrVt head; the emitter passes the full struct. */
  if (bytes < sizeof(ScrVt)) bytes = sizeof(ScrVt);
  char *block = malloc(SCR_VTHEAP_HDR + bytes);
  if (!block) abort(); /* out of memory: the runtime's usual terminal path */
  ScrVtHeap *h = (ScrVtHeap *)block;
  h->rc = 1;
  h->env = env;
  h->env_release = env_release;
  h->statics = statics;
  h->statics_release = statics_release;
  h->bytes = bytes;
  ScrVt *vt = (ScrVt *)(block + SCR_VTHEAP_HDR);
  /* The head and slots come from the proto; the two trailing fields are
   * set here, never copied (a proto is a static and carries heap == 0). */
  memcpy(vt, proto, bytes);
  vt->heap = scr_vtheap_next_token++;
  vt->parent = parent;
  /* The copy holds its heap parent (released in scr_vtheap_release). */
  if (parent != NULL && parent->heap != 0) scr_vtheap_retain((ScrVt *)parent);
#ifdef SCR_RC_AUDIT
  scr_live_vtheaps++;
#endif
  return vt;
}

void scr_vtheap_retain(ScrVt *vt) {
  if (vt == NULL) return;
  scr_vtheap_of(vt)->rc++;
}

void scr_vtheap_release(ScrVt *vt) {
  if (vt == NULL) return;
  ScrVtHeap *h = scr_vtheap_of(vt);
  if (--h->rc != 0) return;
  /* Last reference: the captured env and the statics block die with the
   * class value. Their callbacks release what they own (captured locals,
   * static fields); a NULL callback means the block owns nothing. */
  if (h->statics != NULL && h->statics_release != NULL) h->statics_release(h->statics);
  if (h->env != NULL && h->env_release != NULL) h->env_release(h->env);
  /* The parent vtable is a reference this copy holds (taken by the
   * emitter when the copy is made) and is released here. A static parent
   * is not refcounted and is skipped by its heap == 0 tag. */
  ScrVt *parent = (ScrVt *)vt->parent;
  free(h);
#ifdef SCR_RC_AUDIT
  scr_live_vtheaps--;
#endif
  if (parent != NULL && parent->heap != 0) scr_vtheap_release(parent);
}

bool scr_vtheap_instanceof(const ScrVt *x, const ScrVt *target) {
  for (const ScrVt *cur = x; cur != NULL; cur = cur->heap != 0 ? cur->parent : NULL) {
    if (cur == target) return true;
  }
  return false;
}
