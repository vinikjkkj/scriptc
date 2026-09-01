/* scr_wrtc_fp.h — SDP certificate-fingerprint parsing and verification.
 *
 * The authentication step of a WebRTC DTLS handshake. There is no CA chain:
 * both peers present self-signed certificates and each verifies that the
 * OTHER side's certificate hashes to the value carried in the SDP's
 * a=fingerprint line (RFC 8122). That single comparison is the whole of the
 * peer's identity, which is why it is its own unit with its own tests
 * rather than a few lines inside the handshake.
 *
 * zapo pins the value: WaSctpRelay.ts:39 hardcodes
 *   'sha-256 F9:CA:0C:98:A3:CC:71:D6:42:CE:5A:E2:53:D2:15:20:D3:1B:BA:D8:
 *    57:A4:F0:AF:BE:0B:FB:F3:6B:0C:A0:68'
 * and modifySdpForRelay writes it over whatever a=fingerprint the offer had,
 * so the relay always presents the same certificate and this comparison is
 * against a constant.
 */
#ifndef SCR_WRTC_FP_H
#define SCR_WRTC_FP_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

/* Only SHA-256 is served. RFC 8122 permits sha-1 through sha-512, but
 * browsers and this relay use sha-256, and accepting a WEAKER hash than the
 * peer offered is how fingerprint checks get downgraded. An unsupported
 * algorithm is a parse failure, not a silent pass. */
#define SCR_WRTC_FP_LEN 32u

/* Parse the VALUE of an a=fingerprint line -- "sha-256 AA:BB:..." -- into
 * raw bytes. Accepts the algorithm token case-insensitively; requires
 * exactly 32 colon-separated uppercase-or-lowercase hex pairs. Returns
 * false on any deviation and writes nothing. */
bool scr_wrtc_fp_parse(const char *value, size_t len, uint8_t out[SCR_WRTC_FP_LEN]);

/* Find the a=fingerprint line in a full SDP blob and parse it. Takes the
 * FIRST one: a session-level fingerprint applies to every m-section, and
 * zapo's rewrite makes them identical anyway. */
bool scr_wrtc_fp_from_sdp(const char *sdp, size_t len, uint8_t out[SCR_WRTC_FP_LEN]);

/* SHA-256 over a DER-encoded certificate -- what the peer's fingerprint is
 * computed over (RFC 8122 s5). */
bool scr_wrtc_fp_of_cert(const uint8_t *der, size_t der_len, uint8_t out[SCR_WRTC_FP_LEN]);

/* Constant-time equality. Not because a fingerprint is secret, but because
 * an early-exit compare leaks how many leading bytes an attacker guessed,
 * which is enough to forge one byte at a time. */
bool scr_wrtc_fp_equal(const uint8_t a[SCR_WRTC_FP_LEN], const uint8_t b[SCR_WRTC_FP_LEN]);

/* Render bytes back to the SDP spelling (uppercase, colon-separated).
 * `out` needs 96 bytes: 32*2 hex + 31 colons + NUL. */
void scr_wrtc_fp_format(const uint8_t fp[SCR_WRTC_FP_LEN], char out[96]);

#endif /* SCR_WRTC_FP_H */
