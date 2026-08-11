static void sc_f_c1_positive(ScrUnion *sc_l_u_0) {
  ScrUnion *sc_t0 = scr_union_retain(sc_l_u_0);
  bool sc_t1 = sc_t0->tag == 3;
  if (sc_t1) {
    sc_rs_r1 *sc_t2 = sc_rretain_r1((sc_rs_r1 *)scr_union_peek(sc_t0)); /* EXPECT UPPER */
  }
}
static void sc_f_c2_tail(ScrUnion *sc_l_u_0) {
  ScrUnion *sc_t0 = scr_union_retain(sc_l_u_0);
  bool sc_t1 = sc_t0->tag == 0;
  if (sc_t1) {
    return;
  }
  sc_rs_r1 *sc_t2 = sc_rretain_r1((sc_rs_r1 *)scr_union_peek(sc_t0)); /* EXPECT EXCL-ONLY TAIL */
}
static void sc_f_c3_fieldreread(sc_rs_r9 *sc_l_m_0) {
  ScrUnion *sc_t0 = scr_union_retain(sc_l_m_0->sc_fld_k);
  bool sc_t1 = sc_t0->tag == 1;
  if (sc_t1) {
    ScrUnion *sc_t2 = scr_union_retain(sc_l_m_0->sc_fld_k);
    sc_rs_r1 *sc_t3 = sc_rretain_r1((sc_rs_r1 *)scr_union_peek(sc_t2)); /* EXPECT UPPER */
  }
}
static void sc_f_c4_fieldreread_call_between(sc_rs_r9 *sc_l_m_0) {
  ScrUnion *sc_t0 = scr_union_retain(sc_l_m_0->sc_fld_k);
  bool sc_t1 = sc_t0->tag == 1;
  if (sc_t1) {
    sc_f_somethingElse(sc_l_m_0);
    ScrUnion *sc_t2 = scr_union_retain(sc_l_m_0->sc_fld_k);
    sc_rs_r1 *sc_t3 = sc_rretain_r1((sc_rs_r1 *)scr_union_peek(sc_t2)); /* EXPECT BARE */
  }
}
static void sc_f_c5_fieldreread_store_between(sc_rs_r9 *sc_l_m_0) {
  ScrUnion *sc_t0 = scr_union_retain(sc_l_m_0->sc_fld_k);
  bool sc_t1 = sc_t0->tag == 1;
  if (sc_t1) {
    sc_l_m_0->sc_fld_k = sc_t9;
    ScrUnion *sc_t2 = scr_union_retain(sc_l_m_0->sc_fld_k);
    sc_rs_r1 *sc_t3 = sc_rretain_r1((sc_rs_r1 *)scr_union_peek(sc_t2)); /* EXPECT BARE */
  }
}
static bool sc_f_c6_tageq(ScrUnion *a, ScrUnion *b) {
  if (a->tag != b->tag) return false;
  switch (a->tag) {
  case 0: return scr_union_get_bool(a) == scr_union_get_bool(b); /* EXPECT UPPER, UPPER */
  }
}
static bool sc_f_c7_no_tageq(ScrUnion *a, ScrUnion *b) {
  switch (a->tag) {
  case 0: return scr_union_get_bool(a) == scr_union_get_bool(b); /* EXPECT UPPER, BARE */
  }
}
static void sc_f_c8_bare(ScrUnion *sc_l_u_0) {
  ScrUnion *sc_t0 = scr_union_retain(sc_l_u_0);
  sc_rs_r1 *sc_t2 = sc_rretain_r1((sc_rs_r1 *)scr_union_peek(sc_t0)); /* EXPECT BARE */
}

/* ---------------------------------------------------------------------
 * Controls for the CONDITIONAL-EXPRESSION rule: the emitter also writes
 * guards as `?:` chains on one line, and a line-based walk scores every
 * extraction inside one as if nothing had been tested.
 * ------------------------------------------------------------------- */
static void *sc_f_t1_then(ScrUnion *u) {
  return (u->tag == 1 ? scr_union_peek(u) : NULL); /* EXPECT UPPER */
}
static void *sc_f_t2_else(ScrUnion *u) {
  return (u->tag == 1 ? NULL : scr_union_peek(u)); /* EXPECT EXCL-ONLY */
}
static bool sc_f_t3_chain(ScrUnion *u, ScrStream *s) {
  return (u->tag == 1 ? scr_stream_push_null(s) : u->tag == 2 ? scr_stream_push_str(s, (ScrStr *)scr_union_peek(u)) : scr_stream_push(s, (ScrBytes *)scr_union_peek(u))); /* EXPECT UPPER, EXCL-ONLY */
}
static void *sc_f_t4_other_value(ScrUnion *u, ScrUnion *v) {
  return (v->tag == 1 ? scr_union_peek(u) : NULL); /* EXPECT BARE */
}
static void *sc_f_t5_not_a_tag_test(ScrUnion *u, bool flag) {
  return (flag ? scr_union_peek(u) : NULL); /* EXPECT BARE */
}
static void *sc_f_t6_negated(ScrUnion *u) {
  return (u->tag != 1 ? scr_union_peek(u) : NULL); /* EXPECT EXCL-ONLY */
}
static bool sc_f_t7_nested_call_arg(ScrUnion *u, ScrStream *s) {
  return (u->tag == 3 ? scr_stream_push_str(s, (ScrStr *)scr_union_peek(u)) : false); /* EXPECT UPPER */
}

/* ---------------------------------------------------------------------
 * The ToBoolean helpers.  `sc_ut_N` is the emitter's per-union ToBoolean.
 * If exactly ONE arm can ever answer true then `if (sc_ut_N(u))` is a
 * positive tag test; two truthy arms prove nothing, and the FALSE side
 * never proves anything either way.
 * ------------------------------------------------------------------- */
static bool sc_ut_0(ScrUnion *v) { /* ToBoolean u0 — ONE truthy arm */
  switch (v->tag) {
  case 0: return false;
  case 1: return ((ScrStr *)scr_union_peek(v))->len != 0; /* EXPECT UPPER */
  default: scr_trap("scriptc: internal error: invalid union tag\n");
  }
}
static bool sc_ut_1(ScrUnion *v) { /* ToBoolean u1 — TWO truthy arms */
  switch (v->tag) {
  case 0: return false;
  case 1: return ((ScrStr *)scr_union_peek(v))->len != 0; /* EXPECT UPPER */
  case 2: return scr_union_get_f64(v) != 0; /* EXPECT UPPER */
  default: scr_trap("scriptc: internal error: invalid union tag\n");
  }
}
static ScrStr *sc_f_e2_tobool(ScrUnion *u) {
  ScrStr *out;
  if (sc_ut_0(u)) {
    out = scr_str_retain((ScrStr *)scr_union_peek(u)); /* EXPECT UPPER */
  } else {
    out = NULL;
  }
  return out;
}
static ScrStr *sc_f_e3_tobool_two_truthy(ScrUnion *u) {
  ScrStr *out;
  if (sc_ut_1(u)) {
    out = scr_str_retain((ScrStr *)scr_union_peek(u)); /* EXPECT BARE */
  } else {
    out = NULL;
  }
  return out;
}
static ScrStr *sc_f_e4_tobool_false_side(ScrUnion *u) {
  ScrStr *out;
  if (sc_ut_0(u)) {
    out = NULL;
  } else {
    out = scr_str_retain((ScrStr *)scr_union_peek(u)); /* EXPECT BARE */
  }
  return out;
}

/* ---------------------------------------------------------------------
 * A bare `else {` on its own line is the same construct as `} else {`.
 * ------------------------------------------------------------------- */
static ScrStr *sc_f_e1_split_else(ScrUnion *u) {
  ScrStr *out;
  if (u->tag == 1) {
    out = NULL;
  }
  else {
    out = scr_str_retain((ScrStr *)scr_union_peek(u)); /* EXPECT EXCL-ONLY */
  }
  return out;
}

/* ---------------------------------------------------------------------
 * Allocation between a tag test and a field re-read cannot have written
 * the field; a real call can.
 * ------------------------------------------------------------------- */
static double sc_f_e5_alloc_between(sc_rs_r0 *m) {
  ScrUnion *a = scr_union_retain(m->sc_fld_f);
  bool t = a->tag != 1;
  double out = 0;
  if (t) {
    sc_rs_r8 *fresh = sc_rnew_r8();
    ScrUnion *b = scr_union_retain(m->sc_fld_f);
    out = scr_union_get_f64(b); /* EXPECT EXCL-ONLY */
  }
  return out;
}
static double sc_f_e6_call_between(sc_rs_r0 *m) {
  ScrUnion *a = scr_union_retain(m->sc_fld_f);
  bool t = a->tag != 1;
  double out = 0;
  if (t) {
    sc_f_something(m);
    ScrUnion *b = scr_union_retain(m->sc_fld_f);
    out = scr_union_get_f64(b); /* EXPECT BARE */
  }
  return out;
}

/* ---------------------------------------------------------------------
 * Two peeks of the SAME union root are the same payload, so a guard over
 * a field of the first carries to the second — unless the root is rebound.
 * ------------------------------------------------------------------- */
static double sc_f_e7_two_peeks(ScrUnion *u) {
  double out = 0;
  if (u->tag == 0) {
    sc_rs_r1 *p1 = sc_rretain_r1((sc_rs_r1 *)scr_union_peek(u)); /* EXPECT UPPER */
    ScrUnion *f1 = scr_union_retain(p1->sc_fld_g);
    bool t = f1->tag != 1;
    if (t) {
      sc_rs_r1 *p2 = sc_rretain_r1((sc_rs_r1 *)scr_union_peek(u)); /* EXPECT UPPER */
      ScrUnion *f2 = scr_union_retain(p2->sc_fld_g);
      out = scr_union_get_f64(f2); /* EXPECT EXCL-ONLY */
    }
  }
  return out;
}
static double sc_f_e8_two_peeks_rebound(ScrUnion *u, ScrUnion *w) {
  double out = 0;
  sc_rs_r1 *p1 = sc_rretain_r1((sc_rs_r1 *)scr_union_peek(u)); /* EXPECT BARE */
  ScrUnion *f1 = scr_union_retain(p1->sc_fld_g);
  bool t = f1->tag != 1;
  if (t) {
    u = w;
    sc_rs_r1 *p2 = sc_rretain_r1((sc_rs_r1 *)scr_union_peek(u)); /* EXPECT BARE */
    ScrUnion *f2 = scr_union_retain(p2->sc_fld_g);
    out = scr_union_get_f64(f2); /* EXPECT BARE */
  }
  return out;
}
