/* Oracle test for the LAZY MEMBER slot of scr_json.c (scr_dyn_key_set_lazy and the forcing hooks). Run by lazy.test.ts; built with ASan + the RC audit. */
#include "scr_runtime.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int checks = 0;
static int failures = 0;
static int calls = 0;

static void check(bool ok, const char *name) {
  checks++;
  if (!ok) {
    failures++;
    printf("FAIL %s\n", name);
  }
}

static ScrStr *S(const char *s) { return scr_str_new(s, strlen(s)); }

/* the thunk: a zero-argument function value that answers 42 and counts its runs */
static ScrDyn *thunk42(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo; (void)args; (void)argc;
  calls++;
  return scr_dyn_new_num(42);
}
static ScrDyn *mk_thunk(const char *src) {
  ScrClosure *c = scr_closure_new((void *)&thunk42, 0);
  ScrDyn *f = scr_dyn_new_func_src(c, &thunk42, 0, "()", "t", src);
  return f;
}
static ScrDyn *get(ScrDyn *o, const char *k) { return scr_dyn_obj_key_get(o, k, strlen(k)); }
static bool num_is(ScrDyn *v, double want) { return v != NULL && v->kind == SCR_DYN_NUM && v->v.num == want; }
static void setn(ScrDyn *o, const char *k, double n) {
  ScrStr *ks = S(k);
  ScrDyn *v = scr_dyn_new_num(n);
  scr_dyn_key_set(o, ks, v);
  scr_dyn_release(v);
  scr_str_release(ks);
}
static void setlazy(ScrDyn *o, const char *k, ScrDyn *th) {
  ScrStr *ks = S(k);
  scr_dyn_key_set_lazy(o, ks, th, true);
  scr_str_release(ks);
}
static size_t nkeys(ScrDyn *o) {
  ScrDyn *ks = scr_dyn_obj_keys(o);
  size_t n = ks->v.arr.len;
  scr_dyn_release(ks);
  return n;
}
static bool key_at(ScrDyn *o, size_t i, const char *want) {
  ScrDyn *ks = scr_dyn_obj_keys(o);
  bool ok = i < ks->v.arr.len && ks->v.arr.items[i]->kind == SCR_DYN_STR && ks->v.arr.items[i]->v.str->len == strlen(want) &&
            memcmp(ks->v.arr.items[i]->v.str->data, want, strlen(want)) == 0;
  scr_dyn_release(ks);
  return ok;
}

int main(void) {
  scr_init();
  ScrDyn *th = mk_thunk("function(){return 42}");

  /* install between two ordinary members: nothing runs, the key stands in its place, and listing does not force it */
  ScrDyn *o = scr_dyn_new_obj();
  setn(o, "a", 1);
  setlazy(o, "b", th);
  setn(o, "c", 3);
  check(calls == 0, "install runs nothing");
  check(nkeys(o) == 3 && key_at(o, 0, "a") && key_at(o, 1, "b") && key_at(o, 2, "c"), "keys: creation order with the slot in place");
  check(calls == 0, "listing keys runs nothing");

  /* the first value read forces it once, and the property is then plain */
  ScrDyn *v = get(o, "b");
  check(num_is(v, 42), "first read answers the thunk's value");
  scr_dyn_release(v);
  check(calls == 1, "first read ran the thunk once");
  v = get(o, "b");
  check(num_is(v, 42) && calls == 1, "second read does not run it again");
  scr_dyn_release(v);
  check(nkeys(o) == 3 && key_at(o, 1, "b"), "position kept after forcing");
  check(!scr_dyn_obj_has_enum_acc(o), "no accessor remains after forcing");

  /* an assignment over a lazy member behaves as over a data property */
  ScrDyn *o2 = scr_dyn_new_obj();
  calls = 0;
  setlazy(o2, "k", th);
  setn(o2, "k", 7);
  v = get(o2, "k");
  check(num_is(v, 7), "assignment over a lazy member wins");
  scr_dyn_release(v);
  check(nkeys(o2) == 1 && key_at(o2, 0, "k"), "assignment keeps one key");
  check(!scr_dyn_obj_has_enum_acc(o2), "assignment leaves a data property");

  /* delete removes it, forced or not */
  ScrDyn *o3 = scr_dyn_new_obj();
  setlazy(o3, "x", th);
  setn(o3, "y", 2);
  ScrStr *kx = S("x");
  scr_dyn_key_delete(o3, kx);
  scr_str_release(kx);
  check(nkeys(o3) == 1 && key_at(o3, 0, "y"), "delete of a lazy member");
  v = get(o3, "x");
  check(v == NULL || v->kind == SCR_DYN_UNDEF, "deleted lazy member reads undefined");
  if (v) scr_dyn_release(v);

  /* a surface that asks about accessors forces every lazy member (and a real accessor still counts) */
  ScrDyn *o4 = scr_dyn_new_obj();
  calls = 0;
  setlazy(o4, "p", th);
  setlazy(o4, "q", th);
  check(calls == 0, "two installs run nothing");
  check(!scr_dyn_obj_has_enum_acc(o4), "has_enum_acc forces lazy members: not a real accessor");
  check(calls == 2, "has_enum_acc ran both thunks");
  v = get(o4, "q");
  check(num_is(v, 42) && calls == 2, "forced members are plain data");
  scr_dyn_release(v);

  /* the guard: a function value is matched by its source text; anything else is not */
  ScrStr *t = S("function(){return 42}");
  ScrStr *t2 = S("function(){return 41}");
  check(scr_dyn_fn_src_is(th, t), "guard: same source text");
  check(!scr_dyn_fn_src_is(th, t2), "guard: different source text");
  ScrDyn *num = scr_dyn_new_num(1);
  check(!scr_dyn_fn_src_is(num, t), "guard: not a function");
  scr_dyn_release(num);
  scr_str_release(t);
  scr_str_release(t2);

  /* a failed guard runs the thunk now, as the eager statement would */
  ScrDyn *og = scr_dyn_new_obj();
  calls = 0;
  {
    ScrStr *ks = S("g");
    scr_dyn_key_set_lazy(og, ks, th, false);
    scr_str_release(ks);
  }
  check(calls == 1, "failed guard: the thunk ran at install");
  v = get(og, "g");
  check(num_is(v, 42) && calls == 1 && !scr_dyn_obj_has_enum_acc(og), "failed guard: a plain data property");
  scr_dyn_release(v);
  scr_dyn_release(og);

  /* a key that already exists takes the eager path: value stored now, position kept */
  ScrDyn *o5 = scr_dyn_new_obj();
  calls = 0;
  setn(o5, "m", 1);
  setn(o5, "n", 2);
  setlazy(o5, "m", th);
  check(calls == 1, "existing key: eager fallback ran the thunk");
  v = get(o5, "m");
  check(num_is(v, 42) && key_at(o5, 0, "m"), "existing key: value replaced in place");
  scr_dyn_release(v);

  scr_dyn_release(o);
  scr_dyn_release(o2);
  scr_dyn_release(o3);
  scr_dyn_release(o4);
  scr_dyn_release(o5);
  scr_dyn_release(th);
  printf("%d/%d checks passed\n", checks - failures, checks);
  return failures == 0 ? 0 : 1;
}
