/* ICU 78.2's DateTimePatternGenerator (dtptngen.cpp) over the ICU data store: skeleton -> best pattern. Patterns are
 * UTF-8; every pattern letter is ASCII, so byte-wise handling is exact. */
#ifndef SCR_DTPG_H
#define SCR_DTPG_H
#include "scr_dtloc.h"
#include <stddef.h>

typedef struct ScrDtpg ScrDtpg;

enum { DTPG_MATCH_NONE = 0, DTPG_MATCH_HOUR = 1 << 11, DTPG_MATCH_MINUTE = 1 << 12, DTPG_MATCH_SECOND = 1 << 13 };

/* createInstance(locale) (skipStdPatterns false) or createInstanceNoStdPat (true). NULL on a data failure. */
ScrDtpg *scr_dtpg_new(const DtLoc *loc, int skipStdPatterns);
void scr_dtpg_free(ScrDtpg *g);
/* getBestPattern(skeleton, options): malloc'ed NUL-terminated pattern, or NULL. */
char *scr_dtpg_best(ScrDtpg *g, const char *skeleton, int options);
/* getDefaultHourCycle: 11, 12, 23 or 24 */
int scr_dtpg_default_hour_cycle(const ScrDtpg *g);
/* DateTimePatternGenerator::staticGetSkeleton */
char *scr_dtpg_static_skeleton(const char *pattern);
#endif
