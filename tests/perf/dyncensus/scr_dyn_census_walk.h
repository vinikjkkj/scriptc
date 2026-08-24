/* scr_dyn_census_walk.h — the half of the dyn census that can see ScrDyn.
 *
 * scr_dyn_census.h is `-include`d, so it is processed BEFORE scr_runtime.h
 * and `struct ScrDyn` does not exist while it is being read. It therefore
 * holds the state, the live-pointer table and the report. Everything that
 * dereferences an ScrDyn lives here, and scr_json.c includes this file from
 * inside its own `#ifdef SCR_DYNCEN_ON` block, after scr_runtime.h, where
 * the type is complete.
 *
 * Include it EXACTLY ONCE in the program. The state it drives is COMDAT-
 * merged (selectany) and shared, but the walker itself is `static` and a
 * second copy would install a second constructor over the same function
 * pointer — harmless, and still worth not doing.
 */
#ifndef SCR_DYN_CENSUS_WALK_H
#define SCR_DYN_CENSUS_WALK_H
#ifdef SCR_DYNCEN_ON

/* ── the walk ─────────────────────────────────────────────────────────
 * Reads every LIVE ScrDyn and fills one row per kind. Everything it
 * dereferences is NULL-checked, and the reason is not defensiveness: a
 * snapshot can be triggered from INSIDE scr_dyn_alloc, at which moment the
 * object exists, its kind is set, and its union arm is still the zeroed
 * calloc — `v.str` is NULL, `v.fn.clo` is NULL, `v.obj.entries` is NULL.
 * At most one object per walk is in that state, and `n_empty_buf` /
 * `aux_nonnull` are where it shows up rather than a crash.
 */
static void scr_dyncen_walk(ScrDynCenKind *rows) {
  unsigned j;
  memset(rows, 0, sizeof(ScrDynCenKind) * SCR_DYNCEN_KINDS);
  scr_dyncen_walks++;
  for (j = 0; j < SCR_DYNCEN_PSLOTS; j++) {
    const ScrDyn *d = (const ScrDyn *)scr_dyncen_ptbl[j];
    ScrDynCenKind *r;
    unsigned k;
    if (!d) continue;
    scr_dyncen_walk_reads++;
    k = (unsigned)d->kind;
    if (k >= SCR_DYNCEN_KINDS) continue; /* counted as lost at the alloc hook */
    r = &rows[k];
    r->n++;
    r->rc_sum += (long long)d->rc;
    if ((long long)d->rc > r->rc_max) r->rc_max = (long long)d->rc;
    if (d->buffer) r->f_buffer++;
    if (d->null_proto) r->f_nullproto++;
    if (d->static_copy) r->f_staticcopy++;
    switch ((int)d->kind) {
    case SCR_DYN_OBJ: {
      long long len = (long long)d->v.obj.len, cap = (long long)d->v.obj.cap;
      size_t i;
      r->len_sum += len;
      r->cap_sum += cap;
      if (len > r->len_max) r->len_max = len;
      if (cap > r->cap_max) r->cap_max = cap;
      r->len_hist[scr_dyncen_bucket(len)]++;
      if (!d->v.obj.entries) { r->n_empty_buf++; }
      else r->side_bytes += cap * (long long)sizeof(ScrDynEntry);
      /* Through scr_dyn_ext, never through four fields: they moved
       * behind one lazily allocated pointer BECAUSE of what this census
       * measured about them, and a lane that still spelled them inline
       * would stop compiling — which is the safe direction — or, worse,
       * read whatever now sits at those offsets. */
      {
        const ScrDynObjExt *x = scr_dyn_ext(d);
        if (x->proto) r->has_proto++;
        if (x->cname) r->has_cname++;
        if (x->hidden) r->has_hidden++;
        if (x->slots) r->has_slots++;
        if (x->proto || x->cname || x->hidden || x->slots) r->has_any_extra++;
        if (d->v.obj.ext != NULL) r->side_bytes += (long long)sizeof(ScrDynObjExt);
      }
      for (i = 0; d->v.obj.entries && i < d->v.obj.len; i++) {
        long long kl = (long long)d->v.obj.entries[i].key_len;
        r->key_n++;
        /* the POOLED size, which is what the key really costs: every key
         * allocation in scr_json.c goes through scr_json_key_alloc, which
         * rounds key_len+1 up to SCR_POOL_GRAIN. */
        r->key_bytes += (long long)scr_pool_bytes((size_t)kl + 1);
        if (kl > r->key_max) r->key_max = kl;
        if (kl <= 7) r->key_le7++;
        if (kl <= 15) r->key_le15++;
        if (kl <= 23) r->key_le23++;
        if (kl <= 31) r->key_le31++;
      }
      break;
    }
    case SCR_DYN_ARR: {
      long long len = (long long)d->v.arr.len, cap = (long long)d->v.arr.cap;
      r->len_sum += len;
      r->cap_sum += cap;
      if (len > r->len_max) r->len_max = len;
      if (cap > r->cap_max) r->cap_max = cap;
      r->len_hist[scr_dyncen_bucket(len)]++;
      if (!d->v.arr.items) r->n_empty_buf++;
      else r->side_bytes += cap * (long long)sizeof(ScrDyn *);
      break;
    }
    case SCR_DYN_STR: {
      const ScrStr *s = d->v.str;
      if (!s) { r->n_empty_buf++; break; }
      r->aux_nonnull++;
      r->str_len_sum += (long long)s->len;
      if ((long long)s->len > r->str_len_max) r->str_len_max = (long long)s->len;
      /* what the ScrStr block itself costs, exactly as scr_string.c sizes
       * it: sizeof(ScrStr) + cap + 1. Shared/interned strings are counted
       * once per REFERENCE here, which is what a per-dyn inline
       * representation would have to replace, and the reader says so. */
      r->str_phys += (long long)(sizeof(ScrStr) + s->cap + 1);
      r->str_hist[scr_dyncen_bucket((long long)s->len)]++;
      if (s->len <= 7) r->str_le7++;
      if (s->len <= 15) r->str_le15++;
      if (s->len <= 23) r->str_le23++;
      if (s->len <= 31) r->str_le31++;
      break;
    }
    case SCR_DYN_FUNC:
      if (d->v.fn.clo) r->aux_nonnull++;
      /* Through the accessors. The three are 32-bit OFFSETS now and
       * their absent value is SCR_RVA_NULL, not 0 — `if (d->v.fn.sig)`
       * would answer true for an absent literal and false for one that
       * happens to sit at the anchor. */
      if (scr_dyn_fn_sig(d)) r->fn_sig++;
      if (scr_dyn_fn_name(d)) r->fn_name++;
      if (scr_dyn_fn_src(d)) r->fn_src++;
      if ((long long)d->v.fn.arity > r->fn_arity_max)
        r->fn_arity_max = (long long)d->v.fn.arity;
      break;
    case SCR_DYN_BYTES:
    case SCR_DYN_ARRBUF:
      if (d->v.bytes) r->aux_nonnull++;
      break;
    case SCR_DYN_HANDLE:
      if (d->v.handle.ptr) r->aux_nonnull++;
      break;
    case SCR_DYN_PROMISE:
      if (d->v.promise) r->aux_nonnull++;
      break;
    case SCR_DYN_JSVAL:
      if (d->v.jsval.cell) r->aux_nonnull++;
      break;
    case SCR_DYN_OBJINST:
      if (d->v.inst.o) r->aux_nonnull++;
      break;
    case SCR_DYN_BIG:
      if (d->v.big) r->aux_nonnull++;
      break;
    case SCR_DYN_MAP:
      if (d->v.map.m) r->aux_nonnull++;
      break;
    default:
      break; /* NULL / BOOL / NUM hold no pointer at all; and the ARM's
              * synthetic row, whose kind is not a real ScrDynKind. */
    }
  }
}

/* The two hooks scr_json.c calls. `note_alloc` runs at the END of
 * scr_dyn_alloc on BOTH paths (fresh and recycled), `note_dead` at the two
 * points a dyn leaves the live population: scr_dyn_release's rc==0 arm
 * (whether the node is then parked on a freelist or freed) and
 * scr_dyn_gcfree (the collector's teardown). A dyn dies through exactly one
 * of the two, and `deadUnknown` counts any that arrive at neither. */
static void scr_dyncen_note_alloc(const ScrDyn *d) {
  unsigned k = (unsigned)d->kind;
  scr_dyncen_alloc_total++;
  if (k < SCR_DYNCEN_KINDS) {
    scr_dyncen_alloc_by_kind[k]++;
    scr_dyncen_live_by_kind[k]++;
  } else {
    scr_dyncen_lost++;
  }
  scr_dyncen_ptbl_add(d);
  scr_dyncen_live_n++;
  if (scr_dyncen_live_n > scr_dyncen_live_peak) {
    long long band = scr_dyncen_snap_n / 256;
    scr_dyncen_live_peak = scr_dyncen_live_n;
    if (band < SCR_DYNCEN_SNAP_MIN) band = SCR_DYNCEN_SNAP_MIN;
    if (scr_dyncen_live_n > scr_dyncen_snap_n + band) {
      long long now = (long long)time(NULL);
      if (scr_dyncen_t0 == 0) scr_dyncen_t0 = now;
      scr_dyncen_snaps++;
      scr_dyncen_snap_n = scr_dyncen_live_n;
      scr_dyncen_snap_ord = scr_dyncen_alloc_total;
      scr_dyncen_snap_t = now - scr_dyncen_t0;
      scr_dyncen_walk(scr_dyncen_snap);
    }
  }
  if (scr_dyncen_alloc_total % SCR_DYNCEN_CURVE_EVERY == 0 &&
      scr_dyncen_ncurve < (long long)SCR_DYNCEN_CURVE_MAX) {
    long long *s = scr_dyncen_curve[scr_dyncen_ncurve++];
    long long now = (long long)time(NULL);
    if (scr_dyncen_t0 == 0) scr_dyncen_t0 = now;
    s[0] = scr_dyncen_alloc_total;
    s[1] = scr_dyncen_live_n;
    s[2] = now - scr_dyncen_t0;
  }
}

static void scr_dyncen_note_dead(const ScrDyn *d) {
  unsigned k = (unsigned)d->kind;
  if (!scr_dyncen_ptbl_del(d)) {
    scr_dyncen_dead_unknown++;
    return;
  }
  scr_dyncen_dead_total++;
  scr_dyncen_live_n--;
  if (k < SCR_DYNCEN_KINDS) {
    scr_dyncen_dead_by_kind[k]++;
    scr_dyncen_live_by_kind[k]--;
  }
}

/* ── the layout stamp ─────────────────────────────────────────────────
 * Every size the reader divides by comes from HERE, from the build that
 * produced the numbers, and never from a constant in the reader. The whole
 * subject is per-object overhead; a reader that assumed 104 would have
 * reported an 88-byte object as 104 and nobody would have seen it. */
__attribute__((constructor)) static void scr_dyncen_stamp(void) {
  ScrDyn probe;
  memset(&probe, 0, sizeof probe);
  scr_dyncen_sizeof_dyn = (long long)sizeof(ScrDyn);
  scr_dyncen_sizeof_hdr = (long long)sizeof(ScrCycHdr);
  scr_dyncen_sizeof_entry = (long long)sizeof(ScrDynEntry);
  scr_dyncen_sizeof_ext = (long long)sizeof(ScrDynObjExt);
  scr_dyncen_sizeof_str = (long long)sizeof(ScrStr);
  scr_dyncen_off_union = (long long)offsetof(ScrDyn, v);
  scr_dyncen_sizeof_union = (long long)sizeof(probe.v);
  scr_dyncen_kind_count = (long long)SCR_DYN_KIND_COUNT;
  /* the live width of each arm, so "dead union bytes" is arithmetic */
  scr_dyncen_arm_bytes[SCR_DYN_NULL] = 0;
  scr_dyncen_arm_bytes[SCR_DYN_BOOL] = (long long)sizeof(probe.v.b);
  scr_dyncen_arm_bytes[SCR_DYN_NUM] = (long long)sizeof(probe.v.num);
  scr_dyncen_arm_bytes[SCR_DYN_STR] = (long long)sizeof(probe.v.str);
  scr_dyncen_arm_bytes[SCR_DYN_ARR] = (long long)sizeof(probe.v.arr);
  scr_dyncen_arm_bytes[SCR_DYN_OBJ] = (long long)sizeof(probe.v.obj);
  scr_dyncen_arm_bytes[SCR_DYN_BYTES] = (long long)sizeof(probe.v.bytes);
  scr_dyncen_arm_bytes[SCR_DYN_ARRBUF] = (long long)sizeof(probe.v.bytes);
  scr_dyncen_arm_bytes[SCR_DYN_FUNC] = (long long)sizeof(probe.v.fn);
  scr_dyncen_arm_bytes[SCR_DYN_HANDLE] = (long long)sizeof(probe.v.handle);
  scr_dyncen_arm_bytes[SCR_DYN_PROMISE] = (long long)sizeof(probe.v.promise);
  scr_dyncen_arm_bytes[SCR_DYN_JSVAL] = (long long)sizeof(probe.v.jsval);
  scr_dyncen_arm_bytes[SCR_DYN_OBJINST] = (long long)sizeof(probe.v.inst);
  scr_dyncen_arm_bytes[SCR_DYN_BIG] = (long long)sizeof(probe.v.big);
  scr_dyncen_arm_bytes[SCR_DYN_MAP] = (long long)sizeof(probe.v.map);
  scr_dyncen_walk_fn = &scr_dyncen_walk;
}

/* ── the arm ───────────────────────────────────────────────────────────
 * The lane is believed only when a planted population comes back exactly.
 * -DSCR_DYNCEN_ARM=N plants N real ScrDyn structs at a kind index that no
 * ScrDynKind can occupy (SCR_DYNCEN_KINDS-1, i.e. 31), runs the ALLOC hook
 * on all N and the DEAD hook on exactly half, and leaves the other half
 * live to exit with rc=3 and `buffer` set. The reader then checks:
 *
 *   allocs[31] = N, deaths[31] = N/2, live[31] = N - N/2 — the deaths were
 *     charged back through the pointer table, not merely counted;
 *   the EXIT walk's row 31 has n = N/2, rcMax = 3, rcSum = 3*(N/2),
 *     fBuf = N/2 — so the WALK reached the same objects the counters did;
 *   deadUnknown = 0 and ptrLost = 0 — the negative control: a hook that
 *     freed an object it had never seen allocated, or a table that
 *     overflowed, would show here and nowhere else.
 *
 * The addresses are inside a static array, so they are real, unique, and
 * can never collide with a block the allocator returns. armN is reported so
 * every figure downstream subtracts a known constant, not a guessed one.
 */
#ifdef SCR_DYNCEN_ARM
static ScrDyn scr_dyncen_arm_blk[SCR_DYNCEN_ARM];
__attribute__((constructor)) static void scr_dyncen_arm_ctor(void) {
  int i;
  if (scr_dyncen_armed) return; /* a constructor is emitted in EVERY TU */
  scr_dyncen_armed = 1;
  for (i = 0; i < SCR_DYNCEN_ARM; i++) {
    memset(&scr_dyncen_arm_blk[i], 0, sizeof(ScrDyn));
    scr_dyncen_arm_blk[i].rc = 3;
    scr_dyncen_arm_blk[i].buffer = true;
    scr_dyncen_arm_blk[i].kind = (ScrDynKind)(SCR_DYNCEN_KINDS - 1u);
    scr_dyncen_note_alloc(&scr_dyncen_arm_blk[i]);
  }
  for (i = 0; i < SCR_DYNCEN_ARM / 2; i++)
    scr_dyncen_note_dead(&scr_dyncen_arm_blk[i]);
  scr_dyncen_arm_n = (long long)(SCR_DYNCEN_ARM - SCR_DYNCEN_ARM / 2);
}
#endif

#endif /* SCR_DYNCEN_ON */
#endif /* SCR_DYN_CENSUS_WALK_H */
