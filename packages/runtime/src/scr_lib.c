/* Standard library: the process global + synchronous node:fs (scr_runtime.h
 * has the API contract). Everything here is called through compiler-emitted
 * `libCall` IR.
 *
 * - process.argv is ONE interned array, built lazily on first read and
 *   retained per read — identity (`process.argv === process.argv`) and
 *   mutation persistence match Node's stable process.argv. The atexit
 *   cleanup registered by scr_lib_init releases the interned values before
 *   the RC audit runs (atexit is LIFO; scr_init registered the audit
 *   first), so they never count as leaks.
 * - fs failures THROW through the exception cell (scr_throw_error — the
 *   payload is a catchable Error instance whose message is shaped like
 *   Node's fs error messages) and return a dummy; the compiler emits
 *   pending checks after every fs call (the MAY_THROW_LIB_FNS seed).
 *   scr_fs_exists never throws, like Node's existsSync.
 */
#include "scr_runtime.h"

#include <ctype.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <math.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>

#ifdef _WIN32
/* ── the Windows arm's system surface ─────────────────────────────────
 * mingw-w64's CRT covers most of sync fs (open/read/write/stat/dirent —
 * the seams below note what it lacks: d_type, lstat, two-arg mkdir,
 * mkdtemp, O_SYNC) and the Win32 API covers the process/os surface
 * (GetTempPathA, GetUserNameA, RtlGetVersion, GetConsoleScreenBufferInfo).
 * What has NO arm yet is stubbed honestly at its seam: process.kill and
 * getuid/getgid (needs-design: OpenProcess/TerminateProcess vs Node's
 * uv_kill; no uids exist on Windows — Node omits the members there),
 * setRawMode's raw arm (mechanical: SetConsoleMode).
 * os.networkInterfaces HAS its arm: GetAdaptersAddresses below, libuv's
 * exact row selection. */
#include <direct.h>  /* _mkdir */
#include <io.h>      /* _isatty, _access, open/read/write/close */
#include <process.h> /* getpid */
#include <unistd.h>  /* mingw-w64 ships one: getcwd, access, isatty, ... */
#include <winsock2.h> /* BEFORE windows.h (which pulls winsock 1 otherwise) */
#include <ws2tcpip.h> /* inet_ntop, sockaddr_in6 */
#include <iphlpapi.h> /* GetAdaptersAddresses (os.networkInterfaces) */
#include <windows.h>
#include <lmcons.h>  /* UNLEN for GetUserNameA */


/* CRT stat has no symlink view — lstat degrades to stat (divergence: a
 * compiled binary never reports isSymbolicLink() true on Windows; Node
 * does for real symlinks/junctions). Mechanical fix: GetFileAttributesW +
 * FILE_ATTRIBUTE_REPARSE_POINT. */
#define lstat stat

/* Windows has no directory mode bits; the CRT mkdir takes one argument. */
#define scr_sys_mkdir(p, m) ((void)(m), mkdir(p))

/* openSync's "rs"/"sa" flags: no O_SYNC on the CRT — degrade to non-sync
 * opens (Node on Windows maps O_SYNC to FILE_FLAG_WRITE_THROUGH; the
 * difference is durability, not observable output). */
#define O_SYNC 0

#ifndef INET6_ADDRSTRLEN
#define INET6_ADDRSTRLEN 46 /* ws2tcpip.h's value; only sizes the row bufs */
#endif

#else /* !_WIN32 */

#include <arpa/inet.h>
#include <ifaddrs.h>
#include <net/if.h>
#include <netinet/in.h>
#include <pwd.h>
#include <sys/ioctl.h>
#include <sys/socket.h>
#include <sys/utsname.h>
#include <termios.h>
#include <unistd.h>
#if defined(__APPLE__) || defined(__FreeBSD__) || defined(__OpenBSD__) || defined(__NetBSD__)
#include <net/if_dl.h>
#elif defined(__linux__)
#include <netpacket/packet.h>
#endif

#define scr_sys_mkdir(p, m) mkdir((p), (m))

extern char **environ; /* env snapshot (scr_env_pairs) */

#endif /* _WIN32 */

/* O_BINARY: Windows-only (CRT text mode would translate \n on fd writes);
 * zero elsewhere so the POSIX open flags are unchanged. */
#ifndef O_BINARY
#define O_BINARY 0
#endif

/* ── process ─────────────────────────────────────────────────────────── */

static int scr_lib_argc = 0;
static char **scr_lib_argv = NULL;
static ScrArr *scr_argv_arr = NULL;    /* interned process.argv */
static ScrStr *scr_platform_str = NULL; /* interned process.platform */
static ScrStr *scr_exec_path_str = NULL; /* interned process.execPath */
static ScrStr *scr_arch_str = NULL;      /* interned process.arch */
static ScrStr *scr_versions_node_str = NULL; /* interned process.versions.node */
static ScrStr *scr_versions_openssl_str = NULL; /* interned process.versions.openssl */
static ScrStr *scr_default_locale_str = NULL;   /* interned Intl default locale */

static void scr_lib_cleanup(void) {
  scr_arr_release(scr_argv_arr);
  scr_argv_arr = NULL;
  scr_str_release(scr_platform_str);
  scr_platform_str = NULL;
  scr_str_release(scr_exec_path_str);
  scr_exec_path_str = NULL;
  scr_str_release(scr_arch_str);
  scr_arch_str = NULL;
  scr_str_release(scr_versions_node_str);
  scr_versions_node_str = NULL;
  scr_str_release(scr_versions_openssl_str);
  scr_versions_openssl_str = NULL;
  scr_str_release(scr_default_locale_str);
  scr_default_locale_str = NULL;
}

#ifndef SCR_LIB
/* Executable lane only: a library artifact has no argv and registers no
 * atexit handlers (the emitted library init never calls this; keeping it out
 * the archive's objects free of any atexit reference — the K8 ambient
 * audit's bar). */
void scr_lib_init(int argc, char **argv) {
  scr_lib_argc = argc;
  scr_lib_argv = argv;
  atexit(scr_lib_cleanup);
}
#endif /* !SCR_LIB */

#ifdef SCR_LIB
/* Library builds never call scr_lib_init (a library artifact has no argv and registers no
 * atexit handlers); the interned process values above still intern lazily
 * on first read, so the library reset seam releases them here instead —
 * scr_library_reset (scr_library.c) calls this every session reset. */
void scr_lib_session_cleanup(void) { scr_lib_cleanup(); }
#endif

/* Raw argv accessors for the island's process shim (scr_island.c): the
 * island's process.argv must match the static world's ["scriptc",
 * argv[0], ...] shape exactly, so both build from the same stash. */
int scr_lib_arg_count(void) { return scr_lib_argc; }
const char *scr_lib_arg(int i) { return scr_lib_argv[i]; }

ScrArr *scr_process_argv(void) {
  if (!scr_argv_arr) {
    /* ["scriptc", argv[0], argv[1], ...]: positions and length line up
     * with Node's [node-path, script-path, ...args]; the argv[0]/argv[1]
     * VALUES diverge (SEMANTICS.md). */
    scr_argv_arr = scr_arr_new(SCR_ELEM_STR, (size_t)scr_lib_argc + 1);
    scr_arr_push_ref(scr_argv_arr, scr_str_new("scriptc", 7));
    for (int i = 0; i < scr_lib_argc; i++) {
      const char *a = scr_lib_argv[i];
      scr_arr_push_ref(scr_argv_arr, scr_str_new(a, strlen(a)));
    }
  }
  return scr_arr_retain(scr_argv_arr);
}

ScrStr *scr_process_platform(void) {
  if (!scr_platform_str) {
#if defined(__APPLE__)
    scr_platform_str = scr_str_new("darwin", 6);
#elif defined(__linux__)
    scr_platform_str = scr_str_new("linux", 5);
#elif defined(_WIN32)
    scr_platform_str = scr_str_new("win32", 5);
#else
    scr_platform_str = scr_str_new("unknown", 7);
#endif
  }
  return scr_str_retain(scr_platform_str);
}

/* process.arch — the compiled binary's OWN architecture, spelled the way
 * Node spells its own build's arch. Interned like process.platform. */
ScrStr *scr_process_arch(void) {
  if (!scr_arch_str) {
#if defined(__aarch64__) || defined(_M_ARM64)
    scr_arch_str = scr_str_new("arm64", 5);
#elif defined(__x86_64__) || defined(_M_X64)
    scr_arch_str = scr_str_new("x64", 3);
#else
    scr_arch_str = scr_str_new("unknown", 7);
#endif
  }
  return scr_str_retain(scr_arch_str);
}

/* process.versions.node — the runtime's Node COMPATIBILITY TARGET. There
 * is no Node under a compiled binary; this is the version whose semantics
 * SEMANTICS.md verifies the runtime against (divergence 60, the execPath
 * stance: answer for the world that actually exists). */
#define SCR_NODE_COMPAT_VERSION "24.0.0"
ScrStr *scr_process_versions_node(void) {
  if (!scr_versions_node_str) {
    scr_versions_node_str =
        scr_str_new(SCR_NODE_COMPAT_VERSION, sizeof(SCR_NODE_COMPAT_VERSION) - 1);
  }
  return scr_str_retain(scr_versions_node_str);
}

/* process.versions.openssl — the compat target's crypto-provider version
 * string (the versions.node stance): Boolean(process.versions.openssl) is
 * Node's own "is crypto available" idiom, and the runtime DOES ship a
 * crypto module (mbedTLS-backed; unsupported members fence at their call
 * sites). Reading undefined here made every hasCrypto test self-skip —
 * measuring nothing (SEMANTICS.md; the divergence entry documents that
 * the string names the compat target's OpenSSL, not a linked library). */
#define SCR_OPENSSL_COMPAT_VERSION "3.5.5"
ScrStr *scr_process_versions_openssl(void) {
  if (!scr_versions_openssl_str) {
    scr_versions_openssl_str =
        scr_str_new(SCR_OPENSSL_COMPAT_VERSION, sizeof(SCR_OPENSSL_COMPAT_VERSION) - 1);
  }
  return scr_str_retain(scr_versions_openssl_str);
}

/* process.execPath — the running binary's own resolved absolute path,
 * exactly what Node computes for ITS executable (uv_exepath + realpath):
 * _NSGetExecutablePath on macOS, /proc/self/exe on Linux, argv[0] as the
 * last resort. Interned like process.platform; +1 per read. */
ScrStr *scr_process_exec_path(void) {
  if (!scr_exec_path_str) {
    char raw[4096];
    raw[0] = '\0';
#if defined(__APPLE__)
    uint32_t size = sizeof(raw);
    extern int _NSGetExecutablePath(char *buf, uint32_t *bufsize);
    if (_NSGetExecutablePath(raw, &size) != 0) raw[0] = '\0';
#elif defined(__linux__)
    ssize_t got = readlink("/proc/self/exe", raw, sizeof(raw) - 1);
    if (got > 0) raw[got] = '\0';
    else raw[0] = '\0';
#elif defined(_WIN32)
    /* uv_exepath's source of truth on Windows; already absolute, and
     * spelled with backslashes like Node's own execPath there. */
    DWORD got = GetModuleFileNameA(NULL, raw, sizeof(raw) - 1);
    raw[got < sizeof(raw) ? got : 0] = '\0';
#endif
    if (raw[0] == '\0' && scr_lib_argc > 0) {
      snprintf(raw, sizeof(raw), "%s", scr_lib_argv[0]);
    }
    char resolved[PATH_MAX];
#ifdef _WIN32
    const char *use = _fullpath(resolved, raw, sizeof resolved) != NULL ? resolved : raw;
#else
    const char *use = realpath(raw, resolved) != NULL ? resolved : raw;
#endif
    scr_exec_path_str = scr_str_new(use, strlen(use));
  }
  return scr_str_retain(scr_exec_path_str);
}

ScrStr *scr_env_get(const ScrStr *name) {
  /* ScrStr data is NUL-terminated (like the fs paths below). A fresh copy
   * per read: getenv's buffer is not ours to alias, and Node's process.env
   * reads snapshot the value too. Absent → NULL (the compiler's undefined
   * arm), never a throw. */
#ifdef _WIN32
  /* The WIN32 environment, not the CRT's startup snapshot — libuv's choice
   * too, and the one CreateProcess children inherit. Case-insensitive,
   * like Node's process.env on Windows. */
  DWORD need = GetEnvironmentVariableA(name->data, NULL, 0);
  if (need == 0) return NULL; /* absent (an empty value still needs its NUL) */
  char *buf = malloc(need);
  if (!buf) {
    scr_trap("scriptc: out of memory\n");
  }
  DWORD got = GetEnvironmentVariableA(name->data, buf, need);
  ScrStr *s = scr_str_new(buf, got);
  free(buf);
  return s;
#else
  const char *v = getenv(name->data);
  return v ? scr_str_new(v, strlen(v)) : NULL;
#endif
}

/* process.env.NAME = v — setenv(3): later scr_env_get reads and spawned
 * children (posix_spawn inherits environ) observe the write, like Node.
 * Both args borrowed (NUL-terminated ScrStr data); setenv copies. */
void scr_env_set(const ScrStr *name, const ScrStr *value) {
#ifdef _WIN32
  /* The WIN32 environment (see scr_env_get): an empty value stays a
   * present-but-empty variable, and children inherit the write. */
  SetEnvironmentVariableA(name->data, value->data);
#else
  setenv(name->data, value->data, 1);
#endif
}

/* `delete process.env.NAME` — unsetenv(3): later reads answer absent and
 * spawned children lose the variable, like Node. Borrowed. */
void scr_env_unset(const ScrStr *name) {
#ifdef _WIN32
  SetEnvironmentVariableA(name->data, NULL);
#else
  unsetenv(name->data);
#endif
}

/* The whole environment as one fresh string[] of alternating
 * [k0, v0, k1, v1, ...] entries in environ order — the raw material of the
 * compiler's process.env snapshot record (insertion order = environ order,
 * which is Node's own Object.keys(process.env) order). Entries without '='
 * (not producible by setenv) are skipped; the value is everything after
 * the FIRST '='. +1 array. */
ScrArr *scr_env_pairs(void) {
  ScrArr *out = scr_arr_new(SCR_ELEM_STR, 0);
#ifdef _WIN32
  /* The WIN32 environment block (see scr_env_get): NUL-separated
   * "K=V" entries, double-NUL terminated. Entries whose first byte is
   * '=' are the hidden per-drive cwd variables ("=C:=..."), which libuv
   * (and so Node's process.env) also skips. */
  char *block = GetEnvironmentStringsA();
  if (block != NULL) {
    for (char *e = block; *e != '\0'; e += strlen(e) + 1) {
      const char *eq = strchr(e, '=');
      if (!eq || eq == e) continue;
      scr_arr_push_ref(out, scr_str_new(e, (size_t)(eq - e)));
      scr_arr_push_ref(out, scr_str_new(eq + 1, strlen(eq + 1)));
    }
    FreeEnvironmentStringsA(block);
  }
#else
  for (char **e = environ; *e != NULL; e++) {
    const char *eq = strchr(*e, '=');
    if (!eq || eq == *e) continue;
    scr_arr_push_ref(out, scr_str_new(*e, (size_t)(eq - *e)));
    scr_arr_push_ref(out, scr_str_new(eq + 1, strlen(eq + 1)));
  }
#endif
  return out;
}

/* ── process.pid / process.getuid / process.kill ─────────────────────── */

double scr_process_pid(void) { return (double)getpid(); }

#ifdef _WIN32
/* No uids/gids exist on Windows: Node's process object simply has no
 * getuid/getgid members there, so a call is the property-access TypeError
 * below — thrown catchably, exactly what `process.getuid()` does under
 * Windows Node. */
double scr_process_getuid(void) {
  scr_throw_error_msg(SCR_ERR_TYPE, "process.getuid is not a function", 32);
  return 0;
}

double scr_process_getgid(void) {
  scr_throw_error_msg(SCR_ERR_TYPE, "process.getgid is not a function", 32);
  return 0;
}
#else
double scr_process_getuid(void) { return (double)getuid(); }

double scr_process_getgid(void) { return (double)getgid(); }
#endif

/* Node's signal-name table (the names uv exposes), resolved to the HOST's
 * numbers via the POSIX constants. Node accepts names with the SIG prefix
 * only. On Windows the C runtime defines only the ANSI six (INT, ILL,
 * ABRT, FPE, SEGV, TERM) plus SIGBREAK — libuv fills in the numbers below
 * for the handful more it emulates, and Node's os.constants.signals shows
 * exactly that union, so the same defines keep the two tables' Windows
 * rows Node-identical; every other row #ifdefs away like SIGIO/SIGINFO
 * always did. */
#ifdef _WIN32
#define SIGHUP 1    /* uv's emulated numbers (uv-win.h) */
#define SIGQUIT 3
#define SIGKILL 9
#define SIGWINCH 28
#endif

static int scr_signal_by_name(const char *name) {
  static const struct { const char *name; int sig; } SIGS[] = {
      {"SIGHUP", SIGHUP},   {"SIGINT", SIGINT},       {"SIGQUIT", SIGQUIT},
      {"SIGILL", SIGILL},   {"SIGABRT", SIGABRT},
      {"SIGIOT", SIGABRT},  {"SIGFPE", SIGFPE},
      {"SIGKILL", SIGKILL}, {"SIGSEGV", SIGSEGV},
      {"SIGTERM", SIGTERM}, {"SIGWINCH", SIGWINCH},
#ifdef SIGTRAP
      {"SIGTRAP", SIGTRAP},
#endif
#ifdef SIGBUS
      {"SIGBUS", SIGBUS},
#endif
#ifdef SIGUSR1
      {"SIGUSR1", SIGUSR1}, {"SIGUSR2", SIGUSR2},
#endif
#ifdef SIGPIPE
      {"SIGPIPE", SIGPIPE},
#endif
#ifdef SIGALRM
      {"SIGALRM", SIGALRM},
#endif
#ifdef SIGCHLD
      {"SIGCHLD", SIGCHLD}, {"SIGCONT", SIGCONT},
      {"SIGSTOP", SIGSTOP}, {"SIGTSTP", SIGTSTP},     {"SIGTTIN", SIGTTIN},
      {"SIGTTOU", SIGTTOU}, {"SIGURG", SIGURG},       {"SIGXCPU", SIGXCPU},
      {"SIGXFSZ", SIGXFSZ}, {"SIGVTALRM", SIGVTALRM}, {"SIGPROF", SIGPROF},
      {"SIGSYS", SIGSYS},
#endif
#ifdef SIGBREAK
      {"SIGBREAK", SIGBREAK},
#endif
#ifdef SIGIO
      {"SIGIO", SIGIO},
#endif
#ifdef SIGINFO
      {"SIGINFO", SIGINFO},
#endif
  };
  for (size_t i = 0; i < sizeof SIGS / sizeof SIGS[0]; i++) {
    if (strcmp(SIGS[i].name, name) == 0) return SIGS[i].sig;
  }
  return -1;
}

/* The table above for other units (scr_child.c's child.kill shares Node's
 * one signal-name story): the resolved number, or -1 for unknown names. */
int scr_signal_from_name(const ScrStr *signal) {
  return scr_signal_by_name(signal->data);
}

/* The reverse walk, for spawnSync's result.signal: the FIRST name with
 * the number wins (SIGABRT precedes its SIGIOT alias — Node's spelling),
 * NULL for numbers outside the table. Static storage; never freed. */
const char *scr_signal_name(int sig) {
  static const struct { const char *name; int signo; } SIGS[] = {
      {"SIGHUP", SIGHUP},   {"SIGINT", SIGINT},       {"SIGQUIT", SIGQUIT},
      {"SIGILL", SIGILL},
#ifdef SIGTRAP
      {"SIGTRAP", SIGTRAP},
#endif
      {"SIGABRT", SIGABRT},
#ifdef SIGBUS
      {"SIGBUS", SIGBUS},
#endif
      {"SIGFPE", SIGFPE},   {"SIGKILL", SIGKILL},
#ifdef SIGUSR1
      {"SIGUSR1", SIGUSR1},
#endif
      {"SIGSEGV", SIGSEGV},
#ifdef SIGUSR2
      {"SIGUSR2", SIGUSR2},
#endif
#ifdef SIGPIPE
      {"SIGPIPE", SIGPIPE},
#endif
#ifdef SIGALRM
      {"SIGALRM", SIGALRM},
#endif
      {"SIGTERM", SIGTERM},
#ifdef SIGCHLD
      {"SIGCHLD", SIGCHLD}, {"SIGCONT", SIGCONT},     {"SIGSTOP", SIGSTOP},
      {"SIGTSTP", SIGTSTP}, {"SIGTTIN", SIGTTIN},     {"SIGTTOU", SIGTTOU},
      {"SIGURG", SIGURG},   {"SIGXCPU", SIGXCPU},     {"SIGXFSZ", SIGXFSZ},
      {"SIGVTALRM", SIGVTALRM}, {"SIGPROF", SIGPROF},
#endif
      {"SIGWINCH", SIGWINCH},
#ifdef SIGSYS
      {"SIGSYS", SIGSYS},
#endif
#ifdef SIGBREAK
      {"SIGBREAK", SIGBREAK},
#endif
#ifdef SIGIO
      {"SIGIO", SIGIO},
#endif
#ifdef SIGINFO
      {"SIGINFO", SIGINFO},
#endif
  };
  for (size_t i = 0; i < sizeof SIGS / sizeof SIGS[0]; i++) {
    if (SIGS[i].signo == sig) return SIGS[i].name;
  }
  return NULL;
}

/* Node validates the pid as an int32 BEFORE kill(2) and throws the
 * ERR_INVALID_ARG_TYPE TypeError with this exact (odd) wording. */
static bool scr_kill_pid_check(double pid) {
  if (pid >= -2147483648.0 && pid <= 2147483647.0 && pid == (double)(long long)pid) {
    return true; /* NaN fails both range comparisons */
  }
  char num[32];
  scr_f64_to_str(pid, num);
  char msg[96];
  int len = snprintf(msg, sizeof msg,
                     "The \"pid\" argument must be of type number. "
                     "Received type number (%s)",
                     num);
  scr_throw_error_msg(SCR_ERR_TYPE, msg, (size_t)len);
  return false;
}

/* The shared kill(2) tail: signal 0 probes; failure throws Node's terse
 * `kill ESRCH` / `kill EPERM` / `kill EINVAL` / `kill ENOSYS` Error.
 * Returns Node's constant true.
 *
 * Windows has no signals, so process.kill there is not a kill(2) at all
 * but libuv's uv_kill emulation, and the order of its three decisions is
 * observable. Measured against Node v25.9.0 on this host over the whole
 * range (pid: self, 0, -1, 4, 99999999; signal: every name Node's table
 * carries plus -1, 0, 1..32, 63, 64, 65, 100, 1000):
 *
 *   pid 0                  the CURRENT process (not a process group)
 *   the open fails         ESRCH, or EPERM on ERROR_ACCESS_DENIED — and
 *                          that answer wins over any signal complaint:
 *                          pid 99999999 answers ESRCH for signal -1 and
 *                          for signal 30 alike
 *   signal < 0 or > 28     EINVAL (uv/win.h redefines NSIG as
 *                          SIGWINCH + 1 for exactly this test: 28 is in
 *                          range, 29 is not)
 *   signal 0               liveness probe; an already-exited process is
 *                          ESRCH
 *   SIGINT SIGQUIT SIGKILL SIGTERM
 *                          TerminateProcess(h, 1) — killed processes
 *                          exit 1
 *   anything else in range ENOSYS
 *
 * That last row is why this function exists in this shape. It used to
 * TerminateProcess for it, and the comment here claimed that was
 * "exactly Node-on-Windows's process.kill" — it is the opposite of it.
 * Node throws a CATCHABLE `Error: kill ENOSYS` and the target keeps
 * running; the compiled binary killed the caller instead, so
 * `process.kill(process.pid, "SIGWINCH")` printed one line and died with
 * exit 1 and an empty stderr where Node prints, catches and carries on
 * (tests/corpus/3871, and 1461's `winch self:` line). A silent death
 * where the oracle throws something the program can handle is the worst
 * shape a divergence can take: nothing in the program, and nothing in
 * the harness, can see it happen. */
#ifdef _WIN32
static int scr_win_kill(int pid, int sig) {
  /* uv_kill's own two rights, requested for EVERY signal: a probe of a
   * process this one may query but not terminate is EPERM under Node. */
  HANDLE h = pid == 0
                 ? GetCurrentProcess()
                 : OpenProcess(PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION,
                               FALSE, (DWORD)pid);
  if (h == NULL) {
    errno = GetLastError() == ERROR_ACCESS_DENIED ? EPERM : ESRCH;
    return -1;
  }
  int rc = 0;
  if (sig < 0 || sig > SIGWINCH) {
    errno = EINVAL; /* uv__kill's `signum < 0 || signum >= NSIG` */
    rc = -1;
  } else if (sig == 0) {
    DWORD status;
    if (!GetExitCodeProcess(h, &status)) {
      errno = EPERM;
      rc = -1;
    } else if (status != STILL_ACTIVE) {
      errno = ESRCH; /* opened, but already dead */
      rc = -1;
    }
  } else if (sig == SIGINT || sig == SIGQUIT || sig == SIGKILL || sig == SIGTERM) {
    if (!TerminateProcess(h, 1)) {
      errno = EPERM;
      rc = -1;
    }
  } else {
    errno = ENOSYS; /* in range, and Windows cannot deliver it */
    rc = -1;
  }
  if (pid != 0) CloseHandle(h); /* GetCurrentProcess is a pseudo-handle */
  return rc;
}
#define scr_sys_kill(pid, sig) scr_win_kill((int)(pid), (sig))
#else
#define scr_sys_kill(pid, sig) kill((pid_t)(pid), (sig))
#endif

static bool scr_kill_send(int pid, int sig) {
  if (scr_sys_kill(pid, sig) == 0) return true;
  const char *name = errno == ESRCH    ? "ESRCH"
                     : errno == EPERM  ? "EPERM"
                     : errno == EINVAL ? "EINVAL"
                     /* Windows answers ENOSYS for every signal it cannot
                      * deliver — the common case there, not an edge. */
                     : errno == ENOSYS ? "ENOSYS"
                                       : NULL;
  char msg[32];
  int len;
  if (name) {
    len = snprintf(msg, sizeof msg, "kill %s", name);
    /* Node's errnoException carries code = the errno name. */
    scr_throw_error_msg_code(SCR_ERR_ERROR, msg, (size_t)len, name);
  } else {
    len = snprintf(msg, sizeof msg, "kill E%d", errno);
    scr_throw_error_msg(SCR_ERR_ERROR, msg, (size_t)len);
  }
  return false;
}

bool scr_process_kill(double pid, double signum) {
  if (!scr_kill_pid_check(pid)) return false;
  return scr_kill_send((int)pid, (int)signum);
}

bool scr_process_kill_named(double pid, const ScrStr *signal) {
  if (!scr_kill_pid_check(pid)) return false;
  int sig = scr_signal_by_name(signal->data);
  if (sig < 0) {
    /* Node's ERR_UNKNOWN_SIGNAL TypeError. */
    size_t cap = 16 + signal->len + 1;
    char *msg = malloc(cap);
    if (!msg) {
      scr_trap("scriptc: out of memory\n");
    }
    int len = snprintf(msg, cap, "Unknown signal: %s", signal->data);
    scr_throw_error_msg(SCR_ERR_TYPE, msg, (size_t)len);
    free(msg);
    return false;
  }
  return scr_kill_send((int)pid, sig);
}

ScrStr *scr_process_cwd(void) {
  char buf[4096];
  if (!getcwd(buf, sizeof buf)) {
    scr_trap("scriptc: process.cwd() failed\n");
  }
  return scr_str_new(buf, strlen(buf));
}

/* The raw byte writes use the SAME stdio stream as console, and each call
 * flushes before returning so live consumers see Node's source order without
 * an observable C buffering delay. The boolean is Node's backpressure signal
 * — this synchronous runtime has no queued backpressure, so it is constantly
 * true. */
bool scr_process_stdout_write(const ScrStr *data) {
  scr_stdio_write(1, data->data, data->len);
  return true;
}

bool scr_process_stderr_write(const ScrStr *data) {
  scr_stdio_write(2, data->data, data->len);
  return true;
}

/* The FIRST-CLASS stream write (`output.write(line)` where output is a
 * WritableStream-typed value — the prefixStream idiom): the value is the
 * stream's fd (1 or 2, minted by the process.stdout/stderr reads), and
 * the write dispatches onto the exact stdout/stderr paths above so
 * prompt submission and ordering stay identical. */
bool scr_proc_stream_write(double fd, const ScrStr *data) {
  return (int)fd == 2 ? scr_process_stderr_write(data) : scr_process_stdout_write(data);
}

/* ── os ──────────────────────────────────────────────────────────────
 * os.platform() lowers to scr_process_platform (one implementation).
 * homedir/tmpdir follow libuv's POSIX rules, which Node delegates to.
 */

#ifdef _WIN32
/* uv_os_homedir on Windows: %USERPROFILE% first, then the profile
 * directory API. The env var covers every real session; abort matches
 * the POSIX arm's stance on the unreachable failure. */
ScrStr *scr_os_homedir(void) {
  const char *home = getenv("USERPROFILE");
  if (home && home[0] != '\0') return scr_str_new(home, strlen(home));
  scr_trap("scriptc: os.homedir() failed\n");
}

ScrStr *scr_os_user_name(void) {
  char buf[UNLEN + 1];
  DWORD n = sizeof buf;
  if (!GetUserNameA(buf, &n) || n == 0) {
    scr_trap("scriptc: os.userInfo() failed\n");
  }
  return scr_str_new(buf, n - 1); /* n counts the NUL */
}

ScrStr *scr_os_user_shell(void) {
  /* Unreachable on this host: the record takes the NULL arm through
   * scr_os_user_shell_null below, which is Node's actual Windows answer.
   * Kept as the well-defined value for a `shell: string` mapping, which
   * has no null arm to take. */
  return scr_str_new("", 0);
}

bool scr_os_user_shell_null(void) { return true; }

ScrStr *scr_os_user_homedir(void) {
  return scr_os_homedir(); /* uv_os_get_passwd reuses uv_os_homedir on win */
}

/* uv_os_get_passwd fills uid/gid with -1 on Windows and Node hands that
 * straight through: `os.userInfo().uid === -1`. This is NOT the same
 * answer as process.getuid(), which does not EXIST on Windows and whose
 * call is a TypeError (scr_process_getuid, above, is right to throw) —
 * and userInfo used to be assembled from that one, so reading any field
 * of the record threw instead of answering. */
double scr_os_user_uid(void) { return -1; }

double scr_os_user_gid(void) { return -1; }

ScrStr *scr_os_release(void) {
  /* uv_os_uname on Windows: RtlGetVersion (the un-lied-to GetVersionEx),
   * rendered "major.minor.build" — Node answers e.g. "10.0.26100". */
  typedef LONG(WINAPI * RtlGetVersionFn)(PRTL_OSVERSIONINFOW);
  RTL_OSVERSIONINFOW info;
  memset(&info, 0, sizeof info);
  info.dwOSVersionInfoSize = sizeof info;
  HMODULE ntdll = GetModuleHandleA("ntdll.dll");
  RtlGetVersionFn fn =
      ntdll ? (RtlGetVersionFn)(void *)GetProcAddress(ntdll, "RtlGetVersion") : NULL;
  if (fn == NULL || fn(&info) != 0) {
    scr_trap("scriptc: os.release() failed\n");
  }
  char buf[64];
  int len = snprintf(buf, sizeof buf, "%lu.%lu.%lu", (unsigned long)info.dwMajorVersion,
                     (unsigned long)info.dwMinorVersion, (unsigned long)info.dwBuildNumber);
  return scr_str_new(buf, (size_t)len);
}

ScrStr *scr_os_type(void) {
  /* uv_os_uname's sysname on Windows is the constant "Windows_NT". */
  return scr_str_new("Windows_NT", 10);
}

double scr_os_totalmem(void) {
  MEMORYSTATUSEX ms;
  memset(&ms, 0, sizeof ms);
  ms.dwLength = sizeof ms;
  if (!GlobalMemoryStatusEx(&ms)) return 0;
  return (double)ms.ullTotalPhys;
}

/* One environment variable as a fresh NUL-terminated buffer, or NULL when
 * absent OR empty — Node reaches for these through `a || b || c`, where the
 * empty string falls through exactly like the missing one. Read with
 * GetEnvironmentVariableA, this file's convention for the environment (see
 * scr_env_get): the live WIN32 block rather than the CRT's startup snapshot,
 * case-insensitive like Node's process.env on Windows. Caller frees. */
static char *scr_win_env_dup(const char *name) {
  DWORD need = GetEnvironmentVariableA(name, NULL, 0);
  if (need == 0) return NULL; /* absent, or present-but-empty */
  char *buf = malloc(need);
  if (!buf) {
    scr_trap("scriptc: out of memory\n");
  }
  DWORD got = GetEnvironmentVariableA(name, buf, need);
  if (got == 0 || buf[0] == '\0') {
    free(buf);
    return NULL;
  }
  return buf;
}

ScrStr *scr_os_tmpdir(void) {
  /* Node's lib/os.js tmpdir() on Windows is plain JS over process.env — it
   * is NOT uv_os_tmpdir and NOT GetTempPath, and all three disagree. This
   * used to call GetTempPathA, which reads TMP BEFORE TEMP, absolutizes a
   * relative value against the cwd, rewrites '/' to '\\', collapses
   * repeated separators, and fails above MAX_PATH (whereupon we fell back
   * to the profile directory — landing the process's temporary files on a
   * different VOLUME than the one the user asked for). Node does none of
   * that: whatever the variable holds is what it answers, minus at most one
   * trailing backslash. */
  char *temp = scr_win_env_dup("TEMP");
  if (!temp) temp = scr_win_env_dup("TMP");
  if (!temp) {
    char *root = scr_win_env_dup("SystemRoot");
    if (!root) root = scr_win_env_dup("windir");
    /* Node concatenates the undefined straight into the result when neither
     * is set, so the literal string "undefined\temp" is the honest port. */
    const char *r = root ? root : "undefined";
    size_t rl = strlen(r);
    temp = malloc(rl + 6);
    if (!temp) {
      scr_trap("scriptc: out of memory\n");
    }
    memcpy(temp, r, rl);
    memcpy(temp + rl, "\\temp", 6);
    free(root);
  }
  size_t len = strlen(temp);
  /* Drop ONE trailing backslash, unless the character before it is ':' —
   * the drive root "C:\" keeps its separator, because "C:" is drive-
   * RELATIVE and would resolve against that drive's current directory. A
   * trailing FORWARD slash is not a separator to this rule and stays. */
  if (len > 1 && temp[len - 1] == '\\' && temp[len - 2] != ':') len--;
  ScrStr *s = scr_str_new(temp, len);
  free(temp);
  return s;
}
#else
ScrStr *scr_os_homedir(void) {
  /* uv_os_homedir: $HOME when set (even empty is "set" only if non-NULL;
   * libuv requires non-empty), else the passwd entry. */
  const char *home = getenv("HOME");
  if (home && home[0] != '\0') return scr_str_new(home, strlen(home));
  struct passwd pw;
  struct passwd *result = NULL;
  char buf[8192];
  if (getpwuid_r(getuid(), &pw, buf, sizeof buf, &result) != 0 || !result || !result->pw_dir) {
    scr_trap("scriptc: os.homedir() failed\n");
  }
  return scr_str_new(result->pw_dir, strlen(result->pw_dir));
}

/* The os.userInfo() field trio — uv_os_get_passwd's slices. One passwd
 * lookup per call (three calls per userInfo record — cheap, no caching
 * to invalidate). Failure aborts: Node throws a system error there, but
 * no compiled program path reaches it for the running uid. */
static const struct passwd *scr_os_passwd(char *buf, size_t cap, struct passwd *pw) {
  struct passwd *result = NULL;
  if (getpwuid_r(getuid(), pw, buf, cap, &result) != 0 || !result) {
    scr_trap("scriptc: os.userInfo() failed\n");
  }
  return result;
}

ScrStr *scr_os_user_name(void) {
  struct passwd pw;
  char buf[8192];
  const struct passwd *r = scr_os_passwd(buf, sizeof buf, &pw);
  return scr_str_new(r->pw_name, strlen(r->pw_name));
}

/* The passwd entry's ids. getuid(2)/getgid(2) rather than pw_uid/
 * pw_gid: it is the answer the shared process.getuid/getgid entry points
 * gave before userInfo stopped sharing them, so this split changes
 * nothing off Windows. */
double scr_os_user_uid(void) { return (double)getuid(); }

double scr_os_user_gid(void) { return (double)getgid(); }

ScrStr *scr_os_user_shell(void) {
  struct passwd pw;
  char buf[8192];
  const struct passwd *r = scr_os_passwd(buf, sizeof buf, &pw);
  const char *sh = r->pw_shell ? r->pw_shell : "";
  return scr_str_new(sh, strlen(sh));
}

/* POSIX always answers the string arm — uv_os_get_passwd fills pw_shell. */
bool scr_os_user_shell_null(void) { return false; }

ScrStr *scr_os_user_homedir(void) {
  /* The PASSWD home (pw_dir) — Node's userInfo().homedir, distinct from
   * os.homedir()'s $HOME-first cascade. */
  struct passwd pw;
  char buf[8192];
  const struct passwd *r = scr_os_passwd(buf, sizeof buf, &pw);
  return scr_str_new(r->pw_dir, strlen(r->pw_dir));
}

ScrStr *scr_os_release(void) {
  /* uname(2)'s release field — Node's uv_os_uname()-backed answer. */
  struct utsname u;
  if (uname(&u) != 0) {
    scr_trap("scriptc: os.release() failed\n");
  }
  return scr_str_new(u.release, strlen(u.release));
}

ScrStr *scr_os_type(void) {
  /* uname(2)'s sysname field ("Darwin", "Linux") — Node's os.type(). */
  struct utsname u;
  if (uname(&u) != 0) {
    scr_trap("scriptc: os.type() failed\n");
  }
  return scr_str_new(u.sysname, strlen(u.sysname));
}

double scr_os_totalmem(void) {
  /* Total physical memory in bytes (sysconf pages × page size — Darwin
   * and Linux both answer _SC_PHYS_PAGES). */
  long pages = sysconf(_SC_PHYS_PAGES);
  long psize = sysconf(_SC_PAGE_SIZE);
  if (pages <= 0 || psize <= 0) return 0;
  return (double)pages * (double)psize;
}

ScrStr *scr_os_tmpdir(void) {
  /* Node's env cascade, with ONE trailing slash trimmed (never down to
   * nothing: "/" stays "/"). */
  const char *dir = getenv("TMPDIR");
  if (!dir || dir[0] == '\0') dir = getenv("TMP");
  if (!dir || dir[0] == '\0') dir = getenv("TEMP");
  if (!dir || dir[0] == '\0') dir = "/tmp";
  size_t len = strlen(dir);
  if (len > 1 && dir[len - 1] == '/') len--;
  return scr_str_new(dir, len);
}
#endif /* _WIN32 */

/* ── os.networkInterfaces(): the getifaddrs(3) snapshot ────────────────
 * Row selection and field semantics follow libuv (src/unix/bsd-ifaddrs.c),
 * which Node delegates to: an entry contributes a row iff its interface is
 * IFF_UP && IFF_RUNNING, its address is present, and its family is
 * AF_INET/AF_INET6; `internal` is IFF_LOOPBACK; MACs come from the
 * interface's link-level sibling entry (AF_LINK/AF_PACKET, matched by
 * name), all-zeros when there is none; cidr is Node's lib/os.js
 * computation — address/<contiguous netmask prefix>, null when the netmask
 * is non-contiguous (never in practice). Row order is getifaddrs
 * enumeration order, which is also Node's — but Node guarantees no order,
 * so consumers should compare structurally. The emitter walks the snapshot
 * through the accessors below and builds the typed record inline; a
 * getifaddrs failure (effectively unreachable) yields an empty snapshot
 * where Node would throw ERR_SYSTEM_ERROR. */

typedef struct ScrIfaddrRow {
  char name[64];
  char address[INET6_ADDRSTRLEN];
  char netmask[INET6_ADDRSTRLEN];
  char cidr[INET6_ADDRSTRLEN + 5]; /* address + "/128" */
  bool has_cidr;
  char mac[18]; /* "aa:bb:cc:dd:ee:ff" */
  bool internal;
  bool ipv6;
  double scopeid;
} ScrIfaddrRow;

struct ScrIfaddrs {
  size_t n;
  ScrIfaddrRow *rows;
};

#ifdef _WIN32
/* The Windows arm mirrors libuv's uv_interface_addresses (src/win/util.c),
 * which Node delegates to: GetAdaptersAddresses(AF_UNSPEC, INCLUDE_PREFIX
 * + the SKIP_* flags libuv passes), an adapter contributes rows iff
 * OperStatus == IfOperStatusUp and it has a unicast address, the row name
 * is the adapter's FriendlyName (UTF-8), `internal` is the software-
 * loopback interface type, MAC comes from PhysicalAddress (all-zeros when
 * absent — the loopback), the netmask is built from each unicast
 * address's OnLinkPrefixLength, and scopeid is the v6 sockaddr's. cidr is
 * the shared prefix computation below (always contiguous here by
 * construction). A snapshot failure yields the empty dict, the historical
 * stance. */
ScrIfaddrs *scr_os_ifaddrs(void) {
  ScrIfaddrs *s = calloc(1, sizeof *s);
  if (!s) scr_trap("scriptc: out of memory\n");
  ULONG flags = GAA_FLAG_INCLUDE_PREFIX | GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST |
                GAA_FLAG_SKIP_DNS_SERVER;
  ULONG size = 16 * 1024;
  IP_ADAPTER_ADDRESSES *adapters = NULL;
  for (int tries = 0; tries < 4; tries++) {
    adapters = realloc(adapters, size);
    if (!adapters) scr_trap("scriptc: out of memory\n");
    ULONG rc = GetAdaptersAddresses(AF_UNSPEC, flags, NULL, adapters, &size);
    if (rc == ERROR_SUCCESS) break;
    if (rc != ERROR_BUFFER_OVERFLOW) {
      free(adapters);
      s->rows = calloc(1, sizeof *s->rows);
      if (!s->rows) scr_trap("scriptc: out of memory\n");
      return s; /* empty snapshot */
    }
  }
  size_t count = 0;
  for (IP_ADAPTER_ADDRESSES *a = adapters; a != NULL; a = a->Next) {
    if (a->OperStatus != IfOperStatusUp || a->FirstUnicastAddress == NULL) continue;
    for (IP_ADAPTER_UNICAST_ADDRESS *u = a->FirstUnicastAddress; u != NULL; u = u->Next) {
      int fam = u->Address.lpSockaddr->sa_family;
      if (fam == AF_INET || fam == AF_INET6) count++;
    }
  }
  s->rows = calloc(count ? count : 1, sizeof *s->rows);
  if (!s->rows) scr_trap("scriptc: out of memory\n");
  for (IP_ADAPTER_ADDRESSES *a = adapters; a != NULL; a = a->Next) {
    if (a->OperStatus != IfOperStatusUp || a->FirstUnicastAddress == NULL) continue;
    char name[64] = "";
    WideCharToMultiByte(CP_UTF8, 0, a->FriendlyName, -1, name, sizeof name - 1, NULL, NULL);
    char mac[18];
    if (a->PhysicalAddressLength == 6) {
      snprintf(mac, sizeof mac, "%02x:%02x:%02x:%02x:%02x:%02x", a->PhysicalAddress[0],
               a->PhysicalAddress[1], a->PhysicalAddress[2], a->PhysicalAddress[3],
               a->PhysicalAddress[4], a->PhysicalAddress[5]);
    } else {
      snprintf(mac, sizeof mac, "00:00:00:00:00:00");
    }
    bool internal = a->IfType == IF_TYPE_SOFTWARE_LOOPBACK;
    for (IP_ADAPTER_UNICAST_ADDRESS *u = a->FirstUnicastAddress; u != NULL; u = u->Next) {
      int fam = u->Address.lpSockaddr->sa_family;
      if (fam != AF_INET && fam != AF_INET6) continue;
      if (s->n == count) break; /* the topology raced the two passes */
      ScrIfaddrRow *row = &s->rows[s->n++];
      snprintf(row->name, sizeof row->name, "%s", name);
      memcpy(row->mac, mac, sizeof mac);
      row->internal = internal;
      unsigned prefix = u->OnLinkPrefixLength;
      if (fam == AF_INET6) {
        const struct sockaddr_in6 *sa = (const struct sockaddr_in6 *)u->Address.lpSockaddr;
        row->ipv6 = true;
        row->scopeid = (double)sa->sin6_scope_id;
        inet_ntop(AF_INET6, (void *)&sa->sin6_addr, row->address, sizeof row->address);
        unsigned char mask[16];
        if (prefix > 128) prefix = 128;
        for (size_t i = 0; i < 16; i++) {
          unsigned bits = prefix > 8 * i ? prefix - 8 * i : 0;
          mask[i] = bits >= 8 ? 0xff : (unsigned char)(0xff00 >> bits);
        }
        inet_ntop(AF_INET6, mask, row->netmask, sizeof row->netmask);
        row->has_cidr = true;
        snprintf(row->cidr, sizeof row->cidr, "%s/%u", row->address, prefix);
      } else {
        const struct sockaddr_in *sa = (const struct sockaddr_in *)u->Address.lpSockaddr;
        inet_ntop(AF_INET, (void *)&sa->sin_addr, row->address, sizeof row->address);
        if (prefix > 32) prefix = 32;
        uint32_t mask = prefix == 0 ? 0 : 0xffffffffu << (32 - prefix);
        struct in_addr m;
        m.s_addr = htonl(mask);
        inet_ntop(AF_INET, (void *)&m, row->netmask, sizeof row->netmask);
        row->has_cidr = true;
        snprintf(row->cidr, sizeof row->cidr, "%s/%u", row->address, prefix);
      }
    }
  }
  free(adapters);
  return s;
}
#else
/* libuv's uv__ifaddr_exclude for the address pass, plus the explicit
 * INET/INET6 family filter (the only families Node's binding reports). */
static bool scr_ifaddr_row_ok(const struct ifaddrs *ent) {
  if (!((ent->ifa_flags & IFF_UP) && (ent->ifa_flags & IFF_RUNNING))) return false;
  if (ent->ifa_addr == NULL) return false;
  int fam = ent->ifa_addr->sa_family;
  return fam == AF_INET || fam == AF_INET6;
}

/* Node's getCIDR (lib/os.js): the netmask's contiguous 1-bit prefix.
 * Returns -1 for a non-contiguous mask (cidr is then null). */
static int scr_netmask_prefix(const unsigned char *bytes, size_t len) {
  int ones = 0;
  bool zero_seen = false;
  for (size_t i = 0; i < len; i++) {
    unsigned char b = bytes[i];
    for (int bit = 7; bit >= 0; bit--) {
      if (b & (1u << bit)) {
        if (zero_seen) return -1; /* a 1 after a 0: split mask */
        ones++;
      } else {
        zero_seen = true;
      }
    }
  }
  return ones;
}

ScrIfaddrs *scr_os_ifaddrs(void) {
  ScrIfaddrs *s = calloc(1, sizeof *s);
  if (!s) scr_trap("scriptc: out of memory\n");
  struct ifaddrs *addrs = NULL;
  if (getifaddrs(&addrs) != 0) return s;
  size_t count = 0;
  for (struct ifaddrs *ent = addrs; ent != NULL; ent = ent->ifa_next) {
    if (scr_ifaddr_row_ok(ent)) count++;
  }
  s->rows = calloc(count ? count : 1, sizeof *s->rows);
  if (!s->rows) scr_trap("scriptc: out of memory\n");
  for (struct ifaddrs *ent = addrs; ent != NULL; ent = ent->ifa_next) {
    if (!scr_ifaddr_row_ok(ent)) continue;
    ScrIfaddrRow *row = &s->rows[s->n++];
    snprintf(row->name, sizeof row->name, "%s", ent->ifa_name);
    snprintf(row->mac, sizeof row->mac, "00:00:00:00:00:00");
    row->internal = (ent->ifa_flags & IFF_LOOPBACK) != 0;
    unsigned char maskbytes[16];
    size_t masklen = 0;
    if (ent->ifa_addr->sa_family == AF_INET6) {
      const struct sockaddr_in6 *sa = (const struct sockaddr_in6 *)ent->ifa_addr;
      row->ipv6 = true;
      row->scopeid = (double)sa->sin6_scope_id;
      inet_ntop(AF_INET6, &sa->sin6_addr, row->address, sizeof row->address);
      /* A NULL netmask stays zeroed, exactly libuv's memset — "::"/0. */
      struct in6_addr mask;
      memset(&mask, 0, sizeof mask);
      if (ent->ifa_netmask != NULL) {
        mask = ((const struct sockaddr_in6 *)ent->ifa_netmask)->sin6_addr;
      }
      inet_ntop(AF_INET6, &mask, row->netmask, sizeof row->netmask);
      memcpy(maskbytes, &mask, 16);
      masklen = 16;
    } else {
      const struct sockaddr_in *sa = (const struct sockaddr_in *)ent->ifa_addr;
      inet_ntop(AF_INET, &sa->sin_addr, row->address, sizeof row->address);
      struct in_addr mask;
      memset(&mask, 0, sizeof mask);
      if (ent->ifa_netmask != NULL) {
        mask = ((const struct sockaddr_in *)ent->ifa_netmask)->sin_addr;
      }
      inet_ntop(AF_INET, &mask, row->netmask, sizeof row->netmask);
      memcpy(maskbytes, &mask, 4);
      masklen = 4;
    }
    int prefix = scr_netmask_prefix(maskbytes, masklen);
    if (prefix >= 0) {
      row->has_cidr = true;
      snprintf(row->cidr, sizeof row->cidr, "%s/%d", row->address, prefix);
    }
  }
  /* MAC pass: the link-level sibling entry, matched by interface name —
   * every row of that interface gets its physical address. */
  for (struct ifaddrs *ent = addrs; ent != NULL; ent = ent->ifa_next) {
    if (!((ent->ifa_flags & IFF_UP) && (ent->ifa_flags & IFF_RUNNING))) continue;
    if (ent->ifa_addr == NULL) continue;
    const unsigned char *phys = NULL;
#if defined(__APPLE__) || defined(__FreeBSD__) || defined(__OpenBSD__) || defined(__NetBSD__)
    if (ent->ifa_addr->sa_family == AF_LINK) {
      const struct sockaddr_dl *sdl = (const struct sockaddr_dl *)ent->ifa_addr;
      if (sdl->sdl_alen == 6) phys = (const unsigned char *)LLADDR(sdl);
    }
#elif defined(__linux__)
    if (ent->ifa_addr->sa_family == AF_PACKET) {
      const struct sockaddr_ll *sll = (const struct sockaddr_ll *)ent->ifa_addr;
      if (sll->sll_halen == 6) phys = sll->sll_addr;
    }
#endif
    if (!phys) continue;
    for (size_t i = 0; i < s->n; i++) {
      if (strcmp(s->rows[i].name, ent->ifa_name) != 0) continue;
      snprintf(s->rows[i].mac, sizeof s->rows[i].mac, "%02x:%02x:%02x:%02x:%02x:%02x",
               phys[0], phys[1], phys[2], phys[3], phys[4], phys[5]);
    }
  }
  freeifaddrs(addrs);
  return s;
}
#endif /* _WIN32 */

size_t scr_os_ifaddrs_count(const ScrIfaddrs *s) { return s->n; }
ScrStr *scr_os_ifaddrs_name(const ScrIfaddrs *s, size_t i) {
  return scr_str_new(s->rows[i].name, strlen(s->rows[i].name));
}
ScrStr *scr_os_ifaddrs_address(const ScrIfaddrs *s, size_t i) {
  return scr_str_new(s->rows[i].address, strlen(s->rows[i].address));
}
ScrStr *scr_os_ifaddrs_netmask(const ScrIfaddrs *s, size_t i) {
  return scr_str_new(s->rows[i].netmask, strlen(s->rows[i].netmask));
}
ScrStr *scr_os_ifaddrs_family(const ScrIfaddrs *s, size_t i) {
  return s->rows[i].ipv6 ? scr_str_new("IPv6", 4) : scr_str_new("IPv4", 4);
}
ScrStr *scr_os_ifaddrs_mac(const ScrIfaddrs *s, size_t i) {
  return scr_str_new(s->rows[i].mac, strlen(s->rows[i].mac));
}
bool scr_os_ifaddrs_internal(const ScrIfaddrs *s, size_t i) { return s->rows[i].internal; }
bool scr_os_ifaddrs_ipv6(const ScrIfaddrs *s, size_t i) { return s->rows[i].ipv6; }
/* +1 cidr string, or NULL for the null arm (split netmask). */
ScrStr *scr_os_ifaddrs_cidr(const ScrIfaddrs *s, size_t i) {
  if (!s->rows[i].has_cidr) return NULL;
  return scr_str_new(s->rows[i].cidr, strlen(s->rows[i].cidr));
}
double scr_os_ifaddrs_scopeid(const ScrIfaddrs *s, size_t i) { return s->rows[i].scopeid; }
void scr_os_ifaddrs_free(ScrIfaddrs *s) {
  free(s->rows);
  free(s);
}

/* The events-unit hooks (scr_events.c fills them at install; NULL in
 * event-free binaries and in the standalone runtime C tests). */
void (*scr_process_exit_hook)(double code) = NULL;
void (*scr_stdin_destroy_hook)(void) = NULL;

void scr_process_exit(double code) {
  /* Node runs 'exit' listeners on explicit process.exit() too — they run
   * HERE, synchronously, before the teardown-free exit below. The hook is
   * non-NULL only when the events unit is linked (scr_events.c). */
  scr_process_in_exit = true;
  if (scr_process_exit_hook != NULL) scr_process_exit_hook(code);
  /* _Exit skips atexit handlers on purpose: no further code runs (matching
   * Node), and the RC audit is meaningless mid-program (live values are
   * expected). scr_init's flush-at-exit is also skipped — flush here. */
  fflush(stdout);
#ifdef SCR_F64_CENSUS
  { extern void scr_f64_census_flush(void); scr_f64_census_flush(); }
#endif
  _Exit((int)code);
}

/* ── the process introspection statics ────────────────────────────────
 * process.uptime/cpuUsage/threadCpuUsage/resourceUsage/availableMemory/
 * constrainedMemory — plain reads of the process's own clocks and
 * counters in Node's units. uptime anchors at load time (a constructor-
 * attribute monotonic stamp — the binary's own start, which is what
 * "the current Node.js process" means for a compiled program). */
#ifdef _WIN32
static double scr_uptime_t0_ms;
/* QueryPerformanceCounter, not GetTickCount64.
 *
 * GetTickCount64 advances in whole SCHEDULER TICKS. Measured on this
 * host by spinning until the value changes, twenty times: the tick is
 * 15.65 ms (min 15, max 16), against 0.00048 ms for Node's
 * performance.now(). That is 32,600x coarser, and it is not merely a
 * benchmarking nuisance - it is a Node-parity divergence in its own
 * right: a compiled program could not observe ANY interval shorter than
 * ~16 ms, so performance.now() differences came back as exactly 0 for
 * work Node timed at 0.827 ms. Node's own clock is QPC, through libuv's
 * uv_hrtime, so this is the parity answer and not a local invention.
 *
 * The frequency is fixed for the life of the system, so it is probed
 * once and cached as ms-per-tick. Both API calls are checked and both
 * fall back to the old clock rather than returning a wrong number: on a
 * machine with no performance counter a coarse clock is still a clock.
 * The ANCHOR is deliberately left as it was (lazy, on first use) - only
 * the clock source changes here. */
static double scr_qpc_ms_per_tick;
static double scr_uptime_now_ms(void) {
  if (scr_qpc_ms_per_tick == 0.0) {
    LARGE_INTEGER freq;
    if (!QueryPerformanceFrequency(&freq) || freq.QuadPart <= 0) {
      return (double)GetTickCount64();
    }
    scr_qpc_ms_per_tick = 1000.0 / (double)freq.QuadPart;
  }
  LARGE_INTEGER now;
  if (!QueryPerformanceCounter(&now)) return (double)GetTickCount64();
  return (double)now.QuadPart * scr_qpc_ms_per_tick;
}
static void scr_uptime_anchor_init(void) { scr_uptime_t0_ms = scr_uptime_now_ms(); }
#else
#include <sys/resource.h>
#include <sys/time.h>
#ifdef __APPLE__
#include <mach/mach.h>
#endif
static double scr_uptime_t0_ms;
static double scr_uptime_now_ms(void) {
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return (double)ts.tv_sec * 1000.0 + (double)ts.tv_nsec / 1e6;
}
__attribute__((constructor)) static void scr_uptime_anchor_init(void) {
  scr_uptime_t0_ms = scr_uptime_now_ms();
}
#endif

double scr_process_uptime(void) {
#ifdef _WIN32
  if (scr_uptime_t0_ms == 0) scr_uptime_anchor_init();
#endif
  return (scr_uptime_now_ms() - scr_uptime_t0_ms) / 1000.0;
}

/* perf_hooks performance.now(): milliseconds since the process's own
 * start (Node's timeOrigin anchor), fractional — the same monotonic
 * clock and anchor as uptime, in Node's performance.now units. */
double scr_perf_now(void) {
#ifdef _WIN32
  if (scr_uptime_t0_ms == 0) scr_uptime_anchor_init();
#endif
  return scr_uptime_now_ms() - scr_uptime_t0_ms;
}

#ifdef _WIN32
/* GetProcessTimes/GetThreadTimes answer 100ns units; Node reports µs. */
static double scr_filetime_us(FILETIME ft) {
  ULARGE_INTEGER v;
  v.LowPart = ft.dwLowDateTime;
  v.HighPart = ft.dwHighDateTime;
  return (double)(v.QuadPart / 10);
}
double scr_cpu_user(void) {
  FILETIME c, e, k, u;
  if (!GetProcessTimes(GetCurrentProcess(), &c, &e, &k, &u)) return 0;
  return scr_filetime_us(u);
}
double scr_cpu_system(void) {
  FILETIME c, e, k, u;
  if (!GetProcessTimes(GetCurrentProcess(), &c, &e, &k, &u)) return 0;
  return scr_filetime_us(k);
}
double scr_thread_cpu_user(void) {
  FILETIME c, e, k, u;
  if (!GetThreadTimes(GetCurrentThread(), &c, &e, &k, &u)) return 0;
  return scr_filetime_us(u);
}
double scr_thread_cpu_system(void) {
  FILETIME c, e, k, u;
  if (!GetThreadTimes(GetCurrentThread(), &c, &e, &k, &u)) return 0;
  return scr_filetime_us(k);
}
#else
static double scr_tv_us(struct timeval tv) {
  return (double)tv.tv_sec * 1e6 + (double)tv.tv_usec;
}
double scr_cpu_user(void) {
  struct rusage ru;
  if (getrusage(RUSAGE_SELF, &ru) != 0) return 0;
  return scr_tv_us(ru.ru_utime);
}
double scr_cpu_system(void) {
  struct rusage ru;
  if (getrusage(RUSAGE_SELF, &ru) != 0) return 0;
  return scr_tv_us(ru.ru_stime);
}
#if defined(RUSAGE_THREAD)
double scr_thread_cpu_user(void) {
  struct rusage ru;
  if (getrusage(RUSAGE_THREAD, &ru) != 0) return 0;
  return scr_tv_us(ru.ru_utime);
}
double scr_thread_cpu_system(void) {
  struct rusage ru;
  if (getrusage(RUSAGE_THREAD, &ru) != 0) return 0;
  return scr_tv_us(ru.ru_stime);
}
#elif defined(__APPLE__)
double scr_thread_cpu_user(void) {
  thread_basic_info_data_t info;
  mach_msg_type_number_t count = THREAD_BASIC_INFO_COUNT;
  if (thread_info(mach_thread_self(), THREAD_BASIC_INFO, (thread_info_t)&info, &count) != KERN_SUCCESS) return 0;
  return (double)info.user_time.seconds * 1e6 + (double)info.user_time.microseconds;
}
double scr_thread_cpu_system(void) {
  thread_basic_info_data_t info;
  mach_msg_type_number_t count = THREAD_BASIC_INFO_COUNT;
  if (thread_info(mach_thread_self(), THREAD_BASIC_INFO, (thread_info_t)&info, &count) != KERN_SUCCESS) return 0;
  return (double)info.system_time.seconds * 1e6 + (double)info.system_time.microseconds;
}
#else
/* No per-thread clock on this platform: the process clocks stand in (a
 * single-threaded binary's thread IS the process). */
double scr_thread_cpu_user(void) { return scr_cpu_user(); }
double scr_thread_cpu_system(void) { return scr_cpu_system(); }
#endif
#endif

/* The prev-argument validation: Node checks prevValue.user then
 * prevValue.system and throws the ERR_INVALID_ARG_VALUE RangeError with
 * the received number, catchably. (The frontend guarantees numbers —
 * non-number shapes keep compile fences.) */
static void scr_cpu_prev_check_field(const char *name, double v) {
  if (v >= 0 && v <= 1.7976931348623157e308 && v == v) return; /* finite, non-negative */
  char num[32];
  size_t nlen = scr_f64_to_str(v, num);
  num[nlen] = 0;
  char msg[128];
  int len = snprintf(msg, sizeof msg, "The property 'prevValue.%s' is invalid. Received %s", name, num);
  scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)len, "ERR_INVALID_ARG_VALUE");
}

void scr_cpu_prev_validate(double user, double system) {
  scr_cpu_prev_check_field("user", user);
  if (scr_exc_pending()) return;
  scr_cpu_prev_check_field("system", system);
}

double scr_cpu_user_diff(double prev) { return scr_cpu_user() - prev; }
double scr_cpu_system_diff(double prev) { return scr_cpu_system() - prev; }
double scr_thread_cpu_user_diff(double prev) { return scr_thread_cpu_user() - prev; }
double scr_thread_cpu_system_diff(double prev) { return scr_thread_cpu_system() - prev; }

/* process.resourceUsage(): one field by canonical index — Node's names,
 * order, and units (CPU times in µs; maxRSS in kilobytes — uv divides
 * Darwin's bytes by 1024; the rest are getrusage's own counters, zero
 * where the platform never fills them). */
#ifdef _WIN32
/* PROCESS_MEMORY_COUNTERS / IO_COUNTERS, declared locally with private
 * names so this needs neither <psapi.h> nor a new -l on the link line the
 * C backend emits: both producers are kernel32.dll exports
 * (K32GetProcessMemoryInfo since Windows 7, GetProcessIoCounters since
 * XP) resolved through GetProcAddress. A resolution failure answers 0,
 * which is exactly what this code did for every one of these fields
 * before, so the worst case is the old behaviour rather than a crash.
 * Both layouts are the documented, stable ones. */
typedef struct {
  DWORD cb;
  DWORD PageFaultCount;
  SIZE_T PeakWorkingSetSize;
  SIZE_T WorkingSetSize;
  SIZE_T QuotaPeakPagedPoolUsage;
  SIZE_T QuotaPagedPoolUsage;
  SIZE_T QuotaPeakNonPagedPoolUsage;
  SIZE_T QuotaNonPagedPoolUsage;
  SIZE_T PagefileUsage;
  SIZE_T PeakPagefileUsage;
} ScrWinProcMem;

typedef struct {
  ULONGLONG ReadOperationCount;
  ULONGLONG WriteOperationCount;
  ULONGLONG OtherOperationCount;
  ULONGLONG ReadTransferCount;
  ULONGLONG WriteTransferCount;
  ULONGLONG OtherTransferCount;
} ScrWinIoCounters;

typedef BOOL(WINAPI *ScrGetProcMemFn)(HANDLE, ScrWinProcMem *, DWORD);
typedef BOOL(WINAPI *ScrGetProcIoFn)(HANDLE, ScrWinIoCounters *);

static bool scr_win_proc_mem(ScrWinProcMem *out) {
  static ScrGetProcMemFn fn = NULL;
  static bool tried = false;
  if (!tried) {
    tried = true;
    HMODULE k32 = GetModuleHandleW(L"kernel32.dll");
    if (k32 != NULL) {
      fn = (ScrGetProcMemFn)(void *)GetProcAddress(k32, "K32GetProcessMemoryInfo");
    }
  }
  if (fn == NULL) return false;
  memset(out, 0, sizeof *out);
  out->cb = (DWORD)sizeof *out;
  return fn(GetCurrentProcess(), out, (DWORD)sizeof *out) != 0;
}

static bool scr_win_proc_io(ScrWinIoCounters *out) {
  static ScrGetProcIoFn fn = NULL;
  static bool tried = false;
  if (!tried) {
    tried = true;
    HMODULE k32 = GetModuleHandleW(L"kernel32.dll");
    if (k32 != NULL) {
      fn = (ScrGetProcIoFn)(void *)GetProcAddress(k32, "GetProcessIoCounters");
    }
  }
  if (fn == NULL) return false;
  memset(out, 0, sizeof *out);
  return fn(GetCurrentProcess(), out) != 0;
}
#endif

double scr_process_rusage(double idx) {
#ifdef _WIN32
  /* uv_getrusage's Windows arm fills five rows besides the CPU times —
   * maxRSS from PeakWorkingSetSize (kilobytes, uv's own division),
   * majorPageFault from PageFaultCount, and fsRead/fsWrite from the IO
   * counters. Everything else is genuinely 0 there, Node's own shape.
   *
   * These rows used to answer 0 unconditionally, which made
   * `process.resourceUsage().maxRSS > 0` — true under Node on this very
   * box — read false. */
  switch ((int)idx) {
    case 0: return scr_cpu_user();
    case 1: return scr_cpu_system();
    case 2: { /* maxRSS (kilobytes) */
      ScrWinProcMem m;
      if (!scr_win_proc_mem(&m)) return 0;
      return (double)((unsigned long long)m.PeakWorkingSetSize / 1024ULL);
    }
    case 7: { /* majorPageFault */
      ScrWinProcMem m;
      if (!scr_win_proc_mem(&m)) return 0;
      return (double)m.PageFaultCount;
    }
    case 9: { /* fsRead */
      ScrWinIoCounters io;
      if (!scr_win_proc_io(&io)) return 0;
      return (double)io.ReadOperationCount;
    }
    case 10: { /* fsWrite */
      ScrWinIoCounters io;
      if (!scr_win_proc_io(&io)) return 0;
      return (double)io.WriteOperationCount;
    }
    default: return 0;
  }
#else
  struct rusage ru;
  if (getrusage(RUSAGE_SELF, &ru) != 0) return 0;
  switch ((int)idx) {
    case 0: return scr_tv_us(ru.ru_utime);      /* userCPUTime */
    case 1: return scr_tv_us(ru.ru_stime);      /* systemCPUTime */
    case 2:                                     /* maxRSS (kilobytes) */
#ifdef __APPLE__
      return (double)(ru.ru_maxrss / 1024);
#else
      return (double)ru.ru_maxrss;
#endif
    case 3: return (double)ru.ru_ixrss;         /* sharedMemorySize */
    case 4: return (double)ru.ru_idrss;         /* unsharedDataSize */
    case 5: return (double)ru.ru_isrss;         /* unsharedStackSize */
    case 6: return (double)ru.ru_minflt;        /* minorPageFault */
    case 7: return (double)ru.ru_majflt;        /* majorPageFault */
    case 8: return (double)ru.ru_nswap;         /* swappedOut */
    case 9: return (double)ru.ru_inblock;       /* fsRead */
    case 10: return (double)ru.ru_oublock;      /* fsWrite */
    case 11: return (double)ru.ru_msgsnd;       /* ipcSent */
    case 12: return (double)ru.ru_msgrcv;       /* ipcReceived */
    case 13: return (double)ru.ru_nsignals;     /* signalsCount */
    case 14: return (double)ru.ru_nvcsw;        /* voluntaryContextSwitches */
    case 15: return (double)ru.ru_nivcsw;       /* involuntaryContextSwitches */
    default: return 0;
  }
#endif
}

/* process.memoryUsage.rss() — the RESIDENT SET, in bytes, from the same
 * place libuv's uv_resident_set_memory reads it on each platform, which
 * is where Node's own number comes from:
 *
 *   Windows  GetProcessMemoryInfo -> WorkingSetSize
 *   Linux    /proc/self/statm field 2 (resident pages) x page size
 *   macOS    task_info(MACH_TASK_BASIC_INFO).resident_size
 *
 * This is the ONE field of Node's memoryUsage() record a binary with no
 * JavaScript heap can answer honestly, which is why the single-value form
 * lowers and the record form is refused by name (lower-builtins.ts): rss
 * is an operating-system fact about a process, and heapTotal/heapUsed/
 * external/arrayBuffers are V8 heap statistics with nothing behind them
 * here. Naming them 0 would read as "this program allocates nothing"
 * rather than "there is no V8 heap to report", and `heapUsed > 0` — true
 * under Node on any host — would come back false.
 *
 * Unmeasurable rather than zero is not an option the API has, so a
 * platform that cannot answer returns 0, the same stance the maxRSS row
 * of scr_process_rusage takes. */
double scr_process_rss(void) {
#ifdef _WIN32
  ScrWinProcMem m;
  if (!scr_win_proc_mem(&m)) return 0;
  return (double)(unsigned long long)m.WorkingSetSize;
#elif defined(__linux__)
  FILE *f = fopen("/proc/self/statm", "r");
  if (f == NULL) return 0;
  unsigned long long total = 0, resident = 0;
  int got = fscanf(f, "%llu %llu", &total, &resident);
  fclose(f);
  if (got != 2) return 0;
  long page = sysconf(_SC_PAGESIZE);
  if (page <= 0) return 0;
  return (double)resident * (double)page;
#elif defined(__APPLE__)
  mach_task_basic_info_data_t info;
  mach_msg_type_number_t count = MACH_TASK_BASIC_INFO_COUNT;
  if (task_info(mach_task_self(), MACH_TASK_BASIC_INFO, (task_info_t)&info, &count) != KERN_SUCCESS) {
    return 0;
  }
  return (double)info.resident_size;
#else
  return 0;
#endif
}

/* process.availableMemory()/constrainedMemory() — libuv's numbers: the
 * constrained form answers the cgroup cap where one exists (Linux) and 0
 * everywhere else; available is the free-ish byte count. */
double scr_constrained_memory(void) {
#if defined(__linux__)
  FILE *f = fopen("/sys/fs/cgroup/memory.max", "r"); /* cgroup v2 */
  if (f == NULL) f = fopen("/sys/fs/cgroup/memory/memory.limit_in_bytes", "r"); /* v1 */
  if (f == NULL) return 0;
  char buf[64];
  size_t n = fread(buf, 1, sizeof buf - 1, f);
  fclose(f);
  buf[n] = 0;
  if (n == 0 || buf[0] == 'm') return 0; /* "max" = unconstrained */
  double v = strtod(buf, NULL);
  return v > 0 ? v : 0;
#else
  return 0;
#endif
}

double scr_available_memory(void) {
#if defined(_WIN32)
  MEMORYSTATUSEX ms;
  memset(&ms, 0, sizeof ms);
  ms.dwLength = sizeof ms;
  if (!GlobalMemoryStatusEx(&ms)) return 0;
  return (double)ms.ullAvailPhys;
#elif defined(__APPLE__)
  /* uv_get_available_memory falls back to the free-memory number on
   * Darwin (vm_statistics' free pages). */
  vm_statistics64_data_t vm;
  mach_msg_type_number_t count = HOST_VM_INFO64_COUNT;
  if (host_statistics64(mach_host_self(), HOST_VM_INFO64, (host_info64_t)&vm, &count) != KERN_SUCCESS) return 0;
  return (double)vm.free_count * (double)vm_page_size;
#elif defined(__linux__)
  /* /proc/meminfo's MemAvailable — the kernel's own availability estimate
   * (what uv reads via sysinfo lacks reclaimable cache). */
  FILE *f = fopen("/proc/meminfo", "r");
  if (f == NULL) return 0;
  char line[128];
  double kb = 0;
  while (fgets(line, sizeof line, f) != NULL) {
    if (sscanf(line, "MemAvailable: %lf kB", &kb) == 1) break;
  }
  fclose(f);
  return kb * 1024.0;
#else
  return 0;
#endif
}

/* process._exiting — true once the exit sequence began (set above and by
 * scr_run_exit_listeners in scr_events.c; the flag lives HERE so reading
 * it never forces the events unit into the link). */
bool scr_process_in_exit = false;

bool scr_process_exiting(void) { return scr_process_in_exit; }

/* umask(2): mask < 0 reads without setting (set 0, restore — umask has no
 * read-only form); otherwise sets and answers the previous mask. */
double scr_process_umask(double mask) {
#ifdef _WIN32
  /* Node on Windows accepts umask() calls; only the low bits matter. */
  int prev;
  if (mask < 0) {
    _umask_s(0, &prev);
    int ignored;
    _umask_s(prev, &ignored);
  } else {
    _umask_s((int)mask, &prev);
  }
  return (double)prev;
#else
  mode_t prev;
  if (mask < 0) {
    prev = umask(0);
    umask(prev);
  } else {
    prev = umask((mode_t)mask);
  }
  return (double)prev;
#endif
}

void scr_process_chdir(ScrStr *dir) {
#ifdef _WIN32
  if (_chdir(dir->data) != 0) scr_fs_throw(errno, "chdir", dir);
#else
  if (chdir(dir->data) != 0) scr_fs_throw(errno, "chdir", dir);
#endif
}

/* net's process-wide happy-eyeballs attempt budget (Node's
 * getDefaultAutoSelectFamilyAttemptTimeout pair). Lives in the core unit
 * so the knob never forces scr_net.c into the link; scr_net.c reads it
 * back at every dial, the way Node reads autoSelectFamilyAttemptTimeout-
 * Default when connect() builds its attempt context.
 *
 * 500, MEASURED on v25.9.0 — `node -p
 * "net.getDefaultAutoSelectFamilyAttemptTimeout()"` answers 500. The 250
 * this held is the value the flag shipped with in v20 and is no longer
 * Node's; the getter surfaces the number, so the stale default was a
 * wrong value on a path that compiles clean. */
static double scr_net_autosel_timeout_ms = 500;

double scr_net_get_autosel_timeout(void) { return scr_net_autosel_timeout_ms; }

/* Node's setDefaultAutoSelectFamilyAttemptTimeout: validateInt32(value,
 * 'value', 1), then the sub-10ms floor (Node clamps small budgets to
 * 10ms). Throws ERR_OUT_OF_RANGE catchably. */
void scr_net_set_autosel_timeout(double ms) {
  char recv[48], msg[160];
  if (!(isfinite(ms) && trunc(ms) == ms)) {
    scr_num_received(ms, recv);
    int len = snprintf(msg, sizeof msg,
                       "The value of \"value\" is out of range. It must be an integer. Received %s", recv);
    scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)len, "ERR_OUT_OF_RANGE");
    return;
  }
  if (ms < 1 || ms > 2147483647.0) {
    scr_num_received(ms, recv);
    int len = snprintf(msg, sizeof msg,
                       "The value of \"value\" is out of range. It must be >= 1 && <= 2147483647. Received %s", recv);
    scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)len, "ERR_OUT_OF_RANGE");
    return;
  }
  scr_net_autosel_timeout_ms = ms < 10 ? 10 : ms;
}

/* ── fs error formatting ─────────────────────────────────────────────
 * Node's fs errors read "<ERRNO>: <text>, <syscall> '<path>'"
 * ("ENOENT: no such file or directory, open 'x'"). The common errnos get
 * Node's (libuv's) exact lowercase text; anything exotic falls back to
 * "E<num>: <strerror>, <op> '<path>'" — close enough, and the corpus can
 * only observe messages through the runtime C tests anyway (the supported
 * catch form is bindingless).
 */

/* The three fs-error pieces are EXPORTED (scr_runtime.h) rather than
 * static: scr_stream.c's fs-backed streams need this exact message and
 * code as a VALUE (a failure is an 'error' EVENT, never a throw), and a
 * second copy of these tables is how two spellings of one errno drift
 * apart. The tables stay here, beside the throw that has always used
 * them; only the assembly lives in the link-gated unit. */
const char *scr_errno_name(int e, char *fallback, size_t cap) {
  switch (e) {
  case ENOENT: return "ENOENT";
  case EEXIST: return "EEXIST";
  case EACCES: return "EACCES";
  case ENOTDIR: return "ENOTDIR";
  case EISDIR: return "EISDIR";
  case ENOTEMPTY: return "ENOTEMPTY";
  case EPERM: return "EPERM";
  case EBADF: return "EBADF";
  default:
    snprintf(fallback, cap, "E%d", e);
    return fallback;
  }
}

const char *scr_errno_text(int e) {
  switch (e) {
  case ENOENT: return "no such file or directory";
  case EEXIST: return "file already exists";
  case EACCES: return "permission denied";
  case ENOTDIR: return "not a directory";
  case EISDIR: return "illegal operation on a directory";
  case ENOTEMPTY: return "directory not empty";
  case EPERM: return "operation not permitted";
  case EBADF: return "bad file descriptor";
  default: return strerror(e);
  }
}

/* Node on WINDOWS reports fs error paths ABSOLUTIZED and backslashed
 * (its fs binding hands the Windows API namespaced absolute paths and the
 * error keeps that spelling): open("no.bin") fails with "... open
 * 'C:\cwd\no.bin'". _fullpath reproduces exactly that resolution. POSIX
 * Node reports the path as given — the passthrough arm. */
#ifdef _WIN32
const char *scr_fs_err_path(const ScrStr *path, char buf[PATH_MAX]) {
  return _fullpath(buf, path->data, PATH_MAX) != NULL ? buf : path->data;
}
#else
const char *scr_fs_err_path(const ScrStr *path, char buf[PATH_MAX]) {
  (void)buf;
  return path->data;
}
#endif

/* Exported (scr_runtime.h): scr_bytes.c's fs Buffer forms share it. */
void scr_fs_throw(int e, const char *op, const ScrStr *path) {
#ifdef _WIN32
  /* The CRT lands ERROR_ACCESS_DENIED in errno as EACCES; libuv's
   * uv_translate_sys_error maps the same Win32 error to EPERM, so that
   * is the code Node throws (a read-only file's write open, chmod on a
   * held file). Translate at the throw seam so every fs op agrees with
   * the Windows oracle. */
  if (e == EACCES) e = EPERM;
#endif
  char namebuf[16];
  const char *name = scr_errno_name(e, namebuf, sizeof namebuf);
  const char *text = scr_errno_text(e);
  char pathbuf[PATH_MAX];
  const char *shown = scr_fs_err_path(path, pathbuf);
  size_t cap = strlen(name) + strlen(text) + strlen(op) + strlen(shown) + 8;
  char *msg = malloc(cap);
  if (!msg) {
    scr_trap("scriptc: out of memory\n");
  }
  int len = snprintf(msg, cap, "%s: %s, %s '%s'", name, text, op, shown);
  /* A real Error instance (name "Error", message = Node's text) — what a
   * typed catch's `e instanceof Error` + `e.message` observes in Node —
   * with `code` stamped to the errno name (the exotic-errno fallback
   * stamps its "E<num>" spelling; Node would carry the uv name there).
   * errno/syscall/path stay unrepresented (SEMANTICS.md divergence 13). */
  scr_throw_error_msg_code(SCR_ERR_ERROR, msg, (size_t)len, name);
  free(msg);
}

/* ── fs operations ───────────────────────────────────────────────────── */

ScrStr *scr_fs_read_file(ScrStr *path) {
  FILE *f = fopen(path->data, "rb");
  if (!f) {
    scr_fs_throw(errno, "open", path);
    return NULL;
  }
  size_t cap = 4096, len = 0;
  char *buf = malloc(cap);
  if (!buf) {
    scr_trap("scriptc: out of memory\n");
  }
  for (;;) {
    if (cap - len < 2048) {
      cap *= 2;
      char *grown = realloc(buf, cap);
      if (!grown) {
        scr_trap("scriptc: out of memory\n");
      }
      buf = grown;
    }
    size_t n = fread(buf + len, 1, cap - len, f);
    len += n;
    if (n == 0) break;
  }
  if (ferror(f)) {
    int e = errno;
    fclose(f);
    free(buf);
    scr_fs_throw(e, "read", path);
    return NULL;
  }
  fclose(f);
  ScrStr *s = scr_str_new(buf, len);
  free(buf);
  return s;
}

ScrStr *scr_fs_realpath(ScrStr *path) {
#ifdef _WIN32
  /* _fullpath resolves . / .. and drive-relative forms (symlink-free —
   * the honest Windows approximation); a missing path throws Node's
   * lstat-spelled ENOENT like the POSIX arm. */
  char buf[PATH_MAX];
  if (_fullpath(buf, path->data, sizeof buf) == NULL) {
    scr_fs_throw(errno ? errno : ENOENT, "lstat", path);
    return NULL;
  }
  if (GetFileAttributesA(buf) == INVALID_FILE_ATTRIBUTES) {
    scr_fs_throw(ENOENT, "lstat", path);
    return NULL;
  }
  return scr_str_new(buf, strlen(buf));
#else
  /* realpath(3); Node's realpathSync reports failures with the "lstat"
   * syscall in the message ("ENOENT: no such file or directory, lstat
   * 'x'") — its own resolution walks lstat by component. */
  char buf[PATH_MAX];
  if (realpath(path->data, buf) == NULL) {
    scr_fs_throw(errno, "lstat", path);
    return NULL;
  }
  return scr_str_new(buf, strlen(buf));
#endif
}

static void scr_fs_write_common(ScrStr *path, ScrStr *data, const char *mode) {
  FILE *f = fopen(path->data, mode);
  if (!f) {
    scr_fs_throw(errno, "open", path);
    return;
  }
  if (data->len > 0 && fwrite(data->data, 1, data->len, f) != data->len) {
    int e = errno;
    fclose(f);
    scr_fs_throw(e, "write", path);
    return;
  }
  if (fclose(f) != 0) scr_fs_throw(errno, "close", path);
}

void scr_fs_write_file(ScrStr *path, ScrStr *data) {
  scr_fs_write_common(path, data, "wb");
}

/* writeFileSync(p, data, { mode }): the mode is open(2)'s O_CREAT
 * argument — it applies at CREATION only (umask applying), and an
 * existing file keeps its permissions, exactly Node (which never chmods
 * here). Same error shapes as the plain form. */
void scr_fs_write_file_mode(ScrStr *path, ScrStr *data, double mode) {
  /* O_BINARY: zero on POSIX; on Windows it keeps the CRT from translating
   * \n in these byte-exact writes (fopen's "wb" path already does). */
  int fd = open(path->data, O_WRONLY | O_CREAT | O_TRUNC | O_BINARY, (mode_t)mode);
  if (fd < 0) {
    scr_fs_throw(errno, "open", path);
    return;
  }
  size_t at = 0;
  while (at < data->len) {
    ssize_t wrote = write(fd, data->data + at, data->len - at);
    if (wrote < 0) {
      if (errno == EINTR) continue;
      int e = errno;
      close(fd);
      scr_fs_throw(e, "write", path);
      return;
    }
    at += (size_t)wrote;
  }
  if (close(fd) != 0) scr_fs_throw(errno, "close", path);
}

void scr_fs_append_file(ScrStr *path, ScrStr *data) {
  scr_fs_write_common(path, data, "ab");
}

bool scr_fs_exists(ScrStr *path) {
  /* Like Node's existsSync: any failure (missing, EACCES on a parent, ...)
   * is simply false — never a throw. */
  return access(path->data, F_OK) == 0;
}

void scr_fs_mkdir(ScrStr *path) {
  if (scr_sys_mkdir(path->data, 0777) != 0) scr_fs_throw(errno, "mkdir", path);
}

/* mkdirSync(p, { mode }) non-recursive: mkdir(2) with the explicit mode
 * (umask applies, exactly as in Node — mode is the syscall argument;
 * Windows has no directory modes and drops it, like Node there). */
void scr_fs_mkdir_mode(ScrStr *path, double mode) {
  if (scr_sys_mkdir(path->data, (mode_t)mode) != 0) scr_fs_throw(errno, "mkdir", path);
}

void scr_fs_unlink(ScrStr *path) {
  if (unlink(path->data) != 0) scr_fs_throw(errno, "unlink", path);
}

void scr_fs_chmod(ScrStr *path, double mode) {
  if (chmod(path->data, (mode_t)mode) != 0) scr_fs_throw(errno, "chmod", path);
}

void scr_fs_chown(ScrStr *path, double uid, double gid) {
#ifdef _WIN32
  /* libuv's uv_fs_chown on Windows is an unconditional no-op success —
   * Node's chownSync "works" and changes nothing there; same here. */
  (void)path; (void)uid; (void)gid;
#else
  /* Node passes the ids straight to chown(2); -1 is the POSIX "leave
   * unchanged" value and rides the same int cast. */
  if (chown(path->data, (uid_t)(int64_t)uid, (gid_t)(int64_t)gid) != 0) {
    scr_fs_throw(errno, "chown", path);
  }
#endif
}

/* fs.openSync(path, flags) → the raw fd (as f64) — the pair behind
 * spawn's fd-stdio form (openSync → stdio: ["ignore", fd, fd] →
 * closeSync). flags is Node's string grammar; an unknown flag throws
 * Node's ERR_INVALID_ARG_VALUE TypeError text, an open(2) failure the
 * usual Node-shaped fs error. Mode is Node's 0666 default (the numeric
 * third argument is a compile fence). */
double scr_fs_open(ScrStr *path, ScrStr *flags) {
  const char *f = flags->data;
  int of;
  if (strcmp(f, "r") == 0) of = O_RDONLY;
  else if (strcmp(f, "rs") == 0 || strcmp(f, "sr") == 0) of = O_RDONLY | O_SYNC;
  else if (strcmp(f, "r+") == 0) of = O_RDWR;
  else if (strcmp(f, "rs+") == 0 || strcmp(f, "sr+") == 0) of = O_RDWR | O_SYNC;
  else if (strcmp(f, "w") == 0) of = O_TRUNC | O_CREAT | O_WRONLY;
  else if (strcmp(f, "wx") == 0 || strcmp(f, "xw") == 0) of = O_TRUNC | O_CREAT | O_WRONLY | O_EXCL;
  else if (strcmp(f, "w+") == 0) of = O_TRUNC | O_CREAT | O_RDWR;
  else if (strcmp(f, "wx+") == 0 || strcmp(f, "xw+") == 0) of = O_TRUNC | O_CREAT | O_RDWR | O_EXCL;
  else if (strcmp(f, "a") == 0) of = O_APPEND | O_CREAT | O_WRONLY;
  else if (strcmp(f, "ax") == 0 || strcmp(f, "xa") == 0) of = O_APPEND | O_CREAT | O_WRONLY | O_EXCL;
  else if (strcmp(f, "as") == 0 || strcmp(f, "sa") == 0) of = O_APPEND | O_CREAT | O_WRONLY | O_SYNC;
  else if (strcmp(f, "a+") == 0) of = O_APPEND | O_CREAT | O_RDWR;
  else if (strcmp(f, "ax+") == 0 || strcmp(f, "xa+") == 0) of = O_APPEND | O_CREAT | O_RDWR | O_EXCL;
  else if (strcmp(f, "as+") == 0 || strcmp(f, "sa+") == 0) of = O_APPEND | O_CREAT | O_RDWR | O_SYNC;
  else {
    char msg[128];
    int len = snprintf(msg, sizeof msg, "The argument 'flags' is invalid. Received '%s'", f);
    /* Node stamps ERR_INVALID_ARG_VALUE here; without the code a caller
     * switching on err.code sees undefined and falls through its own
     * error handling -- the message alone is not the contract. */
    scr_throw_error_msg_code(SCR_ERR_TYPE, msg, (size_t)len, "ERR_INVALID_ARG_VALUE");
    return 0;
  }
  int fd = open(path->data, of | O_BINARY, 0666);
  if (fd < 0) {
    scr_fs_throw(errno, "open", path);
    return 0;
  }
  return (double)fd;
}

/* fs.closeSync(fd) — close(2); failure throws Node's path-less fs error
 * shape ("EBADF: bad file descriptor, close"). */
/* fs.readSync(fd, buffer, offset, length) — the 4-argument buffer form.
 * Node validates offset/length against the buffer before reading and
 * throws ERR_OUT_OF_RANGE; here the checks clamp to the same contract and
 * throw the RangeError shape. Returns the byte count read(2) reports;
 * errors carry the errno name like the other fd operations. */
/* Node's validateOffsetLengthRead. Answers false with a PENDING exception
 * on a bad window; on true *off and *want are both in range. ONE copy of
 * the rule -- fs.readSync and filehandle.read both come through here, so
 * the two spellings of Node's texts cannot drift apart. */
static bool scr_fs_read_bounds(ScrBytes *buf, double offset, double length,
                               size_t *off, size_t *want) {
  size_t bytelen = buf->len; /* u8 buffers: elem count == byte count */
  char msg[160];
  int mlen;
  /* Node's validateOffsetLengthRead, MEASURED rather than remembered (the
   * oracle is in the FileHandle block report): the OFFSET is bounded by
   * MAX_SAFE_INTEGER, NOT by the buffer; the LENGTH is truncated toward
   * zero, must be >= 0, and is bounded by `bufferLength - offset`, which
   * for an offset past the end is NEGATIVE and printed as such ("It must
   * be <= -5"). The previous shape rejected offset > bytelen with the
   * OFFSET message where Node reports the length one -- a loud but wrong
   * diagnostic. One copy of the rule, shared by fs.readSync and
   * filehandle.read. */
  char numbuf[40];
  char availbuf[40];
  if (offset < 0 || offset > 9007199254740991.0) {
    numbuf[scr_f64_to_str(offset, numbuf)] = 0;
    mlen = snprintf(msg, sizeof msg,
                    "The value of \"offset\" is out of range. It must be >= 0 && <= 9007199254740991. Received %s",
                    numbuf);
    scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)mlen, "ERR_OUT_OF_RANGE");
    return 0;
  }
  double len_i = trunc(length); /* Node coerces before the >= 0 test: -0.5 is 0 */
  if (len_i < 0) {
    numbuf[scr_f64_to_str(length, numbuf)] = 0;
    mlen = snprintf(msg, sizeof msg,
                    "The value of \"length\" is out of range. It must be >= 0. Received %s",
                    numbuf);
    scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)mlen, "ERR_OUT_OF_RANGE");
    return 0;
  }
  double avail = (double)bytelen - offset;
  if (len_i > avail) {
    numbuf[scr_f64_to_str(length, numbuf)] = 0;
    availbuf[scr_f64_to_str(avail, availbuf)] = 0;
    mlen = snprintf(msg, sizeof msg,
                    "The value of \"length\" is out of range. It must be <= %s. Received %s",
                    availbuf, numbuf);
    scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)mlen, "ERR_OUT_OF_RANGE");
    return 0;
  }
  /* Past both checks: 0 <= offset <= bytelen and 0 <= len_i <= bytelen -
   * offset, so pointer and count are both in range (offset == bytelen
   * with length 0 is the legal one-past-the-end no-op). */
  *off = (size_t)offset;
  *want = (size_t)len_i;
  return true;
}

double scr_fs_read_sync(double fd, ScrBytes *buf, double offset, double length) {
  size_t off, want;
  if (!scr_fs_read_bounds(buf, offset, length, &off, &want)) return 0;
  ssize_t n = read((int)fd, buf->data + off, want);
  if (n < 0) {
    int e = errno;
    char namebuf[16];
    const char *name = scr_errno_name(e, namebuf, sizeof namebuf);
    const char *text = scr_errno_text(e);
    char msg[160];
    int len = snprintf(msg, sizeof msg, "%s: %s, read", name, text);
    scr_throw_error_msg_code(SCR_ERR_ERROR, msg, (size_t)len, name);
    return 0;
  }
  return (double)n;
}

void scr_fs_close(double fd) {
  if (close((int)fd) != 0) {
    int e = errno;
    char namebuf[16];
    const char *name = scr_errno_name(e, namebuf, sizeof namebuf);
    const char *text = scr_errno_text(e);
    char msg[160];
    int len = snprintf(msg, sizeof msg, "%s: %s, close", name, text);
    scr_throw_error_msg_code(SCR_ERR_ERROR, msg, (size_t)len, name);
  }
}

/* The two-path fs error shape — Node's copyfile errors quote both ends:
 * "ENOENT: no such file or directory, copyfile 'src' -> 'dest'". */
static void scr_fs_throw2(int e, const char *op, const ScrStr *src, const ScrStr *dest) {
  char namebuf[16];
  const char *name = scr_errno_name(e, namebuf, sizeof namebuf);
  const char *text = scr_errno_text(e);
  char srcbuf[PATH_MAX], destbuf[PATH_MAX];
  const char *shown_src = scr_fs_err_path(src, srcbuf);
  const char *shown_dest = scr_fs_err_path(dest, destbuf);
  size_t cap = strlen(name) + strlen(text) + strlen(op) + strlen(shown_src) + strlen(shown_dest) + 16;
  char *msg = malloc(cap);
  if (!msg) {
    scr_trap("scriptc: out of memory\n");
  }
  int len = snprintf(msg, cap, "%s: %s, %s '%s' -> '%s'", name, text, op, shown_src, shown_dest);
  scr_throw_error_msg_code(SCR_ERR_ERROR, msg, (size_t)len, name);
  free(msg);
}

/* copyFileSync(src, dest): contents copied into a created-or-truncated
 * destination carrying the SOURCE's permission bits — libuv's
 * uv_fs_copyfile behavior behind Node's copyFileSync (umask applies at
 * creation, like any open(2)). Every failure throws catchably with the
 * two-path message and the syscall name Node reports ("copyfile"). */
void scr_fs_copyfile(ScrStr *src, ScrStr *dest) {
  int in = open(src->data, O_RDONLY | O_BINARY);
  if (in < 0) {
    scr_fs_throw2(errno, "copyfile", src, dest);
    return;
  }
  struct stat st;
  if (fstat(in, &st) != 0) {
    int e = errno;
    close(in);
    scr_fs_throw2(e, "copyfile", src, dest);
    return;
  }
  int out = open(dest->data, O_WRONLY | O_CREAT | O_TRUNC | O_BINARY, st.st_mode & 07777);
  if (out < 0) {
    int e = errno;
    close(in);
    scr_fs_throw2(e, "copyfile", src, dest);
    return;
  }
  char buf[65536];
  for (;;) {
    ssize_t got = read(in, buf, sizeof buf);
    if (got < 0) {
      if (errno == EINTR) continue;
      int e = errno;
      close(in);
      close(out);
      scr_fs_throw2(e, "copyfile", src, dest);
      return;
    }
    if (got == 0) break;
    ssize_t at = 0;
    while (at < got) {
      ssize_t wrote = write(out, buf + at, (size_t)(got - at));
      if (wrote < 0) {
        if (errno == EINTR) continue;
        int e = errno;
        close(in);
        close(out);
        scr_fs_throw2(e, "copyfile", src, dest);
        return;
      }
      at += wrote;
    }
  }
  close(in);
  if (close(out) != 0) scr_fs_throw2(errno, "copyfile", src, dest);
}

/* renameSync(old, new): rename(2), Node's two-path error shape ("ENOENT:
 * no such file or directory, rename 'a' -> 'b'"). */
void scr_fs_rename(ScrStr *oldpath, ScrStr *newpath) {
  if (rename(oldpath->data, newpath->data) != 0) {
    scr_fs_throw2(errno, "rename", oldpath, newpath);
  }
}

void scr_fs_rm(ScrStr *path) {
  /* Node's rmSync: lstat first (a missing path reports the lstat syscall),
   * refuse directories (Node requires `recursive`, which the scriptc
   * surface doesn't declare — the message wording diverges from Node's
   * ERR_FS_EISDIR, see SEMANTICS.md), then unlink. */
  struct stat st;
  if (lstat(path->data, &st) != 0) {
    scr_fs_throw(errno, "lstat", path);
    return;
  }
  if (S_ISDIR(st.st_mode)) {
    scr_fs_throw(EISDIR, "rm", path);
    return;
  }
  if (unlink(path->data) != 0) scr_fs_throw(errno, "unlink", path);
}

void scr_fs_rmdir(ScrStr *path) {
  if (rmdir(path->data) != 0) scr_fs_throw(errno, "rmdir", path);
}

/* ── fs option forms ─────────────────────────────────────────────────
 * mkdirSync(p, { recursive: true }), rmSync(p, { recursive, force }),
 * mkdtempSync(prefix), accessSync(p, mode), and the readFileSync(fd)
 * forms — the slice real CLIs use. All throw catchably like the rest of
 * sync fs, with Node's errno/path shapes (verified against Node). */

/* Node's recursive mkdir algorithm: try mkdir; EEXIST is fine iff the
 * path is a directory (a file target throws EEXIST at that path); ENOENT
 * creates the parent first and retries. ENOTDIR past a file reports the
 * FULL requested path, like Node. `path` is a NUL-terminated mutable
 * buffer of `len` bytes. */
/* The path separators the RECURSIVE walk recognizes: win32 targets take
 * both slashes (the path module hands out backslashed paths there);
 * POSIX '/' only — a backslash is an ordinary filename byte. */
static bool scr_fs_sep(char c) {
#ifdef _WIN32
  if (c == '\\') return true;
#endif
  return c == '/';
}

static void scr_mkdir_rec(char *path, size_t len, mode_t mode) {
  if (scr_sys_mkdir(path, mode) == 0) return;
  int e = errno;
  struct stat st;
  if (e == EEXIST) {
    if (stat(path, &st) == 0 && S_ISDIR(st.st_mode)) return;
  } else if (e == ENOENT) {
    /* Parent: trim trailing separators, the last component, then the
     * separator run before it (keep "/" itself). */
    size_t i = len;
    while (i > 0 && scr_fs_sep(path[i - 1])) i--;
    while (i > 0 && !scr_fs_sep(path[i - 1])) i--;
    while (i > 1 && scr_fs_sep(path[i - 1])) i--;
    if (i > 0 && i < len) {
      char saved = path[i];
      path[i] = 0;
#ifdef _WIN32
      /* POSIX mkdir answers ENOTDIR itself when a path component is a
       * FILE; the CRT answers ENOENT for that too. Node on Windows still
       * reports ENOTDIR with the full requested path — recover the
       * distinction from the parent's stat before recursing. */
      if (stat(path, &st) == 0 && !S_ISDIR(st.st_mode)) {
        path[i] = saved;
        ScrStr *full = scr_str_new(path, len);
        scr_fs_throw(ENOTDIR, "mkdir", full);
        scr_str_release(full);
        return;
      }
#endif
      scr_mkdir_rec(path, i, mode);
      path[i] = saved;
      if (scr_exc_pending()) return;
      if (scr_sys_mkdir(path, mode) == 0) return;
      e = errno;
      if (e == EEXIST && stat(path, &st) == 0 && S_ISDIR(st.st_mode)) return;
    }
  }
  ScrStr *p = scr_str_new(path, len);
  scr_fs_throw(e, "mkdir", p);
  scr_str_release(p);
}

void scr_fs_mkdir_recursive(ScrStr *path) {
  char *buf = malloc(path->len + 1);
  if (!buf) {
    scr_trap("scriptc: out of memory\n");
  }
  memcpy(buf, path->data, path->len + 1); /* ScrStr data is NUL-terminated */
  scr_mkdir_rec(buf, path->len, 0777);
  free(buf);
}

/* mkdirSync(p, { recursive: true, mode }): Node passes the mode to every
 * directory the walk creates (existing ones keep theirs). */
void scr_fs_mkdir_recursive_mode(ScrStr *path, double mode) {
  char *buf = malloc(path->len + 1);
  if (!buf) {
    scr_trap("scriptc: out of memory\n");
  }
  memcpy(buf, path->data, path->len + 1);
  scr_mkdir_rec(buf, path->len, (mode_t)mode);
  free(buf);
}

/* First failure of an rm walk, recorded instead of thrown so the retry
 * form can decide (retryable errno + attempts left → sleep and go again)
 * before anything reaches the exception cell. `path` is +1 when err != 0;
 * the throwers release it after scr_fs_throw. */
typedef struct {
  int err;
  const char *op;
  ScrStr *path;
} ScrRmFail;

static void scr_rm_fail_set(ScrRmFail *f, int err, const char *op, const char *path, size_t len) {
  if (f->err != 0) return; /* first failure wins, exactly like the old unwind */
  f->err = err;
  f->op = op;
  f->path = scr_str_new(path, len);
}

/* One unlink for rmSync, with `force`'s Windows read-only clause.
 *
 * Windows refuses to delete a file carrying FILE_ATTRIBUTE_READONLY — the
 * bit `writeFileSync(p, s, { mode: 0o400 })` and `chmodSync(p, 0o444)`
 * set — and reports it as EPERM. Node does not stop there: rimraf's
 * fixWinEPERMSync chmods the path back to 0o666 and retries the unlink,
 * which is what makes `force: true` mean "remove it anyway" on Windows.
 * Without this, a tree holding one read-only file survives an
 * `rmSync(dir, { recursive: true, force: true })` that Node completes.
 *
 * If the retry still fails the ORIGINAL errno is what throws — the chmod
 * is a repair attempt, never a new failure site, so a genuinely locked
 * file keeps reporting the error the user's operation actually hit.
 *
 * POSIX needs none of it (the DIRECTORY's write bit governs unlink there,
 * not the file's own mode) so the clause is inside the _WIN32 arm and the
 * POSIX arm keeps calling unlink exactly as before.
 *
 * Returns 0, or the errno to report. */
static int scr_rm_unlink_e(const char *path, bool force) {
  if (unlink(path) == 0) return 0;
#ifdef _WIN32
  int first = errno;
  if (!force || (first != EPERM && first != EACCES)) return first;
  if (chmod(path, 0666) != 0) return first;
  if (unlink(path) == 0) return 0;
  return first;
#else
  (void)force;
  return errno;
#endif
}

/* Post-order tree removal for rmSync's recursive form. Stops at (and
 * records) the first failure, with the failing path and syscall name. */
static void scr_rm_tree_e(const char *path, size_t len, bool force, ScrRmFail *f) {
  struct stat st;
  if (lstat(path, &st) != 0) {
    scr_rm_fail_set(f, errno, "lstat", path, len);
    return;
  }
  if (!S_ISDIR(st.st_mode)) {
    int e = scr_rm_unlink_e(path, force);
    if (e != 0) scr_rm_fail_set(f, e, "unlink", path, len);
    return;
  }
  DIR *d = opendir(path);
  if (!d) {
    scr_rm_fail_set(f, errno, "scandir", path, len);
    return;
  }
  const struct dirent *ent;
  while ((ent = readdir(d)) != NULL) {
    if (strcmp(ent->d_name, ".") == 0 || strcmp(ent->d_name, "..") == 0) continue;
    size_t namelen = strlen(ent->d_name);
    char *child = malloc(len + 1 + namelen + 1);
    if (!child) {
      scr_trap("scriptc: out of memory\n");
    }
    memcpy(child, path, len);
    child[len] = '/';
    memcpy(child + len + 1, ent->d_name, namelen + 1);
    scr_rm_tree_e(child, len + 1 + namelen, force, f);
    free(child);
    if (f->err != 0) {
      closedir(d);
      return;
    }
  }
  closedir(d);
  if (rmdir(path) != 0) scr_rm_fail_set(f, errno, "rmdir", path, len);
}

/* One rm attempt (the shared core of both option forms): lstat dispatch,
 * force's ENOENT swallow, the non-recursive directory rejection, and the
 * tree walk — failures recorded in `f`, never thrown. */
static void scr_fs_rm_attempt(ScrStr *path, bool recursive, bool force, ScrRmFail *f) {
  struct stat st;
  if (lstat(path->data, &st) != 0) {
    if (force && errno == ENOENT) return; /* Node: force swallows ENOENT */
    scr_rm_fail_set(f, errno, "lstat", path->data, path->len);
    return;
  }
  if (S_ISDIR(st.st_mode)) {
    if (!recursive) {
      /* Node throws ERR_FS_EISDIR here; the EISDIR-prefixed wording is
       * divergence 13's documented difference. */
      scr_rm_fail_set(f, EISDIR, "rm", path->data, path->len);
      return;
    }
    scr_rm_tree_e(path->data, path->len, force, f);
    return;
  }
  int e = scr_rm_unlink_e(path->data, force);
  if (e != 0) scr_rm_fail_set(f, e, "unlink", path->data, path->len);
}

void scr_fs_rm_opts(ScrStr *path, bool recursive, bool force) {
  ScrRmFail f = {0, NULL, NULL};
  scr_fs_rm_attempt(path, recursive, force, &f);
  if (f.err != 0) {
    scr_fs_throw(f.err, f.op, f.path);
    scr_str_release(f.path);
  }
}

/* rmSync(p, { recursive, force, maxRetries, retryDelay }): Node retries
 * the operation on EBUSY/EMFILE/ENFILE/ENOTEMPTY/EPERM up to maxRetries
 * times, waiting retryDelay ms LONGER on each try (linear backoff — the
 * fs.rmSync documented semantics). Everything else throws immediately
 * with the failing path, exactly like the plain options form. */
void scr_fs_rm_opts_retry(ScrStr *path, bool recursive, bool force, double max_retries, double retry_delay) {
  long tries = max_retries > 0 ? (long)max_retries : 0;
  double delay_ms = retry_delay > 0 ? retry_delay : 0;
  ScrRmFail f = {0, NULL, NULL};
  for (long attempt = 0;; attempt++) {
    f.err = 0;
    f.op = NULL;
    if (f.path) {
      scr_str_release(f.path);
      f.path = NULL;
    }
    scr_fs_rm_attempt(path, recursive, force, &f);
    if (f.err == 0) return;
    bool retryable = f.err == EBUSY || f.err == EMFILE || f.err == ENFILE ||
                     f.err == ENOTEMPTY || f.err == EPERM;
    if (!retryable || attempt >= tries) break;
    double ms = delay_ms * (double)(attempt + 1);
    if (ms > 0) {
      struct timespec ts;
      ts.tv_sec = (time_t)(ms / 1000.0);
      ts.tv_nsec = (long)((ms - (double)ts.tv_sec * 1000.0) * 1000000.0);
      nanosleep(&ts, NULL);
    }
  }
  scr_fs_throw(f.err, f.op, f.path);
  scr_str_release(f.path);
}

#ifdef _WIN32
/* No mkdtemp in the CRT: libuv's own fallback shape — six random
 * [a-z0-9] name characters from the CSPRNG, retried on EEXIST. */
static char *scr_win_mkdtemp(char *tmpl) {
  static const char cs[] = "abcdefghijklmnopqrstuvwxyz0123456789";
  size_t len = strlen(tmpl);
  for (int tries = 0; tries < 32; tries++) {
    unsigned char r[6];
    arc4random_buf(r, sizeof r);
    for (size_t i = 0; i < 6; i++) tmpl[len - 6 + i] = cs[r[i] % 36];
    if (mkdir(tmpl) == 0) return tmpl;
    if (errno != EEXIST) break;
  }
  memcpy(tmpl + len - 6, "XXXXXX", 6); /* the error message shows the template */
  return NULL;
}
#define mkdtemp scr_win_mkdtemp
#endif

ScrStr *scr_fs_mkdtemp(ScrStr *prefix) {
  char *tmpl = malloc(prefix->len + 7);
  if (!tmpl) {
    scr_trap("scriptc: out of memory\n");
  }
  memcpy(tmpl, prefix->data, prefix->len);
  memcpy(tmpl + prefix->len, "XXXXXX", 7);
  if (!mkdtemp(tmpl)) {
    /* Node reports the template, X's included: mkdtemp '/nope/x-XXXXXX' */
    int e = errno;
    ScrStr *shown = scr_str_new(tmpl, prefix->len + 6);
    scr_fs_throw(e, "mkdtemp", shown);
    scr_str_release(shown);
    free(tmpl);
    return NULL;
  }
  ScrStr *out = scr_str_new(tmpl, prefix->len + 6);
  free(tmpl);
  return out;
}

void scr_fs_access(ScrStr *path, double mode) {
  int m = (int)mode;
#ifdef _WIN32
  /* The CRT access() rejects X_OK (there is no execute bit); Node on
   * Windows treats X_OK as F_OK, so mask it down to the R/W bits. */
  m &= 6;
#endif
  if (access(path->data, m) != 0) scr_fs_throw(errno, "access", path);
}

/* The no-path variant of the fs error shape — Node's fd reads report
 * "EBADF: bad file descriptor, read" with no quoted path. */
static void scr_fs_throw_nopath(int e, const char *op) {
  char namebuf[16];
  const char *name = scr_errno_name(e, namebuf, sizeof namebuf);
  const char *text = scr_errno_text(e);
  char msg[256];
  int len = snprintf(msg, sizeof msg, "%s: %s, %s", name, text, op);
  scr_throw_error_msg(SCR_ERR_ERROR, msg, (size_t)len);
}

/* read(2) loop to EOF from the CURRENT position — Node's
 * readFileSync(fd) semantics for pipes and files alike (the stdin
 * pattern: readFileSync(0, "utf8")). Returns the malloc'd buffer and
 * its length, or NULL with the exception pending. */
static char *scr_read_fd_all(double fd, size_t *out_len) {
  size_t cap = 4096, len = 0;
  char *buf = malloc(cap);
  if (!buf) {
    scr_trap("scriptc: out of memory\n");
  }
  for (;;) {
    if (cap - len < 2048) {
      cap *= 2;
      char *grown = realloc(buf, cap);
      if (!grown) {
        scr_trap("scriptc: out of memory\n");
      }
      buf = grown;
    }
    ssize_t n = read((int)fd, buf + len, cap - len);
    if (n < 0) {
      if (errno == EINTR) continue;
      int e = errno;
      free(buf);
      scr_fs_throw_nopath(e, "read");
      return NULL;
    }
    if (n == 0) break;
    len += (size_t)n;
  }
  *out_len = len;
  return buf;
}

ScrStr *scr_fs_read_fd(double fd) {
  size_t len;
  char *buf = scr_read_fd_all(fd, &len);
  if (!buf) return NULL;
  ScrStr *s = scr_str_new(buf, len);
  free(buf);
  return s;
}

ScrBytes *scr_fs_read_fd_bytes(double fd) {
  size_t len;
  char *buf = scr_read_fd_all(fd, &len);
  if (!buf) return NULL;
  ScrBytes *b = scr_bytes_new(SCR_BYTES_U8, (double)len);
  if (len > 0) memcpy(b->data, buf, len);
  free(buf);
  return scr_bytes_stamp_buffer(b); /* Node: readFileSync without an encoding answers a Buffer */
}

/* ── Atomics.wait: the synchronous-sleep idiom ───────────────────────
 * Atomics.wait(int32Array, idx, expected, timeoutMs). scriptc has no
 * threads: nothing can ever notify a waiter, so the spec's behavior for
 * every compilable program is exactly "compare, then sleep out the
 * timeout" — "not-equal" immediately when the element differs from
 * `expected`, "timed-out" after a real nanosleep otherwise ("ok" is
 * unreachable; the compiler requires the timeout argument, since an
 * infinite wait here would be a certain deadlock). The sleep resumes
 * across EINTR so signals don't shorten it. Timeout semantics follow the
 * spec: NaN/+Infinity would be infinite (compiler-fenced by requiring
 * the argument, but a runtime NaN clamps to 0 defensively), negatives
 * clamp to 0. */
ScrStr *scr_atomics_wait(ScrBytes *arr, double idx, double expected, double timeout_ms) {
  double have = scr_bytes_get(arr, idx); /* traps out-of-range like every access */
  /* The comparison is on the stored int32 vs ToInt32(expected). */
  double t = expected;
  if (t != t || isinf(t)) t = 0;
  else {
    t = trunc(t);
    t = fmod(t, 4294967296.0);
    if (t < 0) t += 4294967296.0;
    if (t >= 2147483648.0) t -= 4294967296.0;
  }
  if (have != t) return scr_str_new("not-equal", 9);
  double ms = timeout_ms;
  if (ms != ms || ms < 0) ms = 0;
  if (ms > 0) {
    struct timespec left = {
        (time_t)(ms / 1000.0),
        (long)((ms - (double)(time_t)(ms / 1000.0) * 1000.0) * 1e6),
    };
    struct timespec rem;
    while (nanosleep(&left, &rem) != 0 && errno == EINTR) left = rem;
  }
  return scr_str_new("timed-out", 9);
}

/* ── the tty probes ──────────────────────────────────────────────────── */

bool scr_process_is_tty(double fd) { return isatty((int)fd) != 0; }

/* Terminal width for process.stdout/stderr.columns: ioctl(TIOCGWINSZ) on
 * the stream's fd, exactly Node's tty.WriteStream source of truth. A
 * non-TTY stream, or a terminal that refuses the ioctl, answers -1 and
 * the emitter's union construction turns that into the undefined arm —
 * Node's missing `.columns` on non-TTY streams. */
double scr_process_columns(double fd) {
  if (!isatty((int)fd)) return -1;
#ifdef _WIN32
  /* The console buffer's window width — libuv's uv_tty_get_winsize. */
  HANDLE h = (HANDLE)_get_osfhandle((int)fd);
  CONSOLE_SCREEN_BUFFER_INFO info;
  if (h == INVALID_HANDLE_VALUE || !GetConsoleScreenBufferInfo(h, &info)) return -1;
  return (double)(info.srWindow.Right - info.srWindow.Left + 1);
#else
  struct winsize ws;
  if (ioctl((int)fd, TIOCGWINSZ, &ws) != 0) return -1;
  return (double)ws.ws_col;
#endif
}

/* process.stdin.setRawMode(mode). TTY stdin: libuv's UV_TTY_MODE_RAW
 * termios flag set — exactly what Node's setRawMode(true) applies — and
 * setRawMode(false) restores the termios saved at the first raw entry
 * (libuv's orig_termios), a no-op when raw mode was never entered.
 * NON-TTY stdin: Node's process.stdin is a Socket with no setRawMode
 * member at all, so the call throws Node's exact catchable TypeError. */
#ifdef _WIN32
static DWORD scr_stdin_cooked;
static bool scr_stdin_cooked_saved = false;

void scr_process_stdin_set_raw_mode(bool raw) {
  if (!isatty(0)) {
    const char msg[] = "process.stdin.setRawMode is not a function";
    scr_throw_error_msg(SCR_ERR_TYPE, msg, sizeof msg - 1);
    return;
  }
  /* libuv's uv_tty_set_mode(UV_TTY_MODE_RAW) console half: drop line
   * buffering, echo, and Ctrl-C cooking; restore the entry mode on the
   * way back — the termios save/restore shape, translated. */
  HANDLE h = (HANDLE)_get_osfhandle(0);
  DWORD mode;
  if (h == INVALID_HANDLE_VALUE || !GetConsoleMode(h, &mode)) return;
  if (raw) {
    if (!scr_stdin_cooked_saved) {
      scr_stdin_cooked = mode;
      scr_stdin_cooked_saved = true;
    }
    mode &= ~(DWORD)(ENABLE_LINE_INPUT | ENABLE_ECHO_INPUT | ENABLE_PROCESSED_INPUT);
    (void)SetConsoleMode(h, mode);
  } else if (scr_stdin_cooked_saved) {
    (void)SetConsoleMode(h, scr_stdin_cooked);
  }
}
#else
static struct termios scr_stdin_cooked;
static bool scr_stdin_cooked_saved = false;

void scr_process_stdin_set_raw_mode(bool raw) {
  if (!isatty(0)) {
    const char msg[] = "process.stdin.setRawMode is not a function";
    scr_throw_error_msg(SCR_ERR_TYPE, msg, sizeof msg - 1);
    return;
  }
  if (raw) {
    struct termios t;
    if (tcgetattr(0, &t) != 0) return;
    if (!scr_stdin_cooked_saved) {
      scr_stdin_cooked = t;
      scr_stdin_cooked_saved = true;
    }
    /* libuv uv__tty_make_raw (UV_TTY_MODE_RAW) */
    t.c_iflag &= (tcflag_t)~(BRKINT | ICRNL | INPCK | ISTRIP | IXON);
    t.c_oflag |= (tcflag_t)ONLCR;
    t.c_cflag |= (tcflag_t)CS8;
    t.c_lflag &= (tcflag_t)~(ECHO | ICANON | IEXTEN | ISIG);
    t.c_cc[VMIN] = 1;
    t.c_cc[VTIME] = 0;
    (void)tcsetattr(0, TCSADRAIN, &t);
  } else if (scr_stdin_cooked_saved) {
    (void)tcsetattr(0, TCSADRAIN, &scr_stdin_cooked);
  }
}
#endif /* _WIN32 */

/* Node's destroy() tears down the stream: the events unit (scr_events.c)
 * drops every stdin listener, stops watching fd 0, and ends a running
 * for-await — nothing fires after, and the loop stops keeping the
 * process alive for stdin. With the events unit not linked there is
 * nothing to tear down and the call is a no-op, as before. */
void scr_process_stdin_destroy(void) {
  if (scr_stdin_destroy_hook != NULL) scr_stdin_destroy_hook();
}

/* ── Stats values ────────────────────────────────────────────────────
 * An immutable snapshot of stat(2) results — the slice the lowered
 * surface exposes (isFile/isDirectory/size). statSync THROWS like the
 * other sync fs calls; the promise form rejects (see the fsp section). */

struct ScrStats {
  size_t rc;
  bool is_file;
  bool is_dir;
  bool is_symlink; /* lstat only — a followed stat never sees one */
  double size;
  double mtime_ms; /* milliseconds with the nanosecond fraction (Node) */
};

ScrStats *scr_stats_retain(ScrStats *s) {
  if (s->rc != SIZE_MAX) s->rc++;
  return s;
}

void scr_stats_release(ScrStats *s) {
  if (!s || s->rc == SIZE_MAX) return;
  if (--s->rc == 0) free(s);
}

void *scr_stats_retain_v(void *p) { return scr_stats_retain(p); }
void scr_stats_release_v(void *p) { scr_stats_release(p); }

bool scr_stats_is_file(ScrStats *s) { return s->is_file; }
bool scr_stats_is_dir(ScrStats *s) { return s->is_dir; }
bool scr_stats_is_symlink(ScrStats *s) { return s->is_symlink; }
double scr_stats_size(ScrStats *s) { return s->size; }
double scr_stats_mtime_ms(ScrStats *s) { return s->mtime_ms; }

static ScrStats *scr_stats_of(const struct stat *st) {
  ScrStats *s = malloc(sizeof(ScrStats));
  if (!s) {
    scr_trap("scriptc: out of memory\n");
  }
  s->rc = 1;
  s->is_file = S_ISREG(st->st_mode);
  s->is_dir = S_ISDIR(st->st_mode);
#if defined(_WIN32)
  /* CRT stat has no symlink view (lstat above degrades to stat) and no
   * sub-second mtime — whole seconds where Node reads the FILETIME's
   * 100ns units (divergence: mtimeMs precision; mechanical fix is
   * GetFileAttributesEx). */
  s->is_symlink = false;
  s->mtime_ms = (double)st->st_mtime * 1000.0;
#else
  s->is_symlink = S_ISLNK(st->st_mode);
#if defined(__APPLE__)
  s->mtime_ms = (double)st->st_mtimespec.tv_sec * 1000.0 +
                (double)st->st_mtimespec.tv_nsec / 1e6;
#else
  s->mtime_ms = (double)st->st_mtim.tv_sec * 1000.0 +
                (double)st->st_mtim.tv_nsec / 1e6;
#endif
#endif
  s->size = (double)st->st_size;
  return s;
}

ScrStats *scr_fs_stat(ScrStr *path) {
  struct stat st;
  if (stat(path->data, &st) != 0) { /* follows symlinks, like Node's statSync */
    scr_fs_throw(errno, "stat", path);
    return NULL;
  }
  return scr_stats_of(&st);
}

ScrStats *scr_fs_lstat(ScrStr *path) {
  struct stat st;
  if (lstat(path->data, &st) != 0) { /* no follow; Node reports lstat */
    scr_fs_throw(errno, "lstat", path);
    return NULL;
  }
  return scr_stats_of(&st);
}

ScrArr *scr_fs_readdir(ScrStr *path) {
  DIR *d = opendir(path->data);
  if (!d) {
    scr_fs_throw(errno, "scandir", path); /* Node reports scandir */
    return NULL;
  }
  ScrArr *arr = scr_arr_new(SCR_ELEM_STR, 8);
  const struct dirent *ent;
  while ((ent = readdir(d)) != NULL) {
    if (strcmp(ent->d_name, ".") == 0 || strcmp(ent->d_name, "..") == 0) continue;
    scr_arr_push_ref(arr, scr_str_new(ent->d_name, strlen(ent->d_name)));
  }
  closedir(d);
  return arr; /* OS order, exactly like Node (unsorted) */
}

/* ── the withFileTypes scandir snapshot ──────────────────────────────
 * One readdir pass capturing name + entry kind for the emitter's Dirent
 * assembly (scr_runtime.h has the contract). Kinds are libuv's UV_DIRENT
 * encoding; DT_UNKNOWN (filesystems that don't fill d_type) falls back
 * to lstat(2) on the joined path — Node's own getDirents rule (a failed
 * lstat leaves 0/unknown: every is*() probe answers false, like Node's
 * Dirent over an UNKNOWN row it could not stat). */

struct ScrScandir {
  size_t len, cap;
  ScrStr **names;
  unsigned char *kinds;
};

static unsigned char scr_dirent_kind_of_mode(mode_t m) {
  if (S_ISREG(m)) return 1;
  if (S_ISDIR(m)) return 2;
#ifdef S_ISLNK /* no symlink/socket bits in the CRT's stat */
  if (S_ISLNK(m)) return 3;
#endif
  if (S_ISFIFO(m)) return 4;
#ifdef S_ISSOCK
  if (S_ISSOCK(m)) return 5;
#endif
  if (S_ISCHR(m)) return 6;
  if (S_ISBLK(m)) return 7;
  return 0;
}

ScrScandir *scr_fs_scandir(ScrStr *path) {
  DIR *d = opendir(path->data);
  if (!d) {
    scr_fs_throw(errno, "scandir", path); /* Node reports scandir */
    return NULL;
  }
  ScrScandir *s = malloc(sizeof *s);
  if (!s) {
    scr_trap("scriptc: out of memory\n");
  }
  s->len = 0;
  s->cap = 8;
  s->names = malloc(s->cap * sizeof *s->names);
  s->kinds = malloc(s->cap);
  if (!s->names || !s->kinds) {
    scr_trap("scriptc: out of memory\n");
  }
  const struct dirent *ent;
  while ((ent = readdir(d)) != NULL) {
    if (strcmp(ent->d_name, ".") == 0 || strcmp(ent->d_name, "..") == 0) continue;
    unsigned char kind;
#ifdef DT_REG
    switch (ent->d_type) {
      case DT_REG: kind = 1; break;
      case DT_DIR: kind = 2; break;
      case DT_LNK: kind = 3; break;
      case DT_FIFO: kind = 4; break;
      case DT_SOCK: kind = 5; break;
      case DT_CHR: kind = 6; break;
      case DT_BLK: kind = 7; break;
      default: { /* DT_UNKNOWN: the lstat fallback */
        char buf[4096];
        int w = snprintf(buf, sizeof buf, "%s/%s", path->data, ent->d_name);
        struct stat st;
        kind = (w > 0 && (size_t)w < sizeof buf && lstat(buf, &st) == 0)
                   ? scr_dirent_kind_of_mode(st.st_mode)
                   : 0;
        break;
      }
    }
#else
    { /* mingw dirent has no d_type: every row takes the stat fallback
       * (lstat degrades to stat on Windows — see the include seam). */
      char buf[4096];
      int w = snprintf(buf, sizeof buf, "%s/%s", path->data, ent->d_name);
      struct stat st;
      kind = (w > 0 && (size_t)w < sizeof buf && lstat(buf, &st) == 0)
                 ? scr_dirent_kind_of_mode(st.st_mode)
                 : 0;
    }
#endif
    if (s->len == s->cap) {
      s->cap *= 2;
      s->names = realloc(s->names, s->cap * sizeof *s->names);
      s->kinds = realloc(s->kinds, s->cap);
      if (!s->names || !s->kinds) {
        scr_trap("scriptc: out of memory\n");
      }
    }
    s->names[s->len] = scr_str_new(ent->d_name, strlen(ent->d_name));
    s->kinds[s->len] = kind;
    s->len++;
  }
  closedir(d);
  return s;
}

size_t scr_fs_scandir_count(const ScrScandir *s) { return s->len; }

ScrStr *scr_fs_scandir_name(const ScrScandir *s, size_t i) {
  return scr_str_retain(s->names[i]);
}

double scr_fs_scandir_type(const ScrScandir *s, size_t i) { return (double)s->kinds[i]; }

void scr_fs_scandir_free(ScrScandir *s) {
  for (size_t i = 0; i < s->len; i++) scr_str_release(s->names[i]);
  free(s->names);
  free(s->kinds);
  free(s);
}

/* ── node:crypto (the string-producing slice) ────────────────────────
 * Buffers aren't representable, so the lowered surface is exactly the
 * string-producing forms: randomUUID(), and the COMPOSED pattern
 * randomBytes(n).toString("hex"|"base64") — one libCall, the Buffer never
 * escapes. Randomness comes from arc4random_buf (the CSPRNG both macOS
 * and modern glibc provide). */

/* ── the scalar Math statics ─────────────────────────────────────────
 * Math.min/max at two arguments: the ECMA folds — C's fmin/fmax are NOT
 * these (they return the non-NaN operand where JS lets NaN poison, and
 * leave the ±0 order unspecified). Math.random(): a uniform double in
 * [0,1) at the spec's 53-bit granularity, drawn from arc4random_buf —
 * the same CSPRNG behind the crypto lowerings. Same distribution as
 * Node's, necessarily a different sequence (SEMANTICS.md 62); range and
 * granularity are pinned differentially by invariant, not by bytes. */

double scr_math_min(double a, double b) {
  if (isnan(a) || isnan(b)) return (double)NAN;
  if (a == 0.0 && b == 0.0) return signbit(a) ? a : b; /* -0 wins */
  return a < b ? a : b;
}

double scr_math_max(double a, double b) {
  if (isnan(a) || isnan(b)) return (double)NAN;
  if (a == 0.0 && b == 0.0) return signbit(a) ? b : a; /* +0 wins */
  return a > b ? a : b;
}

/* Math.round: ECMA half-toward-+Infinity. NOT C round() (half away from
 * zero: round(-1.5) is -2 where JS answers -1) and NOT floor(x + 0.5)
 * (the float ADD drifts at the epsilon boundary: 0.49999999999999994 +
 * 0.5 == 1.0 in doubles where the exact sum is below one — JS answers
 * 0). x - floor(x) is EXACT for doubles (Sterbenz), so the fraction
 * comparison decides losslessly; results in (-0.5, 0] keep the sign (JS:
 * Math.round(-0.3) is -0). */
double scr_math_round(double x) {
  if (isnan(x) || isinf(x) || x == 0.0) return x;
  double f = floor(x);
  double diff = x - f;
  double r = diff < 0.5 ? f : f + 1.0;
  return (r == 0.0 && x < 0.0) ? -0.0 : r;
}

/* Math.pow / the `**` operator — ECMA-262 Number::exponentiate, which C
 * pow() is NOT in three places. C says pow(x, y) is 1.0 whenever x is 1.0
 * (any y, NaN included) and whenever |x| is 1.0 with y infinite; ECMA
 * says NaN for both, and it says NaN for a NaN exponent before it looks
 * at the base at all. The exponent-is-zero rule comes FIRST in both (even
 * NaN ** 0 is 1), so the three guards are ordered exactly as the spec's
 * steps are, and everything after them — the signed zeros, the infinite
 * bases, the negative base with a fractional exponent — C already answers
 * the way ECMA does. */
double scr_math_pow(double x, double y) {
  if (y == 0.0) return 1.0;             /* step 2: ±0 exponent, even NaN ** 0 */
  if (isnan(y)) return (double)NAN;     /* step 1: 1 ** NaN is NaN, not 1 */
  if (isinf(y) && fabs(x) == 1.0) return (double)NAN; /* steps 8/9: (-1) ** ±Infinity */
  return pow(x, y);
}

/* Math.clz32 — the leading-zero count of ToUint32(x) as a 32-bit value
 * (32 for zero). scr_bit_or with 0 IS ToUint32-then-ToInt32; the unsigned
 * reinterpretation below is the ToUint32 the spec asks for, and the loop
 * is the count no C standard function provides portably. */
double scr_math_clz32(double x) {
  uint32_t u = (uint32_t)(int32_t)scr_bit_or(x, 0.0);
  if (u == 0) return 32.0;
  int n = 0;
  while ((u & 0x80000000u) == 0) { u <<= 1; n++; }
  return (double)n;
}

double scr_math_random(void) {
  uint64_t r;
  arc4random_buf(&r, sizeof r);
  /* The top 53 bits scaled by 2^-53: every representable k/2^53 in [0,1)
   * is equally likely — V8's own construction. */
  return (double)(r >> 11) * 0x1.0p-53;
}

ScrStr *scr_crypto_random_uuid(void) {
  unsigned char b[16];
  arc4random_buf(b, sizeof b);
  b[6] = (unsigned char)((b[6] & 0x0f) | 0x40); /* version 4 */
  b[8] = (unsigned char)((b[8] & 0x3f) | 0x80); /* variant 10xx */
  char out[37];
  static const char hex[] = "0123456789abcdef";
  size_t o = 0;
  for (size_t i = 0; i < 16; i++) {
    if (i == 4 || i == 6 || i == 8 || i == 10) out[o++] = '-';
    out[o++] = hex[b[i] >> 4];
    out[o++] = hex[b[i] & 0x0f];
  }
  return scr_str_new(out, 36);
}

/* randomBytes(n).toString(enc): n truncates like Node's (1.5 → 1 byte);
 * out-of-range n THROWS Node's RangeError verbatim. enc is "hex" or
 * "base64" (the compiler fences other encodings at the call site). */
ScrStr *scr_crypto_random_string(double n, ScrStr *enc) {
  if (!(n >= 0 && n <= 2147483647)) {
    char num[32];
    size_t numlen = scr_f64_to_str(n, num);
    char msg[128];
    int mlen = snprintf(msg, sizeof msg,
                        "The value of \"size\" is out of range. It must be >= 0 && <= 2147483647. Received %.*s",
                        (int)numlen, num);
    scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)mlen, "ERR_OUT_OF_RANGE");
    return NULL;
  }
  size_t size = (size_t)n;
  unsigned char *bytes = malloc(size ? size : 1);
  if (!bytes) {
    scr_trap("scriptc: out of memory\n");
  }
  arc4random_buf(bytes, size);
  ScrStr *out;
  if (enc->len == 3 && memcmp(enc->data, "hex", 3) == 0) {
    static const char hex[] = "0123456789abcdef";
    char *buf = malloc(size * 2 + 1);
    if (!buf) {
      scr_trap("scriptc: out of memory\n");
    }
    for (size_t i = 0; i < size; i++) {
      buf[i * 2] = hex[bytes[i] >> 4];
      buf[i * 2 + 1] = hex[bytes[i] & 0x0f];
    }
    out = scr_str_new(buf, size * 2);
    free(buf);
  } else {
    /* base64, standard alphabet, '=' padded — Buffer.toString("base64"). */
    static const char b64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    size_t outlen = (size + 2) / 3 * 4;
    char *buf = malloc(outlen + 1);
    if (!buf) {
      scr_trap("scriptc: out of memory\n");
    }
    size_t o = 0;
    for (size_t i = 0; i < size; i += 3) {
      unsigned v = (unsigned)bytes[i] << 16;
      if (i + 1 < size) v |= (unsigned)bytes[i + 1] << 8;
      if (i + 2 < size) v |= (unsigned)bytes[i + 2];
      buf[o++] = b64[(v >> 18) & 63];
      buf[o++] = b64[(v >> 12) & 63];
      buf[o++] = i + 1 < size ? b64[(v >> 6) & 63] : '=';
      buf[o++] = i + 2 < size ? b64[v & 63] : '=';
    }
    out = scr_str_new(buf, o);
    free(buf);
  }
  free(bytes);
  return out;
}

/* ── SHA-256 (FIPS 180-4) — the composed createHash chain ────────────
 * createHash("sha256").update(data).digest("hex") fuses into one call in
 * the compiler (the Hash handle never materializes), so the runtime
 * surface is just hash-these-bytes-to-hex. Straightforward FIPS 180-4
 * implementation; the differential corpus pins it against Node's own
 * digests. */

/* Big-endian word access, in ONE place.
 *
 * FIPS 180-4 messages and digests are big-endian byte strings. The
 * shift-and-or form these replace was endian-NEUTRAL, so a bare
 * __builtin_bswap would have been a silent correctness regression on a
 * big-endian target rather than a speed-up: the byte order is therefore a
 * compile-time branch, and on every target this project builds for it
 * compiles to one `movbe`-class instruction. */
#if defined(__BYTE_ORDER__) && __BYTE_ORDER__ == __ORDER_BIG_ENDIAN__
#define SCR_HOST_BIG_ENDIAN 1
#else
#define SCR_HOST_BIG_ENDIAN 0
#endif

static uint32_t scr_be32_load(const unsigned char *p) {
  uint32_t v;
  memcpy(&v, p, 4);
  return SCR_HOST_BIG_ENDIAN ? v : __builtin_bswap32(v);
}
static void scr_be32_store(unsigned char *p, uint32_t v) {
  uint32_t o = SCR_HOST_BIG_ENDIAN ? v : __builtin_bswap32(v);
  memcpy(p, &o, 4);
}
static uint64_t scr_be64_load(const unsigned char *p) {
  uint64_t v;
  memcpy(&v, p, 8);
  return SCR_HOST_BIG_ENDIAN ? v : __builtin_bswap64(v);
}
static void scr_be64_store(unsigned char *p, uint64_t v) {
  uint64_t o = SCR_HOST_BIG_ENDIAN ? v : __builtin_bswap64(v);
  memcpy(p, &o, 8);
}

static const uint32_t scr_sha256_k[64] = {
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2};

static uint32_t scr_sha256_rotr(uint32_t x, unsigned n) {
  return (x >> n) | (x << (32 - n));
}

static void scr_sha256_block(uint32_t h[8], const unsigned char *p) {
  uint32_t w[64];
  /* One unaligned load and one byte swap per word. The shift-and-or form
   * this replaces is four byte loads, three shifts and three ors, and
   * isa.mjs prices it at 2.22% of this function on the lane that runs it. */
  for (int i = 0; i < 16; i++) w[i] = scr_be32_load(p + i * 4);
  for (int i = 16; i < 64; i++) {
    uint32_t s0 = scr_sha256_rotr(w[i - 15], 7) ^ scr_sha256_rotr(w[i - 15], 18) ^ (w[i - 15] >> 3);
    uint32_t s1 = scr_sha256_rotr(w[i - 2], 17) ^ scr_sha256_rotr(w[i - 2], 19) ^ (w[i - 2] >> 10);
    w[i] = w[i - 16] + s0 + w[i - 7] + s1;
  }
  uint32_t a = h[0], b = h[1], c = h[2], d = h[3];
  uint32_t e = h[4], f = h[5], g = h[6], hh = h[7];
  for (int i = 0; i < 64; i++) {
    uint32_t s1 = scr_sha256_rotr(e, 6) ^ scr_sha256_rotr(e, 11) ^ scr_sha256_rotr(e, 25);
    uint32_t ch = (e & f) ^ (~e & g);
    uint32_t t1 = hh + s1 + ch + scr_sha256_k[i] + w[i];
    uint32_t s0 = scr_sha256_rotr(a, 2) ^ scr_sha256_rotr(a, 13) ^ scr_sha256_rotr(a, 22);
    uint32_t maj = (a & b) ^ (a & c) ^ (b & c);
    uint32_t t2 = s0 + maj;
    hh = g; g = f; f = e; e = d + t1;
    d = c; c = b; b = a; a = t1 + t2;
  }
  h[0] += a; h[1] += b; h[2] += c; h[3] += d;
  h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
}


/* ── SHA-256 on the x86 SHA extensions (SHA-NI) ──────────────────────
 * The scalar compression above is a correct FIPS 180-4 round loop and it
 * is NOT the floor: measured on this host it costs 17-20 cycles per byte
 * (840 cycles for a one-block digest), where `sha256rnds2` does four
 * rounds in one instruction and lands at 1.8-2.6. Every x86-64 CPU since
 * Zen 1 (2017) and Goldmont / Ice Lake on Intel's side has it; the ones
 * that do not still take the scalar path, chosen by CPUID at run time.
 *
 * The 64 round constants below are the SAME scr_sha256_k, paired into
 * 128-bit halves — sha256rnds2 consumes four already-added K+W words at a
 * time, which is why they appear as literals rather than as loads from
 * the table.
 *
 * THIS IS A HASH, so it is not "probably right": scr_sha256_blocks is
 * proved against the scalar arm byte for byte over every message length
 * 0..4096 on three seeds and a million random short messages, and the
 * whole digest is pinned against Node's in the differential corpus.
 * SCR_SHA256_NI=0 compiles the dispatch out entirely and restores the
 * previous code path exactly, which is what the ablation control builds.
 *
 * aarch64 has the same primitive (`sha256h`/`sha256su0`) and is NOT wired
 * up here: it cannot be measured on this host and an unmeasured crypto
 * path is worse than no path. */
#ifndef SCR_SHA256_NI
#if defined(__x86_64__) && defined(__has_include)
#if __has_include(<immintrin.h>)
#define SCR_SHA256_NI 1
#endif
#endif
#endif
#ifndef SCR_SHA256_NI
#define SCR_SHA256_NI 0
#endif

#if SCR_SHA256_NI
#include <immintrin.h>

/* CPUID by hand rather than through <cpuid.h>: one local function instead
 * of the header three, and no dependency on a header the freestanding
 * targets need not have. On x86-64 %rbx is not the PIC register, so it can
 * be an output constraint directly -- which is also why the gate above is
 * __x86_64__ only: on i386 %ebx IS the PIC register and this constraint can
 * fail to build under -fPIC. i386 is not a target this project ships and I
 * cannot test it, so it keeps the scalar arm.
 *
 * (I first wrote this believing <cpuid.h> was WHY the profiling lane grew 8
 * unnamed hot rows next to this code. It is not: those rows are the SSE
 * intrinsics of the block loop below, which -finstrument-functions
 * un-inlines into eight ~96-byte thunks that carry no PDB name. See the
 * report. The change is kept because it is smaller, not because it fixed
 * that.) */
static void scr_cpuid(unsigned leaf, unsigned sub, unsigned out[4]) {
  __asm__ volatile("cpuid"
                   : "=a"(out[0]), "=b"(out[1]), "=c"(out[2]), "=d"(out[3])
                   : "a"(leaf), "c"(sub));
}

/* SSSE3 (pshufb), SSE4.1 (pblendw) and SHA all have to be present: the
 * block loop uses one of each. */
static int scr_sha256_ni_probe(void) {
  unsigned r[4];
  scr_cpuid(0, 0, r);
  if (r[0] < 7) return 0; /* max leaf */
  scr_cpuid(1, 0, r);
  if (!((r[2] >> 9) & 1)) return 0;  /* SSSE3 */
  if (!((r[2] >> 19) & 1)) return 0; /* SSE4.1 */
  scr_cpuid(7, 0, r);
  return (int)((r[1] >> 29) & 1); /* SHA */
}

/* Cached after the first digest. The race between two threads reaching it
 * at once is benign: CPUID is a pure function of the machine, so both
 * store the same value into an int. */
static int scr_sha256_ni_cache = -1;
static int scr_sha256_have_ni(void) {
  int v = scr_sha256_ni_cache;
  if (v < 0) {
    v = scr_sha256_ni_probe();
    scr_sha256_ni_cache = v;
  }
  return v;
}

__attribute__((target("sha,sse4.1,ssse3"))) static void
scr_sha256_ni_blocks(uint32_t state[8], const unsigned char *data, size_t nblk) {
  __m128i s0, s1, msg, tmp, m0, m1, m2, m3, abef, cdgh;
  const __m128i shuf = _mm_set_epi64x((long long)0x0c0d0e0f08090a0bULL,
                                      (long long)0x0405060700010203ULL);

  /* the state arrives as {a,b,c,d,e,f,g,h}; the instruction wants ABEF/CDGH */
  tmp = _mm_loadu_si128((const __m128i *)&state[0]);
  s1 = _mm_loadu_si128((const __m128i *)&state[4]);
  tmp = _mm_shuffle_epi32(tmp, 0xB1);
  s1 = _mm_shuffle_epi32(s1, 0x1B);
  s0 = _mm_alignr_epi8(tmp, s1, 8);
  s1 = _mm_blend_epi16(s1, tmp, 0xF0);

  while (nblk--) {
    abef = s0;
    cdgh = s1;

    /* rounds 0-3 */
    msg = _mm_loadu_si128((const __m128i *)(data + 0));
    m0 = _mm_shuffle_epi8(msg, shuf);
    msg = _mm_add_epi32(m0, _mm_set_epi64x((long long)0xE9B5DBA5B5C0FBCFULL,
                                           (long long)0x71374491428A2F98ULL));
    s1 = _mm_sha256rnds2_epu32(s1, s0, msg);
    msg = _mm_shuffle_epi32(msg, 0x0E);
    s0 = _mm_sha256rnds2_epu32(s0, s1, msg);
    /* rounds 4-7 */
    m1 = _mm_loadu_si128((const __m128i *)(data + 16));
    m1 = _mm_shuffle_epi8(m1, shuf);
    msg = _mm_add_epi32(m1, _mm_set_epi64x((long long)0xAB1C5ED5923F82A4ULL,
                                           (long long)0x59F111F13956C25BULL));
    s1 = _mm_sha256rnds2_epu32(s1, s0, msg);
    msg = _mm_shuffle_epi32(msg, 0x0E);
    s0 = _mm_sha256rnds2_epu32(s0, s1, msg);
    m0 = _mm_sha256msg1_epu32(m0, m1);
    /* rounds 8-11 */
    m2 = _mm_loadu_si128((const __m128i *)(data + 32));
    m2 = _mm_shuffle_epi8(m2, shuf);
    msg = _mm_add_epi32(m2, _mm_set_epi64x((long long)0x550C7DC3243185BEULL,
                                           (long long)0x12835B01D807AA98ULL));
    s1 = _mm_sha256rnds2_epu32(s1, s0, msg);
    msg = _mm_shuffle_epi32(msg, 0x0E);
    s0 = _mm_sha256rnds2_epu32(s0, s1, msg);
    m1 = _mm_sha256msg1_epu32(m1, m2);
    /* rounds 12-15 */
    m3 = _mm_loadu_si128((const __m128i *)(data + 48));
    m3 = _mm_shuffle_epi8(m3, shuf);
    msg = _mm_add_epi32(m3, _mm_set_epi64x((long long)0xC19BF1749BDC06A7ULL,
                                           (long long)0x80DEB1FE72BE5D74ULL));
    s1 = _mm_sha256rnds2_epu32(s1, s0, msg);
    tmp = _mm_alignr_epi8(m3, m2, 4);
    m0 = _mm_add_epi32(m0, tmp);
    m0 = _mm_sha256msg2_epu32(m0, m3);
    msg = _mm_shuffle_epi32(msg, 0x0E);
    s0 = _mm_sha256rnds2_epu32(s0, s1, msg);
    m2 = _mm_sha256msg1_epu32(m2, m3);
    /* rounds 16-19 */
    msg = _mm_add_epi32(m0, _mm_set_epi64x((long long)0x240CA1CC0FC19DC6ULL,
                                           (long long)0xEFBE4786E49B69C1ULL));
    s1 = _mm_sha256rnds2_epu32(s1, s0, msg);
    tmp = _mm_alignr_epi8(m0, m3, 4);
    m1 = _mm_add_epi32(m1, tmp);
    m1 = _mm_sha256msg2_epu32(m1, m0);
    msg = _mm_shuffle_epi32(msg, 0x0E);
    s0 = _mm_sha256rnds2_epu32(s0, s1, msg);
    m3 = _mm_sha256msg1_epu32(m3, m0);
    /* rounds 20-23 */
    msg = _mm_add_epi32(m1, _mm_set_epi64x((long long)0x76F988DA5CB0A9DCULL,
                                           (long long)0x4A7484AA2DE92C6FULL));
    s1 = _mm_sha256rnds2_epu32(s1, s0, msg);
    tmp = _mm_alignr_epi8(m1, m0, 4);
    m2 = _mm_add_epi32(m2, tmp);
    m2 = _mm_sha256msg2_epu32(m2, m1);
    msg = _mm_shuffle_epi32(msg, 0x0E);
    s0 = _mm_sha256rnds2_epu32(s0, s1, msg);
    m0 = _mm_sha256msg1_epu32(m0, m1);
    /* rounds 24-27 */
    msg = _mm_add_epi32(m2, _mm_set_epi64x((long long)0xBF597FC7B00327C8ULL,
                                           (long long)0xA831C66D983E5152ULL));
    s1 = _mm_sha256rnds2_epu32(s1, s0, msg);
    tmp = _mm_alignr_epi8(m2, m1, 4);
    m3 = _mm_add_epi32(m3, tmp);
    m3 = _mm_sha256msg2_epu32(m3, m2);
    msg = _mm_shuffle_epi32(msg, 0x0E);
    s0 = _mm_sha256rnds2_epu32(s0, s1, msg);
    m1 = _mm_sha256msg1_epu32(m1, m2);
    /* rounds 28-31 */
    msg = _mm_add_epi32(m3, _mm_set_epi64x((long long)0x1429296706CA6351ULL,
                                           (long long)0xD5A79147C6E00BF3ULL));
    s1 = _mm_sha256rnds2_epu32(s1, s0, msg);
    tmp = _mm_alignr_epi8(m3, m2, 4);
    m0 = _mm_add_epi32(m0, tmp);
    m0 = _mm_sha256msg2_epu32(m0, m3);
    msg = _mm_shuffle_epi32(msg, 0x0E);
    s0 = _mm_sha256rnds2_epu32(s0, s1, msg);
    m2 = _mm_sha256msg1_epu32(m2, m3);
    /* rounds 32-35 */
    msg = _mm_add_epi32(m0, _mm_set_epi64x((long long)0x53380D134D2C6DFCULL,
                                           (long long)0x2E1B213827B70A85ULL));
    s1 = _mm_sha256rnds2_epu32(s1, s0, msg);
    tmp = _mm_alignr_epi8(m0, m3, 4);
    m1 = _mm_add_epi32(m1, tmp);
    m1 = _mm_sha256msg2_epu32(m1, m0);
    msg = _mm_shuffle_epi32(msg, 0x0E);
    s0 = _mm_sha256rnds2_epu32(s0, s1, msg);
    m3 = _mm_sha256msg1_epu32(m3, m0);
    /* rounds 36-39 */
    msg = _mm_add_epi32(m1, _mm_set_epi64x((long long)0x92722C8581C2C92EULL,
                                           (long long)0x766A0ABB650A7354ULL));
    s1 = _mm_sha256rnds2_epu32(s1, s0, msg);
    tmp = _mm_alignr_epi8(m1, m0, 4);
    m2 = _mm_add_epi32(m2, tmp);
    m2 = _mm_sha256msg2_epu32(m2, m1);
    msg = _mm_shuffle_epi32(msg, 0x0E);
    s0 = _mm_sha256rnds2_epu32(s0, s1, msg);
    m0 = _mm_sha256msg1_epu32(m0, m1);
    /* rounds 40-43 */
    msg = _mm_add_epi32(m2, _mm_set_epi64x((long long)0xC76C51A3C24B8B70ULL,
                                           (long long)0xA81A664BA2BFE8A1ULL));
    s1 = _mm_sha256rnds2_epu32(s1, s0, msg);
    tmp = _mm_alignr_epi8(m2, m1, 4);
    m3 = _mm_add_epi32(m3, tmp);
    m3 = _mm_sha256msg2_epu32(m3, m2);
    msg = _mm_shuffle_epi32(msg, 0x0E);
    s0 = _mm_sha256rnds2_epu32(s0, s1, msg);
    m1 = _mm_sha256msg1_epu32(m1, m2);
    /* rounds 44-47 */
    msg = _mm_add_epi32(m3, _mm_set_epi64x((long long)0x106AA070F40E3585ULL,
                                           (long long)0xD6990624D192E819ULL));
    s1 = _mm_sha256rnds2_epu32(s1, s0, msg);
    tmp = _mm_alignr_epi8(m3, m2, 4);
    m0 = _mm_add_epi32(m0, tmp);
    m0 = _mm_sha256msg2_epu32(m0, m3);
    msg = _mm_shuffle_epi32(msg, 0x0E);
    s0 = _mm_sha256rnds2_epu32(s0, s1, msg);
    m2 = _mm_sha256msg1_epu32(m2, m3);
    /* rounds 48-51 */
    msg = _mm_add_epi32(m0, _mm_set_epi64x((long long)0x34B0BCB52748774CULL,
                                           (long long)0x1E376C0819A4C116ULL));
    s1 = _mm_sha256rnds2_epu32(s1, s0, msg);
    tmp = _mm_alignr_epi8(m0, m3, 4);
    m1 = _mm_add_epi32(m1, tmp);
    m1 = _mm_sha256msg2_epu32(m1, m0);
    msg = _mm_shuffle_epi32(msg, 0x0E);
    s0 = _mm_sha256rnds2_epu32(s0, s1, msg);
    m3 = _mm_sha256msg1_epu32(m3, m0);
    /* rounds 52-55 */
    msg = _mm_add_epi32(m1, _mm_set_epi64x((long long)0x682E6FF35B9CCA4FULL,
                                           (long long)0x4ED8AA4A391C0CB3ULL));
    s1 = _mm_sha256rnds2_epu32(s1, s0, msg);
    tmp = _mm_alignr_epi8(m1, m0, 4);
    m2 = _mm_add_epi32(m2, tmp);
    m2 = _mm_sha256msg2_epu32(m2, m1);
    msg = _mm_shuffle_epi32(msg, 0x0E);
    s0 = _mm_sha256rnds2_epu32(s0, s1, msg);
    /* rounds 56-59 */
    msg = _mm_add_epi32(m2, _mm_set_epi64x((long long)0x8CC7020884C87814ULL,
                                           (long long)0x78A5636F748F82EEULL));
    s1 = _mm_sha256rnds2_epu32(s1, s0, msg);
    tmp = _mm_alignr_epi8(m2, m1, 4);
    m3 = _mm_add_epi32(m3, tmp);
    m3 = _mm_sha256msg2_epu32(m3, m2);
    msg = _mm_shuffle_epi32(msg, 0x0E);
    s0 = _mm_sha256rnds2_epu32(s0, s1, msg);
    /* rounds 60-63 */
    msg = _mm_add_epi32(m3, _mm_set_epi64x((long long)0xC67178F2BEF9A3F7ULL,
                                           (long long)0xA4506CEB90BEFFFAULL));
    s1 = _mm_sha256rnds2_epu32(s1, s0, msg);
    msg = _mm_shuffle_epi32(msg, 0x0E);
    s0 = _mm_sha256rnds2_epu32(s0, s1, msg);

    s0 = _mm_add_epi32(s0, abef);
    s1 = _mm_add_epi32(s1, cdgh);
    data += 64;
  }

  tmp = _mm_shuffle_epi32(s0, 0x1B);
  s1 = _mm_shuffle_epi32(s1, 0xB1);
  s0 = _mm_blend_epi16(tmp, s1, 0xF0);
  s1 = _mm_alignr_epi8(s1, tmp, 8);
  _mm_storeu_si128((__m128i *)&state[0], s0);
  _mm_storeu_si128((__m128i *)&state[4], s1);
}
#endif /* SCR_SHA256_NI */

/* nblk consecutive 64-byte blocks. The ONE place the two arms meet; with
 * SCR_SHA256_NI=0 this is the plain loop the digest used to inline. */
static void scr_sha256_blocks(uint32_t h[8], const unsigned char *p, size_t nblk) {
#ifdef SCR_SHACEN_ON
  /* the arm is read from the dispatch's OWN memo, not from the build flags:
   * "SHA-NI is compiled in" and "SHA-NI ran" are different claims. */
#if SCR_SHA256_NI
  scr_shacen_note_blocks((long long)nblk, scr_sha256_have_ni());
#else
  scr_shacen_note_blocks((long long)nblk, -1);
#endif
#endif
#if SCR_SHA256_NI
  if (scr_sha256_have_ni()) {
    scr_sha256_ni_blocks(h, p, nblk);
    return;
  }
#endif
  for (size_t b = 0; b < nblk; b++) scr_sha256_block(h, p + b * 64);
}

/* Final block(s) shared shape: the 0x80 terminator, zero padding, 64-bit
 * big-endian bit length (FIPS 180-4 — SHA-1 and SHA-256 pad alike). */
static size_t scr_sha256_digest(const unsigned char *data, size_t len, unsigned char out[32]) {
#ifdef SCR_SHACEN_ON
  /* tests/perf/shacensus/scr_sha_census.h. Inert — the switch is undefined —
   * unless that header is -include'd, which is the only way to answer "what
   * does the REAL program hash, and how big". */
  scr_shacen_note(SCR_SHACEN_SHA256, (long long)len);
#endif
  uint32_t h[8] = {0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
                   0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19};
  size_t nblk = len / 64;
  if (nblk) scr_sha256_blocks(h, data, nblk);
  size_t i = nblk * 64;
  unsigned char tail[128];
  size_t rem = len - i;
  size_t pad = (rem + 1 + 8 <= 64) ? 64 : 128;
  /* Clear the WHOLE tail at a size the compiler knows, then copy over it.
   * The gap between the terminator and the length field is a run-time
   * length, so `memset(tail + rem + 1, 0, ...)` is a call into libc; 64 or
   * 128 constant zero bytes is four or eight stores emitted inline. It
   * costs rem bytes written twice, which are stores that were happening
   * anyway. This mattered nothing when the compression was 4,300
   * instructions a block and matters now that it is ~110 cycles. */
  if (pad == 64) memset(tail, 0, 64);
  else memset(tail, 0, 128);
  memcpy(tail, data + i, rem);
  tail[rem] = 0x80;
  scr_be64_store(tail + pad - 8, (uint64_t)len * 8);
  scr_sha256_blocks(h, tail, pad / 64);
  /* The digest is eight big-endian words: one store each, in place of 32
   * shift-and-store steps. */
  for (int j = 0; j < 8; j++) scr_be32_store(out + j * 4, h[j]);
  return 32;
}

#ifdef SCR_SHACEN_ON
/* The census's POSITIVE CONTROL lives here and not in the header, because
 * scr_sha256_digest is static to this file. SCR_SHACEN_ARM=<n> hashes n
 * copies of a fixed 137-byte message before main runs; the report's sha256
 * row 137 must then read exactly n. Without it a report of zero digests and
 * a census that never compiled in look the same. */
__attribute__((constructor)) static void scr_shacen_plant_ctor(void) {
  const char *v = getenv("SCR_SHACEN_ARM");
  long n = (v && *v) ? strtol(v, 0, 10) : 0;
  unsigned char msg[137], out[32];
  long i;
  memset(msg, 0xa7, sizeof msg);
  for (i = 0; i < n; i++) scr_sha256_digest(msg, sizeof msg, out);
  scr_shacen_planted = (int)n;
}
#endif

/* ── SHA-1 (FIPS 180-4) — the RFC 6455 Sec-WebSocket-Accept hash ────── */

static void scr_sha1_block(uint32_t h[5], const unsigned char *p) {
  uint32_t w[80];
  for (int i = 0; i < 16; i++) {
    w[i] = ((uint32_t)p[i * 4] << 24) | ((uint32_t)p[i * 4 + 1] << 16) |
           ((uint32_t)p[i * 4 + 2] << 8) | (uint32_t)p[i * 4 + 3];
  }
  for (int i = 16; i < 80; i++) {
    uint32_t x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
    w[i] = (x << 1) | (x >> 31);
  }
  uint32_t a = h[0], b = h[1], c = h[2], d = h[3], e = h[4];
  for (int i = 0; i < 80; i++) {
    uint32_t f, k;
    if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
    else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
    else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
    else { f = b ^ c ^ d; k = 0xca62c1d6; }
    uint32_t t = ((a << 5) | (a >> 27)) + f + e + k + w[i];
    e = d; d = c; c = ((b << 30) | (b >> 2)); b = a; a = t;
  }
  h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e;
}

static size_t scr_sha1_digest(const unsigned char *data, size_t len, unsigned char out[32]) {
#ifdef SCR_SHACEN_ON
  scr_shacen_note(SCR_SHACEN_SHA1, (long long)len);
#endif
  uint32_t h[5] = {0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0};
  size_t i = 0;
  for (; i + 64 <= len; i += 64) scr_sha1_block(h, data + i);
  unsigned char tail[128];
  size_t rem = len - i;
  memcpy(tail, data + i, rem);
  tail[rem] = 0x80;
  size_t pad = (rem + 1 + 8 <= 64) ? 64 : 128;
  memset(tail + rem + 1, 0, pad - rem - 1 - 8);
  uint64_t bits = (uint64_t)len * 8;
  for (int b = 0; b < 8; b++) tail[pad - 1 - b] = (unsigned char)(bits >> (8 * b));
  scr_sha1_block(h, tail);
  if (pad == 128) scr_sha1_block(h, tail + 64);
  for (int j = 0; j < 5; j++) {
    for (int b = 0; b < 4; b++) out[j * 4 + b] = (unsigned char)(h[j] >> (24 - 8 * b));
  }
  return 20;
}

/* ── SHA-512 (FIPS 180-4) — the Noise handshake hash (zapo's crypto
 * primitives derive with it). Same shape as SHA-256 one word size up:
 * 64-bit lanes, 80 rounds, 128-byte blocks, and a 128-bit big-endian
 * length field (only the low 64 bits can ever be nonzero here — a
 * message longer than 2^64 bits does not fit in memory). ─────────── */

static const uint64_t scr_sha512_k[80] = {
    0x428a2f98d728ae22ULL, 0x7137449123ef65cdULL, 0xb5c0fbcfec4d3b2fULL,
    0xe9b5dba58189dbbcULL, 0x3956c25bf348b538ULL, 0x59f111f1b605d019ULL,
    0x923f82a4af194f9bULL, 0xab1c5ed5da6d8118ULL, 0xd807aa98a3030242ULL,
    0x12835b0145706fbeULL, 0x243185be4ee4b28cULL, 0x550c7dc3d5ffb4e2ULL,
    0x72be5d74f27b896fULL, 0x80deb1fe3b1696b1ULL, 0x9bdc06a725c71235ULL,
    0xc19bf174cf692694ULL, 0xe49b69c19ef14ad2ULL, 0xefbe4786384f25e3ULL,
    0x0fc19dc68b8cd5b5ULL, 0x240ca1cc77ac9c65ULL, 0x2de92c6f592b0275ULL,
    0x4a7484aa6ea6e483ULL, 0x5cb0a9dcbd41fbd4ULL, 0x76f988da831153b5ULL,
    0x983e5152ee66dfabULL, 0xa831c66d2db43210ULL, 0xb00327c898fb213fULL,
    0xbf597fc7beef0ee4ULL, 0xc6e00bf33da88fc2ULL, 0xd5a79147930aa725ULL,
    0x06ca6351e003826fULL, 0x142929670a0e6e70ULL, 0x27b70a8546d22ffcULL,
    0x2e1b21385c26c926ULL, 0x4d2c6dfc5ac42aedULL, 0x53380d139d95b3dfULL,
    0x650a73548baf63deULL, 0x766a0abb3c77b2a8ULL, 0x81c2c92e47edaee6ULL,
    0x92722c851482353bULL, 0xa2bfe8a14cf10364ULL, 0xa81a664bbc423001ULL,
    0xc24b8b70d0f89791ULL, 0xc76c51a30654be30ULL, 0xd192e819d6ef5218ULL,
    0xd69906245565a910ULL, 0xf40e35855771202aULL, 0x106aa07032bbd1b8ULL,
    0x19a4c116b8d2d0c8ULL, 0x1e376c085141ab53ULL, 0x2748774cdf8eeb99ULL,
    0x34b0bcb5e19b48a8ULL, 0x391c0cb3c5c95a63ULL, 0x4ed8aa4ae3418acbULL,
    0x5b9cca4f7763e373ULL, 0x682e6ff3d6b2b8a3ULL, 0x748f82ee5defb2fcULL,
    0x78a5636f43172f60ULL, 0x84c87814a1f0ab72ULL, 0x8cc702081a6439ecULL,
    0x90befffa23631e28ULL, 0xa4506cebde82bde9ULL, 0xbef9a3f7b2c67915ULL,
    0xc67178f2e372532bULL, 0xca273eceea26619cULL, 0xd186b8c721c0c207ULL,
    0xeada7dd6cde0eb1eULL, 0xf57d4f7fee6ed178ULL, 0x06f067aa72176fbaULL,
    0x0a637dc5a2c898a6ULL, 0x113f9804bef90daeULL, 0x1b710b35131c471bULL,
    0x28db77f523047d84ULL, 0x32caab7b40c72493ULL, 0x3c9ebe0a15c9bebcULL,
    0x431d67c49c100d4cULL, 0x4cc5d4becb3e42b6ULL, 0x597f299cfc657e2aULL,
    0x5fcb6fab3ad6faecULL, 0x6c44198c4a475817ULL};

static uint64_t scr_sha512_rotr(uint64_t x, unsigned n) {
  return (x >> n) | (x << (64 - n));
}

static void scr_sha512_block(uint64_t h[8], const unsigned char *p) {
  uint64_t w[80];
  /* Eight byte loads and eight shift-or steps per word became one load and
   * one swap. SHA-512 has no hardware on this host, so unlike SHA-256 it is
   * still the scalar code that ships here. */
  for (int i = 0; i < 16; i++) w[i] = scr_be64_load(p + i * 8);
  for (int i = 16; i < 80; i++) {
    uint64_t s0 = scr_sha512_rotr(w[i - 15], 1) ^ scr_sha512_rotr(w[i - 15], 8) ^ (w[i - 15] >> 7);
    uint64_t s1 = scr_sha512_rotr(w[i - 2], 19) ^ scr_sha512_rotr(w[i - 2], 61) ^ (w[i - 2] >> 6);
    w[i] = w[i - 16] + s0 + w[i - 7] + s1;
  }
  uint64_t a = h[0], b = h[1], c = h[2], d = h[3];
  uint64_t e = h[4], f = h[5], g = h[6], hh = h[7];
  for (int i = 0; i < 80; i++) {
    uint64_t s1 = scr_sha512_rotr(e, 14) ^ scr_sha512_rotr(e, 18) ^ scr_sha512_rotr(e, 41);
    uint64_t ch = (e & f) ^ (~e & g);
    uint64_t t1 = hh + s1 + ch + scr_sha512_k[i] + w[i];
    uint64_t s0 = scr_sha512_rotr(a, 28) ^ scr_sha512_rotr(a, 34) ^ scr_sha512_rotr(a, 39);
    uint64_t maj = (a & b) ^ (a & c) ^ (b & c);
    uint64_t t2 = s0 + maj;
    hh = g; g = f; f = e; e = d + t1;
    d = c; c = b; b = a; a = t1 + t2;
  }
  h[0] += a; h[1] += b; h[2] += c; h[3] += d;
  h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
}

static size_t scr_sha512_digest(const unsigned char *data, size_t len, unsigned char out[64]) {
#ifdef SCR_SHACEN_ON
  scr_shacen_note(SCR_SHACEN_SHA512, (long long)len);
#endif
  uint64_t h[8] = {0x6a09e667f3bcc908ULL, 0xbb67ae8584caa73bULL, 0x3c6ef372fe94f82bULL,
                   0xa54ff53a5f1d36f1ULL, 0x510e527fade682d1ULL, 0x9b05688c2b3e6c1fULL,
                   0x1f83d9abfb41bd6bULL, 0x5be0cd19137e2179ULL};
  size_t i = 0;
  for (; i + 128 <= len; i += 128) scr_sha512_block(h, data + i);
  unsigned char tail[256];
  size_t rem = len - i;
  size_t pad = (rem + 1 + 16 <= 128) ? 128 : 256;
  if (pad == 128) memset(tail, 0, 128); /* see scr_sha256_digest */
  else memset(tail, 0, 256);
  memcpy(tail, data + i, rem);
  tail[rem] = 0x80;
  scr_be64_store(tail + pad - 8, (uint64_t)len * 8);
  scr_sha512_block(h, tail);
  if (pad == 256) scr_sha512_block(h, tail + 128);
  for (int j = 0; j < 8; j++) scr_be64_store(out + j * 8, h[j]);
  return 64;
}

/* The digest's encoding: "hex" or "base64" (compiler-fenced literals). */
static ScrStr *scr_digest_encode(const unsigned char *d, size_t n, const ScrStr *enc) {
  if (enc->len == 3 && memcmp(enc->data, "hex", 3) == 0) {
    static const char hex[] = "0123456789abcdef";
    char buf[128]; /* the widest digest is SHA-512's 64 bytes */
    /* Two byte stores per digest byte, and it is left alone DELIBERATELY.
     * Building the pair as one 16-bit word and storing that reads like the
     * obvious win and measures 0.93-1.03x here — nothing, or slightly worse
     * (lab/shalab/hexship.c, proved equal over all 256 byte values first).
     * The version that IS faster, 1.8x, is a 256-entry uint16 table; it is
     * not here because the only caller that reaches it is `.digest("hex")`,
     * which zapo never calls — every zapo digest goes through `.digest()`
     * to a Buffer — and 25 ticks on the messaging bench is under that
     * lane's code-layout floor. */
    for (size_t i = 0; i < n; i++) {
      buf[i * 2] = hex[d[i] >> 4];
      buf[i * 2 + 1] = hex[d[i] & 0x0f];
    }
    return scr_str_new(buf, n * 2);
  }
  /* base64, standard alphabet, '=' padded — Buffer.toString("base64"). */
  static const char b64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  char buf[96];
  size_t o = 0;
  for (size_t i = 0; i < n; i += 3) {
    unsigned v = (unsigned)d[i] << 16;
    if (i + 1 < n) v |= (unsigned)d[i + 1] << 8;
    if (i + 2 < n) v |= (unsigned)d[i + 2];
    buf[o++] = b64[(v >> 18) & 63];
    buf[o++] = b64[(v >> 12) & 63];
    buf[o++] = i + 1 < n ? b64[(v >> 6) & 63] : '=';
    buf[o++] = i + 2 < n ? b64[v & 63] : '=';
  }
  return scr_str_new(buf, o);
}

/* ── MD5 (RFC 1321) — island npm code only (the static frontend fences
 * every non-SHA algorithm literal; published packages hash cache keys and
 * etags with md5, so the island's createHash carries it). ─────────── */

static const uint32_t scr_md5_k[64] = {
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a,
    0xa8304613, 0xfd469501, 0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
    0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821, 0xf61e2562, 0xc040b340,
    0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8,
    0x676f02d9, 0x8d2a4c8a, 0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
    0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70, 0x289b7ec6, 0xeaa127fa,
    0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92,
    0xffeff47d, 0x85845dd1, 0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
    0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391};
static const unsigned char scr_md5_r[64] = {
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9,  14, 20, 5, 9,  14, 20, 5, 9,  14, 20, 5, 9,  14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21};

static void scr_md5_block(uint32_t h[4], const unsigned char *p) {
  uint32_t m[16];
  for (int i = 0; i < 16; i++) {
    m[i] = (uint32_t)p[i * 4] | ((uint32_t)p[i * 4 + 1] << 8) |
           ((uint32_t)p[i * 4 + 2] << 16) | ((uint32_t)p[i * 4 + 3] << 24);
  }
  uint32_t a = h[0], b = h[1], c = h[2], d = h[3];
  for (int i = 0; i < 64; i++) {
    uint32_t f, g;
    if (i < 16) { f = (b & c) | (~b & d); g = (uint32_t)i; }
    else if (i < 32) { f = (d & b) | (~d & c); g = (5u * i + 1) & 15; }
    else if (i < 48) { f = b ^ c ^ d; g = (3u * i + 5) & 15; }
    else { f = c ^ (b | ~d); g = (7u * i) & 15; }
    uint32_t t = d;
    d = c;
    c = b;
    uint32_t x = a + f + scr_md5_k[i] + m[g];
    b = b + ((x << scr_md5_r[i]) | (x >> (32 - scr_md5_r[i])));
    a = t;
  }
  h[0] += a; h[1] += b; h[2] += c; h[3] += d;
}

static size_t scr_md5_digest(const unsigned char *data, size_t len, unsigned char out[32]) {
#ifdef SCR_SHACEN_ON
  scr_shacen_note(SCR_SHACEN_MD5, (long long)len);
#endif
  uint32_t h[4] = {0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476};
  size_t i = 0;
  for (; i + 64 <= len; i += 64) scr_md5_block(h, data + i);
  unsigned char tail[128];
  size_t rem = len - i;
  memcpy(tail, data + i, rem);
  tail[rem] = 0x80;
  size_t pad = (rem + 1 + 8 <= 64) ? 64 : 128;
  memset(tail + rem + 1, 0, pad - rem - 1 - 8);
  uint64_t bits = (uint64_t)len * 8;
  for (int b = 0; b < 8; b++) tail[pad - 8 + b] = (unsigned char)(bits >> (8 * b));
  scr_md5_block(h, tail);
  if (pad == 128) scr_md5_block(h, tail + 64);
  for (int j = 0; j < 4; j++) {
    for (int b = 0; b < 4; b++) out[j * 4 + b] = (unsigned char)(h[j] >> (8 * b));
  }
  return 16;
}

/* One-shot digest by algorithm name — the island crypto shim's bridge
 * (createHash concatenates its update() chunks JS-side). Returns the
 * digest length, 0 for an unknown algorithm. */
size_t scr_crypto_digest_raw(const char *alg, const unsigned char *data, size_t len,
                             unsigned char out[32]) {
  if (strcmp(alg, "sha256") == 0) return scr_sha256_digest(data, len, out);
  if (strcmp(alg, "sha1") == 0) return scr_sha1_digest(data, len, out);
  if (strcmp(alg, "md5") == 0) return scr_md5_digest(data, len, out);
  return 0;
}

/* How much of `ipad || message` an HMAC builds on the stack before it asks
 * the heap. 512 bytes covers a 128-byte SHA-512 block plus a 384-byte
 * message. Sized from a measured distribution rather than guessed: in a full
 * paired zapo session (tests/perf/shacensus) all 276 HMAC messages are 333
 * bytes or shorter, 87% are 57 or shorter, and the single commonest length
 * is ONE byte. The heap arm is not dead code — a longer message takes it,
 * and tests/corpus/6481 hashes messages on both sides of this bound. */
#define SCR_HMAC_INNER_STACK 512

/* HMAC (RFC 2104) over the same digests — block size 64 for all three. */
size_t scr_crypto_hmac_raw(const char *alg, const unsigned char *key, size_t keylen,
                           const unsigned char *data, size_t len, unsigned char out[32]) {
  unsigned char kblock[64];
  unsigned char kd[32];
#ifdef SCR_SHACEN_ON
  scr_shacen_note(SCR_SHACEN_HMAC, (long long)len);
  scr_shacen_note(SCR_SHACEN_HMACKEY, (long long)keylen);
#endif
  if (keylen > 64) {
    size_t kn = scr_crypto_digest_raw(alg, key, keylen, kd);
    if (kn == 0) return 0;
    memset(kblock, 0, 64);
    memcpy(kblock, kd, kn);
  } else {
    memset(kblock, 0, 64);
    memcpy(kblock, key, keylen);
  }
  unsigned char istack[SCR_HMAC_INNER_STACK];
  unsigned char *iheap = NULL;
  unsigned char *inner = istack;
  if (64 + len > sizeof istack) {
    iheap = malloc(64 + len);
    if (!iheap) return 0;
    inner = iheap;
  }
  for (int i = 0; i < 64; i++) inner[i] = kblock[i] ^ 0x36;
  memcpy(inner + 64, data, len);
  unsigned char ih[32];
  size_t in = scr_crypto_digest_raw(alg, inner, 64 + len, ih);
  free(iheap);
  if (in == 0) return 0;
  unsigned char outer[96];
  for (int i = 0; i < 64; i++) outer[i] = kblock[i] ^ 0x5c;
  memcpy(outer + 64, ih, in);
  return scr_crypto_digest_raw(alg, outer, 64 + in, out);
}

/* sha1, sha256, sha512 or md5 — the compiler fences every other algorithm
 * literal, so the name only has to separate these four. */
static size_t scr_hash_by_name(const ScrStr *alg, const unsigned char *data, size_t len,
                               unsigned char out[64]) {
  if (alg->len == 4 && memcmp(alg->data, "sha1", 4) == 0) return scr_sha1_digest(data, len, out);
  if (alg->len == 6 && memcmp(alg->data, "sha512", 6) == 0) return scr_sha512_digest(data, len, out);
  if (alg->len == 3 && memcmp(alg->data, "md5", 3) == 0) return scr_md5_digest(data, len, out);
  return scr_sha256_digest(data, len, out);
}

static ScrStr *scr_hash_digest_raw(const ScrStr *alg, const unsigned char *data, size_t len,
                                    const ScrStr *enc) {
  unsigned char d[64];
  size_t n = scr_hash_by_name(alg, data, len, d);
  return scr_digest_encode(d, n, enc);
}

/* Strings hash their UTF-8 bytes (Node's default input encoding — ScrStr
 * storage IS utf8, so the bytes are the string's own). Borrowed; +1. */
ScrStr *scr_crypto_hash_digest_str(ScrStr *alg, ScrStr *data, ScrStr *enc) {
  return scr_hash_digest_raw(alg, (const unsigned char *)data->data, data->len, enc);
}

ScrStr *scr_crypto_hash_digest_bytes(ScrStr *alg, ScrBytes *data, ScrStr *enc) {
  return scr_hash_digest_raw(alg, data->data, data->len * scr_bytes_elem_size(data->elem), enc);
}

/* Bare `.digest()` (no encoding): Node hands back the raw digest as a Buffer.
 * Same algorithms the compiler admits; the bytes are copied into a fresh
 * u8 ScrBytes instead of being hex/base64-encoded. */
static ScrBytes *scr_hash_digest_raw_bytes(const ScrStr *alg, const unsigned char *data,
                                           size_t len) {
  unsigned char d[64];
  size_t n = scr_hash_by_name(alg, data, len, d);
  ScrBytes *out = scr_bytes_new(SCR_BYTES_U8, (double)n);
  if (n > 0) memcpy(out->data, d, n);
  return scr_bytes_stamp_buffer(out); /* Node: digest() answers a Buffer */
}

ScrBytes *scr_crypto_hash_digest_str_raw(ScrStr *alg, ScrStr *data) {
  return scr_hash_digest_raw_bytes(alg, (const unsigned char *)data->data, data->len);
}

ScrBytes *scr_crypto_hash_digest_bytes_raw(ScrStr *alg, ScrBytes *data) {
  return scr_hash_digest_raw_bytes(alg, data->data, data->len * scr_bytes_elem_size(data->elem));
}

/* ── The MATERIALIZED Hash handle ─────────────────────────────────────
 * The chain above is the fast path and stays; this is what the shapes it
 * cannot see get — the handle bound to a variable, passed through a
 * function, updated in a loop, returned. It ACCUMULATES the message and
 * hashes it at digest() rather than keeping a compression state: the
 * one-shot cores above are then reused exactly, with no second
 * implementation of the padding to keep in agreement, and everything a
 * compiled program hashes is already resident. */

/* The accumulator both digest handles share. */
static void scr_msg_append(unsigned char **buf, size_t *len, size_t *cap,
                           const unsigned char *p, size_t n) {
  if (n == 0) return;
  if (*len + n > *cap) {
    size_t next_cap = *cap ? *cap * 2 : 64;
    while (next_cap < *len + n) next_cap *= 2;
    unsigned char *next = realloc(*buf, next_cap);
    if (!next) scr_trap("scriptc: out of memory\n");
    *buf = next;
    *cap = next_cap;
  }
  memcpy(*buf + *len, p, n);
  *len += n;
}

static void scr_hash_append(ScrHash *h, const unsigned char *p, size_t n) {
  scr_msg_append(&h->msg, &h->len, &h->cap, p, n);
}

/* The digest core an algorithm id names. */
static size_t scr_digest_by_id(int alg, const unsigned char *p, size_t n, unsigned char out[64]) {
  if (alg == SCR_HASH_SHA1) return scr_sha1_digest(p, n, out);
  if (alg == SCR_HASH_SHA512) return scr_sha512_digest(p, n, out);
  if (alg == SCR_HASH_MD5) return scr_md5_digest(p, n, out);
  return scr_sha256_digest(p, n, out);
}

/* The algorithm id a compiler-fenced literal names. */
static int scr_alg_id(const ScrStr *alg) {
  if (alg->len == 4 && memcmp(alg->data, "sha1", 4) == 0) return SCR_HASH_SHA1;
  if (alg->len == 6 && memcmp(alg->data, "sha512", 6) == 0) return SCR_HASH_SHA512;
  if (alg->len == 3 && memcmp(alg->data, "md5", 3) == 0) return SCR_HASH_MD5;
  return SCR_HASH_SHA256;
}

/* Node's update() returns the hash itself, and callers chain on it — so
 * the answer is the same handle, retained for the value the chain hands
 * on. Strings append their UTF-8 bytes (ScrStr storage IS utf8). */
ScrHash *scr_hash_new(ScrStr *alg) {
  ScrHash *h = malloc(sizeof(ScrHash));
  if (!h) scr_trap("scriptc: out of memory\n");
  scr_hash_alloc_note();
  h->rc = 1;
  h->alg = scr_alg_id(alg); /* only the three the compiler admits reach here */
  h->msg = NULL;
  h->len = 0;
  h->cap = 0;
  return h;
}

ScrHash *scr_hash_retain(ScrHash *h) {
  if (h && h->rc != SIZE_MAX) h->rc++;
  return h;
}

void scr_hash_release(ScrHash *h) {
  if (!h || h->rc == SIZE_MAX) return;
  if (--h->rc == 0) {
    scr_hash_free_note();
    free(h->msg);
    free(h);
  }
}

void *scr_hash_retain_v(void *h) { return scr_hash_retain((ScrHash *)h); }
void scr_hash_release_v(void *h) { scr_hash_release((ScrHash *)h); }

ScrHash *scr_hash_update_str(ScrHash *h, ScrStr *data) {
  scr_hash_append(h, (const unsigned char *)data->data, data->len);
  return scr_hash_retain(h);
}

ScrHash *scr_hash_update_bytes(ScrHash *h, ScrBytes *data) {
  scr_hash_append(h, data->data, data->len * scr_bytes_elem_size(data->elem));
  return scr_hash_retain(h);
}

/* digest() does NOT consume the handle here. Node's does — a second
 * digest() throws ERR_CRYPTO_HASH_FINALIZED — but a compiled program that
 * reaches the second call has already diverged, and answering the same
 * digest is the quieter wrong answer than a use-after-free. */
static size_t scr_hash_finish(ScrHash *h, unsigned char out[64]) {
  const unsigned char *p = h->msg ? h->msg : (const unsigned char *)"";
  return scr_digest_by_id(h->alg, p, h->len, out);
}

ScrBytes *scr_hash_digest_raw_buf(ScrHash *h) {
  unsigned char d[64];
  size_t n = scr_hash_finish(h, d);
  ScrBytes *out = scr_bytes_new(SCR_BYTES_U8, (double)n);
  if (n > 0) memcpy(out->data, d, n);
  return scr_bytes_stamp_buffer(out); /* Node: digest() answers a Buffer */
}

ScrStr *scr_hash_digest_enc(ScrHash *h, ScrStr *enc) {
  unsigned char d[64];
  size_t n = scr_hash_finish(h, d);
  return scr_digest_encode(d, n, enc);
}

/* ── The MATERIALIZED Hmac handle (RFC 2104) ───────────────────────────
 * Hash's twin: the same accumulate-then-compute handle with a key beside
 * the message. The key is COPIED at construction (Node's createHmac reads
 * it once; a caller is free to overwrite its buffer afterwards) and wiped
 * on the last release. Block size is the hash's own — 64 for sha1/sha256,
 * 128 for sha512. */

ScrHmac *scr_hmac_new_bytes(ScrStr *alg, ScrBytes *key) {
  return scr_hmac_new_raw(alg, key->data, key->len * scr_bytes_elem_size(key->elem));
}

ScrHmac *scr_hmac_new_str(ScrStr *alg, ScrStr *key) {
  return scr_hmac_new_raw(alg, (const unsigned char *)key->data, key->len);
}

ScrHmac *scr_hmac_new_raw(ScrStr *alg, const unsigned char *key, size_t keylen) {
  ScrHmac *h = malloc(sizeof(ScrHmac));
  if (!h) scr_trap("scriptc: out of memory\n");
  scr_hmac_alloc_note();
  h->rc = 1;
  h->alg = scr_alg_id(alg);
  h->msg = NULL;
  h->len = 0;
  h->cap = 0;
  h->keylen = keylen;
  h->key = NULL;
  if (keylen > 0) {
    h->key = malloc(keylen);
    if (!h->key) scr_trap("scriptc: out of memory\n");
    memcpy(h->key, key, keylen);
  }
  return h;
}

ScrHmac *scr_hmac_retain(ScrHmac *h) {
  if (h && h->rc != SIZE_MAX) h->rc++;
  return h;
}

void scr_hmac_release(ScrHmac *h) {
  if (!h || h->rc == SIZE_MAX) return;
  if (--h->rc == 0) {
    scr_hmac_free_note();
    if (h->key) {
      memset(h->key, 0, h->keylen); /* the key is a secret: wipe, then free */
      free(h->key);
    }
    free(h->msg);
    free(h);
  }
}

void *scr_hmac_retain_v(void *h) { return scr_hmac_retain((ScrHmac *)h); }
void scr_hmac_release_v(void *h) { scr_hmac_release((ScrHmac *)h); }

ScrHmac *scr_hmac_update_str(ScrHmac *h, ScrStr *data) {
  scr_msg_append(&h->msg, &h->len, &h->cap, (const unsigned char *)data->data, data->len);
  return scr_hmac_retain(h);
}

ScrHmac *scr_hmac_update_bytes(ScrHmac *h, ScrBytes *data) {
  scr_msg_append(&h->msg, &h->len, &h->cap, data->data,
                 data->len * scr_bytes_elem_size(data->elem));
  return scr_hmac_retain(h);
}

static size_t scr_hmac_finish(ScrHmac *h, unsigned char out[64]) {
  const size_t block = h->alg == SCR_HASH_SHA512 ? 128u : 64u;
#ifdef SCR_SHACEN_ON
  scr_shacen_note(SCR_SHACEN_HMAC, (long long)h->len);
  scr_shacen_note(SCR_SHACEN_HMACKEY, (long long)h->keylen);
#endif
  unsigned char k0[128];
  memset(k0, 0, block);
  if (h->keylen > block) {
    /* RFC 2104: a key longer than the block is replaced by its digest. */
    unsigned char kd[64];
    size_t kn = scr_digest_by_id(h->alg, h->key, h->keylen, kd);
    memcpy(k0, kd, kn);
  } else if (h->keylen > 0) {
    memcpy(k0, h->key, h->keylen);
  }
  /* ipad || message. This was a malloc and a free on EVERY hmac, which on
   * this host is ~115 cycles against ~550 for the two digests themselves —
   * a sixth of an HMAC, spent on a buffer that is almost always tiny. See
   * SCR_HMAC_INNER_STACK for the measured distribution it is sized from. */
  unsigned char istack[SCR_HMAC_INNER_STACK];
  unsigned char *iheap = NULL;
  unsigned char *inner = istack;
  if (block + h->len > sizeof istack) {
    iheap = (unsigned char *)malloc(block + h->len);
    inner = iheap;
  }
  if (!inner) scr_trap("scriptc: out of memory\n");
  for (size_t i = 0; i < block; i++) inner[i] = (unsigned char)(k0[i] ^ 0x36);
  if (h->len > 0) memcpy(inner + block, h->msg, h->len);
  unsigned char ih[64];
  size_t in = scr_digest_by_id(h->alg, inner, block + h->len, ih);
  free(iheap); /* NULL when the stack arm was taken; never `inner` */
  unsigned char outer[128 + 64];
  for (size_t i = 0; i < block; i++) outer[i] = (unsigned char)(k0[i] ^ 0x5c);
  memcpy(outer + block, ih, in);
  return scr_digest_by_id(h->alg, outer, block + in, out);
}

ScrBytes *scr_hmac_digest_raw_buf(ScrHmac *h) {
  unsigned char d[64];
  size_t n = scr_hmac_finish(h, d);
  ScrBytes *out = scr_bytes_new(SCR_BYTES_U8, (double)n);
  if (n > 0) memcpy(out->data, d, n);
  return scr_bytes_stamp_buffer(out); /* Node: digest() answers a Buffer */
}

ScrStr *scr_hmac_digest_enc(ScrHmac *h, ScrStr *enc) {
  unsigned char d[64];
  size_t n = scr_hmac_finish(h, d);
  return scr_digest_encode(d, n, enc);
}

/* The composed `new crypto.X509Certificate(data).fingerprint` read, fused
 * by the compiler (no certificate handle exists). Node's .fingerprint IS
 * the SHA-1 of the certificate's DER bytes, uppercase colon-separated —
 * pinned against Node. Accepts what Node's constructor accepts from the
 * fs.readFileSync idiom: PEM (the armor's base64 body decodes to DER,
 * Node-leniently — whitespace skipped) or raw DER (a leading SEQUENCE
 * tag). Anything else throws Node's exact PEM error (Error, code
 * ERR_OSSL_PEM_NO_START_LINE). Input borrowed; result +1. */
static ScrStr *scr_x509_fingerprint_raw(const uint8_t *in, size_t n);

ScrStr *scr_crypto_x509_fingerprint(ScrBytes *data) {
  return scr_x509_fingerprint_raw(data->data, data->len * scr_bytes_elem_size(data->elem));
}

/* The string-input form (readFileSync(path, "utf-8") — PEM text; ScrStr
 * storage IS the bytes). */
ScrStr *scr_crypto_x509_fingerprint_str(ScrStr *pem) {
  return scr_x509_fingerprint_raw((const uint8_t *)pem->data, pem->len);
}

/* PEM armor → DER (or raw-DER passthrough), the shared front half of
 * every X509Certificate member. On success `*der`/`*der_len` hold the
 * certificate bytes and `*decoded` the malloc'd base64 buffer to free
 * (NULL for raw-DER input); unparseable input throws Node's exact PEM
 * error and answers false with the exception pending. */
static bool scr_x509_der(const uint8_t *in, size_t n, const uint8_t **der, size_t *der_len,
                          uint8_t **decoded) {
  static const char begin[] = "-----BEGIN CERTIFICATE-----";
  static const char end[] = "-----END CERTIFICATE-----";
  *der = NULL;
  *der_len = 0;
  *decoded = NULL;
  /* PEM: base64-decode the armor's body. */
  const uint8_t *b = NULL;
  for (size_t i = 0; i + sizeof begin - 1 <= n; i++) {
    if (memcmp(in + i, begin, sizeof begin - 1) == 0) {
      b = in + i + sizeof begin - 1;
      break;
    }
  }
  if (b != NULL) {
    const uint8_t *stop = in + n;
    for (const uint8_t *p = b; p + sizeof end - 1 <= in + n; p++) {
      if (memcmp(p, end, sizeof end - 1) == 0) {
        stop = p;
        break;
      }
    }
    uint8_t *out = malloc(((size_t)(stop - b) / 4 + 1) * 3 + 3);
    if (!out) {
      scr_trap("scriptc: out of memory\n");
    }
    size_t o = 0;
    unsigned acc = 0;
    int have = 0;
    for (const uint8_t *p = b; p < stop; p++) {
      int v;
      uint8_t c = *p;
      if (c >= 'A' && c <= 'Z') v = c - 'A';
      else if (c >= 'a' && c <= 'z') v = c - 'a' + 26;
      else if (c >= '0' && c <= '9') v = c - '0' + 52;
      else if (c == '+') v = 62;
      else if (c == '/') v = 63;
      else continue; /* whitespace, '=' */
      acc = (acc << 6) | (unsigned)v;
      if (++have == 4) {
        out[o++] = (uint8_t)(acc >> 16);
        out[o++] = (uint8_t)(acc >> 8);
        out[o++] = (uint8_t)acc;
        acc = 0;
        have = 0;
      }
    }
    if (have == 2) out[o++] = (uint8_t)(acc >> 4);
    else if (have == 3) {
      out[o++] = (uint8_t)(acc >> 10);
      out[o++] = (uint8_t)(acc >> 2);
    }
    *decoded = out;
    *der = out;
    *der_len = o;
    return true;
  }
  if (n > 0 && in[0] == 0x30) {
    /* Raw DER: the certificate SEQUENCE. */
    *der = in;
    *der_len = n;
    return true;
  }
  scr_throw_error_msg_code(SCR_ERR_ERROR,
                            "error:0480006C:PEM routines::no start line",
                            42, "ERR_OSSL_PEM_NO_START_LINE");
  return false; /* exception pending */
}

static ScrStr *scr_x509_fingerprint_raw(const uint8_t *in, size_t n) {
  const uint8_t *der;
  size_t der_len;
  uint8_t *decoded;
  if (!scr_x509_der(in, n, &der, &der_len, &decoded)) return NULL;
  unsigned char digest[32];
  size_t dn = scr_sha1_digest(der, der_len, digest);
  free(decoded);
  char buf[64];
  static const char hex[] = "0123456789ABCDEF";
  size_t o = 0;
  for (size_t i = 0; i < dn; i++) {
    if (i > 0) buf[o++] = ':';
    buf[o++] = hex[digest[i] >> 4];
    buf[o++] = hex[digest[i] & 0x0f];
  }
  return scr_str_new(buf, o);
}

/* ── the certificate's Validity window (validFrom / validTo) ─────────────
 *
 * A minimal DER walk to TBSCertificate.validity: Certificate ::= SEQUENCE
 * { tbsCertificate SEQUENCE { version [0] OPTIONAL, serialNumber INTEGER,
 * signature SEQUENCE, issuer, validity SEQUENCE { notBefore, notAfter },
 * ... } }. Each Time is UTCTime (YYMMDDHHMMSSZ; RFC 5280's 50-year pivot)
 * or GeneralizedTime (YYYYMMDDHHMMSSZ), rendered in Node's exact
 * ASN1_TIME_print shape: "Jul  1 00:00:00 2026 GMT" (%2d space-padded
 * day). Truncated/non-Zulu encodings (RFC 5280 forbids them in certs)
 * and walk failures answer OpenSSL's "Bad time value". */

/* Reads one DER TL header at p (before end): tag to *tag, content length
 * to *len, and answers the content pointer (NULL on malformed/overlong). */
static const uint8_t *scr_der_tl(const uint8_t *p, const uint8_t *end, uint8_t *tag, size_t *len) {
  if (p == NULL || end - p < 2) return NULL;
  *tag = p[0];
  uint8_t l0 = p[1];
  const uint8_t *content = p + 2;
  size_t l;
  if (l0 < 0x80) {
    l = l0;
  } else {
    size_t nb = l0 & 0x7f;
    if (nb == 0 || nb > sizeof(size_t) || end - content < (ptrdiff_t)nb) return NULL;
    l = 0;
    for (size_t i = 0; i < nb; i++) l = (l << 8) | content[i];
    content += nb;
  }
  if ((size_t)(end - content) < l) return NULL;
  *tag = p[0];
  *len = l;
  return content;
}

/* Formats one Time element (UTCTime/GeneralizedTime content bytes) in
 * ASN1_TIME_print's shape into buf; answers the length (0 = bad value). */
static size_t scr_x509_time_print(uint8_t tag, const uint8_t *t, size_t n, char buf[32]) {
  static const char *mon[12] = {"Jan", "Feb", "Mar", "Apr", "May", "Jun",
                                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"};
  int year, mo, day, hh, mm, ss;
  const uint8_t *d = t;
  size_t need = tag == 0x17 ? 13 : 15; /* ...HHMMSSZ, Zulu only */
  if (n != need || t[n - 1] != 'Z') return 0;
  for (size_t i = 0; i + 1 < n; i++) {
    if (t[i] < '0' || t[i] > '9') return 0;
  }
#define SCR_DER_2D(p) (((p)[0] - '0') * 10 + ((p)[1] - '0'))
  if (tag == 0x17) {
    year = SCR_DER_2D(d);
    year += year < 50 ? 2000 : 1900; /* RFC 5280's UTCTime pivot */
    d += 2;
  } else {
    year = SCR_DER_2D(d) * 100;
    d += 2;
    year += SCR_DER_2D(d);
    d += 2;
  }
  mo = SCR_DER_2D(d); d += 2;
  day = SCR_DER_2D(d); d += 2;
  hh = SCR_DER_2D(d); d += 2;
  mm = SCR_DER_2D(d); d += 2;
  ss = SCR_DER_2D(d);
#undef SCR_DER_2D
  if (mo < 1 || mo > 12) return 0;
  int r = snprintf(buf, 32, "%s %2d %02d:%02d:%02d %d GMT", mon[mo - 1], day, hh, mm, ss, year);
  return r > 0 ? (size_t)r : 0;
}

static ScrStr *scr_x509_validity_raw(const uint8_t *in, size_t n, bool want_to) {
  const uint8_t *der;
  size_t der_len;
  uint8_t *decoded;
  if (!scr_x509_der(in, n, &der, &der_len, &decoded)) return NULL;
  static const char bad[] = "Bad time value";
  const uint8_t *end = der + der_len;
  uint8_t tag;
  size_t len;
  char buf[32];
  size_t blen = 0;
  /* Certificate SEQUENCE → tbsCertificate SEQUENCE */
  const uint8_t *p = scr_der_tl(der, end, &tag, &len);
  if (p && tag == 0x30) {
    end = p + len;
    p = scr_der_tl(p, end, &tag, &len);
  } else {
    p = NULL;
  }
  if (p && tag == 0x30) {
    const uint8_t *tbs_end = p + len;
    /* [0] version (optional), serialNumber, signature, issuer */
    const uint8_t *q = p;
    for (int skip = 0; skip < 4 && q != NULL; skip++) {
      const uint8_t *c = scr_der_tl(q, tbs_end, &tag, &len);
      if (!c) { q = NULL; break; }
      if (skip == 0 && tag != 0xA0) {
        /* no version field: this element is already serialNumber */
        skip++;
      }
      q = c + len;
    }
    /* validity SEQUENCE { notBefore, notAfter } */
    const uint8_t *v = scr_der_tl(q, tbs_end, &tag, &len);
    if (v && tag == 0x30) {
      const uint8_t *v_end = v + len;
      const uint8_t *t1 = scr_der_tl(v, v_end, &tag, &len);
      if (t1 && (tag == 0x17 || tag == 0x18)) {
        if (!want_to) {
          blen = scr_x509_time_print(tag, t1, len, buf);
        } else {
          const uint8_t *t2 = scr_der_tl(t1 + len, v_end, &tag, &len);
          if (t2 && (tag == 0x17 || tag == 0x18)) {
            blen = scr_x509_time_print(tag, t2, len, buf);
          }
        }
      }
    }
  }
  free(decoded);
  if (blen == 0) return scr_str_new(bad, sizeof bad - 1);
  return scr_str_new(buf, blen);
}

ScrStr *scr_crypto_x509_valid_from(ScrBytes *data) {
  return scr_x509_validity_raw(data->data, data->len * scr_bytes_elem_size(data->elem), false);
}

ScrStr *scr_crypto_x509_valid_from_str(ScrStr *pem) {
  return scr_x509_validity_raw((const uint8_t *)pem->data, pem->len, false);
}

ScrStr *scr_crypto_x509_valid_to(ScrBytes *data) {
  return scr_x509_validity_raw(data->data, data->len * scr_bytes_elem_size(data->elem), true);
}

ScrStr *scr_crypto_x509_valid_to_str(ScrStr *pem) {
  return scr_x509_validity_raw((const uint8_t *)pem->data, pem->len, true);
}

/* ── String surface (fromCharCode / lastIndexOf) ─────────────────────── */


/* String.fromCharCode core over n UTF-16 code units read through
 * `unit(src, i)` (already ToUint16'd): combine adjacent surrogate pairs,
 * substitute U+FFFD for lone surrogates (divergence 1's storage policy —
 * Node writing a lone surrogate to stdout produces the same replacement
 * bytes), UTF-8 encode. */
static ScrStr *scr_str_from_units(size_t n, uint32_t (*unit)(void *, size_t), void *src) {
  char *out = malloc(n * 3 + 1); /* worst case: 3 bytes per UTF-16 unit */
  if (!out) {
    scr_trap("scriptc: out of memory\n");
  }
  size_t o = 0;
  for (size_t i = 0; i < n; i++) {
    uint32_t cp = unit(src, i);
    if (cp >= 0xD800 && cp <= 0xDBFF && i + 1 < n) {
      uint32_t lo = unit(src, i + 1);
      if (lo >= 0xDC00 && lo <= 0xDFFF) {
        cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
        i++;
      } else {
        cp = 0xFFFD;
      }
    } else if (cp >= 0xD800 && cp <= 0xDFFF) {
      cp = 0xFFFD;
    }
    if (cp <= 0x7F) {
      out[o++] = (char)cp;
    } else if (cp <= 0x7FF) {
      out[o++] = (char)(0xC0 | (cp >> 6));
      out[o++] = (char)(0x80 | (cp & 0x3F));
    } else if (cp <= 0xFFFF) {
      out[o++] = (char)(0xE0 | (cp >> 12));
      out[o++] = (char)(0x80 | ((cp >> 6) & 0x3F));
      out[o++] = (char)(0x80 | (cp & 0x3F));
    } else {
      out[o++] = (char)(0xF0 | (cp >> 18));
      out[o++] = (char)(0x80 | ((cp >> 12) & 0x3F));
      out[o++] = (char)(0x80 | ((cp >> 6) & 0x3F));
      out[o++] = (char)(0x80 | (cp & 0x3F));
    }
  }
  ScrStr *s = scr_str_new(out, o);
  free(out);
  return s;
}

static uint32_t scr_fcc_arr_unit(void *src, size_t i) {
  return scr_to_uint32_inl(scr_arr_get_f64((ScrArr *)src, (double)i)) & 0xFFFFu;
}

/* String.fromCharCode(...codes) over ONE packed f64[]. */
ScrStr *scr_str_from_char_code(ScrArr *codes) {
  return scr_str_from_units(codes->len, scr_fcc_arr_unit, codes);
}

static uint32_t scr_fcc_bytes_unit(void *src, size_t i) {
  return scr_to_uint32_inl(scr_bytes_get((const ScrBytes *)src, (double)i)) & 0xFFFFu;
}

/* String.fromCharCode(...bytes) — a spread typed array/Buffer source (the
 * magic-number ASCII probe: String.fromCharCode(...data.slice(4, 8))).
 * u8 elements are plain code units; u32/f32 elements ride the same
 * ToUint16 the packed-array form applies. */
ScrStr *scr_str_from_char_code_bytes(ScrBytes *codes) {
  return scr_str_from_units(codes->len, scr_fcc_bytes_unit, codes);
}

/* UTF-16 unit count of the UTF-8 prefix ending at byte offset `end`
 * (ScrStr storage is well-formed, so lead bytes decide the advance). */
static size_t scr_lib_u16_units(const char *s, size_t end) {
  size_t units = 0;
  for (size_t i = 0; i < end;) {
    unsigned char b = (unsigned char)s[i];
    size_t adv = b < 0x80 ? 1 : b < 0xE0 ? 2 : b < 0xF0 ? 3 : 4;
    units += adv == 4 ? 2 : 1;
    i += adv;
  }
  return units;
}

/* lastIndexOf(needle), the one-argument form: last occurrence as a UTF-16
 * index, -1 when absent; the empty needle finds the length (per spec's
 * clamped +Infinity fromIndex). A byte-wise reverse scan is boundary-safe:
 * a well-formed needle's first byte is never a continuation byte. */
double scr_str_last_index_of(ScrStr *s, ScrStr *needle) {
  if (needle->len == 0) return (double)scr_lib_u16_units(s->data, s->len);
  if (needle->len > s->len) return -1.0;
  for (size_t i = s->len - needle->len + 1; i-- > 0;) {
    if (memcmp(s->data + i, needle->data, needle->len) == 0) {
      return (double)scr_lib_u16_units(s->data, i);
    }
  }
  return -1.0;
}

/* ── Date, the composed slice ──────────────────────────────────────────
 * Date values have no representation — the compiled surface is exactly
 * Date.now() and the composed new Date(ms?).toISOString(). */

double scr_date_now(void) {
  struct timespec ts;
  clock_gettime(CLOCK_REALTIME, &ts);
  /* Node's Date.now() is integer milliseconds. */
  return floor((double)ts.tv_sec * 1000.0 + (double)ts.tv_nsec / 1e6);
}

/* Node's Date.prototype.toISOString over a millisecond time value:
 * TimeClip's ToInteger truncation, proleptic Gregorian civil-from-days
 * (Howard Hinnant's algorithm), YYYY-MM-DDTHH:mm:ss.sssZ with expanded
 * ±YYYYYY years outside 0–9999, and Node's "Invalid time value"
 * RangeError on NaN / out-of-range values — verified against Node over
 * epoch, negative, fractional, boundary (±8.64e15), and expanded-year
 * inputs. */
ScrStr *scr_date_to_iso(double ms) {
  if (!(fabs(ms) <= 8640000000000000.0)) { /* NaN and out of range */
    scr_throw_error_msg(SCR_ERR_RANGE, "Invalid time value", 18);
    return NULL;
  }
  double t = trunc(ms);
  double dayd = floor(t / 86400000.0);
  long long msday = (long long)(t - dayd * 86400000.0);
  long long z = (long long)dayd + 719468;
  long long era = (z >= 0 ? z : z - 146096) / 146097;
  unsigned long long doe = (unsigned long long)(z - era * 146097);
  unsigned long long yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  long long y = (long long)yoe + era * 400;
  unsigned long long doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  unsigned long long mp = (5 * doy + 2) / 153;
  unsigned long long d = doy - (153 * mp + 2) / 5 + 1;
  unsigned long long m = mp < 10 ? mp + 3 : mp - 9;
  if (m <= 2) y += 1;
  int hh = (int)(msday / 3600000), mi = (int)(msday / 60000 % 60),
      ss = (int)(msday / 1000 % 60), sss = (int)(msday % 1000);
  char buf[40];
  int len;
  if (y < 0) {
    len = snprintf(buf, sizeof buf, "-%06lld-%02llu-%02lluT%02d:%02d:%02d.%03dZ", -y, m, d, hh, mi, ss, sss);
  } else if (y > 9999) {
    len = snprintf(buf, sizeof buf, "+%06lld-%02llu-%02lluT%02d:%02d:%02d.%03dZ", y, m, d, hh, mi, ss, sss);
  } else {
    len = snprintf(buf, sizeof buf, "%04lld-%02llu-%02lluT%02d:%02d:%02d.%03dZ", y, m, d, hh, mi, ss, sss);
  }
  return scr_str_new(buf, (size_t)len);
}

/* ── new Date(dateString).getTime() ──────────────────────────────────────
 *
 * The BOUNDED date-string parse (documented divergence — V8's parser
 * accepts far more): two grammars answer a time value, everything else is
 * NaN (Node's invalid-date getTime).
 *
 *   1. The ASN1_TIME_print shape X509Certificate.validFrom/validTo answer
 *      ("Jul  1 00:00:00 2026 GMT", "Jul 17 17:52:11 2026 GMT") — the
 *      portless cert-expiry read. Month names match case-insensitively;
 *      one or two spaces precede the day (%2d's padding).
 *   2. ECMA's own date-time string format with an EXPLICIT offset:
 *      YYYY[-MM[-DD]] date-only forms (UTC, per the spec) and full
 *      date-times YYYY-MM-DDTHH:mm[:ss[.sss]] ending in Z or ±HH:MM.
 *      Offset-less date-times are LOCAL time in JS; that arm answers NaN
 *      here rather than guessing a zone (the divergence note).
 */

/* Howard Hinnant's days_from_civil (the to_iso walk inverted). */
static double scr_days_from_civil(long long y, int m, int d) {
  y -= m <= 2;
  long long era = (y >= 0 ? y : y - 399) / 400;
  unsigned long long yoe = (unsigned long long)(y - era * 400);
  unsigned long long doy = (unsigned long long)((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1);
  unsigned long long doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return (double)(era * 146097 + (long long)doe - 719468);
}

static double scr_date_ms_of(long long y, int mo, int d, int hh, int mi, int ss, int ms) {
  /* V8 accepts days 1..31 in every month and ROLLS OVER past the month's
   * end (Feb 30 → Mar 2) — days_from_civil extrapolates linearly, so the
   * rollover falls out; day 0 and 32+ are NaN, like V8. */
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return NAN;
  if (hh > 24 || mi > 59 || ss > 59 || (hh == 24 && (mi || ss || ms))) return NAN;
  double t = scr_days_from_civil(y, mo, d) * 86400000.0 +
             hh * 3600000.0 + mi * 60000.0 + ss * 1000.0 + ms;
  if (fabs(t) > 8640000000000000.0) return NAN;
  return t;
}

static bool scr_date_digits(const char **p, const char *end, int n, int *out) {
  int v = 0;
  if (end - *p < n) return false;
  for (int i = 0; i < n; i++) {
    char c = (*p)[i];
    if (c < '0' || c > '9') return false;
    v = v * 10 + (c - '0');
  }
  *p += n;
  *out = v;
  return true;
}

double scr_date_parse_get_time(ScrStr *s) {
  const char *p = s->data;
  const char *end = s->data + s->len;
  static const char *mon[12] = {"Jan", "Feb", "Mar", "Apr", "May", "Jun",
                                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"};
  /* Grammar 1: "MMM [D]D HH:MM:SS YYYY GMT" (ASN1_TIME_print). */
  if (end - p > 3 && ((p[0] >= 'A' && p[0] <= 'Z') || (p[0] >= 'a' && p[0] <= 'z'))) {
    int mo = 0;
    for (int i = 0; i < 12; i++) {
      if (tolower((unsigned char)p[0]) == tolower((unsigned char)mon[i][0]) &&
          tolower((unsigned char)p[1]) == tolower((unsigned char)mon[i][1]) &&
          tolower((unsigned char)p[2]) == tolower((unsigned char)mon[i][2])) {
        mo = i + 1;
        break;
      }
    }
    if (mo == 0) return NAN;
    p += 3;
    if (p < end && *p == ' ') p++;
    if (p < end && *p == ' ') p++; /* %2d's padding space */
    int d = 0, hh, mi, ss, y;
    if (!scr_date_digits(&p, end, 1, &d)) return NAN;
    int d2;
    if (p < end && *p >= '0' && *p <= '9' && scr_date_digits(&p, end, 1, &d2)) d = d * 10 + d2;
    if (p >= end || *p++ != ' ') return NAN;
    if (!scr_date_digits(&p, end, 2, &hh) || p >= end || *p++ != ':') return NAN;
    if (!scr_date_digits(&p, end, 2, &mi) || p >= end || *p++ != ':') return NAN;
    if (!scr_date_digits(&p, end, 2, &ss) || p >= end || *p++ != ' ') return NAN;
    if (!scr_date_digits(&p, end, 4, &y)) return NAN;
    if (end - p != 4 || memcmp(p, " GMT", 4) != 0) return NAN;
    return scr_date_ms_of(y, mo, d, hh, mi, ss, 0);
  }
  /* Grammar 2: ECMA's date-time string format. */
  {
    int y, mo = 1, d = 1, hh = 0, mi = 0, ss = 0, ms = 0;
    bool sign_year = p < end && (*p == '+' || *p == '-');
    long long yy;
    if (sign_year) {
      int y6;
      bool neg = *p == '-';
      p++;
      if (!scr_date_digits(&p, end, 6, &y6)) return NAN;
      yy = neg ? -(long long)y6 : y6;
    } else {
      if (!scr_date_digits(&p, end, 4, &y)) return NAN;
      yy = y;
    }
    if (p < end && *p == '-') {
      p++;
      if (!scr_date_digits(&p, end, 2, &mo)) return NAN;
      if (p < end && *p == '-') {
        p++;
        if (!scr_date_digits(&p, end, 2, &d)) return NAN;
      }
    }
    if (p == end) return scr_date_ms_of(yy, mo, d, 0, 0, 0, 0); /* date-only: UTC */
    if (*p++ != 'T') return NAN;
    if (!scr_date_digits(&p, end, 2, &hh) || p >= end || *p++ != ':') return NAN;
    if (!scr_date_digits(&p, end, 2, &mi)) return NAN;
    if (p < end && *p == ':') {
      p++;
      if (!scr_date_digits(&p, end, 2, &ss)) return NAN;
      if (p < end && *p == '.') {
        p++;
        if (!scr_date_digits(&p, end, 3, &ms)) return NAN;
      }
    }
    if (p == end) return NAN; /* offset-less date-time: LOCAL in JS — the divergence */
    double off = 0;
    if (*p == 'Z') {
      p++;
    } else if (*p == '+' || *p == '-') {
      bool neg = *p == '-';
      int oh, om;
      p++;
      if (!scr_date_digits(&p, end, 2, &oh) || p >= end || *p++ != ':') return NAN;
      if (!scr_date_digits(&p, end, 2, &om)) return NAN;
      off = (oh * 60 + om) * 60000.0;
      if (neg) off = -off;
    } else {
      return NAN;
    }
    if (p != end) return NAN;
    double t = scr_date_ms_of(yy, mo, d, hh, mi, ss, ms);
    return isnan(t) ? t : t - off;
  }
}

/* Date.UTC(year, month, date, hours, minutes, seconds, ms) — the spec's
 * MakeDay/MakeTime/TimeClip pipeline over ALREADY-NUMBER arguments (tsc
 * pins them; the frontend completes omitted trailing arguments with the
 * spec's defaults: month 0, date 1, time parts 0). ToIntegerOrInfinity is
 * trunc on finite values; any non-finite part is NaN. Years 0–99 map to
 * 1900+year (the spec's MakeFullYear), out-of-range months ROLL into the
 * year (Date.UTC(2017, 13) is Feb 2018) and any integer date offsets from
 * day 1 of that month — days_from_civil extrapolates linearly, so both
 * rollovers fall out. V8 bounds MakeDay's year to ±1e6 (kMaxYear/kMinYear,
 * date.h) before TimeClip can see the result, and Node answers NaN past
 * it — matched here, and it keeps days_from_civil's long long exact.
 * Never throws. */
double scr_date_utc(double y, double mo, double d,
                    double h, double mi, double s, double ms) {
  if (!isfinite(y) || !isfinite(mo) || !isfinite(d) || !isfinite(h) ||
      !isfinite(mi) || !isfinite(s) || !isfinite(ms)) {
    return NAN;
  }
  y = trunc(y);
  mo = trunc(mo);
  d = trunc(d);
  h = trunc(h);
  mi = trunc(mi);
  s = trunc(s);
  ms = trunc(ms);
  if (y >= 0 && y <= 99) y += 1900;
  double ym = y + floor(mo / 12.0);
  int mn = (int)(mo - floor(mo / 12.0) * 12.0); /* 0..11 */
  if (fabs(ym) > 1000000.0) return NAN; /* V8's MakeDay year bound */
  double days = scr_days_from_civil((long long)ym, mn + 1, 1) + (d - 1.0);
  double t = days * 86400000.0 + h * 3600000.0 + mi * 60000.0 + s * 1000.0 + ms;
  if (fabs(t) > 8640000000000000.0) return NAN; /* TimeClip */
  return t == 0 ? 0 : t; /* normalize -0 (TimeClip's +0) */
}

/* ── Number statics ────────────────────────────────────────────────────
 * JS-exact: the ES2015 Number statics never coerce (unlike the global
 * isNaN/isFinite), and the compiler routes only number-typed arguments
 * here, so plain C predicates are the whole story. */

bool scr_num_is_finite(double x) { return isfinite(x) != 0; }

/* Number.prototype.toExponential() with fractionDigits UNDEFINED — the
 * spec's "as many digits as necessary": the shortest correctly-rounded
 * mantissa that round-trips, formatted d[.ddd]e±X with no zero-padding of
 * the exponent ("7e+0", "1.5e-7"). NaN → "NaN", ±Infinity → its text,
 * ±0 → "0e+0" (the spec's x = +0 arm — the sign of -0 is dropped because
 * -0 < 0 is false). Verified differentially against Node. */
ScrStr *scr_num_to_exponential(double x) {
  if (isnan(x)) return scr_str_new("NaN", 3);
  if (isinf(x)) return x < 0 ? scr_str_new("-Infinity", 9) : scr_str_new("Infinity", 8);
  if (x == 0) return scr_str_new("0e+0", 4);
  char buf[64];
  int len = 0;
  for (int prec = 0; prec <= 17; prec++) {
    len = snprintf(buf, sizeof buf, "%.*e", prec, x);
    if (strtod(buf, NULL) == x) break;
  }
  /* Normalize C's exponent ("e+05" / "e-123") to JS's ("e+5"/"e-123"):
   * drop leading zeros after the sign, keeping at least one digit. */
  char out[64];
  int o = 0;
  const char *e = memchr(buf, 'e', (size_t)len);
  const char *p = buf;
  while (p < e) out[o++] = *p++;
  out[o++] = 'e';
  p++; /* past 'e' */
  out[o++] = *p++; /* the sign — %e always emits one */
  while (*p == '0' && p[1] >= '0' && p[1] <= '9') p++;
  while (p < buf + len) out[o++] = *p++;
  return scr_str_new(out, (size_t)o);
}

/* Number.prototype.toFixed() with fractionDigits UNDEFINED (= 0 digits) —
 * the spec's pick of the integer n closest to x with ties toward the
 * LARGER n on the magnitude ((2.5).toFixed() = "3", (-2.5).toFixed() =
 * "-3" — printf's half-even would answer "2"), the "-0" result for
 * negative fractions rounding to zero, and ToString fallback at
 * |x| ≥ 1e21 (NaN and ±Infinity ride that arm's texts via ToString too,
 * matching the spec's early answers). */
ScrStr *scr_num_to_fixed0(double x) {
  if (isnan(x)) return scr_str_new("NaN", 3);
  if (fabs(x) >= 1e21) return scr_f64_to_scrstr(x);
  double a = fabs(x);
  double fl = floor(a);
  double n = (a - fl >= 0.5) ? fl + 1 : fl; /* exact: a < 2^70, and below
                                             * 2^52 the fraction is exact;
                                             * at/above it a - fl == 0 */
  ScrStr *digits = scr_f64_to_scrstr(n); /* n < 1e21 → never exponent form */
  if (!(x < 0)) return digits;
  size_t len = digits->len;
  char buf[64];
  buf[0] = '-';
  memcpy(buf + 1, digits->data, len);
  ScrStr *r = scr_str_new(buf, len + 1);
  scr_str_release(digits);
  return r;
}

/* The explicit-fraction-digits toFixed needs the exact binary value, not
 * the shortest decimal that round-trips to it: (1.005).toFixed(2) is
 * "1.00", for example. Represent abs(x) * 10^f as
 *
 *     mantissa * 5^f * 2^(binary_exponent + f)
 *
 * in a tiny base-2^32 integer, then shift right with the spec's
 * round-half-up rule. The largest value handled here is below 1e21 with
 * f=100, so the rounded integer is below 1e121 (402 bits); sixteen limbs
 * leave comfortable headroom without heap allocation. */
#define SCR_FIXED_LIMBS 16
typedef struct {
  uint32_t limb[SCR_FIXED_LIMBS]; /* little-endian */
  int len;
} ScrFixedInt;

static void scr_fixed_normalize(ScrFixedInt *v) {
  while (v->len > 1 && v->limb[v->len - 1] == 0) v->len--;
}

static void scr_fixed_mul5(ScrFixedInt *v) {
  uint64_t carry = 0;
  for (int i = 0; i < v->len; i++) {
    uint64_t p = (uint64_t)v->limb[i] * 5 + carry;
    v->limb[i] = (uint32_t)p;
    carry = p >> 32;
  }
  if (carry != 0) v->limb[v->len++] = (uint32_t)carry;
}

static bool scr_fixed_bit(const ScrFixedInt *v, int bit) {
  int word = bit / 32;
  return word < v->len && ((v->limb[word] >> (bit % 32)) & 1u) != 0;
}

static void scr_fixed_shr(ScrFixedInt *v, int bits) {
  int words = bits / 32;
  int rem = bits % 32;
  if (words >= v->len) {
    v->limb[0] = 0;
    v->len = 1;
    return;
  }
  int n = v->len - words;
  for (int i = 0; i < n; i++) {
    uint32_t lo = v->limb[i + words] >> rem;
    uint32_t hi =
        rem != 0 && i + words + 1 < v->len
            ? v->limb[i + words + 1] << (32 - rem)
            : 0;
    v->limb[i] = lo | hi;
  }
  v->len = n;
  scr_fixed_normalize(v);
}

static void scr_fixed_shl(ScrFixedInt *v, int bits) {
  uint32_t out[SCR_FIXED_LIMBS] = {0};
  int words = bits / 32;
  int rem = bits % 32;
  for (int i = 0; i < v->len; i++) {
    int at = i + words;
    out[at] |= v->limb[i] << rem;
    if (rem != 0) out[at + 1] |= v->limb[i] >> (32 - rem);
  }
  int n = v->len + words + (rem != 0 ? 1 : 0);
  memcpy(v->limb, out, sizeof out);
  v->len = n;
  scr_fixed_normalize(v);
}

static void scr_fixed_inc(ScrFixedInt *v) {
  uint64_t carry = 1;
  for (int i = 0; i < v->len && carry != 0; i++) {
    uint64_t s = (uint64_t)v->limb[i] + carry;
    v->limb[i] = (uint32_t)s;
    carry = s >> 32;
  }
  if (carry != 0) v->limb[v->len++] = (uint32_t)carry;
}

/* Divide in place by 1e9; each quotient limb still fits uint32_t because
 * the carried remainder is below the divisor. Returns the remainder. */
static uint32_t scr_fixed_div1e9(ScrFixedInt *v) {
  uint64_t rem = 0;
  for (int i = v->len - 1; i >= 0; i--) {
    uint64_t cur = (rem << 32) | v->limb[i];
    v->limb[i] = (uint32_t)(cur / 1000000000u);
    rem = cur % 1000000000u;
  }
  scr_fixed_normalize(v);
  return (uint32_t)rem;
}

/* Number.prototype.toFixed(fractionDigits), with the argument already
 * number-typed by the frontend. ToIntegerOrInfinity validation precedes
 * the receiver's non-finite arm, as ECMA-262 requires. Invalid precision
 * raises V8's catchable RangeError text; otherwise the result is +1. */
ScrStr *scr_num_to_fixed(double x, double fraction_digits) {
  double fd = isnan(fraction_digits) ? 0 : trunc(fraction_digits);
  if (!(fd >= 0 && fd <= 100)) {
    static const char msg[] =
        "toFixed() digits argument must be between 0 and 100";
    scr_throw_error_msg(SCR_ERR_RANGE, msg, sizeof msg - 1);
    return NULL;
  }
  int f = (int)fd;
  if (!isfinite(x) || fabs(x) >= 1e21) return scr_f64_to_scrstr(x);

  bool neg = x < 0; /* false for -0, exactly like the spec's sign arm */
  double a = neg ? -x : x;
  uint64_t bits;
  memcpy(&bits, &a, sizeof bits);
  uint64_t mantissa = bits & ((1ull << 52) - 1);
  int ieee_exp = (int)((bits >> 52) & 0x7ffu);
  int binary_exp;
  if (ieee_exp == 0) {
    binary_exp = -1074;
  } else {
    mantissa |= 1ull << 52;
    binary_exp = ieee_exp - 1023 - 52;
  }

  ScrFixedInt n = {{(uint32_t)mantissa, (uint32_t)(mantissa >> 32)}, 2};
  scr_fixed_normalize(&n);
  for (int i = 0; i < f; i++) scr_fixed_mul5(&n);
  int shift = binary_exp + f;
  if (shift >= 0) {
    scr_fixed_shl(&n, shift);
  } else {
    int right = -shift;
    bool round_up = scr_fixed_bit(&n, right - 1);
    scr_fixed_shr(&n, right);
    if (round_up) scr_fixed_inc(&n);
  }

  /* Render the exact rounded integer through base-1e9 chunks, then place
   * the decimal point f digits from the right (padding through zero). */
  uint32_t chunks[SCR_FIXED_LIMBS];
  int chunk_count = 0;
  do {
    chunks[chunk_count++] = scr_fixed_div1e9(&n);
  } while (!(n.len == 1 && n.limb[0] == 0));

  char digits[128];
  int dlen = snprintf(digits, sizeof digits, "%u", chunks[chunk_count - 1]);
  for (int i = chunk_count - 2; i >= 0; i--) {
    dlen += snprintf(digits + dlen, sizeof digits - (size_t)dlen,
                     "%09u", chunks[i]);
  }

  char out[128];
  int o = 0;
  if (neg) out[o++] = '-';
  int padded = dlen > f + 1 ? dlen : f + 1;
  int integer_digits = padded - f;
  int leading_zeros = padded - dlen;
  for (int i = 0; i < padded; i++) {
    if (f != 0 && i == integer_digits) out[o++] = '.';
    out[o++] = i < leading_zeros ? '0' : digits[i - leading_zeros];
  }
  return scr_str_new(out, (size_t)o);
}

/* Increment a decimal digit string in place. Returns true on overflow —
 * the value becomes 1 followed by len zeros (the caller folds the zeros
 * into its scale); an EMPTY string increments to "1" the same way (the
 * round-up-from-nothing case: 0.0005 at 3 fraction digits). */
static bool scr_dec_inc(char *d, int len) {
  for (int i = len - 1; i >= 0; i--) {
    if (d[i] != '9') {
      d[i]++;
      return false;
    }
    d[i] = '0';
  }
  d[0] = '1';
  return true;
}

/* Intl.NumberFormat("en-US").format(x) / x.toLocaleString("en-US") with
 * DEFAULT options: decimal notation, minimum 0 / maximum 3 fraction
 * digits, "," grouping every three integer digits, "∞"/"NaN" texts, and
 * "-0" whenever the input is negative or negative zero even after
 * rounding to zero. Rounding is half-up ON THE SHORTEST ROUND-TRIPPING
 * DECIMAL — ICU's rounding input, probed against Node: format(1.0005) is
 * "1.001" although the double is 1.000499... and toFixed(3) answers
 * "1.000"; format(1e23) prints the shortest form's trailing zeros, not
 * the double's exact expansion. The en-US/latn symbols (",", ".", "∞",
 * "NaN", group size 3) are the whole embedded locale surface. Verified
 * differentially against Node. Result +1; never throws. */
ScrStr *scr_intl_num_format_en_us(double x) {
  if (isnan(x)) return scr_str_new("NaN", 3);
  if (isinf(x)) {
    return x < 0 ? scr_str_new("-\xE2\x88\x9E", 4) : scr_str_new("\xE2\x88\x9E", 3);
  }
  bool neg = signbit(x) != 0;
  if (x == 0) return neg ? scr_str_new("-0", 2) : scr_str_new("0", 1);
  double a = neg ? -x : x;

  /* Shortest digits: value = 0.d × 10^n (no trailing zeros, k ≤ 17). */
  char d[18];
  int n;
  int k = scr_f64_digits(a, d, &n);

  /* Round at 3 fraction digits: fraction position p is digit index
   * n+p-1, so index n+3 is the first DROPPED digit. Half-up on the
   * decimal digits — the shortest string ends right after them, so
   * "first dropped digit ≥ 5" IS the whole decision. */
  int keep = n + 3;
  if (keep < k) {
    bool up = keep >= 0 && d[keep] >= '5';
    k = keep < 0 ? 0 : keep;
    if (up && scr_dec_inc(d, k)) {
      /* Carried out (all nines, or the round-up-from-nothing 0.0005
       * case): one leading 1, the dropped nines fold into the scale. */
      k = 1;
      n += 1;
    } else if (k == 0) {
      /* Everything rounded away: ±0 with the sign preserved. */
      return neg ? scr_str_new("-0", 2) : scr_str_new("0", 1);
    }
  }

  /* Assemble: integer digits (indices [0, n)), zero-padded past k, then
   * the ≤ 3 fraction digits (indices n..n+2, '0' outside [0, k)) with
   * trailing zeros trimmed, then commas every three integer digits. */
  char frac[3];
  int flen = 0;
  for (int p = 1; p <= 3; p++) {
    int idx = n + p - 1;
    frac[flen++] = (idx >= 0 && idx < k) ? d[idx] : '0';
  }
  while (flen > 0 && frac[flen - 1] == '0') flen--;

  char out[512];
  int o = 0;
  if (neg) out[o++] = '-';
  if (n <= 0) {
    out[o++] = '0';
  } else {
    for (int i = 0; i < n; i++) {
      if (i > 0 && (n - i) % 3 == 0) out[o++] = ',';
      out[o++] = (i < k) ? d[i] : '0';
    }
  }
  if (flen > 0) {
    out[o++] = '.';
    memcpy(out + o, frac, (size_t)flen);
    o += flen;
  }
  return scr_str_new(out, (size_t)o);
}

/* BCP-47 case normalization, in place over a '-'-separated tag: the
 * language lowercase, a 4-alpha script subtag Titlecase, a 2-alpha or
 * 3-digit region subtag uppercase, everything after that lowercase. The
 * spec says tag case is insignificant; ICU's ToLanguageTag nevertheless
 * emits exactly this spelling, and the tag is a STRING the program can
 * compare, so the byte-exact answer is the cased one. Position-driven,
 * like the grammar: only subtags 0..2 can be language/script/region, so
 * an extension singleton ("-u-ca-gregory") and variants stay lowercase. */
static void scr_locale_case_normalize(char *s) {
  int pos = 0;
  bool script_seen = false;
  char *p = s;
  while (*p) {
    char *q = p;
    while (*q && *q != '-') q++;
    size_t n = (size_t)(q - p);
    bool alpha = n > 0, digit = n > 0;
    for (size_t k = 0; k < n; k++) {
      if (!isalpha((unsigned char)p[k])) alpha = false;
      if (!isdigit((unsigned char)p[k])) digit = false;
    }
    /* 0 = lowercase, 1 = Titlecase, 2 = UPPERCASE */
    int form = 0;
    if (pos == 1 && n == 4 && alpha) {
      form = 1;
      script_seen = true;
    } else if ((pos == 1 || (pos == 2 && script_seen)) &&
               ((n == 2 && alpha) || (n == 3 && digit))) {
      form = 2;
    }
    for (size_t k = 0; k < n; k++) {
      unsigned char c = (unsigned char)p[k];
      p[k] = (char)(form == 2 || (form == 1 && k == 0) ? toupper(c) : tolower(c));
    }
    if (pos < 3) pos++;
    p = *q ? q + 1 : q;
  }
}

/* The environment's default locale as a BCP-47 language tag — the answer
 * behind `Intl.DateTimeFormat().resolvedOptions().locale`.
 *
 * This is a fact about the MACHINE, not about the runtime build (the
 * process.platform stance, not the process.versions.node one): a binary
 * shipped to a pt-BR user must answer "pt-BR" there. It carries no ICU
 * data — a locale NAME is environment info, like process.platform, where
 * locale DATA (collation, formats) stays outside the static runtime.
 *
 * V8 derives it (Intl::DefaultLocale) from icu::Locale::getDefault(),
 * whose id ICU builds in putil.cpp, with one special case of its own:
 * the C/POSIX locale ("en_US_POSIX" after ICU's own normalization) is
 * reported as "en-US", not as a language. Both arms below reproduce that
 * chain at its two ends:
 *
 *  - win32: GetUserDefaultLocaleName(), which Windows already spells as a
 *    BCP-47 tag and which ICU's win32 arm calls for exactly this.
 *    VALIDATED against Node v25.9.0 (full ICU 78.2) on a win32 host: both
 *    answer "en-US", and Node ignores LC_ALL/LANG here — the environment
 *    plays no part in the Windows answer, matching ICU's own arm.
 *  - POSIX: LC_ALL, else LC_MESSAGES, else LANG — ICU's
 *    uprv_getPOSIXIDForCategory, in that order — with the codeset and the
 *    modifier stripped ("pt_BR.UTF-8" names pt_BR) and '_' rewritten to
 *    '-'. REASONED FROM ICU/V8's documented derivation, not validated:
 *    this runtime has no POSIX host to differ against yet.
 *
 * Two declared gaps, both in the POSIX arm, both narrow and both silent
 * rather than wrong-shaped: an @modifier ("sr_RS@latin") is DROPPED where
 * ICU folds it into a script or a variant, and a locale ICU knows only by
 * an alias is passed through as spelled. Neither can arise on win32.
 *
 * Interned like process.platform and read at most once per process, which
 * is also Node's shape: ICU resolves its default locale once, at the
 * first Intl use, and later environment writes do not move it.
 * Result +1; never throws. */
ScrStr *scr_intl_default_locale(void) {
  if (!scr_default_locale_str) {
    char raw[128];
    raw[0] = '\0';
#ifdef _WIN32
    wchar_t wide[LOCALE_NAME_MAX_LENGTH];
    if (GetUserDefaultLocaleName(wide, LOCALE_NAME_MAX_LENGTH) > 0) {
      if (WideCharToMultiByte(CP_UTF8, 0, wide, -1, raw, (int)sizeof raw, NULL, NULL) <= 0) {
        raw[0] = '\0';
      }
    }
    /* A few Windows locale names carry a sort order ("de-DE_phoneb");
     * the language tag is the part before it. */
    {
      char *u = strchr(raw, '_');
      if (u) *u = '\0';
    }
#else
    const char *id = getenv("LC_ALL");
    if (!id || !*id) id = getenv("LC_MESSAGES");
    if (!id || !*id) id = getenv("LANG");
    if (id) {
      strncpy(raw, id, sizeof raw - 1);
      raw[sizeof raw - 1] = '\0';
    }
    /* "ll_CC.codeset@modifier" — the tag has room for neither tail. */
    {
      char *t = strpbrk(raw, ".@");
      if (t) *t = '\0';
    }
#endif
    /* V8's own fallback: the C/POSIX locale is not a language. Checked on
     * the raw id, before '_' becomes '-', because "en_US_POSIX" is ICU's
     * spelling of it. */
    if (raw[0] == '\0' || strcmp(raw, "C") == 0 || strcmp(raw, "POSIX") == 0 ||
        strcmp(raw, "en_US_POSIX") == 0) {
      strcpy(raw, "en-US");
    }
    for (char *p = raw; *p; p++) {
      if (*p == '_') *p = '-';
    }
    scr_locale_case_normalize(raw);
    scr_default_locale_str = scr_str_new(raw, strlen(raw));
  }
  return scr_str_retain(scr_default_locale_str);
}

/* Object.is over two numbers — the spec's SameValue on doubles: NaN
 * equals NaN, +0 differs from -0, everything else is ==. */
bool scr_num_same_value(double a, double b) {
  if (a != a) return b != b;
  if (a == 0 && b == 0) return signbit(a) == signbit(b);
  return a == b;
}

bool scr_num_is_nan(double x) { return isnan(x) != 0; }

bool scr_num_is_integer(double x) { return isfinite(x) && trunc(x) == x; }

bool scr_num_is_safe_integer(double x) {
  return isfinite(x) && trunc(x) == x && fabs(x) <= 9007199254740991.0;
}

/* ── bitwise operators ─────────────────────────────────────────────────────
 * JS-exact (scr_runtime.h has the contract AND, since the 30-instruction
 * measurement, the implementation: the seven are static inline twins there,
 * so a `&` the C backend emits is not a call any more).
 *
 * What stays here is the pair the inline path cannot be: the COLD ToUint32,
 * which is too big to inline and is never reached for |d| < 2^32; and the
 * seven EXTERNAL symbols, which the LLVM backend emits calls to by name
 * (llvm/emitter.ts maps "&" to scr_bit_and). Each is a one-line delegation,
 * so there is exactly one implementation of the semantics and both backends
 * answer from it.
 */

/* The general case: NaN, both infinities, and any |d| >= 2^32. Kept out of
 * line so the header's fast path stays a compare and a convert. trunc() and
 * fmod() are LIBRARY CALLS on a baseline x86-64 target (no SSE4.1 roundsd,
 * no frem lowering), which is why this is the cold arm and not the whole of
 * ToUint32: before the split a single `&` cost FOUR libm calls. */
uint32_t scr_to_uint32_slow(double d) {
  if (!isfinite(d)) return 0; /* NaN, +Infinity, -Infinity */
  double t = trunc(d);
  t = fmod(t, 4294967296.0); /* exact for doubles; result in (-2^32, 2^32) */
  if (t < 0) t += 4294967296.0;
  return (uint32_t)t;
}

double scr_bit_and(double a, double b) { return scr_bit_and_inl(a, b); }

double scr_bit_or(double a, double b) { return scr_bit_or_inl(a, b); }

double scr_bit_xor(double a, double b) { return scr_bit_xor_inl(a, b); }

double scr_bit_shl(double a, double b) { return scr_bit_shl_inl(a, b); }

double scr_bit_shr(double a, double b) { return scr_bit_shr_inl(a, b); }

double scr_bit_ushr(double a, double b) { return scr_bit_ushr_inl(a, b); }

double scr_bit_not(double a) { return scr_bit_not_inl(a); }

/* ── checked catch-binding cast (`e as C`) ────────────────────────────
 * The caught analog of the dyn boundary's checked casts: an OBJ payload
 * inside the class's preorder interval extracts (retained, +1); every
 * other payload throws a catchable TypeError naming the class. Node's
 * `as` is erasure — the runtime check is the documented trust-but-verify
 * stance for dynamic values, extended to exception payloads. */
void *scr_caught_check_obj(const ScrCaught *c, size_t pre, size_t post,
                            const char *cls) {
  if (scr_caught_instanceof(c, pre, post)) return c->retain_fn(c->payload);
  char msg[160];
  int len = snprintf(msg, sizeof msg,
                     "caught value is not an instance of %s (checked cast)",
                     cls);
  scr_throw_error_msg(SCR_ERR_TYPE, msg, (size_t)len);
  return NULL; /* callers are compiler-emitted pending checks */
}

/* ── Set → array drain ([...set]) ─────────────────────────────────────
 * The live entries in insertion order (tombstones skipped — the forEach
 * walk folded into one call; no user code runs mid-drain, so the
 * live-iteration rules are moot). Borrows the set; the array is +1,
 * string elements retained into it by the iter_key read. */
ScrArr *scr_set_to_arr_f64(const ScrMap *s) {
  size_t n = (size_t)scr_map_iter_count(s);
  ScrArr *out = scr_arr_new(SCR_ELEM_F64, (size_t)scr_map_size(s));
  for (size_t i = 0; i < n; i++) {
    if (!scr_map_iter_live(s, (double)i)) continue;
    scr_arr_push_f64(out, scr_map_iter_key_f64(s, (double)i));
  }
  return out;
}

ScrArr *scr_set_to_arr_str(const ScrMap *s) {
  size_t n = (size_t)scr_map_iter_count(s);
  ScrArr *out = scr_arr_new(SCR_ELEM_STR, (size_t)scr_map_size(s));
  for (size_t i = 0; i < n; i++) {
    if (!scr_map_iter_live(s, (double)i)) continue;
    scr_arr_push_ref(out, scr_map_iter_key_str(s, (double)i));
  }
  return out;
}

ScrArr *scr_set_to_arr_ref(const ScrMap *s) {
  size_t n = (size_t)scr_map_iter_count(s);
  /* The elements' adapters ride from the set (no trace: handle elements
   * are acyclic by the set's own construction rule). */
  ScrArr *out = scr_arr_new_ref(s->key_retain, s->key_release, NULL, (size_t)scr_map_size(s));
  for (size_t i = 0; i < n; i++) {
    if (!scr_map_iter_live(s, (double)i)) continue;
    scr_arr_push_ref(out, scr_map_iter_key_ref(s, (double)i));
  }
  return out;
}
