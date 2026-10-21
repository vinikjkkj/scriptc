#ifndef SCR_NF_H
#define SCR_NF_H
/* Number formatting over the CLDR store (scr_nf.c). kv holds nkv (key, tagged value) pairs where a tagged value is
 * 's' + text (string), 'n' + text (number), 'b' + "true"/"false" (boolean) or "u" (undefined).
 * Returns 0 and a malloc'd UTF-8 result in *out, or 1 (RangeError) / 2 (TypeError) with a malloc'd message in
 * *out. A bigint is passed as its decimal text with an optional leading '-'. */
int scr_nf_format_core(char **out, const char *locales, int is_bigint, double x, const char *big, const char *const *kv,
                       int nkv);
#endif
