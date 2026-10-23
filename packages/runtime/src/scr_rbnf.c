#include "scr_rbnf.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct { char *p; size_t n, cap; } Sb;
static void sb_reserve(Sb *b, size_t add) {
  if (b->n + add + 1 > b->cap) { size_t nc = b->cap ? b->cap * 2 : 64; while (nc < b->n + add + 1) nc *= 2; b->p = (char *)realloc(b->p, nc); if (!b->p) abort(); b->cap = nc; }
}
static void sb_insert(Sb *b, size_t pos, const char *s, size_t n) {
  sb_reserve(b, n);
  if (!b->p) { b->p = (char *)malloc(1); b->p[0] = 0; b->cap = 1; }
  if (pos > b->n) pos = b->n;
  memmove(b->p + pos + n, b->p + pos, b->n - pos);
  memcpy(b->p + pos, s, n);
  b->n += n;
  b->p[b->n] = 0;
}
static char *dupn(const char *s, size_t n) { char *r = (char *)malloc(n + 1); memcpy(r, s, n); r[n] = 0; return r; }

struct RuleSet;
struct Rule;
enum { SUB_NONE = 0, SUB_SAME, SUB_MULT, SUB_MOD, SUB_ABS };
typedef struct {
  int kind, pos;
  struct RuleSet *rs;     /* the rule set to format with (the owning set when the token has no name) */
  int decimal;            /* 1: "0" pattern, 2: "#,##0" */
  int64_t divisor;
  const struct Rule *ruleToUse; /* ">>>" */
} Sub;
typedef struct Rule {
  int64_t base;
  int radix, exponent;
  int special; /* 0 normal, 1 negative-number rule, 2 other special (ignored when formatting integers) */
  char *text; size_t tlen;
  Sub sub[2];
  int nsub;
} Rule;
typedef struct RuleSet {
  char name[64];
  char *desc;
  Rule **rules; int n, cap;
  Rule *neg;
} RuleSet;
struct ScrRbnf {
  RuleSet *sets; int nsets;
  RuleSet *deflt;
  char minus[16], group[16];
  int bad;
};

static int64_t ipow(int64_t b, int e) { int64_t r = 1; while (e-- > 0) r *= b; return r; }
static RuleSet *find_set(const ScrRbnf *r, const char *name, size_t n) {
  for (int i = 0; i < r->nsets; i++) if (strlen(r->sets[i].name) == n && !memcmp(r->sets[i].name, name, n)) return &r->sets[i];
  return NULL;
}
static int expected_exponent(int64_t base, int radix) {
  if (radix == 0 || base < 1) return 0;
  int t = (int)((double)(int)0); (void)t;
  int tempResult = (int)(__builtin_log((double)base) / __builtin_log((double)radix));
  int64_t temp = ipow(radix, tempResult + 1);
  if (temp <= base) tempResult += 1;
  return tempResult;
}

/* "NFRule" under construction: the descriptor is parsed off, the body kept for extractSubstitutions */
static void rule_add(RuleSet *rs, Rule *r) {
  if (rs->n == rs->cap) { rs->cap = rs->cap ? rs->cap * 2 : 16; rs->rules = (Rule **)realloc(rs->rules, sizeof(Rule *) * (size_t)rs->cap); }
  rs->rules[rs->n++] = r;
}

static void extract_substitutions(ScrRbnf *R, RuleSet *owner, Rule *rule, const char *body, size_t bl, const Rule *predecessor) {
  /* fRuleText = body; sub1 then sub2 (each token removed from the text) */
  char *text = dupn(body, bl);
  size_t tl = bl;
  rule->nsub = 0;
  for (int which = 0; which < 2; which++) {
    size_t subStart = (size_t)-1;
    for (size_t i = 0; i < tl; i++) if (text[i] == '<' || text[i] == '>' || text[i] == '=') { subStart = i; break; }
    if (subStart == (size_t)-1) break;
    size_t subEnd;
    if (tl >= subStart + 3 && !memcmp(text + subStart, ">>>", 3)) subEnd = subStart + 2;
    else {
      char c = text[subStart];
      const char *e = memchr(text + subStart + 1, c, tl - subStart - 1);
      if (!e) break;
      subEnd = (size_t)(e - text);
      if (c == '<' && subEnd < tl - 1 && text[subEnd + 1] == c) ++subEnd;
    }
    /* token = text[subStart .. subEnd] inclusive */
    char *tok = dupn(text + subStart, subEnd + 1 - subStart);
    size_t toklen = subEnd + 1 - subStart;
    Sub *s = &rule->sub[which];
    memset(s, 0, sizeof *s);
    s->pos = (int)subStart;
    switch (tok[0]) {
      case '<': s->kind = rule->special == 1 ? SUB_NONE : SUB_MULT; break;
      case '>': s->kind = rule->special == 1 ? SUB_ABS : SUB_MOD; break;
      default: s->kind = SUB_SAME; break;
    }
    /* NFSubstitution: strip the paired token characters, then the middle names a rule set or a decimal pattern */
    char *mid = dupn(tok + 1, toklen >= 2 ? toklen - 2 : 0);
    size_t ml = toklen >= 2 ? toklen - 2 : 0;
    s->rs = owner;
    if (ml == 0) { /* the owning rule set */ }
    else if (mid[0] == '%') { s->rs = find_set(R, mid, ml); if (!s->rs) R->bad = 1; }
    else if (mid[0] == '#' || mid[0] == '0') { s->rs = NULL; s->decimal = strchr(mid, ',') ? 2 : 1; }
    else if (mid[0] == '>') { s->rs = owner; if (s->kind == SUB_MOD) s->ruleToUse = predecessor; }
    else R->bad = 1;
    free(mid);
    free(tok);
    memmove(text + subStart, text + subEnd + 1, tl - subEnd);
    tl -= subEnd + 1 - subStart;
    text[tl] = 0;
    rule->nsub = which + 1;
  }
  free(rule->text);
  rule->text = text;
  rule->tlen = tl;
}

static Rule *new_rule(void) { Rule *r = (Rule *)calloc(1, sizeof *r); r->radix = 10; return r; }

static void set_base(Rule *r, int64_t b) {
  r->base = b; r->radix = 10;
  r->exponent = b >= 1 ? expected_exponent(b, r->radix) : 0;
}

/* parseRuleDescriptor: returns the offset of the body in `desc` */
static size_t parse_descriptor(Rule *rule, const char *desc, size_t len) {
  const char *colon = memchr(desc, ':', len);
  if (!colon) { set_base(rule, 0); return (len > 0 && desc[0] == '\'') ? 1 : 0; }
  size_t dl = (size_t)(colon - desc);
  size_t p = dl + 1;
  while (p < len && (desc[p] == ' ' || desc[p] == '\t' || desc[p] == '\n' || desc[p] == '\r')) p++;
  char first = dl ? desc[0] : 0, last = dl ? desc[dl - 1] : 0;
  if (first >= '0' && first <= '9' && last != 'x') {
    int64_t val = 0;
    size_t q = 0;
    char c = ' ';
    while (q < dl) {
      c = desc[q];
      if (c >= '0' && c <= '9') val = val * 10 + (c - '0');
      else if (c == '/' || c == '>') break;
      ++q;
    }
    set_base(rule, val);
    if (c == '/') {
      val = 0; ++q;
      while (q < dl) {
        c = desc[q];
        if (c >= '0' && c <= '9') val = val * 10 + (c - '0');
        else if (c == '>') break;
        ++q;
      }
      rule->radix = (int)val;
      rule->exponent = expected_exponent(rule->base, rule->radix);
    }
    if (c == '>') { while (q < dl) { if (desc[q] == '>' && rule->exponent > 0) --rule->exponent; ++q; } }
  } else if (dl == 2 && !memcmp(desc, "-x", 2)) rule->special = 1;
  else rule->special = 2; /* x.x, 0.x, x.0, NaN, Inf: fraction and non-finite rules never apply to an integer */
  if (p < len && desc[p] == '\'') p++;
  return p;
}

static void make_rules(ScrRbnf *R, RuleSet *owner, const char *desc, size_t len) {
  Rule *rule1 = new_rule();
  size_t off = parse_descriptor(rule1, desc, len);
  const char *body = desc + off;
  size_t bl = len - off;
  const Rule *pred = owner->n ? owner->rules[owner->n - 1] : NULL;
  const char *b1 = memchr(body, '[', bl);
  const char *b2 = b1 ? memchr(body, ']', bl) : NULL; /* indexOf(']') from 0, as ICU does */
  size_t brack1 = b1 ? (size_t)(b1 - body) : 0, brack2 = b2 ? (size_t)(b2 - body) : 0;
  if (!b2 || brack1 > brack2 || rule1->special) {
    extract_substitutions(R, owner, rule1, body, bl, pred);
  } else {
    Rule *rule2 = NULL;
    const char *bar = memchr(body, '|', bl);
    size_t orElse = bar ? (size_t)(bar - body) : (size_t)-1;
    if (rule1->base > 0 && rule1->radix != 0 && (rule1->base % ipow(rule1->radix, rule1->exponent)) == 0) {
      rule2 = new_rule();
      rule2->base = rule1->base;
      rule1->base++; /* not a fraction rule set */
      rule2->radix = rule1->radix; rule2->exponent = rule1->exponent;
      Sb sb = {0};
      sb_insert(&sb, 0, body, brack1);
      if (bar) sb_insert(&sb, sb.n, body + orElse + 1, brack2 - orElse - 1);
      if (brack2 + 1 < bl) sb_insert(&sb, sb.n, body + brack2 + 1, bl - brack2 - 1);
      extract_substitutions(R, owner, rule2, sb.p ? sb.p : "", sb.n, pred);
      free(sb.p);
    }
    Sb sb = {0};
    sb_insert(&sb, 0, body, brack1);
    if (bar) sb_insert(&sb, sb.n, body + brack1 + 1, orElse - brack1 - 1);
    else sb_insert(&sb, sb.n, body + brack1 + 1, brack2 - brack1 - 1);
    if (brack2 + 1 < bl) sb_insert(&sb, sb.n, body + brack2 + 1, bl - brack2 - 1);
    extract_substitutions(R, owner, rule1, sb.p ? sb.p : "", sb.n, pred);
    free(sb.p);
    if (rule2) rule_add(owner, rule2);
  }
  if (rule1->special == 1) owner->neg = rule1;
  else if (rule1->special == 2) { free(rule1->text); free(rule1); }
  else rule_add(owner, rule1);
}

static void parse_rules(ScrRbnf *R, RuleSet *rs) {
  const char *d = rs->desc;
  size_t dl = strlen(d), old = 0;
  while (old < dl) {
    const char *semi = memchr(d + old, ';', dl - old);
    size_t p = semi ? (size_t)(semi - d) : dl;
    make_rules(R, rs, d + old, p - old);
    old = p + 1;
  }
  int64_t defaultBase = 0;
  for (int i = 0; i < rs->n; i++) {
    Rule *r = rs->rules[i];
    int64_t b = r->base;
    if (b == 0) set_base(r, defaultBase);
    else { if (b < defaultBase) R->bad = 1; defaultBase = b; }
    ++defaultBase;
  }
}

ScrRbnf *scr_rbnf_open(const char *rules, const char *defaultSet, const char *minus, const char *group) {
  ScrRbnf *R = (ScrRbnf *)calloc(1, sizeof *R);
  snprintf(R->minus, sizeof R->minus, "%s", minus ? minus : "-");
  snprintf(R->group, sizeof R->group, "%s", group ? group : ",");
  /* split into rule sets at ";%" */
  size_t n = strlen(rules);
  size_t start = 0;
  int cap = 0;
  for (size_t i = 0; i <= n; i++) {
    int boundary = i == n || (rules[i] == ';' && i + 1 < n && rules[i + 1] == '%');
    if (!boundary) continue;
    size_t end = i == n ? n : i + 1; /* the ';' ends the previous set */
    if (end > start) {
      if (R->nsets == cap) { cap = cap ? cap * 2 : 8; R->sets = (RuleSet *)realloc(R->sets, sizeof(RuleSet) * (size_t)cap); }
      RuleSet *rs = &R->sets[R->nsets++];
      memset(rs, 0, sizeof *rs);
      const char *d = rules + start;
      size_t dl = end - start;
      const char *colon = memchr(d, ':', dl);
      if (d[0] == '%' && colon) {
        size_t nl = (size_t)(colon - d);
        snprintf(rs->name, sizeof rs->name, "%.*s", (int)nl, d);
        size_t p = nl + 1;
        while (p < dl && (d[p] == ' ' || d[p] == '\t' || d[p] == '\n')) p++;
        rs->desc = dupn(d + p, dl - p);
      } else { snprintf(rs->name, sizeof rs->name, "%%default"); rs->desc = dupn(d, dl); }
    }
    start = i + 1;
  }
  for (int i = 0; i < R->nsets; i++) parse_rules(R, &R->sets[i]);
  R->deflt = find_set(R, defaultSet, strlen(defaultSet));
  if (!R->deflt) R->bad = 1;
  return R;
}

void scr_rbnf_free(ScrRbnf *R) {
  if (!R) return;
  for (int i = 0; i < R->nsets; i++) {
    RuleSet *rs = &R->sets[i];
    for (int j = 0; j < rs->n; j++) { free(rs->rules[j]->text); free(rs->rules[j]); }
    if (rs->neg) { free(rs->neg->text); free(rs->neg); }
    free(rs->rules); free(rs->desc);
  }
  free(R->sets);
  free(R);
}

static const Rule *find_normal_rule(const RuleSet *rs, int64_t number) {
  if (number < 0) { if (rs->neg) return rs->neg; number = -number; }
  int hi = rs->n;
  if (hi > 0) {
    int lo = 0;
    while (lo < hi) {
      int mid = (lo + hi) / 2;
      if (rs->rules[mid]->base == number) return rs->rules[mid];
      else if (rs->rules[mid]->base > number) hi = mid;
      else lo = mid + 1;
    }
    if (hi == 0) return NULL;
    const Rule *result = rs->rules[hi - 1];
    /* shouldRollBack */
    int hasMod = (result->nsub > 0 && result->sub[0].kind == SUB_MOD) || (result->nsub > 1 && result->sub[1].kind == SUB_MOD);
    if (hasMod) {
      int64_t re = ipow(result->radix, result->exponent);
      if ((number % re) == 0 && (result->base % re) != 0) {
        if (hi == 1) return NULL;
        result = rs->rules[hi - 2];
      }
    }
    return result;
  }
  return NULL;
}

static void do_format(const ScrRbnf *R, const Rule *rule, int64_t number, Sb *out, size_t pos, int depth);
static void do_sub(const ScrRbnf *R, const Rule *rule, const Sub *s, int64_t number, Sb *out, size_t pos, int depth) {
  int64_t div = ipow(rule->radix, rule->exponent);
  int64_t t = number;
  switch (s->kind) {
    case SUB_MULT: t = number / div; break;
    case SUB_MOD: t = number % div; break;
    case SUB_ABS: t = number < 0 ? -number : number; break;
    default: break;
  }
  if (s->ruleToUse) { do_format(R, s->ruleToUse, t, out, pos + (size_t)s->pos, depth + 1); return; }
  if (s->rs) {
    if (depth >= 64) return;
    const Rule *r2 = find_normal_rule(s->rs, t);
    if (r2) do_format(R, r2, t, out, pos + (size_t)s->pos, depth + 1);
    return;
  }
  /* a DecimalFormat pattern: "0" or "#,##0" */
  char buf[48];
  int64_t a = t < 0 ? -t : t;
  int nd = 0;
  char dg[24];
  do { dg[nd++] = (char)('0' + a % 10); a /= 10; } while (a);
  Sb tmp = {0};
  if (t < 0) sb_insert(&tmp, tmp.n, R->minus, strlen(R->minus));
  for (int i = nd - 1; i >= 0; i--) {
    char c = dg[i];
    sb_insert(&tmp, tmp.n, &c, 1);
    if (s->decimal == 2 && i > 0 && i % 3 == 0) sb_insert(&tmp, tmp.n, R->group, strlen(R->group));
  }
  (void)buf;
  sb_insert(out, pos + (size_t)s->pos, tmp.p, tmp.n);
  free(tmp.p);
}
static void do_format(const ScrRbnf *R, const Rule *rule, int64_t number, Sb *out, size_t pos, int depth) {
  sb_insert(out, pos, rule->text, rule->tlen);
  if (rule->nsub > 1) do_sub(R, rule, &rule->sub[1], number, out, pos, depth);
  if (rule->nsub > 0) do_sub(R, rule, &rule->sub[0], number, out, pos, depth);
}

char *scr_rbnf_format(const ScrRbnf *R, int64_t number) {
  if (R->bad || !R->deflt) return NULL;
  Sb out = {0};
  const Rule *r = find_normal_rule(R->deflt, number);
  if (!r) { free(out.p); return NULL; }
  sb_insert(&out, 0, "", 0);
  do_format(R, r, number, &out, 0, 0);
  return out.p;
}
