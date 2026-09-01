/* scr_wrtc_fp.c — see scr_wrtc_fp.h for why this is its own unit. */

#include <string.h>

#include "mbedtls/md.h"

#include "scr_wrtc_fp.h"

static int hexval(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

/* Case-insensitive compare against a NUL-terminated literal, bounded by the
 * caller's length. Written out because strncasecmp is not portable to every
 * target this runtime builds for. */
static bool tok_eq(const char *s, size_t len, const char *lit) {
  size_t n = strlen(lit);
  if (len != n) return false;
  for (size_t i = 0; i < n; i++) {
    char a = s[i], b = lit[i];
    if (a >= 'A' && a <= 'Z') a = (char)(a - 'A' + 'a');
    if (b >= 'A' && b <= 'Z') b = (char)(b - 'A' + 'a');
    if (a != b) return false;
  }
  return true;
}

bool scr_wrtc_fp_parse(const char *value, size_t len, uint8_t out[SCR_WRTC_FP_LEN]) {
  if (value == NULL || out == NULL) return false;

  /* Leading whitespace, then the algorithm token up to the first space. */
  size_t i = 0;
  while (i < len && (value[i] == ' ' || value[i] == '\t')) i++;
  size_t alg_start = i;
  while (i < len && value[i] != ' ' && value[i] != '\t') i++;
  if (i == alg_start) return false;
  /* SHA-256 only, deliberately: accepting a weaker hash than the peer
   * offered is how a fingerprint check gets downgraded. */
  if (!tok_eq(value + alg_start, i - alg_start, "sha-256")) return false;

  while (i < len && (value[i] == ' ' || value[i] == '\t')) i++;

  /* Exactly 32 hex pairs, colon-separated. Counting to a fixed 32 rather
   * than "until the string ends" is what rejects a truncated fingerprint
   * that would otherwise compare equal on its prefix. */
  uint8_t buf[SCR_WRTC_FP_LEN];
  for (unsigned b = 0; b < SCR_WRTC_FP_LEN; b++) {
    if (b > 0) {
      if (i >= len || value[i] != ':') return false;
      i++;
    }
    if (i + 1 >= len) return false;
    int hi = hexval(value[i]);
    int lo = hexval(value[i + 1]);
    if (hi < 0 || lo < 0) return false;
    buf[b] = (uint8_t)((hi << 4) | lo);
    i += 2;
  }
  /* Trailing whitespace is fine; trailing ANYTHING ELSE is not — a 33rd
   * pair means the peer sent a hash this code is misreading. */
  while (i < len && (value[i] == ' ' || value[i] == '\t' ||
                     value[i] == '\r' || value[i] == '\n')) i++;
  if (i != len) return false;

  memcpy(out, buf, SCR_WRTC_FP_LEN);
  return true;
}

bool scr_wrtc_fp_from_sdp(const char *sdp, size_t len, uint8_t out[SCR_WRTC_FP_LEN]) {
  if (sdp == NULL || out == NULL) return false;
  static const char key[] = "a=fingerprint:";
  const size_t keylen = sizeof key - 1;
  size_t line = 0;
  while (line < len) {
    size_t end = line;
    while (end < len && sdp[end] != '\n') end++;
    size_t stop = end;
    if (stop > line && sdp[stop - 1] == '\r') stop--;
    if (stop - line > keylen && memcmp(sdp + line, key, keylen) == 0) {
      return scr_wrtc_fp_parse(sdp + line + keylen, stop - line - keylen, out);
    }
    line = end + 1;
  }
  return false;
}

bool scr_wrtc_fp_of_cert(const uint8_t *der, size_t der_len, uint8_t out[SCR_WRTC_FP_LEN]) {
  if (der == NULL || out == NULL) return false;
  const mbedtls_md_info_t *info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  if (info == NULL) return false;
  return mbedtls_md(info, der, der_len, out) == 0;
}

bool scr_wrtc_fp_equal(const uint8_t a[SCR_WRTC_FP_LEN], const uint8_t b[SCR_WRTC_FP_LEN]) {
  uint8_t diff = 0;
  for (unsigned i = 0; i < SCR_WRTC_FP_LEN; i++) diff = (uint8_t)(diff | (a[i] ^ b[i]));
  return diff == 0;
}

void scr_wrtc_fp_format(const uint8_t fp[SCR_WRTC_FP_LEN], char out[96]) {
  static const char hex[] = "0123456789ABCDEF";
  size_t o = 0;
  for (unsigned i = 0; i < SCR_WRTC_FP_LEN; i++) {
    if (i > 0) out[o++] = ':';
    out[o++] = hex[fp[i] >> 4];
    out[o++] = hex[fp[i] & 0x0F];
  }
  out[o] = '\0';
}
