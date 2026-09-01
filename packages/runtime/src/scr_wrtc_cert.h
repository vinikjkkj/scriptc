/* scr_wrtc_cert.h — the LOCAL DTLS identity.
 *
 * A WebRTC endpoint authenticates with an EPHEMERAL SELF-SIGNED
 * certificate, generated per peer connection and thrown away with it. No CA
 * is involved: the certificate exists only so the handshake has a key to
 * sign with, and the peer's trust in it comes entirely from the SHA-256
 * fingerprint carried in the SDP (RFC 8122). scr_wrtc_fp.c is the verifying
 * half; this is the generating half.
 *
 * ECDSA P-256, which is what browsers generate by default and what every
 * WebRTC peer is required to accept. RSA is permitted by the spec and not
 * served here: it buys nothing this workload needs and costs key-generation
 * time measured in seconds rather than milliseconds.
 */
#ifndef SCR_WRTC_CERT_H
#define SCR_WRTC_CERT_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct ScrWrtcCert ScrWrtcCert;

/* Generate a fresh P-256 self-signed certificate. Returns NULL on failure.
 * The caller owns the result and must free it with scr_wrtc_cert_free. */
ScrWrtcCert *scr_wrtc_cert_generate(void);

void scr_wrtc_cert_free(ScrWrtcCert *c);

/* The DER bytes, borrowed — valid until the cert is freed. This is exactly
 * what the fingerprint is computed over (RFC 8122 s5). */
const uint8_t *scr_wrtc_cert_der(const ScrWrtcCert *c, size_t *len);

/* SHA-256 of the DER, i.e. the value this endpoint must advertise in its
 * own a=fingerprint line. */
bool scr_wrtc_cert_fingerprint(const ScrWrtcCert *c, uint8_t out[32]);

/* The private key, borrowed. mbedtls_ssl_conf_own_cert needs it to sign
 * the handshake, and it lives as long as the cert does. Typed void* so
 * this header does not drag mbedtls/pk.h into every includer; the only
 * caller casts it straight back to mbedtls_pk_context*. */
void *scr_wrtc_cert_pk(const ScrWrtcCert *c);

#endif /* SCR_WRTC_CERT_H */
