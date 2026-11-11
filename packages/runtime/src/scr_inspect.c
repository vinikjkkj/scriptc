/* util.inspect — the runtime half of the static rendering. The compiler
 * synthesizes one traversal helper per static type (lower-inspect.ts, the
 * deepStrictEqual precedent); THIS file owns everything the static type
 * cannot know: Node's exact scalar formatting (number -0, the
 * single→double→backtick quoting ladder with C0/C1/DEL/lone-surrogate
 * escapes, the 10000-char string cap and the per-line ` +` continuation
 * form), Buffer's <Buffer aa bb> hex form, and the LAYOUT engine — a
 * frame stack reproducing reduceToSingleString, isBelowBreakLength, and
 * groupArrayElements from Node v24's lib/internal/util/inspect.js for the
 * The layout and scalar limits (breakLength, compact, maxArrayLength,
 * maxStringLength, numericSeparator, sorted, depth) are the process-global
 * InspOpts that scr_insp_opts_push installs around each top-level inspect
 * (Node's ctx.*); the defaults are Node's own.
 *
 * Lengths follow Node exactly: the break-length math counts UTF-16 code
 * units (JS .length); the grid-grouping math counts DISPLAY WIDTH. Node
 * with ICU measures width via icu::getStringWidth over NFC-normalized
 * text; this file ports the non-ICU fallback tables (full-width/
 * zero-width code points, no NFC) — pure-ASCII entries agree exactly,
 * exotic grouped entries may not (SEMANTICS.md divergence).
 *
 * The frame stack is process-global (single-threaded runtime, and the
 * synthesized traversals never call user code — no getters, no custom
 * inspect — so renders never nest re-entrantly mid-frame).
 *
 * Ownership: ScrStr/ScrBytes/ScrDyn/ScrError arguments are BORROWED;
 * ScrStr results return +1. Nothing here throws; OOM aborts. */
#include "scr_runtime.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void insp_oom(void) {
  scr_trap("scriptc: out of memory\n");
}

/* ── a tiny append-only byte buffer ──────────────────────────────────── */

typedef struct {
  char *data;
  size_t len;
  size_t cap;
} InspBuf;

/* ── options (Node's ctx.breakLength / compact / maxArrayLength / ...) ───
 * The active set is process-global. The frontend brackets every top-level
 * util.inspect with scr_insp_opts_push (saving the previous set) and
 * scr_insp_opts_pop (restoring it). Options this runtime does not render
 * yet (colors, showHidden, getters, showProxy, customInspect false, a
 * sorted comparator, compact true) stop the program with a named message:
 * they are OPEN (ci-classes iofmtopts), never a silent default. */
typedef enum { INSP_COMPACT_OFF, INSP_COMPACT_TRUE, INSP_COMPACT_NUM } InspCompact;
typedef struct {
  double depth;        /* ctx.depth: Infinity = unbounded (null/undefined/NaN) */
  double break_length; /* ctx.breakLength (JS number; NaN compares false) */
  InspCompact compact_kind;
  double compact;      /* ctx.compact when compact_kind == INSP_COMPACT_NUM */
  double max_array;    /* ctx.maxArrayLength: a non-negative integer or Infinity */
  double max_string;   /* ctx.maxStringLength: a non-negative integer or Infinity */
  bool numeric_sep;    /* ctx.numericSeparator (truthy) */
  bool sorted;         /* ctx.sorted === true */
  bool colors;         /* ctx.colors (truthy): leaves print inside util.inspect.styles' ANSI codes */
#ifdef SCR_INSP_COLORS /* the extension's options: linked in only for a program that may pass them */
  bool show_proxy;     /* ctx.showProxy (truthy): a Proxy prints `Proxy [ target, handler ]` */
  bool show_hidden;    /* ctx.showHidden (truthy): non-enumerable own properties print as `[key]: value` */
  unsigned char getters; /* ctx.getters: 0 off, 1 true, 2 'get' (getter only), 3 'set' (getter with a setter) */
  bool no_custom;      /* ctx.customInspect falsy: [util.inspect.custom] methods are not called */
  const ScrDyn *sorted_fn;  /* ctx.sorted a function: the comparator (borrowed from the options object, alive for the call) */
  const ScrDyn *stylize_fn; /* ctx.stylize a user function (borrowed) */
#endif
} InspOpts;
static const InspOpts INSP_DEFAULT_OPTS = {2.0, 80.0, INSP_COMPACT_NUM, 3.0, 100.0, 10000.0, false, false, false};
static InspOpts g_opts = {2.0, 80.0, INSP_COMPACT_NUM, 3.0, 100.0, 10000.0, false, false, false};
/* Colors are compiled in only for a program that may ask for them (moduleUsesInspColors -> -DSCR_INSP_COLORS); every other program
 * keeps the renderer's plain paths as constants. */
#ifdef SCR_INSP_COLORS
#define INSP_COLORS_ON (g_opts.colors)
/* ctx.stylize is anything but the identity: ANSI colors, or a function the options carried (used only while colors is off) */
#define INSP_STY_ON (g_opts.colors || g_opts.stylize_fn != NULL)
#else
#define INSP_COLORS_ON 0
#define INSP_STY_ON 0
#endif
#ifdef SCR_INSP_COLORS
#define INSP_COMPACT_ON (g_opts.compact_kind == INSP_COMPACT_TRUE)
#define INSP_SH (g_opts.show_hidden)
#else
#define INSP_COMPACT_ON 0
#define INSP_SH 0
#endif
#ifdef SCR_INSP_COLORS
static ScrDyn *g_native_stylize;
#endif
/* Node's %s / %d / %i conversions run with stylizeNoColor: the span between these two macros renders uncolored. */
#ifdef SCR_INSP_COLORS
#define INSP_NOCOLOR_BEGIN const bool insp_nc_saved_ = g_opts.colors; g_opts.colors = false
#define INSP_NOCOLOR_END g_opts.colors = insp_nc_saved_
#define INSP_NOSTYLE_BEGIN const bool insp_ns_saved_ = g_opts.colors; const ScrDyn *insp_ns_fn_ = g_opts.stylize_fn; g_opts.colors = false; g_opts.stylize_fn = NULL
#define INSP_NOSTYLE_END g_opts.colors = insp_ns_saved_; g_opts.stylize_fn = insp_ns_fn_
#else
#define INSP_NOCOLOR_BEGIN ((void)0)
#define INSP_NOCOLOR_END ((void)0)
#define INSP_NOSTYLE_BEGIN ((void)0)
#define INSP_NOSTYLE_END ((void)0)
#endif
static void ib_hname(InspBuf *b, const char *key);
static InspOpts *g_opts_stack;
static size_t g_indent; /* ctx.indentationLvl (tentative: defined with the frame stack below) */
static size_t *g_indent_stack; /* the indentation each pushed option set interrupted: a nested top-level inspect starts at 0 */
static size_t g_opts_n;
static size_t g_opts_cap;
/* keys appended to the array frame about to end (sorted only among themselves) */
static size_t g_sort_tail;

static void insp_unsupported(const char *what) {
  fflush(stdout);
  fprintf(stderr, "scriptc: util.inspect option %s is not lowered yet (OPEN: ci-classes iofmtopts)\n", what);
  exit(1);
}

static double insp_js_min(double a, double b) {
  if (isnan(a) || isnan(b)) return NAN;
  return a < b ? a : b;
}
static double insp_js_max(double a, double b) {
  if (isnan(a) || isnan(b)) return NAN;
  return a > b ? a : b;
}

/* ToNumber over the primitive kinds an options object can carry. An object
 * valued numeric option would run user valueOf code: it stays unsupported. */
static double insp_opt_num(const ScrDyn *v, const char *key) {
  switch (v->kind) {
    case SCR_DYN_NUM: return v->v.num;
    case SCR_DYN_BOOL: return v->v.b ? 1.0 : 0.0;
    case SCR_DYN_NULL: return 0.0;
    case SCR_DYN_UNDEF: return NAN;
    case SCR_DYN_STR: return scr_dyn_to_number(v);
    default: insp_unsupported(key);
  }
  return NAN;
}

/* maxArrayLength / maxStringLength: null means Infinity (Node normalizes it);
 * every other value keeps its JS number, fractions and negatives included. */
static double insp_opt_count(const ScrDyn *v, const char *key) {
  if (v->kind == SCR_DYN_NULL) return INFINITY;
  return insp_opt_num(v, key);
}

/* Node's inspect(value, opts): the keys listed below replace the defaults,
 * anything else is ignored (it lands in ctx.userOptions, which renders
 * nothing). A non-object opts (undefined, null, numbers, strings) keeps the
 * defaults; a boolean opts is showHidden. */
void scr_insp_opts_push(const ScrDyn *o) {
  InspOpts n = INSP_DEFAULT_OPTS;
  const ScrDyn *v;
  if (o != NULL && o->kind == SCR_DYN_BOOL) {
#ifdef SCR_INSP_COLORS
    if (o->v.b) n.show_hidden = true;
#else
    if (o->v.b) insp_unsupported("showHidden");
#endif
  } else if (o != NULL && o->kind == SCR_DYN_OBJ) {
    if ((v = scr_dyn_obj_own_data(o, "depth", 5)) != NULL) {
      double x = v->kind == SCR_DYN_NULL || v->kind == SCR_DYN_UNDEF ? NAN : insp_opt_num(v, "depth");
      n.depth = isnan(x) ? INFINITY : x;
    }
    if ((v = scr_dyn_obj_own_data(o, "breakLength", 11)) != NULL) n.break_length = insp_opt_num(v, "breakLength");
    if ((v = scr_dyn_obj_own_data(o, "compact", 7)) != NULL) {
      if (v->kind == SCR_DYN_BOOL && v->v.b) {
#ifdef SCR_INSP_COLORS
        n.compact_kind = INSP_COMPACT_TRUE;
#else
        insp_unsupported("compact: true");
#endif
      } else if (v->kind == SCR_DYN_NUM) {
        n.compact_kind = INSP_COMPACT_NUM;
        n.compact = v->v.num;
      } else {
        n.compact_kind = INSP_COMPACT_OFF; /* false, or any non-number: multi-line */
      }
    }
    if ((v = scr_dyn_obj_own_data(o, "maxArrayLength", 14)) != NULL) n.max_array = insp_opt_count(v, "maxArrayLength");
    if ((v = scr_dyn_obj_own_data(o, "maxStringLength", 15)) != NULL) n.max_string = insp_opt_count(v, "maxStringLength");
    if ((v = scr_dyn_obj_own_data(o, "numericSeparator", 16)) != NULL) n.numeric_sep = scr_dyn_truthy(v);
    if ((v = scr_dyn_obj_own_data(o, "sorted", 6)) != NULL) {
      if (scr_dyn_truthy(v)) {
#ifdef SCR_INSP_COLORS
        n.sorted = true;
        if (!(v->kind == SCR_DYN_BOOL && v->v.b)) n.sorted_fn = v; /* a comparator (or a value the sort will refuse) */
#else
        if (v->kind != SCR_DYN_BOOL) insp_unsupported("sorted with a comparator");
        n.sorted = true;
#endif
      }
    }
#ifdef SCR_INSP_COLORS
    if ((v = scr_dyn_obj_own_data(o, "showHidden", 10)) != NULL && scr_dyn_truthy(v)) n.show_hidden = true;
#else
    if ((v = scr_dyn_obj_own_data(o, "showHidden", 10)) != NULL && scr_dyn_truthy(v)) insp_unsupported("showHidden");
#endif
    if ((v = scr_dyn_obj_own_data(o, "colors", 6)) != NULL && scr_dyn_truthy(v)) {
#ifdef SCR_INSP_COLORS
      n.colors = true;
#else
      insp_unsupported("colors");
#endif
    }
#ifdef SCR_INSP_COLORS
    if ((v = scr_dyn_obj_own_data(o, "showProxy", 9)) != NULL && scr_dyn_truthy(v)) n.show_proxy = true;
    if ((v = scr_dyn_obj_own_data(o, "getters", 7)) != NULL) {
      /* formatProperty: true shows every getter's value, 'get' the getter-only ones, 'set' the ones that also have a setter;
       * any other truthy value matches none of the three tests and prints the bare [Getter] label. */
      if (v->kind == SCR_DYN_BOOL && v->v.b) n.getters = 1;
      else if (v->kind == SCR_DYN_STR && v->v.str->len == 3 && memcmp(v->v.str->data, "get", 3) == 0) n.getters = 2;
      else if (v->kind == SCR_DYN_STR && v->v.str->len == 3 && memcmp(v->v.str->data, "set", 3) == 0) n.getters = 3;
    }
    if ((v = scr_dyn_obj_own_data(o, "customInspect", 13)) != NULL && !scr_dyn_truthy(v)) n.no_custom = true;
#else
    if ((v = scr_dyn_obj_own_data(o, "showProxy", 9)) != NULL && scr_dyn_truthy(v)) insp_unsupported("showProxy");
    if ((v = scr_dyn_obj_own_data(o, "getters", 7)) != NULL && scr_dyn_truthy(v)) insp_unsupported("getters");
    if ((v = scr_dyn_obj_own_data(o, "customInspect", 13)) != NULL && !scr_dyn_truthy(v)) insp_unsupported("customInspect: false");
#endif
    /* A forwarded `options` (inspect(x, options) inside a custom method) carries the stylize this runtime handed out: the
     * identity, colors being off. Any other stylize function would have to be called per token and stops by name. */
    if ((v = scr_dyn_obj_own_data(o, "stylize", 7)) != NULL) {
      const char *sn = v->kind == SCR_DYN_FUNC ? scr_dyn_fn_name(v) : NULL;
#ifdef SCR_INSP_COLORS
      if (v == g_native_stylize) sn = "stylizeNoColor"; /* the stylize this runtime handed out under colors: the options' own colors key already says so */
#endif
#ifdef SCR_INSP_COLORS
      /* inspect(): `ctx.stylize = opts.stylize`, then `if (ctx.colors) ctx.stylize = stylizeWithColor`: the function is used only while colors is off. */
      if (v->kind == SCR_DYN_FUNC && !(sn != NULL && strcmp(sn, "stylizeNoColor") == 0)) {
        if (!n.colors) n.stylize_fn = v;
      } else if (sn == NULL || strcmp(sn, "stylizeNoColor") != 0) {
        insp_unsupported("stylize");
      }
#else
      if (sn == NULL || strcmp(sn, "stylizeNoColor") != 0) insp_unsupported("stylize");
#endif
    }
  }
  if (g_opts_n == g_opts_cap) {
    g_opts_cap = g_opts_cap ? g_opts_cap * 2 : 8;
    g_opts_stack = realloc(g_opts_stack, g_opts_cap * sizeof(InspOpts));
    if (!g_opts_stack) insp_oom();
    g_indent_stack = realloc(g_indent_stack, g_opts_cap * sizeof(size_t));
    if (!g_indent_stack) insp_oom();
  }
  g_indent_stack[g_opts_n] = g_indent;
  g_indent = 0;
  g_opts_stack[g_opts_n++] = g_opts;
  g_opts = n;
}

void scr_insp_opts_pop(void) {
  if (g_opts_n == 0) {
    g_opts = INSP_DEFAULT_OPTS;
    return;
  }
  g_opts = g_opts_stack[--g_opts_n];
  g_indent = g_indent_stack[g_opts_n];
}

/* The options object a [util.inspect.custom] method receives (Node's getUserOptions over the active context): the keys in
 * Node's order, `stylize` being the caller's function (identity, colors are off). +1. */
/* The two function values every [util.inspect.custom] method receives, registered by the entry module's init
 * (customInspectRegistration): options.stylize and inspect. Held for the life of the program. */
static ScrDyn *g_custom_stylize;
static ScrDyn *g_custom_inspect;
void scr_insp_custom_register(ScrDyn *stylize, ScrDyn *inspect) {
  scr_audit_release_hook = scr_insp_custom_release;
  if (g_custom_stylize == NULL) {
    g_custom_stylize = scr_dyn_retain(stylize);
    g_custom_inspect = scr_dyn_retain(inspect);
  }
}

/* The registered pair lives for the program; the exit audit releases it so it is not counted as a leak. */
void scr_insp_custom_release(void) {
  if (g_custom_stylize != NULL) scr_dyn_release(g_custom_stylize);
  if (g_custom_inspect != NULL) scr_dyn_release(g_custom_inspect);
  g_custom_stylize = NULL;
  g_custom_inspect = NULL;
}

#ifdef SCR_INSP_COLORS
static ScrDyn *insp_native_stylize(void);
static ScrDyn *scr_dyn_new_str_lit(const char *t) {
  ScrStr *x = scr_str_new(t, strlen(t));
  ScrDyn *r = scr_dyn_new_str(x);
  scr_str_release(x);
  return r;
}
#endif

ScrDyn *scr_insp_custom_opts(ScrDyn *stylize) {
#ifdef SCR_INSP_COLORS
  if (g_opts.colors) stylize = insp_native_stylize();
  else if (g_opts.stylize_fn != NULL) stylize = (ScrDyn *)g_opts.stylize_fn;
#endif
  ScrDyn *o = scr_dyn_new_obj();
#define INSP_SETK(k, v) scr_dyn_obj_set(o, k, sizeof(k) - 1, (v))
  INSP_SETK("stylize", scr_dyn_retain(stylize));
#ifdef SCR_INSP_COLORS
  INSP_SETK("showHidden", scr_dyn_new_bool(g_opts.show_hidden));
#else
  INSP_SETK("showHidden", scr_dyn_new_bool(false));
#endif
  INSP_SETK("depth", scr_dyn_new_num(g_opts.depth));
  INSP_SETK("colors", scr_dyn_new_bool(INSP_COLORS_ON));
#ifdef SCR_INSP_COLORS
  INSP_SETK("customInspect", scr_dyn_new_bool(!g_opts.no_custom));
  INSP_SETK("showProxy", scr_dyn_new_bool(g_opts.show_proxy));
#else
  INSP_SETK("customInspect", scr_dyn_new_bool(true));
  INSP_SETK("showProxy", scr_dyn_new_bool(false));
#endif
  INSP_SETK("maxArrayLength", scr_dyn_new_num(g_opts.max_array));
  INSP_SETK("maxStringLength", scr_dyn_new_num(g_opts.max_string));
  INSP_SETK("breakLength", scr_dyn_new_num(g_opts.break_length));
  INSP_SETK("compact", g_opts.compact_kind == INSP_COMPACT_NUM ? scr_dyn_new_num(g_opts.compact)
                                                                : scr_dyn_new_bool(g_opts.compact_kind == INSP_COMPACT_TRUE));
#ifdef SCR_INSP_COLORS
  INSP_SETK("sorted", g_opts.sorted_fn != NULL ? scr_dyn_retain((ScrDyn *)g_opts.sorted_fn) : scr_dyn_new_bool(g_opts.sorted));
  INSP_SETK("getters", g_opts.getters == 2 ? scr_dyn_new_str_lit("get") : g_opts.getters == 3 ? scr_dyn_new_str_lit("set") : scr_dyn_new_bool(g_opts.getters == 1));
#else
  INSP_SETK("sorted", scr_dyn_new_bool(g_opts.sorted));
  INSP_SETK("getters", scr_dyn_new_bool(false));
#endif
  INSP_SETK("numericSeparator", scr_dyn_new_bool(g_opts.numeric_sep));
#undef INSP_SETK
  return o;
}

/* The active depth budget (the frontend's depth argument for the traversal). */
double scr_insp_opt_depth(void) { return g_opts.depth; }



/* Node's maxLength for a composite of n entries: min(max(0, maxArrayLength), n). */
static double insp_cap(double n) { return insp_js_min(insp_js_max(0.0, g_opts.max_array), n); }
/* Entries a `i < maxLength` loop emits (ceil of the cap; NaN emits none). */
static size_t insp_shown(size_t n) {
  double c = insp_cap((double)n);
  return isnan(c) ? 0 : (size_t)ceil(c);
}
/* remaining = n - maxLength; the "... more items" tail exists when it is > 0. */
static double insp_rem(size_t n) { return (double)n - insp_cap((double)n); }
static bool insp_more(size_t n) { return insp_rem(n) > 0; }
/* Node's `ctx.maxArrayLength < output.length` (the grid drops its last entry). */
static bool insp_over_cap(size_t n) { return (double)n > g_opts.max_array; }
/* For a composite of n entries: how many the traversal emits, and the tail
 * count (n - maxLength, which is "more items" when > 0). */
double scr_insp_shown(double n) {
  double c = insp_cap(n);
  return isnan(c) ? 0.0 : ceil(c);
}
double scr_insp_rem(double n) { return n - insp_cap(n); }
static bool insp_groups(void) { return g_opts.compact_kind == INSP_COMPACT_NUM && g_opts.compact >= 1; }

static void ib_grow(InspBuf *b, size_t need) {
  if (b->len + need <= b->cap) return;
  size_t cap = b->cap ? b->cap * 2 : 64;
  while (cap < b->len + need) cap *= 2;
  char *data = realloc(b->data, cap);
  if (!data) insp_oom();
  b->data = data;
  b->cap = cap;
}

static void ib_bytes(InspBuf *b, const char *s, size_t len) {
  ib_grow(b, len);
  memcpy(b->data + b->len, s, len);
  b->len += len;
}

static void ib_cstr(InspBuf *b, const char *s) { ib_bytes(b, s, strlen(s)); }
static void ib_char(InspBuf *b, char c) { ib_bytes(b, &c, 1); }
static void ib_str(InspBuf *b, const ScrStr *s) { ib_bytes(b, s->data, s->len); }

static void ib_spaces(InspBuf *b, size_t n) {
  ib_grow(b, n);
  memset(b->data + b->len, ' ', n);
  b->len += n;
}

static ScrStr *ib_take(InspBuf *b) {
  ScrStr *out = scr_str_new(b->data ? b->data : "", b->len);
  free(b->data);
  return out;
}

/* ── colors (ctx.stylize = stylizeWithColor) ───────────────────────────
 * Node's util.inspect.styles over util.inspect.colors: the default tables, as pairs of SGR codes. */
typedef enum { INSP_STY_SPECIAL, INSP_STY_NUMBER, INSP_STY_BIGINT, INSP_STY_BOOLEAN, INSP_STY_UNDEFINED, INSP_STY_NULL, INSP_STY_STRING, INSP_STY_SYMBOL, INSP_STY_DATE, INSP_STY_REGEXP, INSP_STY_MODULE, INSP_STY_NAME } InspStyle; /* INSP_STY_NAME is stylize's 'name' (a bare key): no color, only a user stylize function sees it */
__attribute__((unused)) static const char *const INSP_STY_OPEN[] = {"\x1b[36m", "\x1b[33m", "\x1b[33m", "\x1b[33m", "\x1b[90m", "\x1b[1m", "\x1b[32m", "\x1b[32m", "\x1b[35m", "\x1b[31m", "\x1b[4m"};
__attribute__((unused)) static const char *const INSP_STY_CLOSE[] = {"\x1b[39m", "\x1b[39m", "\x1b[39m", "\x1b[39m", "\x1b[39m", "\x1b[22m", "\x1b[39m", "\x1b[39m", "\x1b[39m", "\x1b[39m", "\x1b[24m"};

#ifdef SCR_INSP_COLORS
/* util.inspect.styles / util.inspect.colors as LIVE tables: created only when the program reads them (libCall insp.styles /
 * insp.colorTable), after which every stylize reads them as Node's stylizeWithColor does. Without them the constant tables above apply. */
static ScrDyn *g_tbl_styles;
static ScrDyn *g_tbl_colors;
static const char *const INSP_STYLE_NAMES[] = {"special", "number", "bigint", "boolean", "undefined", "null", "string", "symbol", "date", "regexp", "module"};
static const char *const INSP_STYLE_DEFAULT_COLOR[] = {"cyan", "yellow", "yellow", "yellow", "grey", "bold", "green", "green", "magenta", "red", "underline"};
static const struct { const char *name; int open, close; } INSP_COLOR_ROWS[] = {
  {"reset", 0, 0}, {"bold", 1, 22}, {"dim", 2, 22}, {"italic", 3, 23}, {"underline", 4, 24}, {"blink", 5, 25}, {"inverse", 7, 27}, {"hidden", 8, 28},
  {"strikethrough", 9, 29}, {"doubleunderline", 21, 24}, {"black", 30, 39}, {"red", 31, 39}, {"green", 32, 39}, {"yellow", 33, 39}, {"blue", 34, 39},
  {"magenta", 35, 39}, {"cyan", 36, 39}, {"white", 37, 39}, {"bgBlack", 40, 49}, {"bgRed", 41, 49}, {"bgGreen", 42, 49}, {"bgYellow", 43, 49},
  {"bgBlue", 44, 49}, {"bgMagenta", 45, 49}, {"bgCyan", 46, 49}, {"bgWhite", 47, 49}, {"framed", 51, 54}, {"overlined", 53, 55}, {"gray", 90, 39},
  {"redBright", 91, 39}, {"greenBright", 92, 39}, {"yellowBright", 93, 39}, {"blueBright", 94, 39}, {"magentaBright", 95, 39}, {"cyanBright", 96, 39},
  {"whiteBright", 97, 39}, {"bgGray", 100, 49}, {"bgRedBright", 101, 49}, {"bgGreenBright", 102, 49}, {"bgYellowBright", 103, 49},
  {"bgBlueBright", 104, 49}, {"bgMagentaBright", 105, 49}, {"bgCyanBright", 106, 49}, {"bgWhiteBright", 107, 49},
  /* the aliases Node defines as getters, here as plain rows (a read by name answers the same pair) */
  {"grey", 90, 39}, {"blackBright", 90, 39}, {"bgGrey", 100, 49}, {"bgBlackBright", 100, 49}, {"faint", 2, 22}, {"crossedout", 9, 29},
  {"strikeThrough", 9, 29}, {"crossedOut", 9, 29}, {"conceal", 8, 28}, {"swapColors", 7, 27}, {"swapcolors", 7, 27}, {"doubleUnderline", 21, 24},
};
static void insp_tables_release(void) {
  if (g_tbl_styles != NULL) scr_dyn_release(g_tbl_styles);
  if (g_tbl_colors != NULL) scr_dyn_release(g_tbl_colors);
  g_tbl_styles = g_tbl_colors = NULL;
}
static void insp_tables_make(void) {
  if (g_tbl_styles != NULL) return;
  g_tbl_styles = scr_dyn_new_obj_null_proto();
  for (size_t i = 0; i < sizeof INSP_STYLE_NAMES / sizeof INSP_STYLE_NAMES[0]; i++) {
    ScrStr *v = scr_str_new(INSP_STYLE_DEFAULT_COLOR[i], strlen(INSP_STYLE_DEFAULT_COLOR[i]));
    scr_dyn_obj_set(g_tbl_styles, INSP_STYLE_NAMES[i], strlen(INSP_STYLE_NAMES[i]), scr_dyn_new_str(v));
    scr_str_release(v);
  }
  g_tbl_colors = scr_dyn_new_obj_null_proto();
  for (size_t i = 0; i < sizeof INSP_COLOR_ROWS / sizeof INSP_COLOR_ROWS[0]; i++) {
    ScrDyn *pair = scr_dyn_new_arr();
    scr_dyn_arr_push(pair, scr_dyn_new_num(INSP_COLOR_ROWS[i].open));
    scr_dyn_arr_push(pair, scr_dyn_new_num(INSP_COLOR_ROWS[i].close));
    scr_dyn_obj_set(g_tbl_colors, INSP_COLOR_ROWS[i].name, strlen(INSP_COLOR_ROWS[i].name), pair);
  }
  scr_atexit(insp_tables_release);
}
ScrDyn *scr_insp_styles_table(void) {
  insp_tables_make();
  return scr_dyn_retain(g_tbl_styles);
}
ScrDyn *scr_insp_colors_table(void) {
  insp_tables_make();
  return scr_dyn_retain(g_tbl_colors);
}
/* stylizeWithColor's lookup: styles[style] -> colors[that name] -> [open, close]; any miss means the text is returned as it is. */
static const char *insp_live_code(InspStyle st, int which) {
  static char buf[2][48];
  buf[which][0] = '\0';
  const ScrDyn *sv = scr_dyn_obj_own_data(g_tbl_styles, INSP_STYLE_NAMES[st], strlen(INSP_STYLE_NAMES[st]));
  if (sv == NULL || sv->kind != SCR_DYN_STR) return buf[which];
  const ScrDyn *cv = scr_dyn_obj_own_data(g_tbl_colors, sv->v.str->data, sv->v.str->len);
  if (cv == NULL || cv->kind != SCR_DYN_ARR || cv->v.arr.len < 2) return buf[which];
  ScrStr *code = scr_dyn_string_coerce(cv->v.arr.items[which]);
  if (code == NULL) return buf[which];
  size_t n = code->len < 40 ? code->len : 40;
  buf[which][0] = 0x1b;
  buf[which][1] = '[';
  memcpy(buf[which] + 2, code->data, n);
  buf[which][2 + n] = 'm';
  buf[which][3 + n] = '\0';
  scr_str_release(code);
  return buf[which];
}
static inline const char *insp_open(InspStyle st) { return g_tbl_styles != NULL ? insp_live_code(st, 0) : INSP_STY_OPEN[st]; }
static inline const char *insp_close(InspStyle st) { return g_tbl_styles != NULL ? insp_live_code(st, 1) : INSP_STY_CLOSE[st]; }
#else
#define insp_open(st) INSP_STY_OPEN[st]
#define insp_close(st) INSP_STY_CLOSE[st]
#endif

/* The user's stylize function over (text, style name): its answer as a string, the text itself when it threw (the throw stays pending). */
#ifdef SCR_INSP_COLORS
static ScrStr *insp_sty_user(ScrStr *s, InspStyle st) {
  static const char *const names[] = {"special", "number", "bigint", "boolean", "undefined", "null", "string", "symbol", "date", "regexp", "module", "name"};
  ScrDyn *args[2];
  args[0] = scr_dyn_new_str(s);
  ScrStr *nm = scr_str_new(names[st], strlen(names[st]));
  args[1] = scr_dyn_new_str(nm);
  scr_str_release(nm);
  ScrDyn *r = scr_dyn_call(g_opts.stylize_fn, args, 2, "stylize");
  scr_dyn_release(args[0]);
  scr_dyn_release(args[1]);
  if (r == NULL) return s;
  ScrStr *out = scr_dyn_string_coerce(r);
  scr_dyn_release(r);
  if (out == NULL) return s;
  scr_str_release(s);
  return out;
}
#endif
/* ctx.stylize(text, style): the text between the style's two codes when colors are on, the user function's answer when one is set, the text itself otherwise. Consumes `s`, +1. */
__attribute__((unused)) static ScrStr *insp_sty_on(ScrStr *s, InspStyle st) {
#ifdef SCR_INSP_COLORS
  if (!g_opts.colors) return insp_sty_user(s, st);
#endif
  if (st == INSP_STY_NAME) return s;
  InspBuf b = {0};
  ib_cstr(&b, insp_open(st));
  ib_bytes(&b, s->data, s->len);
  ib_cstr(&b, insp_close(st));
  scr_str_release(s);
  return ib_take(&b);
}
#define insp_sty(s_, st_) (__builtin_expect(INSP_STY_ON, 0) ? insp_sty_on((s_), (st_)) : (s_))
__attribute__((unused)) static void ib_sty_cstr(InspBuf *b, const char *text, InspStyle st) {
  if (INSP_STY_ON) {
    ScrStr *t = insp_sty_on(scr_str_new(text, strlen(text)), st);
    ib_bytes(b, t->data, t->len);
    scr_str_release(t);
    return;
  }
  ib_cstr(b, text);
}
/* Style the bytes written since `mark` as one token. */
__attribute__((unused)) static void ib_sty_from(InspBuf *b, size_t mark, InspStyle st) {
  ScrStr *t = insp_sty_on(scr_str_new(b->data + mark, b->len - mark), st);
  b->len = mark;
  ib_bytes(b, t->data, t->len);
  scr_str_release(t);
}
/* A string literal as a leaf: the length is a compile-time constant, and colors off costs the one test. */
#define insp_sty_lit(text, st) insp_sty(scr_str_new(text, sizeof(text) - 1), st)

#ifdef SCR_INSP_COLORS
/* ctx.stylize when colors are on (stylizeWithColor over the default util.inspect.styles / colors): handed to [util.inspect.custom]
 * methods in `options.stylize`. A native function value, cached for the life of the program. */
static void insp_native_stylize_release(void) {
  if (g_native_stylize != NULL) {
    scr_dyn_release(g_native_stylize);
    g_native_stylize = NULL;
  }
}
static ScrDyn *insp_native_stylize_thunk(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  ScrDyn *str = argc > 0 ? args[0] : scr_dyn_undefined();
  ScrStr *text = scr_dyn_string_coerce(str);
  if (text == NULL) return NULL;
  static const char *const names[] = {"special", "number", "bigint", "boolean", "undefined", "null", "string", "symbol", "date", "regexp", "module"};
  if (argc > 1 && args[1]->kind == SCR_DYN_STR) {
    const ScrStr *t = args[1]->v.str;
    for (size_t i = 0; i < sizeof names / sizeof names[0]; i++) {
      if (strlen(names[i]) == t->len && memcmp(names[i], t->data, t->len) == 0) {
        ScrStr *st = insp_sty_on(text, (InspStyle)i);
        ScrDyn *r = scr_dyn_new_str(st);
        scr_str_release(st);
        return r;
      }
    }
  }
  ScrDyn *r = scr_dyn_new_str(text);
  scr_str_release(text);
  return r;
}
static ScrDyn *insp_native_stylize(void) {
  if (g_native_stylize == NULL) {
    g_native_stylize = scr_dyn_new_func(scr_closure_new((void *)insp_native_stylize_thunk, 0), insp_native_stylize_thunk, 2, "()", "stylize");
    scr_atexit(insp_native_stylize_release);
  }
  return g_native_stylize;
}
#endif


/* removeColors: the visible bytes of `s` (the SGR sequences `ESC [ <digits> m` dropped), written into a fresh buffer. */
__attribute__((unused)) static size_t insp_strip_colors(const char *data, size_t len, char *out) {
  size_t n = 0;
  for (size_t i = 0; i < len;) {
    if (data[i] == 0x1b && i + 1 < len && data[i + 1] == '[') {
      size_t j = i + 2;
      while (j < len && data[j] >= '0' && data[j] <= '9') j++;
      if (j < len && data[j] == 'm') {
        i = j + 1;
        continue;
      }
    }
    out[n++] = data[i++];
  }
  return n;
}

/* What the inspect of an instance answers for the value its [util.inspect.custom] method returned (formatValue's custom
 * branch): a string passes with every newline followed by the current indentation, anything else is inspected as a value at
 * the same position. Borrows r; +1, or the empty dummy with a pending exception. */
ScrStr *scr_insp_custom_result(ScrDyn *r, double recurse, double depth) {
  if (r->kind != SCR_DYN_STR) return scr_insp_dyn(r, recurse, depth);
  const ScrStr *t = r->v.str;
  if (g_indent == 0) return scr_str_retain(r->v.str);
  InspBuf b = {0};
  for (size_t i = 0; i < t->len; i++) {
    ib_char(&b, t->data[i]);
    if (t->data[i] == '\n') ib_spaces(&b, g_indent);
  }
  return ib_take(&b);
}

/* util.format %o (scr_insp_dyn_h): function values also list their hidden keys. */
static bool scr_insp_show_hidden = false;

/* ── WTF-8 iteration + JS length/width measures ──────────────────────── */

/* Decode the code point at data[i] (WTF-8: lone surrogates ride 3-byte
 * ED A0..BF xx sequences). Malformed bytes decode as themselves — the
 * runtime never produces them, this is belt-and-braces. Advances *i. */
static uint32_t insp_cp_at(const char *data, size_t len, size_t *i) {
  const unsigned char *p = (const unsigned char *)data;
  unsigned char c = p[*i];
  if (c < 0x80) {
    *i += 1;
    return c;
  }
  if ((c & 0xe0) == 0xc0 && *i + 1 < len) {
    uint32_t cp = ((uint32_t)(c & 0x1f) << 6) | (p[*i + 1] & 0x3f);
    *i += 2;
    return cp;
  }
  if ((c & 0xf0) == 0xe0 && *i + 2 < len) {
    uint32_t cp = ((uint32_t)(c & 0x0f) << 12) | ((uint32_t)(p[*i + 1] & 0x3f) << 6) |
                  (p[*i + 2] & 0x3f);
    *i += 3;
    return cp;
  }
  if ((c & 0xf8) == 0xf0 && *i + 3 < len) {
    uint32_t cp = ((uint32_t)(c & 0x07) << 18) | ((uint32_t)(p[*i + 1] & 0x3f) << 12) |
                  ((uint32_t)(p[*i + 2] & 0x3f) << 6) | (p[*i + 3] & 0x3f);
    *i += 4;
    return cp;
  }
  *i += 1;
  return c;
}

/* JS .length: UTF-16 code units (astral code points count 2). */
static size_t insp_utf16_len(const char *data, size_t len) {
  size_t units = 0;
  for (size_t i = 0; i < len;) {
    uint32_t cp = insp_cp_at(data, len, &i);
    units += cp >= 0x10000 ? 2 : 1;
  }
  return units;
}

/* Node's non-ICU isFullWidthCodePoint table (inspect.js). */
static bool insp_full_width(uint32_t code) {
  return code >= 0x1100 &&
         (code <= 0x115f || code == 0x2329 || code == 0x232a ||
          (code >= 0x2e80 && code <= 0x3247 && code != 0x303f) ||
          (code >= 0x3250 && code <= 0x4dbf) || (code >= 0x4e00 && code <= 0xa4c6) ||
          (code >= 0xa960 && code <= 0xa97c) || (code >= 0xac00 && code <= 0xd7a3) ||
          (code >= 0xf900 && code <= 0xfaff) || (code >= 0xfe10 && code <= 0xfe19) ||
          (code >= 0xfe30 && code <= 0xfe6b) || (code >= 0xff01 && code <= 0xff60) ||
          (code >= 0xffe0 && code <= 0xffe6) || (code >= 0x1b000 && code <= 0x1b001) ||
          (code >= 0x1f200 && code <= 0x1f251) || (code >= 0x1f300 && code <= 0x1f64f) ||
          (code >= 0x20000 && code <= 0x3fffd));
}

/* Node's non-ICU isZeroWidthCodePoint table (inspect.js). */
static bool insp_zero_width(uint32_t code) {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f) ||
         (code >= 0x300 && code <= 0x36f) || (code >= 0x200b && code <= 0x200f) ||
         (code >= 0x20d0 && code <= 0x20ff) || (code >= 0xfe00 && code <= 0xfe0f) ||
         (code >= 0xfe20 && code <= 0xfe2f) || (code >= 0xe0100 && code <= 0xe01ef);
}

/* Display width (grouping math only): Node's non-ICU getStringWidth,
 * without the NFC normalization ICU builds apply (SEMANTICS.md). */
static inline __attribute__((always_inline)) size_t insp_width(const char *data, size_t len) {
  size_t width = 0;
  for (size_t i = 0; i < len;) {
    uint32_t cp = insp_cp_at(data, len, &i);
    if (insp_full_width(cp)) width += 2;
    else if (!insp_zero_width(cp)) width += 1;
  }
  return width;
}

/* ── number rendering ────────────────────────────────────────────────── */

/* formatNumber: JS ToString EXCEPT -0 renders as '-0'. */
/* addNumericSeparator over an ASCII integer string: groups of three from the
 * right, after a leading '-'. */
/* Display width / UTF-16 length of an entry with its color codes removed (colors on only; never inlined into the plain paths). */
__attribute__((unused)) static __attribute__((noinline)) size_t insp_width_plain(const ScrStr *e) {
  char *plain = malloc(e->len + 1);
  if (!plain) insp_oom();
  size_t pn = insp_strip_colors(e->data, e->len, plain);
  size_t w = insp_width(plain, pn);
  free(plain);
  return w;
}
__attribute__((unused)) static __attribute__((noinline)) size_t insp_len_plain(const ScrStr *e) {
  char *plain = malloc(e->len + 1);
  if (!plain) insp_oom();
  size_t pn = insp_strip_colors(e->data, e->len, plain);
  size_t n = insp_utf16_len(plain, pn);
  free(plain);
  return n;
}

static void insp_add_sep(InspBuf *b, const char *s, size_t len) {
  size_t start = len > 0 && s[0] == '-' ? 1 : 0;
  size_t i = len;
  size_t groups = 0;
  while (i >= start + 4) {
    i -= 3;
    groups++;
  }
  ib_bytes(b, s, i);
  for (size_t g = 0; g < groups; g++) {
    ib_char(b, '_');
    ib_bytes(b, s + i + 3 * g, 3);
  }
}

/* addNumericSeparatorEnd: groups of three from the left, each followed by '_'. */
static void insp_add_sep_end(InspBuf *b, const char *s, size_t len) {
  size_t i = 0;
  for (; i + 3 < len; i += 3) {
    ib_bytes(b, s + i, 3);
    ib_char(b, '_');
  }
  ib_bytes(b, s + i, len - i);
}

/* formatNumber with numericSeparator: String(x), grouped. -0 has no sign
 * here (String(-0) is "0" and the integer test passes). */
static ScrStr *insp_num_sep(double x) {
  char buf[40];
  size_t n = scr_f64_to_str(x, buf);
  InspBuf out = {0};
  if (trunc(x) == x) {
    if (!isfinite(x) || memchr(buf, 'e', n) != NULL) return scr_str_new(buf, n);
    insp_add_sep(&out, buf, n);
    return ib_take(&out);
  }
  if (isnan(x)) return scr_str_new(buf, n);
  /* decimalIndex = indexOf('.'): -1 when the text has none (exponent form),
   * and slice(0, -1) then drops only the last character, as Node's does. */
  const char *dot = memchr(buf, '.', n);
  long di = dot != NULL ? (long)(dot - buf) : -1;
  size_t int_len = di >= 0 ? (size_t)di : n - 1;
  size_t frac_at = di >= 0 ? (size_t)di + 1 : 0;
  insp_add_sep(&out, buf, int_len);
  ib_char(&out, '.');
  insp_add_sep_end(&out, buf + frac_at, n - frac_at);
  return ib_take(&out);
}

ScrStr *scr_insp_f64(double x) {
  if (g_opts.numeric_sep) return insp_num_sep(x);
  if (x == 0.0 && signbit(x)) return scr_str_new("-0", 2);
  char buf[40];
  size_t n = scr_f64_to_str(x, buf);
  return scr_str_new(buf, n);
}

/* ── string quoting (strEscape) ──────────────────────────────────────── */

/* The C0 escape table (inspect.js `meta`, entries 0x00-0x1f). */
static const char *const INSP_C0[32] = {
    "\\x00", "\\x01", "\\x02", "\\x03", "\\x04", "\\x05", "\\x06", "\\x07",
    "\\b",   "\\t",   "\\n",   "\\x0B", "\\f",   "\\r",   "\\x0E", "\\x0F",
    "\\x10", "\\x11", "\\x12", "\\x13", "\\x14", "\\x15", "\\x16", "\\x17",
    "\\x18", "\\x19", "\\x1A", "\\x1B", "\\x1C", "\\x1D", "\\x1E", "\\x1F",
};

static bool insp_contains_byte(const char *data, size_t len, char c) {
  return memchr(data, c, len) != NULL;
}

static bool insp_contains_dollar_brace(const char *data, size_t len) {
  for (size_t i = 0; i + 1 < len; i++) {
    if (data[i] == '$' && data[i + 1] == '{') return true;
  }
  return false;
}

/* Quote selection: single quotes; double when the text has ' but no ";
 * backtick when it has both but no ` and no ${. -1 = ", -2 = `, 39 = '. */
static int insp_pick_quote(const char *data, size_t len) {
  if (!insp_contains_byte(data, len, '\'')) return 39;
  if (!insp_contains_byte(data, len, '"')) return -1;
  if (!insp_contains_byte(data, len, '`') && !insp_contains_dollar_brace(data, len)) return -2;
  return 39;
}

static char insp_quote_char(int quote) { return quote == -1 ? '"' : quote == -2 ? '`' : '\''; }

/* strEscape's body between the quotes: escape backslash, C0 (the meta
 * table), DEL + C1 as \xNN (uppercase), lone surrogates as \udNNN
 * (lowercase — Number.prototype.toString(16)), and the single quote only
 * when quoting with '. */
static void insp_escape_into(InspBuf *b, const char *data, size_t len, int quote) {
  for (size_t i = 0; i < len;) {
    size_t start = i;
    uint32_t cp = insp_cp_at(data, len, &i);
    if (cp < 0x20) {
      ib_cstr(b, INSP_C0[cp]);
    } else if (cp == '\'' && quote == 39) {
      ib_cstr(b, "\\'");
    } else if (cp == '\\') {
      ib_cstr(b, "\\\\");
    } else if (cp >= 0x7f && cp <= 0x9f) {
      char esc[8];
      snprintf(esc, sizeof esc, "\\x%02X", cp);
      ib_cstr(b, esc);
    } else if (cp >= 0xd800 && cp <= 0xdfff) {
      char esc[8];
      snprintf(esc, sizeof esc, "\\u%x", cp);
      ib_cstr(b, esc);
    } else {
      ib_bytes(b, data + start, i - start);
    }
  }
}

static void insp_quote_into(InspBuf *b, const char *data, size_t len) {
  int quote = insp_pick_quote(data, len);
  ib_char(b, insp_quote_char(quote));
  insp_escape_into(b, data, len, quote);
  ib_char(b, insp_quote_char(quote));
}

/* ── the frame stack ─────────────────────────────────────────────────── */

typedef struct {
  ScrStr **items;
  size_t len;
  size_t cap;
  bool all_num; /* every entry so far flagged numeric (grouping order) */
#ifdef SCR_INSP_COLORS
  unsigned char extra; /* compact: true gives an object frame's properties indentation +3 (formatProperty's diff) instead of +2: this is the +1 */
#endif
} InspFrame;

static InspFrame *g_frames;
static size_t g_nframes;
static size_t g_frames_cap;
static double g_cur_depth;    /* ctx.currentDepth (last-entered composite) */

static InspFrame *insp_top(void) { return &g_frames[g_nframes - 1]; }

static void insp_circ_reset(void); /* circular-reference state, below */

/* Begin a non-empty composite: formatRaw's `recurseTimes += 1;
 * ctx.currentDepth = recurseTimes` plus the uniform +2 the children
 * format under. `recurse` is the CHILDREN's recursion depth. */
void scr_insp_begin(double recurse) {
  if (recurse == 1) insp_circ_reset(); /* a fresh top-level value: Node's per-inspect ctx */
  if (g_nframes == g_frames_cap) {
    g_frames_cap = g_frames_cap ? g_frames_cap * 2 : 8;
    g_frames = realloc(g_frames, g_frames_cap * sizeof(InspFrame));
    if (!g_frames) insp_oom();
  }
  InspFrame *f = &g_frames[g_nframes++];
  f->items = NULL;
  f->len = 0;
  f->cap = 0;
  f->all_num = true;
#ifdef SCR_INSP_COLORS
  f->extra = 0;
#endif
  g_cur_depth = recurse;
  g_indent += 2;
}

/* The frame of a composite whose entries are `key: value` properties (formatProperty's kObjectType): under compact: true they
 * format at indentation +3. Every other program: scr_insp_begin. */
#ifdef SCR_INSP_COLORS
static inline void insp_begin_obj(double recurse) {
  scr_insp_begin(recurse);
  if (g_opts.compact_kind == INSP_COMPACT_TRUE) {
    g_indent += 1;
    insp_top()->extra = 1;
  }
}
#else
#define insp_begin_obj scr_insp_begin
#endif

/* `: <value>` of one kObjectType property. Under compact: true a value wider than breakLength moves to its own line
 * (`name:\n<indent>value`), as formatProperty's `extra` does. */
static inline void insp_kv(InspBuf *eb, const ScrStr *val) {
#ifdef SCR_INSP_COLORS
  if (g_opts.compact_kind == INSP_COMPACT_TRUE && insp_top()->extra) {
    const size_t w = INSP_COLORS_ON ? insp_width_plain(val) : insp_width(val->data, val->len);
    if ((double)w > g_opts.break_length) {
      ib_char(eb, ':');
      ib_char(eb, '\n');
      ib_spaces(eb, g_indent);
      ib_bytes(eb, val->data, val->len);
      return;
    }
  }
#endif
  ib_cstr(eb, ": ");
  ib_bytes(eb, val->data, val->len);
}

/* Append one already-rendered entry (borrowed; retained here). is_num
 * mirrors `typeof value[i] === 'number'` — it decides grid grouping's
 * padStart/padEnd order. */
void scr_insp_entry(ScrStr *s, bool is_num) {
  InspFrame *f = insp_top();
  if (f->len == f->cap) {
    f->cap = f->cap ? f->cap * 2 : 8;
    f->items = realloc(f->items, f->cap * sizeof(ScrStr *));
    if (!f->items) insp_oom();
  }
  f->items[f->len++] = scr_str_retain(s);
  if (!is_num) f->all_num = false;
}

/* ── circular references (Node's <ref *N> / [Circular *N]) ────────────
 * Recursive record/class types permit runtime reference cycles, and Node
 * renders them with formatValue's seen/circular machinery: a value
 * already ON the current traversal stack renders as `[Circular *N]` (N
 * assigned at first detection, in discovery order), and every rendering
 * of a so-numbered value gets the `<ref *N> ` prefix at its close. The
 * compiler-emitted helpers over CYCLE-CAPABLE composites drive exactly
 * that protocol: circ_check first (before the empty-literal and depth
 * answers — Node's order: a circular value beyond the depth budget still
 * says Circular), seen_push after begin, ref_wrap around end's result.
 * The circular MAP persists for one whole top-level inspect — begin(1)
 * is the per-value reset (a root composite's first frame). */
typedef struct {
  const void *ptr;
  int id; /* circular id (0 while only on the stack) */
#ifdef SCR_INSP_COLORS
  size_t frame; /* the frame (g_nframes) this value opened: compact: true folds its <ref *N> into the opening brace */
#endif
} InspSeenEnt;

static InspSeenEnt *g_seen;
static size_t g_nseen;
static size_t g_seen_cap;
/* Detection-numbered circular targets (persist across the call). */
static const void *g_circ[64];
static int g_ncirc;

static void insp_circ_reset(void) {
  g_nseen = 0;
  g_ncirc = 0;
}

static int insp_circ_id(const void *v) {
  for (int i = 0; i < g_ncirc; i++) {
    if (g_circ[i] == v) return i + 1;
  }
  return 0;
}

double scr_insp_circ_check(const void *v) {
  for (size_t i = 0; i < g_nseen; i++) {
    if (g_seen[i].ptr != v) continue;
    int id = insp_circ_id(v);
    if (id == 0 && g_ncirc < (int)(sizeof g_circ / sizeof *g_circ)) {
      g_circ[g_ncirc++] = v;
      id = g_ncirc;
    }
    return (double)id;
  }
  return 0;
}

void scr_insp_seen_push(const void *v) {
  if (g_nseen == g_seen_cap) {
    g_seen_cap = g_seen_cap ? g_seen_cap * 2 : 8;
    g_seen = realloc(g_seen, g_seen_cap * sizeof(InspSeenEnt));
    if (!g_seen) insp_oom();
  }
  g_seen[g_nseen].ptr = v;
  g_seen[g_nseen].id = 0;
#ifdef SCR_INSP_COLORS
  g_seen[g_nseen].frame = g_nframes;
#endif
  g_nseen++;
}

ScrStr *scr_insp_circular(double id) {
  char buf[32];
  int n = snprintf(buf, sizeof buf, "[Circular *%.0f]", id);
  return insp_sty(scr_str_new(buf, (size_t)n), INSP_STY_SPECIAL);
}

ScrStr *scr_insp_ref_wrap(const void *v, ScrStr *s) {
  if (g_nseen > 0) g_nseen--;
  int id = insp_circ_id(v);
  if (id == 0) return scr_str_retain(s);
#ifdef SCR_INSP_COLORS
  return scr_str_retain(s); /* scr_insp_end already put the reference in the base (or, with compact: true, the opening brace) */
#endif
  char buf[32];
  int n;
  if (INSP_STY_ON) {
    n = snprintf(buf, sizeof buf, "<ref *%d>", id);
    ScrStr *ref = insp_sty(scr_str_new(buf, (size_t)n), INSP_STY_SPECIAL);
    InspBuf rb = {0};
    ib_str(&rb, ref);
    ib_char(&rb, ' ');
    ib_str(&rb, s);
    scr_str_release(ref);
    return ib_take(&rb);
  }
  n = snprintf(buf, sizeof buf, "<ref *%d> ", id);
  ScrStr *out = scr_str_alloc_raw(s->len + (size_t)n, s->len + (size_t)n);
  memcpy(out->data, buf, (size_t)n);
  memcpy(out->data + n, s->data, s->len);
  out->data[out->len] = '\0';
  return out;
}

/* remainingText: the "... N more items" tail entry. */
ScrStr *scr_insp_more_items(double remaining) {
  char num[40];
  size_t nn = scr_f64_to_str(remaining, num);
  InspBuf b = {0};
  ib_cstr(&b, "... ");
  ib_bytes(&b, num, nn);
  ib_cstr(&b, remaining > 1 ? " more items" : " more item");
  return ib_take(&b);
}

/* groupArrayElements: the grid layout for arrays with more than six
 * entries. Rewrites the frame's items in place when grouping applies. */
static void insp_group(InspFrame *f, bool trailing_more) {
  size_t output_len = f->len - (trailing_more ? 1 : 0);
  double total_length = 0;
  double max_length = 0;
  size_t *data_len = malloc((output_len ? output_len : 1) * sizeof(size_t));
  if (!data_len) insp_oom();
  for (size_t i = 0; i < output_len; i++) {
    size_t w = __builtin_expect(INSP_COLORS_ON, 0) ? insp_width_plain(f->items[i]) : insp_width(f->items[i]->data, f->items[i]->len);
    data_len[i] = w;
    total_length += (double)w + 2;
    if ((double)w > max_length) max_length = (double)w;
  }
  double actual_max = max_length + 2;
  if (actual_max * 3 + (double)g_indent < g_opts.break_length &&
      (total_length / actual_max > 5 || max_length <= 6)) {
    double approx_char_heights = 2.5;
    double average_bias = sqrt(actual_max - total_length / (double)f->len);
    double biased_max = fmax(actual_max - 3 - average_bias, 1);
    double columns_d = insp_js_min(
        insp_js_min(round(sqrt(approx_char_heights * biased_max * (double)output_len) / biased_max),
                    floor((g_opts.break_length - (double)g_indent) / actual_max)),
        insp_js_min(g_opts.compact * 4, 15));
    if (columns_d <= 1) {
      free(data_len);
      return;
    }
    size_t columns = (size_t)columns_d;
    size_t *max_line_length = malloc(columns * sizeof(size_t));
    if (!max_line_length) insp_oom();
    for (size_t i = 0; i < columns; i++) {
      size_t line_max = 0;
      for (size_t j = i; j < output_len; j += columns) {
        if (data_len[j] > line_max) line_max = data_len[j];
      }
      max_line_length[i] = line_max + 2;
    }
    bool pad_start = f->all_num;
    ScrStr **tmp = NULL;
    size_t tmp_len = 0, tmp_cap = 0;
    for (size_t i = 0; i < output_len; i += columns) {
      size_t max = i + columns < output_len ? i + columns : output_len;
      InspBuf line = {0};
      size_t j = i;
      for (; j + 1 < max; j++) {
        size_t width = data_len[j];
        size_t target = max_line_length[j - i];
        if (pad_start) {
          if (target > width + 2) ib_spaces(&line, target - width - 2);
          ib_str(&line, f->items[j]);
          ib_cstr(&line, ", ");
        } else {
          ib_str(&line, f->items[j]);
          ib_cstr(&line, ", ");
          if (target > width + 2) ib_spaces(&line, target - width - 2);
        }
      }
      if (pad_start) {
        size_t width = data_len[j];
        size_t target = max_line_length[j - i] - 2;
        if (target > width) ib_spaces(&line, target - width);
        ib_str(&line, f->items[j]);
      } else {
        ib_str(&line, f->items[j]);
      }
      if (tmp_len == tmp_cap) {
        tmp_cap = tmp_cap ? tmp_cap * 2 : 8;
        tmp = realloc(tmp, tmp_cap * sizeof(ScrStr *));
        if (!tmp) insp_oom();
      }
      tmp[tmp_len++] = ib_take(&line);
    }
    if (trailing_more) {
      if (tmp_len == tmp_cap) {
        tmp_cap += 1;
        tmp = realloc(tmp, tmp_cap * sizeof(ScrStr *));
        if (!tmp) insp_oom();
      }
      tmp[tmp_len++] = scr_str_retain(f->items[f->len - 1]);
    }
    for (size_t i = 0; i < f->len; i++) scr_str_release(f->items[i]);
    free(f->items);
    f->items = tmp;
    f->len = tmp_len;
    f->cap = tmp_cap;
    free(max_line_length);
  }
  free(data_len);
}

/* isBelowBreakLength: UTF-16 lengths against breakLength 80. */
static bool insp_below_break_length(InspFrame *f, size_t start, const ScrStr *base) {
  size_t total = f->len + start;
  if ((double)(total + f->len) > g_opts.break_length) return false;
  if (__builtin_expect(INSP_COLORS_ON, 0)) {
    for (size_t i = 0; i < f->len; i++) {
      total += insp_len_plain(f->items[i]);
      if ((double)total > g_opts.break_length) return false;
    }
  } else {
    for (size_t i = 0; i < f->len; i++) {
      total += insp_utf16_len(f->items[i]->data, f->items[i]->len);
      if ((double)total > g_opts.break_length) return false;
    }
  }
  return base->len == 0 || !insp_contains_byte(base->data, base->len, '\n');
}

/* ── sorted: Array.prototype.sort's default order (UTF-16 code units) ── */
typedef struct {
  const char *d;
  size_t len, i;
  uint32_t lo;
  bool has_lo;
} InspU16;

static bool insp_u16_next(InspU16 *u, uint32_t *unit) {
  if (u->has_lo) {
    *unit = u->lo;
    u->has_lo = false;
    return true;
  }
  if (u->i >= u->len) return false;
  uint32_t cp = insp_cp_at(u->d, u->len, &u->i);
  if (cp >= 0x10000) {
    cp -= 0x10000;
    *unit = 0xd800 + (cp >> 10);
    u->lo = 0xdc00 + (cp & 0x3ff);
    u->has_lo = true;
  } else {
    *unit = cp;
  }
  return true;
}

static int insp_cmp16(const ScrStr *a, const ScrStr *b) {
  InspU16 x = {a->data, a->len, 0, 0, false};
  InspU16 y = {b->data, b->len, 0, 0, false};
  for (;;) {
    uint32_t ua = 0, ub = 0;
    bool ha = insp_u16_next(&x, &ua), hb = insp_u16_next(&y, &ub);
    if (!ha || !hb) return ha ? 1 : hb ? -1 : 0;
    if (ua != ub) return ua < ub ? -1 : 1;
  }
}

#ifdef SCR_INSP_COLORS
/* One comparator call: the user's `sorted` function over two entries, answered as ToNumber would read it (a non-number answer that is
 * NaN counts as 0). A throw sets `*failed` and leaves the exception pending. */
static int insp_cmp_user(const ScrDyn *fn, const ScrStr *x, const ScrStr *y, bool *failed) {
  ScrDyn *args[2];
  args[0] = scr_dyn_new_str((ScrStr *)x);
  args[1] = scr_dyn_new_str((ScrStr *)y);
  ScrDyn *r = scr_dyn_call(fn, args, 2, "comparefn");
  scr_dyn_release(args[0]);
  scr_dyn_release(args[1]);
  if (r == NULL) {
    *failed = true;
    return 0;
  }
  const double v = r->kind == SCR_DYN_NUM ? r->v.num : scr_dyn_to_number(r);
  scr_dyn_release(r);
  return v < 0 ? -1 : v > 0 ? 1 : 0;
}

/* V8's Array.prototype.sort for fewer than 64 entries (its minrun is the whole list): CountAndMakeRun, then BinaryInsertionSort. A comparator that
 * disagrees with itself (a boolean `a > b`) orders entries by exactly the comparisons V8 makes. Returns false when the comparator threw. */
static bool insp_sort_v8_small(ScrStr **v, size_t n, const ScrDyn *cmp) {
  bool failed = false;
  /* CountAndMakeRun(0, n) */
  size_t run = 1;
  if (n > 1) {
    run = 2;
    int order = insp_cmp_user(cmp, v[1], v[0], &failed);
    if (failed) return false;
    const bool desc = order < 0;
    ScrStr *prev = v[1];
    for (size_t i = 2; i < n; i++) {
      ScrStr *cur = v[i];
      order = insp_cmp_user(cmp, cur, prev, &failed);
      if (failed) return false;
      if (desc ? order >= 0 : order < 0) break;
      prev = cur;
      run++;
    }
    if (desc) {
      for (size_t i = 0, j = run - 1; i < j; i++, j--) {
        ScrStr *t = v[i];
        v[i] = v[j];
        v[j] = t;
      }
    }
  }
  /* BinaryInsertionSort(0, run, n) */
  for (size_t start = run == 0 ? 1 : run; start < n; start++) {
    size_t left = 0, right = start;
    ScrStr *pivot = v[start];
    while (left < right) {
      const size_t mid = left + ((right - left) >> 1);
      const int order = insp_cmp_user(cmp, pivot, v[mid], &failed);
      if (failed) return false;
      if (order < 0) right = mid;
      else left = mid + 1;
    }
    for (size_t q = start; q > left; q--) v[q] = v[q - 1];
    v[left] = pivot;
  }
  return true;
}

/* Bottom-up merge sort: stable, like Node's sort. `cmp` is ctx.sorted when it is a function (NULL: the default UTF-16 order). A comparator
 * that throws stops the sort with the exception pending, the entries in their current order. */
static void insp_sort_items(ScrStr **v, size_t n, const ScrDyn *cmp) {
  if (n < 2) return;
  if (cmp != NULL && n < 64) {
    insp_sort_v8_small(v, n, cmp);
    return;
  }
  ScrStr **tmp = malloc(n * sizeof(ScrStr *));
  if (!tmp) insp_oom();
  bool failed = false;
  for (size_t w = 1; w < n && !failed; w *= 2) {
    for (size_t lo = 0; lo < n; lo += 2 * w) {
      size_t mid = lo + w < n ? lo + w : n;
      size_t hi = lo + 2 * w < n ? lo + 2 * w : n;
      size_t i = lo, j = mid, k = lo;
      if (cmp != NULL) {
        while (i < mid && j < hi && !failed) tmp[k++] = insp_cmp_user(cmp, v[i], v[j], &failed) <= 0 ? v[i++] : v[j++];
        if (failed) break;
      } else {
        while (i < mid && j < hi) tmp[k++] = insp_cmp16(v[j], v[i]) < 0 ? v[j++] : v[i++];
      }
      while (i < mid) tmp[k++] = v[i++];
      while (j < hi) tmp[k++] = v[j++];
    }
    if (failed) break;
    memcpy(v, tmp, n * sizeof(ScrStr *));
  }
  free(tmp);
}

#else
/* Bottom-up merge sort: stable, like Node's sort. */
static void insp_sort_items(ScrStr **v, size_t n) {
  if (n < 2) return;
  ScrStr **tmp = malloc(n * sizeof(ScrStr *));
  if (!tmp) insp_oom();
  for (size_t w = 1; w < n; w *= 2) {
    for (size_t lo = 0; lo < n; lo += 2 * w) {
      size_t mid = lo + w < n ? lo + w : n;
      size_t hi = lo + 2 * w < n ? lo + 2 * w : n;
      size_t i = lo, j = mid, k = lo;
      while (i < mid && j < hi) tmp[k++] = insp_cmp16(v[j], v[i]) < 0 ? v[j++] : v[i++];
      while (i < mid) tmp[k++] = v[i++];
      while (j < hi) tmp[k++] = v[j++];
    }
    memcpy(v, tmp, n * sizeof(ScrStr *));
  }
  free(tmp);
}

#endif

/* reduceToSingleString for the default options (compact: 3). Pops the
 * frame. base/b0/b1 are borrowed; +1 result. `recurse` is the frame's
 * recurseTimes (the children's depth); array_extras marks kArrayExtrasType
 * (grid grouping applies); trailing_more marks a "... N more items" tail
 * entry (excluded from the grid). */
ScrStr *scr_insp_end(ScrStr *base, ScrStr *b0, ScrStr *b1, double recurse, bool array_extras,
                     bool trailing_more) {
  InspFrame *f = insp_top();
#ifdef SCR_INSP_COLORS
  ScrStr *ref_s = NULL, *eff_base = NULL;
#endif
  g_indent -= 2;
#ifdef SCR_INSP_COLORS
  g_indent -= f->extra;
#endif
  /* ctx.sorted: an object frame sorts all its entries; an array frame sorts
   * only its trailing named keys (formatRaw's keys.length tail). */
#ifdef SCR_INSP_COLORS
  if (g_opts.sorted) {
    size_t from = array_extras ? f->len - (g_sort_tail < f->len ? g_sort_tail : f->len) : 0;
    const ScrDyn *scmp = g_opts.sorted_fn;
    if (scmp != NULL && scmp->kind != SCR_DYN_FUNC) {
      /* ArrayPrototypeSort rejects a comparator that is not callable before it looks at the length; formatRaw reaches it for an
       * object frame, and for an array only when named keys follow the elements. */
      if (!array_extras || g_sort_tail > 1) scr_dyn_comparefn_throw(scmp);
    } else if (f->len - from > 1) {
      insp_sort_items(f->items + from, f->len - from, scmp);
    }
  }
#else
  if (g_opts.sorted) {
    size_t from = array_extras ? f->len - (g_sort_tail < f->len ? g_sort_tail : f->len) : 0;
    if (f->len - from > 1) insp_sort_items(f->items + from, f->len - from);
  }
#endif
  g_sort_tail = 0;
  size_t entries = f->len;
  if (insp_groups() && array_extras && entries > 6) insp_group(f, trailing_more);
  InspBuf out = {0};
  /* NO ENTRIES AT ALL: `{}`, not `{  }`. Every caller that could be empty
   * used to know it STATICALLY and returned the two characters itself --
   * an empty Map, Set, array or object literal never reaches here. A
   * record whose fields are skipped at RUN TIME can, because whether a
   * completed literal ever wrote a slot is not a compile-time fact
   * (IrRecordShape.reqabsent), and the frame then holds nothing while the
   * framing below still writes the space it reserves between brace and
   * first item. Node prints `{}` and `Map(0) {}`; this is that answer for
   * the one caller that cannot ask for it up front. */
  if (f->len == 0) {
    if (base->len) {
      ib_str(&out, base);
      ib_char(&out, ' ');
    }
    ib_str(&out, b0);
    ib_str(&out, b1);
    goto done;
  }
#ifdef SCR_INSP_COLORS
  /* A circular target's `<ref *N>`: compact: true puts it in braces[0]; every other layout puts it in `base`, where reduceToSingleString's
   * width budget counts it. (ref_wrap adds nothing in this build.) */
  if (g_nseen > 0 && g_seen[g_nseen - 1].frame == g_nframes) {
    const int rid = insp_circ_id(g_seen[g_nseen - 1].ptr);
    if (rid != 0) {
      char rb[32];
      const int rn = snprintf(rb, sizeof rb, "<ref *%d>", rid);
      ref_s = insp_sty(scr_str_new(rb, (size_t)rn), INSP_STY_SPECIAL);
    }
  }
  if (ref_s != NULL && !INSP_COMPACT_ON) {
    InspBuf rbb = {0};
    ib_str(&rbb, ref_s);
    if (base->len) {
      ib_char(&rbb, ' ');
      ib_str(&rbb, base);
    }
    eff_base = ib_take(&rbb);
    base = eff_base;
    scr_str_release(ref_s);
    ref_s = NULL;
  }
#endif
#ifdef SCR_INSP_COLORS
  if (INSP_COMPACT_ON) {
    /* reduceToSingleString with compact === true: one line when the entries fit breakLength, else the opening brace and every
     * entry aligned under the first. A circular reference's <ref *N> is part of braces[0], not of base. */
    ScrStr *ref = ref_s; /* consumed below */
    ref_s = NULL;
    InspBuf ob0 = {0};
    if (ref != NULL) {
      ib_str(&ob0, ref);
      ib_char(&ob0, ' ');
      scr_str_release(ref);
    }
    ib_str(&ob0, b0);
    if (insp_below_break_length(f, 0, base)) {
      ib_bytes(&out, ob0.data, ob0.len);
      if (base->len) {
        ib_char(&out, ' ');
        ib_str(&out, base);
      }
      ib_char(&out, ' ');
      for (size_t i = 0; i < f->len; i++) {
        if (i) ib_cstr(&out, ", ");
        ib_str(&out, f->items[i]);
      }
      ib_char(&out, ' ');
      ib_str(&out, b1);
    } else {
      const bool lone = base->len == 0 && ob0.len == 1;
      ib_bytes(&out, ob0.data, ob0.len);
      if (lone) {
        ib_char(&out, ' ');
      } else {
        if (base->len) {
          ib_char(&out, ' ');
          ib_str(&out, base);
        }
        ib_char(&out, '\n');
        ib_spaces(&out, g_indent + 2);
      }
      for (size_t i = 0; i < f->len; i++) {
        if (i) {
          ib_cstr(&out, ",\n");
          ib_spaces(&out, g_indent + 2);
        }
        ib_str(&out, f->items[i]);
      }
      ib_char(&out, ' ');
      ib_str(&out, b1);
    }
    free(ob0.data);
    goto done;
  }
#endif
  if (insp_groups() && g_cur_depth - recurse < g_opts.compact && entries == f->len) {
    size_t start = f->len + g_indent + insp_utf16_len(b0->data, b0->len) +
                   insp_utf16_len(base->data, base->len) + 10;
    if (insp_below_break_length(f, start, base)) {
      bool multiline = false;
      for (size_t i = 0; i < f->len && !multiline; i++) {
        multiline = insp_contains_byte(f->items[i]->data, f->items[i]->len, '\n');
      }
      if (!multiline) {
        if (base->len) {
          ib_str(&out, base);
          ib_char(&out, ' ');
        }
        ib_str(&out, b0);
        ib_char(&out, ' ');
        for (size_t i = 0; i < f->len; i++) {
          if (i) ib_cstr(&out, ", ");
          ib_str(&out, f->items[i]);
        }
        ib_char(&out, ' ');
        ib_str(&out, b1);
        goto done;
      }
    }
  }
  if (base->len) {
    ib_str(&out, base);
    ib_char(&out, ' ');
  }
  ib_str(&out, b0);
  for (size_t i = 0; i < f->len; i++) {
    ib_cstr(&out, i ? ",\n" : "\n");
    ib_spaces(&out, g_indent + 2);
    ib_str(&out, f->items[i]);
  }
  ib_char(&out, '\n');
  ib_spaces(&out, g_indent);
  ib_str(&out, b1);
done:;
#ifdef SCR_INSP_COLORS
  if (eff_base != NULL) scr_str_release(eff_base);
  if (ref_s != NULL) scr_str_release(ref_s);
#endif
  for (size_t i = 0; i < f->len; i++) scr_str_release(f->items[i]);
  free(f->items);
  g_nframes--;
  return ib_take(&out);
}

/* ── string values (formatPrimitive's string half) ───────────────────── */

/* Byte offset of UTF-16 unit `units` — when the boundary splits an astral
 * code point (JS slice splitting a surrogate pair), the left half keeps
 * the HIGH surrogate: *lone_high is set and the offset excludes the
 * 4-byte sequence. */
static size_t insp_utf16_offset(const char *data, size_t len, size_t units, bool *lone_high,
                                uint32_t *high_cp) {
  size_t count = 0;
  *lone_high = false;
  for (size_t i = 0; i < len;) {
    if (count == units) return i;
    size_t start = i;
    uint32_t cp = insp_cp_at(data, len, &i);
    size_t w = cp >= 0x10000 ? 2 : 1;
    if (count + w > units) {
      /* boundary splits this astral pair: keep its high surrogate */
      *lone_high = true;
      *high_cp = 0xd800 + ((cp - 0x10000) >> 10);
      return start;
    }
    count += w;
  }
  return len;
}

/* formatPrimitive over a string value under the default options:
 * maxStringLength 10000, then the per-line ` +` continuation when the
 * (truncated) text is longer than 16 chars AND breakLength(80) -
 * indentationLvl - 4, split after each newline; the trailer counts the
 * cut characters. Uses the CURRENT indentation. */
ScrStr *scr_insp_str(ScrStr *s) {
  /* A split capture that did not participate is Node's undefined. */
  if (scr_str_is_absent(s)) return scr_str_new("undefined", 9);
  InspBuf out = {0};
  const char *data = s->data;
  size_t byte_len = s->len;
  size_t units = insp_utf16_len(data, byte_len);
  char trailer[64] = "";
  char surrogate_tail[4];
  size_t surrogate_tail_len = 0;
  if ((double)units > g_opts.max_string) {
    /* slice(0, maxStringLength): ToIntegerOrInfinity, a negative end counts
     * back from the length (clamped at 0). */
    double m = trunc(g_opts.max_string);
    size_t cap = m >= 0 ? ((double)units < m ? units : (size_t)m)
                        : ((double)units + m > 0 ? (size_t)((double)units + m) : 0);
    double remaining = (double)units - g_opts.max_string;
    bool lone_high;
    uint32_t high_cp = 0;
    byte_len = insp_utf16_offset(data, byte_len, cap, &lone_high, &high_cp);
    if (lone_high) {
      /* re-encode the kept high surrogate as WTF-8 */
      surrogate_tail[0] = (char)(0xe0 | (high_cp >> 12));
      surrogate_tail[1] = (char)(0x80 | ((high_cp >> 6) & 0x3f));
      surrogate_tail[2] = (char)(0x80 | (high_cp & 0x3f));
      surrogate_tail_len = 3;
    }
    char rnum[40];
    size_t rn = scr_f64_to_str(remaining, rnum);
    snprintf(trailer, sizeof trailer, "... %.*s more character%s", (int)rn, rnum,
             remaining > 1 ? "s" : "");
    units = cap;
  }
  /* the (possibly truncated) value as one buffer */
  InspBuf val = {0};
  ib_bytes(&val, data, byte_len);
  if (surrogate_tail_len) ib_bytes(&val, surrogate_tail, surrogate_tail_len);
  size_t vlen = val.len;
  const char *v = val.data ? val.data : "";
  if (g_opts.compact_kind != INSP_COMPACT_TRUE && units > 16 &&
      (double)units > g_opts.break_length - (double)g_indent - 4 && memchr(v, '\n', vlen) != NULL) {
    /* split after each newline; quote each chunk; join with ` +\n<indent+2>` */
    size_t chunk_start = 0;
    bool first = true;
    for (size_t i = 0; i <= vlen; i++) {
      bool at_end = i == vlen;
      if (at_end ? i > chunk_start : v[i] == '\n') {
        size_t end = at_end ? i : i + 1;
        if (!first) {
          ib_cstr(&out, " +\n");
          ib_spaces(&out, g_indent + 2);
        }
        const size_t smk = out.len;
        insp_quote_into(&out, v + chunk_start, end - chunk_start);
        if (INSP_STY_ON) ib_sty_from(&out, smk, INSP_STY_STRING);
        chunk_start = end;
        first = false;
      }
    }
  } else {
    const size_t smk = out.len;
    insp_quote_into(&out, v, vlen);
    if (INSP_STY_ON) ib_sty_from(&out, smk, INSP_STY_STRING);
  }
  if (trailer[0]) ib_cstr(&out, trailer);
  free(val.data);
  return ib_take(&out);
}

/* ── regex / Buffer / Error leaves ───────────────────────────────────── */

/* RegExp: `/source/flags` (RegExp.prototype.toString — regexes render
 * fully at any depth; our regexes never carry extra own properties). */
ScrStr *scr_insp_regex(ScrRegex *re) {
  InspBuf out = {0};
  ib_char(&out, '/');
  ib_bytes(&out, re->source->data, re->source->len);
  ib_char(&out, '/');
  ib_bytes(&out, re->flags->data, re->flags->len);
  return ib_take(&out);
}

/* Buffer: the custom-inspect hex form `<Buffer aa bb ...>`, capped at
 * INSPECT_MAX_BYTES (50); renders fully at any depth (custom inspection
 * runs before the depth check in Node). u8 element kind only (the
 * frontend fences the rest). */
#ifdef SCR_SYMTAB
static ScrStr *insp_sym_row_text(const ScrDynSymEnt *row, double recurse, double depth);
#endif
ScrStr *scr_insp_buffer(ScrBytes *b) {
  InspBuf out = {0};
  ib_cstr(&out, "<Buffer ");
  size_t max = b->len < 50 ? b->len : 50;
  for (size_t i = 0; i < max; i++) {
    char hex[4];
    snprintf(hex, sizeof hex, "%02x", ((const unsigned char *)b->data)[i]);
    if (i) ib_char(&out, ' ');
    ib_bytes(&out, hex, 2);
  }
  if (b->len > 50) {
    char more[48];
    size_t remaining = b->len - 50;
    int n = snprintf(more, sizeof more, " ... %zu more byte%s", remaining,
                     remaining > 1 ? "s" : "");
    ib_bytes(&out, more, (size_t)n);
  }
  /* the enumerable symbol-keyed own properties follow the bytes, after ", " (`<Buffer 01 02, Symbol(k): 5>`) */
#ifdef SCR_SYMTAB
  if (b->own != NULL && b->own->ext.syms != NULL) {
    const ScrDynSymTab *bst = b->own->ext.syms;
    bool first = b->len == 0;
    for (uint32_t i = 0; i < bst->len; i++) {
      if (!(bst->e[i].flags & SCR_SYMP_ENUM)) continue;
      if (!first) ib_cstr(&out, ", ");
      first = false;
      ScrStr *row = insp_sym_row_text(&bst->e[i], 1, 2);
      ib_bytes(&out, row->data, row->len);
      scr_str_release(row);
    }
  }
#endif
  ib_char(&out, '>');
  return ib_take(&out);
}

/* Errors: the STACKLESS rendering — compiled binaries carry no stack, so
 * the base is formatError's bracket form `[Name: message]` / `[Name]`
 * (Node prints these exact forms for an error whose stack is empty;
 * stack-carrying Node output is a documented divergence). A stamped
 * `code` slot renders as the one extra own property Node would show:
 * `[Error: m] { code: 'X' }`, `[Error]` beyond depth. Message newlines
 * indent like Node's formatError tail. */
/* A non-Buffer typed array, Node's formatTypedArray: `Name(n) [ ... ]`, the
 * elements formatted as numbers, with the array grid and the "... N more
 * items" tail (Node's formatList, which treats typed arrays as array
 * extras). `name` is the constructor's name, spelled by the compiler. */
ScrStr *scr_insp_typed(ScrBytes *b, ScrStr *name) {
  const size_t n = b->len;
  InspBuf head = {0};
  ib_str(&head, name);
  char lenbuf[40];
  int ln = snprintf(lenbuf, sizeof lenbuf, "(%zu) [", n);
  ib_bytes(&head, lenbuf, (size_t)ln);
  ScrStr *b0 = ib_take(&head);
  ScrStr *b1 = scr_str_new("]", 1);
  ScrStr *base = scr_str_new("", 0);
  scr_insp_begin(1);
  const size_t shown = insp_shown(n);
  for (size_t i = 0; i < shown; i++) {
    ScrStr *s = scr_insp_f64(scr_bytes_get(b, (double)i));
    scr_insp_entry(s, true);
    scr_str_release(s);
  }
  const bool more = insp_more(n);
  if (more) {
    ScrStr *m = scr_insp_more_items(insp_rem(n));
    scr_insp_entry(m, true);
    scr_str_release(m);
  }
  ScrStr *out = scr_insp_end(base, b0, b1, 1, true, insp_over_cap(shown + (more ? 1 : 0)));
  scr_str_release(base);
  scr_str_release(b0);
  scr_str_release(b1);
  return out;
}

ScrStr *scr_insp_error(ScrError *e, double recurse, double depth) {
  double ext_errno = 0;
  const ScrStr *ext_syscall = NULL, *ext_path = NULL, *ext_dest = NULL;
  bool has_ext = scr_error_ext_get(e, &ext_errno, &ext_syscall, &ext_path, &ext_dest);
  bool has_code = e->code != NULL || has_ext; /* the stamped slots, read directly (borrowed) */
  if ((has_code || INSP_SH) && recurse > depth) {
    /* `[${getCtxStyle(...)}]` with the trailing space sliced: [Name] */
    InspBuf out = {0};
    ib_char(&out, '[');
    ib_str(&out, e->name);
    ib_char(&out, ']');
    return ib_take(&out);
  }
  InspBuf base = {0};
  ib_char(&base, '[');
  ib_str(&base, e->name);
  if (e->message->len) {
    ib_cstr(&base, ": ");
    /* indent embedded newlines by the CURRENT level (formatError's
     * final replaceAll — g_indent is the property's own level here). */
    for (size_t i = 0; i < e->message->len; i++) {
      char c = e->message->data[i];
      ib_char(&base, c);
      if (c == '\n') ib_spaces(&base, g_indent);
    }
  }
  ib_char(&base, ']');
  ScrStr *base_str = ib_take(&base);
  /* The constructor's own non-enumerable `cause` (Node's formatError lists it
   * after the enumerable keys, as `[cause]`), read as a value. */
  ScrDyn *cause_v = NULL;
  if (e->props != NULL && e->props->kind == SCR_DYN_OBJ && scr_dyn_obj_has_own_prop(e->props, "cause", 5))
    cause_v = scr_dyn_obj_key_get(e->props, "cause", 5); /* +1; NULL only with a pending throw */
  if (!has_code && cause_v == NULL && !INSP_SH) return base_str;
  insp_begin_obj(recurse + 1);
#ifdef SCR_INSP_COLORS
  if (INSP_SH) {
    /* showHidden lists the error's own non-enumerable `stack` accessor and `message` (a stackless error, as everywhere in this renderer) */
    InspBuf sb = {0};
    ib_hname(&sb, "stack");
    ib_cstr(&sb, ": ");
    ib_sty_cstr(&sb, "[Getter/Setter]", INSP_STY_SPECIAL);
    ScrStr *se = ib_take(&sb);
    scr_insp_entry(se, false);
    scr_str_release(se);
    InspBuf mb = {0};
    ib_hname(&mb, "message");
    ScrStr *mv = scr_insp_str(e->message);
    insp_kv(&mb, mv);
    scr_str_release(mv);
    ScrStr *me = ib_take(&mb);
    scr_insp_entry(me, false);
    scr_str_release(me);
    if (cause_v != NULL) { /* created with the error, so it precedes the keys a program assigns later */
      InspBuf cb = {0};
      ScrStr *cval = scr_insp_dyn(cause_v, recurse + 1, depth);
      ib_cstr(&cb, "[cause]: ");
      ib_bytes(&cb, cval->data, cval->len);
      scr_str_release(cval);
      ScrStr *ce = ib_take(&cb);
      scr_insp_entry(ce, false);
      scr_str_release(ce);
      scr_dyn_release(cause_v);
      cause_v = NULL;
    }
  }
#endif
  if (has_ext) {
    InspBuf entry = {0};
    char nb[40];
    size_t nn = scr_f64_to_str(ext_errno, nb);
    ib_cstr(&entry, "errno: ");
    for (size_t i = 0; i < nn; i++) ib_char(&entry, nb[i]);
    ScrStr *entry_str = ib_take(&entry);
    scr_insp_entry(entry_str, false);
    scr_str_release(entry_str);
  }
  if (e->code != NULL) {
    InspBuf entry = {0};
    ib_cstr(&entry, "code: ");
    insp_quote_into(&entry, e->code->data, e->code->len);
    ScrStr *entry_str = ib_take(&entry);
    scr_insp_entry(entry_str, false);
    scr_str_release(entry_str);
  }
  if (has_ext) {
    /* Node's own key order: errno, code, syscall, then path/dest (fs) or
     * hostname (dns). */
    const struct { const char *label; const ScrStr *val; } rows[4] = {
        {"syscall: ", ext_syscall}, {"path: ", ext_path}, {"dest: ", ext_dest},
        {"hostname: ", scr_error_ext_hostname(e)}};
    for (int r = 0; r < 4; r++) {
      if (rows[r].val == NULL) continue;
      InspBuf entry = {0};
      ib_cstr(&entry, rows[r].label);
      insp_quote_into(&entry, rows[r].val->data, rows[r].val->len);
      ScrStr *entry_str = ib_take(&entry);
      scr_insp_entry(entry_str, false);
      scr_str_release(entry_str);
    }
  }
  if (cause_v != NULL) {
    InspBuf eb = {0};
    ScrStr *val = scr_insp_dyn(cause_v, recurse + 1, depth);
    ib_cstr(&eb, "[cause]: ");
    ib_bytes(&eb, val->data, val->len);
    scr_str_release(val);
    ScrStr *entry = ib_take(&eb);
    scr_insp_entry(entry, false);
    scr_str_release(entry);
    scr_dyn_release(cause_v);
  }
  ScrStr *b0 = scr_str_new("{", 1);
  ScrStr *b1 = scr_str_new("}", 1);
  ScrStr *out = scr_insp_end(base_str, b0, b1, recurse + 1, false, false);
  scr_str_release(b0);
  scr_str_release(b1);
  scr_str_release(base_str);
  return out;
}

/* ── dyn values (the checked-dynamic JSON dyn) ───────────────────────── */

/* Property-name rendering: bare when the key matches Node's keyStrRegExp
 * (/^[a-zA-Z_][a-zA-Z_0-9]*$/, '__proto__' excepted), quoted otherwise. */
static void insp_key_into(InspBuf *b, const char *key, size_t len) {
  if (len == 9 && memcmp(key, "__proto__", 9) == 0) {
    const size_t kmk = b->len;
    ib_cstr(b, "['__proto__']");
    if (INSP_STY_ON) ib_sty_from(b, kmk, INSP_STY_STRING);
    return;
  }
  bool bare = len > 0;
  for (size_t i = 0; bare && i < len; i++) {
    char c = key[i];
    bool head_ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_';
    bool tail_ok = head_ok || (c >= '0' && c <= '9');
    bare = i == 0 ? head_ok : tail_ok;
  }
  const size_t kmk = b->len;
  if (bare) {
    ib_bytes(b, key, len);
    if (INSP_STY_ON) ib_sty_from(b, kmk, INSP_STY_NAME);
  } else {
    insp_quote_into(b, key, len);
    if (INSP_STY_ON) ib_sty_from(b, kmk, INSP_STY_STRING);
  }
}

/* A non-enumerable key's name as formatProperty spells it: `[` + the key (a bare name is stylized as `name`) + `]`. */
static void ib_hname(InspBuf *b, const char *key) {
  ib_char(b, '[');
  insp_key_into(b, key, strlen(key));
  ib_char(b, ']');
}

/* Property-name rendering for the synthesized index-signature record
 * helpers (their keys are runtime strings, so the bare-or-quoted ladder
 * must run here): insp_key_into over a ScrStr. Borrows; result +1. */
ScrStr *scr_insp_key(ScrStr *k) {
  InspBuf b = {0};
  insp_key_into(&b, k->data, k->len);
  return ib_take(&b);
}

/* ── a compiled class instance's run-time property table ──────────────
 *
 * The frame entries for the properties `Object.defineProperty(instance,
 * <a run-time string>, desc)` put in the `%props` table (scr_runtime.h
 * carries the representation). Called by the emitted `%util.insp.N`
 * helper for a class that HAS the field, immediately after the entries
 * for the declared fields — which is Node's order, because the table can
 * only be filled after the constructor ran.
 *
 * ENUMERABLE only, without showHidden — the same rule the OBJ walk above
 * gets for free by keeping non-enumerables out of `entries`; this table
 * holds both families, so the filter is explicit. An ACCESSOR is NOT
 * invoked: Node prints `[Getter]` / `[Setter]` / `[Getter/Setter]` and
 * calls nothing, and calling it here would be a side effect at a print. */
#ifdef SCR_SYMTAB
static void insp_emit_syms(const ScrDyn *d, double recurse, double depth);
#else
#define insp_emit_syms(d, r, dp) ((void)0)
#endif
void scr_cls_props_inspect(const ScrDyn *tbl, double recurse, double depth, bool index_keys) {
  if (tbl == NULL || tbl->kind != SCR_DYN_OBJ) return;
  size_t *ord = scr_dyn_obj_key_order(tbl);
  for (size_t i = 0; i < tbl->v.obj.len; i++) {
    const ScrDynEntry *ent = &tbl->v.obj.entries[ord ? ord[i] : i];
    const ScrDyn *q = ent->value;
    if (scr_dyn_obj_key_is_index(ent->key, ent->key_len) != index_keys) continue;
    if (q->kind != SCR_DYN_ARR || q->v.arr.len < 5) continue;
    if (!scr_dyn_truthy(q->v.arr.items[4])) continue; /* non-enumerable */
#ifdef SCR_INSP_COLORS
    InspBuf eb = {0};
    insp_key_into(&eb, ent->key, ent->key_len);
    if (scr_dyn_truthy(q->v.arr.items[0])) { /* data: the value renders */
      ScrStr *val = scr_insp_dyn(q->v.arr.items[1], recurse + 1, depth);
      insp_kv(&eb, val);
      scr_str_release(val);
    } else {
      ib_cstr(&eb, ": ");
      bool g = q->v.arr.items[1]->kind == SCR_DYN_FUNC;
      bool s = q->v.arr.items[2]->kind == SCR_DYN_FUNC;
      ib_sty_cstr(&eb, g && s ? "[Getter/Setter]" : g ? "[Getter]" : "[Setter]", INSP_STY_SPECIAL);
    }
#else
    InspBuf eb = {0};
    insp_key_into(&eb, ent->key, ent->key_len);
    ib_cstr(&eb, ": ");
    if (scr_dyn_truthy(q->v.arr.items[0])) { /* data: the value renders */
      ScrStr *val = scr_insp_dyn(q->v.arr.items[1], recurse + 1, depth);
      ib_bytes(&eb, val->data, val->len);
      scr_str_release(val);
    } else {
      bool g = q->v.arr.items[1]->kind == SCR_DYN_FUNC;
      bool s = q->v.arr.items[2]->kind == SCR_DYN_FUNC;
      ib_sty_cstr(&eb, g && s ? "[Getter/Setter]" : g ? "[Getter]" : "[Setter]", INSP_STY_SPECIAL);
    }
#endif
    ScrStr *entry = ib_take(&eb);
    scr_insp_entry(entry, false);
    scr_str_release(entry);
  }
  free(ord);
  /* the symbol-keyed properties come after every string key: the second (non-index) pass is the last */
  if (!index_keys) insp_emit_syms(tbl, recurse, depth);
}


/* ── internal slots, which Node keeps under own SYMBOLS ───────────────
 *
 * `ScrDyn.v.obj.slots` is the table the record-to-dyn converter puts a
 * shape's INTERNAL fields in (scr_runtime.h). No property protocol
 * consults it, and that is deliberate; util.inspect is the one surface
 * where Node SHOWS the same cells, because Node keeps them under own
 * enumerable-to-inspect SYMBOL keys and formatValue lists those after
 * the string keys:
 *
 *   Dirent { name: 'a.txt', parentPath: 'kd', Symbol(type): 1 }
 *
 * A slot key that BEGINS WITH '%' is the compiler's own cell rather than
 * a Node symbol, and renders nowhere. StringDecoder's `%pending` is the
 * one: Node's value under Symbol(kNativeDecoder) is a seven-byte native
 * state buffer, this tier holds a packed f64, and printing the f64 there
 * would be the compiler's own number on stdout. The rule lives on the
 * KEY because this walk knows no shapes -- the frontend chooses the
 * spelling (ir/nodes.ts, slotStorageKey), and the two halves are one
 * rule stated twice on purpose. */
/* The ENUMERABLE symbol-keyed own properties (scr_symbol.c's table) -- the ones Node prints, as `Symbol(desc): value`,
 * after the string keys. Non-enumerable ones (a defineProperty default) print nowhere. */
#ifdef SCR_SYMTAB /* the symbol-property code below is compiled in only for a program that links scr_symbol.c */
static size_t insp_sym_count_t(const ScrDynSymTab *t) {
  size_t n = 0;
  for (uint32_t i = 0; t != NULL && i < t->len; i++) n += INSP_SH || (t->e[i].flags & SCR_SYMP_ENUM) != 0; /* showHidden lists every own symbol */
  return n;
}
static size_t insp_sym_count(const ScrDyn *d) { return d == NULL ? 0 : insp_sym_count_t(scr_dyn_ext(d)->syms); }
#else
#define insp_sym_count_t(t) ((size_t)0)
#define insp_sym_count(d) ((size_t)0)
#endif

#ifdef SCR_SYMTAB
/* A boxed instance's run-time property table when it hosts symbol-keyed properties (+1), else NULL. */
static ScrDyn *insp_inst_sym_bag(const ScrDyn *d) {
  const ScrDynClassMember *m = scr_dyn_objinst_member(d, "%props", 6);
  if (m == NULL || m->get == NULL) return NULL;
  ScrDyn *b = m->get(d->v.inst.o);
  if (b != NULL && b->kind == SCR_DYN_OBJ && scr_dyn_ext(b)->syms != NULL) return b;
  scr_dyn_release(b);
  return NULL;
}

/* A function value's closure table when it hosts symbol-keyed properties (+1), else NULL. */
static ScrDyn *insp_fn_sym_table(const ScrDyn *d) {
  if (d->v.fn.clo->props == NULL) return NULL;
  ScrDyn *t = (ScrDyn *)scr_box_get_ref(d->v.fn.clo->props); /* +1 */
  if (t != NULL && t->kind == SCR_DYN_OBJ && scr_dyn_ext(t)->syms != NULL) return t;
  scr_dyn_release(t);
  return NULL;
}
#else
#define insp_inst_sym_bag(d) ((ScrDyn *)NULL)
#define insp_fn_sym_table(d) ((ScrDyn *)NULL)
#endif

static size_t insp_slot_count(const ScrDyn *d) {
  const ScrDyn *s = scr_dyn_ext(d)->slots;
  if (s == NULL || s->kind != SCR_DYN_OBJ) return insp_sym_count(d);
  size_t n = 0;
  for (size_t i = 0; i < s->v.obj.len; i++) {
    const ScrDynEntry *e = &s->v.obj.entries[i];
    if (e->key_len > 0 && e->key[0] != '%') n++;
  }
  return n + insp_sym_count(d);
}

/* Appends one `Symbol(<desc>): <value>` entry per renderable slot to the
 * frame scr_insp_begin opened. Insertion order, which is the converter's
 * field order and therefore Node's. */
#ifdef SCR_SYMTAB
#ifdef SCR_INSP_COLORS
static void insp_acc_into(InspBuf *eb, ScrDyn *recv, const ScrDyn *getter, const ScrDyn *setter, double vrecurse, double depth);
/* The receiver a symbol-keyed getter runs with under getters: true (the object whose table is being listed). */
static ScrDyn *g_sym_recv;
#endif
static void insp_emit_symtab(const ScrDynSymTab *t, double recurse, double depth);
static void insp_emit_syms(const ScrDyn *d, double recurse, double depth) {
  if (d == NULL) return;
#ifdef SCR_INSP_COLORS
  ScrDyn *saved = g_sym_recv;
  g_sym_recv = (ScrDyn *)d;
  insp_emit_symtab(scr_dyn_ext(d)->syms, recurse, depth);
  g_sym_recv = saved;
#else
  insp_emit_symtab(scr_dyn_ext(d)->syms, recurse, depth);
#endif
}

/* `Symbol(desc): value` for one row; an accessor renders [Getter]/[Setter] and runs nothing. +1. */
static ScrStr *insp_sym_row_text(const ScrDynSymEnt *row, double recurse, double depth) {
  ScrStr *kn = scr_dyn_sym_key_str(row->key);
  InspBuf eb = {0};
#ifdef SCR_INSP_COLORS
  /* formatProperty: a non-enumerable key is bracketed (`[Symbol(k)]`); the symbol text is in the `symbol` style */
  const bool hk = !(row->flags & SCR_SYMP_ENUM);
  if (hk) ib_char(&eb, '[');
  const size_t skm = eb.len;
  ib_bytes(&eb, kn->data, kn->len);
  if (INSP_STY_ON) ib_sty_from(&eb, skm, INSP_STY_SYMBOL);
  if (hk) ib_char(&eb, ']');
  if (row->flags & SCR_SYMP_ACC) {
    const bool g = row->val->v.arr.items[0]->kind == SCR_DYN_FUNC, st = row->val->v.arr.items[1]->kind == SCR_DYN_FUNC;
    ib_cstr(&eb, ": ");
    (void)g;
    (void)st;
    insp_acc_into(&eb, g_sym_recv, row->val->v.arr.items[0], row->val->v.arr.items[1], recurse + 1, depth);
  } else {
    ScrStr *val = scr_insp_dyn(row->val, recurse + 1, depth);
    insp_kv(&eb, val);
    scr_str_release(val);
  }
#else
  ib_bytes(&eb, kn->data, kn->len);
  ib_cstr(&eb, ": ");
  if (row->flags & SCR_SYMP_ACC) {
    const bool g = row->val->v.arr.items[0]->kind == SCR_DYN_FUNC, st = row->val->v.arr.items[1]->kind == SCR_DYN_FUNC;
    ib_sty_cstr(&eb, g && st ? "[Getter/Setter]" : g ? "[Getter]" : "[Setter]", INSP_STY_SPECIAL);
  } else {
    ScrStr *val = scr_insp_dyn(row->val, recurse + 1, depth);
    ib_bytes(&eb, val->data, val->len);
    scr_str_release(val);
  }
#endif
  scr_str_release(kn);
  return ib_take(&eb);
}

static void insp_emit_symtab(const ScrDynSymTab *t, double recurse, double depth) {
  for (uint32_t i = 0; t != NULL && i < t->len; i++) {
    if (!INSP_SH && !(t->e[i].flags & SCR_SYMP_ENUM)) continue;
    ScrStr *entry = insp_sym_row_text(&t->e[i], recurse, depth);
    scr_insp_entry(entry, false);
    scr_str_release(entry);
  }
}
#else
#define insp_emit_symtab(t, r, dp) ((void)0)
#endif

static void insp_emit_slots(const ScrDyn *d, double recurse, double depth) {
  const ScrDyn *s = scr_dyn_ext(d)->slots;
  if (s == NULL || s->kind != SCR_DYN_OBJ) {
    insp_emit_syms(d, recurse, depth);
    return;
  }
  for (size_t i = 0; i < s->v.obj.len; i++) {
    const ScrDynEntry *e = &s->v.obj.entries[i];
    if (e->key_len == 0 || e->key[0] == '%') continue;
    ScrStr *val = scr_insp_dyn(e->value, recurse + 1, depth);
    InspBuf eb = {0};
    ib_cstr(&eb, "Symbol(");
    ib_bytes(&eb, e->key, e->key_len);
    ib_cstr(&eb, "): ");
    ib_bytes(&eb, val->data, val->len);
    scr_str_release(val);
    ScrStr *entry = ib_take(&eb);
    scr_insp_entry(entry, false);
    scr_str_release(entry);
  }
  insp_emit_syms(d, recurse, depth);
}

/* A dyn object dumped after a base string (a Date's ISO text with its own expandos). Node's
 * reduceToSingleString measures the base when it decides between one line and one entry per line, so the
 * entries go through the same frame and join as every other object, with the base as its prefix. The
 * entries are a plain object's: no class name, no accessors (a Date's expandos are data written by `=`). */
#ifdef SCR_INSP_COLORS
static void insp_emit_obj_keys(ScrDyn *d, double recurse, double depth, bool skip_fn);
#endif
static ScrStr *insp_with_base(ScrStr *base, ScrDyn *obj, double recurse, double depth, double wrap_len) {
  insp_begin_obj(recurse + 1);
#ifdef SCR_INSP_COLORS
  if (wrap_len >= 0 && INSP_SH) {
    /* a String wrapper's own non-enumerable `length`, first among its keys */
    InspBuf lb = {0};
    ib_hname(&lb, "length");
    ScrStr *lv = insp_sty(scr_insp_f64(wrap_len), INSP_STY_NUMBER);
    insp_kv(&lb, lv);
    scr_str_release(lv);
    ScrStr *le = ib_take(&lb);
    scr_insp_entry(le, false);
    scr_str_release(le);
  }
  if (INSP_SH) insp_emit_obj_keys(obj, recurse, depth, false);
#endif
  size_t *ord = INSP_SH ? NULL : scr_dyn_obj_key_order(obj);
  for (size_t i = 0; !INSP_SH && i < obj->v.obj.len; i++) {
    ScrDynEntry *ent = &obj->v.obj.entries[ord ? ord[i] : i];
    InspBuf eb = {0};
    ScrStr *val = scr_insp_dyn(ent->value, recurse + 1, depth);
    insp_key_into(&eb, ent->key, ent->key_len);
    insp_kv(&eb, val);
    scr_str_release(val);
    ScrStr *entry = ib_take(&eb);
    scr_insp_entry(entry, false);
    scr_str_release(entry);
  }
  free(ord);
  ScrStr *b0 = scr_str_new("{", 1);
  ScrStr *b1 = scr_str_new("}", 1);
  ScrStr *out = scr_insp_end(base, b0, b1, recurse + 1, false, false);
  scr_str_release(b0);
  scr_str_release(b1);
  return out;
}

/* formatProperty's accessor arm. `recv` is the property's receiver (Node's `original`), getter/setter the descriptor's halves
 * (a function, or anything else for an absent half). Under ctx.getters a getter that qualifies RUNS and its answer prints:
 * `[Getter: 5]`, `[Getter: null]`, `[Getter] { a: 1 }` for an object; a throw prints `<Inspection threw (...)>`. Otherwise the bare
 * label. `vrecurse` is the recursion depth the property's value would format at. Appends to `eb` (after the key's ": "). */
#ifdef SCR_INSP_COLORS
/* A caught exception as a dyn value (scr_caught_to_dyn's stances; that one lives in the gated async unit, which a program printing
 * through this renderer need not link). Borrows the box, +1. */
static ScrDyn *insp_caught_dyn(const ScrCaught *c) {
  switch (c->kind) {
    case SCR_EXC_F64: return scr_dyn_new_num(c->f64);
    case SCR_EXC_BOOL: return scr_dyn_new_bool(c->b);
    case SCR_EXC_STR: return scr_dyn_new_str((ScrStr *)c->payload);
    case SCR_EXC_NULL: return scr_dyn_new_null();
    case SCR_EXC_UNDEF: return scr_dyn_retain(scr_dyn_undefined());
    case SCR_EXC_REF:
      if (c->retain_fn == scr_dyn_retain_v) return scr_dyn_retain((ScrDyn *)c->payload);
      return scr_dyn_new_obj();
    case SCR_EXC_OBJ: {
      if (scr_error_is(c->payload)) return scr_dyn_from_error((const ScrError *)c->payload);
      ScrDyn *inst = scr_dyn_from_hier_obj(c->payload);
      return inst != NULL ? inst : scr_dyn_new_obj();
    }
    default: return scr_dyn_new_obj();
  }
}

/* The text a getter's answer takes under getters: `tmp` is the getter's result (+1, consumed) or NULL with the throw pending. */
static void insp_acc_value(InspBuf *eb, const char *label, ScrDyn *tmp, double vrecurse, double depth) {
  char head[32];
  if (tmp == NULL) {
    /* the getter threw: `<Inspection threw (<the thrown value>)>` */
    ScrCaught *c = scr_exc_take();
    ScrDyn *err = insp_caught_dyn(c);
    scr_caught_release(c);
    ScrStr *es = scr_insp_dyn(err, vrecurse, depth);
    scr_dyn_release(err);
    snprintf(head, sizeof head, "[%s:", label);
    ib_sty_cstr(eb, head, INSP_STY_SPECIAL);
    ib_cstr(eb, " <Inspection threw (");
    ib_str(eb, es);
    ib_cstr(eb, ")>");
    ib_sty_cstr(eb, "]", INSP_STY_SPECIAL);
    scr_str_release(es);
  } else if (tmp->kind == SCR_DYN_NULL) {
    snprintf(head, sizeof head, "[%s:", label);
    ib_sty_cstr(eb, head, INSP_STY_SPECIAL);
    ib_char(eb, ' ');
    ib_sty_cstr(eb, "null", INSP_STY_NULL);
    ib_sty_cstr(eb, "]", INSP_STY_SPECIAL);
  } else if (tmp->kind == SCR_DYN_FUNC) {
    /* typeof 'function' is not 'object', so Node hands it to formatPrimitive, whose SymbolPrototypeToString throws inside the same
     * try: the answer is the Inspection-threw form of that TypeError (stackless, as every error this renderer prints). */
    snprintf(head, sizeof head, "[%s:", label);
    ib_sty_cstr(eb, head, INSP_STY_SPECIAL);
    ib_cstr(eb, " <Inspection threw ([TypeError: Symbol.prototype.toString requires that 'this' be a Symbol])>");
    ib_sty_cstr(eb, "]", INSP_STY_SPECIAL);
  } else {
    const bool prim = tmp->kind == SCR_DYN_UNDEF || tmp->kind == SCR_DYN_BOOL || tmp->kind == SCR_DYN_NUM || tmp->kind == SCR_DYN_STR ||
                      tmp->kind == SCR_DYN_BIG || scr_dyn_is_symbol(tmp);
    ScrStr *vs = scr_insp_dyn(tmp, vrecurse, depth);
    if (prim) {
      snprintf(head, sizeof head, "[%s:", label);
      ib_sty_cstr(eb, head, INSP_STY_SPECIAL);
      ib_char(eb, ' ');
      ib_str(eb, vs);
      ib_sty_cstr(eb, "]", INSP_STY_SPECIAL);
    } else {
      snprintf(head, sizeof head, "[%s]", label);
      ib_sty_cstr(eb, head, INSP_STY_SPECIAL);
      ib_char(eb, ' ');
      ib_str(eb, vs);
    }
    scr_str_release(vs);
  }
  scr_dyn_release(tmp);
}

static void insp_acc_into(InspBuf *eb, ScrDyn *recv, const ScrDyn *getter, const ScrDyn *setter, double vrecurse, double depth) {
  const bool g = getter != NULL && getter->kind == SCR_DYN_FUNC;
  const bool st = setter != NULL && setter->kind == SCR_DYN_FUNC;
  if (!g) {
    if (st) ib_sty_cstr(eb, "[Setter]", INSP_STY_SPECIAL);
    else ib_sty_cstr(eb, "undefined", INSP_STY_UNDEFINED);
    return;
  }
  const char *label = st ? "Getter/Setter" : "Getter";
  const bool run = g_opts.getters == 1 || (g_opts.getters == 2 && !st) || (g_opts.getters == 3 && st);
  if (!run) {
    ib_sty_cstr(eb, st ? "[Getter/Setter]" : "[Getter]", INSP_STY_SPECIAL);
    return;
  }
  g_indent += 2;
  scr_dyn_this_push_dyn(recv != NULL ? recv : scr_dyn_undefined());
  ScrDyn *tmp = scr_dyn_call(getter, NULL, 0, "getter");
  scr_dyn_this_pop();
  insp_acc_value(eb, label, tmp, vrecurse, depth);
  g_indent -= 2;
}

#endif

#ifdef SCR_INSP_COLORS
/* ── showHidden: a dyn object's own string keys in JS creation order ─────────
 * util.inspect lists getOwnPropertyNames under showHidden: integer keys ascending, then every other key in creation order,
 * the non-enumerable ones among the members. The member table holds the enumerable keys (and the accessor slots) in creation
 * order; the hidden table holds the non-enumerable ones with the member count they were created after (the descriptor's seventh
 * element, kept right across deletes by scr_dyn_obj_unset). */
/* the function object's built-in own names (listed by the function arm itself) */
static bool insp_fn_builtin_key(const char *k, size_t n) {
  return (n == 4 && memcmp(k, "name", 4) == 0) || (n == 6 && memcmp(k, "length", 6) == 0) || (n == 9 && memcmp(k, "prototype", 9) == 0);
}

typedef struct {
  const ScrDynEntry *ent; /* the member entry, or NULL for a hidden-only property */
  const ScrDynEntry *hent; /* the hidden-table row, or NULL for a plain member */
  double rank;
  bool is_idx;
  double idx;
  size_t seq; /* position before the sort: qsort is not stable on every libc (mingw's is not), and hidden-only keys created after the same member count tie on rank */
} InspHK;

static int insp_hk_cmp(const void *a, const void *b) {
  const InspHK *x = (const InspHK *)a, *y = (const InspHK *)b;
  if (x->is_idx != y->is_idx) return x->is_idx ? -1 : 1;
  const double dx = x->is_idx ? x->idx : x->rank, dy = y->is_idx ? y->idx : y->rank;
  if (dx != dy) return dx < dy ? -1 : 1;
  return x->seq < y->seq ? -1 : x->seq > y->seq ? 1 : 0;
}

/* The listed own string keys of `d` (+ the heap array in *out, NULL when there are none). */
static size_t insp_obj_keys(const ScrDyn *d, InspHK **out, bool skip_fn) {
  const ScrDyn *h = scr_dyn_ext(d)->hidden;
  const size_t cap = d->v.obj.len + (h != NULL ? h->v.obj.len : 0);
  *out = cap ? malloc(cap * sizeof(InspHK)) : NULL;
  if (cap && *out == NULL) insp_oom();
  size_t n = 0;
  for (size_t i = 0; i < d->v.obj.len; i++) {
    const ScrDynEntry *e = &d->v.obj.entries[i];
    InspHK k = {e, NULL, (double)i, false, 0};
    if (e->value == scr_dyn_acc_slot()) {
      const ScrDynEntry *he = NULL;
      for (size_t j = 0; h != NULL && j < h->v.obj.len; j++) {
        if (h->v.obj.entries[j].key_len == e->key_len && memcmp(h->v.obj.entries[j].key, e->key, e->key_len) == 0) {
          he = &h->v.obj.entries[j];
          break;
        }
      }
      if (he == NULL || he->value->kind != SCR_DYN_ARR || he->value->v.arr.len < 5) continue;
      k.hent = he;
    }
    if (e->key_len > 0 && e->key[0] == '%') continue;
    if (skip_fn && insp_fn_builtin_key(e->key, e->key_len)) continue;
    k.is_idx = scr_dyn_obj_key_is_index(e->key, e->key_len);
    if (k.is_idx) k.idx = strtod(e->key, NULL);
    k.seq = n;
    (*out)[n++] = k;
  }
  for (size_t j = 0; h != NULL && j < h->v.obj.len; j++) {
    const ScrDynEntry *he = &h->v.obj.entries[j];
    if (he->value->kind != SCR_DYN_ARR || he->value->v.arr.len < 5) continue;
    if (he->key_len > 0 && he->key[0] == '%') continue;
    if (he->key_len > 2 && he->key[0] == '_' && he->key[1] == '_' && he->key[2] == '@') continue; /* a record's symbol-keyed member: not a string key */
    if (scr_dyn_obj_entry_is_slot(d, he->key, he->key_len)) continue; /* listed through its slot above */
    if (skip_fn && insp_fn_builtin_key(he->key, he->key_len)) continue;
    InspHK k = {NULL, he, (double)d->v.obj.len, false, 0};
    if (he->value->v.arr.len >= 7 && he->value->v.arr.items[6]->kind == SCR_DYN_NUM) k.rank = he->value->v.arr.items[6]->v.num - 0.5;
    else if (he->value->v.arr.len >= 6 && scr_dyn_truthy(he->value->v.arr.items[5])) k.rank = -1;
    k.is_idx = scr_dyn_obj_key_is_index(he->key, he->key_len);
    if (k.is_idx) k.idx = strtod(he->key, NULL);
    k.seq = n;
    (*out)[n++] = k;
  }
  if (n > 1) qsort(*out, n, sizeof(InspHK), insp_hk_cmp);
  return n;
}

/* One `[key]: value` / `key: value` entry per listed own string key of `d`, in JS order, into the frame scr_insp_begin opened. */
static void insp_emit_obj_keys(ScrDyn *d, double recurse, double depth, bool skip_fn) {
  InspHK *ks = NULL;
  const size_t n = insp_obj_keys(d, &ks, skip_fn);
  for (size_t i = 0; i < n; i++) {
    const InspHK *k = &ks[i];
    const char *key = k->ent != NULL ? k->ent->key : k->hent->key;
    const size_t klen = k->ent != NULL ? k->ent->key_len : k->hent->key_len;
    const ScrDyn *desc = k->hent != NULL ? k->hent->value : NULL;
    const bool en = desc == NULL || scr_dyn_truthy(desc->v.arr.items[4]);
    InspBuf eb = {0};
    if (!en) ib_char(&eb, '[');
    insp_key_into(&eb, key, klen);
    if (!en) ib_char(&eb, ']');
    if (desc != NULL && !scr_dyn_truthy(desc->v.arr.items[0])) {
      ib_cstr(&eb, ": ");
      insp_acc_into(&eb, d, desc->v.arr.items[1], desc->v.arr.items[2], recurse + 1, depth);
    } else {
      const ScrDyn *v = desc != NULL ? desc->v.arr.items[1] : k->ent->value;
      ScrStr *val = scr_insp_dyn((ScrDyn *)v, recurse + 1, depth);
      insp_kv(&eb, val);
      scr_str_release(val);
    }
    ScrStr *entry = ib_take(&eb);
    scr_insp_entry(entry, false);
    scr_str_release(entry);
  }
  free(ks);
}
#endif

#ifdef SCR_INSP_COLORS
/* formatRaw's protoProps under showHidden, for a compiled class instance: the accessors the instance's class (and up to two classes above it)
 * declares print after the own keys as `[g]: [Getter]` (dimmed under colors); methods do not (a function value is skipped). The member table
 * says which rows are accessors, whether a setter sits beside the getter, and how many classes up the declaring class is (ScrDynClassMember.accl). */
static void insp_sh_acc_label(InspBuf *eb, unsigned short accl);
#define insp_sh_acc_label_fwd insp_sh_acc_label
static size_t insp_proto_acc_count(const ScrDyn *d) {
  const size_t n = scr_dyn_objinst_member_count(d);
  size_t k = 0;
  for (size_t i = 0; i < n; i++) {
    const ScrDynClassMember *m = scr_dyn_objinst_member_at(d, i);
    if ((m->accl & 1u) && ((m->accl >> 2) & 3u) < 3u && m->name[0] != '%') k++;
  }
  return k;
}

static void insp_emit_proto_acc(ScrDyn *d, double recurse, double depth) {
  const size_t n = scr_dyn_objinst_member_count(d);
  for (size_t i = 0; i < n; i++) {
    const ScrDynClassMember *m = scr_dyn_objinst_member_at(d, i);
    if (!(m->accl & 1u) || ((m->accl >> 2) & 3u) >= 3u || m->name[0] == '%') continue;
    const bool st = (m->accl & 2u) != 0;
    const char *label = st ? "Getter/Setter" : "Getter";
    InspBuf eb = {0};
    if (INSP_COLORS_ON) ib_cstr(&eb, "\x1b[2m");
    ib_char(&eb, '[');
    insp_key_into(&eb, m->name, m->len);
    ib_char(&eb, ']');
    ib_cstr(&eb, ": ");
    const bool run = (m->accl & 16u) == 0 && (g_opts.getters == 1 || (g_opts.getters == 2 && !st) || (g_opts.getters == 3 && st));
    if (!run) {
      insp_sh_acc_label_fwd(&eb, m->accl);
    } else {
      g_indent += 2;
      ScrDyn *tmp = m->get(d->v.inst.o); /* the getter runs with the instance as `this` */
      insp_acc_value(&eb, label, tmp, recurse + 1, depth + 1);
      g_indent -= 2;
    }
    if (INSP_COLORS_ON) ib_cstr(&eb, "\x1b[22m");
    ScrStr *entry = ib_take(&eb);
    scr_insp_entry(entry, false);
    scr_str_release(entry);
  }
}

/* showHidden over a value whose hidden surface this runtime cannot read: a named, catchable stop (OPEN), never a rendering that leaves
 * keys out. The class model (ScrDynClass) carries no own-versus-inherited method table and no accessor/setter flags: the prototype
 * keys formatRaw adds (its protoProps) cannot be listed from it. */
static ScrStr *insp_sh_fence(const char *what) {
  InspBuf out = {0};
  ib_cstr(&out, "util.inspect with showHidden over ");
  ib_cstr(&out, what);
  ib_cstr(&out, " is not supported yet");
  scr_throw_error(SCR_ERR_ERROR, ib_take(&out));
  return scr_str_new("", 0);
}
#endif

#ifdef SCR_INSP_COLORS
/* `[Function: name] { [length]: n, [name]: 'name' }`: a non-constructor function's non-enumerable keys, at recursion level `lv`. */
static ScrStr *insp_sh_method_text(const char *name, size_t nlen, unsigned arity, double lv, double depth) {
  if (lv > depth) return insp_sty_lit("[Function]", INSP_STY_SPECIAL);
  InspBuf bb = {0};
  ib_cstr(&bb, "[Function");
  if (nlen > 0) {
    ib_cstr(&bb, ": ");
    ib_bytes(&bb, name, nlen);
  } else {
    ib_cstr(&bb, " (anonymous)");
  }
  ib_char(&bb, ']');
  ScrStr *base = ib_take(&bb);
  insp_begin_obj(lv + 1);
  InspBuf eb = {0};
  ib_hname(&eb, "length");
  ScrStr *lv_s = insp_sty(scr_insp_f64((double)arity), INSP_STY_NUMBER);
  insp_kv(&eb, lv_s);
  scr_str_release(lv_s);
  ScrStr *e = ib_take(&eb);
  scr_insp_entry(e, true);
  scr_str_release(e);
  InspBuf nb = {0};
  ib_hname(&nb, "name");
  ScrStr *ns = scr_str_new(name, nlen);
  ScrStr *nv = scr_insp_str(ns);
  scr_str_release(ns);
  insp_kv(&nb, nv);
  scr_str_release(nv);
  ScrStr *ne = ib_take(&nb);
  scr_insp_entry(ne, false);
  scr_str_release(ne);
  ScrStr *b0 = scr_str_new("{", 1);
  ScrStr *b1 = scr_str_new("}", 1);
  ScrStr *out = scr_insp_end(base, b0, b1, lv + 1, false, false);
  scr_str_release(base);
  scr_str_release(b0);
  scr_str_release(b1);
  return out;
}

/* One prototype/static accessor entry's value text: `[Getter]`, `[Getter/Setter]`, `[Setter]` (a class accessor never runs here: the
 * receiver would be the prototype). */
static void insp_sh_acc_label(InspBuf *eb, unsigned short accl) {
  if (accl & 16u) ib_sty_cstr(eb, "[Setter]", INSP_STY_SPECIAL);
  else ib_sty_cstr(eb, (accl & 2u) ? "[Getter/Setter]" : "[Getter]", INSP_STY_SPECIAL);
}

/* What a class value that extends a runtime-provided class inherits, as formatRaw's protoProps list it (addPrototypeProperties): the non-function own
 * keys of up to three prototype layers above the object being printed (its own methods and accessors excluded, a key already seen on a layer below it
 * skipped), for the class value's `prototype` and for the class value itself (its own constructor chain). Measured on $NODE_CI (v24.15.0) with
 * lab/gen_rt2.mjs: EventEmitter, Stream (a layer of the stream chain only), Readable, Writable, Duplex, Transform, PassThrough. One entry is one such
 * key: `flags` bit 0 = printed in brackets (non-enumerable, or a symbol), bit 1 = a symbol key; `kind` 0 undefined, 1 number, 2 boolean, 3 null,
 * 4 symbol value, 5 accessor with a getter, 6 with a getter and a setter; `val` the value's text. The Error kinds have no prototype keys (Error.prototype
 * is a builtin, the walk stops there) and one static, `stackTraceLimit`, the process-wide slot. */
typedef struct { const char *key; unsigned char flags; unsigned char kind; const char *val; } InspRtEnt;
typedef struct { const InspRtEnt *e; size_t n; } InspRtLayer;
typedef struct { const char *name; const InspRtLayer *proto; size_t nproto; const InspRtLayer *stat; size_t nstat; } InspRtClass;

static const InspRtEnt insp_rt_EventEmitter_proto0[] = {
  {"_events", 0, 0, "undefined"},
  {"_eventsCount", 0, 1, "0"},
  {"_maxListeners", 0, 0, "undefined"},
  {"Symbol(kCapture)", 3, 2, "false"},
};
static const InspRtLayer insp_rt_EventEmitter_proto[] = { {insp_rt_EventEmitter_proto0, 4} };
static const InspRtEnt insp_rt_EventEmitter_stat0[] = {
  {"usingDomains", 0, 2, "false"},
  {"captureRejectionSymbol", 0, 4, "Symbol(nodejs.rejection)"},
  {"captureRejections", 0, 6, ""},
  {"EventEmitterAsyncResource", 0, 5, ""},
  {"errorMonitor", 0, 4, "Symbol(events.errorMonitor)"},
  {"defaultMaxListeners", 0, 6, ""},
  {"kMaxEventTargetListeners", 1, 4, "Symbol(events.maxEventTargetListeners)"},
  {"kMaxEventTargetListenersWarned", 1, 4, "Symbol(events.maxEventTargetListenersWarned)"},
};
static const InspRtLayer insp_rt_EventEmitter_stat[] = { {insp_rt_EventEmitter_stat0, 8} };
static const InspRtEnt insp_rt_Readable_proto0[] = {
  {"readable", 1, 6, ""},
  {"readableDidRead", 1, 5, ""},
  {"readableAborted", 1, 5, ""},
  {"readableHighWaterMark", 1, 5, ""},
  {"readableBuffer", 1, 5, ""},
  {"readableFlowing", 1, 6, ""},
  {"readableLength", 1, 5, ""},
  {"readableObjectMode", 1, 5, ""},
  {"readableEncoding", 1, 5, ""},
  {"errored", 1, 5, ""},
  {"closed", 1, 5, ""},
  {"destroyed", 1, 6, ""},
  {"readableEnded", 1, 5, ""},
};
static const InspRtEnt insp_rt_Readable_proto2[] = {
  {"_events", 0, 0, "undefined"},
  {"_eventsCount", 0, 1, "0"},
  {"_maxListeners", 0, 0, "undefined"},
  {"Symbol(kCapture)", 3, 2, "false"},
};
static const InspRtLayer insp_rt_Readable_proto[] = { {insp_rt_Readable_proto0, 13}, {NULL, 0}, {insp_rt_Readable_proto2, 4} };
static const InspRtEnt insp_rt_Readable_stat1[] = {
  {"promises", 0, 5, ""},
};
static const InspRtEnt insp_rt_Readable_stat2[] = {
  {"usingDomains", 0, 2, "false"},
  {"captureRejectionSymbol", 0, 4, "Symbol(nodejs.rejection)"},
  {"captureRejections", 0, 6, ""},
  {"EventEmitterAsyncResource", 0, 5, ""},
  {"errorMonitor", 0, 4, "Symbol(events.errorMonitor)"},
  {"defaultMaxListeners", 0, 6, ""},
  {"kMaxEventTargetListeners", 1, 4, "Symbol(events.maxEventTargetListeners)"},
  {"kMaxEventTargetListenersWarned", 1, 4, "Symbol(events.maxEventTargetListenersWarned)"},
};
static const InspRtLayer insp_rt_Readable_stat[] = { {NULL, 0}, {insp_rt_Readable_stat1, 1}, {insp_rt_Readable_stat2, 8} };
static const InspRtEnt insp_rt_Writable_proto0[] = {
  {"_writev", 0, 3, "null"},
  {"closed", 1, 5, ""},
  {"destroyed", 1, 6, ""},
  {"writable", 1, 6, ""},
  {"writableFinished", 1, 5, ""},
  {"writableObjectMode", 1, 5, ""},
  {"writableBuffer", 1, 5, ""},
  {"writableEnded", 1, 5, ""},
  {"writableNeedDrain", 1, 5, ""},
  {"writableHighWaterMark", 1, 5, ""},
  {"writableCorked", 1, 5, ""},
  {"writableLength", 1, 5, ""},
  {"errored", 1, 5, ""},
  {"writableAborted", 1, 5, ""},
};
static const InspRtEnt insp_rt_Writable_proto2[] = {
  {"_events", 0, 0, "undefined"},
  {"_eventsCount", 0, 1, "0"},
  {"_maxListeners", 0, 0, "undefined"},
  {"Symbol(kCapture)", 3, 2, "false"},
};
static const InspRtLayer insp_rt_Writable_proto[] = { {insp_rt_Writable_proto0, 14}, {NULL, 0}, {insp_rt_Writable_proto2, 4} };
static const InspRtEnt insp_rt_Writable_stat1[] = {
  {"promises", 0, 5, ""},
};
static const InspRtEnt insp_rt_Writable_stat2[] = {
  {"usingDomains", 0, 2, "false"},
  {"captureRejectionSymbol", 0, 4, "Symbol(nodejs.rejection)"},
  {"captureRejections", 0, 6, ""},
  {"EventEmitterAsyncResource", 0, 5, ""},
  {"errorMonitor", 0, 4, "Symbol(events.errorMonitor)"},
  {"defaultMaxListeners", 0, 6, ""},
  {"kMaxEventTargetListeners", 1, 4, "Symbol(events.maxEventTargetListeners)"},
  {"kMaxEventTargetListenersWarned", 1, 4, "Symbol(events.maxEventTargetListenersWarned)"},
};
static const InspRtLayer insp_rt_Writable_stat[] = { {NULL, 0}, {insp_rt_Writable_stat1, 1}, {insp_rt_Writable_stat2, 8} };
static const InspRtEnt insp_rt_Duplex_proto0[] = {
  {"_writev", 0, 3, "null"},
  {"writable", 1, 6, ""},
  {"writableHighWaterMark", 1, 5, ""},
  {"writableObjectMode", 1, 5, ""},
  {"writableBuffer", 1, 5, ""},
  {"writableLength", 1, 5, ""},
  {"writableFinished", 1, 5, ""},
  {"writableCorked", 1, 5, ""},
  {"writableEnded", 1, 5, ""},
  {"writableNeedDrain", 1, 5, ""},
  {"destroyed", 1, 6, ""},
};
static const InspRtEnt insp_rt_Duplex_proto1[] = {
  {"readable", 1, 6, ""},
  {"readableDidRead", 1, 5, ""},
  {"readableAborted", 1, 5, ""},
  {"readableHighWaterMark", 1, 5, ""},
  {"readableBuffer", 1, 5, ""},
  {"readableFlowing", 1, 6, ""},
  {"readableLength", 1, 5, ""},
  {"readableObjectMode", 1, 5, ""},
  {"readableEncoding", 1, 5, ""},
  {"errored", 1, 5, ""},
  {"closed", 1, 5, ""},
  {"readableEnded", 1, 5, ""},
};
static const InspRtEnt insp_rt_Duplex_proto3[] = {
  {"_events", 0, 0, "undefined"},
  {"_eventsCount", 0, 1, "0"},
  {"_maxListeners", 0, 0, "undefined"},
  {"Symbol(kCapture)", 3, 2, "false"},
};
static const InspRtLayer insp_rt_Duplex_proto[] = { {insp_rt_Duplex_proto0, 11}, {insp_rt_Duplex_proto1, 12}, {NULL, 0}, {insp_rt_Duplex_proto3, 4} };
static const InspRtEnt insp_rt_Duplex_stat2[] = {
  {"promises", 0, 5, ""},
};
static const InspRtEnt insp_rt_Duplex_stat3[] = {
  {"usingDomains", 0, 2, "false"},
  {"captureRejectionSymbol", 0, 4, "Symbol(nodejs.rejection)"},
  {"captureRejections", 0, 6, ""},
  {"EventEmitterAsyncResource", 0, 5, ""},
  {"errorMonitor", 0, 4, "Symbol(events.errorMonitor)"},
  {"defaultMaxListeners", 0, 6, ""},
  {"kMaxEventTargetListeners", 1, 4, "Symbol(events.maxEventTargetListeners)"},
  {"kMaxEventTargetListenersWarned", 1, 4, "Symbol(events.maxEventTargetListenersWarned)"},
};
static const InspRtLayer insp_rt_Duplex_stat[] = { {NULL, 0}, {NULL, 0}, {insp_rt_Duplex_stat2, 1}, {insp_rt_Duplex_stat3, 8} };
static const InspRtEnt insp_rt_Transform_proto1[] = {
  {"_writev", 0, 3, "null"},
  {"writable", 1, 6, ""},
  {"writableHighWaterMark", 1, 5, ""},
  {"writableObjectMode", 1, 5, ""},
  {"writableBuffer", 1, 5, ""},
  {"writableLength", 1, 5, ""},
  {"writableFinished", 1, 5, ""},
  {"writableCorked", 1, 5, ""},
  {"writableEnded", 1, 5, ""},
  {"writableNeedDrain", 1, 5, ""},
  {"destroyed", 1, 6, ""},
};
static const InspRtEnt insp_rt_Transform_proto2[] = {
  {"readable", 1, 6, ""},
  {"readableDidRead", 1, 5, ""},
  {"readableAborted", 1, 5, ""},
  {"readableHighWaterMark", 1, 5, ""},
  {"readableBuffer", 1, 5, ""},
  {"readableFlowing", 1, 6, ""},
  {"readableLength", 1, 5, ""},
  {"readableObjectMode", 1, 5, ""},
  {"readableEncoding", 1, 5, ""},
  {"errored", 1, 5, ""},
  {"closed", 1, 5, ""},
  {"readableEnded", 1, 5, ""},
};
static const InspRtEnt insp_rt_Transform_proto4[] = {
  {"_events", 0, 0, "undefined"},
  {"_eventsCount", 0, 1, "0"},
  {"_maxListeners", 0, 0, "undefined"},
  {"Symbol(kCapture)", 3, 2, "false"},
};
static const InspRtLayer insp_rt_Transform_proto[] = { {NULL, 0}, {insp_rt_Transform_proto1, 11}, {insp_rt_Transform_proto2, 12}, {NULL, 0}, {insp_rt_Transform_proto4, 4} };
static const InspRtEnt insp_rt_Transform_stat3[] = {
  {"promises", 0, 5, ""},
};
static const InspRtEnt insp_rt_Transform_stat4[] = {
  {"usingDomains", 0, 2, "false"},
  {"captureRejectionSymbol", 0, 4, "Symbol(nodejs.rejection)"},
  {"captureRejections", 0, 6, ""},
  {"EventEmitterAsyncResource", 0, 5, ""},
  {"errorMonitor", 0, 4, "Symbol(events.errorMonitor)"},
  {"defaultMaxListeners", 0, 6, ""},
  {"kMaxEventTargetListeners", 1, 4, "Symbol(events.maxEventTargetListeners)"},
  {"kMaxEventTargetListenersWarned", 1, 4, "Symbol(events.maxEventTargetListenersWarned)"},
};
static const InspRtLayer insp_rt_Transform_stat[] = { {NULL, 0}, {NULL, 0}, {NULL, 0}, {insp_rt_Transform_stat3, 1}, {insp_rt_Transform_stat4, 8} };
static const InspRtEnt insp_rt_PassThrough_proto2[] = {
  {"_writev", 0, 3, "null"},
  {"writable", 1, 6, ""},
  {"writableHighWaterMark", 1, 5, ""},
  {"writableObjectMode", 1, 5, ""},
  {"writableBuffer", 1, 5, ""},
  {"writableLength", 1, 5, ""},
  {"writableFinished", 1, 5, ""},
  {"writableCorked", 1, 5, ""},
  {"writableEnded", 1, 5, ""},
  {"writableNeedDrain", 1, 5, ""},
  {"destroyed", 1, 6, ""},
};
static const InspRtEnt insp_rt_PassThrough_proto3[] = {
  {"readable", 1, 6, ""},
  {"readableDidRead", 1, 5, ""},
  {"readableAborted", 1, 5, ""},
  {"readableHighWaterMark", 1, 5, ""},
  {"readableBuffer", 1, 5, ""},
  {"readableFlowing", 1, 6, ""},
  {"readableLength", 1, 5, ""},
  {"readableObjectMode", 1, 5, ""},
  {"readableEncoding", 1, 5, ""},
  {"errored", 1, 5, ""},
  {"closed", 1, 5, ""},
  {"readableEnded", 1, 5, ""},
};
static const InspRtEnt insp_rt_PassThrough_proto5[] = {
  {"_events", 0, 0, "undefined"},
  {"_eventsCount", 0, 1, "0"},
  {"_maxListeners", 0, 0, "undefined"},
  {"Symbol(kCapture)", 3, 2, "false"},
};
static const InspRtLayer insp_rt_PassThrough_proto[] = { {NULL, 0}, {NULL, 0}, {insp_rt_PassThrough_proto2, 11}, {insp_rt_PassThrough_proto3, 12}, {NULL, 0}, {insp_rt_PassThrough_proto5, 4} };
static const InspRtEnt insp_rt_PassThrough_stat4[] = {
  {"promises", 0, 5, ""},
};
static const InspRtEnt insp_rt_PassThrough_stat5[] = {
  {"usingDomains", 0, 2, "false"},
  {"captureRejectionSymbol", 0, 4, "Symbol(nodejs.rejection)"},
  {"captureRejections", 0, 6, ""},
  {"EventEmitterAsyncResource", 0, 5, ""},
  {"errorMonitor", 0, 4, "Symbol(events.errorMonitor)"},
  {"defaultMaxListeners", 0, 6, ""},
  {"kMaxEventTargetListeners", 1, 4, "Symbol(events.maxEventTargetListeners)"},
  {"kMaxEventTargetListenersWarned", 1, 4, "Symbol(events.maxEventTargetListenersWarned)"},
};
static const InspRtLayer insp_rt_PassThrough_stat[] = { {NULL, 0}, {NULL, 0}, {NULL, 0}, {NULL, 0}, {insp_rt_PassThrough_stat4, 1}, {insp_rt_PassThrough_stat5, 8} };
static const InspRtClass insp_rt_classes[] = {
  {"EventEmitter", insp_rt_EventEmitter_proto, 1, insp_rt_EventEmitter_stat, 1},
  {"Readable", insp_rt_Readable_proto, 3, insp_rt_Readable_stat, 3},
  {"Writable", insp_rt_Writable_proto, 3, insp_rt_Writable_stat, 3},
  {"Duplex", insp_rt_Duplex_proto, 4, insp_rt_Duplex_stat, 4},
  {"Transform", insp_rt_Transform_proto, 5, insp_rt_Transform_stat, 5},
  {"PassThrough", insp_rt_PassThrough_proto, 6, insp_rt_PassThrough_stat, 6},
};


static const InspRtClass *insp_rt_find(const char *name) {
  for (size_t i = 0; i < sizeof insp_rt_classes / sizeof insp_rt_classes[0]; i++) {
    if (strcmp(insp_rt_classes[i].name, name) == 0) return &insp_rt_classes[i];
  }
  return NULL;
}

static bool insp_rt_is_error(const char *name) {
  const size_t n = strlen(name);
  return n >= 5 && strcmp(name + (n - 5), "Error") == 0;
}

/* Does some entry the walk would list over `layers` (starting at prototype layer `base`) hold an accessor the getters option would RUN? Node would call
 * it with a prototype as receiver and print the stack of the error it throws (frames of its own internals): not reproducible, so the compiler refuses
 * such a program (lowerer.ts, the getters fence); this is the run-time twin that keeps a refusal-free path from printing a wrong line. */
static bool insp_rt_runs_getter(const InspRtLayer *layers, size_t nl, unsigned base) {
  if (g_opts.getters == 0) return false;
  for (size_t j = 0; j < nl && base + j < 3; j++) {
    for (size_t i = 0; i < layers[j].n; i++) {
      const unsigned k = layers[j].e[i].kind;
      if ((k == 5 && g_opts.getters != 3) || (k == 6 && g_opts.getters != 2)) return true;
    }
  }
  return false;
}

/* One inherited key, dimmed under colors: `[readable]: [Getter/Setter]`, `_events: undefined`, `[Symbol(kCapture)]: false`. */
static void insp_sh_rt_entry(const char *key, unsigned flags, unsigned kind, const char *val, double num) {
  InspBuf eb = {0};
  if (INSP_COLORS_ON) ib_cstr(&eb, "\x1b[2m");
  if (flags & 2u) {
    ib_char(&eb, '[');
    ib_sty_cstr(&eb, key, INSP_STY_SYMBOL);
    ib_char(&eb, ']');
  } else if (flags & 1u) {
    ib_char(&eb, '[');
    insp_key_into(&eb, key, strlen(key));
    ib_char(&eb, ']');
  } else {
    insp_key_into(&eb, key, strlen(key));
  }
  ib_cstr(&eb, ": ");
  if (kind == 7) {
    ScrStr *nv = insp_sty(scr_insp_f64(num), INSP_STY_NUMBER);
    ib_str(&eb, nv);
    scr_str_release(nv);
  } else {
    ib_sty_cstr(&eb, kind == 6 ? "[Getter/Setter]" : kind == 5 ? "[Getter]" : val,
                kind == 0 ? INSP_STY_UNDEFINED : kind == 1 ? INSP_STY_NUMBER : kind == 2 ? INSP_STY_BOOLEAN : kind == 3 ? INSP_STY_NULL : kind == 4 ? INSP_STY_SYMBOL : INSP_STY_SPECIAL);
  }
  if (INSP_COLORS_ON) ib_cstr(&eb, "\x1b[22m");
  ScrStr *e = ib_take(&eb);
  scr_insp_entry(e, false);
  scr_str_release(e);
}

/* The inherited keys of the layers of `layers` that fall within Node's three, skipping a string key `own` (the program's members of that name) already has. */
static void insp_sh_rt_layers(const InspRtLayer *layers, size_t nl, unsigned base, const ScrDynClassMember *own, size_t nown) {
  for (size_t j = 0; j < nl && base + j < 3; j++) {
    for (size_t i = 0; i < layers[j].n; i++) {
      const InspRtEnt *e = &layers[j].e[i];
      if (!(e->flags & 2u)) {
        const size_t kl = strlen(e->key);
        bool shadowed = false;
        for (size_t m = 0; m < nown && !shadowed; m++) shadowed = own[m].name[0] != '%' && own[m].len == kl && memcmp(own[m].name, e->key, kl) == 0;
        if (shadowed) continue;
      }
      insp_sh_rt_entry(e->key, e->flags, e->kind, e->val, 0);
    }
  }
}

/* The Error kinds' one inherited static: Error.stackTraceLimit, on the layer of Error itself (a kind below Error occupies the layer before it). */
static bool insp_rt_err_stl_visible(const char *name, unsigned base) { return base + (strcmp(name, "Error") == 0 ? 0u : 1u) < 3; }

/* A prototype accessor of a class value, as `[g]: [Getter]`, or run when the getters option asks (never a setter-only row): the getter's value
 * through insp_acc_value. Only reached for a body that ignores its receiver (checked up front), so it runs against none. */
static void insp_sh_proto_acc(InspBuf *eb, const ScrDynClassMember *m, double vrecurse, double depth) {
  const bool st = (m->accl & 2u) != 0;
  const bool run = (m->accl & 16u) == 0 && (g_opts.getters == 1 || (g_opts.getters == 2 && !st) || (g_opts.getters == 3 && st));
  if (!run) {
    insp_sh_acc_label(eb, m->accl);
    return;
  }
  g_indent += 2;
  ScrDyn *tmp = m->get(NULL);
  insp_acc_value(eb, st ? "Getter/Setter" : "Getter", tmp, vrecurse, depth);
  g_indent -= 2;
}

/* showHidden over a compiled class VALUE, as formatRaw prints it: `[length]`, `[name]`, `[prototype]` (an object holding `[constructor]` and the
 * class's own methods and accessors, named after the base class when there is one, then the base classes' accessors as protoProps), the static
 * methods and getters, then the enumerable static fields. */
static ScrStr *insp_sh_class_value_in(ScrDyn *d, const ScrDynClass *vc, const ScrDynClass *icls, const ScrDynClassMember *srows, size_t nsrows, bool sopaque, const ScrDynClassMember *brows, size_t nbrows, void *srecv, double recurse, double depth) {
  /* the nearest runtime-provided class of the chain, when it has one: its inherited keys come from the measured tables above */
  const char *rt_name = icls->rt_name;
  const bool rt_err = rt_name != NULL && insp_rt_is_error(rt_name);
  const InspRtClass *rtc = rt_name != NULL && !rt_err ? insp_rt_find(rt_name) : NULL;
  const unsigned rt_layer = icls->rt_layer;
  if (rt_name != NULL ? (!icls->own_complete || (!rt_err && rtc == NULL)) : (icls->opaque || (icls->rt_root != 0 && icls->rt_root != 4))) {
    return insp_sh_fence(rt_name == NULL && icls->rt_root != 0 && icls->rt_root != 4 ? "a class value grafted with the emitter API" : "a class value whose member table is incomplete");
  }
  if (sopaque) return insp_sh_fence("a class value whose static table is incomplete");
  if (rtc != NULL && (insp_rt_runs_getter(rtc->proto, rtc->nproto, rt_layer) || insp_rt_runs_getter(rtc->stat, rtc->nstat, rt_layer))) {
    return insp_sh_fence("a class value of a runtime class's subclass under the getters option");
  }
  InspBuf bb = {0};
  ib_cstr(&bb, "[class ");
  ib_cstr(&bb, vc->name[0] != '\0' ? vc->name : "(anonymous)");
  if (icls->base != NULL) {
    ib_cstr(&bb, " extends ");
    ib_cstr(&bb, icls->base);
  }
  ib_char(&bb, ']');
  ScrStr *base = ib_take(&bb);
  if (recurse > depth) {
    scr_str_release(base);
    return insp_sty_lit("[Function]", INSP_STY_SPECIAL);
  }
  {
    const double cid0 = scr_insp_circ_check(d->v.fn.clo);
    if (cid0 > 0) {
      scr_str_release(base);
      return scr_insp_circular(cid0);
    }
  }
  /* a getters option runs a prototype accessor against the prototype object, which holds none of the instance's fields. The compiler marks the
   * accessors whose body never reads its receiver (accl bit 5): those run exactly, against no instance. One that reads it has no exact answer
   * here (the compiler refuses such a program at build time, see lowerer.ts); this is the run-time twin, raised before any frame opens. */
  if (g_opts.getters != 0) {
    for (size_t i = 0; i < icls->nmembers; i++) {
      const ScrDynClassMember *am = &icls->members[i];
      if (!(am->accl & 1u) || am->name[0] == '%' || (am->accl & 16u) != 0 || (am->accl & 32u) != 0) continue;
      const bool ast = (am->accl & 2u) != 0;
      if (g_opts.getters == 1 || (g_opts.getters == 2 && !ast) || (g_opts.getters == 3 && ast)) {
        scr_str_release(base);
        return insp_sh_fence("a class value whose prototype accessor reads this under the getters option");
      }
    }
  }
  insp_begin_obj(recurse + 1);
  scr_insp_seen_push(d->v.fn.clo);
  {
    InspBuf eb = {0};
    ib_hname(&eb, "length");
    /* the constructor's arity: the class's synthesized `%dynLen` static row */
    double ctor_len = -1;
    for (size_t i = 0; i < nsrows; i++) {
      const ScrDynClassMember *lm = &srows[i];
      if (lm->len == 7 && memcmp(lm->name, "%dynLen", 7) == 0 && lm->call != NULL) {
        ScrDyn *lr = lm->call(srecv, NULL, 0, "length");
        if (lr != NULL) {
          if (lr->kind == SCR_DYN_NUM) ctor_len = lr->v.num;
          scr_dyn_release(lr);
        }
        break;
      }
    }
    if (ctor_len < 0) {
      /* unbalanced frame: unwind it before stopping */
      ScrStr *junk = scr_str_new("", 0);
      ScrStr *jb0 = scr_str_new("{", 1);
      ScrStr *jb1 = scr_str_new("}", 1);
      ScrStr *jo = scr_insp_end(junk, jb0, jb1, recurse + 1, false, false);
      scr_str_release(jo);
      scr_str_release(junk);
      scr_str_release(jb0);
      scr_str_release(jb1);
      scr_str_release(base);
      if (g_nseen > 0) g_nseen--;
      return insp_sh_fence("a class value without a constructor-length row");
    }
    ScrStr *lv = insp_sty(scr_insp_f64(ctor_len), INSP_STY_NUMBER);
    insp_kv(&eb, lv);
    scr_str_release(lv);
    ScrStr *e = ib_take(&eb);
    scr_insp_entry(e, true);
    scr_str_release(e);
  }
  {
    InspBuf eb = {0};
    ib_hname(&eb, "name");
    ScrStr *ns = scr_str_new(vc->name, strlen(vc->name));
    ScrStr *nv = scr_insp_str(ns);
    scr_str_release(ns);
    insp_kv(&eb, nv);
    scr_str_release(nv);
    ScrStr *e = ib_take(&eb);
    scr_insp_entry(e, false);
    scr_str_release(e);
  }
  {
    ScrStr *pv;
    if (recurse + 1 > depth) {
      if (icls->base != NULL) {
        InspBuf pb = {0};
        ib_char(&pb, '[');
        ib_cstr(&pb, icls->base);
        ib_char(&pb, ']');
        pv = insp_sty(ib_take(&pb), INSP_STY_SPECIAL);
      } else {
        pv = insp_sty_lit("[Object]", INSP_STY_SPECIAL);
      }
    } else {
      insp_begin_obj(recurse + 2);
      {
        InspBuf cb = {0};
        ib_hname(&cb, "constructor");
        ScrStr *cv = scr_insp_circular(scr_insp_circ_check(d->v.fn.clo));
        insp_kv(&cb, cv);
        scr_str_release(cv);
        ScrStr *ce = ib_take(&cb);
        scr_insp_entry(ce, false);
        scr_str_release(ce);
      }
      for (size_t i = 0; i < icls->nmembers; i++) {
        const ScrDynClassMember *m = &icls->members[i];
        if (m->name[0] == '%' || ((m->accl >> 2) & 3u) != 0) continue;
        InspBuf eb = {0};
        if (m->call != NULL) {
          ib_char(&eb, '[');
          insp_key_into(&eb, m->name, m->len);
          ib_char(&eb, ']');
          ScrStr *mt = insp_sh_method_text(m->name, m->len, m->accl >> 8 ? (unsigned)(m->accl >> 8) - 1u : 0u, recurse + 2, depth);
          insp_kv(&eb, mt);
          scr_str_release(mt);
        } else if (m->accl & 1u) {
          ib_char(&eb, '[');
          insp_key_into(&eb, m->name, m->len);
          ib_char(&eb, ']');
          ib_cstr(&eb, ": ");
          insp_sh_proto_acc(&eb, m, recurse + 2, depth);
        } else {
          continue;
        }
        ScrStr *e = ib_take(&eb);
        scr_insp_entry(e, false);
        scr_str_release(e);
      }
      /* protoProps: the base classes' accessors (up to three prototypes from the first base) */
      for (size_t i = 0; i < icls->nmembers; i++) {
        const ScrDynClassMember *m = &icls->members[i];
        const unsigned lvl = (m->accl >> 2) & 3u;
        if (!(m->accl & 1u) || m->name[0] == '%' || lvl == 0) continue;
        InspBuf eb = {0};
        if (INSP_COLORS_ON) ib_cstr(&eb, "\x1b[2m");
        ib_char(&eb, '[');
        insp_key_into(&eb, m->name, m->len);
        ib_char(&eb, ']');
        ib_cstr(&eb, ": ");
        insp_sh_proto_acc(&eb, m, recurse + 1, depth);
        if (INSP_COLORS_ON) ib_cstr(&eb, "\x1b[22m");
        ScrStr *e = ib_take(&eb);
        scr_insp_entry(e, false);
        scr_str_release(e);
      }
      if (rtc != NULL) insp_sh_rt_layers(rtc->proto, rtc->nproto, rt_layer, icls->members, icls->nmembers);
      InspBuf p0 = {0};
      if (rt_err && icls->base != NULL) {
        /* an error-like prototype prints in brackets, the nearest class's name first when it is not the runtime kind itself */
        ib_char(&p0, '[');
        ib_cstr(&p0, icls->base);
        if (strcmp(icls->base, rt_name) != 0) {
          ib_cstr(&p0, " [");
          ib_cstr(&p0, rt_name);
          ib_char(&p0, ']');
        }
        ib_cstr(&p0, "] ");
      } else if (icls->base != NULL) {
        ib_cstr(&p0, icls->base);
        ib_char(&p0, ' ');
      }
      ib_char(&p0, '{');
      ScrStr *pb = scr_str_new("", 0);
      ScrStr *pb0 = ib_take(&p0);
      ScrStr *pb1 = scr_str_new("}", 1);
      pv = scr_insp_end(pb, pb0, pb1, recurse + 2, false, false);
      scr_str_release(pb);
      scr_str_release(pb0);
      scr_str_release(pb1);
    }
    InspBuf eb = {0};
    ib_hname(&eb, "prototype");
    insp_kv(&eb, pv);
    scr_str_release(pv);
    ScrStr *e = ib_take(&eb);
    scr_insp_entry(e, false);
    scr_str_release(e);
  }
  /* statics: methods and getters in definition order, then the enumerable fields (a class's static fields initialize after its methods) */
  for (int pass = 0; pass < 2; pass++) {
    for (size_t i = 0; i < nsrows; i++) {
      const ScrDynClassMember *m = &srows[i];
      if (m->name[0] == '%' || ((m->accl >> 2) & 3u) != 0) continue;
      const bool is_field = m->call == NULL && !(m->accl & 1u) && m->enumerable != 0;
      if ((pass == 0) == is_field) continue;
      InspBuf eb = {0};
      if (is_field) {
        insp_key_into(&eb, m->name, m->len);
        ScrDyn *mv = m->get(srecv); /* +1, or NULL with a throw pending */
        if (mv == NULL) continue;
        ScrStr *val = scr_insp_dyn(mv, recurse + 1, depth);
        scr_dyn_release(mv);
        insp_kv(&eb, val);
        scr_str_release(val);
      } else if (m->call != NULL) {
        ib_char(&eb, '[');
        insp_key_into(&eb, m->name, m->len);
        ib_char(&eb, ']');
        ScrStr *mt = insp_sh_method_text(m->name, m->len, m->accl >> 8 ? (unsigned)(m->accl >> 8) - 1u : 0u, recurse + 1, depth);
        insp_kv(&eb, mt);
        scr_str_release(mt);
      } else if (m->accl & 1u) {
        ib_char(&eb, '[');
        insp_key_into(&eb, m->name, m->len);
        ib_char(&eb, ']');
        ib_cstr(&eb, ": ");
        const bool st = (m->accl & 2u) != 0;
        const bool run = g_opts.getters == 1 || (g_opts.getters == 2 && !st) || (g_opts.getters == 3 && st);
        if (run) {
          g_indent += 2;
          ScrDyn *tmp = m->get(srecv);
          insp_acc_value(&eb, st ? "Getter/Setter" : "Getter", tmp, recurse + 1, depth);
          g_indent -= 2;
        } else {
          insp_sh_acc_label(&eb, m->accl);
        }
      } else {
        continue;
      }
      ScrStr *e = ib_take(&eb);
      scr_insp_entry(e, false);
      scr_str_release(e);
    }
  }
  /* protoProps of a derived class value: the base classes' static fields and accessors (a function value is skipped), up to three levels, dimmed under colors */
  for (int src = 0; src < 2; src++) {
  const ScrDynClassMember *prow = src == 0 ? srows : brows;
  void *precv = src == 0 ? srecv : NULL;
  for (size_t i = 0, pn = src == 0 ? nsrows : nbrows; i < pn; i++) {
    const ScrDynClassMember *m = &prow[i];
    /* the evaluation's own rows carry no inherited level; its declared base class's table (levels counted from that base) sits one layer further up */
    const unsigned lvl = ((m->accl >> 2) & 3u) + (unsigned)src;
    if (m->name[0] == '%' || lvl == 0 || lvl > 3 || m->call != NULL) continue;
    if (src == 1) {
      bool shadowed = false;
      for (size_t j = 0; j < nsrows && !shadowed; j++) shadowed = srows[j].len == m->len && memcmp(srows[j].name, m->name, m->len) == 0;
      if (shadowed) continue;
    }
    InspBuf eb = {0};
    if (INSP_COLORS_ON) ib_cstr(&eb, "\x1b[2m");
    if (m->accl & 1u) {
      ib_char(&eb, '[');
      insp_key_into(&eb, m->name, m->len);
      ib_char(&eb, ']');
      ib_cstr(&eb, ": ");
      const bool st = (m->accl & 2u) != 0;
      const bool run = g_opts.getters == 1 || (g_opts.getters == 2 && !st) || (g_opts.getters == 3 && st);
      if (run) {
        g_indent += 2;
        ScrDyn *tmp = m->get(precv);
        insp_acc_value(&eb, st ? "Getter/Setter" : "Getter", tmp, recurse + 1, depth + 1);
        g_indent -= 2;
      } else {
        insp_sh_acc_label(&eb, m->accl);
      }
    } else {
      insp_key_into(&eb, m->name, m->len);
      ScrDyn *mv = m->get(precv);
      if (mv == NULL) {
        free(eb.data);
        continue;
      }
      ScrStr *val = scr_insp_dyn(mv, recurse + 1, depth);
      scr_dyn_release(mv);
      insp_kv(&eb, val);
      scr_str_release(val);
    }
    if (INSP_COLORS_ON) ib_cstr(&eb, "\x1b[22m");
    ScrStr *e = ib_take(&eb);
    scr_insp_entry(e, false);
    scr_str_release(e);
  }
  }
  if (rtc != NULL) insp_sh_rt_layers(rtc->stat, rtc->nstat, rt_layer, srows, nsrows);
  if (rt_err && insp_rt_err_stl_visible(rt_name, rt_layer)) {
    bool shadowed = false;
    for (size_t m = 0; m < nsrows && !shadowed; m++) shadowed = srows[m].name[0] != '%' && srows[m].len == 15 && memcmp(srows[m].name, "stackTraceLimit", 15) == 0;
    if (!shadowed) insp_sh_rt_entry("stackTraceLimit", 0, 7, NULL, scr_error_stack_limit_get());
  }
  ScrStr *hb0 = scr_str_new("{", 1);
  ScrStr *hb1 = scr_str_new("}", 1);
  ScrStr *hout = scr_insp_end(base, hb0, hb1, recurse + 1, false, false);
  scr_str_release(base);
  scr_str_release(hb0);
  scr_str_release(hb1);
  ScrStr *hw = scr_insp_ref_wrap(d->v.fn.clo, hout);
  scr_str_release(hout);
  return hw;
}

/* showHidden over a class VALUE: a declared class (its own descriptor carries both member tables, statics without a receiver) or a per-evaluation
 * class expression (the box holds the evaluation, the STATIC side: its member rows are the statics and run with the evaluation as receiver; the
 * instance side is reached through the evaluation's `%dynInst` row, the never-constructed instance the prototype object is built from). */
static ScrStr *insp_sh_class_value(ScrDyn *d, const ScrDynClass *vc, const ScrDyn *einner, double recurse, double depth) {
  if (einner == NULL) return insp_sh_class_value_in(d, vc, vc, vc->statics, vc->nstatics, vc->staticsOpaque, NULL, 0, NULL, recurse, depth);
  const ScrDynClass *ecls = scr_dyn_objinst_class_of(einner);
  const ScrDynClassMember *im = scr_dyn_objinst_member(einner, "%dynInst", 8);
  ScrDyn *ib = im != NULL && im->call != NULL ? im->call(einner->v.inst.o, NULL, 0, "prototype") : NULL;
  if (ib == NULL || ib->kind != SCR_DYN_OBJINST) {
    scr_dyn_release(ib);
    return insp_sh_fence("a per-evaluation class value whose instance side is not reachable");
  }
  /* the declared base class's statics (an evaluation's own rows hold only its own members) */
  const ScrDynClassMember *bm = scr_dyn_objinst_member(einner, "%dynBase", 8);
  ScrDyn *bv = bm != NULL && bm->call != NULL ? bm->call(einner->v.inst.o, NULL, 0, "prototype") : NULL;
  const ScrDynClass *bc = bv != NULL && bv->kind == SCR_DYN_FUNC ? scr_dyn_class_of_value(bv) : NULL;
  if (bc != NULL && bc->staticsOpaque) {
    scr_dyn_release(bv);
    scr_dyn_release(ib);
    return insp_sh_fence("a per-evaluation class value whose base class has an incomplete static table");
  }
  ScrStr *r = insp_sh_class_value_in(d, ecls, scr_dyn_objinst_class_of(ib), ecls->members, ecls->nmembers, ecls->opaque, bc != NULL ? bc->statics : NULL,
                                     bc != NULL ? bc->nstatics : 0, einner->v.inst.o, recurse, depth);
  scr_dyn_release(bv);
  scr_dyn_release(ib);
  return r;
}
#endif

/* The full inspect over a dyn tree — the one runtime type whose SHAPE
 * lives in the value, so the traversal lives here instead of a
 * synthesized helper. Same engine, same defaults. dyn-boxed bytes render
 * in the checked-dynamic tree's documented Uint8Array identity (SEMANTICS.md). */
ScrStr *(*scr_insp_hook)(ScrDyn *d, const char *cn, double recurse, double depth) = NULL;

ScrStr *scr_insp_dyn(ScrDyn *d, double recurse, double depth) {
  switch (d->kind) {
    case SCR_DYN_NULL:
      return insp_sty_lit("null", INSP_STY_NULL);
    case SCR_DYN_UNDEF:
      return insp_sty_lit("undefined", INSP_STY_UNDEFINED);
    case SCR_DYN_BOOL:
      return (d->v.b ? insp_sty_lit("true", INSP_STY_BOOLEAN) : insp_sty_lit("false", INSP_STY_BOOLEAN));
    case SCR_DYN_NUM:
      return insp_sty(scr_insp_f64(d->v.num), INSP_STY_NUMBER);
    case SCR_DYN_STR:
      return scr_insp_str(d->v.str);
    case SCR_DYN_ARR: {
      SCR_VIEW_FRESH(d);
      /* An array's own NAMED properties print after its elements, as `key:
       * value` entries (an exec result: `[ 'aa', index: 1, input: 'caab',
       * groups: undefined ]`). They are part of the same entry list, which
       * is also what decides the grid grouping and the "... more items"
       * tail's exclusion, exactly as Node's formatList appends them. */
      const ScrDyn *xs = scr_dyn_arr_extras(d);
      /* A listener list of an emitter's `_events` carries Node's enumerable symbol property
       * (events.emitting), printed after the elements. */
      const ScrDyn *eel = scr_dyn_obj_slot_get(d, "%eeList", 7);
      const size_t nx = (xs != NULL ? xs->v.obj.len : 0) + (eel != NULL ? 1 : 0);
      const size_t nsy = insp_sym_count(d); /* enumerable symbol-keyed properties print last (scr_symbol.c) */
      const size_t nlen = INSP_SH ? 1 : 0;  /* showHidden: the non-enumerable own `length` is the first named key */
      if (d->v.arr.len == 0 && nx + nsy + nlen == 0) return scr_str_new("[]", 2);
      if (recurse > depth) return insp_sty_lit("[Array]", INSP_STY_SPECIAL);
      scr_insp_begin(recurse + 1);
      size_t shown = insp_shown(d->v.arr.len);
      /* Node's formatArray / formatSpecialArray: a run of holes is ONE output
       * entry `<n empty item(s)>`, and `shown` bounds the ENTRIES. The numeric
       * alignment flag reads value[entryIndex] (Node's own indexing). */
      size_t ne = 0, ix = 0;
      const size_t alen = d->v.arr.len;
      while (ix < alen && ne < shown) {
        ScrDyn *item = d->v.arr.items[ix];
        if (scr_dyn_is_hole(item)) {
          size_t run = 1;
          while (ix + run < alen && scr_dyn_is_hole(d->v.arr.items[ix + run])) run++;
          char hb[64];
          int hn = snprintf(hb, sizeof hb, "<%zu empty item%s>", run, run > 1 ? "s" : "");
          ScrStr *hs = insp_sty(scr_str_new(hb, (size_t)hn), INSP_STY_UNDEFINED);
          scr_insp_entry(hs, ne < alen && d->v.arr.items[ne]->kind == SCR_DYN_NUM);
          scr_str_release(hs);
          ix += run;
        } else {
          ScrStr *s = scr_insp_dyn(item, recurse + 1, depth);
          scr_insp_entry(s, ne < alen && d->v.arr.items[ne]->kind == SCR_DYN_NUM);
          scr_str_release(s);
          ix++;
        }
        ne++;
      }
      bool more = ix < alen;
      if (more) {
        ScrStr *m = scr_insp_more_items((double)(alen - ix));
        scr_insp_entry(m, ne < alen && d->v.arr.items[ne]->kind == SCR_DYN_NUM);
        scr_str_release(m);
      }
      shown = ne;
      /* Node's grid order reads `typeof value[i]` at each ENTRY position, named keys included (value[i] past the elements is undefined). */
      size_t ep = ne + (more ? 1 : 0);
#ifdef SCR_INSP_COLORS
      if (INSP_SH) {
        InspBuf lb = {0};
        ib_hname(&lb, "length");
        ScrStr *lv = insp_sty(scr_insp_f64((double)alen), INSP_STY_NUMBER);
        insp_kv(&lb, lv);
        scr_str_release(lv);
        ScrStr *le = ib_take(&lb);
        scr_insp_entry(le, ep < alen && d->v.arr.items[ep]->kind == SCR_DYN_NUM);
        ep++;
        scr_str_release(le);
      }
#endif
      for (size_t i = 0; i < nx; i++) {
        if (eel != NULL && i == nx - 1) {
          ScrStr *val = scr_insp_dyn((ScrDyn *)eel, recurse + 1, depth);
          InspBuf eb = {0};
          ib_cstr(&eb, "Symbol(events.emitting): ");
          ib_bytes(&eb, val->data, val->len);
          scr_str_release(val);
          ScrStr *entry = ib_take(&eb);
          scr_insp_entry(entry, INSP_SH && ep < alen && d->v.arr.items[ep]->kind == SCR_DYN_NUM);
          ep++;
          scr_str_release(entry);
          continue;
        }
        const ScrDynEntry *ent = &xs->v.obj.entries[i];
        ScrStr *val = scr_insp_dyn(ent->value, recurse + 1, depth);
        InspBuf eb = {0};
        insp_key_into(&eb, ent->key, ent->key_len);
        ib_cstr(&eb, ": ");
        ib_bytes(&eb, val->data, val->len);
        scr_str_release(val);
        ScrStr *entry = ib_take(&eb);
        scr_insp_entry(entry, INSP_SH && ep < alen && d->v.arr.items[ep]->kind == SCR_DYN_NUM);
        ep++;
        scr_str_release(entry);
      }
      insp_emit_syms(d, recurse, depth);
      ScrStr *base = scr_str_new("", 0);
      ScrStr *b0 = scr_str_new("[", 1);
      ScrStr *b1 = scr_str_new("]", 1);
      /* Node drops the LAST entry from the grid whenever the entry list
       * outgrew maxArrayLength (100), which with named properties appended
       * is no longer the "more items" line. */
      g_sort_tail = nx + nsy + nlen;
      ScrStr *out = scr_insp_end(base, b0, b1, recurse + 1, true, insp_over_cap(shown + (more ? 1 : 0) + nx + nsy + nlen));
      scr_str_release(base);
      scr_str_release(b0);
      scr_str_release(b1);
      return out;
    }
    case SCR_DYN_OBJ: {
      /* A primitive wrapper object prints as `[String: 'ab']`, `[Number: 5]`, `[Boolean: false]`, `[BigInt: 1n]`. */
      {
        const ScrDyn *wp = scr_dyn_wrapper_prim(d);
        if (wp != NULL) {
          /* Node renders the wrapped primitive with stylizeNoColor and colors the whole `[String: 'x']` by the type when the wrapper has no own keys. */
          const bool wrap_colors = INSP_COLORS_ON;
#ifdef SCR_INSP_COLORS
          const ScrDyn *wrap_fn = g_opts.stylize_fn;
          g_opts.colors = false;
          g_opts.stylize_fn = NULL;
#endif
          ScrStr *inner = wp->kind == SCR_DYN_STR || wp->kind == SCR_DYN_NUM || wp->kind == SCR_DYN_BOOL || wp->kind == SCR_DYN_BIG
                              ? scr_insp_dyn((ScrDyn *)wp, recurse, depth)
                              : scr_dyn_symbol_descriptive(wp); /* a Symbol wrapper prints [Symbol: Symbol(desc)] */
          InspBuf wb = {0};
          const char *pname = wp->kind == SCR_DYN_STR ? "String" : wp->kind == SCR_DYN_NUM ? "Number" : wp->kind == SCR_DYN_BOOL ? "Boolean" : wp->kind == SCR_DYN_BIG ? "BigInt" : "Symbol";
          ib_char(&wb, '[');
          ib_cstr(&wb, pname);
          /* A subclass wrapper (`class V extends String`) names its constructor: `[String (V): 'ab']`. */
          const char *cn = scr_dyn_ext(d)->cname;
          if (cn != NULL && strcmp(cn, pname) != 0) {
            ib_cstr(&wb, " (");
            ib_cstr(&wb, cn);
            ib_char(&wb, ')');
          }
          ib_cstr(&wb, ": ");
          ib_str(&wb, inner);
          ib_char(&wb, ']');
          scr_str_release(inner);
          ScrStr *base = ib_take(&wb);
#ifdef SCR_INSP_COLORS
          g_opts.colors = wrap_colors;
          g_opts.stylize_fn = wrap_fn;
#else
          (void)wrap_colors;
#endif
          if (d->v.obj.len == 0 && !(INSP_SH && wp->kind == SCR_DYN_STR)) return insp_sty(base, wp->kind == SCR_DYN_STR ? INSP_STY_STRING : wp->kind == SCR_DYN_NUM ? INSP_STY_NUMBER : wp->kind == SCR_DYN_BOOL ? INSP_STY_BOOLEAN : wp->kind == SCR_DYN_BIG ? INSP_STY_BIGINT : INSP_STY_SYMBOL); /* no own enumerable property: just the wrapper */
          ScrStr *with = insp_with_base(base, (ScrDyn *)d, recurse, depth, wp->kind == SCR_DYN_STR ? scr_str_utf16_len(wp->v.str) : -1.0); /* `[String: 'ab'] { x: 1 }` */
          scr_str_release(base);
          return with;
        }
      }
      /* Node's circular check comes first, before the empty and depth answers:
       * a member that is an ancestor on the stack (a self-issued certificate's
       * issuerCertificate) renders [Circular *N], and the ancestor gets <ref *N>. */
      {
        double cid = scr_insp_circ_check(d);
        if (cid > 0) return scr_insp_circular(cid);
      }
      /* An ERROR that crossed the boundary renders like one that did not.
       *
       * This arm used to see the encoding as an ordinary object and print
       * its members, so `console.log(e)` in a catch block answered
       * `{ '%error': true, name: 'Error', message: 'boom' }` - the
       * compiler's own reserved key, on stdout, in the single most common
       * place a program looks at an error. The static side of the same
       * value printed `[Error: boom]` (scr_insp_error, the stackless
       * rendering Node itself uses for an error with no stack), so ONE
       * error had TWO renderings decided by whether it had crossed: put a
       * caught error in a record's `unknown` field and console.log the
       * record, and both spellings appeared in one line of output.
       *
       * scr_error_from_dyn rides the process identity cache, so an error
       * that came from a runtime ScrError renders THAT instance and
       * nothing is rebuilt on the common path. */
      if (scr_dyn_is_error_encoding(d)) {
        ScrError *e = scr_error_from_dyn(d); /* +1, identity-cached */
        ScrStr *s = scr_insp_error(e, recurse, depth);
        scr_error_release(e);
        return s;
      }
      /* Object.create(null)'s dictionary: Node prefixes the rendering
       * with "[Object: null prototype]" (formatValue's constructor-less
       * base), the empty form included, and the beyond-depth answer IS
       * the bare marker (where a plain object says [Object]). */
      /* An INSTANCE (`new F()`) carries its constructor's name, and Node
       * prefixes the rendering with it: `F { a: 1 }`, `G {}` — and
       * `[F]` past the depth limit where a plain object says [Object].
       * The name is the static literal the FUNC box carries, copied at
       * construction; a plain literal has none and renders unchanged. */
      /* …but NOT for the prototype object itself. Node's
       * getConstructorName walks the chain for an own `constructor`
       * descriptor and keeps it only when `value instanceof
       * descriptor.value` — and `F.prototype instanceof F` is FALSE (the
       * walk starts at F.prototype's [[Prototype]], which is
       * Object.prototype). So Node skips F, reaches Object.prototype,
       * and renders `F.prototype` as a bare `{}`. An INSTANCE passes the
       * instanceof test and keeps its `F {`; so does the
       * `Object.create(P.prototype)` object the ES5 idiom assigns
       * through, which is why the cname on the MINTED prototype is what
       * has to go and not the field. Measured on v25.9.0, three
       * spellings, before this line was written. */
      const char *cn = scr_dyn_is_minted_proto(d) ? NULL : scr_dyn_ext(d)->cname;
      if (scr_dyn_is_minted_proto(d)) {
        /* ...but when its [[Prototype]] chain reaches ANOTHER class's prototype (a derived class's), Node's walk keeps that
         * ancestor's constructor (`Derived.prototype instanceof Base` is true): `Base {}`. */
        const ScrDyn *anc = scr_dyn_ext(d)->proto;
        for (size_t steps = 0; anc != NULL && anc->kind == SCR_DYN_OBJ && steps < 1000; steps++) {
          if (scr_dyn_ext(anc)->cname != NULL) {
            cn = scr_dyn_ext(anc)->cname;
            break;
          }
          anc = scr_dyn_ext(anc)->proto;
        }
      }
      /* Node lists own enumerable SYMBOL keys after the string keys, and
       * an INTERNAL SLOT is exactly what this tier keeps where Node keeps
       * a symbol: `Dirent { name: 'a.txt', parentPath: 'kd',
       * Symbol(type): 1 }`, measured against v25.9.0.
       *
       * A slot whose key begins with '%' is the COMPILER's own cell, not
       * a Node symbol, and renders nowhere -- StringDecoder's `%pending`
       * is the packed partial sequence, and printing it under
       * Symbol(kNativeDecoder) would put the compiler's number on stdout
       * where Node puts a seven-byte native state buffer. The rule is on
       * the KEY rather than on a shape because this walk knows no shapes;
       * slotStorageKey (ir/nodes.ts) is the other half of it. */
      /* The WebCrypto unit's inspect hook (scr_webcrypto.c renders a CryptoKey
       * through Node's CryptoKey inspect hook); NULL in every program that never
       * reads WebCrypto. */
      if (scr_insp_hook != NULL) {
        ScrStr *hooked = scr_insp_hook(d, cn, recurse, depth);
        if (hooked != NULL) return hooked;
      }
      const size_t nsym = insp_slot_count(d);
      size_t nown = d->v.obj.len;
#ifdef SCR_INSP_COLORS
      if (INSP_SH) {
        InspHK *hk_tmp = NULL;
        nown = insp_obj_keys(d, &hk_tmp, false);
        free(hk_tmp);
      }
#endif
      if (nown == 0 && nsym == 0) {
        if (cn != NULL && cn[0]) {
          InspBuf nb = {0};
          ib_cstr(&nb, cn);
          ib_cstr(&nb, " {}");
          return ib_take(&nb);
        }
        return d->null_proto ? scr_str_new("[Object: null prototype] {}", 27)
                             : scr_str_new("{}", 2);
      }
      if (recurse > depth) {
        if (cn != NULL && cn[0]) {
          InspBuf nb = {0};
          ib_char(&nb, '[');
          ib_cstr(&nb, cn);
          ib_char(&nb, ']');
          return insp_sty(ib_take(&nb), INSP_STY_SPECIAL);
        }
        return d->null_proto ? insp_sty_lit("[Object: null prototype]", INSP_STY_SPECIAL)
                             : insp_sty_lit("[Object]", INSP_STY_SPECIAL);
      }
      insp_begin_obj(recurse + 1);
      scr_insp_seen_push(d);
      /* JS own-key order — index keys first, ascending, then the rest in
       * insertion order. Node's util.inspect lists exactly what
       * Object.keys lists, in the same order; this walk used to print the
       * entry table raw and disagree with Object.keys inside one process
       * (`{ z: 1, '10': 3, '2': 4 }` where Node prints
       * `{ '2': 4, '10': 3, z: 1 }`). Shared projection, one definition. */
#ifdef SCR_INSP_COLORS
      if (INSP_SH) {
        insp_emit_obj_keys(d, recurse, depth, false);
      } else {
#endif
      size_t *ord = scr_dyn_obj_key_order(d);
      for (size_t i = 0; i < d->v.obj.len; i++) {
        ScrDynEntry *ent = &d->v.obj.entries[ord ? ord[i] : i];
        InspBuf eb = {0};
        /* An ENUMERABLE ACCESSOR renders as `[Getter]` / `[Setter]` /
         * `[Getter/Setter]` and its getter is NOT invoked — Node's
         * default `getters: false`, and calling one at a print would be
         * a side effect the program did not ask for. This is the same
         * rendering scr_cls_props_inspect gives the same descriptor on a
         * compiled class instance, deliberately: one shape, one string.
         * A tombstone is not an own enumerable key and shows nothing. */
        if (ent->value == scr_dyn_acc_slot()) {
          const ScrDyn *q = scr_dyn_ext(d)->hidden != NULL
                                ? scr_dyn_obj_get(scr_dyn_ext(d)->hidden, ent->key, ent->key_len)
                                : NULL;
          if (q == NULL || q->kind != SCR_DYN_ARR || q->v.arr.len < 5 ||
              !scr_dyn_truthy(q->v.arr.items[4])) {
            continue;
          }
#ifdef SCR_INSP_COLORS
          insp_key_into(&eb, ent->key, ent->key_len);
          ib_cstr(&eb, ": ");
          insp_acc_into(&eb, d, q->v.arr.items[1], q->v.arr.items[2], recurse + 1, depth);
#else
          bool g = q->v.arr.items[1]->kind == SCR_DYN_FUNC;
          bool s = q->v.arr.items[2]->kind == SCR_DYN_FUNC;
          insp_key_into(&eb, ent->key, ent->key_len);
          ib_cstr(&eb, ": ");
          ib_sty_cstr(&eb, g && s ? "[Getter/Setter]" : g ? "[Getter]" : "[Setter]", INSP_STY_SPECIAL);
#endif
          ScrStr *aentry = ib_take(&eb);
          scr_insp_entry(aentry, false);
          scr_str_release(aentry);
          continue;
        }
        ScrStr *val = scr_insp_dyn(ent->value, recurse + 1, depth);
        insp_key_into(&eb, ent->key, ent->key_len);
        insp_kv(&eb, val);
        scr_str_release(val);
        ScrStr *entry = ib_take(&eb);
        scr_insp_entry(entry, false);
        scr_str_release(entry);
      }
      free(ord);
#ifdef SCR_INSP_COLORS
      }
#endif
      insp_emit_slots(d, recurse, depth);
      /* Node keeps the constructor-name prefix INSIDE braces[0] (`F {`, `[Object: null prototype] {`), and the
       * single-line test counts it with its separating space: `start = output.length + indentationLvl +
       * braces[0].length + base.length + 10`. Passing the prefix as `base` dropped that space, so an object
       * one character from breakLength printed on one line where Node breaks it. */
      InspBuf pb = {0};
      if (cn != NULL && cn[0]) {
        ib_cstr(&pb, cn);
        ib_cstr(&pb, " {");
      } else if (d->null_proto) {
        ib_cstr(&pb, "[Object: null prototype] {");
      } else {
        ib_cstr(&pb, "{");
      }
      ScrStr *base = scr_str_new("", 0);
      ScrStr *b0 = ib_take(&pb);
      ScrStr *b1 = scr_str_new("}", 1);
      ScrStr *out = scr_insp_end(base, b0, b1, recurse + 1, false, false);
      scr_str_release(base);
      scr_str_release(b0);
      scr_str_release(b1);
      ScrStr *wrapped = scr_insp_ref_wrap(d, out); /* <ref *N> when this object was a circle's target */
      scr_str_release(out);
      return wrapped;
    }
    case SCR_DYN_FUNC: {
      /* Node's function rendering: [Function: name] / [Function
       * (anonymous)]. The boxed name is the compiler's best-effort static
       * spelling (SEMANTICS.md — reference-site naming). */
      const char *name = scr_dyn_fn_name(d);
      InspBuf out = {0};
      /* A CLASS VALUE prints `[class A]` / `[class B extends A]`, followed by
       * its own ENUMERABLE static fields in braces (the instance arm's
       * layout: `[class A] { k: 5 }`). Static methods and getters are
       * non-enumerable and never listed. */
      const ScrDyn *einner = scr_dyn_class_eval_inner(d);
#ifdef SCR_INSP_COLORS
      if (INSP_SH && einner != NULL) return insp_sh_class_value(d, NULL, einner, recurse, depth);
      if (INSP_SH && scr_dyn_class_of_value(d) != NULL) return insp_sh_class_value(d, scr_dyn_class_of_value(d), NULL, recurse, depth);
#endif
      if (einner != NULL) {
        /* A per-evaluation class value: the same line, its own ENUMERABLE static fields
         * (the evaluation's member rows) in braces. */
        const ScrDynClass *ecls = scr_dyn_objinst_class_of(einner);
        ib_cstr(&out, "[class ");
        ib_cstr(&out, ecls->name[0] != '\0' ? ecls->name : "(anonymous)");
        if (ecls->base != NULL) {
          ib_cstr(&out, " extends ");
          ib_cstr(&out, ecls->base);
        }
        ib_char(&out, ']');
        void *eo = einner->v.inst.o;
        size_t eshown = 0;
        for (size_t i = 0; i < ecls->nmembers; i++) {
          const ScrDynClassMember *m = &ecls->members[i];
          if (m->enumerable == 0 || m->enumerable == 3 || m->name[0] == '%' || scr_dyn_member_hidden(m, eo)) continue;
          eshown++;
        }
        /* the properties a program ADDED to the function object follow the statics */
        ScrDyn *eextra = NULL;
        if (d->v.fn.clo->props != NULL) {
          ScrDyn *tbl = (ScrDyn *)scr_box_get_ref(d->v.fn.clo->props); /* +1 */
          eextra = tbl != NULL ? scr_dyn_objwalk(tbl, SCR_OBJWALK_ENTRIES) : NULL;
          scr_dyn_release(tbl);
          size_t shownExtra = 0;
          for (size_t i = 0; eextra != NULL && i < eextra->v.arr.len; i++) {
            const ScrDyn *pk0 = eextra->v.arr.items[i]->v.arr.items[0];
            if (!(pk0->v.str->len == 9 && memcmp(pk0->v.str->data, "prototype", 9) == 0)) shownExtra++;
          }
          if (eextra != NULL && shownExtra == 0) {
            scr_dyn_release(eextra);
            eextra = NULL;
          }
        }
        ScrDyn *esyms = insp_fn_sym_table(d);
        if (eshown == 0 && eextra == NULL && insp_sym_count(esyms) == 0) {
          scr_dyn_release(esyms);
          return insp_sty(ib_take(&out), INSP_STY_SPECIAL);
        }
        if (recurse > depth) {
          scr_dyn_release(eextra);
          scr_dyn_release(esyms);
          return insp_sty(ib_take(&out), INSP_STY_SPECIAL);
        }
        ScrStr *ebase = ib_take(&out);
        insp_begin_obj(recurse + 1);
        bool ethrew = false;
        for (size_t i = 0; i < ecls->nmembers && !ethrew; i++) {
          const ScrDynClassMember *m = &ecls->members[i];
          if (m->enumerable == 0 || m->enumerable == 3 || m->name[0] == '%' || scr_dyn_member_hidden(m, eo)) continue;
          ScrDyn *mv = m->get(eo); /* +1 */
          if (mv == NULL) {
            ethrew = true;
            break;
          }
          ScrStr *val = scr_insp_dyn(mv, recurse + 1, depth);
          scr_dyn_release(mv);
          InspBuf eb = {0};
          insp_key_into(&eb, m->name, m->len);
          insp_kv(&eb, val);
          scr_str_release(val);
          ScrStr *entry = ib_take(&eb);
          scr_insp_entry(entry, false);
          scr_str_release(entry);
        }
        for (size_t i = 0; eextra != NULL && i < eextra->v.arr.len; i++) {
          ScrDyn *pair = eextra->v.arr.items[i];
          ScrDyn *pk = pair->v.arr.items[0];
          if (pk->v.str->len == 9 && memcmp(pk->v.str->data, "prototype", 9) == 0) continue; /* the minted prototype: non-enumerable */
          ScrStr *val = scr_insp_dyn(pair->v.arr.items[1], recurse + 1, depth);
          InspBuf eb = {0};
          insp_key_into(&eb, pk->v.str->data, pk->v.str->len);
          insp_kv(&eb, val);
          scr_str_release(val);
          ScrStr *entry = ib_take(&eb);
          scr_insp_entry(entry, false);
          scr_str_release(entry);
        }
        if (!ethrew) insp_emit_syms(esyms, recurse, depth);
        scr_dyn_release(esyms);
        scr_dyn_release(eextra);
        ScrStr *eb0 = scr_str_new("{", 1);
        ScrStr *eb1 = scr_str_new("}", 1);
        ScrStr *eout = scr_insp_end(ebase, eb0, eb1, recurse + 1, false, false);
        scr_str_release(ebase);
        scr_str_release(eb0);
        scr_str_release(eb1);
        if (ethrew) {
          scr_str_release(eout);
          return scr_str_new("", 0);
        }
        return eout;
      }
      const ScrDynClass *vcls = scr_dyn_class_of_value(d);
      if (vcls != NULL) {
        ib_cstr(&out, "[class ");
        ib_cstr(&out, vcls->name);
        if (vcls->base != NULL) {
          ib_cstr(&out, " extends ");
          ib_cstr(&out, vcls->base);
        }
        ib_char(&out, ']');
        size_t vshown = 0;
        for (size_t i = 0; i < vcls->nstatics; i++) if (vcls->statics[i].enumerable) vshown++;
        ScrDyn *vsyms = insp_fn_sym_table(d);
        vshown += insp_sym_count(vsyms);
        if (vshown == 0) return insp_sty(ib_take(&out), INSP_STY_SPECIAL);
        if (recurse > depth) {
          scr_dyn_release(vsyms);
          return insp_sty(ib_take(&out), INSP_STY_SPECIAL); /* [class A] is already the depth form */
        }
        ScrStr *vbase = ib_take(&out);
        insp_begin_obj(recurse + 1);
        bool vthrew = false;
        for (size_t i = 0; i < vcls->nstatics && !vthrew; i++) {
          const ScrDynClassMember *m = &vcls->statics[i];
          if (!m->enumerable) continue;
          ScrDyn *mv = m->get(NULL); /* +1 */
          if (mv == NULL) { /* the read threw */
            vthrew = true;
            break;
          }
          ScrStr *val = scr_insp_dyn(mv, recurse + 1, depth);
          scr_dyn_release(mv);
          InspBuf eb = {0};
          insp_key_into(&eb, m->name, m->len);
          insp_kv(&eb, val);
          scr_str_release(val);
          ScrStr *entry = ib_take(&eb);
          scr_insp_entry(entry, false);
          scr_str_release(entry);
        }
        if (!vthrew) insp_emit_syms(vsyms, recurse, depth);
        scr_dyn_release(vsyms);
        ScrStr *vb0 = scr_str_new("{", 1);
        ScrStr *vb1 = scr_str_new("}", 1);
        ScrStr *vout = scr_insp_end(vbase, vb0, vb1, recurse + 1, false, false);
        scr_str_release(vbase);
        scr_str_release(vb0);
        scr_str_release(vb1);
        if (vthrew) {
          scr_str_release(vout);
          return scr_str_new("", 0); /* the pending throw wins */
        }
        return vout;
      }
      /* The kind word (SCR_FNK_*): Node's getFunctionBase prefix. A
       * bound function, an arrow and a method are plain Functions. */
      static const char *const fn_kind_names[4] = {"Function", "AsyncFunction", "GeneratorFunction", "AsyncGeneratorFunction"};
      const unsigned fcode = scr_dyn_fn_code(d);
      const char *kname = fn_kind_names[fcode & 3u];
      /* A bound function's prototype-chain constructor is its target's kind,
       * printed after the base unless it is the plain Function (see
       * SCR_FNK_INH_SHIFT). The same kind names its toStringTag. */
      const unsigned finh = (fcode >> SCR_FNK_INH_SHIFT) & 3u;
      const unsigned ftag = (fcode & 3u) != 0 ? (fcode & 3u) : finh;
      ib_char(&out, '[');
      ib_cstr(&out, kname);
      if (name && name[0]) {
        ib_cstr(&out, ": ");
        ib_cstr(&out, name);
      } else {
        ib_cstr(&out, " (anonymous)");
      }
      ib_char(&out, ']');
      if (finh != 0) {
        ib_char(&out, ' ');
        ib_cstr(&out, fn_kind_names[finh]);
      }
      if (!scr_insp_show_hidden && !INSP_SH) {
        /* The function's own ENUMERABLE properties follow its base in braces, as an object's do
         * (`[Function: g] { listener: [Function: f] }`): the closure's property table minus the built-ins
         * (name, length, prototype are non-enumerable in Node). */
        ScrDyn *table = d->v.fn.clo->props != NULL ? (ScrDyn *)scr_box_get_ref(d->v.fn.clo->props) : NULL; /* +1 */
        size_t nown = 0;
        if (table != NULL && table->kind == SCR_DYN_OBJ) {
          for (size_t i = 0; i < table->v.obj.len; i++) {
            const ScrDynEntry *e = &table->v.obj.entries[i];
            if ((e->key_len == 4 && memcmp(e->key, "name", 4) == 0) || (e->key_len == 6 && memcmp(e->key, "length", 6) == 0) ||
                (e->key_len == 9 && memcmp(e->key, "prototype", 9) == 0)) continue;
            nown++;
          }
        }
        nown += insp_sym_count(table);
        if (nown == 0 || recurse > depth) {
          scr_dyn_release(table);
          return insp_sty(ib_take(&out), INSP_STY_SPECIAL);
        }
        ScrStr *fbase = ib_take(&out);
        insp_begin_obj(recurse + 1);
        size_t *ford = scr_dyn_obj_key_order(table);
        for (size_t oi = 0; oi < table->v.obj.len; oi++) {
          const ScrDynEntry *e = &table->v.obj.entries[ford != NULL ? ford[oi] : oi];
          if ((e->key_len == 4 && memcmp(e->key, "name", 4) == 0) || (e->key_len == 6 && memcmp(e->key, "length", 6) == 0) ||
              (e->key_len == 9 && memcmp(e->key, "prototype", 9) == 0)) continue;
          ScrStr *val = scr_insp_dyn(e->value, recurse + 1, depth);
          InspBuf eb = {0};
          insp_key_into(&eb, e->key, e->key_len);
          insp_kv(&eb, val);
          scr_str_release(val);
          ScrStr *entry = ib_take(&eb);
          scr_insp_entry(entry, false);
          scr_str_release(entry);
        }
        free(ford);
        insp_emit_syms(table, recurse, depth);
        scr_dyn_release(table);
        ScrStr *fb0 = scr_str_new("{", 1);
        ScrStr *fb1 = scr_str_new("}", 1);
        ScrStr *fout = scr_insp_end(fbase, fb0, fb1, recurse + 1, false, false);
        scr_str_release(fbase);
        scr_str_release(fb0);
        scr_str_release(fb1);
        return fout;
      }
#ifdef SCR_INSP_COLORS
      /* showHidden (also %o): Node lists the function's own non-enumerable keys after its base:
       * [length], [name], [prototype] (for a function that has one: an object whose [constructor] points back at the function, the
       * <ref *1> circle), the properties a program added, its own symbols, then the [Symbol(Symbol.toStringTag)] an async or generator
       * kind inherits (formatRaw's protoProps). Built through the ordinary frames, so every layout option applies to it. */
      ScrStr *hbase = ib_take(&out);
      /* Past the depth limit Node answers with the bare constructor name
       * (`[Function]`, `[AsyncFunction]`), not the keys. */
      if (recurse > depth) {
        scr_str_release(hbase);
        InspBuf db = {0};
        ib_char(&db, '[');
        ib_cstr(&db, finh != 0 ? fn_kind_names[finh] : kname);
        ib_char(&db, ']');
        return insp_sty(ib_take(&db), INSP_STY_SPECIAL);
      }
      {
        double cid0 = scr_insp_circ_check(d->v.fn.clo);
        if (cid0 > 0) {
          scr_str_release(hbase);
          return scr_insp_circular(cid0);
        }
      }
      const bool hproto = (fcode & SCR_FNK_NOPROTO) == 0;
      insp_begin_obj(recurse + 1);
      scr_insp_seen_push(d->v.fn.clo);
      {
        InspBuf eb = {0};
        ib_hname(&eb, "length");
        ScrStr *lv = insp_sty(scr_insp_f64((double)scr_dyn_fn_len(d)), INSP_STY_NUMBER);
        insp_kv(&eb, lv);
        scr_str_release(lv);
        ScrStr *e = ib_take(&eb);
        scr_insp_entry(e, true);
        scr_str_release(e);
      }
      {
        InspBuf eb = {0};
        const char *nm = name ? name : "";
        ib_hname(&eb, "name");
        ScrStr *ns = scr_str_new(nm, strlen(nm));
        ScrStr *nv = scr_insp_str(ns);
        scr_str_release(ns);
        insp_kv(&eb, nv);
        scr_str_release(nv);
        ScrStr *e = ib_take(&eb);
        scr_insp_entry(e, false);
        scr_str_release(e);
      }
      if ((fcode & SCR_FNK_SLOPPY) != 0) {
        /* a sloppy-mode ordinary function owns `arguments` and `caller`, both null, between `name` and `prototype` */
        static const char *const sk[2] = {"arguments", "caller"};
        for (int si = 0; si < 2; si++) {
          InspBuf eb = {0};
          ib_hname(&eb, sk[si]);
          ScrStr *nv = insp_sty_lit("null", INSP_STY_NULL);
          insp_kv(&eb, nv);
          scr_str_release(nv);
          ScrStr *e = ib_take(&eb);
          scr_insp_entry(e, false);
          scr_str_release(e);
        }
      }
      if (hproto) {
        ScrStr *pv;
        if (recurse + 1 > depth) {
          pv = insp_sty_lit("[Object]", INSP_STY_SPECIAL);
        } else {
          insp_begin_obj(recurse + 2);
          InspBuf cb = {0};
          ib_hname(&cb, "constructor");
          ScrStr *cv = scr_insp_circular(scr_insp_circ_check(d->v.fn.clo));
          insp_kv(&cb, cv);
          scr_str_release(cv);
          ScrStr *ce = ib_take(&cb);
          scr_insp_entry(ce, false);
          scr_str_release(ce);
          ScrStr *pb = scr_str_new("", 0);
          ScrStr *pb0 = scr_str_new("{", 1);
          ScrStr *pb1 = scr_str_new("}", 1);
          pv = scr_insp_end(pb, pb0, pb1, recurse + 2, false, false);
          scr_str_release(pb);
          scr_str_release(pb0);
          scr_str_release(pb1);
        }
        InspBuf eb = {0};
        ib_hname(&eb, "prototype");
        insp_kv(&eb, pv);
        scr_str_release(pv);
        ScrStr *e = ib_take(&eb);
        scr_insp_entry(e, false);
        scr_str_release(e);
      }
#ifdef SCR_INSP_COLORS
      if (INSP_SH) {
        /* the properties a program added to the function object follow its built-in names, then its own symbols */
        ScrDyn *htable = d->v.fn.clo->props != NULL ? (ScrDyn *)scr_box_get_ref(d->v.fn.clo->props) : NULL; /* +1 */
        if (htable != NULL && htable->kind == SCR_DYN_OBJ) {
          insp_emit_obj_keys(htable, recurse, depth, true);
          insp_emit_syms(htable, recurse, depth);
        }
        scr_dyn_release(htable);
      }
#endif
      if (ftag != 0) {
        /* a protoProps entry: with colors the whole entry is dimmed, its symbol key in the `symbol` style */
        InspBuf eb = {0};
        if (INSP_COLORS_ON) ib_cstr(&eb, "\x1b[2m");
        ib_char(&eb, '[');
        ib_sty_cstr(&eb, "Symbol(Symbol.toStringTag)", INSP_STY_SYMBOL);
        ib_char(&eb, ']');
        ScrStr *tv = scr_str_new(fn_kind_names[ftag], strlen(fn_kind_names[ftag]));
        ScrStr *tq = scr_insp_str(tv);
        scr_str_release(tv);
        insp_kv(&eb, tq);
        scr_str_release(tq);
        if (INSP_COLORS_ON) ib_cstr(&eb, "\x1b[22m");
        ScrStr *e = ib_take(&eb);
        scr_insp_entry(e, false);
        scr_str_release(e);
      }
      ScrStr *hb0 = scr_str_new("{", 1);
      ScrStr *hb1 = scr_str_new("}", 1);
      ScrStr *hout = scr_insp_end(hbase, hb0, hb1, recurse + 1, false, false);
      scr_str_release(hbase);
      scr_str_release(hb0);
      scr_str_release(hb1);
      ScrStr *hwrapped = scr_insp_ref_wrap(d->v.fn.clo, hout); /* <ref *1> when the prototype's constructor circled back */
      scr_str_release(hout);
      return hwrapped;
    }
#else
      /* showHidden (%o): Node lists the function's own non-enumerable keys
       * after its base, one per line when they do not fit:
       * [length], [name], [prototype] (for a function that has one, whose
       * constructor points back at it: the <ref *1> circle), then the
       * [Symbol(Symbol.toStringTag)] of an async or generator kind. */
      ScrStr *hbase = ib_take(&out);
      /* Past the depth limit Node answers with the bare constructor name
       * (`[Function]`, `[AsyncFunction]`), not the keys. */
      if (recurse > depth) {
        scr_str_release(hbase);
        InspBuf db = {0};
        ib_char(&db, '[');
        ib_cstr(&db, finh != 0 ? fn_kind_names[finh] : kname);
        ib_char(&db, ']');
        return insp_sty(ib_take(&db), INSP_STY_SPECIAL);
      }
      const bool hproto = (fcode & SCR_FNK_NOPROTO) == 0;
      scr_insp_begin(recurse + 1);
      {
        char lenbuf[48];
        snprintf(lenbuf, sizeof lenbuf, "[length]: %u", (unsigned)scr_dyn_fn_len(d));
        ScrStr *e = scr_str_new(lenbuf, strlen(lenbuf));
        scr_insp_entry(e, true);
        scr_str_release(e);
      }
      {
        InspBuf eb = {0};
        const char *nm = name ? name : "";
        const char q = strchr(nm, '\'') != NULL && strchr(nm, '"') == NULL ? '"' : '\'';
        ib_cstr(&eb, "[name]: ");
        ib_char(&eb, q);
        ib_cstr(&eb, nm);
        ib_char(&eb, q);
        ScrStr *e = ib_take(&eb);
        scr_insp_entry(e, false);
        scr_str_release(e);
      }
      if (hproto) {
        static const char proto_entry[] = "[prototype]: { [constructor]: [Circular *1] }";
        ScrStr *e = scr_str_new(proto_entry, sizeof proto_entry - 1);
        scr_insp_entry(e, false);
        scr_str_release(e);
      }
      if (ftag != 0) {
        InspBuf eb = {0};
        ib_cstr(&eb, "[Symbol(Symbol.toStringTag)]: '");
        ib_cstr(&eb, fn_kind_names[ftag]);
        ib_char(&eb, '\'');
        ScrStr *e = ib_take(&eb);
        scr_insp_entry(e, false);
        scr_str_release(e);
      }
      ScrStr *hb0 = scr_str_new("{", 1);
      ScrStr *hb1 = scr_str_new("}", 1);
      ScrStr *hout = scr_insp_end(hbase, hb0, hb1, recurse + 1, false, false);
      scr_str_release(hbase);
      scr_str_release(hb0);
      scr_str_release(hb1);
      if (!hproto) return hout;
      InspBuf rb = {0};
      ib_cstr(&rb, "<ref *1> ");
      ib_str(&rb, hout);
      scr_str_release(hout);
      return ib_take(&rb);
    }
#endif
    case SCR_DYN_OBJINST: {
      /* Node prints `Thing { a: 1 }` -- the instance's own ENUMERABLE
       * properties, which the member table now enumerates. It used to
       * fence here for the honest reason that a box with no table cannot
       * tell an empty object from one it cannot read; a class without a
       * complete key set still cannot, and still fences.
       *
       * Enumerable rows only, so this lists exactly what Object.keys
       * lists -- the OBJ arm's rule above, and the reason a class method
       * does not appear: it is non-enumerable in JS, and `console.log(new
       * Box(7))` is `Box { v: 7 }` on v25.9.0, not `Box { v: 7, get:
       * [Function] }`.
       *
       * A GETTER row shows nothing rather than `[Getter]`: a class
       * accessor lives on the PROTOTYPE, where Node does not look for own
       * properties -- and running one at a print would be a side effect
       * the program did not ask for, which is the OBJ arm's stance too. */
      /* formatValue's first step for an object: `value[inspect.custom]`, a function other than util.inspect itself, is called
       * with the receiver as `this`, the depth budget left (ctx.depth - recurse), the options of the active context and
       * inspect, BEFORE the circular and depth answers. A throw propagates; an answer that is the receiver itself falls
       * through to the ordinary formatting. */
      {
        const ScrDynClassMember *cust = scr_dyn_objinst_member(d, "sym.for:nodejs.util.inspect.custom", 34);
        #ifdef SCR_INSP_COLORS
        if (cust != NULL && cust->call != NULL && g_custom_inspect != NULL && !g_opts.no_custom) {
#else
        if (cust != NULL && cust->call != NULL && g_custom_inspect != NULL) {
#endif
          ScrDyn *cargs[3];
          cargs[0] = scr_dyn_new_num(depth - recurse);
          cargs[1] = scr_insp_custom_opts(g_custom_stylize);
          cargs[2] = scr_dyn_retain(g_custom_inspect);
          ScrDyn *cr = cust->call(d->v.inst.o, cargs, 3, "inspect");
          scr_dyn_release(cargs[0]);
          scr_dyn_release(cargs[1]);
          scr_dyn_release(cargs[2]);
          if (cr == NULL) return scr_str_new("", 0); /* the method threw: the pending throw wins */
          if (!(cr->kind == SCR_DYN_OBJINST && cr->v.inst.o == d->v.inst.o)) {
            ScrStr *cs = scr_insp_custom_result(cr, recurse, depth);
            scr_dyn_release(cr);
            return cs;
          }
          scr_dyn_release(cr);
        }
      }
#ifdef SCR_INSP_COLORS
      if (INSP_SH) {
        /* The prototype keys (formatRaw's protoProps) come from the member table's accessor rows; a class that
         * roots in a runtime class (EventEmitter and its own prototype keys), has a prototype this runtime cannot list. */
        const ScrDynClass *sc = scr_dyn_objinst_class_of(d);
        (void)sc; /* a runtime base adds no protoProps beyond what the instance already owns (EventEmitter's keys are own on the instance) */
      }
#endif
      const char *icn = scr_dyn_objinst_cls(d);
      /* The class that applyMixin(Y, EventEmitter) grafted onto (rt_root 7) has had its own `constructor` overwritten by
       * EventEmitter's, and util.inspect skips a constructor the instance is not an instance of: it names the first
       * ancestor that still has its own (the immediate base), or prints no prefix when the chain reaches Object. */
      if (scr_dyn_objinst_class_of(d)->rt_root == 7 || scr_dyn_objinst_class_of(d)->rt_root == 8) {
        const char *bn = scr_dyn_objinst_class_of(d)->base;
        icn = bn != NULL ? bn : "";
      }
      ScrDyn *isnap = NULL;
      if (!scr_dyn_objinst_enumerable(d)) {
        bool iunsup = false;
        isnap = scr_dyn_objinst_snapshot(d, &iunsup);
        if (isnap == NULL) {
          if (!iunsup) return scr_str_new("", 0); /* a read threw: the pending throw wins */
          InspBuf out = {0};
          ib_cstr(&out, "util.inspect of a dynamic ");
          ib_cstr(&out, icn);
          ib_cstr(&out, " is not supported yet");
          scr_throw_error(SCR_ERR_ERROR, ib_take(&out));
          return scr_str_new("", 0); /* the pending throw wins */
        }
      }
      /* Node's circular check comes first, before the empty and depth answers: an instance that is an ancestor on the
       * stack renders [Circular *N] and the ancestor gets <ref *N>. Keyed by the INSTANCE, so two boxes of one object
       * are one value. */
      {
        double cid = scr_insp_circ_check(d->v.inst.o);
        if (cid > 0) {
          if (isnap != NULL) scr_dyn_release(isnap);
          return scr_insp_circular(cid);
        }
      }
      const size_t inm = scr_dyn_objinst_member_count(d);
      size_t ishown = 0;
      for (size_t i = 0; i < inm && isnap == NULL; i++) {
        const ScrDynClassMember *m = scr_dyn_objinst_member_at(d, i);
        if (!scr_dyn_member_hidden(m, d->v.inst.o)) ishown++;
      }
      if (isnap != NULL) ishown = isnap->v.obj.len;
      /* the instance's symbol-keyed own properties live in its run-time property table (scr_symbol.c) */
      ScrDyn *isbag = insp_inst_sym_bag(d);
      ishown += insp_sym_count(isbag);
#ifdef SCR_INSP_COLORS
      if (INSP_SH && recurse <= depth) ishown += insp_proto_acc_count(d); /* protoProps exist only while the depth budget lasts */
#endif
      if (ishown == 0) {
        scr_dyn_release(isbag);
        if (isnap != NULL) scr_dyn_release(isnap);
        InspBuf nb = {0};
        ib_cstr(&nb, icn);
        ib_cstr(&nb, icn[0] != '\0' ? " {}" : "{}");
        return ib_take(&nb);
      }
      if (recurse > depth) {
        if (isnap != NULL) scr_dyn_release(isnap);
        scr_dyn_release(isbag);
        InspBuf nb = {0};
        ib_char(&nb, '[');
        ib_cstr(&nb, icn[0] != '\0' ? icn : "Object");
        ib_char(&nb, ']');
        return insp_sty(ib_take(&nb), INSP_STY_SPECIAL);
      }
      insp_begin_obj(recurse + 1);
      scr_insp_seen_push(d->v.inst.o);
      bool ithrew = false;
      if (isnap != NULL) {
        size_t *iord = scr_dyn_obj_key_order(isnap);
        for (size_t oi = 0; oi < isnap->v.obj.len; oi++) {
          const ScrDynEntry *e = &isnap->v.obj.entries[iord != NULL ? iord[oi] : oi];
          ScrStr *val = scr_insp_dyn(e->value, recurse + 1, depth);
          InspBuf eb = {0};
          insp_key_into(&eb, e->key, e->key_len);
          insp_kv(&eb, val);
          scr_str_release(val);
          ScrStr *entry = ib_take(&eb);
          scr_insp_entry(entry, false);
          scr_str_release(entry);
        }
        free(iord);
        scr_dyn_release(isnap);
        isnap = NULL;
      }
      for (size_t i = 0; i < inm && !ithrew && isnap == NULL && !scr_dyn_objinst_has_props(d); i++) {
        const ScrDynClassMember *m = scr_dyn_objinst_member_at(d, i);
        if (scr_dyn_member_hidden(m, d->v.inst.o)) continue;
        ScrDyn *mv = m->get(d->v.inst.o); /* +1 */
        if (mv == NULL) { /* the read threw */
          ithrew = true;
          break;
        }
        ScrStr *val = scr_insp_dyn(mv, recurse + 1, depth);
        scr_dyn_release(mv);
        InspBuf eb = {0};
        insp_key_into(&eb, m->name, m->len);
        insp_kv(&eb, val);
        scr_str_release(val);
        ScrStr *entry = ib_take(&eb);
        scr_insp_entry(entry, false);
        scr_str_release(entry);
      }
      if (!ithrew && (scr_dyn_objinst_class_of(d)->rt_root == 5 || scr_dyn_objinst_class_of(d)->rt_root == 7 || scr_dyn_objinst_class_of(d)->rt_root == 8 || scr_dyn_objinst_class_of(d)->rt_root == 6)) {
        /* A grafted emitter's constructor (EventEmitter.call(this)) also defines the own enumerable SYMBOL keys
         * shapeMode and kCapture (both false), after every string key; util.inspect lists them once the emitter's
         * keys are born. */
        const ScrDynClassMember *cm = scr_dyn_objinst_member(d, "_eventsCount", 12);
        if (cm != NULL && !scr_dyn_member_hidden(cm, d->v.inst.o)) {
          /* Node prints the two own enumerable symbol keys as `Symbol(shapeMode): false`: the symbol text in the `symbol` style, the value as a boolean. */
          InspBuf e1b = {0};
          ib_sty_cstr(&e1b, "Symbol(shapeMode)", INSP_STY_SYMBOL);
          ib_cstr(&e1b, ": ");
          ib_sty_cstr(&e1b, "false", INSP_STY_BOOLEAN);
          ScrStr *e1 = ib_take(&e1b);
          scr_insp_entry(e1, false);
          scr_str_release(e1);
          InspBuf e2b = {0};
          ib_sty_cstr(&e2b, "Symbol(kCapture)", INSP_STY_SYMBOL);
          ib_cstr(&e2b, ": ");
          ib_sty_cstr(&e2b, "false", INSP_STY_BOOLEAN);
          ScrStr *e2 = ib_take(&e2b);
          scr_insp_entry(e2, false);
          scr_str_release(e2);
        }
      }
      if (!ithrew && isbag != NULL) insp_emit_syms(isbag, recurse, depth);
#ifdef SCR_INSP_COLORS
      if (!ithrew && INSP_SH) insp_emit_proto_acc(d, recurse, depth);
#endif
      scr_dyn_release(isbag);
      /* The constructor name belongs to braces[0] (Node's `P {`), the empty base keeps reduceToSingleString's budget and compact: true's layout exact. */
      ScrStr *ibase = scr_str_new("", 0);
      InspBuf ib0b = {0};
      if (icn[0] != '\0') {
        ib_cstr(&ib0b, icn);
        ib_char(&ib0b, ' ');
      }
      ib_char(&ib0b, '{');
      ScrStr *ib0 = ib_take(&ib0b);
      ScrStr *ib1 = scr_str_new("}", 1);
      /* scr_insp_end runs even on the throw path: the frame was pushed by
       * scr_insp_begin and leaving it on the stack would corrupt every
       * later print in the process, which is a worse failure than the one
       * being reported. */
      ScrStr *iout = scr_insp_end(ibase, ib0, ib1, recurse + 1, false, false);
      scr_str_release(ibase);
      scr_str_release(ib0);
      scr_str_release(ib1);
      ScrStr *iwrapped = scr_insp_ref_wrap(d->v.inst.o, iout); /* <ref *N> when this instance was a circle's target */
      scr_str_release(iout);
      if (ithrew) {
        scr_str_release(iwrapped);
        return scr_str_new("", 0); /* the pending throw wins */
      }
      return iwrapped;
    }
    case SCR_DYN_PROXY: {
      /* formatValue: a revoked Proxy is `<Revoked Proxy>` whatever showProxy says. */
      if (d->v.proxy.revoked) return insp_sty_lit("<Revoked Proxy>", INSP_STY_SPECIAL);
#ifdef SCR_INSP_COLORS
      if (g_opts.show_proxy) {
        /* formatProxy: `Proxy [ <target>, <handler> ]`, a two-entry array frame (kArrayExtrasType) one level deeper. It does not
         * set ctx.currentDepth (the last composite entered keeps it), which the single-line test then reads. */
        if (recurse > depth) return insp_sty_lit("Proxy [Array]", INSP_STY_SPECIAL);
        const double saved_depth = g_cur_depth;
        scr_insp_begin(recurse + 1);
        g_cur_depth = saved_depth;
        ScrStr *ts = scr_insp_dyn(d->v.proxy.target, recurse + 1, depth);
        scr_insp_entry(ts, false);
        scr_str_release(ts);
        ScrStr *hs = scr_insp_dyn(d->v.proxy.handler, recurse + 1, depth);
        scr_insp_entry(hs, false);
        scr_str_release(hs);
        ScrStr *pbase = scr_str_new("", 0);
        ScrStr *pb0 = scr_str_new("Proxy [", 7);
        ScrStr *pb1 = scr_str_new("]", 1);
        ScrStr *pout = scr_insp_end(pbase, pb0, pb1, recurse + 1, true, false);
        scr_str_release(pbase);
        scr_str_release(pb0);
        scr_str_release(pb1);
        return pout;
      }
#endif
      /* util.inspect (showProxy false) prints the TARGET, running no trap. */
      return scr_insp_dyn(d->v.proxy.target, recurse, depth);
    }
    case SCR_DYN_MAP: {
      /* A dyn-flavored Map/Set (untyped JS's `new Map()`) holds dyn boxes
       * for every key and value, so its entries render by the same walk an
       * array's items do: `Map(1) { 'a' => 1 }`, `Set(1) { 'a' }`, the
       * empty `Map(0) {}`, and `[Map]` / `[Set]` past the depth limit. */
      if (scr_dyn_is_dynmap(d)) {
        ScrMap *dm = d->v.map.m;
        const int dm_flavor = scr_dyn_map_flavor(d);
        const bool dm_set = dm_flavor == 1 || dm_flavor == 3;
        const char *cls = scr_dyn_map_cls(d);
        if (dm_flavor >= 2 && !INSP_SH) {
          /* Node cannot enumerate a weak collection: `WeakMap { <items unknown> }`. */
          InspBuf wb = {0};
          ib_cstr(&wb, cls);
          ib_cstr(&wb, " { ");
          ib_sty_cstr(&wb, "<items unknown>", INSP_STY_SPECIAL);
          ib_cstr(&wb, " }");
          return ib_take(&wb);
        }
        size_t n = (size_t)scr_map_size(dm);
        InspBuf hb = {0};
#ifdef SCR_SYMTAB
        const ScrDynSymTab *dmsyms = scr_map_symx_table(dm); /* symbol-keyed expandos print after the entries */
#else
        const ScrDynSymTab *dmsyms = NULL;
#endif
        const size_t dmsymn = insp_sym_count_t(dmsyms);
        if (n == 0 && dmsymn == 0) {
          ib_cstr(&hb, cls);
          /* showHidden lists a weak collection's entries; with none, formatRaw joins an empty output between the braces: `WeakMap {  }` */
          ib_cstr(&hb, dm_flavor >= 2 ? " {  }" : "(0) {}");
          return ib_take(&hb);
        }
        if (recurse > depth) {
          ib_char(&hb, '[');
          ib_cstr(&hb, cls);
          ib_char(&hb, ']');
          return insp_sty(ib_take(&hb), INSP_STY_SPECIAL);
        }
        scr_insp_begin(recurse + 1);
        size_t shown = 0;
        for (double i = 0; i < scr_map_iter_count(dm) && (double)shown < insp_cap((double)n); i++) {
          if (!scr_map_iter_live(dm, i)) continue;
          ScrDyn *k = scr_dyn_map_key_at(d, i);
          ScrStr *ks = scr_insp_dyn(k, recurse + 1, depth);
          InspBuf eb = {0};
          ib_bytes(&eb, ks->data, ks->len);
          scr_str_release(ks);
          if (!dm_set) {
            ScrDyn *v = scr_dyn_map_val_at(d, i);
            ScrStr *vs = scr_insp_dyn(v, recurse + 1, depth);
            ib_cstr(&eb, " => ");
            ib_bytes(&eb, vs->data, vs->len);
            scr_str_release(vs);
            scr_dyn_release(v);
          }
          scr_dyn_release(k);
          ScrStr *entry = ib_take(&eb);
          scr_insp_entry(entry, false);
          scr_str_release(entry);
          shown++;
        }
        bool more = insp_more(n);
        if (more) {
          ScrStr *m = scr_insp_more_items(insp_rem(n));
          scr_insp_entry(m, false);
          scr_str_release(m);
        }
        insp_emit_symtab(dmsyms, recurse, depth);
        ib_cstr(&hb, cls);
        if (dm_flavor < 2) {
          ib_char(&hb, '(');
          char nb[32];
          snprintf(nb, sizeof nb, "%zu", n);
          ib_cstr(&hb, nb);
          ib_char(&hb, ')');
        }
        ib_cstr(&hb, " {");
        ScrStr *base = scr_str_new("", 0);
        ScrStr *b0 = ib_take(&hb);
        ScrStr *b1 = scr_str_new("}", 1);
        ScrStr *out = scr_insp_end(base, b0, b1, recurse + 1, false, false);
        scr_str_release(base);
        scr_str_release(b0);
        scr_str_release(b1);
        return out;
      }
      /* Node prints `Map(1) { 'a' => 1 }` / `Set(1) { 'a' }` — the
       * ENTRIES, rendered by their own types. The box carries the
       * interned typeKey, not a per-element renderer, so it cannot walk
       * them; `Map(0) {}` would be a confident wrong count and a
       * confident wrong body. Fence loudly, the OBJINST arm's reason
       * exactly. (Contrast the ARRBUF arm below, which renders because an
       * ArrayBuffer's contents ARE bytes this tier already models.) */
      InspBuf out = {0};
      ib_cstr(&out, "util.inspect of a dynamic ");
      ib_cstr(&out, scr_dyn_map_cls(d));
      ib_cstr(&out, " is not supported yet");
      scr_throw_error(SCR_ERR_ERROR, ib_take(&out));
      return scr_str_new("", 0); /* the pending throw wins */
    }
    case SCR_DYN_HANDLE: {
      /* A Symbol is a primitive: util.inspect prints its descriptive string,
       * `Symbol(desc)`, bare (no quotes, unlike a string). */
      if (scr_dyn_is_symbol(d)) return insp_sty(scr_dyn_symbol_descriptive(d), INSP_STY_SYMBOL);
      if (d->v.handle.tag == SCR_DYNH_DATE) {
        /* A Date renders as its ISO form (Invalid Date when NaN). Asked
         * through the handle's toJSON so this unit names no Date entry
         * point: a string answer is the ISO text, null is an invalid Date. */
        const ScrDynHandleOps *ops = scr_dyn_handle_ops_of(d);
        ScrDyn *j = ops->invoke(d->v.handle.ptr, (ScrDyn *)d, "toJSON", NULL, 0, "toJSON");
        if (j == NULL) return scr_str_new("", 0); /* the pending throw wins */
        InspBuf out = {0};
        if (j->kind == SCR_DYN_STR) ib_bytes(&out, j->v.str->data, j->v.str->len);
        else ib_cstr(&out, "Invalid Date");
        scr_dyn_release(j);
        /* Own expandos follow the text as one more object, `2000-01-01T00:00:00.000Z { usec: 7 }`. */
        ScrDyn *own = ops->own_props != NULL ? ops->own_props(d->v.handle.ptr) : NULL;
        ScrStr *iso = ib_take(&out);
        if (own == NULL || own->kind != SCR_DYN_OBJ) return insp_sty(iso, INSP_STY_DATE);
        ScrStr *with = insp_with_base(iso, own, recurse, depth, -1.0);
        scr_str_release(iso);
        return with;
      }
      if (d->v.handle.tag == SCR_DYNH_REGEX) {
        /* A RegExp (immutable pattern + flags) renders as RegExp.prototype.toString, whole value in the `regexp` style. */
#ifdef SCR_INSP_COLORS
        if (INSP_SH) {
          /* showHidden: every regex has the non-enumerable own `lastIndex`, so the text becomes the BASE (unstyled, as formatRaw leaves it)
           * of `/re/g { [lastIndex]: 0 }`; past the depth limit the plain styled text answers. */
          ScrStr *rtext = scr_insp_regex((ScrRegex *)d->v.handle.ptr);
          if (recurse > depth) return insp_sty(rtext, INSP_STY_REGEXP);
          insp_begin_obj(recurse + 1);
          InspBuf lb = {0};
          ib_hname(&lb, "lastIndex");
          ScrStr *lv = insp_sty(scr_insp_f64(((ScrRegex *)d->v.handle.ptr)->last_index), INSP_STY_NUMBER);
          insp_kv(&lb, lv);
          scr_str_release(lv);
          ScrStr *le = ib_take(&lb);
          scr_insp_entry(le, false);
          scr_str_release(le);
          ScrStr *rb0 = scr_str_new("{", 1);
          ScrStr *rb1 = scr_str_new("}", 1);
          ScrStr *rout = scr_insp_end(rtext, rb0, rb1, recurse + 1, false, false);
          scr_str_release(rtext);
          scr_str_release(rb0);
          scr_str_release(rb1);
          return rout;
        }
#endif
        return insp_sty(scr_insp_regex((ScrRegex *)d->v.handle.ptr), INSP_STY_REGEXP);
      }
      if (d->v.handle.tag == SCR_DYNH_TEXTCODEC) {
        /* Node's TextDecoder / TextEncoder [util.inspect.custom]: the decoder
         * prints `TextDecoder { encoding, fatal, ignoreBOM }` and the encoder
         * prints its own `{ encoding }` with no class prefix (measured on
         * Node 24.15). The flags are the handle's own: the get hook answers
         * fatal/ignoreBOM for a decoder and NULL for an encoder. */
        const ScrDynHandleOps *ops = scr_dyn_handle_ops_of(d);
        ScrDyn *obj = scr_dyn_new_obj();
        ScrDyn *enc = ops->get(d->v.handle.ptr, "encoding", 8);
        if (enc != NULL) scr_dyn_obj_set_lit(obj, "encoding", 8, enc);
        ScrDyn *fat = ops->get(d->v.handle.ptr, "fatal", 5);
        ScrStr *base = scr_str_new("", 0);
        if (fat != NULL) {
          scr_dyn_obj_set_lit(obj, "fatal", 5, fat);
          ScrDyn *ign = ops->get(d->v.handle.ptr, "ignoreBOM", 9);
          if (ign != NULL) scr_dyn_obj_set_lit(obj, "ignoreBOM", 9, ign);
          scr_str_release(base);
          base = scr_str_new("TextDecoder", 11);
        }
        ScrStr *with = insp_with_base(base, obj, recurse, depth, -1.0);
        scr_str_release(base);
        scr_dyn_release(obj);
        return with;
      }
      if (d->v.handle.tag == SCR_DYNH_STATS) {
        /* A Stats prints `Stats { ...its enumerable own members... }` (Node's
         * class-name prefix): the members object is exactly those members. */
        const ScrDynHandleOps *ops = scr_dyn_handle_ops_of(d);
        ScrDyn *own = ops->own_props != NULL ? ops->own_props(d->v.handle.ptr) : NULL;
        ScrStr *base = scr_str_new("Stats", 5);
        ScrStr *with = own != NULL && own->kind == SCR_DYN_OBJ ? insp_with_base(base, own, recurse, depth, -1.0) : NULL;
        scr_str_release(base);
        if (with != NULL) return with;
      }
      /* Node prints the class's full property dump (ServerResponse {
       * ... }) — internals we do not model. Fence loudly instead of a
       * silent-wrong shape (SEMANTICS.md). */
      InspBuf out = {0};
      ib_cstr(&out, "util.inspect of a dynamic ");
      ib_cstr(&out, scr_dyn_handle_cls(d));
      ib_cstr(&out, " is not supported yet");
      scr_throw_error(SCR_ERR_ERROR, ib_take(&out));
      return scr_str_new("", 0);
    }
    case SCR_DYN_JSVAL: {
      /* An island value inside the checked-dynamic tree: Node prints the engine object's
       * property dump — fence loudly, naming the engine typeof (the
       * scr_insp_jsval wording for bare 'any' composites). */
      ScrStr *t = scr_dyn_typeof(d); /* routes to the engine; +1 */
      InspBuf out = {0};
      ib_cstr(&out, "util.inspect of a composite 'any' value (typeof '");
      ib_bytes(&out, t->data, t->len);
      ib_cstr(&out, "') is not supported yet");
      scr_str_release(t);
      scr_throw_error(SCR_ERR_ERROR, ib_take(&out));
      return scr_str_new("", 0);
    }
    case SCR_DYN_PROMISE: {
      /* Node renders Promise { <pending> } / Promise { value } — the
       * settled-value rendering pulls in the whole inspector; fence
       * loudly instead of a silent-wrong shape (the handle stance). */
      InspBuf out = {0};
      ib_cstr(&out, "util.inspect of a promise value is not supported yet");
      scr_throw_error(SCR_ERR_ERROR, ib_take(&out));
      return scr_str_new("", 0);
    }
    case SCR_DYN_BIG: {
      /* util.inspect(5n) is `5n` — the digits WITH the suffix, where
       * String(5n) drops it. Rendered rather than fenced for the ARRBUF
       * arm's reason and more strongly: a bigint has no own properties
       * at all, so there is nothing this tier fails to model. */
      ScrStr *s = scr_dyn_big_ops()->to_str(d->v.big, 10);
      InspBuf out = {0};
      ib_bytes(&out, s->data, s->len);
      ib_char(&out, 'n');
      scr_str_release(s);
      return insp_sty(ib_take(&out), INSP_STY_BIGINT);
    }
    case SCR_DYN_ARRBUF: {
      /* Node's real form, RENDERED rather than fenced — and it can be,
       * because unlike a handle or an instance an ArrayBuffer has no own
       * properties this tier fails to model. Two bracketed pseudo-keys
       * over the standard entry machinery, so the 80-column wrap and the
       * depth elision come out identical to every other composite:
       *
       *   ArrayBuffer { [Uint8Contents]: <01 02>, [byteLength]: 2 }
       *
       * The byte cap is maxArrayLength (100), not INSPECT_MAX_BYTES (50
       * — the Buffer custom inspector's), measured against v25.9.0. */
      ScrBytes *b = d->v.bytes;
      if (recurse > depth) return insp_sty_lit("[ArrayBuffer]", INSP_STY_SPECIAL);
      scr_insp_begin(recurse + 1);
      {
        InspBuf hex = {0};
        ib_cstr(&hex, "[Uint8Contents]: <");
        size_t shown = insp_shown(b->len);
        for (size_t i = 0; i < shown; i++) {
          char h[4];
          snprintf(h, sizeof h, "%02x", ((const unsigned char *)b->data)[i]);
          if (i) ib_char(&hex, ' ');
          ib_bytes(&hex, h, 2);
        }
        if (insp_more(b->len)) {
          char num[40];
          size_t nn = scr_f64_to_str(insp_rem(b->len), num);
          ib_cstr(&hex, " ... ");
          ib_bytes(&hex, num, nn);
          ib_cstr(&hex, insp_rem(b->len) > 1 ? " more bytes" : " more byte");
        }
        ib_char(&hex, '>');
        ScrStr *e = ib_take(&hex);
        scr_insp_entry(e, false);
        scr_str_release(e);
      }
      {
        char bl[48];
        int n = snprintf(bl, sizeof bl, "[byteLength]: %zu", b->len);
        ScrStr *e = scr_str_new(bl, (size_t)n);
        scr_insp_entry(e, false);
        scr_str_release(e);
      }
      /* The constructor prefix goes in braces[0], NOT in `base`, and the
       * distinction is load-bearing rather than stylistic: reduceToSingleString
       * computes its wrap budget as
       * `output.length + indent + braces[0].length + base.length + 10`,
       * and Node builds `braces[0] = "ArrayBuffer {"` with an empty base
       * for this shape. Splitting it the other way (base "ArrayBuffer",
       * braces[0] "{") renders the same text but budgets one character
       * more, which flips the line break for a buffer that lands exactly
       * on 80 columns. Measured: 4 bytes stay on one line, 8 bytes wrap.
       * (The ERROR path really does use `base` — there Node's base is the
       * bracket form and braces[0] is a bare "{".) */
      ScrStr *base = scr_str_new("", 0);
      ScrStr *b0 = scr_str_new("ArrayBuffer {", 13);
      ScrStr *b1 = scr_str_new("}", 1);
      ScrStr *out = scr_insp_end(base, b0, b1, recurse + 1, false, false);
      scr_str_release(base);
      scr_str_release(b0);
      scr_str_release(b1);
      return out;
    }
    case SCR_DYN_BYTES: {
      ScrBytes *b = d->v.bytes;
      if (d->buffer) {
        /* Buffer-flavored (a stream chunk): Node's <Buffer ..> form. */
        return scr_insp_buffer(b);
      }
      /* The view's own element type names it and sizes its elements (a Float64Array boxed into the tree is still a Float64Array). */
      static const struct { int elem; const char *name; unsigned size; } vk[] = {
        {SCR_BYTES_U8, "Uint8Array", 1}, {SCR_BYTES_U32, "Uint32Array", 4}, {SCR_BYTES_F32, "Float32Array", 4}, {SCR_BYTES_I32, "Int32Array", 4},
        {SCR_BYTES_F64, "Float64Array", 8}, {SCR_BYTES_I8, "Int8Array", 1}, {SCR_BYTES_I16, "Int16Array", 2}, {SCR_BYTES_U16, "Uint16Array", 2},
        {SCR_BYTES_U8C, "Uint8ClampedArray", 1}, {SCR_BYTES_F16, "Float16Array", 2}, {SCR_BYTES_I64, "BigInt64Array", 8}, {SCR_BYTES_U64, "BigUint64Array", 8}};
      const char *vname = "Uint8Array";
      unsigned vsize = 1;
      for (size_t vi = 0; vi < sizeof vk / sizeof vk[0]; vi++) {
        if ((int)b->elem == vk[vi].elem) {
          vname = vk[vi].name;
          vsize = vk[vi].size;
        }
      }
      const bool vplain = b->elem == SCR_BYTES_U8;
      const bool vbig = b->elem == SCR_BYTES_I64 || b->elem == SCR_BYTES_U64;
      char prefix[64];
      int pn = snprintf(prefix, sizeof prefix, "%s(%zu) [", vname, b->len);
#ifdef SCR_SYMTAB
      const ScrDynSymTab *ust = b->own != NULL ? b->own->ext.syms : NULL;
#else
      const ScrDynSymTab *ust = NULL;
#endif
      const size_t unsym = insp_sym_count_t(ust);
      if (b->len == 0 && unsym == 0 && !INSP_SH) {
        InspBuf out = {0};
        ib_bytes(&out, prefix, (size_t)pn);
        ib_char(&out, ']');
        return ib_take(&out);
      }
      if (recurse > depth) {
        InspBuf db = {0};
        ib_char(&db, '[');
        ib_cstr(&db, vname);
        ib_char(&db, ']');
        return insp_sty(ib_take(&db), INSP_STY_SPECIAL);
      }
      scr_insp_begin(recurse + 1);
      size_t shown = insp_shown(b->len);
      for (size_t i = 0; i < shown; i++) {
        ScrStr *s;
        if (vbig) {
          /* a BigInt64Array / BigUint64Array element: the 8 bytes read as a signed or unsigned integer, then `123n` (formatBigInt, with numericSeparator) */
          char dg[40];
          int dn;
          if (b->elem == SCR_BYTES_I64) {
            int64_t iv;
            memcpy(&iv, b->data + i * 8, 8);
            dn = snprintf(dg, sizeof dg, "%lld", (long long)iv);
          } else {
            uint64_t uv;
            memcpy(&uv, b->data + i * 8, 8);
            dn = snprintf(dg, sizeof dg, "%llu", (unsigned long long)uv);
          }
          InspBuf nb = {0};
          if (g_opts.numeric_sep) insp_add_sep(&nb, dg, (size_t)dn);
          else ib_bytes(&nb, dg, (size_t)dn);
          ib_char(&nb, 'n');
          s = insp_sty(ib_take(&nb), INSP_STY_BIGINT);
        } else {
          s = insp_sty(scr_insp_f64(vplain ? (double)((const unsigned char *)b->data)[i] : scr_bytes_get(b, (double)i)), INSP_STY_NUMBER);
        }
        scr_insp_entry(s, true);
        scr_str_release(s);
      }
      bool more = insp_more(b->len);
      if (more) {
        ScrStr *m = scr_insp_more_items(insp_rem(b->len));
        scr_insp_entry(m, true);
        scr_str_release(m);
      }
#ifdef SCR_INSP_COLORS
      if (INSP_SH) {
        /* formatRaw's extraKeys for a typed array under showHidden: the five non-own accessors, `buffer` last as a bare
         * `ArrayBuffer { [byteLength]: N }` (the underlying buffer's size, not the view's). */
        const size_t boff = b->backing != NULL ? (size_t)(b->data - b->backing->data) : 0;
        unsigned osz = 1;
        if (b->backing != NULL) {
          for (size_t vi = 0; vi < sizeof vk / sizeof vk[0]; vi++) if ((int)b->backing->elem == vk[vi].elem) osz = vk[vi].size;
        }
        const size_t btot = b->backing != NULL ? b->backing->len * osz : b->len * vsize;
        const double xv[4] = {(double)vsize, (double)b->len, (double)(b->len * vsize), (double)boff};
        static const char *const xn[4] = {"[BYTES_PER_ELEMENT]", "[length]", "[byteLength]", "[byteOffset]"};
        /* Node's grid order reads `typeof value[i]` at each entry position: the typed array's own elements are numbers */
        size_t xp = shown + (more ? 1 : 0);
        for (int xi = 0; xi < 4; xi++) {
          InspBuf xb = {0};
          ib_sty_cstr(&xb, xn[xi], INSP_STY_STRING); /* formatExtraProperties styles the bracketed name as a string */
          ScrStr *xs = insp_sty(scr_insp_f64(xv[xi]), INSP_STY_NUMBER);
          insp_kv(&xb, xs);
          scr_str_release(xs);
          ScrStr *xe = ib_take(&xb);
          scr_insp_entry(xe, xp < b->len);
          xp++;
          scr_str_release(xe);
        }
        InspBuf bb = {0};
        ib_sty_cstr(&bb, "[buffer]", INSP_STY_STRING);
        ib_cstr(&bb, ": ArrayBuffer { [byteLength]: ");
        ScrStr *bl = insp_sty(scr_insp_f64((double)btot), INSP_STY_NUMBER);
        ib_str(&bb, bl);
        scr_str_release(bl);
        ib_cstr(&bb, " }");
        ScrStr *be = ib_take(&bb);
        scr_insp_entry(be, xp < b->len);
        scr_str_release(be);
      }
#endif
      insp_emit_symtab(ust, recurse, depth);
      ScrStr *base = scr_str_new("", 0);
      ScrStr *b0 = scr_str_new(prefix, (size_t)pn);
      ScrStr *b1 = scr_str_new("]", 1);
      g_sort_tail = unsym;
      ScrStr *out = scr_insp_end(base, b0, b1, recurse + 1, true, INSP_SH ? insp_over_cap(shown + (more ? 1 : 0) + 5 + unsym) : more);
      scr_str_release(base);
      scr_str_release(b0);
      scr_str_release(b1);
      return out;
    }
  }
  return scr_str_new("undefined", 9); /* unreachable */
}

/* A format argument's REST-ARG conversion over a dyn value: strings pass
 * VERBATIM (Node's `typeof arg === 'string' ? arg : inspect(arg)`);
 * everything else inspects at the given depth (0 for a %s position, 2
 * for a trailing argument). Never throws — this is the conversion
 * console.log gives its non-format arguments, and Node's console.log
 * never runs a user toString. */
ScrStr *scr_insp_dyn_s(ScrDyn *d, double depth) {
  if (d->kind == SCR_DYN_STR) return scr_str_retain(d->v.str);
  return scr_insp_dyn(d, 0, depth);
}

/* util.format's %o: util.inspect with showHidden. Only function values
 * render their hidden keys here (the DYN_FUNC arm reads the flag); the
 * compiler lowers %o over an array or a typed value through the other
 * paths. The flag is saved and restored, so a nested %o cannot leak it. */
ScrStr *scr_insp_dyn_h(ScrDyn *d, double depth) {
  const bool saved = scr_insp_show_hidden;
  scr_insp_show_hidden = true;
#ifdef SCR_INSP_COLORS
  const InspOpts saved_o = g_opts;
  g_opts.show_hidden = true;
  g_opts.show_proxy = true;
  g_opts.depth = depth;
#endif
  ScrStr *r = d->kind == SCR_DYN_STR ? scr_str_retain(d->v.str) : scr_insp_dyn(d, 0, depth);
#ifdef SCR_INSP_COLORS
  g_opts = saved_o;
#endif
  scr_insp_show_hidden = saved;
  return r;
}

/* util.format's %s conversion, which is NOT the rest-arg conversion
 * above. Node's formatter (lib/internal/util/inspect.js):
 *
 *     typeof arg !== 'object' || arg === null || !hasBuiltInToString(arg)
 *       ? String(arg)
 *       : inspect(arg, ...)
 *
 * so an object whose `toString` is its own — rather than one it
 * inherited from a built-in prototype — is CONVERTED, not inspected.
 * Measured, Node v25.9.0:
 *
 *     util.format("%s", {toString(){return "USER"}})  ->  "USER"
 *     util.format("%s", {a: 1})                       ->  "{ a: 1 }"
 *     console.log(     {toString(){return "USER"}})   ->  "{ toString: … }"
 *
 * The third line is why this cannot simply become scr_insp_dyn_s's
 * behaviour: the same runtime call served both, and console.log's
 * arguments must keep inspecting.
 *
 * The dyn tree models no built-in prototypes, so any `toString` found on
 * an OBJ's own members or its prototype chain is by construction a user
 * one and hasBuiltInToString is false for it. Every other kind — arrays,
 * dates, regexps, errors, buffers — inherits its toString from a
 * built-in and inspects, which is what the fall-through already does.
 *
 * MAY THROW: the user toString is user code (scr_dyn_to_string leaves
 * the exception pending and answers the empty dummy, and this libCall
 * is in MAY_THROW_LIB_FNS so the call site checks). */
ScrStr *scr_insp_fmt_s(ScrDyn *d, double depth) {
  if (d->kind == SCR_DYN_STR) return scr_str_retain(d->v.str);
  if (d->kind == SCR_DYN_OBJ) {
    const ScrDyn *m = scr_dyn_obj_own_data(d, "toString", 8);
    if (m == NULL) m = scr_dyn_proto_get(d, "toString", 8);
    if (m != NULL && m->kind == SCR_DYN_FUNC) return scr_dyn_to_string(d, NULL);
  }
  if (d->kind == SCR_DYN_OBJINST && scr_dyn_class_ops != NULL) {
    /* A class instance whose toString is user code (a method, or a function-valued
     * field): the same hasBuiltInToString test, answered by the class unit. The
     * conversion is String(arg), not inspect. A class with no user toString
     * inspects, exactly as before. */
    int user = scr_dyn_class_ops->objinst_user_tostring(d);
    if (user == 2) return scr_str_new("", 0); /* the field read threw: pending */
    if (user == 1) return scr_dyn_to_string(d, NULL);
  }
  return scr_insp_dyn(d, 0, depth);
}

/* console.log(...args) where `args` is the checked-dynamic rest array:
 * the spread's arity is a RUNTIME length, so the space-join happens here
 * rather than at the call site. Each element goes through scr_insp_dyn_s
 * at the rest-arg depth (2) — the SAME per-argument conversion the
 * fixed-arity form lowers to, so the two renderings cannot drift apart.
 * Borrows arr; returns +1. */
ScrStr *scr_insp_dyn_spread(ScrDyn *arr) {
  ScrStr *out = scr_str_new("", 0);
  ScrStr *sep = scr_str_new(" ", 1);
  double n = scr_dyn_arr_len(arr);
  for (double i = 0; i < n; i += 1) {
    if (i > 0) {
      /* concat BORROWS both sides and returns +1 (the in-place path
       * leaves the left at rc 2), so the accumulator is released here. */
      ScrStr *joined = scr_str_concat(out, sep);
      scr_str_release(out);
      out = joined;
    }
    ScrDyn *el = scr_dyn_arr_at(arr, i);
    ScrStr *s = scr_insp_dyn_s(el, 2);
    scr_dyn_release(el);
    ScrStr *joined = scr_str_concat(out, s);
    scr_str_release(out);
    scr_str_release(s);
    out = joined;
  }
  scr_str_release(sep);
  return out;
}

/* ── util.format over a RUNTIME argument list ────────────────────────── */

/* Does the tree under `d` hold anything %o's showHidden renders beyond the
 * default walk (an array's hidden [length] entry, a function's [length]/
 * [name]/[prototype] rows)? Those have no rendering here, so %o over them
 * fences loudly (the OBJINST arm's stance) instead of printing a body that
 * differs from Node's. Bounded by %o's own depth. */
static bool insp_has_hidden(const ScrDyn *d, int level) {
  if (d == NULL || level > 5) return false;
  if (d->kind == SCR_DYN_ARR || d->kind == SCR_DYN_FUNC) return true;
  if (d->kind == SCR_DYN_OBJ) {
    for (uint32_t i = 0; i < d->v.obj.len; i++) {
      if (insp_has_hidden(d->v.obj.entries[i].value, level + 1)) return true;
    }
  }
  return false;
}

/* The ToNumber a `%d` runs: Number(arg). Primitive kinds go through the
 * dyn conversion; a reference kind runs ToPrimitive, which for the kinds
 * the dyn model holds is its string form (valueOf answers the object
 * itself), then StringToNumber. */
static double insp_format_number(ScrDyn *d) {
  switch (d->kind) {
    case SCR_DYN_NULL: case SCR_DYN_BOOL: case SCR_DYN_NUM: case SCR_DYN_STR: case SCR_DYN_UNDEF:
      return scr_dyn_to_number(d);
    default: {
      ScrStr *t = scr_dyn_to_string(d, NULL);
      double n = scr_string_to_number(t);
      scr_str_release(t);
      return n;
    }
  }
}

/* util.format(...args) / util.formatWithOptions({}, ...args) where the
 * argument list is a RUNTIME fact (a format string that is not a literal,
 * `util.format.apply(util, arguments)`, a spread): Node's
 * formatWithOptionsInternal ported over the checked-dynamic argument array,
 * with the conversions the static lowering (lower-inspect.ts) gives the same
 * specifiers. Borrows arr; +1 result, or NULL with a pending exception. */
/* Node's formatWithOptionsInternal inspects a %s object with `{ ...inspectOptions, depth: 0, colors: false, compact: 3 }`:
 * every active option applies (breakLength, maxArrayLength, ...) except that the layout is compact 3. The compact setting
 * is overridden for the call and restored. (The rest arguments and %O use inspectOptions as they are.) */
static ScrStr *insp_format_c3(ScrDyn *d, double depth, bool conv_s) {
  const InspCompact saved_kind = g_opts.compact_kind;
  const double saved_compact = g_opts.compact;
  g_opts.compact_kind = INSP_COMPACT_NUM;
  g_opts.compact = 3.0;
  ScrStr *r = conv_s ? scr_insp_fmt_s(d, depth) : scr_insp_dyn_s(d, depth);
  g_opts.compact_kind = saved_kind;
  g_opts.compact = saved_compact;
  return r;
}

ScrStr *scr_insp_format(ScrDyn *arr) {
  const double n = scr_dyn_arr_len(arr);
  if (n == 0) return scr_str_new("", 0);
  ScrDyn *first = scr_dyn_arr_at(arr, 0);
  InspBuf out = {0};
  double a = 0;
  bool join = false;
  bool failed = false;
  if (first->kind == SCR_DYN_STR) {
    const ScrStr *f = first->v.str;
    if (n == 1) {
      ScrStr *r = scr_str_retain(first->v.str);
      scr_dyn_release(first);
      return r;
    }
    size_t last_pos = 0;
    for (size_t i = 0; i + 1 < f->len && !failed; i++) {
      if (f->data[i] != '%') continue;
      char next = f->data[++i];
      if (a + 1 != n) {
        ScrStr *temp = NULL;
        bool continue_outer = false;
        switch (next) {
          case 's': {
            a += 1;
            ScrDyn *v = scr_dyn_arr_at(arr, a);
            if (v->kind == SCR_DYN_NUM || v->kind == SCR_DYN_BIG || v->kind == SCR_DYN_BOOL || v->kind == SCR_DYN_NULL || v->kind == SCR_DYN_UNDEF || scr_dyn_is_symbol(v)) {
              INSP_NOSTYLE_BEGIN; /* primitives go through stylizeNoColor / String() */
              temp = insp_format_c3(v, 0, true);
              INSP_NOSTYLE_END;
            } else {
              INSP_NOCOLOR_BEGIN; /* an object is inspected with the options' own stylize */
              temp = insp_format_c3(v, 0, true);
              INSP_NOCOLOR_END;
            }
            scr_dyn_release(v);
            break;
          }
          case 'j': {
            a += 1;
            ScrDyn *v = scr_dyn_arr_at(arr, a);
            temp = scr_dyn_format_j(v);
            scr_dyn_release(v);
            break;
          }
          case 'd': {
            a += 1;
            ScrDyn *v = scr_dyn_arr_at(arr, a);
            if (v->kind == SCR_DYN_BIG) {
              INSP_NOSTYLE_BEGIN;
              temp = scr_insp_dyn(v, 0, 0);
              INSP_NOSTYLE_END;
            } else if (v->kind == SCR_DYN_NUM) temp = scr_insp_f64(v->v.num);
            else temp = scr_insp_f64(insp_format_number(v));
            scr_dyn_release(v);
            break;
          }
          case 'O': {
            a += 1;
            ScrDyn *v = scr_dyn_arr_at(arr, a);
            temp = scr_insp_dyn(v, 0, g_opts.depth); /* inspect(arg, inspectOptions): the active depth, default 2 */
            scr_dyn_release(v);
            break;
          }
          case 'o': {
            a += 1;
            ScrDyn *v = scr_dyn_arr_at(arr, a);
#ifdef SCR_INSP_COLORS
            {
              /* formatWithOptionsInternal: inspect(arg, { ...inspectOptions, showHidden: true, showProxy: true, depth: 4 }) */
              const InspOpts saved_o = g_opts;
              g_opts.show_hidden = true;
              g_opts.show_proxy = true;
              g_opts.depth = 4.0;
              temp = scr_insp_dyn(v, 0, 4);
              g_opts = saved_o;
            }
#else
            if (insp_has_hidden(v, 0)) {
              static const char msg[] = "util.format %o of a dynamic array or function is not supported yet";
              scr_throw_error(SCR_ERR_ERROR, scr_str_new(msg, sizeof msg - 1));
              temp = scr_str_new("", 0);
            } else {
              temp = scr_insp_dyn(v, 0, 4);
            }
#endif
            scr_dyn_release(v);
            break;
          }
          case 'i': {
            a += 1;
            ScrDyn *v = scr_dyn_arr_at(arr, a);
            if (v->kind == SCR_DYN_BIG) {
              INSP_NOSTYLE_BEGIN;
              temp = scr_insp_dyn(v, 0, 0);
              INSP_NOSTYLE_END;
            } else {
              ScrStr *t = scr_dyn_to_string(v, NULL);
              temp = scr_insp_f64(scr_parse_int(t, 0));
              scr_str_release(t);
            }
            scr_dyn_release(v);
            break;
          }
          case 'f': {
            a += 1;
            ScrDyn *v = scr_dyn_arr_at(arr, a);
            ScrStr *t = scr_dyn_to_string(v, NULL);
            temp = scr_insp_f64(scr_parse_float(t));
            scr_str_release(t);
            scr_dyn_release(v);
            break;
          }
          case 'c':
            a += 1;
            temp = scr_str_new("", 0);
            break;
          case '%':
            ib_bytes(&out, f->data + last_pos, i - last_pos);
            last_pos = i + 1;
            continue_outer = true;
            break;
          default:
            continue_outer = true;
            break;
        }
        if (continue_outer) continue;
        if (temp == NULL || scr_exc_pending()) {
          if (temp != NULL) scr_str_release(temp);
          failed = true;
          break;
        }
        if (last_pos != i - 1) ib_bytes(&out, f->data + last_pos, (i - 1) - last_pos);
        ib_str(&out, temp);
        scr_str_release(temp);
        last_pos = i + 1;
      } else if (next == '%') {
        ib_bytes(&out, f->data + last_pos, i - last_pos);
        last_pos = i + 1;
      }
    }
    if (!failed && last_pos != 0) {
      a += 1;
      join = true;
      if (last_pos < f->len) ib_bytes(&out, f->data + last_pos, f->len - last_pos);
    }
  }
  scr_dyn_release(first);
  while (!failed && a < n) {
    ScrDyn *v = scr_dyn_arr_at(arr, a);
    if (join) ib_char(&out, ' ');
    ScrStr *s = scr_insp_dyn_s(v, g_opts.depth); /* inspect(value, inspectOptions): every active option, default depth 2 */
    scr_dyn_release(v);
    if (scr_exc_pending()) {
      scr_str_release(s);
      failed = true;
      break;
    }
    ib_str(&out, s);
    scr_str_release(s);
    join = true;
    a += 1;
  }
  if (failed) {
    free(out.data);
    return NULL;
  }
  return ib_take(&out);
}

/* Node's ERR_UNHANDLED_ERROR for a non-Error 'error' payload: the message is
 * "Unhandled error. (" + util.inspect(value) + ")" (depth 2). */
ScrError *scr_insp_unhandled_nonerr(const ScrDyn *payload) {
  ScrStr *ins = scr_insp_dyn((ScrDyn *)payload, 0, 2);
  ScrStr *pre = scr_str_new("Unhandled error. (", 18);
  ScrStr *cl = scr_str_new(")", 1);
  ScrStr *t1 = scr_str_concat(pre, ins);
  ScrStr *ms = scr_str_concat(t1, cl);
  scr_str_release(pre); scr_str_release(ins); scr_str_release(cl); scr_str_release(t1);
  ScrError *u = scr_error_new(SCR_ERR_ERROR, ms);
  scr_str_release(ms);
  u->code = scr_str_new("ERR_UNHANDLED_ERROR", 19);
  return u;
}

