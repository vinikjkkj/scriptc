/* The generated zone tables (scr_date_zones.c: ICU long names; scr_date_tzdb.c: ids and
 * offset history), both from scripts/gen-date-zones.mjs. */
#ifndef SCR_DATE_ZONES_H
#define SCR_DATE_ZONES_H
#include <stddef.h>
#include <stdint.h>

/* scr_date_zones.c -- the name table */
typedef struct {
  uint16_t n0, n1; /* name indexes: flag even, flag odd */
  uint16_t cnt;    /* toggles in [0, 2^31) seconds */
  uint16_t off;    /* offset into scr_dz_blob (see the generator for the codec) */
} scr_dz_rec;
extern const char scr_dz_names[];
extern const uint16_t scr_dz_name_off[];
extern const uint8_t scr_dz_blob[];
extern const scr_dz_rec scr_dz_recs[];
extern const int64_t scr_dz_unit;

/* scr_date_tzdb.c -- ids and offset history */
typedef struct {
  int32_t off0;  /* the offset before the first transition, seconds */
  uint16_t cnt;  /* explicit transitions */
  uint16_t end;  /* year of the last explicit transition's window; later instants map into [end-27, end] */
  uint32_t off;  /* offset into scr_tz_blob (see the generator for the codec) */
} scr_tz_rec;
extern const char scr_tz_ids[];
extern const uint16_t scr_tz_id_off[];
extern const uint16_t scr_tz_id_orec[]; /* id -> scr_tz_recs index */
extern const uint16_t scr_tz_id_nrec[]; /* id -> scr_dz_recs index */
extern const size_t scr_tz_nids;
extern const uint8_t scr_tz_blob[];
extern const scr_tz_rec scr_tz_recs[];

/* scr_date_tz.c -- a decoded zone */
typedef struct scr_tz {
  const char *id;      /* canonical id, or NULL for a custom (POSIX-offset / unknown) zone */
  int idx;             /* index in scr_tz_ids, or -1 for a custom zone */
  int nrec;            /* scr_dz_recs index, or -1 when there is no ICU name (prints GMT+HH:MM) */
  int32_t off0;
  int cnt;
  int end;
  int64_t tail;        /* first instant (seconds) that maps into the window */
  int64_t *T;          /* transition instants, seconds */
  int32_t *O;          /* the offset after each, seconds */
} scr_tz;
const scr_tz *scr_tz_host(void);                                   /* never NULL */
const scr_tz *scr_tz_find(const char *id, size_t len, int nocase); /* NULL when unknown */
int32_t scr_tz_offset(const scr_tz *z, int64_t t_sec);             /* seconds east of UTC */
int scr_tz_equiv_year(long long y, int end);
int64_t scr_tz_year_start(long long year);               /* seconds of YEAR-01-01T00:00:00Z */
int64_t scr_tz_map_tail(int64_t t_sec, int end);         /* the equivalent instant inside the window [end-27, end] */

#endif
