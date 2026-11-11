/* node:test — the in-process test runner (linked only when the program
 * imports node:test; cc.ts gates on moduleUsesNodeTest like dgram/net).
 *
 * Registration (test/it/describe/suite/hooks) builds a tree under an
 * implicit root while the module bodies run: describe callbacks execute
 * IMMEDIATELY at registration (Node runs suite bodies during collection),
 * test callbacks are stored. The FIRST registration spawns the runner
 * fiber, whose first act is one microtask hop (scr_await_hop) — so it
 * parks on the ready queue and runs only after main returns and
 * scr_loop_run drains microtasks: Node's "tests start after the file's
 * synchronous body completes" scheduling, ahead of any main-registered
 * timers. Tests run SEQUENTIALLY on that fiber (Node's default
 * concurrency 1): sync bodies are called directly (the fiber's own
 * exception cell isolates their throws), async bodies run via their spawn
 * wrappers and the runner awaits the promise — timers/io inside test
 * bodies interleave through the ordinary loop while the runner is parked.
 *
 * Reporting reproduces Node v24's SPEC reporter (the default on every
 * stream since v20 made it universal): ✔/✖/﹣/⚠ result lines with
 * per-test durations, # SKIP/# TODO directives, ▶ suite headers printed
 * lazily when the first child reports, the ℹ summary block, and the
 * "✖ failing tests:" section (test-at location, result line, the error
 * message indented two spaces — no stack frames: the harness strips
 * Node's, SEMANTICS.md numbers the divergence). Durations are real
 * elapsed milliseconds and thus NONDETERMINISTIC — the differential
 * harness normalizes them on both lanes; the suite runner only reads
 * exit codes. One deliberate divergence: reporter lines write to stdout
 * synchronously as results land, where Node's reporter stream lags
 * console output racily — programs that interleave console.log with the
 * reporter cannot be byte-compared under Node itself.
 *
 * Exit code: main asks scr_test_exit_code() after the loop drains —
 * 1 when any non-todo test failed (todo failures print ⚠ and list in the
 * failing section but exit 0, Node's contract), else 0. */
#include "scr_platform.h"
#include "scr_runtime.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifndef _WIN32
#include <unistd.h>
#else
#include <direct.h>
#define getcwd _getcwd
#endif

static void scr_test_oom(void) {
  fputs("scriptc: out of memory\n", stderr);
  abort();
}

/* mode values (the frontend's literals) */
enum { SCR_TEST_RUN = 0, SCR_TEST_SKIP = 1, SCR_TEST_TODO = 2 };
/* flags bitmask */
enum { SCR_TEST_F_ASYNC = 1, SCR_TEST_F_CTX = 2, SCR_TEST_F_ONLY = 4 };
/* hook kinds */
enum { SCR_HOOK_BEFORE = 0, SCR_HOOK_AFTER = 1, SCR_HOOK_BEFORE_EACH = 2, SCR_HOOK_AFTER_EACH = 3 };
/* outcome states */
enum {
  SCR_TS_PENDING = 0,
  SCR_TS_PASS,
  SCR_TS_FAIL,      /* own body threw (or a hook failed it) */
  SCR_TS_CHILDFAIL, /* own body passed; a descendant failed */
  SCR_TS_SKIPPED,
  SCR_TS_TODO_PASS,
  SCR_TS_TODO_FAIL,
};

typedef struct {
  ScrClosure *cb;
  int flags;
} ScrTestHook;

typedef struct {
  ScrTestHook *v;
  size_t n, cap;
} ScrTestHooks;

struct ScrTestCtx {
  size_t rc;
  ScrStr *name; /* owned */
  ScrStr *msg;  /* directive message, owned; NULL = bare SKIP/TODO */
  ScrStr *at;   /* "file:line:col" (absolute file), owned; NULL for suites */
  ScrClosure *cb; /* owned; NULL = fn-less test (Node: counts as pass) */
  int mode;
  int flags;
  bool is_suite;
  int state;
  bool started_line; /* the "▶ name" header printed */
  double dur_ms;
  ScrCaught *err;      /* owned; the own-body failure payload */
  ScrStr **diags;      /* owned t.diagnostic strings, printed after the line */
  size_t ndiags, dcap;
  struct ScrTestCtx *parent; /* borrowed back-edge */
  struct ScrTestCtx **children; /* owned refs */
  size_t nchildren, ccap;
  ScrTestHooks hooks[4]; /* suites and root only */
  bool running;          /* a run of this node is in flight (started, not yet reported) */
  size_t sub_running;    /* t.test subtests started by this test's body and not yet finished */
  struct ScrRunNode *waiter; /* the test run parked until sub_running reaches 0 */
};

static ScrTestCtx *scr_test_root = NULL;
/* Where registrations attach: the suite body being collected or the test
 * currently running (its nested test()/t.test() calls are subtests). */
static ScrTestCtx *scr_test_reg_parent = NULL;
static bool scr_test_runner_spawned = false;
static bool scr_test_run_done = false;
static long scr_test_ct_tests = 0, scr_test_ct_suites = 0, scr_test_ct_pass = 0,
            scr_test_ct_fail = 0, scr_test_ct_skipped = 0, scr_test_ct_todo = 0;
static double scr_test_t0 = 0;
static bool scr_test_suite_hook_failed = false;

#ifdef SCR_RC_AUDIT
static long scr_testctx_live = 0;
long scr_testctx_live_count(void) { return scr_testctx_live; }
#endif

ScrTestCtx *scr_testctx_retain(ScrTestCtx *t) {
  if (t) t->rc++;
  return t;
}

static void scr_test_hooks_free(ScrTestHooks *h) {
  for (size_t i = 0; i < h->n; i++) scr_closure_release(h->v[i].cb);
  free(h->v);
  h->v = NULL;
  h->n = h->cap = 0;
}

void scr_testctx_release(ScrTestCtx *t) {
  if (!t || --t->rc > 0) return;
  scr_str_release(t->name);
  scr_str_release(t->msg);
  scr_str_release(t->at);
  scr_closure_release(t->cb);
  scr_caught_release(t->err);
  for (size_t i = 0; i < t->ndiags; i++) scr_str_release(t->diags[i]);
  free(t->diags);
  for (size_t i = 0; i < t->nchildren; i++) scr_testctx_release(t->children[i]);
  free(t->children);
  for (int k = 0; k < 4; k++) scr_test_hooks_free(&t->hooks[k]);
#ifdef SCR_RC_AUDIT
  scr_testctx_live--;
#endif
  free(t);
}

void *scr_testctx_retain_v(void *t) { return scr_testctx_retain(t); }
void scr_testctx_release_v(void *t) { scr_testctx_release(t); }

static ScrTestCtx *scr_test_node_new(ScrStr *name /*borrowed*/, int mode,
                                      ScrStr *msg /*borrowed, may be empty*/,
                                      ScrClosure *cb /*moves, may be NULL*/,
                                      int flags, ScrStr *at /*borrowed, may be NULL*/,
                                      bool is_suite) {
  ScrTestCtx *t = calloc(1, sizeof *t);
  if (!t) scr_test_oom();
  t->rc = 1;
  t->name = name ? scr_str_retain(name) : NULL;
  t->msg = (msg && msg->len > 0) ? scr_str_retain(msg) : NULL;
  t->at = (at && at->len > 0) ? scr_str_retain(at) : NULL;
  t->cb = cb;
  t->mode = mode;
  t->flags = flags;
  t->is_suite = is_suite;
#ifdef SCR_RC_AUDIT
  scr_testctx_live++;
#endif
  return t;
}

static void scr_test_child_add(ScrTestCtx *parent, ScrTestCtx *child /*moves*/) {
  if (parent->nchildren == parent->ccap) {
    parent->ccap = parent->ccap ? parent->ccap * 2 : 4;
    parent->children = realloc(parent->children, parent->ccap * sizeof *parent->children);
    if (!parent->children) scr_test_oom();
  }
  child->parent = parent;
  parent->children[parent->nchildren++] = child;
}

static ScrTestCtx *scr_test_ensure_root(void) {
  if (!scr_test_root) {
    scr_test_root = scr_test_node_new(NULL, SCR_TEST_RUN, NULL, NULL, 0, NULL, true);
    scr_test_reg_parent = scr_test_root;
  }
  return scr_test_root;
}

/* ── reporting (Node v24 spec reporter) ──────────────────────────────── */

static int scr_test_depth(const ScrTestCtx *t) {
  int d = 0;
  for (const ScrTestCtx *p = t->parent; p && p->parent; p = p->parent) d++;
  return d;
}

static void scr_test_indent(int depth) {
  for (int i = 0; i < depth; i++) fputs("  ", stdout);
}

/* "(1.234567ms)" — durations print microsecond-rounded (Node's hrtime
 * granularity), not with double noise. */
static void scr_test_print_dur(double ms) {
  char num[32];
  fputs(" (", stdout);
  size_t n = scr_f64_to_str(round(ms * 1e6) / 1e6, num);
  fwrite(num, 1, n, stdout);
  fputs("ms)", stdout);
}

static const char *scr_test_symbol(int state) {
  switch (state) {
  case SCR_TS_PASS:
  case SCR_TS_TODO_PASS: return "\xE2\x9C\x94";      /* ✔ */
  case SCR_TS_FAIL:
  case SCR_TS_CHILDFAIL: return "\xE2\x9C\x96";      /* ✖ */
  case SCR_TS_SKIPPED: return "\xEF\xB9\xA3";         /* ﹣ */
  case SCR_TS_TODO_FAIL: return "\xE2\x9A\xA0";       /* ⚠ */
  default: return "?";
  }
}

static void scr_test_print_str(const ScrStr *s) {
  if (s) fwrite(s->data, 1, s->len, stdout);
}

/* Ancestors print their "▶ name" headers before the first descendant
 * result line lands — Node's reporter defers the arrow until a child
 * reports, so empty suites never print one. */
static void scr_test_ensure_started(ScrTestCtx *t) {
  if (!t || !t->parent || t->started_line) return;
  scr_test_ensure_started(t->parent);
  t->started_line = true;
  scr_test_indent(scr_test_depth(t));
  fputs("\xE2\x96\xB6 ", stdout); /* ▶ */
  scr_test_print_str(t->name);
  fputc('\n', stdout);
}

/* "<sym> <name> (<dur>ms)[ # directive]" + queued ℹ diagnostics. */
static void scr_test_report_result(ScrTestCtx *t) {
  scr_test_ensure_started(t->parent);
  int depth = scr_test_depth(t);
  scr_test_indent(depth);
  fputs(scr_test_symbol(t->state), stdout);
  fputc(' ', stdout);
  scr_test_print_str(t->name);
  scr_test_print_dur(t->dur_ms);
  if (t->state == SCR_TS_SKIPPED) {
    fputs(" # ", stdout);
    if (t->msg) scr_test_print_str(t->msg);
    else fputs("SKIP", stdout);
  } else if (t->state == SCR_TS_TODO_PASS || t->state == SCR_TS_TODO_FAIL) {
    fputs(" # ", stdout);
    if (t->msg) scr_test_print_str(t->msg);
    else fputs("TODO", stdout);
  }
  fputc('\n', stdout);
  for (size_t i = 0; i < t->ndiags; i++) {
    scr_test_indent(depth);
    fputs("\xE2\x84\xB9 ", stdout); /* ℹ */
    scr_test_print_str(t->diags[i]);
    fputc('\n', stdout);
  }
}

/* ── running ─────────────────────────────────────────────────────────── */

/* The runner is a CONTINUATION-PASSING STATE MACHINE, not a fiber: one RunNode per node being run, advanced by rn_advance until it PARKS on
 * a promise (an async hook or body, through scr_promise_wait_raw) or on its running subtests, or COMPLETES and calls its `done` continuation.
 * Sync bodies and hooks are called directly and an exception they throw is read from the active cell right after, exactly as before; an
 * async one is awaited by waiting on its promise, and its rejection is re-thrown into the cell (scr_promise_settled_take) when the
 * continuation runs, so the decision points below read `scr_exc_pending()` at the same places the blocking runner did. */
typedef struct {
  ScrClosure *cb;
  int flags;
} ScrTestHookRef;

enum {
  RN_T_BEFORE_EACH = 0, RN_T_HOOKS1, RN_T_BODY, RN_T_BODYRES, RN_T_SUBS, RN_T_CHILDREN,
  RN_T_AFTER_EACH, RN_T_HOOKS2, RN_T_FIN,
  RN_S_BEFORE, RN_S_HOOKS1, RN_S_CHECK1, RN_S_AFTER, RN_S_HOOKS2, RN_S_FIN,
  RN_R_FINISH, RN_CHILD_LOOP
};

typedef struct ScrRunNode {
  ScrTestCtx *t; /* retained */
  void (*done)(void *);
  void *done_arg;
  int kind; /* 0 test, 1 suite, 2 root */
  int phase;
  int after_children;
  double start;
  ScrTestHookRef *hl;
  size_t hn, hi;
  size_t ci;
  bool only;
  ScrTestCtx *prev_parent;
  bool failed;
  ScrPromise *awaiting;
  bool busy, child_fin;
} ScrRunNode;

static void rn_advance(ScrRunNode *r);

static bool scr_test_any_only(ScrTestCtx *parent) {
  for (size_t i = 0; i < parent->nchildren; i++) {
    if (parent->children[i]->flags & SCR_TEST_F_ONLY) return true;
  }
  return false;
}

static bool scr_test_subtree_failed(const ScrTestCtx *t) {
  for (size_t i = 0; i < t->nchildren; i++) {
    int s = t->children[i]->state;
    if (s == SCR_TS_FAIL || s == SCR_TS_CHILDFAIL) return true;
  }
  return false;
}

/* The microtask continuation of a parked async hook or body: take the settlement (a rejection is left pending in the cell) and go on. */
static void rn_wakeup(void *ap) {
  ScrRunNode *r = (ScrRunNode *)ap;
  ScrPromise *p = r->awaiting;
  r->awaiting = NULL;
  (void)scr_promise_settled_take(p);
  scr_promise_release(p);
  rn_advance(r);
}

/* Call one stored closure by its lowering-pinned shape. True when it PARKED on an async result (the caller returns; rn_wakeup resumes). `ctx`
 * is passed +1 when the body takes the TestContext. A sync call leaves any failure in the active cell. */
static bool rn_call(ScrRunNode *r, ScrClosure *cb, int flags, ScrTestCtx *ctx) {
  bool takes_ctx = (flags & SCR_TEST_F_CTX) != 0;
  if (flags & SCR_TEST_F_ASYNC) {
    ScrPromise *p =
        takes_ctx
            ? ((ScrPromise * (*)(ScrClosure *, ScrTestCtx *)) cb->fn)(cb, scr_testctx_retain(ctx))
            : ((ScrPromise * (*)(ScrClosure *)) cb->fn)(cb);
    if (!scr_exc_pending() && p) {
      r->awaiting = p;
      scr_promise_wait_raw(p, rn_wakeup, r);
      return true;
    }
    scr_promise_release(p);
  } else if (takes_ctx) {
    ((void (*)(ScrClosure *, ScrTestCtx *))cb->fn)(cb, scr_testctx_retain(ctx));
  } else {
    ((void (*)(ScrClosure *))cb->fn)(cb);
  }
  return false;
}

static void rn_hooks_free(ScrRunNode *r) {
  free(r->hl);
  r->hl = NULL;
  r->hn = r->hi = 0;
}

static void rn_hooks_add(ScrRunNode *r, ScrTestCtx *owner, int which) {
  ScrTestHooks *h = &owner->hooks[which];
  if (h->n == 0) return;
  r->hl = realloc(r->hl, (r->hn + h->n) * sizeof *r->hl);
  if (!r->hl) scr_test_oom();
  for (size_t i = 0; i < h->n; i++) {
    r->hl[r->hn].cb = h->v[i].cb;
    r->hl[r->hn].flags = h->v[i].flags;
    r->hn++;
  }
}

/* The hook list of beforeEach (outermost suite first) or afterEach (innermost first) over the ancestor chain. */
static void rn_hooks_each(ScrRunNode *r, int which, bool outermost_first) {
  rn_hooks_free(r);
  ScrTestCtx *chain[64];
  int n = 0;
  for (ScrTestCtx *p = r->t->parent; p && n < 64; p = p->parent) chain[n++] = p;
  if (outermost_first) {
    for (int i = n - 1; i >= 0; i--) rn_hooks_add(r, chain[i], which);
  } else {
    for (int i = 0; i < n; i++) rn_hooks_add(r, chain[i], which);
  }
}

/* Runs the pending hook list until one parks (true) or the list ends or a hook failed (false). */
static bool rn_run_hooks(ScrRunNode *r) {
  while (r->hi < r->hn && !scr_exc_pending()) {
    ScrTestHookRef h = r->hl[r->hi++];
    if (rn_call(r, h.cb, h.flags, NULL)) return true;
  }
  return false;
}

static void rn_finish(ScrRunNode *r) {
  void (*done)(void *) = r->done;
  void *arg = r->done_arg;
  rn_hooks_free(r);
  scr_testctx_release(r->t);
  free(r);
  if (done) done(arg);
}

static void rn_start(ScrTestCtx *t, int kind, void (*done)(void *), void *done_arg);

/* A child finished: continue its parent. If the child completed synchronously inside the parent's own advance, the parent's loop continues. */
static void rn_child_done(void *ap) {
  ScrRunNode *r = (ScrRunNode *)ap;
  if (r->busy) {
    r->child_fin = true;
    return;
  }
  rn_advance(r);
}

static void rn_advance(ScrRunNode *r) {
  ScrTestCtx *t = r->t;
  r->busy = true;
  for (;;) {
    switch (r->phase) {
    /* ── a test: beforeEach chain, the body, the subtests it started, the children it queued, the afterEach chain ── */
    case RN_T_BEFORE_EACH:
      r->prev_parent = scr_test_reg_parent;
      scr_test_reg_parent = t;
      rn_hooks_each(r, SCR_HOOK_BEFORE_EACH, true);
      r->phase = RN_T_HOOKS1;
      break;
    case RN_T_HOOKS1:
      if (rn_run_hooks(r)) { /* parked on an async hook: the phase stays, so the rest of the list runs on resume */
        r->busy = false;
        return;
      }
      r->phase = RN_T_BODY;
      break;
    case RN_T_BODY:
      r->failed = false;
      if (scr_exc_pending()) {
        t->err = scr_exc_take();
        r->failed = true;
        r->phase = RN_T_SUBS;
      } else if (t->cb) {
        r->phase = RN_T_BODYRES;
        if (rn_call(r, t->cb, t->flags, t)) {
          r->busy = false;
          return;
        }
      } else {
        r->phase = RN_T_SUBS;
      }
      break;
    case RN_T_BODYRES:
      if (scr_exc_pending()) {
        t->err = scr_exc_take();
        r->failed = true;
      }
      r->phase = RN_T_SUBS;
      break;
    case RN_T_SUBS:
      /* Subtests the body started with t.test and did not await are still running: the parent stays open for them (Node's contract). */
      if (t->sub_running > 0) {
        t->waiter = r;
        r->phase = RN_T_CHILDREN;
        r->busy = false;
        return;
      }
      r->phase = RN_T_CHILDREN;
      break;
    case RN_T_CHILDREN:
      /* Children a passing body registered without running (bare test() in the body): run them now, before the parent completes. */
      if (!r->failed) {
        r->ci = 0;
        r->only = scr_test_any_only(t);
        r->after_children = RN_T_AFTER_EACH;
        r->phase = RN_CHILD_LOOP;
      } else {
        r->phase = RN_T_AFTER_EACH;
      }
      break;
    case RN_T_AFTER_EACH:
      rn_hooks_each(r, SCR_HOOK_AFTER_EACH, false);
      r->phase = RN_T_HOOKS2;
      break;
    case RN_T_HOOKS2:
      if (rn_run_hooks(r)) {
        r->busy = false;
        return;
      }
      r->phase = RN_T_FIN;
      break;
    case RN_T_FIN: {
      if (scr_exc_pending()) {
        if (!r->failed && !t->err) {
          t->err = scr_exc_take();
          r->failed = true;
        } else {
          scr_exc_clear();
        }
      }
      scr_test_reg_parent = r->prev_parent;
      t->dur_ms = scr_now_ms() - r->start;
      if (t->mode == SCR_TEST_SKIP) {
        t->state = SCR_TS_SKIPPED; /* t.skip() marked it mid-body */
      } else if (t->mode == SCR_TEST_TODO) {
        t->state = r->failed ? SCR_TS_TODO_FAIL : SCR_TS_TODO_PASS;
      } else if (r->failed) {
        t->state = SCR_TS_FAIL;
      } else {
        t->state = scr_test_subtree_failed(t) ? SCR_TS_CHILDFAIL : SCR_TS_PASS;
      }
      t->running = false;
      scr_test_report_result(t);
      r->busy = false;
      rn_finish(r);
      return;
    }
    /* ── a suite: before hooks, children, after hooks ── */
    case RN_S_BEFORE:
      rn_hooks_free(r);
      rn_hooks_add(r, t, SCR_HOOK_BEFORE);
      r->phase = RN_S_HOOKS1;
      break;
    case RN_S_HOOKS1:
      if (rn_run_hooks(r)) {
        r->busy = false;
        return;
      }
      r->phase = RN_S_CHECK1;
      break;
    case RN_S_CHECK1:
      if (scr_exc_pending()) {
        t->err = scr_exc_take();
        r->phase = RN_S_FIN;
      } else {
        r->ci = 0;
        r->only = scr_test_any_only(t);
        r->after_children = RN_S_AFTER;
        r->phase = RN_CHILD_LOOP;
      }
      break;
    case RN_S_AFTER:
      rn_hooks_free(r);
      rn_hooks_add(r, t, SCR_HOOK_AFTER);
      r->phase = RN_S_HOOKS2;
      break;
    case RN_S_HOOKS2:
      if (rn_run_hooks(r)) {
        r->busy = false;
        return;
      }
      r->phase = RN_S_FIN;
      break;
    case RN_S_FIN:
      if (scr_exc_pending()) t->err = scr_exc_take();
      t->dur_ms = scr_now_ms() - r->start;
      if (t->err) scr_test_suite_hook_failed = true;
      t->state = t->err ? SCR_TS_FAIL : scr_test_subtree_failed(t) ? SCR_TS_CHILDFAIL : SCR_TS_PASS;
      t->running = false;
      scr_test_report_result(t);
      r->busy = false;
      rn_finish(r);
      return;
    /* ── the root: the children, then the summary ── */
    case RN_R_FINISH:
      r->busy = false;
      rn_finish(r);
      return;
    /* ── the shared child loop: each eligible child runs to completion before the next starts ── */
    case RN_CHILD_LOOP: {
      bool started = false;
      while (r->ci < t->nchildren) {
        ScrTestCtx *c = t->children[r->ci++];
        /* `only: true` among the siblings: the others are dropped entirely. Subtests t.test already started are not run again. */
        if (r->only && !(c->flags & SCR_TEST_F_ONLY)) continue;
        if (c->state != SCR_TS_PENDING || c->running) continue;
        r->child_fin = false;
        rn_start(c, 0, rn_child_done, r);
        if (r->child_fin) {
          r->child_fin = false;
          continue; /* it completed synchronously */
        }
        started = true;
        break;
      }
      if (started) {
        r->busy = false;
        return; /* parked on the child; rn_child_done advances */
      }
      r->phase = r->after_children;
      break;
    }
    default:
      r->busy = false;
      return;
    }
  }
}

/* Starts one node. `kind` 2 is the root (children only). Completion calls done(done_arg), possibly before this returns. */
static void rn_start(ScrTestCtx *t, int kind, void (*done)(void *), void *done_arg) {
  ScrRunNode *r = calloc(1, sizeof *r);
  if (!r) scr_test_oom();
  r->t = scr_testctx_retain(t);
  r->done = done;
  r->done_arg = done_arg;
  r->start = scr_now_ms();
  t->running = true;
  if (kind == 2) {
    r->kind = 2;
    r->ci = 0;
    r->only = scr_test_any_only(t);
    r->after_children = RN_R_FINISH;
    r->phase = RN_CHILD_LOOP;
  } else if (t->mode == SCR_TEST_SKIP) {
    t->dur_ms = scr_now_ms() - r->start;
    t->state = SCR_TS_SKIPPED;
    t->running = false;
    scr_test_report_result(t);
    rn_finish(r);
    return;
  } else if (t->is_suite) {
    /* The body already ran at registration (children collected). A hook throw fails the SUITE with that error: before-failures skip the
     * children (Node cancels them; SEMANTICS.md numbers the difference). */
    r->kind = 1;
    r->phase = RN_S_BEFORE;
  } else {
    r->kind = 0;
    r->phase = RN_T_BEFORE_EACH;
  }
  rn_advance(r);
}

/* ── the summary + failing-tests section ─────────────────────────────── */

static void scr_test_count(const ScrTestCtx *t) {
  for (size_t i = 0; i < t->nchildren; i++) {
    const ScrTestCtx *c = t->children[i];
    if (c->state == SCR_TS_PENDING) continue; /* only-filtered / never ran */
    if (c->is_suite) {
      scr_test_ct_suites++;
    } else {
      scr_test_ct_tests++;
      switch (c->state) {
      case SCR_TS_PASS: scr_test_ct_pass++; break;
      case SCR_TS_FAIL:
      case SCR_TS_CHILDFAIL: scr_test_ct_fail++; break;
      case SCR_TS_SKIPPED: scr_test_ct_skipped++; break;
      case SCR_TS_TODO_PASS:
      case SCR_TS_TODO_FAIL: scr_test_ct_todo++; break;
      default: break;
      }
    }
    scr_test_count(c);
  }
}

static void scr_test_info_line(const char *label, double value) {
  char num[32];
  fputs("\xE2\x84\xB9 ", stdout);
  fputs(label, stdout);
  fputc(' ', stdout);
  size_t n = scr_f64_to_str(value, num);
  fwrite(num, 1, n, stdout);
  fputc('\n', stdout);
}

/* The failing-tests detail: "test at <file>:<line>:<col>" (the file
 * relative to the working directory when it lies underneath, Node's
 * rendering), the result line at column 0, the error message indented two
 * spaces per line. Node appends the stack frames and an inspect property
 * block; this runtime stops at the message (SEMANTICS.md — the harness
 * strips both sides). */
/* One path character, compared the way the host filesystem compares it.
 * On Windows `/` and `\` are the same separator and names are
 * case-insensitive, and the two spellings genuinely MEET here: the
 * compiler embeds the location with forward slashes on every host, while
 * getcwd() answers `G:\dir`. A byte compare therefore never matched on
 * win32, so every failing test printed its ABSOLUTE location where Node
 * prints the cwd-relative one. */
static bool scr_test_path_eq(char a, char b) {
#ifdef _WIN32
  if (a == '/') a = '\\';
  if (b == '/') b = '\\';
  if (a >= 'A' && a <= 'Z') a = (char)(a - 'A' + 'a');
  if (b >= 'A' && b <= 'Z') b = (char)(b - 'A' + 'a');
#endif
  return a == b;
}

static bool scr_test_is_sep(char c) {
#ifdef _WIN32
  return c == '/' || c == '\\';
#else
  return c == '/';
#endif
}

static void scr_test_print_at(const ScrStr *at) {
  fputs("test at ", stdout);
  char cwd[4096];
  if (getcwd(cwd, sizeof cwd)) {
    size_t cl = strlen(cwd);
    bool match = at->len > cl + 1 && scr_test_is_sep(at->data[cl]);
    for (size_t i = 0; match && i < cl; i++) {
      if (!scr_test_path_eq(at->data[i], cwd[i])) match = false;
    }
    if (match) {
      /* Node renders the relative path with the platform separator
       * (`tests\fixtures\…` on Windows), so the tail is re-spelled the
       * way path.relative would spell it. Identity off win32. */
      for (size_t i = cl + 1; i < at->len; i++) {
        char c = at->data[i];
#ifdef _WIN32
        if (c == '/') c = '\\';
#endif
        fputc(c, stdout);
      }
      fputc('\n', stdout);
      return;
    }
  }
  fwrite(at->data, 1, at->len, stdout);
  fputc('\n', stdout);
}

static void scr_test_print_failure(ScrTestCtx *t) {
  fputc('\n', stdout);
  if (t->at) scr_test_print_at(t->at);
  fputs(scr_test_symbol(t->state), stdout);
  fputc(' ', stdout);
  scr_test_print_str(t->name);
  scr_test_print_dur(t->dur_ms);
  if (t->state == SCR_TS_TODO_FAIL) {
    fputs(" # ", stdout);
    if (t->msg) scr_test_print_str(t->msg);
    else fputs("TODO", stdout);
  }
  fputc('\n', stdout);
  if (t->err) {
    ScrStr *msg = scr_caught_to_string(t->err);
    if (msg) {
      const char *p = msg->data;
      const char *end = msg->data + msg->len;
      while (p <= end) {
        const char *nl = memchr(p, '\n', (size_t)(end - p));
        size_t linelen = nl ? (size_t)(nl - p) : (size_t)(end - p);
        fputs("  ", stdout);
        fwrite(p, 1, linelen, stdout);
        fputc('\n', stdout);
        if (!nl) break;
        p = nl + 1;
      }
      scr_str_release(msg);
    }
  }
}

/* Own-body failures in declaration order — Node lists the tests whose
 * bodies threw (todo throwers included); parents failed by descendants
 * and suites never appear. */
static void scr_test_print_failures(ScrTestCtx *t, bool *any) {
  for (size_t i = 0; i < t->nchildren; i++) {
    ScrTestCtx *c = t->children[i];
    if (!c->is_suite && (c->state == SCR_TS_FAIL || c->state == SCR_TS_TODO_FAIL) && c->err) {
      if (!*any) {
        *any = true;
        fputs("\n\xE2\x9C\x96 failing tests:\n", stdout);
      }
      scr_test_print_failure(c);
    }
    scr_test_print_failures(c, any);
  }
}

/* ── the runner fiber ────────────────────────────────────────────────── */

/* The summary after the root's children finished: the same text the runner fiber printed at its end. */
static void scr_test_runner_done(void *arg) {
  (void)arg;
  ScrTestCtx *root = scr_test_root;
  scr_test_run_done = true;
  scr_test_count(root);
  scr_test_info_line("tests", (double)scr_test_ct_tests);
  scr_test_info_line("suites", (double)scr_test_ct_suites);
  scr_test_info_line("pass", (double)scr_test_ct_pass);
  scr_test_info_line("fail", (double)scr_test_ct_fail);
  scr_test_info_line("cancelled", 0);
  scr_test_info_line("skipped", (double)scr_test_ct_skipped);
  scr_test_info_line("todo", (double)scr_test_ct_todo);
  scr_test_info_line("duration_ms", round((scr_now_ms() - scr_test_t0) * 1e6) / 1e6);
  bool any = false;
  scr_test_print_failures(root, &any);
  /* The tree is done reporting: release it (test bodies may still hold their TestContext refs: the boxes stay alive through those). */
  scr_test_reg_parent = NULL;
  scr_test_root = NULL;
  scr_testctx_release(root);
}

/* The runner's first turn: one microtask after the first registration, so it runs only after main returns and the loop drains microtasks
 * (Node starts the first test after the file's synchronous body completes). */
static void scr_test_runner_start(void *arg) {
  (void)arg;
  rn_start(scr_test_root, 2, scr_test_runner_done, NULL);
}

static void scr_test_ensure_runner(void) {
  if (scr_test_runner_spawned) return;
  scr_test_runner_spawned = true;
  scr_test_t0 = scr_now_ms();
  scr_queue_microtask_raw(&scr_test_runner_start, NULL, NULL);
}

/* ── the registration surface (libCall targets) ──────────────────────── */

void scr_test_register(ScrStr *name /*borrowed*/, double mode, ScrStr *msg /*borrowed*/,
                        ScrClosure *cb /*moves, may be NULL*/, double flags,
                        ScrStr *at /*borrowed*/) {
  scr_test_ensure_root();
  scr_test_ensure_runner();
  if (scr_test_run_done) {
    /* Registration after the run completed (a late timer callback):
     * Node throws ERR_TEST_FAILURE; this runtime drops it (SEMANTICS). */
    scr_closure_release(cb);
    return;
  }
  ScrTestCtx *t = scr_test_node_new(name, (int)mode, msg, cb, (int)flags, at, false);
  scr_test_child_add(scr_test_reg_parent, t);
}

void scr_test_suite(ScrStr *name /*borrowed*/, double mode, ScrStr *msg /*borrowed*/,
                     ScrClosure *cb /*moves, may be NULL*/, ScrStr *at /*borrowed*/) {
  scr_test_ensure_root();
  scr_test_ensure_runner();
  if (scr_test_run_done) {
    scr_closure_release(cb);
    return;
  }
  ScrTestCtx *t = scr_test_node_new(name, (int)mode, msg, NULL, 0, at, true);
  scr_test_child_add(scr_test_reg_parent, t);
  /* The suite body runs NOW (Node's collection phase) — its test()/it()
   * calls attach here. Skipped suites keep their bodies unrun. */
  if (cb && (int)mode != SCR_TEST_SKIP) {
    ScrTestCtx *prev = scr_test_reg_parent;
    scr_test_reg_parent = t;
    ((void (*)(ScrClosure *))cb->fn)(cb);
    scr_test_reg_parent = prev;
  }
  scr_closure_release(cb);
}

void scr_test_hook(double which, ScrClosure *cb /*moves*/, double flags) {
  scr_test_ensure_root();
  ScrTestCtx *owner = scr_test_reg_parent;
  ScrTestHooks *h = &owner->hooks[(int)which];
  if (h->n == h->cap) {
    h->cap = h->cap ? h->cap * 2 : 2;
    h->v = realloc(h->v, h->cap * sizeof *h->v);
    if (!h->v) scr_test_oom();
  }
  h->v[h->n].cb = cb;
  h->v[h->n].flags = (int)flags;
  h->n++;
}

/* t.test(...): registers under `t` and — because subtests run inline on
 * the runner fiber at their call site (Node's awaited-subtest ordering) —
 * runs it immediately. Returns the settled promise `await t.test(...)`
 * consumes. */
typedef struct {
  ScrTestCtx *parent; /* retained */
  ScrPromise *p;      /* the promise handed to the caller, fulfilled when the subtest finishes (owned) */
} ScrTestSubDone;

static void scr_test_sub_done(void *ap) {
  ScrTestSubDone *d = (ScrTestSubDone *)ap;
  ScrTestCtx *t = d->parent;
  scr_promise_fulfill_void(d->p);
  scr_promise_release(d->p);
  free(d);
  if (t->sub_running > 0) t->sub_running--;
  if (t->sub_running == 0 && t->waiter) {
    ScrRunNode *w = t->waiter;
    t->waiter = NULL;
    scr_testctx_release(t);
    rn_advance(w);
    return;
  }
  scr_testctx_release(t);
}

ScrPromise *scr_test_sub(ScrTestCtx *t, ScrStr *name /*borrowed*/, double mode,
                          ScrStr *msg /*borrowed*/, ScrClosure *cb /*moves, may be NULL*/,
                          double flags, ScrStr *at /*borrowed*/) {
  ScrTestCtx *sub = scr_test_node_new(name, (int)mode, msg, cb, (int)flags, at, false);
  scr_test_child_add(t, sub);
  ScrPromise *p = scr_promise_new();
  ScrTestSubDone *d = malloc(sizeof *d);
  if (!d) scr_test_oom();
  d->parent = scr_testctx_retain(t);
  d->p = scr_promise_retain(p);
  t->sub_running++;
  rn_start(sub, 0, scr_test_sub_done, d); /* runs inline to its first suspension, like the call site always did */
  return p;
}

void scr_test_ctx_skip(ScrTestCtx *t, ScrStr *msg /*borrowed*/) {
  t->mode = SCR_TEST_SKIP;
  if (msg && msg->len > 0) {
    scr_str_release(t->msg);
    t->msg = scr_str_retain(msg);
  }
}

void scr_test_ctx_todo(ScrTestCtx *t, ScrStr *msg /*borrowed*/) {
  t->mode = SCR_TEST_TODO;
  if (msg && msg->len > 0) {
    scr_str_release(t->msg);
    t->msg = scr_str_retain(msg);
  }
}

void scr_test_ctx_diagnostic(ScrTestCtx *t, ScrStr *msg /*borrowed*/) {
  if (t->ndiags == t->dcap) {
    t->dcap = t->dcap ? t->dcap * 2 : 2;
    t->diags = realloc(t->diags, t->dcap * sizeof *t->diags);
    if (!t->diags) scr_test_oom();
  }
  t->diags[t->ndiags++] = scr_str_retain(msg);
}

ScrStr *scr_test_ctx_name(ScrTestCtx *t) {
  return t->name ? scr_str_retain(t->name) : scr_str_new("", 0);
}

int scr_test_exit_code(void) {
  /* The runner never finished: a test awaited a promise nobody settles
   * and the loop exhausted (Node cancels the test and exits 1 — the
   * summary it prints there is not reproduced; SEMANTICS.md). Never a
   * silent pass. */
  if (scr_test_runner_spawned && !scr_test_run_done) {
    fflush(stdout);
    fputs("scriptc: node:test runner never finished (a test awaited a promise nobody settles)\n", stderr);
    return 1;
  }
  return (scr_test_ct_fail > 0 || scr_test_suite_hook_failed) ? 1 : 0;
}
