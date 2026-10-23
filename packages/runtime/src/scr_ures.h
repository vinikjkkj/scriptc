/* ICU 78.2 resource data (the locale data Node 24.15.0 formats with) and ICU's resource bundle lookups: parent
 * fallback (%%Parent, else truncation, else root), "/LOCALE/..." aliases resolved against the requested locale,
 * getByKeyWithFallback and getAllItemsWithFallback. The image is the binary scripts/gen-icu.mjs writes (or a slice
 * of it the compiler cut for the locales a program names), supplied by the program's data unit through
 * scr_ures_image(). */
#ifndef SCR_URES_H
#define SCR_URES_H
#include <stddef.h>
#include <stdint.h>
#include <stdbool.h>

enum { SCR_URES_LOC, SCR_URES_CURR, SCR_URES_UNIT, SCR_URES_ZONE, SCR_URES_MISC, SCR_URES_REGION, SCR_URES_NPKG };

typedef struct { const unsigned char *p; int pkg; } ScrRes; /* p == NULL: absent */
enum { SCR_RES_STR = 0, SCR_RES_TABLE = 1, SCR_RES_ARRAY = 2, SCR_RES_ALIAS = 3, SCR_RES_INT = 4, SCR_RES_INTVEC = 5, SCR_RES_BIN = 6 };

extern const unsigned char *scr_ures_image(size_t *len); /* provided by the data unit or a test harness */

/* A requested locale as ICU opens it: per package, the first bundle that exists (findFirstExisting with the CLDR
 * parent table and default-script rules for names that have no bundle), which then starts the parent chain. */
typedef struct { int start[SCR_URES_NPKG]; } ScrUloc;
void scr_ures_open(const char *icuName, ScrUloc *u);

int scr_ures_locale_count(void);
const char *scr_ures_locale_name(int loc, size_t *n); /* ICU spelling, "en_150" */
int scr_ures_locale_find(const char *name, size_t n);   /* exact bundle name in any package, -1 */

bool scr_ures_get(const ScrUloc *u, int pkg, const char *path, ScrRes *out);
/* A bundle of the "misc" package by file name ("supplementalData", "metaZones", "dayPeriods"): ures_openDirect + path lookup. */
bool scr_ures_misc(const char *bundle, const char *path, ScrRes *out);

int scr_res_kind(ScrRes r);
const char *scr_res_str(ScrRes r, size_t *n);              /* string (also an alias's text) */
int scr_res_array_len(ScrRes r);
int scr_res_intvec(ScrRes r, int32_t *out, int cap); /* the integer vector's length (values copied up to cap), -1 when not one */
int32_t scr_res_int(ScrRes r, int *ok);
ScrRes scr_res_array_at(ScrRes r, int i);
int scr_res_table_len(ScrRes r);
ScrRes scr_res_table_at(ScrRes r, int i, const char **key, size_t *kn);
bool scr_res_get_str(const ScrUloc *u, int pkg, const char *path, char *out, size_t cap); /* NUL-terminated copy, false when absent */

/* getAllItemsWithFallback: visits the table at `path` of every bundle in the chain, child first; the sink decides
 * which keys to keep (it must skip keys it already has). Returns true when any bundle had the table. */
typedef void (*ScrResSink)(void *ctx, const char *key, size_t kn, ScrRes v);
bool scr_ures_all_items(const ScrUloc *u, int pkg, const char *path, ScrResSink sink, void *ctx);

/* Calls cb once for the table at `path` of every bundle in the chain that has one (child first); the table's own
 * children are not resolved (an alias child reads as SCR_RES_ALIAS). */
typedef void (*ScrResTableCb)(void *ctx, ScrRes table);
bool scr_ures_each_table(const ScrUloc *u, int pkg, const char *path, ScrResTableCb cb, void *ctx);

/* One bundle at a time (ures_open and getByKey semantics): the exact `loc` bundle of a name, the bundle ures_open starts
 * from, a lookup in that bundle's own data only, and a lookup through its parent chain. */
int scr_ures_bundle_exact(const char *name);
int scr_ures_bundle_open(const char *name);
const char *scr_ures_bundle_name(int idx);
bool scr_ures_bundle_own(int idx, const char *path, ScrRes *out);
bool scr_ures_bundle_get(int idx, const char *path, ScrRes *out);

/* The global records ("ns/latn", "plural/en/one", "curregion/DE", ...). */
typedef struct { const char *p; size_t n; } ScrCoreVal;
ScrCoreVal scr_core_get(const char *key);
#endif
