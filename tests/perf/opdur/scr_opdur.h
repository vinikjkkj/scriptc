/* scr_opdur.h (LAB ONLY, never lands on main): the duration distribution of selected SYNC runtime operations.
 * Used as SCRIPTC_PROF_CFLAGS='-finstrument-functions -include <this> ;' with SCR_OPDUR_OUT=<file>. Every compiled TU (program and runtime) calls
 * __cyg_profile_func_enter/exit; the weak, no_instrument hooks below look the function address up in a small table of TARGET symbols (resolved through weak
 * asm-labelled externs, so a symbol the program does not link is just NULL) and, for the OUTERMOST invocation of a target only, take rdtsc at entry and exit.
 * Per target: calls, calls over 20 us and over 100 us, total ns, total ns inside those two classes, and a log2 histogram. Written at exit.
 * Caveats (all INFERRED effects, stated in the output): -finstrument-functions slows everything (every function entry/exit calls the hook), so durations of
 * targets that call many instrumented helpers are inflated by hook cost; a longjmp out of a target leaves its depth stuck (stale after 1 s and reset);
 * only the main thread is timed (threads share the table without locks: a lab counter). */
#ifndef SCR_OPDUR_H
#define SCR_OPDUR_H
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#define OPD_NT 64
#define OPD_NB 32
#define OPD_NOINST __attribute__((no_instrument_function, used))
#define OPD_T(n, s) extern char opd_sym_##n[] __asm__(#s) __attribute__((weak));
OPD_T(0, scr_json_parse) OPD_T(1, scr_json_parse_revive) OPD_T(2, scr_jb_put_dyn) OPD_T(3, scr_jsval_to_json) OPD_T(4, scr_bytes_concat) OPD_T(5, scr_bytes_concat_len)
OPD_T(6, scr_buffer_concat_dyn) OPD_T(7, scr_buffer_concat_dyn_len) OPD_T(8, scr_bytes_copy_into) OPD_T(9, scr_hash_update_bytes) OPD_T(10, scr_hash_update_str)
OPD_T(11, scr_hash_digest_raw_buf) OPD_T(12, scr_hash_digest_enc) OPD_T(13, scr_hmac_digest_raw_buf) OPD_T(14, scr_hmac_digest_enc) OPD_T(15, scr_crypto_hash_digest_bytes_raw)
OPD_T(16, scr_crypto_hash_digest_str_raw) OPD_T(17, scr_crypto_hash_digest_bytes) OPD_T(18, scr_crypto_hash_digest_str) OPD_T(19, scr_arr_sort_dyn) OPD_T(20, scr_bytes_sort_big)
OPD_T(21, scr_cipher_update) OPD_T(22, scr_cipher_final) OPD_T(23, scr_str_split) OPD_T(24, scr_str_replace_str) OPD_T(25, scr_str_index_of) OPD_T(26, scr_sp_sort)
OPD_T(27, scr_str_concat) OPD_T(28, scr_crypto_digest_raw) OPD_T(29, scr_text_decode_view) OPD_T(30, scr_jsval_from_json)
typedef struct { void *addr; const char *name; uint64_t calls, c20, c100, tot, t20, t100, start; int depth; uint32_t hist[OPD_NB]; } OpdT;
__attribute__((weak)) OpdT opd_t[OPD_NT]; __attribute__((weak)) int opd_n; __attribute__((weak)) int opd_ready; __attribute__((weak)) double opd_ns_per_tick; __attribute__((weak)) uint64_t opd_tsc0; __attribute__((weak)) double opd_t0; __attribute__((weak)) short opd_h[256]; 
static OPD_NOINST double opd_now(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec * 1e9 + t.tv_nsec; }
static OPD_NOINST void opd_add(void *a, const char *n) { if (a && opd_n < OPD_NT) { opd_t[opd_n].addr = a; opd_t[opd_n].name = n; for (unsigned k = ((uintptr_t)a >> 4) & 255;; k = (k + 1) & 255) if (!opd_h[k]) { opd_h[k] = (short)(opd_n + 1); break; } opd_n++; } }
static OPD_NOINST OpdT *opd_find(void *fn) { for (unsigned k = ((uintptr_t)fn >> 4) & 255; opd_h[k]; k = (k + 1) & 255) if (opd_t[opd_h[k] - 1].addr == fn) return &opd_t[opd_h[k] - 1]; return 0; }
static OPD_NOINST void opd_dump(void) {
  const char *p = getenv("SCR_OPDUR_OUT"); FILE *f = p ? fopen(p, "w") : stderr; if (!f) f = stderr;
  double ns = (opd_now() - opd_t0) / (double)(__builtin_ia32_rdtsc() - opd_tsc0);
  fprintf(f, "OPDUR ns_per_tick=%.4f wall_ms=%.0f (-finstrument-functions lab build: durations include hook cost of nested calls)\n", ns, (opd_now() - opd_t0) / 1e6);
  fprintf(f, "target | calls | >20us | >100us | total_ms | in>20us_ms | in>100us_ms | max_bucket(log2 ns)\n");
  for (int i = 0; i < opd_n; i++) { OpdT *t = &opd_t[i]; if (!t->calls) continue; int mb = 0; for (int b = 0; b < OPD_NB; b++) if (t->hist[b]) mb = b;
    fprintf(f, "%s | %llu | %llu | %llu | %.2f | %.2f | %.2f | %d\n", t->name, (unsigned long long)t->calls, (unsigned long long)t->c20, (unsigned long long)t->c100, t->tot * ns / 1e6, t->t20 * ns / 1e6, t->t100 * ns / 1e6, mb); }
  fprintf(f, "histograms (log2 ns bucket:count)\n");
  for (int i = 0; i < opd_n; i++) { OpdT *t = &opd_t[i]; if (!t->calls) continue; fprintf(f, "%s:", t->name); for (int b = 0; b < OPD_NB; b++) if (t->hist[b]) fprintf(f, " %d:%u", b, t->hist[b]); fprintf(f, "\n"); }
  if (f != stderr) fclose(f);
}
#define OPD_A(n, s) opd_add((void *)opd_sym_##n, #s);
static OPD_NOINST void opd_init(void) {
  if (opd_ready) return; opd_ready = 1; opd_t0 = opd_now(); opd_tsc0 = __builtin_ia32_rdtsc();
  { struct timespec w = {0, 4000000}; double a = opd_now(); uint64_t c = __builtin_ia32_rdtsc(); nanosleep(&w, 0); opd_ns_per_tick = (opd_now() - a) / (double)(__builtin_ia32_rdtsc() - c); }
  OPD_A(0, scr_json_parse) OPD_A(1, scr_json_parse_revive) OPD_A(2, scr_jb_put_dyn) OPD_A(3, scr_jsval_to_json) OPD_A(4, scr_bytes_concat) OPD_A(5, scr_bytes_concat_len)
  OPD_A(6, scr_buffer_concat_dyn) OPD_A(7, scr_buffer_concat_dyn_len) OPD_A(8, scr_bytes_copy_into) OPD_A(9, scr_hash_update_bytes) OPD_A(10, scr_hash_update_str)
  OPD_A(11, scr_hash_digest_raw_buf) OPD_A(12, scr_hash_digest_enc) OPD_A(13, scr_hmac_digest_raw_buf) OPD_A(14, scr_hmac_digest_enc) OPD_A(15, scr_crypto_hash_digest_bytes_raw)
  OPD_A(16, scr_crypto_hash_digest_str_raw) OPD_A(17, scr_crypto_hash_digest_bytes) OPD_A(18, scr_crypto_hash_digest_str) OPD_A(19, scr_arr_sort_dyn) OPD_A(20, scr_bytes_sort_big)
  OPD_A(21, scr_cipher_update) OPD_A(22, scr_cipher_final) OPD_A(23, scr_str_split) OPD_A(24, scr_str_replace_str) OPD_A(25, scr_str_index_of) OPD_A(26, scr_sp_sort)
  OPD_A(27, scr_str_concat) OPD_A(28, scr_crypto_digest_raw) OPD_A(29, scr_text_decode_view) OPD_A(30, scr_jsval_from_json)
  atexit(opd_dump);
}
__attribute__((weak, constructor, no_instrument_function, used)) void opd_ctor(void) { opd_init(); }
__attribute__((weak, no_instrument_function, used)) void __cyg_profile_func_enter(void *fn, void *cs) {
  (void)cs; if (!opd_ready) opd_init();
  OpdT *t = opd_find(fn); if (!t) return;
  uint64_t now = __builtin_ia32_rdtsc();
  if (t->depth > 0 && (now - t->start) > 3000000000ull) t->depth = 0; /* stale after a longjmp */
  if (t->depth++ == 0) t->start = now;
}
__attribute__((weak, no_instrument_function, used)) void __cyg_profile_func_exit(void *fn, void *cs) {
  (void)cs; OpdT *t = opd_find(fn); if (!t || t->depth <= 0) return;
  if (--t->depth != 0) return;
  uint64_t d = __builtin_ia32_rdtsc() - t->start; double u = d * opd_ns_per_tick / 1e3;
  t->calls++; t->tot += d; if (u > 20) { t->c20++; t->t20 += d; } if (u > 100) { t->c100++; t->t100 += d; }
  int b = 0; uint64_t x = (uint64_t)(d * opd_ns_per_tick); while (x > 1 && b < OPD_NB - 1) { x >>= 1; b++; } t->hist[b]++;
}
#endif
