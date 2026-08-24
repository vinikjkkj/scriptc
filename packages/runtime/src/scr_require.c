/* The compiled CommonJS `require` with a RUN-TIME specifier: the verdict
 * function the emitted `module.requireVerdict` libCall calls, and nothing
 * else.
 *
 * Its own translation unit, LINK-GATED by moduleUsesRequireVerdict, for
 * the reason tests/harness/size-class.ts exists to catch: this machinery
 * lived in scr_json.c, which is in the always-linked base set, and the
 * static hello-world grew 6,144 bytes for a call it can never make. A
 * program with no run-time-specifier require links none of this now and
 * keeps its exact size class. (scr_dyn_handle.c is the precedent.)
 *
 * Everything it reaches outside itself -- scr_dyn_arg_type_fail,
 * scr_dyn_undefined, the scr_error_* family, scr_str_new/release,
 * scr_throw_error_msg_code, scr_throw_obj, scr_trap -- is declared in
 * scr_runtime.h and defined in units this one does not have to imply.
 * Nothing in scr_json.c calls INTO this, which is why the move is a move
 * and not a split. */

#include "scr_runtime.h"

#include <errno.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

/* ── the compiled CommonJS require, with a RUN-TIME specifier ─────────
 * A compiled binary reads no node_modules: the resolution the specifier
 * would drive under Node happened at BUILD time, and what survives into
 * the C is this verdict function plus `roots` — every bare specifier ROOT
 * (package name or builtin name) the build could not rule out, joined
 * with '\n' and carrying a leading and a trailing '\n' so membership is
 * one substring search.
 *
 * The answer is a BOOL and it is deliberately one-sided:
 *   false   never returned — the function either throws or answers true;
 *   true    the build cannot serve this specifier, and the CALLER's next
 *           statement is the same tagged refusal the site carried before
 *           (the caller emits it, so the refusal stays visible to the
 *           translation-unit census exactly where it was);
 *   throws  every case Node itself rejects, with Node's own error:
 *           ERR_INVALID_ARG_TYPE for a non-string, ERR_INVALID_ARG_VALUE
 *           for the empty string, and MODULE_NOT_FOUND — catchable, which
 *           is the whole point — for a bare specifier whose root NOTHING
 *           installed at build time can resolve. That last arm is the
 *           optional-dependency `try { require(x) } catch {}` idiom, the
 *           one this compiler used to answer by swallowing its own fence.
 *
 * A specifier the compiler CANNOT prove unresolvable fences instead: a
 * relative or absolute path, a drive-shaped one, a 'node:' name Node
 * really serves, a '#' import a baked "imports" key matches, or a bare
 * root in `roots`. Wrong in the LOUD direction by construction — never a
 * value where Node throws, and never a MODULE_NOT_FOUND where Node hands
 * back a module.
 *
 * `builtins` and `scope` are the two baked answers the ROOT SET cannot
 * give, and both are name tables — no filesystem is read here at run
 * time, by design. `builtins` is Node's own builtinModules, newline
 * joined and delimited like `roots`, and decides 'node:x'. `scope`
 * carries the requiring file's package scope: "" for cannot-enumerate,
 * "-" for a scope with no "imports" field, "+<package.json>\n<key>\n..."
 * for one that has it.
 *
 * `roots` empty means "cannot enumerate": everything bare fences.
 * Borrows all five arguments. */
/* Membership in one of the newline-joined baked sets. Each is a list
 * with a LEADING and a TRAILING newline (or the empty string), so the
 * test is one substring search for newline + name + newline: no
 * allocation, and a name that is a PREFIX of another ("ws" against
 * "wsrun") cannot match, because both delimiters are required. */
static bool scr_require_name_listed(const ScrStr *set, const char *name, size_t len) {
  if (set->len < len + 2) return false;
  for (size_t i = 0; i + len + 1 < set->len; i++) {
    if (set->data[i] != '\n') continue;
    if (memcmp(set->data + i + 1, name, len) != 0) continue;
    if (set->data[i + 1 + len] == '\n') return true;
  }
  return false;
}
static bool scr_require_root_known(const ScrStr *roots, const char *name, size_t len) {
  if (roots->len == 0) return true; /* cannot enumerate: fence */
  return scr_require_name_listed(roots, name, len);
}

/* Node's require-site MODULE_NOT_FOUND, message and code exact — the
 * message really does carry the one-entry "Require stack" line. Three
 * arms reach it (a bare root nothing installed resolves, a '#' specifier
 * in a scope with no "imports" field, and Node's own argument-shaped
 * refusals), so it is built once. Never returns. */
static void scr_require_throw_not_found(const ScrStr *s, const ScrStr *from) {
  static const char head[] = "Cannot find module '";
  static const char mid[] = "'\nRequire stack:\n- ";
  size_t len = (sizeof head - 1) + s->len + (sizeof mid - 1) + from->len;
  char *msg = (char *)malloc(len + 1);
  if (msg == NULL) scr_trap("scriptc: out of memory\n");
  size_t at = 0;
  memcpy(msg + at, head, sizeof head - 1); at += sizeof head - 1;
  memcpy(msg + at, s->data, s->len); at += s->len;
  memcpy(msg + at, mid, sizeof mid - 1); at += sizeof mid - 1;
  memcpy(msg + at, from->data, from->len); at += from->len;
  msg[at] = '\0';
  /* Built by hand rather than through scr_throw_error_msg_code, which
   * takes a (char*, len) it copies: the scratch buffer could then only
   * be freed AFTER a call that never returns. The ScrStr takes its own
   * copy, the buffer frees here, and the error owns the string from
   * there on. */
  ScrStr *m = scr_str_new(msg, at);
  free(msg);
  ScrError *e = scr_error_new(SCR_ERR_ERROR, m);
  scr_str_release(m); /* scr_error_new retained its own */
  scr_error_set_code(e, "MODULE_NOT_FOUND");
  scr_throw_obj(e, &scr_error_retain_v, &scr_error_release_v, scr_error_trace_arg());
}

/* The three-part message ERR_PACKAGE_IMPORT_NOT_DEFINED renders, and
 * ERR_UNKNOWN_BUILTIN_MODULE's two-part one, from pieces that are not
 * all NUL-terminated. Never returns. */
static void scr_require_throw_parts(int kind, const char *code,
                                    const char *const *parts, const size_t *lens, size_t n) {
  size_t len = 0;
  for (size_t i = 0; i < n; i++) len += lens[i];
  char *msg = (char *)malloc(len + 1);
  if (msg == NULL) scr_trap("scriptc: out of memory\n");
  size_t at = 0;
  for (size_t i = 0; i < n; i++) { memcpy(msg + at, parts[i], lens[i]); at += lens[i]; }
  msg[at] = '\0';
  ScrStr *m = scr_str_new(msg, at);
  free(msg);
  ScrError *err = scr_error_new(kind, m);
  scr_str_release(m);
  scr_error_set_code(err, code);
  scr_throw_obj(err, &scr_error_retain_v, &scr_error_release_v, scr_error_trace_arg());
}

/* Does any key of the baked "imports" map match this '#' specifier?
 *
 * `scope` is "+<package.json path>\n<key>\n<key>\n..." (see the header
 * above). A key is either exact or carries ONE '*'; Node picks the best
 * pattern among several, but "some key matches" is all this needs — a
 * matched key means the answer is a MODULE, which is the fence. */
static bool scr_require_import_key_matches(const ScrStr *scope, const ScrStr *s) {
  size_t i = 0;
  while (i < scope->len && scope->data[i] != '\n') i++; /* past the path */
  while (i < scope->len) {
    i++; /* past the '\n' */
    size_t j = i;
    while (j < scope->len && scope->data[j] != '\n') j++;
    size_t klen = j - i;
    if (klen > 0) {
      const char *k = scope->data + i;
      const char *star = (const char *)memchr(k, '*', klen);
      if (star == NULL) {
        if (klen == s->len && memcmp(k, s->data, klen) == 0) return true;
      } else {
        size_t plen = (size_t)(star - k);
        size_t slen = klen - plen - 1;
        if (s->len >= plen + slen && memcmp(s->data, k, plen) == 0 &&
            (slen == 0 || memcmp(s->data + s->len - slen, star + 1, slen) == 0)) {
          return true;
        }
      }
    }
    i = j;
  }
  return false;
}
/* Does anything at `base` + `rest` exist, under Node's LOAD_AS_FILE
 * extension list widened with .mjs/.cjs? `doubt` is what a stat error
 * that is not "no such entry" means to the caller — presence for a
 * caller that fences on presence, so every unreadable answer is loud. */
static bool scr_require_candidate_exists(const char *base, size_t blen,
                                         const char *rest, size_t rlen, bool doubt) {
  static const char *const exts[] = { "", ".js", ".json", ".node", ".mjs", ".cjs" };
  char *buf = (char *)malloc(blen + rlen + 8);
  if (buf == NULL) scr_trap("scriptc: out of memory\n");
  if (blen > 0) memcpy(buf, base, blen);
  if (rlen > 0) memcpy(buf + blen, rest, rlen);
  struct stat st;
  for (size_t i = 0; i < sizeof exts / sizeof exts[0]; i++) {
    size_t elen = strlen(exts[i]);
    memcpy(buf + blen + rlen, exts[i], elen + 1);
    errno = 0;
    if (stat(buf, &st) == 0) { free(buf); return true; }
    if (errno != ENOENT) { free(buf); return doubt; }
  }
  free(buf);
  return false;
}

/* Node's GLOBAL lookup paths, which NO node_modules walk can see.
 *
 * `require("x")` does not stop at the node_modules chain: Module's
 * globalPaths — every NODE_PATH entry, plus the home directory's
 * .node_modules and .node_libraries — are searched after it, and a
 * NODE_PATH entry acts as a node_modules directory. Measured against Node
 * v25.9.0: with NODE_PATH naming a directory that holds `np-only`,
 * `require("np-only")` hands the module over from a program whose whole
 * node_modules chain has never heard of it.
 *
 * The BUILD cannot see that, because NODE_PATH is a RUN-TIME environment
 * variable. Without this check the compiled binary answers Node's
 * catchable MODULE_NOT_FOUND for a module Node hands over — measured, on
 * both backends — and the `try { require(x) } catch` idiom this arm
 * exists for swallows it. That is the silent direction, arriving through
 * the front door of the arm built to remove it.
 *
 * So the build's proof of absence is only allowed to stand once the run
 * time has asked whether any global path could serve this root. Anything
 * there, and any doubt at all — a non-ASCII path `stat` cannot spell, a
 * root too long to spell, a stat that fails for any reason other than "no
 * such entry" — keeps the refusal. Only the module's exports as a value
 * would answer it properly; a fence is the loud placeholder.
 *
 * The ROOT is what is checked, not the whole specifier: a package
 * directory that is there makes Node's answer this binary's business
 * whatever the subpath says, and that is the conservative side. */
static bool scr_require_global_path_may_serve(const char *root, size_t rootlen) {
#if defined(_WIN32)
  static const char DELIM = ';';
#else
  static const char DELIM = ':';
#endif
  for (size_t i = 0; i < rootlen; i++) if ((unsigned char)root[i] >= 0x80u) return true;
  char name[512];
  if (rootlen + 2 > sizeof name) return true; /* cannot spell it: fence */
  name[0] = '/'; /* every platform this targets accepts it as a separator */
  memcpy(name + 1, root, rootlen);
  name[rootlen + 1] = '\0';
  const char *np = getenv("NODE_PATH");
  if (np != NULL) {
    for (const char *p = np; *p != '\0';) {
      const char *e = p;
      while (*e != '\0' && *e != DELIM) e++;
      size_t len = (size_t)(e - p);
      if (len > 0) {
        for (size_t i = 0; i < len; i++) if ((unsigned char)p[i] >= 0x80u) return true;
        if (scr_require_candidate_exists(p, len, name, rootlen + 1, true)) return true;
      }
      p = *e == '\0' ? e : e + 1;
    }
  }
  /* Both spellings of the home directory: Node reads USERPROFILE on
   * Windows and HOME elsewhere, and a shell that sets the other one to a
   * path this binary cannot stat simply finds nothing, which is the same
   * answer it would have given before. */
  static const char *const HOMEVARS[] = { "USERPROFILE", "HOME" };
  static const char *const LEGACY[] = { "/.node_modules", "/.node_libraries" };
  for (size_t v = 0; v < sizeof HOMEVARS / sizeof HOMEVARS[0]; v++) {
    const char *home = getenv(HOMEVARS[v]);
    if (home == NULL || *home == '\0') continue;
    size_t hlen = strlen(home);
    for (size_t i = 0; i < hlen; i++) if ((unsigned char)home[i] >= 0x80u) return true;
    for (size_t k = 0; k < sizeof LEGACY / sizeof LEGACY[0]; k++) {
      char dir[1024];
      size_t llen = strlen(LEGACY[k]);
      if (hlen + llen + 1 > sizeof dir) return true;
      memcpy(dir, home, hlen);
      memcpy(dir + hlen, LEGACY[k], llen + 1);
      if (scr_require_candidate_exists(dir, hlen + llen, name, rootlen + 1, true)) return true;
    }
  }
  return false;
}
/* Can the binary PROVE that a relative or absolute specifier resolves to
 * nothing?
 *
 * This is the one specifier class whose answer is genuinely a filesystem
 * question — Node's own answer for `require("./x")` is different on two
 * machines — so the honest compiled answer is to ask the same question,
 * and the honest LINE is: this reads whether a path EXISTS and never
 * reads a byte of any file. Nothing is loaded, parsed or evaluated; a
 * path that IS there still fences, because handing it back means the
 * module's exports as a value. Only ABSENCE is proven here, and absence
 * is exactly what Node's catchable MODULE_NOT_FOUND reports.
 *
 * Three guards keep every failure LOUD:
 *
 *  1. The REQUIRING FILE must itself still be where the build recorded
 *     it. A binary shipped away from its sources answers `false` for
 *     everything and keeps the refusal it has today — the alternative
 *     would be telling such a program that a module the binary CONTAINS
 *     is missing, which is the silent direction.
 *  2. Non-ASCII bytes in either path fence. `stat` is the ANSI entry
 *     point on Windows, and a path it cannot spell would come back
 *     "missing" for a file that is right there.
 *  3. A stat that fails for any reason OTHER than "no such entry"
 *     fences: a permission error is not a proof of absence.
 *
 * The candidate set is Node's LOAD_AS_FILE list (the path VERBATIM, then
 * .js/.json/.node) widened with .mjs/.cjs, and any DIRECTORY at the path
 * counts as present because LOAD_AS_DIRECTORY would then have a manifest
 * or an index to find. Widening can only ever add a fence. */
static bool scr_require_path_absent(const ScrStr *from, const ScrStr *s) {
  if (from->len == 0 || s->len == 0) return false;
  for (size_t i = 0; i < from->len; i++) if ((unsigned char)from->data[i] >= 0x80u) return false;
  for (size_t i = 0; i < s->len; i++) if ((unsigned char)s->data[i] >= 0x80u) return false;
  size_t dirlen = from->len;
  while (dirlen > 0 && from->data[dirlen - 1] != '/' && from->data[dirlen - 1] != (char)92) dirlen--;
  const char c0 = s->data[0];
  const bool absolute = c0 == '/' || c0 == (char)92 ||
                        (s->len >= 2 && s->data[1] == ':' &&
                         ((c0 >= 'A' && c0 <= 'Z') || (c0 >= 'a' && c0 <= 'z')));
  const size_t base = absolute ? 0 : dirlen;
  /* '.' and '..' segments are left in the path: every platform this
   * targets resolves them itself, and a normalizer here would be one
   * more thing to get wrong. */
  {
    char *f = (char *)malloc(from->len + 1);
    if (f == NULL) scr_trap("scriptc: out of memory\n");
    memcpy(f, from->data, from->len);
    f[from->len] = '\0';
    struct stat st;
    const bool there = stat(f, &st) == 0;
    free(f);
    if (!there) return false; /* detached from its sources: prove nothing */
  }
  return !scr_require_candidate_exists(from->data, base, s->data, s->len, true);
}
bool scr_require_verdict(const struct ScrDyn *spec, const ScrStr *roots, const ScrStr *from,
                         const ScrStr *builtins, const ScrStr *scope) {
  const ScrDyn *arg = spec != NULL ? spec : scr_dyn_undefined();
  if (arg->kind != SCR_DYN_STR) {
    /* Node checks the argument BEFORE it resolves anything: require(42)
     * is ERR_INVALID_ARG_TYPE, and the "Received ..." tail is rendered
     * from the value exactly as determineSpecificType does. */
    scr_dyn_arg_type_fail("id", "of type string", arg);
    return true; /* unreachable: the call above always throws */
  }
  const ScrStr *s = arg->v.str;
  if (s->len == 0) {
    static const char m[] = "The argument 'id' must be a non-empty string. Received ''";
    scr_throw_error_msg_code(SCR_ERR_TYPE, m, sizeof m - 1, "ERR_INVALID_ARG_VALUE");
    return true;
  }
  const char c0 = s->data[0];
  /* The 'node:' prefix serves BUILTINS ONLY, and it is the one specifier
   * class whose whole answer is a NAME TABLE — no filesystem anywhere in
   * it. A name Node's own builtinModules carries is a module this binary
   * would have to hand back as a value, so it fences; every other name
   * is Node's ERR_UNKNOWN_BUILTIN_MODULE, whose message is the WHOLE
   * specifier, prefix included, and which carries no require stack.
   * Measured against Node v25.9.0: 'node:fs/promises' resolves, and
   * 'node:fs/nosuch', 'node:fs/' and bare 'node:' all throw. */
  if (s->len >= 5 && memcmp(s->data, "node:", 5) == 0) {
    if (scr_require_name_listed(builtins, s->data + 5, s->len - 5)) return true;
    {
      static const char nb[] = "No such built-in module: ";
      const char *parts[2] = { nb, s->data };
      const size_t lens[2] = { sizeof nb - 1, s->len };
      scr_require_throw_parts(SCR_ERR_ERROR, "ERR_UNKNOWN_BUILTIN_MODULE", parts, lens, 2);
    }
    return true; /* unreachable */
  }
  /* A '#' subpath import. Node resolves it against the "imports" field of
   * the NEAREST enclosing package.json, and what it answers when nothing
   * matches depends on whether that field exists at all — measured, both
   * ways, against Node v25.9.0:
   *
   *   no package.json, or one with no "imports"    MODULE_NOT_FOUND
   *   an "imports" field, even {}, no key matches  ERR_PACKAGE_IMPORT_NOT_DEFINED
   *
   * so the BUILD bakes which of the two this file sits in. `scope` is ""
   * for "cannot enumerate" (fence everything, the conservative
   * direction), "-" for a scope with no imports map, and
   * "+<package.json path>\n<key>\n<key>\n..." for one that has it. A key
   * that MATCHES means the answer is a module, which is the fence this
   * row is about; the malformed shapes ('#', '#/...', a trailing slash)
   * are Node's ERR_INVALID_MODULE_SPECIFIER family and fence too — loud,
   * because their exact wording is not what this row is buying. */
  if (c0 == '#') {
    if (scope->len == 0) return true; /* cannot enumerate: fence */
    if (scope->data[0] == '-') { scr_require_throw_not_found(s, from); return true; }
    if (s->len == 1 || s->data[1] == '/' || s->data[s->len - 1] == '/') return true;
    if (scr_require_import_key_matches(scope, s)) return true;
    {
      static const char h[] = "Package import specifier \"";
      static const char m1[] = "\" is not defined in package ";
      static const char m2[] = " imported from ";
      size_t pjlen = 0;
      while (1 + pjlen < scope->len && scope->data[1 + pjlen] != '\n') pjlen++;
      const char *parts[6] = { h, s->data, m1, scope->data + 1, m2, from->data };
      const size_t lens[6] = { sizeof h - 1, s->len, sizeof m1 - 1, pjlen, sizeof m2 - 1, from->len };
      scr_require_throw_parts(SCR_ERR_TYPE, "ERR_PACKAGE_IMPORT_NOT_DEFINED", parts, lens, 6);
    }
    return true; /* unreachable */
  }
  /* Relative, absolute and drive-shaped: Node's resolution for these
   * reads the filesystem the binary does not carry, so the build cannot
   * prove they fail. Fence. A DRIVE letter is spelled out rather than
   * left to a blanket ':' test, because every OTHER colon-bearing
   * specifier is a plain BARE one — 'file:///x', 'http://x',
   * 'data:text/js,1' and 'mylib:sub' all take Node's node_modules walk
   * and all answer MODULE_NOT_FOUND, which the bare arm below gets
   * right. The blanket test fenced all four. */
  if (c0 == '.' || c0 == '/' || c0 == (char)92 ||
      (s->len >= 2 && s->data[1] == ':' &&
       ((c0 >= 'A' && c0 <= 'Z') || (c0 >= 'a' && c0 <= 'z')))) {
    /* Nothing at any path Node's resolution would try, proven without
     * reading a byte of any file: Node's answer here is its catchable
     * MODULE_NOT_FOUND. Anything present, or any doubt at all, keeps the
     * refusal. */
    if (scr_require_path_absent(from, s)) { scr_require_throw_not_found(s, from); return true; }
    return true;
  }
  /* The bare specifier's ROOT: "@scope/pkg" or "pkg". A subpath after the
   * root belongs to the same package and fences with it, which is the
   * loud direction: a package whose "exports" rejects the subpath makes
   * Node throw ERR_PACKAGE_PATH_NOT_EXPORTED, and a fence is never a
   * value where Node throws. */
  size_t root = 0;
  if (c0 == '@') {
    while (root < s->len && s->data[root] != '/') root++;
    if (root < s->len) {
      root++;
      while (root < s->len && s->data[root] != '/') root++;
    }
  } else {
    while (root < s->len && s->data[root] != '/') root++;
  }
  if (scr_require_root_known(roots, s->data, root)) return true;
  /* Node's GLOBAL lookup paths are searched AFTER the node_modules chain
   * and the BUILD cannot see them: NODE_PATH is a run-time environment
   * variable. Without this the binary answers MODULE_NOT_FOUND for a
   * module Node hands over -- measured, on both backends. */
  if (scr_require_global_path_may_serve(s->data, root)) return true;
  /* Nothing the build could see resolves this root, so Node's answer is
   * the catchable require-site MODULE_NOT_FOUND, message and code exact. */
  scr_require_throw_not_found(s, from);
  return true; /* unreachable */
}
