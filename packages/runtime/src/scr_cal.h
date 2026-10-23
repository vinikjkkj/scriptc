/* ICU 78.2's calendars, forward direction only (instant -> fields): everything a SimpleDateFormat reads. */
#ifndef SCR_CAL_H
#define SCR_CAL_H
#include <stdint.h>

/* UCalendarDateFields */
enum {
  CAL_ERA = 0, CAL_YEAR, CAL_MONTH, CAL_WEEK_OF_YEAR, CAL_WEEK_OF_MONTH, CAL_DATE, CAL_DAY_OF_YEAR, CAL_DAY_OF_WEEK,
  CAL_DOW_IN_MONTH, CAL_AM_PM, CAL_HOUR, CAL_HOUR_OF_DAY, CAL_MINUTE, CAL_SECOND, CAL_MILLISECOND, CAL_ZONE_OFFSET,
  CAL_DST_OFFSET, CAL_YEAR_WOY, CAL_DOW_LOCAL, CAL_EXTENDED_YEAR, CAL_JULIAN_DAY, CAL_MILLIS_IN_DAY, CAL_IS_LEAP_MONTH,
  CAL_ORDINAL_MONTH, CAL_FIELD_COUNT
};

/* ECalType, in ICU's gCalTypes order */
enum {
  CT_GREGORIAN = 0, CT_JAPANESE, CT_BUDDHIST, CT_ROC, CT_PERSIAN, CT_ISLAMIC_CIVIL, CT_ISLAMIC, CT_HEBREW, CT_CHINESE,
  CT_INDIAN, CT_COPTIC, CT_ETHIOPIC, CT_ETHIOPIC_AA, CT_ISO8601, CT_DANGI, CT_ISLAMIC_UMALQURA, CT_ISLAMIC_TBLA,
  CT_ISLAMIC_RGSA, CT_COUNT
};

typedef struct {
  int type;
  int32_t f[CAL_FIELD_COUNT];
  int32_t relatedYear;
  int32_t firstDayOfWeek, minimalDays; /* from the region's week data */
  int hebrewLeap;                      /* Hebrew calendar: the year is a leap year */
} ScrCal;

int scr_cal_type_from_name(const char *legacy); /* -1 when unknown */
const char *scr_cal_type_name(int type);
/* Fills the fields for the instant `utcMs` seen with the zone offsets (milliseconds). Returns 0 or -1 when out of range. */
int scr_cal_compute(ScrCal *c, int type, double utcMs, int32_t rawOffsetMs, int32_t dstOffsetMs);
void scr_cal_set_week_data(ScrCal *c, int firstDayOfWeek, int minimalDays);
#endif
