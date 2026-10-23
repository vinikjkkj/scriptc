/* The integer path of ICU's RuleBasedNumberFormat (nfrs.cpp, nfrule.cpp, nfsubs.cpp): what date patterns use for the
 * algorithmic numbering systems named by pattern overrides (hebr, romanlow, hanidays, jpanyear). */
#ifndef SCR_RBNF_H
#define SCR_RBNF_H
#include <stdint.h>

typedef struct ScrRbnf ScrRbnf;
/* `rules`: the rule sets' descriptions concatenated ("%hebrew:-x: ...;0: ...;%%other:..."); `defaultSet` names the set
 * format() starts from; `minus`/`group` are the decimal-format symbols the =0= / =#,##0= substitutions use. */
ScrRbnf *scr_rbnf_open(const char *rules, const char *defaultSet, const char *minus, const char *group);
void scr_rbnf_free(ScrRbnf *r);
char *scr_rbnf_format(const ScrRbnf *r, int64_t number); /* malloc'ed UTF-8, NULL on a rule error */
#endif
