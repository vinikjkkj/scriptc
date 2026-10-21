/* The generated zone-name table (scr_date_zones.c, from scripts/gen-date-zones.mjs). */
#ifndef SCR_DATE_ZONES_H
#define SCR_DATE_ZONES_H
#include <stddef.h>
#include <stdint.h>
typedef struct {
  uint16_t n0, n1; /* name indexes: flag even, flag odd */
  uint16_t cnt;    /* toggles in [0, 2^31) seconds */
  uint16_t off;    /* offset into scr_dz_blob (see the generator for the codec) */
} scr_dz_rec;
extern const char scr_dz_names[];
extern const uint16_t scr_dz_name_off[];
extern const uint8_t scr_dz_blob[];
extern const scr_dz_rec scr_dz_recs[];
extern const char scr_dz_ids[];
extern const uint16_t scr_dz_id_off[];
extern const uint16_t scr_dz_id_rec[];
extern const size_t scr_dz_nids;
extern const int64_t scr_dz_unit;
#endif
