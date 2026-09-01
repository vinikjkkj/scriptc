/* Known-answer tests for the SCTP packet layer.
 *
 * Everything here is checked against a PUBLISHED value or a byte-exact
 * layout read off the RFC, not against what the code happens to produce.
 * A test whose expected value came from running the code under test
 * proves only that the code is deterministic.
 *
 * CRC vectors: RFC 3720 Appendix B.4 (the iSCSI CRC32c vectors) plus the
 * universal CRC-32C check value for "123456789".
 */

#include <stdio.h>
#include <string.h>

#include "scr_sctp.h"

static int failures = 0;
static int checks = 0;

static void ck_u32(const char *what, uint32_t got, uint32_t want) {
  checks++;
  if (got == want) {
    printf("  ok   %-52s 0x%08X\n", what, got);
  } else {
    printf("  FAIL %-52s got 0x%08X want 0x%08X\n", what, got, want);
    failures++;
  }
}

static void ck_sz(const char *what, size_t got, size_t want) {
  checks++;
  if (got == want) {
    printf("  ok   %-52s %zu\n", what, got);
  } else {
    printf("  FAIL %-52s got %zu want %zu\n", what, got, want);
    failures++;
  }
}

static void ck_bool(const char *what, bool got, bool want) {
  checks++;
  if (got == want) {
    printf("  ok   %-52s %s\n", what, got ? "true" : "false");
  } else {
    printf("  FAIL %-52s got %s want %s\n", what, got ? "true" : "false",
           want ? "true" : "false");
    failures++;
  }
}

static void hexdump(const char *label, const uint8_t *p, size_t n) {
  printf("       %s = ", label);
  for (size_t i = 0; i < n; i++) printf("%02x", p[i]);
  printf("\n");
}

static void ck_bytes(const char *what, const uint8_t *got, size_t got_len,
                     const uint8_t *want, size_t want_len) {
  checks++;
  if (got_len == want_len && memcmp(got, want, want_len) == 0) {
    printf("  ok   %-52s %zu bytes\n", what, got_len);
  } else {
    printf("  FAIL %-52s length %zu want %zu\n", what, got_len, want_len);
    hexdump("got ", got, got_len);
    hexdump("want", want, want_len);
    failures++;
  }
}

/* ── CRC32c, RFC 3720 Appendix B.4 ──────────────────────────────────── */

static void test_crc32c(void) {
  printf("CRC32c known answers (RFC 3720 B.4 + the CRC-32C check value)\n");

  ck_u32("crc32c(\"123456789\")",
         scr_sctp_crc32c((const uint8_t *)"123456789", 9), 0xE3069283u);

  ck_u32("crc32c(empty)", scr_sctp_crc32c((const uint8_t *)"", 0), 0x00000000u);

  uint8_t zeros[32];
  memset(zeros, 0x00, sizeof zeros);
  ck_u32("crc32c(32 x 0x00)", scr_sctp_crc32c(zeros, 32), 0x8A9136AAu);

  uint8_t ones[32];
  memset(ones, 0xFF, sizeof ones);
  ck_u32("crc32c(32 x 0xFF)", scr_sctp_crc32c(ones, 32), 0x62A8AB43u);

  uint8_t inc[32];
  for (int i = 0; i < 32; i++) inc[i] = (uint8_t)i;
  ck_u32("crc32c(0x00..0x1F ascending)", scr_sctp_crc32c(inc, 32),
         0x46DD794Eu);

  uint8_t dec[32];
  for (int i = 0; i < 32; i++) dec[i] = (uint8_t)(31 - i);
  ck_u32("crc32c(0x1F..0x00 descending)", scr_sctp_crc32c(dec, 32),
         0x113FDB5Cu);
}

/* ── header + checksum round trip ───────────────────────────────────── */

static void test_checksum_roundtrip(void) {
  printf("\nheader, checksum install and verify\n");

  uint8_t pkt[64];
  memset(pkt, 0, sizeof pkt);
  size_t n = scr_sctp_write_header(pkt, sizeof pkt, 5000, 5000, 0xDEADBEEFu);
  ck_sz("header length", n, 12);
  n += scr_sctp_write_init(pkt + n, sizeof pkt - n, 0x11223344u, 65535, 1, 1,
                           0x55667788u);
  ck_sz("header + INIT length", n, 12 + 20);

  scr_sctp_finalize(pkt, n);
  ck_bool("verify accepts the finalised datagram", scr_sctp_verify(pkt, n),
          true);

  ScrSctpHeader h;
  ck_bool("read_header succeeds", scr_sctp_read_header(pkt, n, &h), true);
  ck_u32("vtag survives the round trip", h.vtag, 0xDEADBEEFu);

  /* The checksum field is LITTLE-endian (RFC 3309): the four bytes on
   * the wire must be the byte-reverse of the CRC value. Checked
   * explicitly, because a big-endian store round-trips through our own
   * reader and would pass every other test here. */
  uint8_t saved[4];
  memcpy(saved, pkt + 8, 4);
  uint8_t probe[64];
  memcpy(probe, pkt, n);
  memset(probe + 8, 0, 4);
  uint32_t expect = scr_sctp_crc32c(probe, n);
  uint8_t want_le[4] = {(uint8_t)expect, (uint8_t)(expect >> 8),
                        (uint8_t)(expect >> 16), (uint8_t)(expect >> 24)};
  ck_bytes("checksum stored little-endian on the wire", saved, 4, want_le, 4);

  /* Corruption must be caught, in the payload and in the header. */
  uint8_t bad[64];
  memcpy(bad, pkt, n);
  bad[20] ^= 0x01u;
  ck_bool("verify rejects a flipped payload bit", scr_sctp_verify(bad, n),
          false);

  memcpy(bad, pkt, n);
  bad[4] ^= 0x80u; /* inside the vtag */
  ck_bool("verify rejects a flipped header bit", scr_sctp_verify(bad, n),
          false);

  ck_bool("verify does not mutate the packet",
          memcmp(pkt + 8, saved, 4) == 0, true);
}

/* ── DATA chunk byte layout, RFC 4960 s3.3.1 ────────────────────────── */

static void test_data_layout(void) {
  printf("\nDATA chunk layout and padding\n");

  uint8_t out[64];
  memset(out, 0xAA, sizeof out); /* poison: padding must be zeroed */
  const uint8_t payload[3] = {0xC0, 0xFF, 0xEE};
  size_t n = scr_sctp_write_data(out, sizeof out, 1u, 0u,
                                 SCR_SCTP_PPID_BINARY, payload, 3,
                                 /*unordered=*/true, /*beginning=*/true,
                                 /*ending=*/true);

  /* 4 header + 12 fixed + 3 payload = 19 declared, padded to 20. */
  ck_sz("returned length is PADDED", n, 20);

  static const uint8_t want[20] = {
      0x00,                   /* type  = DATA                     */
      0x07,                   /* flags = U|B|E                    */
      0x00, 0x13,             /* length = 19, padding NOT counted */
      0x00, 0x00, 0x00, 0x01, /* TSN                              */
      0x00, 0x00,             /* stream id                        */
      0x00, 0x00,             /* stream seq: 0, unordered         */
      0x00, 0x00, 0x00, 0x35, /* PPID 53 = WebRTC Binary          */
      0xC0, 0xFF, 0xEE,       /* payload                          */
      0x00                    /* pad, ZEROED not left poisoned    */
  };
  ck_bytes("DATA bytes match the RFC layout", out, n, want, sizeof want);

  ScrSctpData d;
  ck_bool("read_data succeeds", scr_sctp_read_data(out + 4, 15, &d), true);
  ck_u32("tsn", d.tsn, 1u);
  ck_u32("ppid", d.ppid, SCR_SCTP_PPID_BINARY);
  ck_sz("payload_len", d.payload_len, 3);
  ck_bytes("payload", d.payload, d.payload_len, payload, 3);
}

/* ── DCEP open, RFC 8832 s5.1, for zapo's exact channel ─────────────── */

static void test_dcep_open(void) {
  printf("\nDCEP DATA_CHANNEL_OPEN for createDataChannel('wa-web-call', "
         "{ ordered: false })\n");

  uint8_t out[64];
  memset(out, 0xAA, sizeof out);
  const char label[] = "wa-web-call";
  size_t n = scr_sctp_write_dcep_open(
      out, sizeof out, SCR_SCTP_DCEP_RELIABLE_UNORDERED, 0, 0, label,
      strlen(label), NULL, 0);

  static const uint8_t want[23] = {
      0x03,                   /* DATA_CHANNEL_OPEN                    */
      0x80,                   /* RELIABLE_UNORDERED: {ordered:false}, */
                              /* no maxRetransmits, no lifetime       */
      0x00, 0x00,             /* priority                             */
      0x00, 0x00, 0x00, 0x00, /* reliability parameter: 0             */
      0x00, 0x0B,             /* label length = 11                    */
      0x00, 0x00,             /* protocol length = 0                  */
      'w', 'a', '-', 'w', 'e', 'b', '-', 'c', 'a', 'l', 'l'};
  ck_bytes("DCEP open bytes", out, n, want, sizeof want);

  /* UNPADDED on purpose: the enclosing DATA chunk pads. 23 is not a
   * multiple of 4, and that is correct. */
  ck_sz("DCEP open is unpadded", n, 23);

  const uint8_t ack[1] = {0x02};
  ck_bool("is_dcep_ack recognises DATA_CHANNEL_ACK",
          scr_sctp_is_dcep_ack(ack, 1), true);
  const uint8_t notack[1] = {0x03};
  ck_bool("is_dcep_ack rejects an OPEN", scr_sctp_is_dcep_ack(notack, 1),
          false);
  ck_bool("is_dcep_ack rejects empty", scr_sctp_is_dcep_ack(notack, 0), false);
}

/* ── chunk walking, including hostile input ─────────────────────────── */

static void test_chunk_walk(void) {
  printf("\nchunk iteration\n");

  uint8_t pkt[128];
  memset(pkt, 0, sizeof pkt);
  size_t n = scr_sctp_write_header(pkt, sizeof pkt, 1, 2, 3);
  n += scr_sctp_write_sack(pkt + n, sizeof pkt - n, 42u, 65535u);
  const uint8_t p3[3] = {1, 2, 3};
  n += scr_sctp_write_data(pkt + n, sizeof pkt - n, 7u, 0u,
                           SCR_SCTP_PPID_BINARY, p3, 3, true, true, true);
  n += scr_sctp_write_cookie_ack(pkt + n, sizeof pkt - n);
  scr_sctp_finalize(pkt, n);

  ScrSctpChunkIter it;
  int seen = 0;
  uint8_t types[8];
  for (bool ok = scr_sctp_chunk_first(pkt, n, &it); ok;
       ok = scr_sctp_chunk_next(&it)) {
    if (seen < 8) types[seen] = it.type;
    seen++;
  }
  ck_sz("three chunks walked", (size_t)seen, 3);
  ck_u32("chunk 0 is SACK", types[0], SCR_SCTP_CHUNK_SACK);
  ck_u32("chunk 1 is DATA", types[1], SCR_SCTP_CHUNK_DATA);
  ck_u32("chunk 2 is COOKIE ACK", types[2], SCR_SCTP_CHUNK_COOKIE_ACK);

  /* Hostile: a chunk length of 0 must END the walk, not loop forever.
   * This is the bug that hangs naive parsers. */
  uint8_t evil[32];
  memset(evil, 0, sizeof evil);
  scr_sctp_write_header(evil, sizeof evil, 1, 2, 3);
  evil[12] = SCR_SCTP_CHUNK_DATA;
  evil[13] = 0;
  evil[14] = 0;
  evil[15] = 0; /* declared length 0 */
  ck_bool("a zero-length chunk ends the walk",
          scr_sctp_chunk_first(evil, 16, &it), false);

  /* Hostile: a length past the end of the datagram. */
  memset(evil, 0, sizeof evil);
  scr_sctp_write_header(evil, sizeof evil, 1, 2, 3);
  evil[12] = SCR_SCTP_CHUNK_DATA;
  evil[14] = 0xFF;
  evil[15] = 0xF0; /* enormous */
  ck_bool("an over-long chunk ends the walk",
          scr_sctp_chunk_first(evil, 20, &it), false);

  /* A datagram too short to hold a header. */
  ck_bool("a truncated datagram has no chunks",
          scr_sctp_chunk_first(evil, 8, &it), false);
  ck_bool("read_header refuses a truncated datagram",
          scr_sctp_read_header(evil, 8, NULL), false);
}

/* ── INIT ACK cookie extraction ─────────────────────────────────────── */

static void test_init_ack(void) {
  printf("\nINIT ACK parsing and State Cookie extraction\n");

  /* Fixed 16 bytes, then a State Cookie parameter (type 7) of 8 bytes. */
  uint8_t v[16 + 4 + 8];
  memset(v, 0, sizeof v);
  v[0] = 0xAA; v[1] = 0xBB; v[2] = 0xCC; v[3] = 0xDD;   /* init tag   */
  v[4] = 0x00; v[5] = 0x01; v[6] = 0x00; v[7] = 0x00;   /* a_rwnd     */
  v[8] = 0x00; v[9] = 0x02;                             /* OS         */
  v[10] = 0x00; v[11] = 0x03;                           /* MIS        */
  v[12] = 0x10; v[13] = 0x20; v[14] = 0x30; v[15] = 0x40; /* init TSN */
  v[16] = 0x00; v[17] = 0x07;                           /* param type 7 */
  v[18] = 0x00; v[19] = 0x0C;                           /* param len 12 */
  for (int i = 0; i < 8; i++) v[20 + i] = (uint8_t)(0xE0 + i);

  ScrSctpInitAck ia;
  ck_bool("read_init_ack succeeds",
          scr_sctp_read_init_ack(v, sizeof v, &ia), true);
  ck_u32("init tag", ia.init_tag, 0xAABBCCDDu);
  ck_u32("initial TSN", ia.initial_tsn, 0x10203040u);
  ck_sz("cookie length", ia.cookie_len, 8);
  static const uint8_t want_cookie[8] = {0xE0, 0xE1, 0xE2, 0xE3,
                                         0xE4, 0xE5, 0xE6, 0xE7};
  ck_bytes("cookie bytes", ia.cookie, ia.cookie_len, want_cookie, 8);

  /* An INIT ACK with no cookie parameter must report absence, not
   * garbage: this is a real peer behaviour on error paths. */
  ScrSctpInitAck bare;
  ck_bool("read_init_ack succeeds with no parameters",
          scr_sctp_read_init_ack(v, 16, &bare), true);
  ck_bool("cookie absent is reported as NULL", bare.cookie == NULL, true);

  ck_bool("read_init_ack refuses a short value",
          scr_sctp_read_init_ack(v, 15, &bare), false);

  /* COOKIE ECHO carries the cookie verbatim. */
  uint8_t echo[32];
  size_t n = scr_sctp_write_cookie_echo(echo, sizeof echo, want_cookie, 8);
  ck_sz("COOKIE ECHO length", n, 12);
  static const uint8_t want_echo[12] = {0x0A, 0x00, 0x00, 0x0C,
                                        0xE0, 0xE1, 0xE2, 0xE3,
                                        0xE4, 0xE5, 0xE6, 0xE7};
  ck_bytes("COOKIE ECHO bytes", echo, n, want_echo, 12);
}

/* ── buffer discipline ──────────────────────────────────────────────── */

static void test_capacity(void) {
  printf("\nundersized buffers return 0 rather than overrunning\n");

  uint8_t tiny[4];
  ck_sz("write_header into 4 bytes", scr_sctp_write_header(tiny, 4, 1, 2, 3), 0);
  ck_sz("write_init into 4 bytes",
        scr_sctp_write_init(tiny, 4, 1, 2, 3, 4, 5), 0);
  ck_sz("write_sack into 4 bytes", scr_sctp_write_sack(tiny, 4, 1, 2), 0);
  const uint8_t p[8] = {0};
  ck_sz("write_data into 4 bytes",
        scr_sctp_write_data(tiny, 4, 1, 0, 53, p, 8, true, true, true), 0);
  ck_sz("dcep_open into 4 bytes",
        scr_sctp_write_dcep_open(tiny, 4, 0x80, 0, 0, "x", 1, NULL, 0), 0);
  /* COOKIE ACK is exactly 4 bytes and MUST fit. */
  ck_sz("cookie_ack into exactly 4 bytes",
        scr_sctp_write_cookie_ack(tiny, 4), 4);
}

int main(void) {
  test_crc32c();
  test_checksum_roundtrip();
  test_data_layout();
  test_dcep_open();
  test_chunk_walk();
  test_init_ack();
  test_capacity();
  printf("\n%d checks, %d failures\nRESULT: %s\n", checks, failures,
         failures == 0 ? "PASS" : "FAIL");
  return failures == 0 ? 0 : 1;
}
