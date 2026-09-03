#include <stdlib.h>
#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
void scr_trap(const char *m){ (void)m; abort(); }
void scr_trap_fmt(const char *m, ...){ (void)m; abort(); }
void scr_throw_error_msg(int k, const char *m, size_t n){ (void)k;(void)m;(void)n; abort(); }
void *scr_f64_to_str(double d){ (void)d; return NULL; }
void *scr_str_new(const char *p, size_t n){ (void)p;(void)n; return NULL; }
size_t scr_str_utf16_len(const void *s){ (void)s; return 0; }
void scr_throw_error_msg_code(int k, const char *m, size_t n, const char *c){ (void)k;(void)m;(void)n;(void)c; abort(); }
