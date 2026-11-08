/* child_process — the synchronous slice: spawnSync as posix_spawnp +
 * piped utf8 capture + waitpid.
 *
 * Node parity notes (SEMANTICS.md has the user-facing story):
 * - The command PATH-searches like Node's (posix_spawnp; a command
 *   containing '/' spawns directly). No shell, ever.
 * - stdin is /dev/null (Node's spawnSync default reads nothing without
 *   `input`); stdout/stderr are captured to strings, utf8 assumed — the
 *   compiler fences every other encoding.
 * - `status` is the exit code; a child killed by a signal has NO status
 *   (has_status = false → the compiler's `number | null` union takes the
 *   null arm), exactly Node's status: null there.
 * - Spawn FAILURE (nonexistent binary, EACCES) never throws: Node reports
 *   it through the result's `error` property, which this surface does not
 *   carry — status is null and both outputs are "" (Node types them null;
 *   divergence documented).
 * - No zombies: every successfully spawned child is waitpid()ed before
 *   this function returns, unconditionally.
 */
#include "scr_runtime.h"

#ifdef _WIN32
/* ── Windows arm: real children via CreateProcessW ────────────────────
 * The POSIX arm below is untouched; this arm reimplements the exported
 * surface over Win32 primitives, matching Node-on-Windows (libuv) and
 * verified against the windows-dev box's Node:
 * - Executable resolution ports libuv's search_path: a command with a
 *   path separator resolves against the effective cwd; a bare name
 *   searches cwd first (CreateProcess's legacy behavior, kept by libuv)
 *   then each PATH entry — trying the literal name only when it has an
 *   extension, then appending (never replacing) .com and .exe.
 *   Resolution failure is Node's ENOENT spawn failure.
 * - The command line is libuv's quote_cmd_arg algorithm, ported exactly:
 *   args without space/tab/quote ride verbatim, args with neither quote
 *   nor backslash just get wrapped, everything else takes the
 *   reverse-scan escape (backslash runs double only before a quote or
 *   the closing wrap; quotes escape with a backslash; "" for empty).
 * - A replaced env becomes a SORTED UTF-16 block (CompareStringOrdinal,
 *   ordinal case-insensitive on the key — libuv's env_strncmp) with
 *   libuv's required vars (SYSTEMROOT, PATH, TEMP, ...) copied from the
 *   parent when missing, so winsock and PATH-dependent children keep
 *   working; the child's PATH (its own, or the merged parent's) is what
 *   the executable search walks, like uv_spawn.
 * - stdio is HANDLE inheritance: anonymous pipes for capture and the
 *   child.stdout/stderr streams (PeekNamedPipe polls readiness —
 *   anonymous pipes cannot overlap), NUL for ignore, duplicated std
 *   handles for inherit, _get_osfhandle for the fd form, PIPE_NOWAIT on
 *   the input pipe's write end so the sync feed never blocks.
 * - There are no signals: kill/killSignal for SIGTERM/SIGKILL/SIGINT/
 *   SIGQUIT/SIGHUP is TerminateProcess(handle, 1) with the signal NAME
 *   reported on the result/exit event, libuv's uv_kill emulation (a
 *   killed child's status is null + the signal name; nothing else can
 *   die "to a signal"). Other names answer false (libuv: ENOSYS).
 * - The async family rides the loop's existing hooks: scr_children_wait
 *   waits on the child process HANDLES (WaitForMultipleObjects) so an
 *   exit wakes the quiescent sleep immediately; piped streams with a
 *   consumer and pending spawn failures DECLINE the wait, keeping the
 *   loop's ~1ms polling cap (pipe readability has no waitable handle),
 *   exactly the POSIX arm's unwatched fallback.
 * - execSync's shell is lowered as /bin/sh at compile time, which
 *   resolves ENOENT here where Windows Node would run cmd.exe — the
 *   documented shell fence until a cmd.exe story exists (SEMANTICS).
 * - libuv also assigns children to a kill-on-parent-death job object;
 *   this arm does not (a parent crash can orphan a running child — the
 *   sync cores always reap or kill before returning). */

#include <windows.h>

#include <io.h>
#include <signal.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>

/* uv's emulated numbers for the rows mingw's signal.h lacks (the same
 * values scr_lib.c's name table uses). */
#ifndef SIGHUP
#define SIGHUP 1
#endif
#ifndef SIGQUIT
#define SIGQUIT 3
#endif
#ifndef SIGKILL
#define SIGKILL 9
#endif

static void scr_child_oom(void) {
  fputs("scriptc: out of memory\n", stderr);
  abort();
}

/* ── small helpers ───────────────────────────────────────────────────── */

/* utf8 (the runtime's strings) → malloc'd, NUL-terminated UTF-16. */
static WCHAR *scr_child_wide(const char *s, size_t len) {
  int n = len > 0 ? MultiByteToWideChar(CP_UTF8, 0, s, (int)len, NULL, 0) : 0;
  WCHAR *w = malloc(((size_t)n + 1) * sizeof(WCHAR));
  if (!w) scr_child_oom();
  if (n > 0) MultiByteToWideChar(CP_UTF8, 0, s, (int)len, w, n);
  w[n] = L'\0';
  return w;
}

/* Node's error-code names for the failures a spawn can hit (libuv's
 * sys-error translation, the reachable rows). */
static const char *scr_win_errname(DWORD err) {
  switch (err) {
  case ERROR_FILE_NOT_FOUND:
  case ERROR_PATH_NOT_FOUND:
  case ERROR_INVALID_NAME:
  case ERROR_DIRECTORY:
  case ERROR_BAD_PATHNAME:
    return "ENOENT";
  case ERROR_ACCESS_DENIED:
    return "EACCES";
  case ERROR_NOT_ENOUGH_MEMORY:
  case ERROR_OUTOFMEMORY:
    return "ENOMEM";
  case ERROR_BAD_EXE_FORMAT:
    return "EFTYPE"; /* libuv's map for a non-PE spawn target */
  default:
    return "EUNKNOWN";
  }
}

/* child.exitCode after a spawn-failure settle: Node flips it to the
 * NEGATIVE uv errno, whose values are Windows-specific (uv-errno.h). */
static int scr_win_uv_errno(const char *name) {
  if (strcmp(name, "ENOENT") == 0) return -4058;
  if (strcmp(name, "EACCES") == 0) return -4092;
  return -4094; /* UV_UNKNOWN */
}

/* ── libuv's quote_cmd_arg, ported exactly ───────────────────────────── */

/* Quotes one argument into `target` (caller sized it: 2*len + 2 worst
 * case); returns the next write position. The three tiers and the
 * reverse-scan escape are libuv's, byte-for-byte — Windows Node builds
 * its child command lines with this exact function, so matching it IS
 * the parity story (CommandLineToArgvW round-trips every case). */
static WCHAR *scr_quote_cmd_arg(const WCHAR *source, WCHAR *target) {
  size_t len = wcslen(source);
  size_t i;
  int quote_hit;
  WCHAR *start;

  if (len == 0) {
    /* Need double quotation for empty argument. */
    *(target++) = L'"';
    *(target++) = L'"';
    return target;
  }

  if (NULL == wcspbrk(source, L" \t\"")) {
    /* No quotation needed. */
    wcsncpy(target, source, len);
    target += len;
    return target;
  }

  if (NULL == wcspbrk(source, L"\"\\")) {
    /* No embedded double quotes or backslashes: wrap in quote marks. */
    *(target++) = L'"';
    wcsncpy(target, source, len);
    target += len;
    *(target++) = L'"';
    return target;
  }

  /* The expensive way: reverse scan so a backslash doubles exactly when
   * a quote (or the closing wrap) follows it.
   *   hello"world    → "hello\"world"
   *   hello\world    → hello\world (tier 2 caught it — unreachable here)
   *   hello\"world   → "hello\\\"world"
   *   hello world\   → "hello world\\" */
  *(target++) = L'"';
  start = target;
  quote_hit = 1;
  for (i = len; i > 0; --i) {
    *(target++) = source[i - 1];
    if (quote_hit && source[i - 1] == L'\\') {
      *(target++) = L'\\';
    } else if (source[i - 1] == L'"') {
      quote_hit = 1;
      *(target++) = L'\\';
    } else {
      quote_hit = 0;
    }
  }
  target[0] = L'\0';
  _wcsrev(start);
  *(target++) = L'"';
  return target;
}

/* cmd + args → the full malloc'd command line (argv[0] is the command AS
 * TYPED — CreateProcessW's lpApplicationName carries the resolved path,
 * so the child's argv[0] stays the caller's spelling, like Node).
 *
 * `verbatim` is libuv's UV_PROCESS_WINDOWS_VERBATIM_ARGUMENTS: the args
 * are joined with single spaces and NOT quoted, the caller having already
 * written the exact command line it wants. Node sets it for exactly one
 * caller — the Windows shell form, whose `"<command>"` wrapper cmd.exe
 * strips itself under /s and which quote_cmd_arg would otherwise escape
 * into `\"<command>\"`. */
static WCHAR *scr_child_cmdline(ScrStr *cmd, ScrArr *args, bool verbatim) {
  size_t n = (size_t)scr_arr_len(args);
  size_t argc = n + 1;
  WCHAR **wargs = malloc(argc * sizeof(WCHAR *));
  if (!wargs) scr_child_oom();
  wargs[0] = scr_child_wide(cmd->data, cmd->len);
  for (size_t i = 0; i < n; i++) {
    ScrStr *s = (ScrStr *)scr_arr_get_ref(args, (double)i);
    wargs[i + 1] = scr_child_wide(s->data, s->len);
    scr_str_release(s);
  }
  size_t total = 1; /* the terminator */
  for (size_t i = 0; i < argc; i++) total += wcslen(wargs[i]) * 2 + 3;
  WCHAR *dst = malloc(total * sizeof(WCHAR));
  if (!dst) scr_child_oom();
  WCHAR *pos = dst;
  for (size_t i = 0; i < argc; i++) {
    if (verbatim) {
      size_t len = wcslen(wargs[i]);
      memcpy(pos, wargs[i], len * sizeof(WCHAR));
      pos += len;
    } else {
      pos = scr_quote_cmd_arg(wargs[i], pos);
    }
    *pos++ = i + 1 < argc ? L' ' : L'\0';
    free(wargs[i]);
  }
  free(wargs);
  return dst;
}

/* ── the environment block (libuv's make_program_env) ────────────────── */

/* Ordinal case-insensitive key comparison — libuv's env_strncmp: keys
 * run to the first '='; na < 0 means "find it in a". */
static int scr_env_keycmp(const WCHAR *a, int na, const WCHAR *b) {
  if (na < 0) {
    const WCHAR *a_eq = wcschr(a, L'=');
    na = a_eq != NULL ? (int)(a_eq - a) : (int)wcslen(a);
  }
  const WCHAR *b_eq = wcschr(b, L'=');
  int nb = b_eq != NULL ? (int)(b_eq - b) : (int)wcslen(b);
  return CompareStringOrdinal(a, na, b, nb, TRUE) - CSTR_EQUAL;
}

/* A TOTAL order, so the sort needs no stability (mingw's qsort is not stable, glibc's keeps tie order): keys that differ only in case tie on the
 * ordinal case-insensitive compare, and then order by UTF-16 code unit, which is exactly the order JS's default Array#sort gives the keys in
 * lib/child_process.js's win32 branch ('FOO' before 'Foo' before 'foo'). */
static int scr_env_qsortcmp(const void *a, const void *b) {
  const WCHAR *x = *(WCHAR *const *)a, *y = *(WCHAR *const *)b;
  int c = scr_env_keycmp(x, -1, y);
  return c != 0 ? c : wcscmp(x, y);
}

/* libuv's required vars: winsock fails to initialize without SYSTEMROOT,
 * PATH keeps executable search alive, TEMP feeds every temp-file API —
 * a replaced env inherits these from the parent when it does not set
 * them itself. Keys only (values fetched live). */
static const WCHAR *const scr_env_required[] = {
    L"HOMEDRIVE", L"HOMEPATH", L"LOGONSERVER",  L"PATH",     L"SYSTEMDRIVE",
    L"SYSTEMROOT", L"TEMP",    L"USERDOMAIN",   L"USERNAME", L"USERPROFILE",
};

/* ── JS String.prototype.toUpperCase over UTF-16 (the env key filter) ──── */

static const struct { uint32_t cp, r[3]; } scr_env_upper_tab[] = {
    {0x61, 0x41, 0x0, 0x0}, {0x62, 0x42, 0x0, 0x0}, {0x63, 0x43, 0x0, 0x0},
    {0x64, 0x44, 0x0, 0x0}, {0x65, 0x45, 0x0, 0x0}, {0x66, 0x46, 0x0, 0x0},
    {0x67, 0x47, 0x0, 0x0}, {0x68, 0x48, 0x0, 0x0}, {0x69, 0x49, 0x0, 0x0},
    {0x6A, 0x4A, 0x0, 0x0}, {0x6B, 0x4B, 0x0, 0x0}, {0x6C, 0x4C, 0x0, 0x0},
    {0x6D, 0x4D, 0x0, 0x0}, {0x6E, 0x4E, 0x0, 0x0}, {0x6F, 0x4F, 0x0, 0x0},
    {0x70, 0x50, 0x0, 0x0}, {0x71, 0x51, 0x0, 0x0}, {0x72, 0x52, 0x0, 0x0},
    {0x73, 0x53, 0x0, 0x0}, {0x74, 0x54, 0x0, 0x0}, {0x75, 0x55, 0x0, 0x0},
    {0x76, 0x56, 0x0, 0x0}, {0x77, 0x57, 0x0, 0x0}, {0x78, 0x58, 0x0, 0x0},
    {0x79, 0x59, 0x0, 0x0}, {0x7A, 0x5A, 0x0, 0x0}, {0xB5, 0x39C, 0x0, 0x0},
    {0xDF, 0x53, 0x53, 0x0}, {0xE0, 0xC0, 0x0, 0x0}, {0xE1, 0xC1, 0x0, 0x0},
    {0xE2, 0xC2, 0x0, 0x0}, {0xE3, 0xC3, 0x0, 0x0}, {0xE4, 0xC4, 0x0, 0x0},
    {0xE5, 0xC5, 0x0, 0x0}, {0xE6, 0xC6, 0x0, 0x0}, {0xE7, 0xC7, 0x0, 0x0},
    {0xE8, 0xC8, 0x0, 0x0}, {0xE9, 0xC9, 0x0, 0x0}, {0xEA, 0xCA, 0x0, 0x0},
    {0xEB, 0xCB, 0x0, 0x0}, {0xEC, 0xCC, 0x0, 0x0}, {0xED, 0xCD, 0x0, 0x0},
    {0xEE, 0xCE, 0x0, 0x0}, {0xEF, 0xCF, 0x0, 0x0}, {0xF0, 0xD0, 0x0, 0x0},
    {0xF1, 0xD1, 0x0, 0x0}, {0xF2, 0xD2, 0x0, 0x0}, {0xF3, 0xD3, 0x0, 0x0},
    {0xF4, 0xD4, 0x0, 0x0}, {0xF5, 0xD5, 0x0, 0x0}, {0xF6, 0xD6, 0x0, 0x0},
    {0xF8, 0xD8, 0x0, 0x0}, {0xF9, 0xD9, 0x0, 0x0}, {0xFA, 0xDA, 0x0, 0x0},
    {0xFB, 0xDB, 0x0, 0x0}, {0xFC, 0xDC, 0x0, 0x0}, {0xFD, 0xDD, 0x0, 0x0},
    {0xFE, 0xDE, 0x0, 0x0}, {0xFF, 0x178, 0x0, 0x0}, {0x101, 0x100, 0x0, 0x0},
    {0x103, 0x102, 0x0, 0x0}, {0x105, 0x104, 0x0, 0x0}, {0x107, 0x106, 0x0, 0x0},
    {0x109, 0x108, 0x0, 0x0}, {0x10B, 0x10A, 0x0, 0x0}, {0x10D, 0x10C, 0x0, 0x0},
    {0x10F, 0x10E, 0x0, 0x0}, {0x111, 0x110, 0x0, 0x0}, {0x113, 0x112, 0x0, 0x0},
    {0x115, 0x114, 0x0, 0x0}, {0x117, 0x116, 0x0, 0x0}, {0x119, 0x118, 0x0, 0x0},
    {0x11B, 0x11A, 0x0, 0x0}, {0x11D, 0x11C, 0x0, 0x0}, {0x11F, 0x11E, 0x0, 0x0},
    {0x121, 0x120, 0x0, 0x0}, {0x123, 0x122, 0x0, 0x0}, {0x125, 0x124, 0x0, 0x0},
    {0x127, 0x126, 0x0, 0x0}, {0x129, 0x128, 0x0, 0x0}, {0x12B, 0x12A, 0x0, 0x0},
    {0x12D, 0x12C, 0x0, 0x0}, {0x12F, 0x12E, 0x0, 0x0}, {0x131, 0x49, 0x0, 0x0},
    {0x133, 0x132, 0x0, 0x0}, {0x135, 0x134, 0x0, 0x0}, {0x137, 0x136, 0x0, 0x0},
    {0x13A, 0x139, 0x0, 0x0}, {0x13C, 0x13B, 0x0, 0x0}, {0x13E, 0x13D, 0x0, 0x0},
    {0x140, 0x13F, 0x0, 0x0}, {0x142, 0x141, 0x0, 0x0}, {0x144, 0x143, 0x0, 0x0},
    {0x146, 0x145, 0x0, 0x0}, {0x148, 0x147, 0x0, 0x0}, {0x149, 0x2BC, 0x4E, 0x0},
    {0x14B, 0x14A, 0x0, 0x0}, {0x14D, 0x14C, 0x0, 0x0}, {0x14F, 0x14E, 0x0, 0x0},
    {0x151, 0x150, 0x0, 0x0}, {0x153, 0x152, 0x0, 0x0}, {0x155, 0x154, 0x0, 0x0},
    {0x157, 0x156, 0x0, 0x0}, {0x159, 0x158, 0x0, 0x0}, {0x15B, 0x15A, 0x0, 0x0},
    {0x15D, 0x15C, 0x0, 0x0}, {0x15F, 0x15E, 0x0, 0x0}, {0x161, 0x160, 0x0, 0x0},
    {0x163, 0x162, 0x0, 0x0}, {0x165, 0x164, 0x0, 0x0}, {0x167, 0x166, 0x0, 0x0},
    {0x169, 0x168, 0x0, 0x0}, {0x16B, 0x16A, 0x0, 0x0}, {0x16D, 0x16C, 0x0, 0x0},
    {0x16F, 0x16E, 0x0, 0x0}, {0x171, 0x170, 0x0, 0x0}, {0x173, 0x172, 0x0, 0x0},
    {0x175, 0x174, 0x0, 0x0}, {0x177, 0x176, 0x0, 0x0}, {0x17A, 0x179, 0x0, 0x0},
    {0x17C, 0x17B, 0x0, 0x0}, {0x17E, 0x17D, 0x0, 0x0}, {0x17F, 0x53, 0x0, 0x0},
    {0x180, 0x243, 0x0, 0x0}, {0x183, 0x182, 0x0, 0x0}, {0x185, 0x184, 0x0, 0x0},
    {0x188, 0x187, 0x0, 0x0}, {0x18C, 0x18B, 0x0, 0x0}, {0x192, 0x191, 0x0, 0x0},
    {0x195, 0x1F6, 0x0, 0x0}, {0x199, 0x198, 0x0, 0x0}, {0x19A, 0x23D, 0x0, 0x0},
    {0x19B, 0xA7DC, 0x0, 0x0}, {0x19E, 0x220, 0x0, 0x0}, {0x1A1, 0x1A0, 0x0, 0x0},
    {0x1A3, 0x1A2, 0x0, 0x0}, {0x1A5, 0x1A4, 0x0, 0x0}, {0x1A8, 0x1A7, 0x0, 0x0},
    {0x1AD, 0x1AC, 0x0, 0x0}, {0x1B0, 0x1AF, 0x0, 0x0}, {0x1B4, 0x1B3, 0x0, 0x0},
    {0x1B6, 0x1B5, 0x0, 0x0}, {0x1B9, 0x1B8, 0x0, 0x0}, {0x1BD, 0x1BC, 0x0, 0x0},
    {0x1BF, 0x1F7, 0x0, 0x0}, {0x1C5, 0x1C4, 0x0, 0x0}, {0x1C6, 0x1C4, 0x0, 0x0},
    {0x1C8, 0x1C7, 0x0, 0x0}, {0x1C9, 0x1C7, 0x0, 0x0}, {0x1CB, 0x1CA, 0x0, 0x0},
    {0x1CC, 0x1CA, 0x0, 0x0}, {0x1CE, 0x1CD, 0x0, 0x0}, {0x1D0, 0x1CF, 0x0, 0x0},
    {0x1D2, 0x1D1, 0x0, 0x0}, {0x1D4, 0x1D3, 0x0, 0x0}, {0x1D6, 0x1D5, 0x0, 0x0},
    {0x1D8, 0x1D7, 0x0, 0x0}, {0x1DA, 0x1D9, 0x0, 0x0}, {0x1DC, 0x1DB, 0x0, 0x0},
    {0x1DD, 0x18E, 0x0, 0x0}, {0x1DF, 0x1DE, 0x0, 0x0}, {0x1E1, 0x1E0, 0x0, 0x0},
    {0x1E3, 0x1E2, 0x0, 0x0}, {0x1E5, 0x1E4, 0x0, 0x0}, {0x1E7, 0x1E6, 0x0, 0x0},
    {0x1E9, 0x1E8, 0x0, 0x0}, {0x1EB, 0x1EA, 0x0, 0x0}, {0x1ED, 0x1EC, 0x0, 0x0},
    {0x1EF, 0x1EE, 0x0, 0x0}, {0x1F0, 0x4A, 0x30C, 0x0}, {0x1F2, 0x1F1, 0x0, 0x0},
    {0x1F3, 0x1F1, 0x0, 0x0}, {0x1F5, 0x1F4, 0x0, 0x0}, {0x1F9, 0x1F8, 0x0, 0x0},
    {0x1FB, 0x1FA, 0x0, 0x0}, {0x1FD, 0x1FC, 0x0, 0x0}, {0x1FF, 0x1FE, 0x0, 0x0},
    {0x201, 0x200, 0x0, 0x0}, {0x203, 0x202, 0x0, 0x0}, {0x205, 0x204, 0x0, 0x0},
    {0x207, 0x206, 0x0, 0x0}, {0x209, 0x208, 0x0, 0x0}, {0x20B, 0x20A, 0x0, 0x0},
    {0x20D, 0x20C, 0x0, 0x0}, {0x20F, 0x20E, 0x0, 0x0}, {0x211, 0x210, 0x0, 0x0},
    {0x213, 0x212, 0x0, 0x0}, {0x215, 0x214, 0x0, 0x0}, {0x217, 0x216, 0x0, 0x0},
    {0x219, 0x218, 0x0, 0x0}, {0x21B, 0x21A, 0x0, 0x0}, {0x21D, 0x21C, 0x0, 0x0},
    {0x21F, 0x21E, 0x0, 0x0}, {0x223, 0x222, 0x0, 0x0}, {0x225, 0x224, 0x0, 0x0},
    {0x227, 0x226, 0x0, 0x0}, {0x229, 0x228, 0x0, 0x0}, {0x22B, 0x22A, 0x0, 0x0},
    {0x22D, 0x22C, 0x0, 0x0}, {0x22F, 0x22E, 0x0, 0x0}, {0x231, 0x230, 0x0, 0x0},
    {0x233, 0x232, 0x0, 0x0}, {0x23C, 0x23B, 0x0, 0x0}, {0x23F, 0x2C7E, 0x0, 0x0},
    {0x240, 0x2C7F, 0x0, 0x0}, {0x242, 0x241, 0x0, 0x0}, {0x247, 0x246, 0x0, 0x0},
    {0x249, 0x248, 0x0, 0x0}, {0x24B, 0x24A, 0x0, 0x0}, {0x24D, 0x24C, 0x0, 0x0},
    {0x24F, 0x24E, 0x0, 0x0}, {0x250, 0x2C6F, 0x0, 0x0}, {0x251, 0x2C6D, 0x0, 0x0},
    {0x252, 0x2C70, 0x0, 0x0}, {0x253, 0x181, 0x0, 0x0}, {0x254, 0x186, 0x0, 0x0},
    {0x256, 0x189, 0x0, 0x0}, {0x257, 0x18A, 0x0, 0x0}, {0x259, 0x18F, 0x0, 0x0},
    {0x25B, 0x190, 0x0, 0x0}, {0x25C, 0xA7AB, 0x0, 0x0}, {0x260, 0x193, 0x0, 0x0},
    {0x261, 0xA7AC, 0x0, 0x0}, {0x263, 0x194, 0x0, 0x0}, {0x264, 0xA7CB, 0x0, 0x0},
    {0x265, 0xA78D, 0x0, 0x0}, {0x266, 0xA7AA, 0x0, 0x0}, {0x268, 0x197, 0x0, 0x0},
    {0x269, 0x196, 0x0, 0x0}, {0x26A, 0xA7AE, 0x0, 0x0}, {0x26B, 0x2C62, 0x0, 0x0},
    {0x26C, 0xA7AD, 0x0, 0x0}, {0x26F, 0x19C, 0x0, 0x0}, {0x271, 0x2C6E, 0x0, 0x0},
    {0x272, 0x19D, 0x0, 0x0}, {0x275, 0x19F, 0x0, 0x0}, {0x27D, 0x2C64, 0x0, 0x0},
    {0x280, 0x1A6, 0x0, 0x0}, {0x282, 0xA7C5, 0x0, 0x0}, {0x283, 0x1A9, 0x0, 0x0},
    {0x287, 0xA7B1, 0x0, 0x0}, {0x288, 0x1AE, 0x0, 0x0}, {0x289, 0x244, 0x0, 0x0},
    {0x28A, 0x1B1, 0x0, 0x0}, {0x28B, 0x1B2, 0x0, 0x0}, {0x28C, 0x245, 0x0, 0x0},
    {0x292, 0x1B7, 0x0, 0x0}, {0x29D, 0xA7B2, 0x0, 0x0}, {0x29E, 0xA7B0, 0x0, 0x0},
    {0x345, 0x399, 0x0, 0x0}, {0x371, 0x370, 0x0, 0x0}, {0x373, 0x372, 0x0, 0x0},
    {0x377, 0x376, 0x0, 0x0}, {0x37B, 0x3FD, 0x0, 0x0}, {0x37C, 0x3FE, 0x0, 0x0},
    {0x37D, 0x3FF, 0x0, 0x0}, {0x390, 0x399, 0x308, 0x301}, {0x3AC, 0x386, 0x0, 0x0},
    {0x3AD, 0x388, 0x0, 0x0}, {0x3AE, 0x389, 0x0, 0x0}, {0x3AF, 0x38A, 0x0, 0x0},
    {0x3B0, 0x3A5, 0x308, 0x301}, {0x3B1, 0x391, 0x0, 0x0}, {0x3B2, 0x392, 0x0, 0x0},
    {0x3B3, 0x393, 0x0, 0x0}, {0x3B4, 0x394, 0x0, 0x0}, {0x3B5, 0x395, 0x0, 0x0},
    {0x3B6, 0x396, 0x0, 0x0}, {0x3B7, 0x397, 0x0, 0x0}, {0x3B8, 0x398, 0x0, 0x0},
    {0x3B9, 0x399, 0x0, 0x0}, {0x3BA, 0x39A, 0x0, 0x0}, {0x3BB, 0x39B, 0x0, 0x0},
    {0x3BC, 0x39C, 0x0, 0x0}, {0x3BD, 0x39D, 0x0, 0x0}, {0x3BE, 0x39E, 0x0, 0x0},
    {0x3BF, 0x39F, 0x0, 0x0}, {0x3C0, 0x3A0, 0x0, 0x0}, {0x3C1, 0x3A1, 0x0, 0x0},
    {0x3C2, 0x3A3, 0x0, 0x0}, {0x3C3, 0x3A3, 0x0, 0x0}, {0x3C4, 0x3A4, 0x0, 0x0},
    {0x3C5, 0x3A5, 0x0, 0x0}, {0x3C6, 0x3A6, 0x0, 0x0}, {0x3C7, 0x3A7, 0x0, 0x0},
    {0x3C8, 0x3A8, 0x0, 0x0}, {0x3C9, 0x3A9, 0x0, 0x0}, {0x3CA, 0x3AA, 0x0, 0x0},
    {0x3CB, 0x3AB, 0x0, 0x0}, {0x3CC, 0x38C, 0x0, 0x0}, {0x3CD, 0x38E, 0x0, 0x0},
    {0x3CE, 0x38F, 0x0, 0x0}, {0x3D0, 0x392, 0x0, 0x0}, {0x3D1, 0x398, 0x0, 0x0},
    {0x3D5, 0x3A6, 0x0, 0x0}, {0x3D6, 0x3A0, 0x0, 0x0}, {0x3D7, 0x3CF, 0x0, 0x0},
    {0x3D9, 0x3D8, 0x0, 0x0}, {0x3DB, 0x3DA, 0x0, 0x0}, {0x3DD, 0x3DC, 0x0, 0x0},
    {0x3DF, 0x3DE, 0x0, 0x0}, {0x3E1, 0x3E0, 0x0, 0x0}, {0x3E3, 0x3E2, 0x0, 0x0},
    {0x3E5, 0x3E4, 0x0, 0x0}, {0x3E7, 0x3E6, 0x0, 0x0}, {0x3E9, 0x3E8, 0x0, 0x0},
    {0x3EB, 0x3EA, 0x0, 0x0}, {0x3ED, 0x3EC, 0x0, 0x0}, {0x3EF, 0x3EE, 0x0, 0x0},
    {0x3F0, 0x39A, 0x0, 0x0}, {0x3F1, 0x3A1, 0x0, 0x0}, {0x3F2, 0x3F9, 0x0, 0x0},
    {0x3F3, 0x37F, 0x0, 0x0}, {0x3F5, 0x395, 0x0, 0x0}, {0x3F8, 0x3F7, 0x0, 0x0},
    {0x3FB, 0x3FA, 0x0, 0x0}, {0x430, 0x410, 0x0, 0x0}, {0x431, 0x411, 0x0, 0x0},
    {0x432, 0x412, 0x0, 0x0}, {0x433, 0x413, 0x0, 0x0}, {0x434, 0x414, 0x0, 0x0},
    {0x435, 0x415, 0x0, 0x0}, {0x436, 0x416, 0x0, 0x0}, {0x437, 0x417, 0x0, 0x0},
    {0x438, 0x418, 0x0, 0x0}, {0x439, 0x419, 0x0, 0x0}, {0x43A, 0x41A, 0x0, 0x0},
    {0x43B, 0x41B, 0x0, 0x0}, {0x43C, 0x41C, 0x0, 0x0}, {0x43D, 0x41D, 0x0, 0x0},
    {0x43E, 0x41E, 0x0, 0x0}, {0x43F, 0x41F, 0x0, 0x0}, {0x440, 0x420, 0x0, 0x0},
    {0x441, 0x421, 0x0, 0x0}, {0x442, 0x422, 0x0, 0x0}, {0x443, 0x423, 0x0, 0x0},
    {0x444, 0x424, 0x0, 0x0}, {0x445, 0x425, 0x0, 0x0}, {0x446, 0x426, 0x0, 0x0},
    {0x447, 0x427, 0x0, 0x0}, {0x448, 0x428, 0x0, 0x0}, {0x449, 0x429, 0x0, 0x0},
    {0x44A, 0x42A, 0x0, 0x0}, {0x44B, 0x42B, 0x0, 0x0}, {0x44C, 0x42C, 0x0, 0x0},
    {0x44D, 0x42D, 0x0, 0x0}, {0x44E, 0x42E, 0x0, 0x0}, {0x44F, 0x42F, 0x0, 0x0},
    {0x450, 0x400, 0x0, 0x0}, {0x451, 0x401, 0x0, 0x0}, {0x452, 0x402, 0x0, 0x0},
    {0x453, 0x403, 0x0, 0x0}, {0x454, 0x404, 0x0, 0x0}, {0x455, 0x405, 0x0, 0x0},
    {0x456, 0x406, 0x0, 0x0}, {0x457, 0x407, 0x0, 0x0}, {0x458, 0x408, 0x0, 0x0},
    {0x459, 0x409, 0x0, 0x0}, {0x45A, 0x40A, 0x0, 0x0}, {0x45B, 0x40B, 0x0, 0x0},
    {0x45C, 0x40C, 0x0, 0x0}, {0x45D, 0x40D, 0x0, 0x0}, {0x45E, 0x40E, 0x0, 0x0},
    {0x45F, 0x40F, 0x0, 0x0}, {0x461, 0x460, 0x0, 0x0}, {0x463, 0x462, 0x0, 0x0},
    {0x465, 0x464, 0x0, 0x0}, {0x467, 0x466, 0x0, 0x0}, {0x469, 0x468, 0x0, 0x0},
    {0x46B, 0x46A, 0x0, 0x0}, {0x46D, 0x46C, 0x0, 0x0}, {0x46F, 0x46E, 0x0, 0x0},
    {0x471, 0x470, 0x0, 0x0}, {0x473, 0x472, 0x0, 0x0}, {0x475, 0x474, 0x0, 0x0},
    {0x477, 0x476, 0x0, 0x0}, {0x479, 0x478, 0x0, 0x0}, {0x47B, 0x47A, 0x0, 0x0},
    {0x47D, 0x47C, 0x0, 0x0}, {0x47F, 0x47E, 0x0, 0x0}, {0x481, 0x480, 0x0, 0x0},
    {0x48B, 0x48A, 0x0, 0x0}, {0x48D, 0x48C, 0x0, 0x0}, {0x48F, 0x48E, 0x0, 0x0},
    {0x491, 0x490, 0x0, 0x0}, {0x493, 0x492, 0x0, 0x0}, {0x495, 0x494, 0x0, 0x0},
    {0x497, 0x496, 0x0, 0x0}, {0x499, 0x498, 0x0, 0x0}, {0x49B, 0x49A, 0x0, 0x0},
    {0x49D, 0x49C, 0x0, 0x0}, {0x49F, 0x49E, 0x0, 0x0}, {0x4A1, 0x4A0, 0x0, 0x0},
    {0x4A3, 0x4A2, 0x0, 0x0}, {0x4A5, 0x4A4, 0x0, 0x0}, {0x4A7, 0x4A6, 0x0, 0x0},
    {0x4A9, 0x4A8, 0x0, 0x0}, {0x4AB, 0x4AA, 0x0, 0x0}, {0x4AD, 0x4AC, 0x0, 0x0},
    {0x4AF, 0x4AE, 0x0, 0x0}, {0x4B1, 0x4B0, 0x0, 0x0}, {0x4B3, 0x4B2, 0x0, 0x0},
    {0x4B5, 0x4B4, 0x0, 0x0}, {0x4B7, 0x4B6, 0x0, 0x0}, {0x4B9, 0x4B8, 0x0, 0x0},
    {0x4BB, 0x4BA, 0x0, 0x0}, {0x4BD, 0x4BC, 0x0, 0x0}, {0x4BF, 0x4BE, 0x0, 0x0},
    {0x4C2, 0x4C1, 0x0, 0x0}, {0x4C4, 0x4C3, 0x0, 0x0}, {0x4C6, 0x4C5, 0x0, 0x0},
    {0x4C8, 0x4C7, 0x0, 0x0}, {0x4CA, 0x4C9, 0x0, 0x0}, {0x4CC, 0x4CB, 0x0, 0x0},
    {0x4CE, 0x4CD, 0x0, 0x0}, {0x4CF, 0x4C0, 0x0, 0x0}, {0x4D1, 0x4D0, 0x0, 0x0},
    {0x4D3, 0x4D2, 0x0, 0x0}, {0x4D5, 0x4D4, 0x0, 0x0}, {0x4D7, 0x4D6, 0x0, 0x0},
    {0x4D9, 0x4D8, 0x0, 0x0}, {0x4DB, 0x4DA, 0x0, 0x0}, {0x4DD, 0x4DC, 0x0, 0x0},
    {0x4DF, 0x4DE, 0x0, 0x0}, {0x4E1, 0x4E0, 0x0, 0x0}, {0x4E3, 0x4E2, 0x0, 0x0},
    {0x4E5, 0x4E4, 0x0, 0x0}, {0x4E7, 0x4E6, 0x0, 0x0}, {0x4E9, 0x4E8, 0x0, 0x0},
    {0x4EB, 0x4EA, 0x0, 0x0}, {0x4ED, 0x4EC, 0x0, 0x0}, {0x4EF, 0x4EE, 0x0, 0x0},
    {0x4F1, 0x4F0, 0x0, 0x0}, {0x4F3, 0x4F2, 0x0, 0x0}, {0x4F5, 0x4F4, 0x0, 0x0},
    {0x4F7, 0x4F6, 0x0, 0x0}, {0x4F9, 0x4F8, 0x0, 0x0}, {0x4FB, 0x4FA, 0x0, 0x0},
    {0x4FD, 0x4FC, 0x0, 0x0}, {0x4FF, 0x4FE, 0x0, 0x0}, {0x501, 0x500, 0x0, 0x0},
    {0x503, 0x502, 0x0, 0x0}, {0x505, 0x504, 0x0, 0x0}, {0x507, 0x506, 0x0, 0x0},
    {0x509, 0x508, 0x0, 0x0}, {0x50B, 0x50A, 0x0, 0x0}, {0x50D, 0x50C, 0x0, 0x0},
    {0x50F, 0x50E, 0x0, 0x0}, {0x511, 0x510, 0x0, 0x0}, {0x513, 0x512, 0x0, 0x0},
    {0x515, 0x514, 0x0, 0x0}, {0x517, 0x516, 0x0, 0x0}, {0x519, 0x518, 0x0, 0x0},
    {0x51B, 0x51A, 0x0, 0x0}, {0x51D, 0x51C, 0x0, 0x0}, {0x51F, 0x51E, 0x0, 0x0},
    {0x521, 0x520, 0x0, 0x0}, {0x523, 0x522, 0x0, 0x0}, {0x525, 0x524, 0x0, 0x0},
    {0x527, 0x526, 0x0, 0x0}, {0x529, 0x528, 0x0, 0x0}, {0x52B, 0x52A, 0x0, 0x0},
    {0x52D, 0x52C, 0x0, 0x0}, {0x52F, 0x52E, 0x0, 0x0}, {0x561, 0x531, 0x0, 0x0},
    {0x562, 0x532, 0x0, 0x0}, {0x563, 0x533, 0x0, 0x0}, {0x564, 0x534, 0x0, 0x0},
    {0x565, 0x535, 0x0, 0x0}, {0x566, 0x536, 0x0, 0x0}, {0x567, 0x537, 0x0, 0x0},
    {0x568, 0x538, 0x0, 0x0}, {0x569, 0x539, 0x0, 0x0}, {0x56A, 0x53A, 0x0, 0x0},
    {0x56B, 0x53B, 0x0, 0x0}, {0x56C, 0x53C, 0x0, 0x0}, {0x56D, 0x53D, 0x0, 0x0},
    {0x56E, 0x53E, 0x0, 0x0}, {0x56F, 0x53F, 0x0, 0x0}, {0x570, 0x540, 0x0, 0x0},
    {0x571, 0x541, 0x0, 0x0}, {0x572, 0x542, 0x0, 0x0}, {0x573, 0x543, 0x0, 0x0},
    {0x574, 0x544, 0x0, 0x0}, {0x575, 0x545, 0x0, 0x0}, {0x576, 0x546, 0x0, 0x0},
    {0x577, 0x547, 0x0, 0x0}, {0x578, 0x548, 0x0, 0x0}, {0x579, 0x549, 0x0, 0x0},
    {0x57A, 0x54A, 0x0, 0x0}, {0x57B, 0x54B, 0x0, 0x0}, {0x57C, 0x54C, 0x0, 0x0},
    {0x57D, 0x54D, 0x0, 0x0}, {0x57E, 0x54E, 0x0, 0x0}, {0x57F, 0x54F, 0x0, 0x0},
    {0x580, 0x550, 0x0, 0x0}, {0x581, 0x551, 0x0, 0x0}, {0x582, 0x552, 0x0, 0x0},
    {0x583, 0x553, 0x0, 0x0}, {0x584, 0x554, 0x0, 0x0}, {0x585, 0x555, 0x0, 0x0},
    {0x586, 0x556, 0x0, 0x0}, {0x587, 0x535, 0x552, 0x0}, {0x10D0, 0x1C90, 0x0, 0x0},
    {0x10D1, 0x1C91, 0x0, 0x0}, {0x10D2, 0x1C92, 0x0, 0x0}, {0x10D3, 0x1C93, 0x0, 0x0},
    {0x10D4, 0x1C94, 0x0, 0x0}, {0x10D5, 0x1C95, 0x0, 0x0}, {0x10D6, 0x1C96, 0x0, 0x0},
    {0x10D7, 0x1C97, 0x0, 0x0}, {0x10D8, 0x1C98, 0x0, 0x0}, {0x10D9, 0x1C99, 0x0, 0x0},
    {0x10DA, 0x1C9A, 0x0, 0x0}, {0x10DB, 0x1C9B, 0x0, 0x0}, {0x10DC, 0x1C9C, 0x0, 0x0},
    {0x10DD, 0x1C9D, 0x0, 0x0}, {0x10DE, 0x1C9E, 0x0, 0x0}, {0x10DF, 0x1C9F, 0x0, 0x0},
    {0x10E0, 0x1CA0, 0x0, 0x0}, {0x10E1, 0x1CA1, 0x0, 0x0}, {0x10E2, 0x1CA2, 0x0, 0x0},
    {0x10E3, 0x1CA3, 0x0, 0x0}, {0x10E4, 0x1CA4, 0x0, 0x0}, {0x10E5, 0x1CA5, 0x0, 0x0},
    {0x10E6, 0x1CA6, 0x0, 0x0}, {0x10E7, 0x1CA7, 0x0, 0x0}, {0x10E8, 0x1CA8, 0x0, 0x0},
    {0x10E9, 0x1CA9, 0x0, 0x0}, {0x10EA, 0x1CAA, 0x0, 0x0}, {0x10EB, 0x1CAB, 0x0, 0x0},
    {0x10EC, 0x1CAC, 0x0, 0x0}, {0x10ED, 0x1CAD, 0x0, 0x0}, {0x10EE, 0x1CAE, 0x0, 0x0},
    {0x10EF, 0x1CAF, 0x0, 0x0}, {0x10F0, 0x1CB0, 0x0, 0x0}, {0x10F1, 0x1CB1, 0x0, 0x0},
    {0x10F2, 0x1CB2, 0x0, 0x0}, {0x10F3, 0x1CB3, 0x0, 0x0}, {0x10F4, 0x1CB4, 0x0, 0x0},
    {0x10F5, 0x1CB5, 0x0, 0x0}, {0x10F6, 0x1CB6, 0x0, 0x0}, {0x10F7, 0x1CB7, 0x0, 0x0},
    {0x10F8, 0x1CB8, 0x0, 0x0}, {0x10F9, 0x1CB9, 0x0, 0x0}, {0x10FA, 0x1CBA, 0x0, 0x0},
    {0x10FD, 0x1CBD, 0x0, 0x0}, {0x10FE, 0x1CBE, 0x0, 0x0}, {0x10FF, 0x1CBF, 0x0, 0x0},
    {0x13F8, 0x13F0, 0x0, 0x0}, {0x13F9, 0x13F1, 0x0, 0x0}, {0x13FA, 0x13F2, 0x0, 0x0},
    {0x13FB, 0x13F3, 0x0, 0x0}, {0x13FC, 0x13F4, 0x0, 0x0}, {0x13FD, 0x13F5, 0x0, 0x0},
    {0x1C80, 0x412, 0x0, 0x0}, {0x1C81, 0x414, 0x0, 0x0}, {0x1C82, 0x41E, 0x0, 0x0},
    {0x1C83, 0x421, 0x0, 0x0}, {0x1C84, 0x422, 0x0, 0x0}, {0x1C85, 0x422, 0x0, 0x0},
    {0x1C86, 0x42A, 0x0, 0x0}, {0x1C87, 0x462, 0x0, 0x0}, {0x1C88, 0xA64A, 0x0, 0x0},
    {0x1C8A, 0x1C89, 0x0, 0x0}, {0x1D79, 0xA77D, 0x0, 0x0}, {0x1D7D, 0x2C63, 0x0, 0x0},
    {0x1D8E, 0xA7C6, 0x0, 0x0}, {0x1E01, 0x1E00, 0x0, 0x0}, {0x1E03, 0x1E02, 0x0, 0x0},
    {0x1E05, 0x1E04, 0x0, 0x0}, {0x1E07, 0x1E06, 0x0, 0x0}, {0x1E09, 0x1E08, 0x0, 0x0},
    {0x1E0B, 0x1E0A, 0x0, 0x0}, {0x1E0D, 0x1E0C, 0x0, 0x0}, {0x1E0F, 0x1E0E, 0x0, 0x0},
    {0x1E11, 0x1E10, 0x0, 0x0}, {0x1E13, 0x1E12, 0x0, 0x0}, {0x1E15, 0x1E14, 0x0, 0x0},
    {0x1E17, 0x1E16, 0x0, 0x0}, {0x1E19, 0x1E18, 0x0, 0x0}, {0x1E1B, 0x1E1A, 0x0, 0x0},
    {0x1E1D, 0x1E1C, 0x0, 0x0}, {0x1E1F, 0x1E1E, 0x0, 0x0}, {0x1E21, 0x1E20, 0x0, 0x0},
    {0x1E23, 0x1E22, 0x0, 0x0}, {0x1E25, 0x1E24, 0x0, 0x0}, {0x1E27, 0x1E26, 0x0, 0x0},
    {0x1E29, 0x1E28, 0x0, 0x0}, {0x1E2B, 0x1E2A, 0x0, 0x0}, {0x1E2D, 0x1E2C, 0x0, 0x0},
    {0x1E2F, 0x1E2E, 0x0, 0x0}, {0x1E31, 0x1E30, 0x0, 0x0}, {0x1E33, 0x1E32, 0x0, 0x0},
    {0x1E35, 0x1E34, 0x0, 0x0}, {0x1E37, 0x1E36, 0x0, 0x0}, {0x1E39, 0x1E38, 0x0, 0x0},
    {0x1E3B, 0x1E3A, 0x0, 0x0}, {0x1E3D, 0x1E3C, 0x0, 0x0}, {0x1E3F, 0x1E3E, 0x0, 0x0},
    {0x1E41, 0x1E40, 0x0, 0x0}, {0x1E43, 0x1E42, 0x0, 0x0}, {0x1E45, 0x1E44, 0x0, 0x0},
    {0x1E47, 0x1E46, 0x0, 0x0}, {0x1E49, 0x1E48, 0x0, 0x0}, {0x1E4B, 0x1E4A, 0x0, 0x0},
    {0x1E4D, 0x1E4C, 0x0, 0x0}, {0x1E4F, 0x1E4E, 0x0, 0x0}, {0x1E51, 0x1E50, 0x0, 0x0},
    {0x1E53, 0x1E52, 0x0, 0x0}, {0x1E55, 0x1E54, 0x0, 0x0}, {0x1E57, 0x1E56, 0x0, 0x0},
    {0x1E59, 0x1E58, 0x0, 0x0}, {0x1E5B, 0x1E5A, 0x0, 0x0}, {0x1E5D, 0x1E5C, 0x0, 0x0},
    {0x1E5F, 0x1E5E, 0x0, 0x0}, {0x1E61, 0x1E60, 0x0, 0x0}, {0x1E63, 0x1E62, 0x0, 0x0},
    {0x1E65, 0x1E64, 0x0, 0x0}, {0x1E67, 0x1E66, 0x0, 0x0}, {0x1E69, 0x1E68, 0x0, 0x0},
    {0x1E6B, 0x1E6A, 0x0, 0x0}, {0x1E6D, 0x1E6C, 0x0, 0x0}, {0x1E6F, 0x1E6E, 0x0, 0x0},
    {0x1E71, 0x1E70, 0x0, 0x0}, {0x1E73, 0x1E72, 0x0, 0x0}, {0x1E75, 0x1E74, 0x0, 0x0},
    {0x1E77, 0x1E76, 0x0, 0x0}, {0x1E79, 0x1E78, 0x0, 0x0}, {0x1E7B, 0x1E7A, 0x0, 0x0},
    {0x1E7D, 0x1E7C, 0x0, 0x0}, {0x1E7F, 0x1E7E, 0x0, 0x0}, {0x1E81, 0x1E80, 0x0, 0x0},
    {0x1E83, 0x1E82, 0x0, 0x0}, {0x1E85, 0x1E84, 0x0, 0x0}, {0x1E87, 0x1E86, 0x0, 0x0},
    {0x1E89, 0x1E88, 0x0, 0x0}, {0x1E8B, 0x1E8A, 0x0, 0x0}, {0x1E8D, 0x1E8C, 0x0, 0x0},
    {0x1E8F, 0x1E8E, 0x0, 0x0}, {0x1E91, 0x1E90, 0x0, 0x0}, {0x1E93, 0x1E92, 0x0, 0x0},
    {0x1E95, 0x1E94, 0x0, 0x0}, {0x1E96, 0x48, 0x331, 0x0}, {0x1E97, 0x54, 0x308, 0x0},
    {0x1E98, 0x57, 0x30A, 0x0}, {0x1E99, 0x59, 0x30A, 0x0}, {0x1E9A, 0x41, 0x2BE, 0x0},
    {0x1E9B, 0x1E60, 0x0, 0x0}, {0x1EA1, 0x1EA0, 0x0, 0x0}, {0x1EA3, 0x1EA2, 0x0, 0x0},
    {0x1EA5, 0x1EA4, 0x0, 0x0}, {0x1EA7, 0x1EA6, 0x0, 0x0}, {0x1EA9, 0x1EA8, 0x0, 0x0},
    {0x1EAB, 0x1EAA, 0x0, 0x0}, {0x1EAD, 0x1EAC, 0x0, 0x0}, {0x1EAF, 0x1EAE, 0x0, 0x0},
    {0x1EB1, 0x1EB0, 0x0, 0x0}, {0x1EB3, 0x1EB2, 0x0, 0x0}, {0x1EB5, 0x1EB4, 0x0, 0x0},
    {0x1EB7, 0x1EB6, 0x0, 0x0}, {0x1EB9, 0x1EB8, 0x0, 0x0}, {0x1EBB, 0x1EBA, 0x0, 0x0},
    {0x1EBD, 0x1EBC, 0x0, 0x0}, {0x1EBF, 0x1EBE, 0x0, 0x0}, {0x1EC1, 0x1EC0, 0x0, 0x0},
    {0x1EC3, 0x1EC2, 0x0, 0x0}, {0x1EC5, 0x1EC4, 0x0, 0x0}, {0x1EC7, 0x1EC6, 0x0, 0x0},
    {0x1EC9, 0x1EC8, 0x0, 0x0}, {0x1ECB, 0x1ECA, 0x0, 0x0}, {0x1ECD, 0x1ECC, 0x0, 0x0},
    {0x1ECF, 0x1ECE, 0x0, 0x0}, {0x1ED1, 0x1ED0, 0x0, 0x0}, {0x1ED3, 0x1ED2, 0x0, 0x0},
    {0x1ED5, 0x1ED4, 0x0, 0x0}, {0x1ED7, 0x1ED6, 0x0, 0x0}, {0x1ED9, 0x1ED8, 0x0, 0x0},
    {0x1EDB, 0x1EDA, 0x0, 0x0}, {0x1EDD, 0x1EDC, 0x0, 0x0}, {0x1EDF, 0x1EDE, 0x0, 0x0},
    {0x1EE1, 0x1EE0, 0x0, 0x0}, {0x1EE3, 0x1EE2, 0x0, 0x0}, {0x1EE5, 0x1EE4, 0x0, 0x0},
    {0x1EE7, 0x1EE6, 0x0, 0x0}, {0x1EE9, 0x1EE8, 0x0, 0x0}, {0x1EEB, 0x1EEA, 0x0, 0x0},
    {0x1EED, 0x1EEC, 0x0, 0x0}, {0x1EEF, 0x1EEE, 0x0, 0x0}, {0x1EF1, 0x1EF0, 0x0, 0x0},
    {0x1EF3, 0x1EF2, 0x0, 0x0}, {0x1EF5, 0x1EF4, 0x0, 0x0}, {0x1EF7, 0x1EF6, 0x0, 0x0},
    {0x1EF9, 0x1EF8, 0x0, 0x0}, {0x1EFB, 0x1EFA, 0x0, 0x0}, {0x1EFD, 0x1EFC, 0x0, 0x0},
    {0x1EFF, 0x1EFE, 0x0, 0x0}, {0x1F00, 0x1F08, 0x0, 0x0}, {0x1F01, 0x1F09, 0x0, 0x0},
    {0x1F02, 0x1F0A, 0x0, 0x0}, {0x1F03, 0x1F0B, 0x0, 0x0}, {0x1F04, 0x1F0C, 0x0, 0x0},
    {0x1F05, 0x1F0D, 0x0, 0x0}, {0x1F06, 0x1F0E, 0x0, 0x0}, {0x1F07, 0x1F0F, 0x0, 0x0},
    {0x1F10, 0x1F18, 0x0, 0x0}, {0x1F11, 0x1F19, 0x0, 0x0}, {0x1F12, 0x1F1A, 0x0, 0x0},
    {0x1F13, 0x1F1B, 0x0, 0x0}, {0x1F14, 0x1F1C, 0x0, 0x0}, {0x1F15, 0x1F1D, 0x0, 0x0},
    {0x1F20, 0x1F28, 0x0, 0x0}, {0x1F21, 0x1F29, 0x0, 0x0}, {0x1F22, 0x1F2A, 0x0, 0x0},
    {0x1F23, 0x1F2B, 0x0, 0x0}, {0x1F24, 0x1F2C, 0x0, 0x0}, {0x1F25, 0x1F2D, 0x0, 0x0},
    {0x1F26, 0x1F2E, 0x0, 0x0}, {0x1F27, 0x1F2F, 0x0, 0x0}, {0x1F30, 0x1F38, 0x0, 0x0},
    {0x1F31, 0x1F39, 0x0, 0x0}, {0x1F32, 0x1F3A, 0x0, 0x0}, {0x1F33, 0x1F3B, 0x0, 0x0},
    {0x1F34, 0x1F3C, 0x0, 0x0}, {0x1F35, 0x1F3D, 0x0, 0x0}, {0x1F36, 0x1F3E, 0x0, 0x0},
    {0x1F37, 0x1F3F, 0x0, 0x0}, {0x1F40, 0x1F48, 0x0, 0x0}, {0x1F41, 0x1F49, 0x0, 0x0},
    {0x1F42, 0x1F4A, 0x0, 0x0}, {0x1F43, 0x1F4B, 0x0, 0x0}, {0x1F44, 0x1F4C, 0x0, 0x0},
    {0x1F45, 0x1F4D, 0x0, 0x0}, {0x1F50, 0x3A5, 0x313, 0x0}, {0x1F51, 0x1F59, 0x0, 0x0},
    {0x1F52, 0x3A5, 0x313, 0x300}, {0x1F53, 0x1F5B, 0x0, 0x0}, {0x1F54, 0x3A5, 0x313, 0x301},
    {0x1F55, 0x1F5D, 0x0, 0x0}, {0x1F56, 0x3A5, 0x313, 0x342}, {0x1F57, 0x1F5F, 0x0, 0x0},
    {0x1F60, 0x1F68, 0x0, 0x0}, {0x1F61, 0x1F69, 0x0, 0x0}, {0x1F62, 0x1F6A, 0x0, 0x0},
    {0x1F63, 0x1F6B, 0x0, 0x0}, {0x1F64, 0x1F6C, 0x0, 0x0}, {0x1F65, 0x1F6D, 0x0, 0x0},
    {0x1F66, 0x1F6E, 0x0, 0x0}, {0x1F67, 0x1F6F, 0x0, 0x0}, {0x1F70, 0x1FBA, 0x0, 0x0},
    {0x1F71, 0x1FBB, 0x0, 0x0}, {0x1F72, 0x1FC8, 0x0, 0x0}, {0x1F73, 0x1FC9, 0x0, 0x0},
    {0x1F74, 0x1FCA, 0x0, 0x0}, {0x1F75, 0x1FCB, 0x0, 0x0}, {0x1F76, 0x1FDA, 0x0, 0x0},
    {0x1F77, 0x1FDB, 0x0, 0x0}, {0x1F78, 0x1FF8, 0x0, 0x0}, {0x1F79, 0x1FF9, 0x0, 0x0},
    {0x1F7A, 0x1FEA, 0x0, 0x0}, {0x1F7B, 0x1FEB, 0x0, 0x0}, {0x1F7C, 0x1FFA, 0x0, 0x0},
    {0x1F7D, 0x1FFB, 0x0, 0x0}, {0x1F80, 0x1F08, 0x399, 0x0}, {0x1F81, 0x1F09, 0x399, 0x0},
    {0x1F82, 0x1F0A, 0x399, 0x0}, {0x1F83, 0x1F0B, 0x399, 0x0}, {0x1F84, 0x1F0C, 0x399, 0x0},
    {0x1F85, 0x1F0D, 0x399, 0x0}, {0x1F86, 0x1F0E, 0x399, 0x0}, {0x1F87, 0x1F0F, 0x399, 0x0},
    {0x1F88, 0x1F08, 0x399, 0x0}, {0x1F89, 0x1F09, 0x399, 0x0}, {0x1F8A, 0x1F0A, 0x399, 0x0},
    {0x1F8B, 0x1F0B, 0x399, 0x0}, {0x1F8C, 0x1F0C, 0x399, 0x0}, {0x1F8D, 0x1F0D, 0x399, 0x0},
    {0x1F8E, 0x1F0E, 0x399, 0x0}, {0x1F8F, 0x1F0F, 0x399, 0x0}, {0x1F90, 0x1F28, 0x399, 0x0},
    {0x1F91, 0x1F29, 0x399, 0x0}, {0x1F92, 0x1F2A, 0x399, 0x0}, {0x1F93, 0x1F2B, 0x399, 0x0},
    {0x1F94, 0x1F2C, 0x399, 0x0}, {0x1F95, 0x1F2D, 0x399, 0x0}, {0x1F96, 0x1F2E, 0x399, 0x0},
    {0x1F97, 0x1F2F, 0x399, 0x0}, {0x1F98, 0x1F28, 0x399, 0x0}, {0x1F99, 0x1F29, 0x399, 0x0},
    {0x1F9A, 0x1F2A, 0x399, 0x0}, {0x1F9B, 0x1F2B, 0x399, 0x0}, {0x1F9C, 0x1F2C, 0x399, 0x0},
    {0x1F9D, 0x1F2D, 0x399, 0x0}, {0x1F9E, 0x1F2E, 0x399, 0x0}, {0x1F9F, 0x1F2F, 0x399, 0x0},
    {0x1FA0, 0x1F68, 0x399, 0x0}, {0x1FA1, 0x1F69, 0x399, 0x0}, {0x1FA2, 0x1F6A, 0x399, 0x0},
    {0x1FA3, 0x1F6B, 0x399, 0x0}, {0x1FA4, 0x1F6C, 0x399, 0x0}, {0x1FA5, 0x1F6D, 0x399, 0x0},
    {0x1FA6, 0x1F6E, 0x399, 0x0}, {0x1FA7, 0x1F6F, 0x399, 0x0}, {0x1FA8, 0x1F68, 0x399, 0x0},
    {0x1FA9, 0x1F69, 0x399, 0x0}, {0x1FAA, 0x1F6A, 0x399, 0x0}, {0x1FAB, 0x1F6B, 0x399, 0x0},
    {0x1FAC, 0x1F6C, 0x399, 0x0}, {0x1FAD, 0x1F6D, 0x399, 0x0}, {0x1FAE, 0x1F6E, 0x399, 0x0},
    {0x1FAF, 0x1F6F, 0x399, 0x0}, {0x1FB0, 0x1FB8, 0x0, 0x0}, {0x1FB1, 0x1FB9, 0x0, 0x0},
    {0x1FB2, 0x1FBA, 0x399, 0x0}, {0x1FB3, 0x391, 0x399, 0x0}, {0x1FB4, 0x386, 0x399, 0x0},
    {0x1FB6, 0x391, 0x342, 0x0}, {0x1FB7, 0x391, 0x342, 0x399}, {0x1FBC, 0x391, 0x399, 0x0},
    {0x1FBE, 0x399, 0x0, 0x0}, {0x1FC2, 0x1FCA, 0x399, 0x0}, {0x1FC3, 0x397, 0x399, 0x0},
    {0x1FC4, 0x389, 0x399, 0x0}, {0x1FC6, 0x397, 0x342, 0x0}, {0x1FC7, 0x397, 0x342, 0x399},
    {0x1FCC, 0x397, 0x399, 0x0}, {0x1FD0, 0x1FD8, 0x0, 0x0}, {0x1FD1, 0x1FD9, 0x0, 0x0},
    {0x1FD2, 0x399, 0x308, 0x300}, {0x1FD3, 0x399, 0x308, 0x301}, {0x1FD6, 0x399, 0x342, 0x0},
    {0x1FD7, 0x399, 0x308, 0x342}, {0x1FE0, 0x1FE8, 0x0, 0x0}, {0x1FE1, 0x1FE9, 0x0, 0x0},
    {0x1FE2, 0x3A5, 0x308, 0x300}, {0x1FE3, 0x3A5, 0x308, 0x301}, {0x1FE4, 0x3A1, 0x313, 0x0},
    {0x1FE5, 0x1FEC, 0x0, 0x0}, {0x1FE6, 0x3A5, 0x342, 0x0}, {0x1FE7, 0x3A5, 0x308, 0x342},
    {0x1FF2, 0x1FFA, 0x399, 0x0}, {0x1FF3, 0x3A9, 0x399, 0x0}, {0x1FF4, 0x38F, 0x399, 0x0},
    {0x1FF6, 0x3A9, 0x342, 0x0}, {0x1FF7, 0x3A9, 0x342, 0x399}, {0x1FFC, 0x3A9, 0x399, 0x0},
    {0x214E, 0x2132, 0x0, 0x0}, {0x2170, 0x2160, 0x0, 0x0}, {0x2171, 0x2161, 0x0, 0x0},
    {0x2172, 0x2162, 0x0, 0x0}, {0x2173, 0x2163, 0x0, 0x0}, {0x2174, 0x2164, 0x0, 0x0},
    {0x2175, 0x2165, 0x0, 0x0}, {0x2176, 0x2166, 0x0, 0x0}, {0x2177, 0x2167, 0x0, 0x0},
    {0x2178, 0x2168, 0x0, 0x0}, {0x2179, 0x2169, 0x0, 0x0}, {0x217A, 0x216A, 0x0, 0x0},
    {0x217B, 0x216B, 0x0, 0x0}, {0x217C, 0x216C, 0x0, 0x0}, {0x217D, 0x216D, 0x0, 0x0},
    {0x217E, 0x216E, 0x0, 0x0}, {0x217F, 0x216F, 0x0, 0x0}, {0x2184, 0x2183, 0x0, 0x0},
    {0x24D0, 0x24B6, 0x0, 0x0}, {0x24D1, 0x24B7, 0x0, 0x0}, {0x24D2, 0x24B8, 0x0, 0x0},
    {0x24D3, 0x24B9, 0x0, 0x0}, {0x24D4, 0x24BA, 0x0, 0x0}, {0x24D5, 0x24BB, 0x0, 0x0},
    {0x24D6, 0x24BC, 0x0, 0x0}, {0x24D7, 0x24BD, 0x0, 0x0}, {0x24D8, 0x24BE, 0x0, 0x0},
    {0x24D9, 0x24BF, 0x0, 0x0}, {0x24DA, 0x24C0, 0x0, 0x0}, {0x24DB, 0x24C1, 0x0, 0x0},
    {0x24DC, 0x24C2, 0x0, 0x0}, {0x24DD, 0x24C3, 0x0, 0x0}, {0x24DE, 0x24C4, 0x0, 0x0},
    {0x24DF, 0x24C5, 0x0, 0x0}, {0x24E0, 0x24C6, 0x0, 0x0}, {0x24E1, 0x24C7, 0x0, 0x0},
    {0x24E2, 0x24C8, 0x0, 0x0}, {0x24E3, 0x24C9, 0x0, 0x0}, {0x24E4, 0x24CA, 0x0, 0x0},
    {0x24E5, 0x24CB, 0x0, 0x0}, {0x24E6, 0x24CC, 0x0, 0x0}, {0x24E7, 0x24CD, 0x0, 0x0},
    {0x24E8, 0x24CE, 0x0, 0x0}, {0x24E9, 0x24CF, 0x0, 0x0}, {0x2C30, 0x2C00, 0x0, 0x0},
    {0x2C31, 0x2C01, 0x0, 0x0}, {0x2C32, 0x2C02, 0x0, 0x0}, {0x2C33, 0x2C03, 0x0, 0x0},
    {0x2C34, 0x2C04, 0x0, 0x0}, {0x2C35, 0x2C05, 0x0, 0x0}, {0x2C36, 0x2C06, 0x0, 0x0},
    {0x2C37, 0x2C07, 0x0, 0x0}, {0x2C38, 0x2C08, 0x0, 0x0}, {0x2C39, 0x2C09, 0x0, 0x0},
    {0x2C3A, 0x2C0A, 0x0, 0x0}, {0x2C3B, 0x2C0B, 0x0, 0x0}, {0x2C3C, 0x2C0C, 0x0, 0x0},
    {0x2C3D, 0x2C0D, 0x0, 0x0}, {0x2C3E, 0x2C0E, 0x0, 0x0}, {0x2C3F, 0x2C0F, 0x0, 0x0},
    {0x2C40, 0x2C10, 0x0, 0x0}, {0x2C41, 0x2C11, 0x0, 0x0}, {0x2C42, 0x2C12, 0x0, 0x0},
    {0x2C43, 0x2C13, 0x0, 0x0}, {0x2C44, 0x2C14, 0x0, 0x0}, {0x2C45, 0x2C15, 0x0, 0x0},
    {0x2C46, 0x2C16, 0x0, 0x0}, {0x2C47, 0x2C17, 0x0, 0x0}, {0x2C48, 0x2C18, 0x0, 0x0},
    {0x2C49, 0x2C19, 0x0, 0x0}, {0x2C4A, 0x2C1A, 0x0, 0x0}, {0x2C4B, 0x2C1B, 0x0, 0x0},
    {0x2C4C, 0x2C1C, 0x0, 0x0}, {0x2C4D, 0x2C1D, 0x0, 0x0}, {0x2C4E, 0x2C1E, 0x0, 0x0},
    {0x2C4F, 0x2C1F, 0x0, 0x0}, {0x2C50, 0x2C20, 0x0, 0x0}, {0x2C51, 0x2C21, 0x0, 0x0},
    {0x2C52, 0x2C22, 0x0, 0x0}, {0x2C53, 0x2C23, 0x0, 0x0}, {0x2C54, 0x2C24, 0x0, 0x0},
    {0x2C55, 0x2C25, 0x0, 0x0}, {0x2C56, 0x2C26, 0x0, 0x0}, {0x2C57, 0x2C27, 0x0, 0x0},
    {0x2C58, 0x2C28, 0x0, 0x0}, {0x2C59, 0x2C29, 0x0, 0x0}, {0x2C5A, 0x2C2A, 0x0, 0x0},
    {0x2C5B, 0x2C2B, 0x0, 0x0}, {0x2C5C, 0x2C2C, 0x0, 0x0}, {0x2C5D, 0x2C2D, 0x0, 0x0},
    {0x2C5E, 0x2C2E, 0x0, 0x0}, {0x2C5F, 0x2C2F, 0x0, 0x0}, {0x2C61, 0x2C60, 0x0, 0x0},
    {0x2C65, 0x23A, 0x0, 0x0}, {0x2C66, 0x23E, 0x0, 0x0}, {0x2C68, 0x2C67, 0x0, 0x0},
    {0x2C6A, 0x2C69, 0x0, 0x0}, {0x2C6C, 0x2C6B, 0x0, 0x0}, {0x2C73, 0x2C72, 0x0, 0x0},
    {0x2C76, 0x2C75, 0x0, 0x0}, {0x2C81, 0x2C80, 0x0, 0x0}, {0x2C83, 0x2C82, 0x0, 0x0},
    {0x2C85, 0x2C84, 0x0, 0x0}, {0x2C87, 0x2C86, 0x0, 0x0}, {0x2C89, 0x2C88, 0x0, 0x0},
    {0x2C8B, 0x2C8A, 0x0, 0x0}, {0x2C8D, 0x2C8C, 0x0, 0x0}, {0x2C8F, 0x2C8E, 0x0, 0x0},
    {0x2C91, 0x2C90, 0x0, 0x0}, {0x2C93, 0x2C92, 0x0, 0x0}, {0x2C95, 0x2C94, 0x0, 0x0},
    {0x2C97, 0x2C96, 0x0, 0x0}, {0x2C99, 0x2C98, 0x0, 0x0}, {0x2C9B, 0x2C9A, 0x0, 0x0},
    {0x2C9D, 0x2C9C, 0x0, 0x0}, {0x2C9F, 0x2C9E, 0x0, 0x0}, {0x2CA1, 0x2CA0, 0x0, 0x0},
    {0x2CA3, 0x2CA2, 0x0, 0x0}, {0x2CA5, 0x2CA4, 0x0, 0x0}, {0x2CA7, 0x2CA6, 0x0, 0x0},
    {0x2CA9, 0x2CA8, 0x0, 0x0}, {0x2CAB, 0x2CAA, 0x0, 0x0}, {0x2CAD, 0x2CAC, 0x0, 0x0},
    {0x2CAF, 0x2CAE, 0x0, 0x0}, {0x2CB1, 0x2CB0, 0x0, 0x0}, {0x2CB3, 0x2CB2, 0x0, 0x0},
    {0x2CB5, 0x2CB4, 0x0, 0x0}, {0x2CB7, 0x2CB6, 0x0, 0x0}, {0x2CB9, 0x2CB8, 0x0, 0x0},
    {0x2CBB, 0x2CBA, 0x0, 0x0}, {0x2CBD, 0x2CBC, 0x0, 0x0}, {0x2CBF, 0x2CBE, 0x0, 0x0},
    {0x2CC1, 0x2CC0, 0x0, 0x0}, {0x2CC3, 0x2CC2, 0x0, 0x0}, {0x2CC5, 0x2CC4, 0x0, 0x0},
    {0x2CC7, 0x2CC6, 0x0, 0x0}, {0x2CC9, 0x2CC8, 0x0, 0x0}, {0x2CCB, 0x2CCA, 0x0, 0x0},
    {0x2CCD, 0x2CCC, 0x0, 0x0}, {0x2CCF, 0x2CCE, 0x0, 0x0}, {0x2CD1, 0x2CD0, 0x0, 0x0},
    {0x2CD3, 0x2CD2, 0x0, 0x0}, {0x2CD5, 0x2CD4, 0x0, 0x0}, {0x2CD7, 0x2CD6, 0x0, 0x0},
    {0x2CD9, 0x2CD8, 0x0, 0x0}, {0x2CDB, 0x2CDA, 0x0, 0x0}, {0x2CDD, 0x2CDC, 0x0, 0x0},
    {0x2CDF, 0x2CDE, 0x0, 0x0}, {0x2CE1, 0x2CE0, 0x0, 0x0}, {0x2CE3, 0x2CE2, 0x0, 0x0},
    {0x2CEC, 0x2CEB, 0x0, 0x0}, {0x2CEE, 0x2CED, 0x0, 0x0}, {0x2CF3, 0x2CF2, 0x0, 0x0},
    {0x2D00, 0x10A0, 0x0, 0x0}, {0x2D01, 0x10A1, 0x0, 0x0}, {0x2D02, 0x10A2, 0x0, 0x0},
    {0x2D03, 0x10A3, 0x0, 0x0}, {0x2D04, 0x10A4, 0x0, 0x0}, {0x2D05, 0x10A5, 0x0, 0x0},
    {0x2D06, 0x10A6, 0x0, 0x0}, {0x2D07, 0x10A7, 0x0, 0x0}, {0x2D08, 0x10A8, 0x0, 0x0},
    {0x2D09, 0x10A9, 0x0, 0x0}, {0x2D0A, 0x10AA, 0x0, 0x0}, {0x2D0B, 0x10AB, 0x0, 0x0},
    {0x2D0C, 0x10AC, 0x0, 0x0}, {0x2D0D, 0x10AD, 0x0, 0x0}, {0x2D0E, 0x10AE, 0x0, 0x0},
    {0x2D0F, 0x10AF, 0x0, 0x0}, {0x2D10, 0x10B0, 0x0, 0x0}, {0x2D11, 0x10B1, 0x0, 0x0},
    {0x2D12, 0x10B2, 0x0, 0x0}, {0x2D13, 0x10B3, 0x0, 0x0}, {0x2D14, 0x10B4, 0x0, 0x0},
    {0x2D15, 0x10B5, 0x0, 0x0}, {0x2D16, 0x10B6, 0x0, 0x0}, {0x2D17, 0x10B7, 0x0, 0x0},
    {0x2D18, 0x10B8, 0x0, 0x0}, {0x2D19, 0x10B9, 0x0, 0x0}, {0x2D1A, 0x10BA, 0x0, 0x0},
    {0x2D1B, 0x10BB, 0x0, 0x0}, {0x2D1C, 0x10BC, 0x0, 0x0}, {0x2D1D, 0x10BD, 0x0, 0x0},
    {0x2D1E, 0x10BE, 0x0, 0x0}, {0x2D1F, 0x10BF, 0x0, 0x0}, {0x2D20, 0x10C0, 0x0, 0x0},
    {0x2D21, 0x10C1, 0x0, 0x0}, {0x2D22, 0x10C2, 0x0, 0x0}, {0x2D23, 0x10C3, 0x0, 0x0},
    {0x2D24, 0x10C4, 0x0, 0x0}, {0x2D25, 0x10C5, 0x0, 0x0}, {0x2D27, 0x10C7, 0x0, 0x0},
    {0x2D2D, 0x10CD, 0x0, 0x0}, {0xA641, 0xA640, 0x0, 0x0}, {0xA643, 0xA642, 0x0, 0x0},
    {0xA645, 0xA644, 0x0, 0x0}, {0xA647, 0xA646, 0x0, 0x0}, {0xA649, 0xA648, 0x0, 0x0},
    {0xA64B, 0xA64A, 0x0, 0x0}, {0xA64D, 0xA64C, 0x0, 0x0}, {0xA64F, 0xA64E, 0x0, 0x0},
    {0xA651, 0xA650, 0x0, 0x0}, {0xA653, 0xA652, 0x0, 0x0}, {0xA655, 0xA654, 0x0, 0x0},
    {0xA657, 0xA656, 0x0, 0x0}, {0xA659, 0xA658, 0x0, 0x0}, {0xA65B, 0xA65A, 0x0, 0x0},
    {0xA65D, 0xA65C, 0x0, 0x0}, {0xA65F, 0xA65E, 0x0, 0x0}, {0xA661, 0xA660, 0x0, 0x0},
    {0xA663, 0xA662, 0x0, 0x0}, {0xA665, 0xA664, 0x0, 0x0}, {0xA667, 0xA666, 0x0, 0x0},
    {0xA669, 0xA668, 0x0, 0x0}, {0xA66B, 0xA66A, 0x0, 0x0}, {0xA66D, 0xA66C, 0x0, 0x0},
    {0xA681, 0xA680, 0x0, 0x0}, {0xA683, 0xA682, 0x0, 0x0}, {0xA685, 0xA684, 0x0, 0x0},
    {0xA687, 0xA686, 0x0, 0x0}, {0xA689, 0xA688, 0x0, 0x0}, {0xA68B, 0xA68A, 0x0, 0x0},
    {0xA68D, 0xA68C, 0x0, 0x0}, {0xA68F, 0xA68E, 0x0, 0x0}, {0xA691, 0xA690, 0x0, 0x0},
    {0xA693, 0xA692, 0x0, 0x0}, {0xA695, 0xA694, 0x0, 0x0}, {0xA697, 0xA696, 0x0, 0x0},
    {0xA699, 0xA698, 0x0, 0x0}, {0xA69B, 0xA69A, 0x0, 0x0}, {0xA723, 0xA722, 0x0, 0x0},
    {0xA725, 0xA724, 0x0, 0x0}, {0xA727, 0xA726, 0x0, 0x0}, {0xA729, 0xA728, 0x0, 0x0},
    {0xA72B, 0xA72A, 0x0, 0x0}, {0xA72D, 0xA72C, 0x0, 0x0}, {0xA72F, 0xA72E, 0x0, 0x0},
    {0xA733, 0xA732, 0x0, 0x0}, {0xA735, 0xA734, 0x0, 0x0}, {0xA737, 0xA736, 0x0, 0x0},
    {0xA739, 0xA738, 0x0, 0x0}, {0xA73B, 0xA73A, 0x0, 0x0}, {0xA73D, 0xA73C, 0x0, 0x0},
    {0xA73F, 0xA73E, 0x0, 0x0}, {0xA741, 0xA740, 0x0, 0x0}, {0xA743, 0xA742, 0x0, 0x0},
    {0xA745, 0xA744, 0x0, 0x0}, {0xA747, 0xA746, 0x0, 0x0}, {0xA749, 0xA748, 0x0, 0x0},
    {0xA74B, 0xA74A, 0x0, 0x0}, {0xA74D, 0xA74C, 0x0, 0x0}, {0xA74F, 0xA74E, 0x0, 0x0},
    {0xA751, 0xA750, 0x0, 0x0}, {0xA753, 0xA752, 0x0, 0x0}, {0xA755, 0xA754, 0x0, 0x0},
    {0xA757, 0xA756, 0x0, 0x0}, {0xA759, 0xA758, 0x0, 0x0}, {0xA75B, 0xA75A, 0x0, 0x0},
    {0xA75D, 0xA75C, 0x0, 0x0}, {0xA75F, 0xA75E, 0x0, 0x0}, {0xA761, 0xA760, 0x0, 0x0},
    {0xA763, 0xA762, 0x0, 0x0}, {0xA765, 0xA764, 0x0, 0x0}, {0xA767, 0xA766, 0x0, 0x0},
    {0xA769, 0xA768, 0x0, 0x0}, {0xA76B, 0xA76A, 0x0, 0x0}, {0xA76D, 0xA76C, 0x0, 0x0},
    {0xA76F, 0xA76E, 0x0, 0x0}, {0xA77A, 0xA779, 0x0, 0x0}, {0xA77C, 0xA77B, 0x0, 0x0},
    {0xA77F, 0xA77E, 0x0, 0x0}, {0xA781, 0xA780, 0x0, 0x0}, {0xA783, 0xA782, 0x0, 0x0},
    {0xA785, 0xA784, 0x0, 0x0}, {0xA787, 0xA786, 0x0, 0x0}, {0xA78C, 0xA78B, 0x0, 0x0},
    {0xA791, 0xA790, 0x0, 0x0}, {0xA793, 0xA792, 0x0, 0x0}, {0xA794, 0xA7C4, 0x0, 0x0},
    {0xA797, 0xA796, 0x0, 0x0}, {0xA799, 0xA798, 0x0, 0x0}, {0xA79B, 0xA79A, 0x0, 0x0},
    {0xA79D, 0xA79C, 0x0, 0x0}, {0xA79F, 0xA79E, 0x0, 0x0}, {0xA7A1, 0xA7A0, 0x0, 0x0},
    {0xA7A3, 0xA7A2, 0x0, 0x0}, {0xA7A5, 0xA7A4, 0x0, 0x0}, {0xA7A7, 0xA7A6, 0x0, 0x0},
    {0xA7A9, 0xA7A8, 0x0, 0x0}, {0xA7B5, 0xA7B4, 0x0, 0x0}, {0xA7B7, 0xA7B6, 0x0, 0x0},
    {0xA7B9, 0xA7B8, 0x0, 0x0}, {0xA7BB, 0xA7BA, 0x0, 0x0}, {0xA7BD, 0xA7BC, 0x0, 0x0},
    {0xA7BF, 0xA7BE, 0x0, 0x0}, {0xA7C1, 0xA7C0, 0x0, 0x0}, {0xA7C3, 0xA7C2, 0x0, 0x0},
    {0xA7C8, 0xA7C7, 0x0, 0x0}, {0xA7CA, 0xA7C9, 0x0, 0x0}, {0xA7CD, 0xA7CC, 0x0, 0x0},
    {0xA7CF, 0xA7CE, 0x0, 0x0}, {0xA7D1, 0xA7D0, 0x0, 0x0}, {0xA7D3, 0xA7D2, 0x0, 0x0},
    {0xA7D5, 0xA7D4, 0x0, 0x0}, {0xA7D7, 0xA7D6, 0x0, 0x0}, {0xA7D9, 0xA7D8, 0x0, 0x0},
    {0xA7DB, 0xA7DA, 0x0, 0x0}, {0xA7F6, 0xA7F5, 0x0, 0x0}, {0xAB53, 0xA7B3, 0x0, 0x0},
    {0xAB70, 0x13A0, 0x0, 0x0}, {0xAB71, 0x13A1, 0x0, 0x0}, {0xAB72, 0x13A2, 0x0, 0x0},
    {0xAB73, 0x13A3, 0x0, 0x0}, {0xAB74, 0x13A4, 0x0, 0x0}, {0xAB75, 0x13A5, 0x0, 0x0},
    {0xAB76, 0x13A6, 0x0, 0x0}, {0xAB77, 0x13A7, 0x0, 0x0}, {0xAB78, 0x13A8, 0x0, 0x0},
    {0xAB79, 0x13A9, 0x0, 0x0}, {0xAB7A, 0x13AA, 0x0, 0x0}, {0xAB7B, 0x13AB, 0x0, 0x0},
    {0xAB7C, 0x13AC, 0x0, 0x0}, {0xAB7D, 0x13AD, 0x0, 0x0}, {0xAB7E, 0x13AE, 0x0, 0x0},
    {0xAB7F, 0x13AF, 0x0, 0x0}, {0xAB80, 0x13B0, 0x0, 0x0}, {0xAB81, 0x13B1, 0x0, 0x0},
    {0xAB82, 0x13B2, 0x0, 0x0}, {0xAB83, 0x13B3, 0x0, 0x0}, {0xAB84, 0x13B4, 0x0, 0x0},
    {0xAB85, 0x13B5, 0x0, 0x0}, {0xAB86, 0x13B6, 0x0, 0x0}, {0xAB87, 0x13B7, 0x0, 0x0},
    {0xAB88, 0x13B8, 0x0, 0x0}, {0xAB89, 0x13B9, 0x0, 0x0}, {0xAB8A, 0x13BA, 0x0, 0x0},
    {0xAB8B, 0x13BB, 0x0, 0x0}, {0xAB8C, 0x13BC, 0x0, 0x0}, {0xAB8D, 0x13BD, 0x0, 0x0},
    {0xAB8E, 0x13BE, 0x0, 0x0}, {0xAB8F, 0x13BF, 0x0, 0x0}, {0xAB90, 0x13C0, 0x0, 0x0},
    {0xAB91, 0x13C1, 0x0, 0x0}, {0xAB92, 0x13C2, 0x0, 0x0}, {0xAB93, 0x13C3, 0x0, 0x0},
    {0xAB94, 0x13C4, 0x0, 0x0}, {0xAB95, 0x13C5, 0x0, 0x0}, {0xAB96, 0x13C6, 0x0, 0x0},
    {0xAB97, 0x13C7, 0x0, 0x0}, {0xAB98, 0x13C8, 0x0, 0x0}, {0xAB99, 0x13C9, 0x0, 0x0},
    {0xAB9A, 0x13CA, 0x0, 0x0}, {0xAB9B, 0x13CB, 0x0, 0x0}, {0xAB9C, 0x13CC, 0x0, 0x0},
    {0xAB9D, 0x13CD, 0x0, 0x0}, {0xAB9E, 0x13CE, 0x0, 0x0}, {0xAB9F, 0x13CF, 0x0, 0x0},
    {0xABA0, 0x13D0, 0x0, 0x0}, {0xABA1, 0x13D1, 0x0, 0x0}, {0xABA2, 0x13D2, 0x0, 0x0},
    {0xABA3, 0x13D3, 0x0, 0x0}, {0xABA4, 0x13D4, 0x0, 0x0}, {0xABA5, 0x13D5, 0x0, 0x0},
    {0xABA6, 0x13D6, 0x0, 0x0}, {0xABA7, 0x13D7, 0x0, 0x0}, {0xABA8, 0x13D8, 0x0, 0x0},
    {0xABA9, 0x13D9, 0x0, 0x0}, {0xABAA, 0x13DA, 0x0, 0x0}, {0xABAB, 0x13DB, 0x0, 0x0},
    {0xABAC, 0x13DC, 0x0, 0x0}, {0xABAD, 0x13DD, 0x0, 0x0}, {0xABAE, 0x13DE, 0x0, 0x0},
    {0xABAF, 0x13DF, 0x0, 0x0}, {0xABB0, 0x13E0, 0x0, 0x0}, {0xABB1, 0x13E1, 0x0, 0x0},
    {0xABB2, 0x13E2, 0x0, 0x0}, {0xABB3, 0x13E3, 0x0, 0x0}, {0xABB4, 0x13E4, 0x0, 0x0},
    {0xABB5, 0x13E5, 0x0, 0x0}, {0xABB6, 0x13E6, 0x0, 0x0}, {0xABB7, 0x13E7, 0x0, 0x0},
    {0xABB8, 0x13E8, 0x0, 0x0}, {0xABB9, 0x13E9, 0x0, 0x0}, {0xABBA, 0x13EA, 0x0, 0x0},
    {0xABBB, 0x13EB, 0x0, 0x0}, {0xABBC, 0x13EC, 0x0, 0x0}, {0xABBD, 0x13ED, 0x0, 0x0},
    {0xABBE, 0x13EE, 0x0, 0x0}, {0xABBF, 0x13EF, 0x0, 0x0}, {0xFB00, 0x46, 0x46, 0x0},
    {0xFB01, 0x46, 0x49, 0x0}, {0xFB02, 0x46, 0x4C, 0x0}, {0xFB03, 0x46, 0x46, 0x49},
    {0xFB04, 0x46, 0x46, 0x4C}, {0xFB05, 0x53, 0x54, 0x0}, {0xFB06, 0x53, 0x54, 0x0},
    {0xFB13, 0x544, 0x546, 0x0}, {0xFB14, 0x544, 0x535, 0x0}, {0xFB15, 0x544, 0x53B, 0x0},
    {0xFB16, 0x54E, 0x546, 0x0}, {0xFB17, 0x544, 0x53D, 0x0}, {0xFF41, 0xFF21, 0x0, 0x0},
    {0xFF42, 0xFF22, 0x0, 0x0}, {0xFF43, 0xFF23, 0x0, 0x0}, {0xFF44, 0xFF24, 0x0, 0x0},
    {0xFF45, 0xFF25, 0x0, 0x0}, {0xFF46, 0xFF26, 0x0, 0x0}, {0xFF47, 0xFF27, 0x0, 0x0},
    {0xFF48, 0xFF28, 0x0, 0x0}, {0xFF49, 0xFF29, 0x0, 0x0}, {0xFF4A, 0xFF2A, 0x0, 0x0},
    {0xFF4B, 0xFF2B, 0x0, 0x0}, {0xFF4C, 0xFF2C, 0x0, 0x0}, {0xFF4D, 0xFF2D, 0x0, 0x0},
    {0xFF4E, 0xFF2E, 0x0, 0x0}, {0xFF4F, 0xFF2F, 0x0, 0x0}, {0xFF50, 0xFF30, 0x0, 0x0},
    {0xFF51, 0xFF31, 0x0, 0x0}, {0xFF52, 0xFF32, 0x0, 0x0}, {0xFF53, 0xFF33, 0x0, 0x0},
    {0xFF54, 0xFF34, 0x0, 0x0}, {0xFF55, 0xFF35, 0x0, 0x0}, {0xFF56, 0xFF36, 0x0, 0x0},
    {0xFF57, 0xFF37, 0x0, 0x0}, {0xFF58, 0xFF38, 0x0, 0x0}, {0xFF59, 0xFF39, 0x0, 0x0},
    {0xFF5A, 0xFF3A, 0x0, 0x0}, {0x10428, 0x10400, 0x0, 0x0}, {0x10429, 0x10401, 0x0, 0x0},
    {0x1042A, 0x10402, 0x0, 0x0}, {0x1042B, 0x10403, 0x0, 0x0}, {0x1042C, 0x10404, 0x0, 0x0},
    {0x1042D, 0x10405, 0x0, 0x0}, {0x1042E, 0x10406, 0x0, 0x0}, {0x1042F, 0x10407, 0x0, 0x0},
    {0x10430, 0x10408, 0x0, 0x0}, {0x10431, 0x10409, 0x0, 0x0}, {0x10432, 0x1040A, 0x0, 0x0},
    {0x10433, 0x1040B, 0x0, 0x0}, {0x10434, 0x1040C, 0x0, 0x0}, {0x10435, 0x1040D, 0x0, 0x0},
    {0x10436, 0x1040E, 0x0, 0x0}, {0x10437, 0x1040F, 0x0, 0x0}, {0x10438, 0x10410, 0x0, 0x0},
    {0x10439, 0x10411, 0x0, 0x0}, {0x1043A, 0x10412, 0x0, 0x0}, {0x1043B, 0x10413, 0x0, 0x0},
    {0x1043C, 0x10414, 0x0, 0x0}, {0x1043D, 0x10415, 0x0, 0x0}, {0x1043E, 0x10416, 0x0, 0x0},
    {0x1043F, 0x10417, 0x0, 0x0}, {0x10440, 0x10418, 0x0, 0x0}, {0x10441, 0x10419, 0x0, 0x0},
    {0x10442, 0x1041A, 0x0, 0x0}, {0x10443, 0x1041B, 0x0, 0x0}, {0x10444, 0x1041C, 0x0, 0x0},
    {0x10445, 0x1041D, 0x0, 0x0}, {0x10446, 0x1041E, 0x0, 0x0}, {0x10447, 0x1041F, 0x0, 0x0},
    {0x10448, 0x10420, 0x0, 0x0}, {0x10449, 0x10421, 0x0, 0x0}, {0x1044A, 0x10422, 0x0, 0x0},
    {0x1044B, 0x10423, 0x0, 0x0}, {0x1044C, 0x10424, 0x0, 0x0}, {0x1044D, 0x10425, 0x0, 0x0},
    {0x1044E, 0x10426, 0x0, 0x0}, {0x1044F, 0x10427, 0x0, 0x0}, {0x104D8, 0x104B0, 0x0, 0x0},
    {0x104D9, 0x104B1, 0x0, 0x0}, {0x104DA, 0x104B2, 0x0, 0x0}, {0x104DB, 0x104B3, 0x0, 0x0},
    {0x104DC, 0x104B4, 0x0, 0x0}, {0x104DD, 0x104B5, 0x0, 0x0}, {0x104DE, 0x104B6, 0x0, 0x0},
    {0x104DF, 0x104B7, 0x0, 0x0}, {0x104E0, 0x104B8, 0x0, 0x0}, {0x104E1, 0x104B9, 0x0, 0x0},
    {0x104E2, 0x104BA, 0x0, 0x0}, {0x104E3, 0x104BB, 0x0, 0x0}, {0x104E4, 0x104BC, 0x0, 0x0},
    {0x104E5, 0x104BD, 0x0, 0x0}, {0x104E6, 0x104BE, 0x0, 0x0}, {0x104E7, 0x104BF, 0x0, 0x0},
    {0x104E8, 0x104C0, 0x0, 0x0}, {0x104E9, 0x104C1, 0x0, 0x0}, {0x104EA, 0x104C2, 0x0, 0x0},
    {0x104EB, 0x104C3, 0x0, 0x0}, {0x104EC, 0x104C4, 0x0, 0x0}, {0x104ED, 0x104C5, 0x0, 0x0},
    {0x104EE, 0x104C6, 0x0, 0x0}, {0x104EF, 0x104C7, 0x0, 0x0}, {0x104F0, 0x104C8, 0x0, 0x0},
    {0x104F1, 0x104C9, 0x0, 0x0}, {0x104F2, 0x104CA, 0x0, 0x0}, {0x104F3, 0x104CB, 0x0, 0x0},
    {0x104F4, 0x104CC, 0x0, 0x0}, {0x104F5, 0x104CD, 0x0, 0x0}, {0x104F6, 0x104CE, 0x0, 0x0},
    {0x104F7, 0x104CF, 0x0, 0x0}, {0x104F8, 0x104D0, 0x0, 0x0}, {0x104F9, 0x104D1, 0x0, 0x0},
    {0x104FA, 0x104D2, 0x0, 0x0}, {0x104FB, 0x104D3, 0x0, 0x0}, {0x10597, 0x10570, 0x0, 0x0},
    {0x10598, 0x10571, 0x0, 0x0}, {0x10599, 0x10572, 0x0, 0x0}, {0x1059A, 0x10573, 0x0, 0x0},
    {0x1059B, 0x10574, 0x0, 0x0}, {0x1059C, 0x10575, 0x0, 0x0}, {0x1059D, 0x10576, 0x0, 0x0},
    {0x1059E, 0x10577, 0x0, 0x0}, {0x1059F, 0x10578, 0x0, 0x0}, {0x105A0, 0x10579, 0x0, 0x0},
    {0x105A1, 0x1057A, 0x0, 0x0}, {0x105A3, 0x1057C, 0x0, 0x0}, {0x105A4, 0x1057D, 0x0, 0x0},
    {0x105A5, 0x1057E, 0x0, 0x0}, {0x105A6, 0x1057F, 0x0, 0x0}, {0x105A7, 0x10580, 0x0, 0x0},
    {0x105A8, 0x10581, 0x0, 0x0}, {0x105A9, 0x10582, 0x0, 0x0}, {0x105AA, 0x10583, 0x0, 0x0},
    {0x105AB, 0x10584, 0x0, 0x0}, {0x105AC, 0x10585, 0x0, 0x0}, {0x105AD, 0x10586, 0x0, 0x0},
    {0x105AE, 0x10587, 0x0, 0x0}, {0x105AF, 0x10588, 0x0, 0x0}, {0x105B0, 0x10589, 0x0, 0x0},
    {0x105B1, 0x1058A, 0x0, 0x0}, {0x105B3, 0x1058C, 0x0, 0x0}, {0x105B4, 0x1058D, 0x0, 0x0},
    {0x105B5, 0x1058E, 0x0, 0x0}, {0x105B6, 0x1058F, 0x0, 0x0}, {0x105B7, 0x10590, 0x0, 0x0},
    {0x105B8, 0x10591, 0x0, 0x0}, {0x105B9, 0x10592, 0x0, 0x0}, {0x105BB, 0x10594, 0x0, 0x0},
    {0x105BC, 0x10595, 0x0, 0x0}, {0x10CC0, 0x10C80, 0x0, 0x0}, {0x10CC1, 0x10C81, 0x0, 0x0},
    {0x10CC2, 0x10C82, 0x0, 0x0}, {0x10CC3, 0x10C83, 0x0, 0x0}, {0x10CC4, 0x10C84, 0x0, 0x0},
    {0x10CC5, 0x10C85, 0x0, 0x0}, {0x10CC6, 0x10C86, 0x0, 0x0}, {0x10CC7, 0x10C87, 0x0, 0x0},
    {0x10CC8, 0x10C88, 0x0, 0x0}, {0x10CC9, 0x10C89, 0x0, 0x0}, {0x10CCA, 0x10C8A, 0x0, 0x0},
    {0x10CCB, 0x10C8B, 0x0, 0x0}, {0x10CCC, 0x10C8C, 0x0, 0x0}, {0x10CCD, 0x10C8D, 0x0, 0x0},
    {0x10CCE, 0x10C8E, 0x0, 0x0}, {0x10CCF, 0x10C8F, 0x0, 0x0}, {0x10CD0, 0x10C90, 0x0, 0x0},
    {0x10CD1, 0x10C91, 0x0, 0x0}, {0x10CD2, 0x10C92, 0x0, 0x0}, {0x10CD3, 0x10C93, 0x0, 0x0},
    {0x10CD4, 0x10C94, 0x0, 0x0}, {0x10CD5, 0x10C95, 0x0, 0x0}, {0x10CD6, 0x10C96, 0x0, 0x0},
    {0x10CD7, 0x10C97, 0x0, 0x0}, {0x10CD8, 0x10C98, 0x0, 0x0}, {0x10CD9, 0x10C99, 0x0, 0x0},
    {0x10CDA, 0x10C9A, 0x0, 0x0}, {0x10CDB, 0x10C9B, 0x0, 0x0}, {0x10CDC, 0x10C9C, 0x0, 0x0},
    {0x10CDD, 0x10C9D, 0x0, 0x0}, {0x10CDE, 0x10C9E, 0x0, 0x0}, {0x10CDF, 0x10C9F, 0x0, 0x0},
    {0x10CE0, 0x10CA0, 0x0, 0x0}, {0x10CE1, 0x10CA1, 0x0, 0x0}, {0x10CE2, 0x10CA2, 0x0, 0x0},
    {0x10CE3, 0x10CA3, 0x0, 0x0}, {0x10CE4, 0x10CA4, 0x0, 0x0}, {0x10CE5, 0x10CA5, 0x0, 0x0},
    {0x10CE6, 0x10CA6, 0x0, 0x0}, {0x10CE7, 0x10CA7, 0x0, 0x0}, {0x10CE8, 0x10CA8, 0x0, 0x0},
    {0x10CE9, 0x10CA9, 0x0, 0x0}, {0x10CEA, 0x10CAA, 0x0, 0x0}, {0x10CEB, 0x10CAB, 0x0, 0x0},
    {0x10CEC, 0x10CAC, 0x0, 0x0}, {0x10CED, 0x10CAD, 0x0, 0x0}, {0x10CEE, 0x10CAE, 0x0, 0x0},
    {0x10CEF, 0x10CAF, 0x0, 0x0}, {0x10CF0, 0x10CB0, 0x0, 0x0}, {0x10CF1, 0x10CB1, 0x0, 0x0},
    {0x10CF2, 0x10CB2, 0x0, 0x0}, {0x10D70, 0x10D50, 0x0, 0x0}, {0x10D71, 0x10D51, 0x0, 0x0},
    {0x10D72, 0x10D52, 0x0, 0x0}, {0x10D73, 0x10D53, 0x0, 0x0}, {0x10D74, 0x10D54, 0x0, 0x0},
    {0x10D75, 0x10D55, 0x0, 0x0}, {0x10D76, 0x10D56, 0x0, 0x0}, {0x10D77, 0x10D57, 0x0, 0x0},
    {0x10D78, 0x10D58, 0x0, 0x0}, {0x10D79, 0x10D59, 0x0, 0x0}, {0x10D7A, 0x10D5A, 0x0, 0x0},
    {0x10D7B, 0x10D5B, 0x0, 0x0}, {0x10D7C, 0x10D5C, 0x0, 0x0}, {0x10D7D, 0x10D5D, 0x0, 0x0},
    {0x10D7E, 0x10D5E, 0x0, 0x0}, {0x10D7F, 0x10D5F, 0x0, 0x0}, {0x10D80, 0x10D60, 0x0, 0x0},
    {0x10D81, 0x10D61, 0x0, 0x0}, {0x10D82, 0x10D62, 0x0, 0x0}, {0x10D83, 0x10D63, 0x0, 0x0},
    {0x10D84, 0x10D64, 0x0, 0x0}, {0x10D85, 0x10D65, 0x0, 0x0}, {0x118C0, 0x118A0, 0x0, 0x0},
    {0x118C1, 0x118A1, 0x0, 0x0}, {0x118C2, 0x118A2, 0x0, 0x0}, {0x118C3, 0x118A3, 0x0, 0x0},
    {0x118C4, 0x118A4, 0x0, 0x0}, {0x118C5, 0x118A5, 0x0, 0x0}, {0x118C6, 0x118A6, 0x0, 0x0},
    {0x118C7, 0x118A7, 0x0, 0x0}, {0x118C8, 0x118A8, 0x0, 0x0}, {0x118C9, 0x118A9, 0x0, 0x0},
    {0x118CA, 0x118AA, 0x0, 0x0}, {0x118CB, 0x118AB, 0x0, 0x0}, {0x118CC, 0x118AC, 0x0, 0x0},
    {0x118CD, 0x118AD, 0x0, 0x0}, {0x118CE, 0x118AE, 0x0, 0x0}, {0x118CF, 0x118AF, 0x0, 0x0},
    {0x118D0, 0x118B0, 0x0, 0x0}, {0x118D1, 0x118B1, 0x0, 0x0}, {0x118D2, 0x118B2, 0x0, 0x0},
    {0x118D3, 0x118B3, 0x0, 0x0}, {0x118D4, 0x118B4, 0x0, 0x0}, {0x118D5, 0x118B5, 0x0, 0x0},
    {0x118D6, 0x118B6, 0x0, 0x0}, {0x118D7, 0x118B7, 0x0, 0x0}, {0x118D8, 0x118B8, 0x0, 0x0},
    {0x118D9, 0x118B9, 0x0, 0x0}, {0x118DA, 0x118BA, 0x0, 0x0}, {0x118DB, 0x118BB, 0x0, 0x0},
    {0x118DC, 0x118BC, 0x0, 0x0}, {0x118DD, 0x118BD, 0x0, 0x0}, {0x118DE, 0x118BE, 0x0, 0x0},
    {0x118DF, 0x118BF, 0x0, 0x0}, {0x16E60, 0x16E40, 0x0, 0x0}, {0x16E61, 0x16E41, 0x0, 0x0},
    {0x16E62, 0x16E42, 0x0, 0x0}, {0x16E63, 0x16E43, 0x0, 0x0}, {0x16E64, 0x16E44, 0x0, 0x0},
    {0x16E65, 0x16E45, 0x0, 0x0}, {0x16E66, 0x16E46, 0x0, 0x0}, {0x16E67, 0x16E47, 0x0, 0x0},
    {0x16E68, 0x16E48, 0x0, 0x0}, {0x16E69, 0x16E49, 0x0, 0x0}, {0x16E6A, 0x16E4A, 0x0, 0x0},
    {0x16E6B, 0x16E4B, 0x0, 0x0}, {0x16E6C, 0x16E4C, 0x0, 0x0}, {0x16E6D, 0x16E4D, 0x0, 0x0},
    {0x16E6E, 0x16E4E, 0x0, 0x0}, {0x16E6F, 0x16E4F, 0x0, 0x0}, {0x16E70, 0x16E50, 0x0, 0x0},
    {0x16E71, 0x16E51, 0x0, 0x0}, {0x16E72, 0x16E52, 0x0, 0x0}, {0x16E73, 0x16E53, 0x0, 0x0},
    {0x16E74, 0x16E54, 0x0, 0x0}, {0x16E75, 0x16E55, 0x0, 0x0}, {0x16E76, 0x16E56, 0x0, 0x0},
    {0x16E77, 0x16E57, 0x0, 0x0}, {0x16E78, 0x16E58, 0x0, 0x0}, {0x16E79, 0x16E59, 0x0, 0x0},
    {0x16E7A, 0x16E5A, 0x0, 0x0}, {0x16E7B, 0x16E5B, 0x0, 0x0}, {0x16E7C, 0x16E5C, 0x0, 0x0},
    {0x16E7D, 0x16E5D, 0x0, 0x0}, {0x16E7E, 0x16E5E, 0x0, 0x0}, {0x16E7F, 0x16E5F, 0x0, 0x0},
    {0x16EBB, 0x16EA0, 0x0, 0x0}, {0x16EBC, 0x16EA1, 0x0, 0x0}, {0x16EBD, 0x16EA2, 0x0, 0x0},
    {0x16EBE, 0x16EA3, 0x0, 0x0}, {0x16EBF, 0x16EA4, 0x0, 0x0}, {0x16EC0, 0x16EA5, 0x0, 0x0},
    {0x16EC1, 0x16EA6, 0x0, 0x0}, {0x16EC2, 0x16EA7, 0x0, 0x0}, {0x16EC3, 0x16EA8, 0x0, 0x0},
    {0x16EC4, 0x16EA9, 0x0, 0x0}, {0x16EC5, 0x16EAA, 0x0, 0x0}, {0x16EC6, 0x16EAB, 0x0, 0x0},
    {0x16EC7, 0x16EAC, 0x0, 0x0}, {0x16EC8, 0x16EAD, 0x0, 0x0}, {0x16EC9, 0x16EAE, 0x0, 0x0},
    {0x16ECA, 0x16EAF, 0x0, 0x0}, {0x16ECB, 0x16EB0, 0x0, 0x0}, {0x16ECC, 0x16EB1, 0x0, 0x0},
    {0x16ECD, 0x16EB2, 0x0, 0x0}, {0x16ECE, 0x16EB3, 0x0, 0x0}, {0x16ECF, 0x16EB4, 0x0, 0x0},
    {0x16ED0, 0x16EB5, 0x0, 0x0}, {0x16ED1, 0x16EB6, 0x0, 0x0}, {0x16ED2, 0x16EB7, 0x0, 0x0},
    {0x16ED3, 0x16EB8, 0x0, 0x0}, {0x1E922, 0x1E900, 0x0, 0x0}, {0x1E923, 0x1E901, 0x0, 0x0},
    {0x1E924, 0x1E902, 0x0, 0x0}, {0x1E925, 0x1E903, 0x0, 0x0}, {0x1E926, 0x1E904, 0x0, 0x0},
    {0x1E927, 0x1E905, 0x0, 0x0}, {0x1E928, 0x1E906, 0x0, 0x0}, {0x1E929, 0x1E907, 0x0, 0x0},
    {0x1E92A, 0x1E908, 0x0, 0x0}, {0x1E92B, 0x1E909, 0x0, 0x0}, {0x1E92C, 0x1E90A, 0x0, 0x0},
    {0x1E92D, 0x1E90B, 0x0, 0x0}, {0x1E92E, 0x1E90C, 0x0, 0x0}, {0x1E92F, 0x1E90D, 0x0, 0x0},
    {0x1E930, 0x1E90E, 0x0, 0x0}, {0x1E931, 0x1E90F, 0x0, 0x0}, {0x1E932, 0x1E910, 0x0, 0x0},
    {0x1E933, 0x1E911, 0x0, 0x0}, {0x1E934, 0x1E912, 0x0, 0x0}, {0x1E935, 0x1E913, 0x0, 0x0},
    {0x1E936, 0x1E914, 0x0, 0x0}, {0x1E937, 0x1E915, 0x0, 0x0}, {0x1E938, 0x1E916, 0x0, 0x0},
    {0x1E939, 0x1E917, 0x0, 0x0}, {0x1E93A, 0x1E918, 0x0, 0x0}, {0x1E93B, 0x1E919, 0x0, 0x0},
    {0x1E93C, 0x1E91A, 0x0, 0x0}, {0x1E93D, 0x1E91B, 0x0, 0x0}, {0x1E93E, 0x1E91C, 0x0, 0x0},
    {0x1E93F, 0x1E91D, 0x0, 0x0}, {0x1E940, 0x1E91E, 0x0, 0x0}, {0x1E941, 0x1E91F, 0x0, 0x0},
    {0x1E942, 0x1E920, 0x0, 0x0}, {0x1E943, 0x1E921, 0x0, 0x0},
};

static uint32_t scr_env_next_cp(const WCHAR *s, size_t *i) {
  uint32_t c = s[*i];
  (*i)++;
  if (c >= 0xD800 && c <= 0xDBFF && s[*i] >= 0xDC00 && s[*i] <= 0xDFFF) {
    c = 0x10000 + ((c - 0xD800) << 10) + (uint32_t)(s[*i] - 0xDC00);
    (*i)++;
  }
  return c;
}

/* The key as JS's toUpperCase answers it (full Unicode case mapping, so 'ß' becomes "SS"), malloc'd. */
static WCHAR *scr_env_upper(const WCHAR *k) {
  size_t n = wcslen(k);
  WCHAR *out = malloc((n * 3 + 1) * sizeof(WCHAR));
  if (!out) scr_child_oom();
  size_t o = 0;
  for (size_t i = 0; i < n;) {
    uint32_t c = scr_env_next_cp(k, &i);
    uint32_t res[3] = {c, 0, 0};
    size_t lo = 0, hi = sizeof scr_env_upper_tab / sizeof scr_env_upper_tab[0];
    while (lo < hi) {
      size_t mid = (lo + hi) / 2;
      if (scr_env_upper_tab[mid].cp == c) {
        memcpy(res, scr_env_upper_tab[mid].r, sizeof res);
        break;
      }
      if (scr_env_upper_tab[mid].cp < c) lo = mid + 1;
      else hi = mid;
    }
    for (int r = 0; r < 3 && res[r] != 0; r++) {
      if (res[r] >= 0x10000) {
        out[o++] = (WCHAR)(0xD800 + ((res[r] - 0x10000) >> 10));
        out[o++] = (WCHAR)(0xDC00 + ((res[r] - 0x10000) & 0x3FF));
      } else {
        out[o++] = (WCHAR)res[r];
      }
    }
  }
  out[o] = L'\0';
  return out;
}

/* lib/child_process.js (win32): the keys are sorted by default Array#sort (UTF-16 code units) and only the first key of each toUpperCase
 * class survives, so 'FOO' beats 'Foo' beats 'foo'. Marks the losers in drop[]. */
static void scr_env_filter_keys(WCHAR **keys, size_t n, bool *drop) {
  size_t *ord = malloc((n ? n : 1) * sizeof *ord);
  WCHAR **up = calloc(n ? n : 1, sizeof *up);
  if (!ord || !up) scr_child_oom();
  for (size_t i = 0; i < n; i++) ord[i] = i;
  /* insertion sort by code units, stable (n is an env's size) */
  for (size_t i = 1; i < n; i++) {
    size_t v = ord[i], j = i;
    while (j > 0 && wcscmp(keys[ord[j - 1]], keys[v]) > 0) {
      ord[j] = ord[j - 1];
      j--;
    }
    ord[j] = v;
  }
  for (size_t a = 0; a < n; a++) {
    size_t i = ord[a];
    up[i] = scr_env_upper(keys[i]);
    drop[i] = false;
    for (size_t b = 0; b < a; b++) {
      size_t k = ord[b];
      if (!drop[k] && wcscmp(up[k], up[i]) == 0) {
        drop[i] = true;
        break;
      }
    }
  }
  for (size_t i = 0; i < n; i++) free(up[i]);
  free(up);
  free(ord);
}

/* [k,v,...] pairs → the sorted, double-NUL-terminated CreateProcessW
 * block (CREATE_UNICODE_ENVIRONMENT), required vars merged in. */
static WCHAR *scr_child_env_block(ScrArr *pairs) {
  size_t n = (size_t)scr_arr_len(pairs) / 2;
  size_t nreq = sizeof scr_env_required / sizeof scr_env_required[0];
  WCHAR **items = malloc((n + nreq) * sizeof(WCHAR *));
  WCHAR **keys = malloc((n ? n : 1) * sizeof(WCHAR *));
  if (!items || !keys) scr_child_oom();
  size_t count = 0;
  for (size_t i = 0; i < n; i++) {
    ScrStr *k = (ScrStr *)scr_arr_get_ref(pairs, (double)(2 * i));
    ScrStr *v = (ScrStr *)scr_arr_get_ref(pairs, (double)(2 * i + 1));
    WCHAR *kw = scr_child_wide(k->data, k->len);
    WCHAR *vw = scr_child_wide(v->data, v->len);
    size_t kl = wcslen(kw), vl = wcslen(vw);
    WCHAR *kv = malloc((kl + 1 + vl + 1) * sizeof(WCHAR));
    if (!kv) scr_child_oom();
    wmemcpy(kv, kw, kl);
    kv[kl] = L'=';
    wmemcpy(kv + kl + 1, vw, vl + 1);
    keys[count] = kw;
    items[count++] = kv;
    free(vw);
    scr_str_release(k);
    scr_str_release(v);
  }
  {
    /* Node's win32 key filter, before the required vars merge in (they are added only when absent, as libuv does) */
    bool *drop = malloc((count ? count : 1) * sizeof *drop);
    if (!drop) scr_child_oom();
    scr_env_filter_keys(keys, count, drop);
    size_t kept = 0;
    for (size_t i = 0; i < count; i++) {
      free(keys[i]);
      if (drop[i]) {
        free(items[i]);
        continue;
      }
      items[kept++] = items[i];
    }
    count = kept;
    free(drop);
    free(keys);
  }
  for (size_t r = 0; r < nreq; r++) {
    bool present = false;
    for (size_t i = 0; i < count && !present; i++) {
      present = scr_env_keycmp(scr_env_required[r], (int)wcslen(scr_env_required[r]), items[i]) == 0;
    }
    if (present) continue;
    DWORD need = GetEnvironmentVariableW(scr_env_required[r], NULL, 0);
    if (need == 0) continue; /* the parent lacks it too */
    size_t kl = wcslen(scr_env_required[r]);
    WCHAR *kv = malloc((kl + 1 + (size_t)need) * sizeof(WCHAR));
    if (!kv) scr_child_oom();
    wmemcpy(kv, scr_env_required[r], kl);
    kv[kl] = L'=';
    (void)GetEnvironmentVariableW(scr_env_required[r], kv + kl + 1, need);
    items[count++] = kv;
  }
  qsort(items, count, sizeof(WCHAR *), scr_env_qsortcmp);
  size_t total = 1; /* the block's extra terminator */
  for (size_t i = 0; i < count; i++) total += wcslen(items[i]) + 1;
  WCHAR *block = malloc(total * sizeof(WCHAR));
  if (!block) scr_child_oom();
  WCHAR *at = block;
  for (size_t i = 0; i < count; i++) {
    size_t len = wcslen(items[i]) + 1;
    wmemcpy(at, items[i], len);
    at += len;
    free(items[i]);
  }
  *at = L'\0';
  free(items);
  return block;
}

/* The child's PATH: its own block's entry when env was replaced (the
 * required-vars merge already pulled the parent's in when unset), the
 * parent's otherwise. malloc'd, NULL when absent everywhere. */
static WCHAR *scr_child_path(const WCHAR *env_block) {
  if (env_block != NULL) {
    for (const WCHAR *p = env_block; *p != L'\0'; p += wcslen(p) + 1) {
      if ((p[0] == L'P' || p[0] == L'p') && (p[1] == L'A' || p[1] == L'a') &&
          (p[2] == L'T' || p[2] == L't') && (p[3] == L'H' || p[3] == L'h') &&
          p[4] == L'=') {
        size_t len = wcslen(p + 5);
        WCHAR *out = malloc((len + 1) * sizeof(WCHAR));
        if (!out) scr_child_oom();
        wmemcpy(out, p + 5, len + 1);
        return out;
      }
    }
    return NULL;
  }
  DWORD need = GetEnvironmentVariableW(L"PATH", NULL, 0);
  if (need == 0) return NULL;
  WCHAR *out = malloc((size_t)need * sizeof(WCHAR));
  if (!out) scr_child_oom();
  (void)GetEnvironmentVariableW(L"PATH", out, need);
  return out;
}

/* ── libuv's search_path, ported ─────────────────────────────────────── */

/* Joins dir + name + ext against cwd (the drive-relative dance included)
 * and answers the malloc'd path when a non-directory file exists there. */
static WCHAR *scr_spath_join_test(const WCHAR *dir, size_t dir_len,
                                  const WCHAR *name, size_t name_len,
                                  const WCHAR *ext, size_t ext_len,
                                  const WCHAR *cwd, size_t cwd_len) {
  if (dir_len > 2 && ((dir[0] == L'\\' || dir[0] == L'/') &&
                      (dir[1] == L'\\' || dir[1] == L'/'))) {
    /* UNC path: ignore cwd. */
    cwd_len = 0;
  } else if (dir_len >= 1 && (dir[0] == L'/' || dir[0] == L'\\')) {
    /* Full path without drive letter: use cwd's drive only. */
    cwd_len = 2;
  } else if (dir_len >= 2 && dir[1] == L':' &&
             (dir_len < 3 || (dir[2] != L'/' && dir[2] != L'\\'))) {
    /* Relative path with drive letter (D:../file): replace the drive
     * letter with the full cwd when they agree, else the dir alone. */
    if (cwd_len < 2 || _wcsnicmp(cwd, dir, 2) != 0) {
      cwd_len = 0;
    } else {
      dir += 2;
      dir_len -= 2;
    }
  } else if (dir_len > 2 && dir[1] == L':') {
    /* Absolute path with drive letter: no cwd at all. */
    cwd_len = 0;
  }

  WCHAR *result = malloc((cwd_len + 1 + dir_len + 1 + name_len + 1 + ext_len + 1) * sizeof(WCHAR));
  if (!result) scr_child_oom();
  WCHAR *pos = result;
  wcsncpy(pos, cwd, cwd_len);
  pos += cwd_len;
  if (cwd_len && wcsrchr(L"\\/:", pos[-1]) == NULL) *pos++ = L'\\';
  wcsncpy(pos, dir, dir_len);
  pos += dir_len;
  if (dir_len && wcsrchr(L"\\/:", pos[-1]) == NULL) *pos++ = L'\\';
  wcsncpy(pos, name, name_len);
  pos += name_len;
  if (ext_len) {
    if (name_len && pos[-1] != L'.') *pos++ = L'.';
    wcsncpy(pos, ext, ext_len);
    pos += ext_len;
  }
  *pos = L'\0';

  DWORD attrs = GetFileAttributesW(result);
  if (attrs != INVALID_FILE_ATTRIBUTES && !(attrs & FILE_ATTRIBUTE_DIRECTORY)) {
    return result;
  }
  free(result);
  return NULL;
}

/* The literal name (only when it has an extension), then .com, then .exe
 * — appended, never replacing (libuv follows msvcrt's spawn here). */
static WCHAR *scr_spath_walk_ext(const WCHAR *dir, size_t dir_len,
                                 const WCHAR *name, size_t name_len,
                                 const WCHAR *cwd, size_t cwd_len,
                                 int name_has_ext) {
  WCHAR *result;
  if (name_has_ext) {
    result = scr_spath_join_test(dir, dir_len, name, name_len, L"", 0, cwd, cwd_len);
    if (result != NULL) return result;
  }
  result = scr_spath_join_test(dir, dir_len, name, name_len, L"com", 3, cwd, cwd_len);
  if (result != NULL) return result;
  return scr_spath_join_test(dir, dir_len, name, name_len, L"exe", 3, cwd, cwd_len);
}

/* file + cwd + PATH → the malloc'd absolute executable path, or NULL
 * (Node's ENOENT). A file containing a separator never walks PATH; a
 * bare name checks cwd first (CreateProcess's legacy order, kept by
 * libuv behind NeedCurrentDirectoryForExePathW) then each PATH slice,
 * quoted slices unwrapped, empty slices skipped. */
static WCHAR *scr_search_path(const WCHAR *file, const WCHAR *cwd, const WCHAR *path) {
  size_t file_len = wcslen(file);
  size_t cwd_len = wcslen(cwd);

  if (file_len == 0 || (file_len == 1 && file[0] == L'.')) return NULL;

  const WCHAR *file_name_start;
  for (file_name_start = file + file_len;
       file_name_start > file && file_name_start[-1] != L'\\' &&
       file_name_start[-1] != L'/' && file_name_start[-1] != L':';
       file_name_start--) {
  }
  int file_has_dir = file_name_start != file;
  const WCHAR *dot = wcschr(file_name_start, L'.');
  int name_has_ext = dot != NULL && dot[1] != L'\0';

  if (file_has_dir) {
    return scr_spath_walk_ext(file, (size_t)(file_name_start - file),
                              file_name_start, file_len - (size_t)(file_name_start - file),
                              cwd, cwd_len, name_has_ext);
  }

  WCHAR *result = NULL;
  if (NeedCurrentDirectoryForExePathW(L"")) {
    result = scr_spath_walk_ext(L"", 0, file, file_len, cwd, cwd_len, name_has_ext);
  }
  const WCHAR *dir_end = path;
  while (result == NULL) {
    if (dir_end == NULL || *dir_end == L'\0') break;
    /* Skip the separator dir_end points at. */
    if (dir_end != path || *path == L';') dir_end++;
    const WCHAR *dir_start = dir_end;
    if (*dir_start == L'"' || *dir_start == L'\'') {
      dir_end = wcschr(dir_start + 1, *dir_start);
      if (dir_end == NULL) dir_end = wcschr(dir_start, L'\0');
    }
    dir_end = wcschr(dir_end, L';');
    if (dir_end == NULL) dir_end = wcschr(dir_start, L'\0');
    if (dir_end - dir_start == 0) continue;
    const WCHAR *dir_path = dir_start;
    size_t dir_len = (size_t)(dir_end - dir_start);
    if (dir_path[0] == L'"' || dir_path[0] == L'\'') {
      ++dir_path;
      --dir_len;
    }
    if (dir_len > 0 && (dir_path[dir_len - 1] == L'"' || dir_path[dir_len - 1] == L'\'')) {
      --dir_len;
    }
    if (dir_len == 0) continue;
    result = scr_spath_walk_ext(dir_path, dir_len, file, file_len, cwd, cwd_len, name_has_ext);
  }
  return result;
}

/* ── process creation (shared by the sync cores and spawn) ───────────── */

typedef struct {
  /* in: the child's stdio handles (already inheritable; NULL = that
   * slot stays whatever CreateProcess gives a detached-from-console
   * child — callers always fill all three). */
  HANDLE in_child, out_child, err_child;
  const ScrStr *cwd; /* NULL: inherit */
  ScrArr *env_pairs; /* NULL: inherit */
  bool detached;
  bool verbatim; /* libuv's WINDOWS_VERBATIM_ARGUMENTS (the shell form) */
  /* out */
  HANDLE proc;
  DWORD pid;
  const char *errname; /* NULL = spawned */
} ScrWinSpawn;

static void scr_win_create_process(ScrStr *cmd, ScrArr *args, ScrWinSpawn *sp) {
  sp->proc = NULL;
  sp->pid = 0;
  sp->errname = NULL;

  WCHAR *cwd_w;
  if (sp->cwd != NULL) {
    cwd_w = scr_child_wide(sp->cwd->data, sp->cwd->len);
  } else {
    DWORD need = GetCurrentDirectoryW(0, NULL);
    cwd_w = malloc((size_t)(need > 0 ? need : 1) * sizeof(WCHAR));
    if (!cwd_w) scr_child_oom();
    cwd_w[0] = L'\0';
    if (need > 0) (void)GetCurrentDirectoryW(need, cwd_w);
  }
  WCHAR *env_block = sp->env_pairs != NULL ? scr_child_env_block(sp->env_pairs) : NULL;
  WCHAR *path_w = scr_child_path(env_block);
  WCHAR *file_w = scr_child_wide(cmd->data, cmd->len);
  WCHAR *app = scr_search_path(file_w, cwd_w, path_w);
  if (app == NULL) {
    sp->errname = "ENOENT";
    free(file_w);
    free(path_w);
    free(env_block);
    free(cwd_w);
    return;
  }
  WCHAR *cmdline = scr_child_cmdline(cmd, args, sp->verbatim);

  STARTUPINFOW si;
  memset(&si, 0, sizeof si);
  si.cb = sizeof si;
  si.dwFlags = STARTF_USESTDHANDLES;
  si.hStdInput = sp->in_child;
  si.hStdOutput = sp->out_child;
  si.hStdError = sp->err_child;
  DWORD flags = CREATE_UNICODE_ENVIRONMENT;
  if (sp->detached) flags |= DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP;

  PROCESS_INFORMATION pi;
  if (!CreateProcessW(app, cmdline, NULL, NULL, TRUE, flags, env_block,
                      sp->cwd != NULL ? cwd_w : NULL, &si, &pi)) {
    sp->errname = scr_win_errname(GetLastError());
  } else {
    CloseHandle(pi.hThread);
    sp->proc = pi.hProcess;
    sp->pid = pi.dwProcessId;
  }
  free(cmdline);
  free(app);
  free(file_w);
  free(path_w);
  free(env_block);
  free(cwd_w);
}

/* Inheritable stdio helpers. Every handle these mint is CLOSED by the
 * caller after CreateProcessW (the child holds its own copies). */
static HANDLE scr_win_nul(bool writable) {
  SECURITY_ATTRIBUTES sa = {sizeof(SECURITY_ATTRIBUTES), NULL, TRUE};
  HANDLE h = CreateFileW(L"NUL", writable ? GENERIC_WRITE : GENERIC_READ,
                         FILE_SHARE_READ | FILE_SHARE_WRITE, &sa, OPEN_EXISTING, 0, NULL);
  return h == INVALID_HANDLE_VALUE ? NULL : h;
}

static HANDLE scr_win_dup_inherit(HANDLE src) {
  if (src == NULL || src == INVALID_HANDLE_VALUE) return NULL;
  HANDLE out = NULL;
  if (!DuplicateHandle(GetCurrentProcess(), src, GetCurrentProcess(), &out, 0,
                       TRUE, DUPLICATE_SAME_ACCESS)) {
    return NULL;
  }
  return out;
}

/* A capture/stream pipe: child's end inheritable, parent's not. False =
 * pipe exhaustion (the caller degrades the slot to NUL). */
static bool scr_win_pipe(HANDLE *parent_end, HANDLE *child_end, bool child_writes) {
  SECURITY_ATTRIBUTES sa = {sizeof(SECURITY_ATTRIBUTES), NULL, TRUE};
  HANDLE rd = NULL, wr = NULL;
  if (!CreatePipe(&rd, &wr, &sa, 65536)) return false;
  *parent_end = child_writes ? rd : wr;
  *child_end = child_writes ? wr : rd;
  (void)SetHandleInformation(*parent_end, HANDLE_FLAG_INHERIT, 0);
  return true;
}

/* ── capture buffers (the POSIX arm's shape) ─────────────────────────── */

typedef struct {
  char *data;
  size_t len, cap;
} ScrCapBuf;

static void scr_cap_init(ScrCapBuf *b) {
  b->cap = 4096;
  b->len = 0;
  b->data = malloc(b->cap);
  if (!b->data) scr_child_oom();
}

/* One drain pass over a capture pipe: everything PeekNamedPipe reports,
 * chunk by chunk. EOF (every writer closed — ERROR_BROKEN_PIPE) closes
 * the handle and flips *open_. Returns true when anything changed. */
static bool scr_win_cap_pump(HANDLE h, ScrCapBuf *b, bool *open_) {
  bool progress = false;
  for (;;) {
    DWORD avail = 0;
    if (!PeekNamedPipe(h, NULL, 0, NULL, &avail, NULL)) {
      CloseHandle(h);
      *open_ = false;
      return true;
    }
    if (avail == 0) return progress;
    if (avail > 65536) avail = 65536;
    if (b->len + avail > b->cap) {
      while (b->len + avail > b->cap) b->cap *= 2;
      b->data = realloc(b->data, b->cap);
      if (!b->data) scr_child_oom();
    }
    DWORD got = 0;
    if (!ReadFile(h, b->data + b->len, avail, &got, NULL) || got == 0) {
      CloseHandle(h);
      *open_ = false;
      return true;
    }
    b->len += got;
    progress = true;
  }
}

/* ── the synchronous run core ────────────────────────────────────────── */

typedef struct {
  const char *spawn_errname; /* NULL = the child ran (and was reaped) */
  bool timed_out;            /* the deadline TerminateProcess fired */
  DWORD exit_code;
  ScrCapBuf out, err; /* always initialized; caller frees */
} ScrWinSyncRes;

/* in_mode: 0 = NUL (Node's no-input default; an `input` string swaps in
 * a fed pipe), 2 = inherit. out/err_mode: 0 = capture, 1 = NUL, 2 =
 * inherit. timeout_ms > 0 arms the deadline: TerminateProcess(h, 1) —
 * libuv's kill emulation; the caller reports the killSignal's name. */
static void scr_win_run_sync(ScrStr *cmd, ScrArr *args, const ScrStr *input,
                             int in_mode, int out_mode, int err_mode,
                             const ScrStr *cwd, ScrArr *env_pairs,
                             double timeout_ms, bool verbatim,
                             ScrWinSyncRes *res) {
  res->spawn_errname = NULL;
  res->timed_out = false;
  res->exit_code = 0;
  scr_cap_init(&res->out);
  scr_cap_init(&res->err);

  if (in_mode == 2 || out_mode == 2 || err_mode == 2) {
    /* Inherited stdio: flush the parent's buffers first so earlier logs
     * precede the child's writes (Node's practical ordering). */
    fflush(stdout);
    fflush(stderr);
  }

  HANDLE in_child = NULL, in_parent = NULL;
  HANDLE out_child = NULL, out_parent = NULL;
  HANDLE err_child = NULL, err_parent = NULL;
  if (input != NULL) {
    if (scr_win_pipe(&in_parent, &in_child, false)) {
      DWORD mode = PIPE_NOWAIT;
      (void)SetNamedPipeHandleState(in_parent, &mode, NULL, NULL);
    } else {
      in_child = scr_win_nul(false);
    }
  } else if (in_mode == 2) {
    in_child = scr_win_dup_inherit(GetStdHandle(STD_INPUT_HANDLE));
    if (in_child == NULL) in_child = scr_win_nul(false);
  } else {
    in_child = scr_win_nul(false);
  }
  if (out_mode == 0) {
    if (!scr_win_pipe(&out_parent, &out_child, true)) out_child = scr_win_nul(true);
  } else if (out_mode == 2) {
    out_child = scr_win_dup_inherit(GetStdHandle(STD_OUTPUT_HANDLE));
    if (out_child == NULL) out_child = scr_win_nul(true);
  } else {
    out_child = scr_win_nul(true);
  }
  if (err_mode == 0) {
    if (!scr_win_pipe(&err_parent, &err_child, true)) err_child = scr_win_nul(true);
  } else if (err_mode == 2) {
    err_child = scr_win_dup_inherit(GetStdHandle(STD_ERROR_HANDLE));
    if (err_child == NULL) err_child = scr_win_nul(true);
  } else {
    err_child = scr_win_nul(true);
  }

  ScrWinSpawn sp = {
      .in_child = in_child,
      .out_child = out_child,
      .err_child = err_child,
      .cwd = cwd,
      .env_pairs = env_pairs,
      .detached = false,
      .verbatim = verbatim,
  };
  scr_win_create_process(cmd, args, &sp);
  if (in_child != NULL) CloseHandle(in_child);
  if (out_child != NULL) CloseHandle(out_child);
  if (err_child != NULL) CloseHandle(err_child);
  if (sp.errname != NULL) {
    if (in_parent != NULL) CloseHandle(in_parent);
    if (out_parent != NULL) CloseHandle(out_parent);
    if (err_parent != NULL) CloseHandle(err_parent);
    res->spawn_errname = sp.errname;
    return;
  }

  /* Pump: drain both captures, feed stdin (PIPE_NOWAIT — a full pipe
   * writes short, never blocks), watch the deadline. The 1ms wait rides
   * the process handle so an exit ends the sleep immediately; pipes keep
   * draining after exit until every writer's copy closes (a grandchild
   * may hold one — the POSIX arm's discipline). */
#ifdef SCR_ARRCEN_ON
  /* tests/perf/arrcensus/scr_arr_census.h. The suspend-and-sample profiler
   * reports this function at 66.9% of the bench's RECV group phase, and an
   * earlier 93.81% reading of it was refuted as a thread-selection artifact.
   * Counting the pump's own iterations and reading this thread's own cycle
   * counter across the whole blocking call answers the same question with
   * none of the sampler's assumptions. Inert unless that header is
   * -include'd. */
  long long scr_arrcen_iters = 0;
  ULONG64 scr_arrcen_c0 = 0, scr_arrcen_c1 = 0;
  DWORD scr_arrcen_t0 = GetTickCount();
  (void)QueryThreadCycleTime(GetCurrentThread(), &scr_arrcen_c0);
#endif
  bool out_open = out_parent != NULL, err_open = err_parent != NULL;
  bool in_open = in_parent != NULL;
  size_t in_at = 0;
  bool exited = false;
  double deadline = timeout_ms > 0 ? scr_now_ms() + timeout_ms : 0;
  for (;;) {
    bool progress = false;
    if (out_open) progress |= scr_win_cap_pump(out_parent, &res->out, &out_open);
    if (err_open) progress |= scr_win_cap_pump(err_parent, &res->err, &err_open);
    if (in_open) {
      /* Small chunks: PIPE_NOWAIT's partial-write behavior is only
       * dependable for writes no larger than the pipe buffer. */
      DWORD want = input->len - in_at > 2048 ? 2048 : (DWORD)(input->len - in_at);
      DWORD wrote = 0;
      if (want == 0) {
        CloseHandle(in_parent);
        in_open = false;
      } else if (WriteFile(in_parent, input->data + in_at, want, &wrote, NULL)) {
        if (wrote > 0) {
          in_at += wrote;
          progress = true;
        }
        if (in_at >= input->len) {
          CloseHandle(in_parent);
          in_open = false;
        }
      } else {
        /* The child closed stdin early: fine, like Node. */
        CloseHandle(in_parent);
        in_open = false;
      }
    }
    if (deadline > 0 && !res->timed_out && scr_now_ms() >= deadline) {
      res->timed_out = true;
      (void)TerminateProcess(sp.proc, 1); /* killed children exit 1 (uv) */
    }
#ifdef SCR_ARRCEN_ON
    scr_arrcen_iters++;
#endif
    if (!exited) {
      exited = WaitForSingleObject(sp.proc, progress ? 0 : 1) == WAIT_OBJECT_0;
    } else if (!progress) {
      Sleep(1);
    }
    if (exited && !out_open && !err_open) break;
  }
#ifdef SCR_ARRCEN_ON
  (void)QueryThreadCycleTime(GetCurrentThread(), &scr_arrcen_c1);
  scr_arrcen_note_pump(scr_arrcen_iters,
                       (unsigned long long)(scr_arrcen_c1 - scr_arrcen_c0),
                       (long long)(GetTickCount() - scr_arrcen_t0));
#endif
  if (in_open) CloseHandle(in_parent);
  (void)GetExitCodeProcess(sp.proc, &res->exit_code);
  CloseHandle(sp.proc);
}

/* ── the spawnSync result value (the POSIX arm's container) ──────────── */

struct ScrSpawnRes {
  size_t rc;
  bool has_status;
  double status;
  ScrStr *out;
  ScrStr *err;
  /* Node's `output` array exists only when the child was really started:
   * on a SPAWN FAILURE v25 leaves it null and derives the streams with
   * `result.output?.[1]`, so `stdout` and `stderr` are UNDEFINED there —
   * not "" and not the empty capture. The strings below stay "" so every
   * existing reader keeps a valid ScrStr; this flag is what the
   * undefined-armed read consults. */
  bool has_out;
  const char *spawn_errname;
  ScrStr *cmd;
  const char *signal_name;
};

ScrSpawnRes *scr_spawn_res_retain(ScrSpawnRes *r) {
  if (r->rc != SIZE_MAX) r->rc++;
  return r;
}

void scr_spawn_res_release(ScrSpawnRes *r) {
  if (!r || r->rc == SIZE_MAX) return;
  if (--r->rc == 0) {
    scr_str_release(r->out);
    scr_str_release(r->err);
    scr_str_release(r->cmd); /* NULL-safe */
    free(r);
  }
}

void *scr_spawn_res_retain_v(void *p) { return scr_spawn_res_retain((ScrSpawnRes *)p); }
void scr_spawn_res_release_v(void *p) { scr_spawn_res_release((ScrSpawnRes *)p); }

bool scr_spawn_res_has_status(ScrSpawnRes *r) { return r->has_status; }
double scr_spawn_res_status(ScrSpawnRes *r) { return r->status; }
ScrStr *scr_spawn_res_stdout(ScrSpawnRes *r) { return scr_str_retain(r->out); }
ScrStr *scr_spawn_res_stderr(ScrSpawnRes *r) { return scr_str_retain(r->err); }
/* Node's `output !== null`: false ONLY when the spawn itself failed, and
 * then `result.stdout` / `result.stderr` are undefined. */
bool scr_spawn_res_has_output(ScrSpawnRes *r) { return r->has_out; }
bool scr_spawn_res_has_signal(ScrSpawnRes *r) { return r->signal_name != NULL; }
ScrStr *scr_spawn_res_signal(ScrSpawnRes *r) {
  return scr_str_new(r->signal_name, strlen(r->signal_name));
}

ScrError *scr_spawn_res_error(ScrSpawnRes *r) {
  if (r->spawn_errname == NULL) return NULL;
  size_t cap = 10 + (r->cmd ? r->cmd->len : 0) + 1 + strlen(r->spawn_errname) + 1;
  char *msg = malloc(cap);
  if (!msg) scr_child_oom();
  snprintf(msg, cap, "spawnSync %s %s", r->cmd ? r->cmd->data : "", r->spawn_errname);
  ScrStr *m = scr_str_new(msg, strlen(msg));
  free(msg);
  ScrError *e = scr_error_new(0 /* Error */, m);
  scr_str_release(m);
  scr_error_set_code(e, r->spawn_errname);
  return e;
}

static ScrSpawnRes *scr_spawn_res_new(bool has_status, double status,
                                      ScrStr *out /*moved*/, ScrStr *err /*moved*/) {
  ScrSpawnRes *r = malloc(sizeof(ScrSpawnRes));
  if (!r) scr_child_oom();
  r->rc = 1;
  r->has_status = has_status;
  r->status = status;
  r->out = out;
  r->err = err;
  r->has_out = true;
  r->spawn_errname = NULL;
  r->cmd = NULL;
  r->signal_name = NULL;
  return r;
}

/* Kept for the header's contract (the POSIX arms share it); no Windows
 * caller — CreateProcessW takes the quoted command LINE instead. */
char **scr_child_argv(ScrStr *cmd, ScrArr *args) {
  size_t n = (size_t)scr_arr_len(args);
  char **argv = malloc((n + 2) * sizeof(char *));
  if (!argv) scr_child_oom();
  argv[0] = cmd->data;
  for (size_t i = 0; i < n; i++) {
    ScrStr *s = (ScrStr *)scr_arr_get_ref(args, (double)i);
    argv[i + 1] = s->data;
    scr_str_release(s); /* borrow: the array's reference keeps it alive */
  }
  argv[n + 1] = NULL;
  return argv;
}

/* ── spawnSync ───────────────────────────────────────────────────────── */

static ScrSpawnRes *scr_spawn_sync_core(ScrStr *cmd, ScrArr *args, double timeout_ms,
                                        int killsig, int in_mode, int out_mode,
                                        int err_mode) {
  ScrWinSyncRes w;
  scr_win_run_sync(cmd, args, NULL, in_mode, out_mode, err_mode, NULL, NULL,
                   timeout_ms, false, &w);
  if (w.spawn_errname != NULL) {
    free(w.out.data);
    free(w.err.data);
    ScrSpawnRes *r = scr_spawn_res_new(false, 0, scr_str_new("", 0), scr_str_new("", 0));
    r->has_out = false; /* Node: no `output` array at all — the streams read undefined */
    r->spawn_errname = w.spawn_errname;
    r->cmd = scr_str_retain(cmd);
    return r;
  }
  ScrStr *out_s = scr_str_new(w.out.data, w.out.len);
  ScrStr *err_s = scr_str_new(w.err.data, w.err.len);
  free(w.out.data);
  free(w.err.data);
  if (!w.timed_out) {
    return scr_spawn_res_new(true, (double)w.exit_code, out_s, err_s);
  }
  /* Node's timeout shape: status null, signal = killSignal's name, error
   * ETIMEDOUT (the kill may have raced a normal exit; Node reports the
   * timeout either way). */
  ScrSpawnRes *r = scr_spawn_res_new(false, 0, out_s, err_s);
  r->signal_name = scr_signal_name(killsig);
  if (r->signal_name == NULL) r->signal_name = "SIGTERM";
  r->spawn_errname = "ETIMEDOUT";
  r->cmd = scr_str_retain(cmd);
  return r;
}

ScrSpawnRes *scr_spawn_sync(ScrStr *cmd, ScrArr *args) {
  return scr_spawn_sync_core(cmd, args, 0, SIGTERM, 0, 0, 0);
}

ScrSpawnRes *scr_spawn_sync_opts(ScrStr *cmd, ScrArr *args, double timeout_ms,
                                 ScrStr *killsignal, double in_mode,
                                 double out_mode, double err_mode) {
  int killsig = SIGTERM;
  if (killsignal->len > 0) {
    int resolved = scr_signal_from_name(killsignal);
    if (resolved > 0) killsig = resolved;
  }
  return scr_spawn_sync_core(cmd, args, timeout_ms, killsig, (int)in_mode,
                             (int)out_mode, (int)err_mode);
}

ScrSpawnRes *scr_spawn_sync_stdio_str(ScrStr *cmd, ScrArr *args, double timeout_ms,
                                      ScrStr *killsignal, ScrStr *stdio) {
  double in_mode = 0, out_mode = 0, err_mode = 0; /* "pipe": the defaults */
  if (stdio->len == 7 && memcmp(stdio->data, "inherit", 7) == 0) {
    in_mode = 2;
    out_mode = 2;
    err_mode = 2;
  } else if (stdio->len == 6 && memcmp(stdio->data, "ignore", 6) == 0) {
    out_mode = 1;
    err_mode = 1;
  }
  return scr_spawn_sync_opts(cmd, args, timeout_ms, killsignal, in_mode, out_mode, err_mode);
}

/* ── execFileSync / execSync (the POSIX arm's message contracts) ─────── */

static char *scr_exec_display(ScrStr *cmd, ScrArr *args, bool shell) {
  if (shell) {
    ScrStr *c = (ScrStr *)scr_arr_get_ref(args, 1); /* ["-c", cmd] */
    char *out = malloc(c->len + 1);
    if (!out) scr_child_oom();
    memcpy(out, c->data, c->len + 1);
    scr_str_release(c);
    return out;
  }
  size_t n = (size_t)scr_arr_len(args);
  size_t total = cmd->len;
  for (size_t i = 0; i < n; i++) {
    ScrStr *s = (ScrStr *)scr_arr_get_ref(args, (double)i);
    total += 1 + s->len;
    scr_str_release(s);
  }
  char *out = malloc(total + 1);
  if (!out) scr_child_oom();
  memcpy(out, cmd->data, cmd->len);
  size_t at = cmd->len;
  for (size_t i = 0; i < n; i++) {
    ScrStr *s = (ScrStr *)scr_arr_get_ref(args, (double)i);
    out[at++] = ' ';
    memcpy(out + at, s->data, s->len);
    at += s->len;
    scr_str_release(s);
  }
  out[at] = '\0';
  return out;
}

static void scr_exec_throw_failed(const char *display, const ScrCapBuf *err_cap,
                                  bool with_stderr, bool always_nl) {
  size_t dlen = strlen(display);
  size_t elen = with_stderr ? err_cap->len : 0;
  size_t cap = 16 + dlen + 1 + elen + 1;
  char *msg = malloc(cap);
  if (!msg) scr_child_oom();
  size_t at = (size_t)snprintf(msg, cap, "Command failed: %s", display);
  if (elen > 0 || always_nl) {
    msg[at++] = '\n';
    memcpy(msg + at, err_cap->data, elen);
    at += elen;
  }
  scr_throw_error_msg(SCR_ERR_ERROR, msg, at);
  free(msg);
}

static void scr_exec_throw_spawn(ScrStr *cmd, const char *errname, bool async_shape) {
  size_t cap = 10 + cmd->len + 1 + strlen(errname) + 1;
  char *msg = malloc(cap);
  if (!msg) scr_child_oom();
  int len = snprintf(msg, cap, "%s %s %s", async_shape ? "spawn" : "spawnSync",
                     cmd->data, errname);
  scr_throw_error_msg_code(SCR_ERR_ERROR, msg, (size_t)len, errname);
  free(msg);
}

/* execSync's shell, the Windows spelling.
 *
 * The frontend lowers `execSync(command)` to the POSIX shell form —
 * cmd = "/bin/sh", args = ["-c", command] — because that is what the
 * shell means on the platform the lowering was written for. Windows has
 * no /bin/sh, so this arm used to resolve ENOENT and throw where Node
 * runs the command perfectly well. Node's own child_process does the
 * platform switch at spawn time, and so does this:
 *
 *   file = %ComSpec% (or "cmd.exe"), args = /d /s /c "<command>",
 *   windowsVerbatimArguments = true
 *
 * /d skips AutoRun, /s makes cmd strip exactly the outer quote pair and
 * take the rest of the line verbatim (which is why the command is
 * wrapped and why the args must not be re-quoted), /c runs and exits.
 *
 * Node picks the /d /s /c spelling only when the shell LOOKS like cmd —
 * `(?:.*\)?cmd(?:\.exe)?` case-insensitively — and falls back to
 * `-c <command>` otherwise, so a ComSpec pointing at a POSIX shell keeps
 * working. That test is ported here rather than assumed.
 *
 * The rewrite is local to the spawn: the ORIGINAL cmd/args still feed
 * scr_exec_display, so "Command failed: <command>" keeps naming what the
 * user wrote instead of the cmd.exe line. Nothing outside this arm
 * changes, and the POSIX arm below still spawns /bin/sh directly. */
static bool scr_win_shell_is_cmd(const char *file, size_t len) {
  /* the basename, after the last \ or / */
  size_t start = 0;
  for (size_t i = 0; i < len; i++) {
    if (file[i] == '\\' || file[i] == '/') start = i + 1;
  }
  size_t n = len - start;
  const char *b = file + start;
  if (n == 3) return _strnicmp(b, "cmd", 3) == 0;
  if (n == 7) return _strnicmp(b, "cmd.exe", 7) == 0;
  return false;
}

/* Builds the shell invocation. Returns the file to spawn (caller
 * releases) and fills *out_args (caller releases) and *out_verbatim. */
static ScrStr *scr_win_shell_argv(const ScrStr *command, ScrArr **out_args,
                                  bool *out_verbatim) {
  const char *comspec = getenv("ComSpec");
  if (comspec == NULL || comspec[0] == '\0') comspec = getenv("COMSPEC");
  if (comspec == NULL || comspec[0] == '\0') comspec = "cmd.exe";
  size_t flen = strlen(comspec);
  ScrStr *file = scr_str_new(comspec, flen);
  ScrArr *a = scr_arr_new(SCR_ELEM_STR, 4);
  if (scr_win_shell_is_cmd(comspec, flen)) {
    /* /d /s /c "<command>" — verbatim, cmd strips the wrapper itself. */
    size_t qlen = command->len + 2;
    char *q = malloc(qlen + 1);
    if (!q) scr_child_oom();
    q[0] = '"';
    memcpy(q + 1, command->data, command->len);
    q[qlen - 1] = '"';
    q[qlen] = '\0';
    scr_arr_push_ref(a, scr_str_new("/d", 2));
    scr_arr_push_ref(a, scr_str_new("/s", 2));
    scr_arr_push_ref(a, scr_str_new("/c", 2));
    scr_arr_push_ref(a, scr_str_new(q, qlen));
    free(q);
    *out_verbatim = true;
  } else {
    scr_arr_push_ref(a, scr_str_new("-c", 2));
    scr_arr_push_ref(a, scr_str_new(command->data, command->len));
    *out_verbatim = false;
  }
  *out_args = a;
  return file;
}

/* The shared exec body (sync + promisified shapes — the POSIX arm's
 * scr_exec_sync_core semantics over the win run core). */
static ScrStr *scr_exec_run(ScrStr *cmd, ScrArr *args, bool shell,
                            const ScrStr *input, const ScrStr *cwd,
                            ScrArr *env_pairs, double timeout_ms,
                            int stdout_mode, int stderr_mode, bool async_shape,
                            ScrStr **stderr_out) {
  /* stdio "inherit"'s stdin rides bit 4 of stdout_mode (scr_runtime.h). */
  bool stdin_inherit = (stdout_mode & 4) != 0;
  stdout_mode &= 3;
  bool cap_out = stdout_mode == 1;
  bool cap_err = stderr_mode == 0 || stderr_mode == 1;
  ScrWinSyncRes w;
  /* The shell form spawns cmd.exe, not the lowering's /bin/sh; the
   * originals stay bound for scr_exec_display below. */
  ScrStr *spawn_cmd = cmd;
  ScrArr *spawn_args = args;
  bool verbatim = false;
  ScrStr *shell_file = NULL;
  ScrArr *shell_args = NULL;
  if (shell) {
    ScrStr *command = (ScrStr *)scr_arr_get_ref(args, 1); /* ["-c", cmd] */
    shell_file = scr_win_shell_argv(command, &shell_args, &verbatim);
    scr_str_release(command);
    spawn_cmd = shell_file;
    spawn_args = shell_args;
  }
  scr_win_run_sync(spawn_cmd, spawn_args, input, stdin_inherit ? 2 : 0,
                   cap_out ? 0 : (stdout_mode == 2 ? 2 : 1),
                   cap_err ? 0 : (stderr_mode == 3 ? 2 : 1), cwd,
                   env_pairs, timeout_ms, verbatim, &w);
  if (shell_file != NULL) scr_str_release(shell_file);
  if (shell_args != NULL) scr_arr_release(shell_args);
  if (w.spawn_errname != NULL) {
    free(w.out.data);
    free(w.err.data);
    scr_exec_throw_spawn(cmd, w.spawn_errname, async_shape);
    return NULL;
  }
  if (w.timed_out && !async_shape) {
    /* The SYNC forms throw Node's spawnSync ETIMEDOUT; the async shape
     * reports the kill's exit-1 death as an ordinary command failure
     * below, exactly Node's promisified execFile. */
    free(w.out.data);
    free(w.err.data);
    scr_exec_throw_spawn(cmd, "ETIMEDOUT", false);
    return NULL;
  }
  bool failed = w.exit_code != 0;
  /* Node's inheritStderr: no stdio option given → the captured stderr
   * echoes to the parent's stderr AFTER completion, success or failure. */
  if (stderr_mode == 0 && w.err.len > 0) {
    fflush(stdout);
    fwrite(w.err.data, 1, w.err.len, stderr);
  }
  if (failed) {
    char *display = scr_exec_display(cmd, args, shell);
    scr_exec_throw_failed(display, &w.err, cap_err, async_shape);
    free(display);
    free(w.out.data);
    free(w.err.data);
    return NULL;
  }
  if (async_shape && stderr_out != NULL) {
    *stderr_out = scr_str_new(w.err.data, w.err.len);
  }
  ScrStr *out_s = scr_str_new(w.out.data, w.out.len);
  free(w.out.data);
  free(w.err.data);
  return out_s;
}

ScrStr *scr_exec_sync(ScrStr *cmd, ScrArr *args, bool shell, ScrStr *input,
                      bool has_input, ScrStr *cwd, bool has_env, ScrArr *env_pairs,
                      double timeout_ms, double stdout_mode, double stderr_mode) {
  return scr_exec_run(cmd, args, shell, has_input ? input : NULL,
                      cwd->len > 0 ? cwd : NULL, has_env ? env_pairs : NULL,
                      timeout_ms, (int)stdout_mode, (int)stderr_mode, false, NULL);
}

ScrSpawnRes *scr_exec_capture(ScrStr *cmd, ScrArr *args, ScrStr *cwd,
                              bool has_env, ScrArr *env_pairs, double timeout_ms) {
  ScrStr *err_s = NULL;
  ScrStr *out_s = scr_exec_run(cmd, args, false, NULL, cwd->len > 0 ? cwd : NULL,
                               has_env ? env_pairs : NULL, timeout_ms, 1, 1,
                               true, &err_s);
  if (out_s == NULL) return NULL; /* exception pending; dummy result */
  return scr_spawn_res_new(true, 0, out_s, err_s);
}

/* ── spawn: the asynchronous child + its event registry ──────────────────
 * The POSIX arm's design (see its block comment below), re-plumbed:
 * waitpid(WNOHANG) → WaitForSingleObject(h, 0) + GetExitCodeProcess,
 * kqueue/pidfd wakeups → WaitForMultipleObjects over process handles in
 * scr_children_wait, piped streams → PeekNamedPipe pumps under the
 * loop's ~1ms polling cap (anonymous-pipe readability has no waitable
 * handle, so consumer-owning streams decline the wait — the unwatched
 * fallback). Listener ordering, settle discipline, unref/teardown, and
 * the unhandled-'error' exit are copied unchanged. */

typedef enum {
  SCR_CHILD_RUNNING = 0,
  SCR_CHILD_EXITED = 1,
  SCR_CHILD_SPAWN_FAILED = 2
} ScrChildState;

typedef struct {
  ScrClosure *cb;
  ScrChildExitFn fn;
} ScrChildExitEntry;

typedef struct {
  ScrClosure *cb;
  ScrChildErrFn fn;
} ScrChildErrEntry;

typedef struct {
  ScrClosure *cb; /* owned */
  ScrChildStreamDataFn fn;
  bool once;
} ScrChildStreamDataL;

typedef struct {
  ScrClosure *cb; /* owned */
  bool once;
} ScrChildStreamEndL;

struct ScrChildStream {
  size_t rc;
  HANDLE h; /* the pipe's read end; NULL after EOF or spawn failure */
  bool eof;
  /* Node's readableFlowing, sticky: set by the first 'data' listener or by
   * the exit flush (flushStdio's resume). Never cleared: a consumed once()
   * leaves the stream flowing, so later data discards and 'end' still fires. */
  bool flowing;
  ScrChildStreamDataL *data_ls;
  size_t n_data, cap_data;
  ScrChildStreamEndL *end_ls;
  size_t n_end, cap_end;
  struct ScrChildStream *next; /* the service registry (+1) */
  const ScrChildStreamForeign *fx; /* non-NULL: a view of a foreign stream object (see scr_child_stream_foreign_new) */
  void *fobj;                      /* the foreign object (+1), when fx */
};

static ScrChildStream *scr_child_streams = NULL;
static size_t scr_child_streams_watching = 0;

struct ScrChild {
  size_t rc;
  HANDLE proc; /* NULL after the reap (or spawn failure) */
  DWORD pid;
  ScrChildState state;
  bool settled;
  bool has_code;
  bool killed;
  bool reffed;
  int spawn_uv_errno;       /* spawn failure: Node's exitCode (negative) */
  const char *spawn_errname; /* spawn failure: the `code` stamp */
  double code;
  const char *exit_signal; /* we killed it: the signal's name (static) */
  const char *kill_signal; /* recorded when kill() terminates the child */
  ScrStr *err_msg;         /* spawn failure only: "spawn <cmd> <ERRNAME>" */
  ScrChildExitEntry *exit_cbs;
  size_t n_exit, cap_exit;
  ScrChildErrEntry *err_cbs;
  size_t n_err, cap_err;
  ScrChildStream *out_stream;
  ScrChildStream *err_stream;
  struct ScrChild *next; /* the pending registry */
};

static ScrChild *scr_children = NULL;
static size_t scr_children_reffed_n = 0;
/* Pending children the handle wait can NOT represent — spawn failures
 * awaiting their first-pass settle. While any exist, scr_children_wait
 * declines and the loop keeps the ~1ms polling cap (the POSIX arm's
 * unwatched fallback, exactly). */
static size_t scr_children_unwatched = 0;

static void scr_child_drop_listeners(ScrChild *c) {
  for (size_t i = 0; i < c->n_exit; i++) scr_closure_release(c->exit_cbs[i].cb);
  for (size_t i = 0; i < c->n_err; i++) scr_closure_release(c->err_cbs[i].cb);
  free(c->exit_cbs);
  free(c->err_cbs);
  c->exit_cbs = NULL;
  c->err_cbs = NULL;
  c->n_exit = c->n_err = c->cap_exit = c->cap_err = 0;
}

ScrChild *scr_child_retain(ScrChild *c) {
  if (c->rc != SIZE_MAX) c->rc++;
  return c;
}

void scr_child_release(ScrChild *c) {
  if (!c || c->rc == SIZE_MAX) return;
  if (--c->rc == 0) {
    scr_child_drop_listeners(c); /* only reachable pre-settle via leaks */
    scr_str_release(c->err_msg);
    scr_child_stream_release(c->out_stream);
    scr_child_stream_release(c->err_stream);
    if (c->proc != NULL) CloseHandle(c->proc);
    scr_child_free_note();
    free(c);
  }
}

void *scr_child_retain_v(void *p) { return scr_child_retain((ScrChild *)p); }
void scr_child_release_v(void *p) { scr_child_release((ScrChild *)p); }

/* ── the stream slice (PeekNamedPipe pumps) ──────────────────────────── */

ScrChildStream *scr_child_stream_retain(ScrChildStream *s) {
  if (s->rc != SIZE_MAX) s->rc++;
  return s;
}

static void scr_child_stream_drop_listeners(ScrChildStream *s) {
  for (size_t i = 0; i < s->n_data; i++) scr_closure_release(s->data_ls[i].cb);
  for (size_t i = 0; i < s->n_end; i++) scr_closure_release(s->end_ls[i].cb);
  free(s->data_ls);
  free(s->end_ls);
  s->data_ls = NULL;
  s->end_ls = NULL;
  s->n_data = s->n_end = s->cap_data = s->cap_end = 0;
}

void scr_child_stream_release(ScrChildStream *s) {
  if (!s || s->rc == SIZE_MAX) return;
  if (--s->rc == 0) {
    scr_child_stream_drop_listeners(s); /* only reachable pre-'end' via leaks */
    if (s->fx != NULL) s->fx->release(s->fobj);
    if (s->h != NULL) CloseHandle(s->h);
    scr_childstream_free_note();
    free(s);
  }
}

void *scr_child_stream_retain_v(void *p) { return scr_child_stream_retain((ScrChildStream *)p); }
void scr_child_stream_release_v(void *p) { scr_child_stream_release((ScrChildStream *)p); }

/* True while the stream has a consumer and can still deliver. */
static bool scr_child_stream_watching(const ScrChildStream *s) {
  return !s->eof && s->h != NULL && s->flowing;
}

/* A fresh piped stream over the pipe's read end, registered with the
 * service registry (+1). NULL = the never-opened husk a degraded pipe
 * slot hands out (eof from birth, never registered). */
static ScrChildStream *scr_child_stream_new(HANDLE h) {
  ScrChildStream *s = calloc(1, sizeof *s);
  if (!s) scr_child_oom();
  scr_childstream_alloc_note();
  s->rc = 1;
  s->h = h;
  if (h == NULL) {
    s->eof = true;
    return s;
  }
  s->next = scr_child_streams;
  scr_child_streams = scr_child_stream_retain(s);
  return s;
}

static void scr_child_stream_finish(ScrChildStream *s, bool fire_end) {
  if (scr_child_stream_watching(s)) scr_child_streams_watching--;
  s->eof = true;
  if (s->h != NULL) {
    CloseHandle(s->h);
    s->h = NULL;
  }
  if (fire_end) {
    size_t n = s->n_end;
    ScrChildStreamEndL *snap = malloc(n * sizeof *snap);
    if (!snap) scr_child_oom();
    for (size_t i = 0; i < n; i++) {
      snap[i] = s->end_ls[i];
      scr_closure_retain(snap[i].cb);
    }
    for (size_t i = 0; i < n; i++) {
      if (!scr_exc_pending()) {
        ((void (*)(ScrClosure *))snap[i].cb->fn)(snap[i].cb);
      }
      scr_closure_release(snap[i].cb);
    }
    free(snap);
  }
  scr_child_stream_drop_listeners(s);
}

/* One read pump: while a consumer exists, PeekNamedPipe/ReadFile to
 * empty (one 'data' per ≤64KB chunk, the libuv pipe-read size) or EOF
 * (broken pipe: every writer closed). Returns true at EOF: the caller
 * finishes and unlinks. */
static bool scr_child_stream_pump(ScrChildStream *s) {
  while (scr_child_stream_watching(s)) {
    DWORD avail = 0;
    if (!PeekNamedPipe(s->h, NULL, 0, NULL, &avail, NULL)) return true;
    if (avail == 0) return false;
    if (avail > 65536) avail = 65536;
    char buf[65536];
    DWORD got = 0;
    if (!ReadFile(s->h, buf, avail, &got, NULL) || got == 0) return true;
    ScrBytes *chunk = scr_bytes_stamp_buffer(scr_bytes_new(SCR_BYTES_U8, (double)got));
    memcpy(chunk->data, buf, (size_t)got);
    size_t nd = s->n_data;
    ScrChildStreamDataL *snap = malloc(nd * sizeof *snap);
    if (!snap) scr_child_oom();
    for (size_t i = 0; i < nd; i++) {
      snap[i] = s->data_ls[i];
      scr_closure_retain(snap[i].cb);
    }
    for (size_t i = 0; i < nd; i++) {
      if (snap[i].once) {
        for (size_t j = 0; j < s->n_data; j++) {
          if (s->data_ls[j].cb == snap[i].cb) {
            scr_closure_release(s->data_ls[j].cb);
            memmove(s->data_ls + j, s->data_ls + j + 1,
                    (s->n_data - j - 1) * sizeof *s->data_ls);
            s->n_data--;
            break;
          }
        }
      }
      if (!scr_exc_pending()) snap[i].fn(snap[i].cb, chunk);
      scr_closure_release(snap[i].cb);
    }
    free(snap);
    scr_bytes_release(chunk);
    if (scr_exc_pending()) return false;
  }
  return false;
}

static void scr_child_streams_service(void) {
  ScrChildStream **link = &scr_child_streams;
  while (*link) {
    ScrChildStream *s = *link;
    bool ended = scr_child_stream_pump(s);
    if (ended) {
      *link = s->next;
      s->next = NULL;
      scr_child_stream_finish(s, true);
      scr_child_stream_release(s); /* the registry's reference */
    } else {
      link = &s->next;
    }
    if (scr_exc_pending()) return;
  }
}

/* The settle-path drain (Node's pinned ordering: stream 'end' before
 * 'exit'): pump one stream to EOF/empty right now; on EOF, finish and
 * unlink. Data still arriving with the child reaped means a grandchild
 * holds the write end — 'exit' proceeds and the stream keeps delivering
 * on later turns, exactly Node. */
static void scr_child_stream_drain_now(ScrChildStream *s) {
  if (s == NULL || !scr_child_stream_watching(s)) return;
  if (!scr_child_stream_pump(s)) return;
  ScrChildStream **link = &scr_child_streams;
  while (*link && *link != s) link = &(*link)->next;
  if (*link) {
    *link = s->next;
    s->next = NULL;
    scr_child_stream_finish(s, true);
    scr_child_stream_release(s);
  } else {
    scr_child_stream_finish(s, true); /* defensive: not registered */
  }
}

/* Node's resume(): the stream starts flowing (idempotent, sticky). */
static void scr_child_stream_start_flow(ScrChildStream *s) {
  if (s->flowing) return;
  s->flowing = true;
  scr_child_streams_watching++;
}

void scr_child_stream_on_data(ScrChildStream *s, ScrClosure *cb /*moves*/,
                              ScrChildStreamDataFn fn, bool once) {
  if (s->fx != NULL) {
    s->fx->on_data(s->fobj, cb, fn, once);
    return;
  }
  if (s->eof || s->h == NULL) {
    scr_closure_release(cb);
    return;
  }
  if (s->n_data == s->cap_data) {
    s->cap_data = s->cap_data ? s->cap_data * 2 : 2;
    s->data_ls = realloc(s->data_ls, s->cap_data * sizeof *s->data_ls);
    if (!s->data_ls) scr_child_oom();
  }
  s->data_ls[s->n_data].cb = cb;
  s->data_ls[s->n_data].fn = fn;
  s->data_ls[s->n_data].once = once;
  s->n_data++;
  scr_child_stream_start_flow(s);
}

void scr_child_stream_on_end(ScrChildStream *s, ScrClosure *cb /*moves*/, bool once) {
  if (s->fx != NULL) {
    s->fx->on_end(s->fobj, cb, once);
    return;
  }
  (void)once; /* 'end' fires at most once; the flag changes nothing */
  if (s->eof || s->h == NULL) {
    scr_closure_release(cb);
    return;
  }
  if (s->n_end == s->cap_end) {
    s->cap_end = s->cap_end ? s->cap_end * 2 : 2;
    s->end_ls = realloc(s->end_ls, s->cap_end * sizeof *s->end_ls);
    if (!s->end_ls) scr_child_oom();
  }
  s->end_ls[s->n_end].cb = cb;
  s->end_ls[s->n_end].once = once;
  s->n_end++;
}

/* Node's flushStdio (lib/internal/child_process.js, v24.15.0): after the
 * child's 'exit' listeners, every piped stdio stream that is not flowing is
 * resumed. The resumed stream discards what no listener takes and emits
 * 'end' at EOF on a later turn, so 'end' follows 'exit'. */
static void scr_child_stream_flush_after_exit(ScrChildStream *s) {
  if (s == NULL || s->eof) return;
#ifdef _WIN32
  if (s->h == NULL) return;
#else
  if (s->fd < 0) return;
#endif
  scr_child_stream_start_flow(s);
}

ScrChildStream *scr_child_stdout(ScrChild *c) {
  return c->out_stream ? scr_child_stream_retain(c->out_stream) : NULL;
}
ScrChildStream *scr_child_stderr(ScrChild *c) {
  return c->err_stream ? scr_child_stream_retain(c->err_stream) : NULL;
}

void scr_child_stream_thunk0(ScrClosure *cb, ScrBytes *chunk) {
  (void)chunk;
  ((void (*)(ScrClosure *))cb->fn)(cb);
}
void scr_child_stream_thunk_bytes(ScrClosure *cb, ScrBytes *chunk) {
  /* The listener owns its +1 param per the universal convention. */
  ((void (*)(ScrClosure *, ScrBytes *))cb->fn)(cb, scr_bytes_retain(chunk));
}

/* ── spawn ───────────────────────────────────────────────────────────── */

ScrChild *scr_spawn(ScrStr *cmd, ScrArr *args) {
  return scr_spawn_opts(cmd, args, 0, 0, 0, 0, 0, false, false, NULL, NULL);
}

/* PER-SLOT stdio modes (the POSIX arm's numbering): in 0 = ignore (NUL),
 * 1 = inherit; out/err 0 = ignore, 1 = inherit, 2 = fd, 3 = pipe. */
ScrChild *scr_spawn_opts(ScrStr *cmd, ScrArr *args, double in_mode,
                         double out_mode, double err_mode, double out_fd,
                         double err_fd, bool detached, bool has_env,
                         ScrArr *env_pairs, ScrStr *cwd) {
  if ((int)out_mode == 1 || (int)err_mode == 1 || (int)out_mode == 2 || (int)err_mode == 2) {
    fflush(stdout);
    fflush(stderr);
  }
  ScrChild *c = calloc(1, sizeof(ScrChild));
  if (!c) scr_child_oom();
  scr_child_alloc_note();
  scr_abandon_arm();
  c->rc = 1;

  /* Piped slots: the pipe NOW; a pipe failure degrades the slot to NUL
   * and the stream husk answers eof (fd exhaustion — nothing real). */
  HANDLE out_parent = NULL, out_child = NULL;
  HANDLE err_parent = NULL, err_child = NULL;
  int out_m = (int)out_mode, err_m = (int)err_mode;
  if (out_m == 3 && !scr_win_pipe(&out_parent, &out_child, true)) out_m = 0;
  if (err_m == 3 && !scr_win_pipe(&err_parent, &err_child, true)) err_m = 0;

  HANDLE in_child = (int)in_mode == 1
                        ? scr_win_dup_inherit(GetStdHandle(STD_INPUT_HANDLE))
                        : NULL;
  if (in_child == NULL) in_child = scr_win_nul(false);
  if (out_child == NULL) {
    if (out_m == 1) out_child = scr_win_dup_inherit(GetStdHandle(STD_OUTPUT_HANDLE));
    else if (out_m == 2) out_child = scr_win_dup_inherit((HANDLE)_get_osfhandle((int)out_fd));
    if (out_child == NULL) out_child = scr_win_nul(true);
  }
  if (err_child == NULL) {
    if (err_m == 1) err_child = scr_win_dup_inherit(GetStdHandle(STD_ERROR_HANDLE));
    else if (err_m == 2) err_child = scr_win_dup_inherit((HANDLE)_get_osfhandle((int)err_fd));
    if (err_child == NULL) err_child = scr_win_nul(true);
  }

  ScrWinSpawn sp = {
      .in_child = in_child,
      .out_child = out_child,
      .err_child = err_child,
      .cwd = cwd != NULL && cwd->len > 0 ? cwd : NULL,
      .env_pairs = has_env ? env_pairs : NULL,
      .detached = detached,
  };
  scr_win_create_process(cmd, args, &sp);
  if (in_child != NULL) CloseHandle(in_child);
  if (out_child != NULL) CloseHandle(out_child);
  if (err_child != NULL) CloseHandle(err_child);

  /* The parent's pipe read ends become the streams regardless of the
   * spawn's outcome — a FAILED spawn keeps them with no writer at all,
   * so a consumer sees immediate EOF and 'end' fires on the turn after
   * the 'error' event, Node's exact order (the POSIX arm's stance). */
  if (out_m == 3) c->out_stream = scr_child_stream_new(out_parent);
  if (err_m == 3) c->err_stream = scr_child_stream_new(err_parent);

  if (sp.errname != NULL) {
    size_t len = 6 + cmd->len + 1 + strlen(sp.errname);
    char *msg = malloc(len + 1);
    if (!msg) scr_child_oom();
    snprintf(msg, len + 1, "spawn %s %s", cmd->data, sp.errname);
    c->state = SCR_CHILD_SPAWN_FAILED;
    c->spawn_errname = sp.errname;
    c->spawn_uv_errno = scr_win_uv_errno(sp.errname);
    c->err_msg = scr_str_new(msg, len);
    free(msg);
    /* Settles at the next quiescent pass; no exit handle will ever wake
     * the loop for it, so it counts as unwatched until then. */
    scr_children_unwatched++;
  } else {
    c->state = SCR_CHILD_RUNNING;
    c->proc = sp.proc;
    c->pid = sp.pid;
  }
  /* The registry's reference: dropped when the child settles. The
   * registry is APPENDED to, not pushed onto: scr_children_poll walks
   * it head-first and settles every spawn FAILURE on its first pass,
   * so the list order IS the order those 'error' events fire. Node
   * queues them with process.nextTick, which is FIFO, so two failing
   * spawns report in spawn order there; they used to report in
   * REVERSE here. With no handler on the second one that is not a
   * cosmetic difference: the unhandled 'error' killed the program
   * before the first child's handler ever ran, so a line Node prints
   * never printed at all (tests/corpus/1466, tests/corpus/3872).
   * Real exits tie-break by this order too, and spawn order is the
   * only defensible tie-break -- which of two same-instant children
   * Node reaps first is genuinely unspecified, and the corpus already
   * sorts before printing wherever it depends on that. The walk is
   * O(unsettled children), a number this registry keeps in single
   * digits; a tail pointer would have to be kept correct by the
   * unlink in scr_children_poll as well. */
  c->reffed = true;
  scr_children_reffed_n++;
  c->next = NULL;
  ScrChild **tail = &scr_children;
  while (*tail != NULL) tail = &(*tail)->next;
  *tail = scr_child_retain(c);
  return c;
}

/* ── the lifecycle members ───────────────────────────────────────────── */

bool scr_child_has_pid(ScrChild *c) { return c->state != SCR_CHILD_SPAWN_FAILED; }
double scr_child_pid(ScrChild *c) { return (double)c->pid; }

bool scr_child_has_exit_code(ScrChild *c) {
  if (c->state == SCR_CHILD_EXITED) return c->has_code;
  return c->state == SCR_CHILD_SPAWN_FAILED && c->settled;
}
double scr_child_exit_code(ScrChild *c) {
  if (c->state == SCR_CHILD_SPAWN_FAILED) return (double)c->spawn_uv_errno;
  return c->code;
}

bool scr_child_killed(ScrChild *c) { return c->killed; }

/* child.kill core: libuv's uv_kill emulation. SIGTERM/SIGKILL/SIGINT/
 * SIGQUIT/SIGHUP → TerminateProcess(h, 1) with the signal name recorded
 * for the exit event (Node's code null + signal); 0 probes liveness;
 * anything else answers false (libuv: ENOSYS — no error event wired,
 * the POSIX arm's unreachable-error stance). Node sets `killed` on ANY
 * successful send, signal 0 included. */
static bool scr_child_kill_signo(ScrChild *c, int signo) {
  if (c->state != SCR_CHILD_RUNNING || c->proc == NULL) return false;
  if (signo == 0) {
    if (WaitForSingleObject(c->proc, 0) == WAIT_OBJECT_0) return false; /* exited: ESRCH */
    c->killed = true;
    return true;
  }
  if (signo != SIGTERM && signo != SIGKILL && signo != SIGINT &&
      signo != SIGQUIT && signo != SIGHUP) {
    return false;
  }
  if (!TerminateProcess(c->proc, 1)) return false; /* already exited: ESRCH */
  c->kill_signal = scr_signal_name(signo);
  c->killed = true;
  return true;
}

bool scr_child_kill(ScrChild *c, const ScrStr *signal) {
  int signo = scr_signal_from_name(signal);
  if (signo < 0) {
    size_t cap = 16 + signal->len + 1;
    char *msg = malloc(cap);
    if (!msg) scr_child_oom();
    int len = snprintf(msg, cap, "Unknown signal: %s", signal->data);
    scr_throw_error_msg(SCR_ERR_TYPE, msg, (size_t)len);
    free(msg);
    return false;
  }
  return scr_child_kill_signo(c, signo);
}

bool scr_child_kill_num(ScrChild *c, double signum) {
  return scr_child_kill_signo(c, (int)signum);
}

void scr_child_unref(ScrChild *c) {
  if (c->reffed) {
    c->reffed = false;
    scr_children_reffed_n--; /* settle/teardown clear reffed first */
  }
}

bool scr_children_reffed_pending(void) {
  return scr_children_reffed_n > 0 || scr_child_streams_watching > 0;
}

void scr_children_teardown(void) {
  while (scr_child_streams != NULL) {
    ScrChildStream *s = scr_child_streams;
    scr_child_streams = s->next;
    s->next = NULL;
    scr_child_stream_finish(s, false);
    scr_child_stream_release(s);
  }
  while (scr_children != NULL) {
    ScrChild *c = scr_children;
    scr_children = c->next;
    c->next = NULL;
    c->settled = true; /* late listener registrations release immediately */
    if (c->reffed) {
      c->reffed = false;
      scr_children_reffed_n--;
    }
    if (c->state == SCR_CHILD_SPAWN_FAILED) scr_children_unwatched--;
    scr_child_drop_listeners(c);
    scr_child_release(c);
  }
}

void scr_child_on_exit(ScrChild *c, ScrClosure *cb /*moves*/, ScrChildExitFn fn) {
  if (c->settled) {
    scr_closure_release(cb); /* after the terminal event: never fires */
    return;
  }
  if (c->n_exit == c->cap_exit) {
    c->cap_exit = c->cap_exit ? c->cap_exit * 2 : 2;
    c->exit_cbs = realloc(c->exit_cbs, c->cap_exit * sizeof(*c->exit_cbs));
    if (!c->exit_cbs) scr_child_oom();
  }
  c->exit_cbs[c->n_exit].cb = cb;
  c->exit_cbs[c->n_exit].fn = fn;
  c->n_exit++;
}

void scr_child_on_error(ScrChild *c, ScrClosure *cb /*moves*/, ScrChildErrFn fn) {
  if (c->settled) {
    scr_closure_release(cb);
    return;
  }
  if (c->n_err == c->cap_err) {
    c->cap_err = c->cap_err ? c->cap_err * 2 : 2;
    c->err_cbs = realloc(c->err_cbs, c->cap_err * sizeof(*c->err_cbs));
    if (!c->err_cbs) scr_child_oom();
  }
  c->err_cbs[c->n_err].cb = cb;
  c->err_cbs[c->n_err].fn = fn;
  c->n_err++;
}

/* ── the runtime-provided listener adapters (the POSIX arm's) ────────── */

void scr_child_exit_thunk0(ScrClosure *cb, bool has_code, double code,
                           const char *signal_name) {
  (void)has_code;
  (void)code;
  (void)signal_name;
  ((void (*)(ScrClosure *))cb->fn)(cb);
}

void scr_child_err_thunk0(ScrClosure *cb, ScrStr *msg) {
  (void)msg;
  ((void (*)(ScrClosure *))cb->fn)(cb);
}

static const char *scr_child_err_code = NULL;

/* The errno name embedded in an errnoException-style message — the
 * POSIX arm's parser, shared story (see its comment). */
static const char *scr_err_msg_code(const ScrStr *msg) {
  static char buf[32];
  const char *sp = strchr((const char *)msg->data, ' ');
  if (sp == NULL || sp[1] != 'E') return NULL;
  const char *tok = sp + 1;
  size_t n = 1;
  while (tok[n] != '\0' && tok[n] != ' ' && tok[n] != ':') {
    char ch = tok[n];
    if (!((ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9'))) return NULL;
    if (n + 1 >= sizeof buf) return NULL;
    n++;
  }
  if (n < 3) return NULL; /* "EIO" is the shortest real name */
  memcpy(buf, tok, n);
  buf[n] = '\0';
  return buf;
}

void scr_child_err_thunk_error(ScrClosure *cb, ScrStr *msg) {
  ScrError *e = scr_error_new(0 /* Error */, msg);
  if (scr_child_err_code != NULL) {
    scr_error_set_code(e, scr_child_err_code);
  } else {
    const char *code = scr_err_msg_code(msg);
    if (code != NULL) scr_error_set_code(e, code);
  }
  ((void (*)(ScrClosure *, ScrError *))cb->fn)(cb, e);
}

/* ── the loop's half (called from scr_async.c) ───────────────────────── */

bool scr_children_pending(void) {
  return scr_children != NULL || scr_child_streams_watching > 0;
}

bool scr_children_failed_pending(void) {
  for (ScrChild *c = scr_children; c; c = c->next) {
    if (c->state == SCR_CHILD_SPAWN_FAILED && !c->settled) return true;
  }
  return false;
}

/* No pollable wake fd on Windows (the loop's poll(2) branch is POSIX-
 * only); scr_children_wait below is the wakeup story. */
int scr_children_wake_fd(void) { return -1; }

/* The loop's quiescent sleep while children are pending: wait on the
 * child process HANDLES up to max_wait_ms — an exit ends the sleep
 * immediately and the next reap pass settles it. Declines (false: the
 * caller keeps the ~1ms polling cap) when a pending child has no
 * waitable handle (a spawn failure awaiting settle), a consumer-owning
 * stream needs pumping (pipe readability is poll-only), or the handle
 * table outgrows WaitForMultipleObjects. */
bool scr_children_wait(double max_wait_ms) {
  if (scr_children_unwatched > 0 || scr_child_streams_watching > 0) return false;
  HANDLE hs[MAXIMUM_WAIT_OBJECTS];
  DWORD n = 0;
  for (ScrChild *c = scr_children; c; c = c->next) {
    if (c->state != SCR_CHILD_RUNNING || c->proc == NULL) continue;
    if (n == MAXIMUM_WAIT_OBJECTS) return false;
    hs[n++] = c->proc;
  }
  if (n == 0) return false;
  if (!(max_wait_ms > 0)) max_wait_ms = 0;
  if (max_wait_ms > 2147483000.0) max_wait_ms = 2147483000.0;
  (void)WaitForMultipleObjects(n, hs, FALSE, (DWORD)(max_wait_ms + 0.999));
  return true;
}

/* Fires one settled child's terminal event — the POSIX arm's settle,
 * verbatim (streams drain first so 'end' precedes 'exit'; spawn
 * failures fire 'error' or die unhandled). */
static void scr_child_settle(ScrChild *c) {
  if (c->reffed) {
    c->reffed = false;
    scr_children_reffed_n--;
  }
  if (c->state == SCR_CHILD_EXITED) {
    scr_child_stream_drain_now(c->out_stream);
    if (!scr_exc_pending()) scr_child_stream_drain_now(c->err_stream);
  }
  c->settled = true;
  if (scr_exc_pending()) {
    scr_child_drop_listeners(c);
    scr_child_release(c);
    return;
  }
  if (c->state == SCR_CHILD_SPAWN_FAILED) {
    if (c->n_err == 0) {
      fflush(stdout);
      fprintf(stderr, "Unhandled 'error' event: Error: %s\n", c->err_msg->data);
      _Exit(1);
    }
    scr_child_err_code = c->spawn_errname;
    for (size_t i = 0; i < c->n_err; i++) {
      c->err_cbs[i].fn(c->err_cbs[i].cb, c->err_msg);
      if (scr_exc_pending()) break; /* the loop surfaces it */
    }
    scr_child_err_code = NULL;
  } else {
    for (size_t i = 0; i < c->n_exit; i++) {
      c->exit_cbs[i].fn(c->exit_cbs[i].cb, c->has_code, c->code, c->exit_signal);
      if (scr_exc_pending()) break;
    }
  }
  if (c->state == SCR_CHILD_EXITED && !scr_exc_pending()) {
    scr_child_stream_flush_after_exit(c->out_stream);
    scr_child_stream_flush_after_exit(c->err_stream);
  }
  scr_child_drop_listeners(c);
  scr_child_release(c); /* the registry's reference */
}

/* One reap pass: streams service first (the pinned 'end'-before-'exit'
 * ordering), then every running child answers WaitForSingleObject(h, 0)
 * — the WNOHANG analogue; spawn failures settle on their first pass. */
void scr_children_poll(void) {
  scr_child_streams_service();
  if (scr_exc_pending()) return;
  ScrChild **link = &scr_children;
  while (*link) {
    ScrChild *c = *link;
    bool settle = false;
    if (c->state == SCR_CHILD_SPAWN_FAILED) {
      scr_children_unwatched--;
      settle = true;
    } else {
      DWORD w = WaitForSingleObject(c->proc, 0);
      if (w == WAIT_OBJECT_0) {
        DWORD code = 0;
        (void)GetExitCodeProcess(c->proc, &code);
        CloseHandle(c->proc);
        c->proc = NULL;
        c->state = SCR_CHILD_EXITED;
        if (c->kill_signal != NULL) {
          /* We terminated it: Node's code null + the signal's name
           * (libuv's term_signal reporting). */
          c->has_code = false;
          c->code = 0;
          c->exit_signal = c->kill_signal;
        } else {
          c->has_code = true;
          c->code = (double)code;
        }
        settle = true;
      } else if (w == WAIT_FAILED) {
        /* An unwaitable handle: settle as a signal-style exit so the
         * loop can never spin forever (the POSIX ECHILD stance). */
        CloseHandle(c->proc);
        c->proc = NULL;
        c->state = SCR_CHILD_EXITED;
        c->has_code = false;
        c->code = 0;
        settle = true;
      }
    }
    if (settle) {
      *link = c->next; /* unlink BEFORE firing: callbacks may spawn */
      c->next = NULL;
      scr_child_settle(c);
      if (scr_exc_pending()) return;
      /* one macrotask boundary per settled child: ticks, then jobs */
      scr_loop_drain_callback();
      if (scr_loop_stopping()) return;
    } else {
      link = &c->next;
    }
  }
}

#else /* !_WIN32 — the POSIX implementation, untouched below */
#include <signal.h>
#include <spawn.h>
#include <string.h>

/* Node ignores SIGPIPE in the process (so a write to a closed peer is EPIPE);
 * a child keeps the default disposition, which exec would otherwise inherit as
 * ignored. Fills an attribute set that restores SIGPIPE to SIG_DFL in the child. */
static void scr_child_sigdefault_attr(posix_spawnattr_t *at, short extra_flags) {
  posix_spawnattr_init(at);
  sigset_t def;
  sigemptyset(&def);
#ifdef SIGPIPE
  sigaddset(&def, SIGPIPE);
#endif
  posix_spawnattr_setsigdefault(at, &def);
  posix_spawnattr_setflags(at, (short)(POSIX_SPAWN_SETSIGDEF | extra_flags));
}


#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

/* Child-exit wakeups without polling — the narrow seam scr_platform.h
 * points here for (this unit links into EVERY binary, so its plumbing
 * stays inline rather than pulling both poller backends onto every link
 * line). BSD: kqueue's PROC filter — the loop's quiescent sleep waits on
 * the kqueue fd and a NOTE_EXIT wakes it the moment a child dies; piped
 * stream read-ends ride the same kqueue as level-triggered read filters.
 * Linux: pidfd_open per spawned child registered EPOLLIN in a dedicated
 * epoll (a pidfd polls readable from exit until the reap CLOSES it —
 * scr_children_poll unwatches right after waitpid succeeds); stream
 * read-ends ride the same epoll, level-triggered like the kqueue arm.
 * Both arms deliver WAKEUPS ONLY (events drained and discarded; the
 * WNOHANG sweep stays the single reaping mechanism), and both fall back
 * to the portable ~1ms polling cap whenever any pending child cannot be
 * represented (spawn failures awaiting settle, a failed watch
 * registration — kqueue refuses zombies, pidfd_open can hit ENOSYS/
 * EMFILE). Everywhere else the polling path compiles alone. */
#if defined(__APPLE__) || defined(__FreeBSD__) || defined(__NetBSD__) || \
    defined(__OpenBSD__) || defined(__DragonFly__)
#define SCR_HAVE_KQUEUE 1
#include <sys/event.h>
#elif defined(__linux__)
#define SCR_CHILD_HAVE_PIDFD 1
#include <sys/epoll.h>
#if defined(__GLIBC__) && (__GLIBC__ > 2 || (__GLIBC__ == 2 && __GLIBC_MINOR__ >= 36))
#include <sys/pidfd.h> /* pidfd_open has a libc wrapper from glibc 2.36 */
#else
#include <sys/syscall.h>
static int pidfd_open(pid_t pid, unsigned int flags) {
  return (int)syscall(SYS_pidfd_open, pid, flags);
}
#endif
#endif

extern char **environ;

static void scr_child_oom(void) {
  fputs("scriptc: out of memory\n", stderr);
  abort();
}

static const char *scr_errname(int err); /* defined with the spawn slice */

/* ── the spawnSync result value ──────────────────────────────────────── */

struct ScrSpawnRes {
  size_t rc;
  bool has_status;  /* false: signal death or spawn failure (status null) */
  double status;
  ScrStr *out; /* captured stdout, utf8 */
  ScrStr *err; /* captured stderr, utf8 */
  /* Node's `output` array exists only when the child was really started:
   * on a SPAWN FAILURE v25 leaves it null and derives the streams with
   * `result.output?.[1]`, so `stdout` and `stderr` are UNDEFINED there —
   * not "" and not the empty capture. The strings above stay "" so every
   * existing reader keeps a valid ScrStr; this flag is what the
   * undefined-armed read consults. */
  bool has_out;
  /* Spawn failure (Node's `error` property): the errno name for the
   * message ("spawnSync <file> ENOENT") and `code` stamp — a timeout kill
   * rides the same slot as ETIMEDOUT. NULL = no error — the property
   * reads undefined, exactly Node. */
  const char *spawn_errname;
  ScrStr *cmd; /* +1, for the error message; NULL when spawn_errname is */
  /* The termination signal's name (static storage; "SIGTERM", ...) when a
   * signal killed the child — a timeout's killSignal included — NULL for
   * a normal exit or spawn failure. Node's result.signal. */
  const char *signal_name;
};

ScrSpawnRes *scr_spawn_res_retain(ScrSpawnRes *r) {
  if (r->rc != SIZE_MAX) r->rc++;
  return r;
}

void scr_spawn_res_release(ScrSpawnRes *r) {
  if (!r || r->rc == SIZE_MAX) return;
  if (--r->rc == 0) {
    scr_str_release(r->out);
    scr_str_release(r->err);
    scr_str_release(r->cmd); /* NULL-safe */
    free(r);
  }
}

void *scr_spawn_res_retain_v(void *p) { return scr_spawn_res_retain((ScrSpawnRes *)p); }
void scr_spawn_res_release_v(void *p) { scr_spawn_res_release((ScrSpawnRes *)p); }

bool scr_spawn_res_has_status(ScrSpawnRes *r) { return r->has_status; }
double scr_spawn_res_status(ScrSpawnRes *r) { return r->status; }
ScrStr *scr_spawn_res_stdout(ScrSpawnRes *r) { return scr_str_retain(r->out); }
ScrStr *scr_spawn_res_stderr(ScrSpawnRes *r) { return scr_str_retain(r->err); }
/* Node's `output !== null`: false ONLY when the spawn itself failed, and
 * then `result.stdout` / `result.stderr` are undefined. */
bool scr_spawn_res_has_output(ScrSpawnRes *r) { return r->has_out; }
bool scr_spawn_res_has_signal(ScrSpawnRes *r) { return r->signal_name != NULL; }
ScrStr *scr_spawn_res_signal(ScrSpawnRes *r) {
  return scr_str_new(r->signal_name, strlen(r->signal_name));
}

/* The `error` property: a fresh +1 %Error ("spawnSync <file> ENOENT",
 * `code` stamped — Node's uv errnoException) when the spawn itself
 * failed, NULL (the undefined arm, wrapped type-directedly by the
 * emitter) otherwise. Constructed per read; Node reuses one object, but
 * the difference is only `===` identity between two reads of `.error`,
 * which nothing narrows on. */
ScrError *scr_spawn_res_error(ScrSpawnRes *r) {
  if (r->spawn_errname == NULL) return NULL;
  size_t cap = 10 + (r->cmd ? r->cmd->len : 0) + 1 + strlen(r->spawn_errname) + 1;
  char *msg = malloc(cap);
  if (!msg) scr_child_oom();
  snprintf(msg, cap, "spawnSync %s %s", r->cmd ? r->cmd->data : "", r->spawn_errname);
  ScrStr *m = scr_str_new(msg, strlen(msg));
  free(msg);
  ScrError *e = scr_error_new(0 /* Error */, m);
  scr_str_release(m);
  scr_error_set_code(e, r->spawn_errname);
  return e;
}

/* ── argv construction (shared with spawn in scr_async.c's slice) ─────── */

/* Builds a NULL-terminated argv from the command + one string[] — the
 * strings are BORROWED from their containers (alive for the whole spawn;
 * the +1 from scr_arr_get_ref is dropped immediately because the array
 * keeps its own reference). Free with free() (the vector only). */
char **scr_child_argv(ScrStr *cmd, ScrArr *args) {
  size_t n = (size_t)scr_arr_len(args);
  char **argv = malloc((n + 2) * sizeof(char *));
  if (!argv) scr_child_oom();
  argv[0] = cmd->data;
  for (size_t i = 0; i < n; i++) {
    ScrStr *s = (ScrStr *)scr_arr_get_ref(args, (double)i);
    argv[i + 1] = s->data;
    scr_str_release(s); /* borrow: the array's reference keeps it alive */
  }
  argv[n + 1] = NULL;
  return argv;
}

/* ── capture buffers ─────────────────────────────────────────────────── */

typedef struct {
  char *data;
  size_t len, cap;
} ScrCapBuf;

static void scr_cap_init(ScrCapBuf *b) {
  b->cap = 4096;
  b->len = 0;
  b->data = malloc(b->cap);
  if (!b->data) scr_child_oom();
}

/* Reads once from fd into the buffer; returns false on EOF (or error —
 * a broken pipe reads as end of capture, like libuv treats it). */
static bool scr_cap_read(ScrCapBuf *b, int fd) {
  if (b->len + 4096 > b->cap) {
    b->cap *= 2;
    b->data = realloc(b->data, b->cap);
    if (!b->data) scr_child_oom();
  }
  ssize_t got = read(fd, b->data + b->len, b->cap - b->len);
  if (got <= 0) return false;
  b->len += (size_t)got;
  return true;
}

/* ── spawnSync ───────────────────────────────────────────────────────── */

static ScrSpawnRes *scr_spawn_res_new(bool has_status, double status,
                                       ScrStr *out /*moved*/, ScrStr *err /*moved*/) {
  ScrSpawnRes *r = malloc(sizeof(ScrSpawnRes));
  if (!r) scr_child_oom();
  r->rc = 1;
  r->has_status = has_status;
  r->status = status;
  r->out = out;
  r->err = err;
  r->has_out = true;
  r->spawn_errname = NULL;
  r->cmd = NULL;
  r->signal_name = NULL;
  return r;
}

/* The parameterized spawnSync core. stdio modes: stdin 0 = /dev/null
 * (Node's no-input default AND "ignore"/"pipe"-without-input — all read
 * nothing), 2 = inherit; stdout/stderr 0 = capture (the pipe), 1 =
 * ignore (/dev/null; the result string reads ""), 2 = inherit (""
 * likewise — Node types those null; the "" stance is spawnSync's
 * documented divergence). timeout_ms > 0 sends `killsig` at the deadline
 * and the result carries error: ETIMEDOUT + the signal — never a throw,
 * Node's spawnSync shape. */
static ScrSpawnRes *scr_spawn_sync_core(ScrStr *cmd, ScrArr *args, double timeout_ms,
                                         int killsig, int in_mode, int out_mode,
                                         int err_mode) {
  if (out_mode == 2 || err_mode == 2) {
    /* Inherited output fds: flush the parent's buffers first so earlier
     * logs precede the child's writes (Node's practical ordering). */
    fflush(stdout);
    fflush(stderr);
  }
  int outfd[2] = {-1, -1}, errfd[2] = {-1, -1};
  bool cap_out = out_mode == 0, cap_err = err_mode == 0;
  if ((cap_out && pipe(outfd) != 0) || (cap_err && pipe(errfd) != 0)) {
    fputs("scriptc: pipe() failed\n", stderr);
    abort();
  }

  posix_spawn_file_actions_t fa;
  posix_spawn_file_actions_init(&fa);
  if (in_mode != 2) {
    posix_spawn_file_actions_addopen(&fa, 0, "/dev/null", O_RDONLY, 0);
  }
  if (cap_out) {
    posix_spawn_file_actions_adddup2(&fa, outfd[1], 1);
    posix_spawn_file_actions_addclose(&fa, outfd[0]);
    posix_spawn_file_actions_addclose(&fa, outfd[1]);
  } else if (out_mode == 1) {
    posix_spawn_file_actions_addopen(&fa, 1, "/dev/null", O_WRONLY, 0);
  }
  if (cap_err) {
    posix_spawn_file_actions_adddup2(&fa, errfd[1], 2);
    posix_spawn_file_actions_addclose(&fa, errfd[0]);
    posix_spawn_file_actions_addclose(&fa, errfd[1]);
  } else if (err_mode == 1) {
    posix_spawn_file_actions_addopen(&fa, 2, "/dev/null", O_WRONLY, 0);
  }

  char **argv = scr_child_argv(cmd, args);
  pid_t pid = -1;
  posix_spawnattr_t sat;
  scr_child_sigdefault_attr(&sat, 0);
  int spawn_err = posix_spawnp(&pid, cmd->data, &fa, &sat, argv, environ);
  posix_spawnattr_destroy(&sat);
  posix_spawn_file_actions_destroy(&fa);
  free(argv);
  if (cap_out) close(outfd[1]);
  if (cap_err) close(errfd[1]);

  if (spawn_err != 0) {
    /* Node: status null, error ENOENT/EACCES/... — never a throw. The
     * errno rides the result for the `error` property read. */
    if (cap_out) close(outfd[0]);
    if (cap_err) close(errfd[0]);
    ScrSpawnRes *r = scr_spawn_res_new(false, 0, scr_str_new("", 0), scr_str_new("", 0));
    r->has_out = false; /* Node: no `output` array at all — the streams read undefined */
    r->spawn_errname = scr_errname(spawn_err);
    r->cmd = scr_str_retain(cmd);
    return r;
  }

  /* Drain BOTH pipes together (a child filling one while we block on the
   * other would deadlock a sequential read); the poll deadline implements
   * the timeout, exactly the exec core's discipline. */
  ScrCapBuf out, err;
  scr_cap_init(&out);
  scr_cap_init(&err);
  bool out_open = cap_out, err_open = cap_err;
  bool timed_out = false;
  double deadline = timeout_ms > 0 ? scr_now_ms() + timeout_ms : 0;
  while (out_open || err_open) {
    struct pollfd fds[2];
    nfds_t n = 0;
    if (out_open) { fds[n].fd = outfd[0]; fds[n].events = POLLIN; n++; }
    if (err_open) { fds[n].fd = errfd[0]; fds[n].events = POLLIN; n++; }
    int wait = -1;
    if (deadline > 0 && !timed_out) {
      double left = deadline - scr_now_ms();
      wait = left > 0 ? (int)(left + 0.999) : 0;
    }
    int rc = poll(fds, n, wait);
    if (rc < 0) {
      if (errno == EINTR) continue;
      break;
    }
    if (deadline > 0 && !timed_out && scr_now_ms() >= deadline) {
      timed_out = true;
      kill(pid, killsig);
    }
    if (rc == 0) continue;
    for (nfds_t i = 0; i < n; i++) {
      if (!(fds[i].revents & (POLLIN | POLLHUP | POLLERR))) continue;
      if (out_open && fds[i].fd == outfd[0]) out_open = scr_cap_read(&out, outfd[0]);
      else if (err_open && fds[i].fd == errfd[0]) err_open = scr_cap_read(&err, errfd[0]);
    }
  }
  if (cap_out) close(outfd[0]);
  if (cap_err) close(errfd[0]);

  /* Reap. With nothing captured the deadline lives here: WNOHANG-poll
   * until the child exits or the timeout kill fires (the exec core's
   * pipes-drained-daemon discipline). */
  int st = 0;
  pid_t reaped = -1;
  if (deadline > 0 && !timed_out) {
    for (;;) {
      reaped = waitpid(pid, &st, WNOHANG);
      if (reaped == pid || (reaped < 0 && errno != EINTR)) break;
      if (scr_now_ms() >= deadline) {
        timed_out = true;
        kill(pid, killsig);
        break;
      }
      struct timespec ts = {0, 500000}; /* 0.5ms */
      nanosleep(&ts, NULL);
    }
  }
  if (reaped != pid) {
    do {
      reaped = waitpid(pid, &st, 0);
    } while (reaped < 0 && errno == EINTR);
  }

  ScrStr *out_s = scr_str_new(out.data, out.len);
  ScrStr *err_s = scr_str_new(err.data, err.len);
  free(out.data);
  free(err.data);
  ScrSpawnRes *r;
  if (WIFEXITED(st) && !timed_out) {
    r = scr_spawn_res_new(true, (double)WEXITSTATUS(st), out_s, err_s);
  } else {
    /* Killed by a signal (the timeout's included): Node's status null,
     * signal = the terminating signal's name. */
    r = scr_spawn_res_new(false, 0, out_s, err_s);
    if (WIFSIGNALED(st)) r->signal_name = scr_signal_name(WTERMSIG(st));
    if (timed_out) {
      /* Node: error ETIMEDOUT + signal = killSignal (the kill may have
       * raced a normal exit; Node reports the timeout either way). */
      if (r->signal_name == NULL) r->signal_name = scr_signal_name(killsig);
      r->spawn_errname = "ETIMEDOUT";
      r->cmd = scr_str_retain(cmd);
    }
  }
  return r;
}

ScrSpawnRes *scr_spawn_sync(ScrStr *cmd, ScrArr *args) {
  return scr_spawn_sync_core(cmd, args, 0, SIGTERM, 0, 0, 0);
}

/* The options entry (cp.spawnSyncOpts): killSignal as a NAME ("" = the
 * SIGTERM default — the compiler already validated the literal against
 * Node's table by fencing non-literals; an unknown name here falls back
 * to SIGTERM defensively), modes as doubles (the IR's scalar). */
ScrSpawnRes *scr_spawn_sync_opts(ScrStr *cmd, ScrArr *args, double timeout_ms,
                                  ScrStr *killsignal, double in_mode,
                                  double out_mode, double err_mode) {
  int killsig = SIGTERM;
  if (killsignal->len > 0) {
    int resolved = scr_signal_from_name(killsignal);
    if (resolved > 0) killsig = resolved;
  }
  return scr_spawn_sync_core(cmd, args, timeout_ms, killsig, (int)in_mode,
                              (int)out_mode, (int)err_mode);
}

/* The runtime-string stdio entry (cp.spawnSyncStdioStr): the compiler
 * proved the value's TYPE is a union of "pipe"/"ignore"/"inherit"
 * literals (the defaultRunner idiom `stdio: options?.stdio ?? "pipe"`),
 * so mapping to the three modes happens here at the call. */
ScrSpawnRes *scr_spawn_sync_stdio_str(ScrStr *cmd, ScrArr *args, double timeout_ms,
                                       ScrStr *killsignal, ScrStr *stdio) {
  double in_mode = 0, out_mode = 0, err_mode = 0; /* "pipe": the defaults */
  if (stdio->len == 7 && memcmp(stdio->data, "inherit", 7) == 0) {
    in_mode = 2; out_mode = 2; err_mode = 2;
  } else if (stdio->len == 6 && memcmp(stdio->data, "ignore", 6) == 0) {
    out_mode = 1; err_mode = 1;
  }
  return scr_spawn_sync_opts(cmd, args, timeout_ms, killsignal, in_mode, out_mode, err_mode);
}

/* ── execFileSync / execSync ──────────────────────────────────────────
 * One parameterized core (scr_exec_sync) behind both: posix_spawn(p) +
 * piped utf8 capture + waitpid, with the option slice portless-class CLIs
 * actually pass — cwd, env replacement, stdin input, per-fd stdio modes,
 * and a SIGTERM timeout. Node semantics, matched exactly:
 * - Non-zero exit (or signal death) THROWS an Error whose message is
 *   Node's checkExecSyncError text: "Command failed: <cmd>" with the
 *   captured stderr appended on its own line when there is any.
 * - Spawn failure throws "spawnSync <file> ENOENT" (Node routes the
 *   uv_spawn error through the same thrower).
 * - Timeout kills with SIGTERM and throws "spawnSync <file> ETIMEDOUT".
 * - Default stdio ECHOES the captured stderr to the parent's stderr after
 *   the child completes (Node's inheritStderr flag — the capture is
 *   unconditional); an explicit stdio option turns that off, and an
 *   "ignore" stderr slot discards it entirely (nothing in the message).
 * - The thrown error carries the MESSAGE only: Node's status/stdout/
 *   stderr properties don't exist here (SEMANTICS.md — nothing the
 *   supported catch forms can read anyway).
 * The result is the captured utf8 stdout (+1). */

typedef struct {
  bool shell;          /* argv = /bin/sh -c <cmd> */
  const ScrStr *input; /* NULL/absent: stdin from /dev/null */
  const ScrStr *cwd;   /* NULL: inherit */
  ScrArr *env_pairs;   /* NULL: inherit; else [k,v,...] REPLACES environ */
  double timeout_ms;   /* <= 0: none */
  int stdout_mode;     /* 1 capture (default), 0 ignore, 2 inherit */
  int stderr_mode;     /* 0 capture+echo (default), 1 capture, 2 ignore, 3 inherit */
  bool stdin_inherit;  /* stdio "inherit": the child keeps the parent's fd 0 */
  /* The promisified-execFile shape (Node's async execFile, pinned by
   * oracle): failure messages read "Command failed: <cmd>\n<stderr>" with
   * the newline UNCONDITIONAL (the sync form appends only when stderr is
   * non-empty), spawn failure reads "spawn <file> <ERR>" (not spawnSync)
   * with `code` stamped, and a timeout is NOT ETIMEDOUT — the SIGTERM
   * lands and the death reports as an ordinary command failure, exactly
   * Node's promisified behavior. */
  bool async_shape;
  /* async_shape success: the captured stderr string (+1) lands here. */
  ScrStr **stderr_out;
} ScrExecOpts;

/* Node's message-command: the shell form shows the command string, the
 * file form joins file + args with spaces. */
static char *scr_exec_display(ScrStr *cmd, ScrArr *args, bool shell) {
  if (shell) {
    ScrStr *c = (ScrStr *)scr_arr_get_ref(args, 1); /* ["-c", cmd] */
    char *out = malloc(c->len + 1);
    if (!out) scr_child_oom();
    memcpy(out, c->data, c->len + 1);
    scr_str_release(c);
    return out;
  }
  size_t n = (size_t)scr_arr_len(args);
  size_t total = cmd->len;
  for (size_t i = 0; i < n; i++) {
    ScrStr *s = (ScrStr *)scr_arr_get_ref(args, (double)i);
    total += 1 + s->len;
    scr_str_release(s);
  }
  char *out = malloc(total + 1);
  if (!out) scr_child_oom();
  memcpy(out, cmd->data, cmd->len);
  size_t at = cmd->len;
  for (size_t i = 0; i < n; i++) {
    ScrStr *s = (ScrStr *)scr_arr_get_ref(args, (double)i);
    out[at++] = ' ';
    memcpy(out + at, s->data, s->len);
    at += s->len;
    scr_str_release(s);
  }
  out[at] = '\0';
  return out;
}

/* Builds a NULL-terminated envp from [k,v,...] pairs ("k=v" strings, each
 * malloc'd). Free with scr_exec_envp_free. */
static char **scr_exec_envp(ScrArr *pairs) {
  size_t n = (size_t)scr_arr_len(pairs) / 2;
  char **envp = malloc((n + 1) * sizeof(char *));
  if (!envp) scr_child_oom();
  for (size_t i = 0; i < n; i++) {
    ScrStr *k = (ScrStr *)scr_arr_get_ref(pairs, (double)(2 * i));
    ScrStr *v = (ScrStr *)scr_arr_get_ref(pairs, (double)(2 * i + 1));
    char *kv = malloc(k->len + 1 + v->len + 1);
    if (!kv) scr_child_oom();
    memcpy(kv, k->data, k->len);
    kv[k->len] = '=';
    memcpy(kv + k->len + 1, v->data, v->len + 1);
    envp[i] = kv;
    scr_str_release(k);
    scr_str_release(v);
  }
  envp[n] = NULL;
  return envp;
}

static void scr_exec_envp_free(char **envp) {
  if (!envp) return;
  for (size_t i = 0; envp[i]; i++) free(envp[i]);
  free(envp);
}

/* The Command-failed thrower (message only — see the block comment).
 * always_nl is the async shape: Node's promisified execFile appends
 * "\n<stderr>" unconditionally (a trailing newline on empty stderr),
 * where the sync form appends only when stderr is non-empty. */
static void scr_exec_throw_failed(const char *display, const ScrCapBuf *err_cap,
                                   bool with_stderr, bool always_nl) {
  size_t dlen = strlen(display);
  size_t elen = with_stderr ? err_cap->len : 0;
  size_t cap = 16 + dlen + 1 + elen + 1;
  char *msg = malloc(cap);
  if (!msg) scr_child_oom();
  size_t at = (size_t)snprintf(msg, cap, "Command failed: %s", display);
  if (elen > 0 || always_nl) {
    msg[at++] = '\n';
    memcpy(msg + at, err_cap->data, elen);
    at += elen;
  }
  scr_throw_error_msg(SCR_ERR_ERROR, msg, at);
  free(msg);
}

/* "spawnSync <file> <ERRNAME>" — Node's uv-error message for spawn
 * failures and timeouts, with `code` = the errno name (Node's
 * errnoException shape; the Command-failed error stays code-less — Node
 * puts the exit STATUS there, in properties this surface doesn't carry). */
static void scr_exec_throw_spawn(ScrStr *cmd, const char *errname, bool async_shape) {
  size_t cap = 10 + cmd->len + 1 + strlen(errname) + 1;
  char *msg = malloc(cap);
  if (!msg) scr_child_oom();
  int len = snprintf(msg, cap, "%s %s %s", async_shape ? "spawn" : "spawnSync",
                     cmd->data, errname);
  scr_throw_error_msg_code(SCR_ERR_ERROR, msg, (size_t)len, errname);
  free(msg);
}

ScrStr *scr_exec_sync_core(ScrStr *cmd, ScrArr *args, const ScrExecOpts *o) {
  int outfd[2] = {-1, -1}, errfd[2] = {-1, -1}, infd[2] = {-1, -1};
  bool cap_out = o->stdout_mode == 1;
  bool cap_err = o->stderr_mode == 0 || o->stderr_mode == 1;
  if (o->stdout_mode == 2 || o->stderr_mode == 3) {
    /* Inherited output fds: flush the parent's buffers first so earlier
     * logs precede the child's writes (Node's practical ordering). */
    fflush(stdout);
    fflush(stderr);
  }
  bool has_input = o->input != NULL;
  if ((cap_out && pipe(outfd) != 0) || (cap_err && pipe(errfd) != 0) ||
      (has_input && pipe(infd) != 0)) {
    fputs("scriptc: pipe() failed\n", stderr);
    abort();
  }

  posix_spawn_file_actions_t fa;
  posix_spawn_file_actions_init(&fa);
  if (has_input) {
    posix_spawn_file_actions_adddup2(&fa, infd[0], 0);
    posix_spawn_file_actions_addclose(&fa, infd[0]);
    posix_spawn_file_actions_addclose(&fa, infd[1]);
  } else if (!o->stdin_inherit) {
    posix_spawn_file_actions_addopen(&fa, 0, "/dev/null", O_RDONLY, 0);
  } /* inherit: no action — the child keeps the parent's fd 0 */
  if (cap_out) {
    posix_spawn_file_actions_adddup2(&fa, outfd[1], 1);
    posix_spawn_file_actions_addclose(&fa, outfd[0]);
    posix_spawn_file_actions_addclose(&fa, outfd[1]);
  } else if (o->stdout_mode != 2) {
    posix_spawn_file_actions_addopen(&fa, 1, "/dev/null", O_WRONLY, 0);
  } /* mode 2 (inherit): the child keeps the parent's fd 1 */
  if (cap_err) {
    posix_spawn_file_actions_adddup2(&fa, errfd[1], 2);
    posix_spawn_file_actions_addclose(&fa, errfd[0]);
    posix_spawn_file_actions_addclose(&fa, errfd[1]);
  } else if (o->stderr_mode != 3) {
    posix_spawn_file_actions_addopen(&fa, 2, "/dev/null", O_WRONLY, 0);
  } /* mode 3 (inherit): the child keeps the parent's fd 2 */
#if defined(__APPLE__) || defined(__GLIBC__)
  if (o->cwd != NULL) {
    posix_spawn_file_actions_addchdir_np(&fa, o->cwd->data);
  }
#endif

  char **argv = scr_child_argv(cmd, args);
  char **envp = o->env_pairs != NULL ? scr_exec_envp(o->env_pairs) : NULL;
  pid_t pid = -1;
  posix_spawnattr_t sat;
  scr_child_sigdefault_attr(&sat, 0);
  int spawn_err = posix_spawnp(&pid, cmd->data, &fa, &sat, argv,
                               envp != NULL ? envp : environ);
  posix_spawnattr_destroy(&sat);
  posix_spawn_file_actions_destroy(&fa);
  free(argv);
  scr_exec_envp_free(envp);
  if (cap_out) close(outfd[1]);
  if (cap_err) close(errfd[1]);
  if (has_input) close(infd[0]);

  if (spawn_err != 0) {
    if (cap_out) close(outfd[0]);
    if (cap_err) close(errfd[0]);
    if (has_input) close(infd[1]);
    /* execSync's ENOENT is the SHELL missing — can't happen; the file
     * form reports Node's spawnSync error. */
    scr_exec_throw_spawn(cmd, scr_errname(spawn_err), o->async_shape);
    return NULL;
  }

  /* Feed stdin and drain both outputs together (either alone can fill and
   * deadlock a sequential loop); the poll deadline implements timeout. */
  if (has_input) fcntl(infd[1], F_SETFL, O_NONBLOCK);
  ScrCapBuf out, err;
  scr_cap_init(&out);
  scr_cap_init(&err);
  bool out_open = cap_out, err_open = cap_err, in_open = has_input;
  size_t in_at = 0;
  bool timed_out = false;
  double deadline = o->timeout_ms > 0 ? scr_now_ms() + o->timeout_ms : 0;
  while (out_open || err_open || in_open) {
    struct pollfd fds[3];
    nfds_t n = 0;
    if (out_open) { fds[n].fd = outfd[0]; fds[n].events = POLLIN; n++; }
    if (err_open) { fds[n].fd = errfd[0]; fds[n].events = POLLIN; n++; }
    if (in_open) { fds[n].fd = infd[1]; fds[n].events = POLLOUT; n++; }
    int wait = -1;
    if (deadline > 0 && !timed_out) {
      double left = deadline - scr_now_ms();
      wait = left > 0 ? (int)(left + 0.999) : 0;
    }
    int rc = poll(fds, n, wait);
    if (rc < 0) {
      if (errno == EINTR) continue;
      break;
    }
    if (deadline > 0 && !timed_out && scr_now_ms() >= deadline) {
      /* Node's timeout: killSignal (SIGTERM default) to the child; the
       * capture loop keeps draining until the pipes close. */
      timed_out = true;
      kill(pid, SIGTERM);
    }
    if (rc == 0) continue;
    for (nfds_t i = 0; i < n; i++) {
      if (fds[i].revents == 0) continue;
      if (out_open && fds[i].fd == outfd[0]) {
        if (fds[i].revents & (POLLIN | POLLHUP | POLLERR)) out_open = scr_cap_read(&out, outfd[0]);
      } else if (err_open && fds[i].fd == errfd[0]) {
        if (fds[i].revents & (POLLIN | POLLHUP | POLLERR)) err_open = scr_cap_read(&err, errfd[0]);
      } else if (in_open && fds[i].fd == infd[1]) {
        if (fds[i].revents & (POLLERR | POLLHUP)) {
          close(infd[1]);
          in_open = false; /* child closed stdin early: fine, like Node */
        } else if (fds[i].revents & POLLOUT) {
          ssize_t wrote = write(infd[1], o->input->data + in_at, o->input->len - in_at);
          if (wrote > 0) in_at += (size_t)wrote;
          else if (wrote < 0 && errno != EINTR && errno != EAGAIN) {
            close(infd[1]);
            in_open = false;
          }
          if (in_at >= o->input->len) {
            close(infd[1]);
            in_open = false;
          }
        }
      }
    }
  }
  if (cap_out) close(outfd[0]);
  if (cap_err) close(errfd[0]);
  if (in_open) close(infd[1]);

  /* Reap. A live deadline still applies here: a child that closed its
   * stdio but keeps running (the pipes-drained daemon shape) must still be
   * killed at the timeout, so the wait polls WNOHANG until then. */
  int st = 0;
  pid_t reaped = -1;
  if (deadline > 0 && !timed_out) {
    for (;;) {
      reaped = waitpid(pid, &st, WNOHANG);
      if (reaped == pid || (reaped < 0 && errno != EINTR)) break;
      if (scr_now_ms() >= deadline) {
        timed_out = true;
        kill(pid, SIGTERM);
        break;
      }
      struct timespec ts = {0, 500000}; /* 0.5ms */
      nanosleep(&ts, NULL);
    }
  }
  if (reaped != pid) {
    do {
      reaped = waitpid(pid, &st, 0);
    } while (reaped < 0 && errno == EINTR);
  }

  char *display = NULL;
  if (timed_out && !o->async_shape) {
    /* The SYNC forms throw Node's spawnSync ETIMEDOUT; the async shape
     * reports the SIGTERM death as an ordinary command failure below,
     * exactly Node's promisified execFile. */
    free(out.data);
    free(err.data);
    scr_exec_throw_spawn(cmd, "ETIMEDOUT", false);
    return NULL;
  }
  bool failed = !WIFEXITED(st) || WEXITSTATUS(st) != 0;
  /* Node's inheritStderr: no stdio option given → the captured stderr
   * echoes to the parent's stderr AFTER completion, success or failure. */
  if (o->stderr_mode == 0 && err.len > 0) {
    fflush(stdout);
    fwrite(err.data, 1, err.len, stderr);
  }
  if (failed) {
    display = scr_exec_display(cmd, args, o->shell);
    scr_exec_throw_failed(display, &err, cap_err, o->async_shape);
    free(display);
    free(out.data);
    free(err.data);
    return NULL;
  }
  if (o->async_shape && o->stderr_out != NULL) {
    *o->stderr_out = scr_str_new(err.data, err.len);
  }
  ScrStr *out_s = scr_str_new(out.data, out.len);
  free(out.data);
  free(err.data);
  return out_s;
}

/* The libCall entry: modes as doubles (the IR's scalar), input as string +
 * presence flag (Node's exact member reading: an absent/undefined input
 * means NO stdin pipe — /dev/null — while "" pipes EMPTY stdin, the child
 * reading immediate EOF from the pipe), absent cwd as "" ("" is never a
 * valid cwd), env as has_env + pairs (an EMPTY env option is legal Node —
 * it means an empty environment). */
ScrStr *scr_exec_sync(ScrStr *cmd, ScrArr *args, bool shell, ScrStr *input,
                       bool has_input, ScrStr *cwd, bool has_env, ScrArr *env_pairs,
                       double timeout_ms, double stdout_mode, double stderr_mode) {
  ScrExecOpts o = {
      .shell = shell,
      .input = has_input ? input : NULL,
      .cwd = cwd->len > 0 ? cwd : NULL,
      .env_pairs = has_env ? env_pairs : NULL,
      .timeout_ms = timeout_ms,
      /* stdio "inherit"'s stdin rides bit 4 of stdout_mode (the libCall
       * signature predates the mode; see scr_runtime.h). */
      .stdout_mode = (int)stdout_mode & 3,
      .stderr_mode = (int)stderr_mode,
      .stdin_inherit = ((int)stdout_mode & 4) != 0,
  };
  return scr_exec_sync_core(cmd, args, &o);
}

/* The promisified-execFile capture (cp.execCapture): the SAME exec core
 * in the async shape — both streams captured (no echo), Node's async
 * messages on the throw paths (the compiler's interned async helper turns
 * the throw into the rejection). Success answers a +1 ScrSpawnRes reusing
 * the spawnSync result container (status unused — a failure threw). */
ScrSpawnRes *scr_exec_capture(ScrStr *cmd, ScrArr *args, ScrStr *cwd,
                               bool has_env, ScrArr *env_pairs, double timeout_ms) {
  ScrStr *err_s = NULL;
  ScrExecOpts o = {
      .shell = false,
      .input = NULL,
      .cwd = cwd->len > 0 ? cwd : NULL,
      .env_pairs = has_env ? env_pairs : NULL,
      .timeout_ms = timeout_ms,
      .stdout_mode = 1,
      .stderr_mode = 1,
      .async_shape = true,
      .stderr_out = &err_s,
  };
  ScrStr *out_s = scr_exec_sync_core(cmd, args, &o);
  if (out_s == NULL) return NULL; /* exception pending; dummy result */
  return scr_spawn_res_new(true, 0, out_s, err_s);
}

/* ── spawn: the asynchronous child + its event registry ──────────────────
 *
 * spawn(cmd, args, { stdio: "ignore" }) starts the child IMMEDIATELY
 * (posix_spawnp, all three stdio fds on /dev/null) and registers it with
 * the loop: scr_async.c polls scr_children_poll() at quiescence, which
 * waitpid(WNOHANG)s every running child and fires listeners when one is
 * reaped. Node semantics, matched exactly:
 * - "exit" fires once with the exit code, or NO code (→ the null arm)
 *   when the child died to a signal.
 * - "error" fires ONLY for spawn failure (the binary could not be
 *   spawned); a spawn failure never fires "exit".
 * - An "error" event with no registered listener prints the error and
 *   exits 1 (the unhandled-'error' EventEmitter behavior).
 * - The loop keeps the process alive until every child is reaped —
 *   scr_children_pending() is part of its exhaustion test.
 * Wakeup: every spawned child is registered with a kqueue PROC filter
 * (NOTE_EXIT), and the loop's quiescent sleep waits on that kqueue
 * (scr_children_wait) so an exit wakes it immediately — the reap itself
 * stays the WNOHANG sweep below, which the wakeup merely triggers. When
 * kqueue is unavailable (non-kqueue platforms, or a child whose filter
 * registration failed because it already exited), the loop falls back to
 * the original ~1ms polling cap until that child settles.
 *
 * Ownership/cycles: the child holds its listeners (+1 each, moved in)
 * only until the terminal event fires — settling releases every
 * listener, so a listener capturing its own child cannot cycle past the
 * reap, and children allocate lean (no trace header). A listener
 * registered after settling is released immediately and never fires
 * (Node: listeners added after 'exit' emitted don't fire). */

typedef enum {
  SCR_CHILD_RUNNING = 0,
  SCR_CHILD_EXITED = 1,      /* reaped; has_code/code valid */
  SCR_CHILD_SPAWN_FAILED = 2 /* err_msg valid */
} ScrChildState;

typedef struct {
  ScrClosure *cb;
  ScrChildExitFn fn;
} ScrChildExitEntry;

typedef struct {
  ScrClosure *cb;
  ScrChildErrFn fn;
} ScrChildErrEntry;

/* ── piped child output (child.stdout / child.stderr) ────────────────────
 *
 * spawn with stdio ["ignore", "pipe", "pipe"] gives the child fresh pipes
 * for fds 1/2 and the parent a ScrChildStream handle per piped fd —
 * refcounted like the child itself (the child holds one reference so
 * child.stdout answers for the handle's whole life; the service registry
 * holds another until EOF). The stdin-consumer pattern in reverse:
 * - The pipe's read end is NONBLOCKING and read ONLY while a 'data'
 *   listener exists (no consumer = no read: the pipe itself is the
 *   buffer, backpressure exactly like a paused Node stream).
 * - One service pass reads to EAGAIN/EOF, firing one 'data' per read(2)
 *   chunk (≤64KB — libuv's pipe reads chunk the same way, pinned against
 *   Node's out(65536)... sequence).
 * - EOF fires 'end' once, drops the listeners, closes the fd, and leaves
 *   the registry; nothing fires after (listeners registered post-'end'
 *   release immediately — the stdin slice's rule).
 * - ORDERING, pinned against Node: a child's stream 'end' events fire
 *   BEFORE its 'exit' — the settle path drains consumer-owning streams
 *   to EOF/EAGAIN before the exit listeners run. EAGAIN with the child
 *   reaped means another process still holds the write end (a detached
 *   grandchild): 'exit' fires and the stream keeps delivering on later
 *   turns, exactly Node.
 * - LIVENESS: a stream with a 'data' consumer that has not hit EOF holds
 *   the loop alive (Node's flowing-pipe keep-alive); 'end' listeners
 *   alone do not. Wakeups ride the child kqueue: the read end is armed
 *   LEVEL-TRIGGERED (no EV_CLEAR — scr_children_wait's drain discards
 *   events, and a level filter keeps the kqueue readable while unread
 *   data sits in the pipe, so no wakeup is ever lost) when the first
 *   consumer attaches; an arm failure counts into the unwatched-children
 *   fallback (the ~1ms polling cap). */

typedef struct {
  ScrClosure *cb; /* owned */
  ScrChildStreamDataFn fn;
  bool once;
} ScrChildStreamDataL;

typedef struct {
  ScrClosure *cb; /* owned */
  bool once;
} ScrChildStreamEndL;

struct ScrChildStream {
  size_t rc;
  int fd;   /* the pipe's read end; -1 after EOF or spawn failure */
  bool eof; /* 'end' delivered (or the stream never opened) */
  /* Node's readableFlowing, sticky (see the Windows struct note). */
  bool flowing;
  bool armed;     /* EVFILT_READ registered on the child kqueue */
  bool uncounted; /* counted into scr_children_unwatched (arm failure) */
  ScrChildStreamDataL *data_ls;
  size_t n_data, cap_data;
  ScrChildStreamEndL *end_ls;
  size_t n_end, cap_end;
  struct ScrChildStream *next; /* the service registry (+1) */
  const ScrChildStreamForeign *fx; /* non-NULL: a view of a foreign stream object (see scr_child_stream_foreign_new) */
  void *fobj;                      /* the foreign object (+1), when fx */
};

static ScrChildStream *scr_child_streams = NULL;
/* Streams with a live consumer (data listener, not yet EOF): the loop's
 * keep-alive and service predicate. */
static size_t scr_child_streams_watching = 0;

struct ScrChild {
  size_t rc;
  pid_t pid;
  ScrChildState state;
  bool settled;   /* terminal event delivered; listeners released */
  bool unwatched; /* no kqueue NOTE_EXIT armed: the loop must poll for it */
  bool has_code;
  bool killed;    /* a kill() successfully sent a signal (Node's flag) */
  bool reffed;    /* keeps the loop alive; unref() clears it (Node) */
  int spawn_errno; /* spawn failure only: Node's exitCode is -errno there */
  double code;
  /* Signal death only: the terminating signal's name (static storage) —
   * Node's second exit-listener parameter. NULL for a normal exit. */
  const char *exit_signal;
  ScrStr *err_msg; /* spawn failure only: "spawn <cmd> <ERRNAME>" */
  ScrChildExitEntry *exit_cbs;
  size_t n_exit, cap_exit;
  ScrChildErrEntry *err_cbs;
  size_t n_err, cap_err;
  /* Piped stdio (stdio mode 3): the stream handles child.stdout /
   * child.stderr answer — owned (+1 each), NULL when not piped. */
  ScrChildStream *out_stream;
  ScrChildStream *err_stream;
  struct ScrChild *next; /* the pending registry */
};

static ScrChild *scr_children = NULL; /* unsettled children (registry +1) */
static size_t scr_children_reffed_n = 0; /* unsettled AND reffed (liveness) */

/* Children the kqueue can NOT wake the loop for (spawn failures awaiting
 * their first-pass settle, exit-filter registration failures, every child
 * on a non-kqueue platform): while any exist, scr_children_wait refuses
 * and the loop keeps the polling cap for them. */
static size_t scr_children_unwatched = 0;

#ifdef SCR_HAVE_KQUEUE
static int scr_child_kq = -1; /* created with the first spawn; lives forever */

/* Arms NOTE_EXIT for a freshly spawned pid. False = the child cannot be
 * watched (it already exited and EVFILT_PROC refuses zombies — the very
 * next WNOHANG sweep reaps it). EV_ONESHOT: the kernel drops the filter at
 * delivery; a reaped-before-consumed event is a harmless spurious wakeup. */
static bool scr_child_watch(pid_t pid) {
  if (scr_child_kq < 0) {
    scr_child_kq = kqueue();
    if (scr_child_kq < 0) return false;
  }
  struct kevent ev;
  EV_SET(&ev, (uintptr_t)pid, EVFILT_PROC, EV_ADD | EV_ONESHOT, NOTE_EXIT, 0, NULL);
  struct timespec zero = {0, 0};
  return kevent(scr_child_kq, &ev, 1, NULL, 0, &zero) == 0;
}

/* The reap already consumed the wakeup — EV_ONESHOT dropped the filter at
 * delivery, so there is nothing to release. */
static void scr_child_unwatch(pid_t pid) { (void)pid; }
#endif

#ifdef SCR_CHILD_HAVE_PIDFD
static int scr_child_ep = -1; /* created with the first spawn; lives forever */

/* pid -> pidfd, so the reap can CLOSE the pidfd (it polls readable from
 * exit until closed — kqueue's ONESHOT drop has no epoll analogue). A
 * handful of entries at the corpus's scale; linear is fine. */
typedef struct {
  pid_t pid;
  int pidfd;
} ScrChildPidfd;

static ScrChildPidfd *scr_child_pidfds = NULL;
static size_t scr_child_pidfds_n = 0, scr_child_pidfds_cap = 0;

/* Arms an exit wakeup for a freshly spawned pid: pidfd_open registered
 * EPOLLIN. False = the child cannot be watched (ENOSYS on pre-5.3
 * kernels, EMFILE) — the caller keeps the polling cap for it. A pidfd
 * opens fine on a zombie and polls readable at once, so the unwatched
 * set is rarer here than kqueue's refuses-zombies case. */
static bool scr_child_watch(pid_t pid) {
  if (scr_child_ep < 0) {
    scr_child_ep = epoll_create1(EPOLL_CLOEXEC);
    if (scr_child_ep < 0) return false;
  }
  int pfd = pidfd_open(pid, 0);
  if (pfd < 0) return false;
  if (scr_child_pidfds_n == scr_child_pidfds_cap) {
    size_t cap = scr_child_pidfds_cap == 0 ? 8 : scr_child_pidfds_cap * 2;
    ScrChildPidfd *grown = realloc(scr_child_pidfds, cap * sizeof *grown);
    if (grown == NULL) {
      close(pfd);
      return false;
    }
    scr_child_pidfds = grown;
    scr_child_pidfds_cap = cap;
  }
  struct epoll_event ev = {.events = EPOLLIN, .data = {.fd = pfd}};
  if (epoll_ctl(scr_child_ep, EPOLL_CTL_ADD, pfd, &ev) != 0) {
    close(pfd);
    return false;
  }
  scr_child_pidfds[scr_child_pidfds_n++] = (ScrChildPidfd){pid, pfd};
  return true;
}

/* After waitpid reaped the pid: deregister and close its pidfd, or it
 * would keep the epoll readable forever. */
static void scr_child_unwatch(pid_t pid) {
  for (size_t i = 0; i < scr_child_pidfds_n; i++) {
    if (scr_child_pidfds[i].pid != pid) continue;
    (void)epoll_ctl(scr_child_ep, EPOLL_CTL_DEL, scr_child_pidfds[i].pidfd, NULL);
    close(scr_child_pidfds[i].pidfd);
    scr_child_pidfds[i] = scr_child_pidfds[scr_child_pidfds_n - 1];
    scr_child_pidfds_n--;
    return;
  }
}
#endif

#if !defined(SCR_HAVE_KQUEUE) && !defined(SCR_CHILD_HAVE_PIDFD)
static void scr_child_unwatch(pid_t pid) { (void)pid; }
#endif

/* The loop's quiescent sleep while children are pending: waits on the
 * kqueue up to max_wait_ms (the next timer deadline) — a child's NOTE_EXIT
 * wakes it immediately, and the caller's next reap pass settles the child.
 * Returns false when this can't wake for every pending child (no kqueue,
 * or an unwatched child exists): the caller falls back to the ~1ms polling
 * cap instead. Events are drained and DISCARDED — they are wakeups only;
 * the WNOHANG sweep stays the single reaping mechanism. */
/* The pollable child-exit wake fd for the loop's poll(2) sleep (a kqueue
 * fd reads as ready while events are pending): valid only when the kqueue
 * can wake for EVERY pending child — same condition as scr_children_wait.
 * -1 tells the caller to keep the ~1ms reap cap instead. */
int scr_children_wake_fd(void) {
#ifdef SCR_HAVE_KQUEUE
  if (scr_child_kq < 0 || scr_children_unwatched > 0) return -1;
  return scr_child_kq;
#elif defined(SCR_CHILD_HAVE_PIDFD)
  if (scr_child_ep < 0 || scr_children_unwatched > 0) return -1;
  return scr_child_ep; /* readable while any pidfd/stream event pends */
#else
  return -1;
#endif
}

bool scr_children_wait(double max_wait_ms) {
#ifdef SCR_HAVE_KQUEUE
  if (scr_child_kq < 0 || scr_children_unwatched > 0) return false;
  if (!(max_wait_ms > 0)) max_wait_ms = 0;
  struct timespec ts = {(time_t)(max_wait_ms / 1000.0),
                        (long)((max_wait_ms - (double)((time_t)(max_wait_ms / 1000.0)) * 1000.0) * 1e6)};
  struct kevent evs[8];
  (void)kevent(scr_child_kq, NULL, 0, evs, 8, &ts); /* EINTR: spurious pass */
  return true;
#elif defined(SCR_CHILD_HAVE_PIDFD)
  if (scr_child_ep < 0 || scr_children_unwatched > 0) return false;
  if (!(max_wait_ms > 0)) max_wait_ms = 0;
  double capped = max_wait_ms > 2147483000.0 ? 2147483000.0 : max_wait_ms;
  struct epoll_event evs[8];
  /* Events are wakeups only, discarded here exactly like the kqueue
   * drain; level-triggered pidfds stay readable until the reap closes
   * them, so nothing is lost. EINTR: a spurious pass. */
  (void)epoll_wait(scr_child_ep, evs, 8, (int)(capped + 0.999));
  return true;
#else
  (void)max_wait_ms;
  return false;
#endif
}

static void scr_child_drop_listeners(ScrChild *c) {
  for (size_t i = 0; i < c->n_exit; i++) scr_closure_release(c->exit_cbs[i].cb);
  for (size_t i = 0; i < c->n_err; i++) scr_closure_release(c->err_cbs[i].cb);
  free(c->exit_cbs);
  free(c->err_cbs);
  c->exit_cbs = NULL;
  c->err_cbs = NULL;
  c->n_exit = c->n_err = c->cap_exit = c->cap_err = 0;
}

ScrChild *scr_child_retain(ScrChild *c) {
  if (c->rc != SIZE_MAX) c->rc++;
  return c;
}

void scr_child_release(ScrChild *c) {
  if (!c || c->rc == SIZE_MAX) return;
  if (--c->rc == 0) {
    scr_child_drop_listeners(c); /* only reachable pre-settle via leaks */
    scr_str_release(c->err_msg);
    scr_child_stream_release(c->out_stream);
    scr_child_stream_release(c->err_stream);
    scr_child_free_note();
    free(c);
  }
}

void *scr_child_retain_v(void *p) { return scr_child_retain((ScrChild *)p); }
void scr_child_release_v(void *p) { scr_child_release((ScrChild *)p); }

/* Node's error-code names for the spawn failures a posix_spawnp can
 * report (libuv reports the same POSIX names). */
static const char *scr_errname(int err) {
  switch (err) {
  case ENOENT: return "ENOENT";
  case EACCES: return "EACCES";
  case EPERM: return "EPERM";
  case ENOTDIR: return "ENOTDIR";
  case ENOEXEC: return "ENOEXEC";
  case ELOOP: return "ELOOP";
  case ENAMETOOLONG: return "ENAMETOOLONG";
  case E2BIG: return "E2BIG";
  case ENOMEM: return "ENOMEM";
  case EAGAIN: return "EAGAIN";
  case EIO: return "EIO";
  case EINVAL: return "EINVAL";
  default: return "EUNKNOWN";
  }
}

/* ── the stream slice's implementation ─────────────────────────────── */

ScrChildStream *scr_child_stream_retain(ScrChildStream *s) {
  if (s->rc != SIZE_MAX) s->rc++;
  return s;
}

static void scr_child_stream_drop_listeners(ScrChildStream *s) {
  for (size_t i = 0; i < s->n_data; i++) scr_closure_release(s->data_ls[i].cb);
  for (size_t i = 0; i < s->n_end; i++) scr_closure_release(s->end_ls[i].cb);
  free(s->data_ls);
  free(s->end_ls);
  s->data_ls = NULL;
  s->end_ls = NULL;
  s->n_data = s->n_end = s->cap_data = s->cap_end = 0;
}

void scr_child_stream_release(ScrChildStream *s) {
  if (!s || s->rc == SIZE_MAX) return;
  if (--s->rc == 0) {
    scr_child_stream_drop_listeners(s); /* only reachable pre-'end' via leaks */
    if (s->fx != NULL) s->fx->release(s->fobj);
    if (s->fd >= 0) close(s->fd);
    scr_childstream_free_note();
    free(s);
  }
}

void *scr_child_stream_retain_v(void *p) { return scr_child_stream_retain((ScrChildStream *)p); }
void scr_child_stream_release_v(void *p) { scr_child_stream_release((ScrChildStream *)p); }


/* True while the stream has a consumer and can still deliver. */
static bool scr_child_stream_watching(const ScrChildStream *s) {
  return !s->eof && s->fd >= 0 && s->flowing;
}

/* A fresh piped stream over the pipe's read end (nonblocking, cloexec);
 * registered with the service registry (+1). fd < 0 = the never-opened
 * husk a failed spawn hands out (eof from birth, never registered). */
static ScrChildStream *scr_child_stream_new(int fd) {
  ScrChildStream *s = calloc(1, sizeof *s);
  if (!s) scr_child_oom();
  scr_childstream_alloc_note();
  s->rc = 1;
  s->fd = fd;
  if (fd < 0) {
    s->eof = true;
    return s;
  }
  fcntl(fd, F_SETFL, O_NONBLOCK);
  fcntl(fd, F_SETFD, FD_CLOEXEC);
  s->next = scr_child_streams;
  scr_child_streams = scr_child_stream_retain(s);
  return s;
}

/* EOF/error tail: 'end' fires over a snapshot, everything drops, the fd
 * closes (deleting its kqueue filter), and the liveness/fallback counters
 * settle. The caller unlinks from the registry and releases its ref. */
static void scr_child_stream_finish(ScrChildStream *s, bool fire_end) {
  if (scr_child_stream_watching(s)) scr_child_streams_watching--;
  if (s->uncounted) {
    s->uncounted = false;
    scr_children_unwatched--;
  }
  s->eof = true;
  if (s->fd >= 0) {
    close(s->fd);
    s->fd = -1;
  }
  if (fire_end) {
    size_t n = s->n_end;
    ScrChildStreamEndL *snap = malloc(n * sizeof *snap);
    if (!snap) scr_child_oom();
    for (size_t i = 0; i < n; i++) {
      snap[i] = s->end_ls[i];
      scr_closure_retain(snap[i].cb);
    }
    for (size_t i = 0; i < n; i++) {
      if (!scr_exc_pending()) {
        ((void (*)(ScrClosure *))snap[i].cb->fn)(snap[i].cb);
      }
      scr_closure_release(snap[i].cb);
    }
    free(snap);
  }
  scr_child_stream_drop_listeners(s);
}

/* One read pump: while a consumer exists, read(2) to EAGAIN/EOF, one
 * 'data' per chunk (snapshot; `once` entries leave the live list before
 * running — the stdin service's discipline). Returns true when the
 * stream hit EOF (or a read error — piped read errors are not
 * meaningfully reachable, treated as EOF like the stdin slice's
 * no-listener path): the caller finishes and unlinks it. */
static bool scr_child_stream_pump(ScrChildStream *s) {
  while (scr_child_stream_watching(s)) {
    char buf[65536];
    ssize_t n = read(s->fd, buf, sizeof buf);
    if (n < 0) {
      if (errno == EINTR) continue;
      return errno != EAGAIN;
    }
    if (n == 0) return true;
    ScrBytes *chunk = scr_bytes_stamp_buffer(scr_bytes_new(SCR_BYTES_U8, (double)n));
    memcpy(chunk->data, buf, (size_t)n);
    size_t nd = s->n_data;
    ScrChildStreamDataL *snap = malloc(nd * sizeof *snap);
    if (!snap) scr_child_oom();
    for (size_t i = 0; i < nd; i++) {
      snap[i] = s->data_ls[i];
      scr_closure_retain(snap[i].cb);
    }
    for (size_t i = 0; i < nd; i++) {
      if (snap[i].once) {
        for (size_t j = 0; j < s->n_data; j++) {
          if (s->data_ls[j].cb == snap[i].cb) {
            scr_closure_release(s->data_ls[j].cb);
            memmove(s->data_ls + j, s->data_ls + j + 1,
                    (s->n_data - j - 1) * sizeof *s->data_ls);
            s->n_data--;
            break;
          }
        }
      }
      if (!scr_exc_pending()) snap[i].fn(snap[i].cb, chunk);
      scr_closure_release(snap[i].cb);
    }
    free(snap);
    scr_bytes_release(chunk);
    if (scr_exc_pending()) return false;
  }
  return false;
}

/* The registry's service walk: every watched stream pumps; EOF finishes
 * and unlinks (the children_poll unlink-before-fire pattern). */
static void scr_child_streams_service(void) {
  ScrChildStream **link = &scr_child_streams;
  while (*link) {
    ScrChildStream *s = *link;
    bool ended = scr_child_stream_pump(s);
    if (ended) {
      *link = s->next;
      s->next = NULL;
      scr_child_stream_finish(s, true);
      scr_child_stream_release(s); /* the registry's reference */
    } else {
      link = &s->next;
    }
    if (scr_exc_pending()) return;
  }
}

/* The settle-path drain (Node's pinned ordering: stream 'end' before
 * 'exit'): pump one stream to EOF/EAGAIN right now; on EOF, finish it
 * and unlink it from the registry. EAGAIN with the child reaped means a
 * grandchild still holds the write end — 'exit' proceeds and the stream
 * keeps delivering on later turns, exactly Node. */
static void scr_child_stream_drain_now(ScrChildStream *s) {
  if (s == NULL || !scr_child_stream_watching(s)) return;
  if (!scr_child_stream_pump(s)) return;
  ScrChildStream **link = &scr_child_streams;
  while (*link && *link != s) link = &(*link)->next;
  if (*link) {
    *link = s->next;
    s->next = NULL;
    scr_child_stream_finish(s, true);
    scr_child_stream_release(s);
  } else {
    scr_child_stream_finish(s, true); /* defensive: not registered */
  }
}

/* (The read filter lives until the stream finishes: closing its fd drops
 * the filter, and a flowing stream reads to EOF, so no idle wake-ups.) */

/* Arms the level-triggered read filter for a consumer-owning stream (see
 * the design note: no EV_CLEAR — the wait's drain discards events). An
 * arm failure joins the unwatched fallback so the loop keeps the ~1ms
 * polling cap for it. */
static void scr_child_stream_arm(ScrChildStream *s) {
  if (s->armed || s->fd < 0) return;
#ifdef SCR_HAVE_KQUEUE
  if (scr_child_kq < 0) scr_child_kq = kqueue();
  if (scr_child_kq >= 0) {
    struct kevent ev;
    EV_SET(&ev, (uintptr_t)s->fd, EVFILT_READ, EV_ADD, 0, 0, NULL);
    struct timespec zero = {0, 0};
    if (kevent(scr_child_kq, &ev, 1, NULL, 0, &zero) == 0) {
      s->armed = true;
      return;
    }
  }
#elif defined(SCR_CHILD_HAVE_PIDFD)
  /* Level-triggered EPOLLIN, exactly the kqueue arm's level filter: the
   * wait's drain discards events, and level readiness keeps the epoll fd
   * readable while unread data sits in the pipe — no wakeup is lost. */
  if (scr_child_ep < 0) scr_child_ep = epoll_create1(EPOLL_CLOEXEC);
  if (scr_child_ep >= 0) {
    struct epoll_event ev = {.events = EPOLLIN, .data = {.fd = s->fd}};
    if (epoll_ctl(scr_child_ep, EPOLL_CTL_ADD, s->fd, &ev) == 0) {
      s->armed = true;
      return;
    }
  }
#endif
  if (!s->uncounted) {
    s->uncounted = true;
    scr_children_unwatched++;
  }
}

/* Node's resume(): the stream starts flowing (idempotent, sticky). The
 * level-triggered read filter is armed here (the consumer's wake-up). */
static void scr_child_stream_start_flow(ScrChildStream *s) {
  if (s->flowing) return;
  s->flowing = true;
  scr_child_streams_watching++;
  scr_child_stream_arm(s);
}

/* stream.on/once("data", cb): the consumer that makes the pipe flow (and
 * keeps the loop alive). Post-'end' registrations release immediately
 * and never fire, the stdin rule. */
void scr_child_stream_on_data(ScrChildStream *s, ScrClosure *cb /*moves*/,
                               ScrChildStreamDataFn fn, bool once) {
  if (s->fx != NULL) {
    s->fx->on_data(s->fobj, cb, fn, once);
    return;
  }
  if (s->eof || s->fd < 0) {
    scr_closure_release(cb);
    return;
  }
  if (s->n_data == s->cap_data) {
    s->cap_data = s->cap_data ? s->cap_data * 2 : 2;
    s->data_ls = realloc(s->data_ls, s->cap_data * sizeof *s->data_ls);
    if (!s->data_ls) scr_child_oom();
  }
  s->data_ls[s->n_data].cb = cb;
  s->data_ls[s->n_data].fn = fn;
  s->data_ls[s->n_data].once = once;
  s->n_data++;
  scr_child_stream_start_flow(s);
}

/* stream.on/once("end", cb): fires once at EOF; alone it neither reads
 * nor keeps the loop alive (the stdin rule). */
void scr_child_stream_on_end(ScrChildStream *s, ScrClosure *cb /*moves*/, bool once) {
  if (s->fx != NULL) {
    s->fx->on_end(s->fobj, cb, once);
    return;
  }
  (void)once; /* 'end' fires at most once; the flag changes nothing */
  if (s->eof || s->fd < 0) {
    scr_closure_release(cb);
    return;
  }
  if (s->n_end == s->cap_end) {
    s->cap_end = s->cap_end ? s->cap_end * 2 : 2;
    s->end_ls = realloc(s->end_ls, s->cap_end * sizeof *s->end_ls);
    if (!s->end_ls) scr_child_oom();
  }
  s->end_ls[s->n_end].cb = cb;
  s->end_ls[s->n_end].once = once;
  s->n_end++;
}

/* child.stdout / child.stderr — +1 handle, or NULL when the slot was not
 * piped (Node's null there). */
/* Node's flushStdio (lib/internal/child_process.js, v24.15.0): after the
 * child's 'exit' listeners, every piped stdio stream that is not flowing is
 * resumed. The resumed stream discards what no listener takes and emits
 * 'end' at EOF on a later turn, so 'end' follows 'exit'. */
static void scr_child_stream_flush_after_exit(ScrChildStream *s) {
  if (s == NULL || s->eof) return;
#ifdef _WIN32
  if (s->h == NULL) return;
#else
  if (s->fd < 0) return;
#endif
  scr_child_stream_start_flow(s);
}

ScrChildStream *scr_child_stdout(ScrChild *c) {
  return c->out_stream ? scr_child_stream_retain(c->out_stream) : NULL;
}
ScrChildStream *scr_child_stderr(ScrChild *c) {
  return c->err_stream ? scr_child_stream_retain(c->err_stream) : NULL;
}

/* The runtime-provided data adapters (the stdin pair's shapes — local to
 * this unit so piped children never require scr_events.c to link). */
void scr_child_stream_thunk0(ScrClosure *cb, ScrBytes *chunk) {
  (void)chunk;
  ((void (*)(ScrClosure *))cb->fn)(cb);
}
void scr_child_stream_thunk_bytes(ScrClosure *cb, ScrBytes *chunk) {
  /* The listener owns its +1 param per the universal convention. */
  ((void (*)(ScrClosure *, ScrBytes *))cb->fn)(cb, scr_bytes_retain(chunk));
}

ScrChild *scr_spawn(ScrStr *cmd, ScrArr *args) {
  return scr_spawn_opts(cmd, args, 0, 0, 0, 0, 0, false, false, NULL, NULL);
}

/* The options core behind cp.spawn/cp.spawnOpts. PER-SLOT stdio modes:
 * 0 = ignore (/dev/null), 1 = inherit (the parent's fd), 2 = fd (out/err
 * only — out_fd/err_fd dup2 into the child's slot, Node's stdio fd form:
 * the daemon-log idiom ["ignore", logFd, logFd]), 3 = pipe (out/err only
 * — a fresh pipe whose read end becomes the child.stdout/child.stderr
 * stream; see the stream slice's design note). detached gives the
 * child its own session (POSIX_SPAWN_SETSID → setsid(2), the libuv
 * implementation of Node's flag). env_pairs, when has_env, REPLACES the
 * child environment ([k,v,...] like the exec core's); cwd (NULL/"" =
 * inherit) chdirs the child. Spawn failure stays an event, never a
 * throw. */
ScrChild *scr_spawn_opts(ScrStr *cmd, ScrArr *args, double in_mode,
                          double out_mode, double err_mode, double out_fd,
                          double err_fd, bool detached, bool has_env,
                          ScrArr *env_pairs, ScrStr *cwd) {
  if ((int)out_mode == 1 || (int)err_mode == 1 || (int)out_mode == 2 || (int)err_mode == 2) {
    /* Inherited or fd-redirected stdio: flush the parent's buffered
     * output first so everything logged BEFORE the spawn lands before
     * anything the child writes to the same destinations (Node's
     * practical ordering). */
    fflush(stdout);
    fflush(stderr);
  }
  ScrChild *c = calloc(1, sizeof(ScrChild));
  if (!c) scr_child_oom();
  scr_child_alloc_note();
  scr_abandon_arm();
  c->rc = 1;

  /* Piped slots: pipe(2) NOW, both ends cloexec (the file action's dup2
   * clears the flag on the child's copy — every other descriptor closes
   * at exec). A pipe failure degrades the slot to /dev/null — nothing
   * real hits it (fd exhaustion), and the stream husk answers eof. */
  int out_pipe[2] = {-1, -1};
  int err_pipe[2] = {-1, -1};
  if ((int)out_mode == 3 && pipe(out_pipe) != 0) {
    out_pipe[0] = out_pipe[1] = -1;
    out_mode = 0;
  }
  if ((int)err_mode == 3 && pipe(err_pipe) != 0) {
    err_pipe[0] = err_pipe[1] = -1;
    err_mode = 0;
  }
  for (int i = 0; i < 2; i++) {
    if (out_pipe[i] >= 0) fcntl(out_pipe[i], F_SETFD, FD_CLOEXEC);
    if (err_pipe[i] >= 0) fcntl(err_pipe[i], F_SETFD, FD_CLOEXEC);
  }

  posix_spawn_file_actions_t fa;
  posix_spawn_file_actions_init(&fa);
  if ((int)in_mode == 0) {
    posix_spawn_file_actions_addopen(&fa, 0, "/dev/null", O_RDONLY, 0);
  } /* 1 = inherit: no redirection */
  if ((int)out_mode == 0) {
    posix_spawn_file_actions_addopen(&fa, 1, "/dev/null", O_WRONLY, 0);
  } else if ((int)out_mode == 2) {
    posix_spawn_file_actions_adddup2(&fa, (int)out_fd, 1);
  } else if ((int)out_mode == 3) {
    posix_spawn_file_actions_adddup2(&fa, out_pipe[1], 1);
  }
  if ((int)err_mode == 0) {
    posix_spawn_file_actions_addopen(&fa, 2, "/dev/null", O_WRONLY, 0);
  } else if ((int)err_mode == 2) {
    posix_spawn_file_actions_adddup2(&fa, (int)err_fd, 2);
  } else if ((int)err_mode == 3) {
    posix_spawn_file_actions_adddup2(&fa, err_pipe[1], 2);
  }
#if defined(__APPLE__) || defined(__GLIBC__)
  if (cwd != NULL && cwd->len > 0) {
    posix_spawn_file_actions_addchdir_np(&fa, cwd->data);
  }
#endif
  posix_spawnattr_t at;
  scr_child_sigdefault_attr(&at, detached ? POSIX_SPAWN_SETSID : 0);
#ifdef POSIX_SPAWN_SETSID
#else
  (void)detached; /* hosts without the flag: the child stays attached */
#endif
  char **argv = scr_child_argv(cmd, args);
  char **envp = has_env && env_pairs != NULL ? scr_exec_envp(env_pairs) : NULL;
  pid_t pid = -1;
  int spawn_err = posix_spawnp(&pid, cmd->data, &fa, &at, argv,
                               envp != NULL ? envp : environ);
  posix_spawnattr_destroy(&at);
  posix_spawn_file_actions_destroy(&fa);
  free(argv);
  scr_exec_envp_free(envp);

  /* The parent's copies of the write ends close regardless of outcome —
   * the child (when it spawned) holds the only writer, so EOF arrives
   * exactly when it exits (or its last inheritor does). A FAILED spawn
   * keeps its streams too, with no writer at all: a consumer sees
   * immediate EOF, so 'end' fires on the turn after the 'error' event —
   * Node's exact order, pinned by corpus. */
  if (out_pipe[1] >= 0) close(out_pipe[1]);
  if (err_pipe[1] >= 0) close(err_pipe[1]);
  if ((int)out_mode == 3) c->out_stream = scr_child_stream_new(out_pipe[0]);
  if ((int)err_mode == 3) c->err_stream = scr_child_stream_new(err_pipe[0]);

  if (spawn_err != 0) {
    /* Node: `Error: spawn <cmd> <ERRNAME>` on the "error" event. */
    const char *name = scr_errname(spawn_err);
    size_t len = 6 + cmd->len + 1 + strlen(name);
    char *msg = malloc(len + 1);
    if (!msg) scr_child_oom();
    snprintf(msg, len + 1, "spawn %s %s", cmd->data, name);
    c->state = SCR_CHILD_SPAWN_FAILED;
    c->spawn_errno = spawn_err;
    c->err_msg = scr_str_new(msg, len);
    free(msg);
    /* Settles at the next quiescent pass; no exit event will ever wake the
     * loop for it, so it counts as unwatched until then. */
    c->unwatched = true;
    scr_children_unwatched++;
  } else {
    c->state = SCR_CHILD_RUNNING;
    c->pid = pid;
#if defined(SCR_HAVE_KQUEUE) || defined(SCR_CHILD_HAVE_PIDFD)
    c->unwatched = !scr_child_watch(pid);
#else
    c->unwatched = true;
#endif
    if (c->unwatched) scr_children_unwatched++;
  }
  /* The registry's reference: dropped when the child settles. The
   * registry is APPENDED to, not pushed onto: scr_children_poll walks
   * it head-first and settles every spawn FAILURE on its first pass,
   * so the list order IS the order those 'error' events fire. Node
   * queues them with process.nextTick, which is FIFO, so two failing
   * spawns report in spawn order there; they used to report in
   * REVERSE here. With no handler on the second one that is not a
   * cosmetic difference: the unhandled 'error' killed the program
   * before the first child's handler ever ran, so a line Node prints
   * never printed at all (tests/corpus/1466, tests/corpus/3872).
   * Real exits tie-break by this order too, and spawn order is the
   * only defensible tie-break -- which of two same-instant children
   * Node reaps first is genuinely unspecified, and the corpus already
   * sorts before printing wherever it depends on that. The walk is
   * O(unsettled children), a number this registry keeps in single
   * digits; a tail pointer would have to be kept correct by the
   * unlink in scr_children_poll as well. */
  c->reffed = true;
  scr_children_reffed_n++;
  c->next = NULL;
  ScrChild **tail = &scr_children;
  while (*tail != NULL) tail = &(*tail)->next;
  *tail = scr_child_retain(c);
  return c;
}

/* ── the lifecycle members (child.pid/exitCode/killed/kill/unref) ──────── */

/* child.pid — undefined exactly when the spawn failed (Node's shape). */
bool scr_child_has_pid(ScrChild *c) { return c->state != SCR_CHILD_SPAWN_FAILED; }
double scr_child_pid(ScrChild *c) { return (double)c->pid; }

/* child.exitCode — null while running and for a signal death; the exit
 * code after a normal exit; -errno once a spawn failure SETTLED (Node
 * flips it when the "error" event fires — before that it reads null). */
bool scr_child_has_exit_code(ScrChild *c) {
  if (c->state == SCR_CHILD_EXITED) return c->has_code;
  return c->state == SCR_CHILD_SPAWN_FAILED && c->settled;
}
double scr_child_exit_code(ScrChild *c) {
  if (c->state == SCR_CHILD_SPAWN_FAILED) return -(double)c->spawn_errno;
  return c->code;
}

bool scr_child_killed(ScrChild *c) { return c->killed; }

/* child.kill core, numeric signal already resolved: kill(2) while the
 * handle is live (spawned, not yet reaped — a zombie counts, exactly
 * Node's window, which closes when 'exit' is emitted), false after the
 * reap or on spawn failure (Node's null-handle answer). A kill(2) failure
 * answers false too — Node also emits 'error' there, but for a child WE
 * spawned ESRCH can't happen before the reap and EPERM can't happen at
 * all, so the event is unreachable and stays unwired. Node sets `killed`
 * on ANY successful send, signal 0 included (pinned against Node). */
static bool scr_child_kill_signo(ScrChild *c, int signo) {
  if (c->state != SCR_CHILD_RUNNING) return false;
  if (kill(c->pid, signo) != 0) return false;
  c->killed = true;
  return true;
}

/* child.kill(name?) — the name resolves through Node's signal table
 * (scr_signal_from_name; unknown names throw the ERR_UNKNOWN_SIGNAL
 * TypeError BEFORE the handle check, like Node). */
bool scr_child_kill(ScrChild *c, const ScrStr *signal) {
  int signo = scr_signal_from_name(signal);
  if (signo < 0) {
    size_t cap = 16 + signal->len + 1;
    char *msg = malloc(cap);
    if (!msg) scr_child_oom();
    int len = snprintf(msg, cap, "Unknown signal: %s", signal->data);
    scr_throw_error_msg(SCR_ERR_TYPE, msg, (size_t)len);
    free(msg);
    return false;
  }
  return scr_child_kill_signo(c, signo);
}

/* child.kill(number) — the numeric form passes through (0 probes). */
bool scr_child_kill_num(ScrChild *c, double signum) {
  return scr_child_kill_signo(c, (int)signum);
}

/* child.unref() — drops the child from the loop's keep-alive set (Node's
 * semantics: the process may exit while the child runs). The child is
 * still REAPED whenever the loop runs for other reasons; one the loop
 * never reaps is left to the OS at process exit (init reparents it — no
 * zombie outlives the parent). */
void scr_child_unref(ScrChild *c) {
  if (c->reffed) {
    c->reffed = false;
    scr_children_reffed_n--; /* settle/teardown clear reffed first */
  }
}

/* The loop's liveness half: true while some UNSETTLED, REFFED child
 * exists (unref'd children never keep the process alive), or a piped
 * stream still flows for a consumer (Node's flowing-pipe keep-alive —
 * it may outlive the child's own settle when a grandchild holds the
 * write end). */
bool scr_children_reffed_pending(void) {
  return scr_children_reffed_n > 0 || scr_child_streams_watching > 0;
}

/* Loop-exhaustion teardown (the scr_timers_teardown twin): the loop may
 * exit with unref'd children still running — release the registry's
 * references (listeners never fire; Node's process-exit behavior) so the
 * RC audit stays clean. */
void scr_children_teardown(void) {
  /* Streams the loop abandons (a data consumer over a pipe whose child
   * was unref'd, exception exits): release the registry's references so
   * the RC audit stays clean; listeners never fire again. */
  while (scr_child_streams != NULL) {
    ScrChildStream *s = scr_child_streams;
    scr_child_streams = s->next;
    s->next = NULL;
    scr_child_stream_finish(s, false);
    scr_child_stream_release(s);
  }
  while (scr_children != NULL) {
    ScrChild *c = scr_children;
    scr_children = c->next;
    c->next = NULL;
    c->settled = true; /* late listener registrations release immediately */
    if (c->reffed) {
      c->reffed = false;
      scr_children_reffed_n--;
    }
    if (c->unwatched) {
      c->unwatched = false;
      scr_children_unwatched--;
    }
    scr_child_drop_listeners(c);
    scr_child_release(c);
  }
}

void scr_child_on_exit(ScrChild *c, ScrClosure *cb /*moves*/, ScrChildExitFn fn) {
  if (c->settled) {
    scr_closure_release(cb); /* after the terminal event: never fires */
    return;
  }
  if (c->n_exit == c->cap_exit) {
    c->cap_exit = c->cap_exit ? c->cap_exit * 2 : 2;
    c->exit_cbs = realloc(c->exit_cbs, c->cap_exit * sizeof(*c->exit_cbs));
    if (!c->exit_cbs) scr_child_oom();
  }
  c->exit_cbs[c->n_exit].cb = cb;
  c->exit_cbs[c->n_exit].fn = fn;
  c->n_exit++;
}

void scr_child_on_error(ScrChild *c, ScrClosure *cb /*moves*/, ScrChildErrFn fn) {
  if (c->settled) {
    scr_closure_release(cb);
    return;
  }
  if (c->n_err == c->cap_err) {
    c->cap_err = c->cap_err ? c->cap_err * 2 : 2;
    c->err_cbs = realloc(c->err_cbs, c->cap_err * sizeof(*c->err_cbs));
    if (!c->err_cbs) scr_child_oom();
  }
  c->err_cbs[c->n_err].cb = cb;
  c->err_cbs[c->n_err].fn = fn;
  c->n_err++;
}

/* ── the runtime-provided listener adapters ──────────────────────────── */

/* A zero-param exit listener: the code and signal are ignored. */
void scr_child_exit_thunk0(ScrClosure *cb, bool has_code, double code,
                            const char *signal_name) {
  (void)has_code;
  (void)code;
  (void)signal_name;
  ((void (*)(ScrClosure *))cb->fn)(cb);
}

/* A zero-param error listener: the message is ignored. */
void scr_child_err_thunk0(ScrClosure *cb, ScrStr *msg) {
  (void)msg;
  ((void (*)(ScrClosure *))cb->fn)(cb);
}

/* The errno name of the child whose error listeners are FIRING — set by
 * scr_child_settle around its error pass so the thunk below can stamp
 * Node's `code` on the constructed error (the thunk signature is shared
 * with scr_net.c's error events, which parse theirs out of the message
 * below). NULL outside a spawn-failure settle. */
static const char *scr_child_err_code = NULL;

/* [.code on event errors — net/http/dgram parity with spawn failures]
 * The errno name embedded in an errnoException-style message ("connect
 * ECONNREFUSED 127.0.0.1:80", "listen EADDRINUSE: address already in use
 * :::4000", "bind EADDRINUSE 0.0.0.0:4000"): the SECOND space-separated
 * token when it spells an errno name (E + capitals/digits, a colon or
 * space terminating). Every message fired through this thunk is this
 * runtime's own construction, and exactly the ones carrying a code embed
 * it in this shape — Node builds the same messages FROM the code
 * (errnoException), so parsing it back is exact over the closed message
 * set. Fallback only (an explicit context wins); returns a static buffer
 * valid until the next call, or NULL for code-less messages ("socket
 * hang up" stays undefined — divergence 54's documented bound). */
static const char *scr_err_msg_code(const ScrStr *msg) {
  static char buf[32];
  const char *sp = strchr((const char *)msg->data, ' ');
  if (sp == NULL || sp[1] != 'E') return NULL;
  const char *tok = sp + 1;
  size_t n = 1;
  while (tok[n] != '\0' && tok[n] != ' ' && tok[n] != ':') {
    char c = tok[n];
    if (!((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9'))) return NULL;
    if (n + 1 >= sizeof buf) return NULL;
    n++;
  }
  if (n < 3) return NULL; /* "EIO" is the shortest real name */
  memcpy(buf, tok, n);
  buf[n] = '\0';
  return buf;
}

/* An (err: Error) listener: constructs the %Error instance from the
 * message (borrowed; scr_error_new retains its copy) — the listener owns
 * the +1 error param per the universal convention. `code` stamps from the
 * settle context (spawn failures) or the message's own embedded errno name
 * (net/http/dgram 'error' events — see scr_err_msg_code). */
void scr_child_err_thunk_error(ScrClosure *cb, ScrStr *msg) {
  ScrError *e = scr_error_new(0 /* Error */, msg);
  if (scr_child_err_code != NULL) {
    scr_error_set_code(e, scr_child_err_code);
  } else {
    const char *code = scr_err_msg_code(msg);
    if (code != NULL) scr_error_set_code(e, code);
  }
  ((void (*)(ScrClosure *, ScrError *))cb->fn)(cb, e);
}

/* ── the loop's half (called from scr_async.c) ───────────────────────── */

bool scr_children_pending(void) {
  return scr_children != NULL || scr_child_streams_watching > 0;
}

/* True while an UNSETTLED spawn failure sits in the registry: its 'error'
 * is a next-tick-shaped event Node delivers regardless of ref state (an
 * unref'd failed spawn still crashes an error-listener-less program), so
 * the loop's only-unref'd-children exit gate must not skip it. */
bool scr_children_failed_pending(void) {
  for (ScrChild *c = scr_children; c; c = c->next) {
    if (c->state == SCR_CHILD_SPAWN_FAILED && !c->settled) return true;
  }
  return false;
}

/* Fires one settled child's terminal event. The child is already off the
 * registry; drops the listeners and the registry's reference. The pinned
 * ordering runs first: consumer-owning piped streams drain to EOF/EAGAIN
 * so their 'end' events fire BEFORE 'exit' (Node-exact — verified: data*,
 * end, then exit for every output shape). */
static void scr_child_settle(ScrChild *c) {
  if (c->reffed) {
    c->reffed = false;
    scr_children_reffed_n--;
  }
  if (c->unwatched) {
    c->unwatched = false;
    scr_children_unwatched--;
  }
  /* Streams first, settled after: an exit listener registered from a
   * draining 'data'/'end' callback still fires below, like Node's. The
   * SPAWN-FAILURE path skips the drain — Node fires 'error' first and
   * the streams' immediate EOF delivers 'end' on the next turn. */
  if (c->state == SCR_CHILD_EXITED) {
    scr_child_stream_drain_now(c->out_stream);
    if (!scr_exc_pending()) scr_child_stream_drain_now(c->err_stream);
  }
  c->settled = true;
  if (scr_exc_pending()) {
    /* A data/end listener threw: the loop surfaces it (the exit event is
     * lost with the process, like Node's crash-on-uncaught). */
    scr_child_drop_listeners(c);
    scr_child_release(c);
    return;
  }
  if (c->state == SCR_CHILD_SPAWN_FAILED) {
    if (c->n_err == 0) {
      /* Node: an 'error' event with no listener is an uncaught throw.
       * _Exit skips atexit handlers (the RC audit above all) on purpose —
       * the loop dies mid-turn with frames and registries still live,
       * exactly like process.exit(). */
      fflush(stdout);
      fprintf(stderr, "Unhandled 'error' event: Error: %s\n", c->err_msg->data);
      _Exit(1);
    }
    /* Node's spawn-failure error is an errnoException: `code` carries the
     * errno name. The thunk reads this while the pass runs. */
    scr_child_err_code = scr_errname(c->spawn_errno);
    for (size_t i = 0; i < c->n_err; i++) {
      c->err_cbs[i].fn(c->err_cbs[i].cb, c->err_msg);
      if (scr_exc_pending()) break; /* the loop surfaces it */
    }
    scr_child_err_code = NULL;
  } else {
    for (size_t i = 0; i < c->n_exit; i++) {
      c->exit_cbs[i].fn(c->exit_cbs[i].cb, c->has_code, c->code, c->exit_signal);
      if (scr_exc_pending()) break;
    }
  }
  if (c->state == SCR_CHILD_EXITED && !scr_exc_pending()) {
    scr_child_stream_flush_after_exit(c->out_stream);
    scr_child_stream_flush_after_exit(c->err_stream);
  }
  scr_child_drop_listeners(c);
  scr_child_release(c); /* the registry's reference */
}

/* One reap pass: piped streams service FIRST (arrived chunks fire their
 * 'data' listeners; a pipe that hit EOF fires 'end' — before any 'exit'
 * this pass delivers, the pinned ordering), then waitpid(WNOHANG) every
 * running child; spawn failures settle on their first pass (their "next
 * tick"). Listeners run synchronously on the main stack, like timer
 * callbacks — a throw stops the pass and leaves the exception pending
 * for the loop. */
void scr_children_poll(void) {
  scr_child_streams_service();
  if (scr_exc_pending()) return;
  ScrChild **link = &scr_children;
  while (*link) {
    ScrChild *c = *link;
    bool settle = false;
    if (c->state == SCR_CHILD_SPAWN_FAILED) {
      settle = true;
    } else {
      int st = 0;
      pid_t got = waitpid(c->pid, &st, WNOHANG);
      if (got == c->pid) {
        scr_child_unwatch(c->pid); /* Linux: the reaped pidfd must close */
        c->state = SCR_CHILD_EXITED;
        if (WIFEXITED(st)) {
          c->has_code = true;
          c->code = (double)WEXITSTATUS(st);
        } else {
          c->has_code = false; /* signal death: Node's code null */
          c->code = 0;
          if (WIFSIGNALED(st)) c->exit_signal = scr_signal_name(WTERMSIG(st));
        }
        settle = true;
      } else if (got < 0 && errno != EINTR) {
        /* ECHILD or another wait failure: nothing to reap — settle as a
         * signal-style exit so the loop can never spin forever. */
        scr_child_unwatch(c->pid);
        c->state = SCR_CHILD_EXITED;
        c->has_code = false;
        c->code = 0;
        settle = true;
      }
    }
    if (settle) {
      *link = c->next; /* unlink BEFORE firing: callbacks may spawn */
      c->next = NULL;
      scr_child_settle(c);
      if (scr_exc_pending()) return;
      /* one macrotask boundary per settled child: ticks, then jobs */
      scr_loop_drain_callback();
      if (scr_loop_stopping()) return;
    } else {
      link = &c->next;
    }
  }
}

#endif /* !_WIN32 */

/* A VIEW of a foreign stream object behind a ReadableStream-typed value. In Node's class hierarchy a net.Socket IS a stream.Duplex,
 * which IS a stream.Readable, so a socket handed to a parameter typed ReadableStream (pg-protocol's parse(stream, callback)) is
 * accepted as itself: the view keeps the socket (+1) and forwards the stream surface (on/once data and end) to it, no copy and no
 * second implementation of the events. scr_dyn_readable_unadopt answers the original socket when the view is boxed again. */
ScrChildStream *scr_child_stream_foreign_new(void *obj, const ScrChildStreamForeign *ops) {
  ScrChildStream *s = (ScrChildStream *)calloc(1, sizeof *s);
  if (s == NULL) scr_child_oom();
  s->rc = 1;
  s->eof = false;
#ifndef _WIN32
  s->fd = -1;
#endif
  s->fx = ops;
  s->fobj = ops->retain(obj);
  scr_childstream_alloc_note();
  return s;
}

void *scr_child_stream_foreign_obj(const ScrChildStream *s) { return s != NULL && s->fx != NULL ? s->fobj : NULL; }
