/* scr_sha_census.h — WHAT does the real program hash, how often, and how big?
 *
 * WHY THIS EXISTS. `scr_sha256_blocks` is 72.43% of the messaging bench's
 * SEND 1:1 scenario on the callgrind lane. That is a number about a BENCH,
 * and worse, it is a number about the SCALAR arm: valgrind's emulated CPUID
 * reports SHA=0, so the exact-instruction lane counts the fallback and never
 * executes the `sha256rnds2` path the shipping binary takes. (Measured here,
 * 2026-08-25: valgrind 3.25.1 answers SHA=0 under CPUID leaf 7 on a host
 * whose native answer is 1, and SIGILLs on `sha256rnds2` if the arm is
 * forced.) So neither the bench's share nor the bench's sizes transfer, and
 * the only way to know what zapo hashes is to count it in zapo.
 *
 * WHAT IT ANSWERS
 *   - per algorithm (sha256 / sha1 / sha512 / md5): call count, total bytes,
 *     longest input, and a per-length histogram — exact rows for 0..255
 *     bytes, then one row per power of two. The exact rows matter: a digest
 *     of 11 bytes and one of 150 are one block and three, and an aggregate
 *     over "128-255" cannot tell them apart.
 *   - for sha256, WHICH ARM the process took, read from the shipped
 *     dispatch's own memo rather than from the build flags — the difference
 *     between "SHA-NI is compiled in" and "SHA-NI ran".
 *   - the block loop: how many calls, how many 64-byte blocks.
 *   - HMAC: calls, key lengths, message lengths — the `malloc(64 + len)`
 *     inside `scr_crypto_hmac_raw` is charged per call, so its size
 *     distribution is the question that decides whether it matters.
 *
 * HOW TO USE IT
 *   SCRIPTC_PROF_CFLAGS="-include <win>/tests/perf/shacensus/scr_sha_census.h
 *                        -I<win>/tests/perf/shacensus"
 *   SCRIPTC_NO_CACHE=1              (the header is outside packages/runtime/src
 *                                    and so is not in the build-cache key)
 *   SCR_SHACEN_OUT=<file>           where the report is written
 *   SCR_SHACEN_ARM=<n>              THE POSITIVE CONTROL: hash n known
 *                                   messages at startup. A census that
 *                                   reports zero is then distinguishable
 *                                   from a census that never ran, which is
 *                                   the failure this fleet keeps finding.
 * <win> must be a WINDOWS path: `zig cc` is a native binary spawned by node
 * and never sees an MSYS mount point.
 *
 * The hooks are `#ifdef SCR_SHACEN_ON` blocks in scr_lib.c. With this header
 * absent the switch is undefined and every block vanishes, so an
 * uninstrumented build is unchanged — checked by building both and comparing
 * the exe, not assumed.
 *
 * Linkage follows scr_u16_census.h exactly: state is `selectany` (COMDAT,
 * one merged instance) and every function is `static`, because on
 * x86_64-windows-gnu a weak definition in each of zapo's translation units
 * is `lld-link: error: duplicate symbol` rather than one instance.
 *
 * NO <windows.h>: scr_fetch_dispatch.c's `fd_set` collides with it.
 */
#ifndef SCR_SHA_CENSUS_H
#define SCR_SHA_CENSUS_H

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* The switch scr_lib.c's hook lines test. */
#define SCR_SHACEN_ON 1

#define SCR_SHACEN_SHARED __attribute__((selectany))
#define SCR_SHACEN_FN static __attribute__((unused)) __attribute__((no_instrument_function))

#define SCR_SHACEN_EXACT 256
#define SCR_SHACEN_LOG 40
#define SCR_SHACEN_ROWS (SCR_SHACEN_EXACT + SCR_SHACEN_LOG)

/* algorithm slots */
#define SCR_SHACEN_SHA256 0
#define SCR_SHACEN_SHA1 1
#define SCR_SHACEN_SHA512 2
#define SCR_SHACEN_MD5 3
#define SCR_SHACEN_HMAC 4
#define SCR_SHACEN_HMACKEY 5
#define SCR_SHACEN_ALGS 6

SCR_SHACEN_FN int scr_shacen_row(long long n) {
  if (n < 0) return SCR_SHACEN_ROWS - 1;
  if (n < SCR_SHACEN_EXACT) return (int)n;
  {
    int b = 0;
    unsigned long long v = (unsigned long long)n;
    while (v > 1 && b < SCR_SHACEN_LOG - 1) { v >>= 1; b++; }
    return SCR_SHACEN_EXACT + b;
  }
}

SCR_SHACEN_SHARED long long scr_shacen_rows[SCR_SHACEN_ALGS][SCR_SHACEN_ROWS];
SCR_SHACEN_SHARED long long scr_shacen_calls[SCR_SHACEN_ALGS];
SCR_SHACEN_SHARED long long scr_shacen_bytes[SCR_SHACEN_ALGS];
SCR_SHACEN_SHARED long long scr_shacen_max[SCR_SHACEN_ALGS];
SCR_SHACEN_SHARED long long scr_shacen_blk_calls = 0;
SCR_SHACEN_SHARED long long scr_shacen_blk_blocks = 0;
SCR_SHACEN_SHARED int scr_shacen_arm = -2; /* -2 never asked, else the memo */
SCR_SHACEN_SHARED int scr_shacen_reported = 0;
SCR_SHACEN_SHARED int scr_shacen_planted = 0;

SCR_SHACEN_FN void scr_shacen_note(int alg, long long n) {
  if (alg < 0 || alg >= SCR_SHACEN_ALGS) return;
  scr_shacen_rows[alg][scr_shacen_row(n)]++;
  scr_shacen_calls[alg]++;
  scr_shacen_bytes[alg] += n;
  if (n > scr_shacen_max[alg]) scr_shacen_max[alg] = n;
}

SCR_SHACEN_FN void scr_shacen_note_blocks(long long nblk, int arm) {
  scr_shacen_blk_calls++;
  scr_shacen_blk_blocks += nblk;
  scr_shacen_arm = arm;
}

SCR_SHACEN_FN const char *scr_shacen_name(int a) {
  switch (a) {
    case SCR_SHACEN_SHA256: return "sha256";
    case SCR_SHACEN_SHA1: return "sha1";
    case SCR_SHACEN_SHA512: return "sha512";
    case SCR_SHACEN_MD5: return "md5";
    case SCR_SHACEN_HMAC: return "hmac-msg";
    default: return "hmac-key";
  }
}

SCR_SHACEN_FN void scr_shacen_report(void) {
  const char *path;
  FILE *f;
  int a, i;
  if (scr_shacen_reported) return;
  scr_shacen_reported = 1;
  path = getenv("SCR_SHACEN_OUT");
  f = fopen(path && *path ? path : "scr-shacen.txt", "w");
  if (!f) return;
  fprintf(f, "SHACEN-ARM memo=%d planted=%d exactRows=%d\n", scr_shacen_arm,
          scr_shacen_planted, (int)SCR_SHACEN_EXACT);
  fprintf(f, "SHACEN-BLOCKS calls=%lld blocks=%lld\n", scr_shacen_blk_calls,
          scr_shacen_blk_blocks);
  for (a = 0; a < SCR_SHACEN_ALGS; a++) {
    fprintf(f, "SHACEN-ALG %s calls=%lld bytes=%lld max=%lld\n", scr_shacen_name(a),
            scr_shacen_calls[a], scr_shacen_bytes[a], scr_shacen_max[a]);
  }
  for (a = 0; a < SCR_SHACEN_ALGS; a++) {
    for (i = 0; i < SCR_SHACEN_ROWS; i++) {
      if (scr_shacen_rows[a][i] == 0) continue;
      fprintf(f, "SHACEN-ROW %s %d %lld\n", scr_shacen_name(a), i, scr_shacen_rows[a][i]);
    }
  }
  fclose(f);
}

/* THE POSITIVE CONTROL is planted from scr_lib.c and not from here, because
 * scr_sha256_digest is static to that file: SCR_SHACEN_ARM=<n> hashes n
 * copies of a fixed 137-byte message before main runs, and the report's
 * sha256 row 137 must then read exactly n. A report that is missing, or
 * whose planted row is short, is DID-NOT-RUN and must not be read as "the
 * program does not hash" — which is the failure this fleet keeps finding.
 *
 * `__attribute__((destructor))` is NOT used and must not be: these PE
 * binaries have no `.CRT` termination section, so a destructor never runs
 * while its strings stay in the image and a byte scan calls it present.
 * atexit() runs; and for the exit path that skips even atexit, see the
 * _Exit interposition below. */
__attribute__((constructor)) SCR_SHACEN_FN void scr_shacen_install(void) {
  static int done = 0;
  if (done) return;
  done = 1;
  atexit(scr_shacen_report);
}

#ifdef _Exit
#undef _Exit
#endif
#if defined(SCR_U16_CENSUS_H)
#define _Exit(c) (scr_shacen_report(), scr_u16cen_report(), _Exit(c))
#else
#define _Exit(c) (scr_shacen_report(), _Exit(c))
#endif

#endif /* SCR_SHA_CENSUS_H */
