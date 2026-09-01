/* Known-answer tests for SDP fingerprint parsing and verification.
 *
 * The expected values come from zapo's own source and from FIPS 180-4, not
 * from running this code.
 */
#include <stdio.h>
#include <string.h>

#include "scr_wrtc_fp.h"

static int fails = 0, checks = 0;

static void ck(const char *what, bool got, bool want) {
  checks++;
  if (got == want) printf("  ok   %-56s %s\n", what, got ? "true" : "false");
  else { printf("  FAIL %-56s got %s want %s\n", what, got?"true":"false", want?"true":"false"); fails++; }
}

/* WaSctpRelay.ts:39-40, copied verbatim. */
static const char ZAPO_FP[] =
  "sha-256 F9:CA:0C:98:A3:CC:71:D6:42:CE:5A:E2:53:D2:15:20:"
  "D3:1B:BA:D8:57:A4:F0:AF:BE:0B:FB:F3:6B:0C:A0:68";

int main(void) {
  printf("SDP fingerprint parsing (RFC 8122)\n");

  uint8_t fp[SCR_WRTC_FP_LEN];
  ck("parses zapo's pinned fingerprint", scr_wrtc_fp_parse(ZAPO_FP, strlen(ZAPO_FP), fp), true);
  checks++;
  if (fp[0] == 0xF9 && fp[1] == 0xCA && fp[30] == 0xA0 && fp[31] == 0x68)
    printf("  ok   %-56s F9 CA .. A0 68\n", "first and last bytes");
  else { printf("  FAIL first/last bytes: %02X %02X .. %02X %02X\n", fp[0],fp[1],fp[30],fp[31]); fails++; }

  /* Round trip through the SDP spelling. */
  char text[96];
  scr_wrtc_fp_format(fp, text);
  checks++;
  if (strcmp(text, ZAPO_FP + 8) == 0) printf("  ok   %-56s\n", "formats back to the same text");
  else { printf("  FAIL format round trip:\n    got  %s\n    want %s\n", text, ZAPO_FP + 8); fails++; }

  /* Lowercase hex and a lowercase algorithm token are both legal. */
  uint8_t fp2[SCR_WRTC_FP_LEN];
  char lower[128];
  size_t n = strlen(ZAPO_FP);
  for (size_t i = 0; i < n; i++) {
    char c = ZAPO_FP[i];
    lower[i] = (c >= 'A' && c <= 'Z') ? (char)(c - 'A' + 'a') : c;
  }
  lower[n] = '\0';
  ck("accepts lowercase hex", scr_wrtc_fp_parse(lower, n, fp2), true);
  ck("lowercase parses to the same bytes", scr_wrtc_fp_equal(fp, fp2), true);

  printf("\nrejections — each of these must NOT parse\n");
  uint8_t junk[SCR_WRTC_FP_LEN];
  /* A weaker hash must be refused, not silently accepted: taking whatever
   * the peer offers is how a fingerprint check gets downgraded. */
  static const char sha1[] = "sha-1 F9:CA:0C:98:A3:CC:71:D6:42:CE:5A:E2:53:D2:15:20:D3:1B:BA:D8";
  ck("sha-1 is refused", scr_wrtc_fp_parse(sha1, strlen(sha1), junk), false);
  static const char sha512[] = "sha-512 F9:CA:0C:98:A3:CC:71:D6:42:CE:5A:E2:53:D2:15:20:D3:1B:BA:D8:57:A4:F0:AF:BE:0B:FB:F3:6B:0C:A0:68";
  ck("sha-512 is refused (unserved, not assumed)", scr_wrtc_fp_parse(sha512, strlen(sha512), junk), false);
  /* 31 pairs: a truncated fingerprint whose PREFIX matches. */
  static const char shortfp[] = "sha-256 F9:CA:0C:98:A3:CC:71:D6:42:CE:5A:E2:53:D2:15:20:D3:1B:BA:D8:57:A4:F0:AF:BE:0B:FB:F3:6B:0C:A0";
  ck("31 pairs is refused", scr_wrtc_fp_parse(shortfp, strlen(shortfp), junk), false);
  /* 33 pairs. */
  static const char longfp[] = "sha-256 F9:CA:0C:98:A3:CC:71:D6:42:CE:5A:E2:53:D2:15:20:D3:1B:BA:D8:57:A4:F0:AF:BE:0B:FB:F3:6B:0C:A0:68:11";
  ck("33 pairs is refused", scr_wrtc_fp_parse(longfp, strlen(longfp), junk), false);
  static const char nonhex[] = "sha-256 GG:CA:0C:98:A3:CC:71:D6:42:CE:5A:E2:53:D2:15:20:D3:1B:BA:D8:57:A4:F0:AF:BE:0B:FB:F3:6B:0C:A0:68";
  ck("non-hex is refused", scr_wrtc_fp_parse(nonhex, strlen(nonhex), junk), false);
  static const char nosep[] = "sha-256 F9CA0C98A3CC71D642CE5AE253D21520D31BBAD857A4F0AFBE0BFBF36B0CA068";
  ck("missing colons is refused", scr_wrtc_fp_parse(nosep, strlen(nosep), junk), false);
  ck("empty is refused", scr_wrtc_fp_parse("", 0, junk), false);

  printf("\nfinding the line in a whole SDP\n");
  static const char sdp[] =
    "v=0\r\n"
    "o=- 4611731400430051336 2 IN IP4 127.0.0.1\r\n"
    "s=-\r\n"
    "t=0 0\r\n"
    "a=group:BUNDLE 0\r\n"
    "m=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n"
    "c=IN IP4 0.0.0.0\r\n"
    "a=ice-ufrag:abcd\r\n"
    "a=ice-pwd:efgh\r\n"
    "a=fingerprint:sha-256 F9:CA:0C:98:A3:CC:71:D6:42:CE:5A:E2:53:D2:15:20:"
    "D3:1B:BA:D8:57:A4:F0:AF:BE:0B:FB:F3:6B:0C:A0:68\r\n"
    "a=setup:passive\r\n"
    "a=sctp-port:5000\r\n"
    "a=max-message-size:1500\r\n";
  uint8_t got[SCR_WRTC_FP_LEN];
  ck("extracts the fingerprint from a real SDP", scr_wrtc_fp_from_sdp(sdp, strlen(sdp), got), true);
  ck("and it equals the pinned value", scr_wrtc_fp_equal(got, fp), true);

  static const char nofp[] = "v=0\r\na=ice-ufrag:abcd\r\na=setup:passive\r\n";
  ck("an SDP with no fingerprint fails", scr_wrtc_fp_from_sdp(nofp, strlen(nofp), junk), false);

  printf("\ncertificate hashing and comparison\n");
  /* FIPS 180-4: SHA-256("abc"). Standing in for a DER certificate, whose
   * bytes are hashed the same way (RFC 8122 s5). */
  uint8_t d[SCR_WRTC_FP_LEN];
  ck("hashes a byte string", scr_wrtc_fp_of_cert((const uint8_t *)"abc", 3, d), true);
  static const uint8_t kat[32] = {
    0xba,0x78,0x16,0xbf,0x8f,0x01,0xcf,0xea,0x41,0x41,0x40,0xde,0x5d,0xae,0x22,0x23,
    0xb0,0x03,0x61,0xa3,0x96,0x17,0x7a,0x9c,0xb4,0x10,0xff,0x61,0xf2,0x00,0x15,0xad };
  ck("SHA-256(\"abc\") is the FIPS 180-4 answer", scr_wrtc_fp_equal(d, kat), true);

  uint8_t off[32];
  memcpy(off, kat, 32);
  off[31] ^= 0x01;
  ck("a one-bit difference in the LAST byte is caught", scr_wrtc_fp_equal(d, off), false);
  memcpy(off, kat, 32);
  off[0] ^= 0x80;
  ck("a one-bit difference in the FIRST byte is caught", scr_wrtc_fp_equal(d, off), false);

  printf("\n%d checks, %d failures\nRESULT: %s\n", checks, fails, fails ? "FAIL" : "PASS");
  return fails ? 1 : 0;
}
