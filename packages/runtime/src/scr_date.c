/* scr_date.c — the Date handle's ownership pair.
 *
 * A TYPE WITH NO VALUES, exactly like ScrRequest in scr_fetch_static.c.
 * Nothing in this runtime allocates a ScrDate and nothing in the compiler
 * emits a construction: `new Date(...)` as a VALUE is a refusal
 * (lower-builtins.ts's Date slice lowers only `Date.now()`, `Date.UTC()`
 * and the COMPOSED `new Date(ms?).getTime()` / `.toISOString()`), and every
 * MEMBER refuses through surfaces.ts's stdlibMemberFence.
 *
 * WHY THE TYPE EXISTS ANYWAY. A record whose member is typed `Date` had no
 * representation at all, so the RECORD TYPE reported SC2009 — a type-level
 * stop that `--best-effort` cannot defer. zapo voip's
 * `call/call-state.ts:10` is the measured case:
 *
 *     export interface CallStateData {
 *         state: CallState
 *         connectedAt?: Date
 *         acceptedAt?: Date
 *         endedAt?: Date
 *         ...
 *     }
 *
 * and that one member was the single remaining error between voip's
 * package entry and a binary under `--provenance-sources --best-effort`.
 *
 * WHY A HANDLE AND NOT THE f64 EPOCH IT WOULD FIT IN. Two answers a scalar
 * would get silently wrong, both observable:
 *
 *   - `new Date(0)` is TRUTHY in JS. A scalar 0 is not. zapo writes
 *     `if (s.connectedAt)` and `connectedAt ? … : undefined`.
 *   - two distinct Dates with equal milliseconds are `!==`. Two equal f64s
 *     are `===`.
 *
 * A pointer answers both the way node does, and the always-truthy set in
 * ir/nodes.ts is what carries the first.
 *
 * These four functions keep the ownership machinery (record fields, union
 * arms, boxes, array elements) uniform for the kind. They are dead code in
 * every program that links this file: the pointer is always NULL, so every
 * one of them takes its NULL branch. Deliberately NOT a cycle-headered
 * allocation — there is nothing to allocate.
 *
 * The unit is behind a LINK GATE (moduleUsesDate on the IR), so a program
 * with no Date-typed value never compiles it. */

#include <stdlib.h>

#include "scr_runtime.h"

struct ScrDate {
  size_t rc;
};

ScrDate *scr_date_retain(ScrDate *d) {
  if (d != NULL && d->rc != SIZE_MAX) d->rc++;
  return d;
}

void scr_date_release(ScrDate *d) {
  if (d == NULL || d->rc == SIZE_MAX) return;
  if (--d->rc == 0) free(d);
}

void *scr_date_retain_v(void *p) { return scr_date_retain((ScrDate *)p); }
void scr_date_release_v(void *p) { scr_date_release((ScrDate *)p); }
