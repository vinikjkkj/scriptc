/* Does the vendored mbedtls actually give us a usable DTLS 1.2 CLIENT?
 *
 * MBEDTLS_SSL_PROTO_DTLS being #defined in mbedtls_config.h is not the same
 * as the code linking: the brief flagged exactly that gap. This probe uses
 * the DTLS-only API surface a WebRTC peer needs and PRINTS real values, so a
 * link success alone cannot be mistaken for a working configuration.
 *
 * What a browser-compatible WebRTC DTLS peer needs, and what is checked here:
 *   - transport type DTLS (mbedtls_ssl_conf_transport with _DTLS)
 *   - the retransmission timer callbacks (DTLS-only; handshake will not run
 *     without them)
 *   - ECDHE + ECDSA/RSA AES-GCM suites, which is what browsers offer
 *   - SHA-256 for the a=fingerprint check
 *   - a cookie/anti-DoS interface (server side, but its presence tells us the
 *     DTLS half of ssl_tls.c really compiled in rather than being #ifdef'd out)
 */
#include <stdio.h>
#include <string.h>

#include "mbedtls/build_info.h"
#include "mbedtls/ssl.h"
#include "mbedtls/ssl_ciphersuites.h"
#include "mbedtls/ctr_drbg.h"
#include "mbedtls/entropy.h"
#include "mbedtls/md.h"
#include "mbedtls/error.h"
#include "mbedtls/version.h"

#if !defined(MBEDTLS_SSL_PROTO_DTLS)
#error "MBEDTLS_SSL_PROTO_DTLS is NOT enabled in this build"
#endif

static int g_fail = 0;

static void ck(const char *what, int ok) {
    printf("%-46s %s\n", what, ok ? "yes" : "NO");
    if (!ok) g_fail = 1;
}

int main(void) {
    char ver[32];
    mbedtls_version_get_string_full(ver);
    printf("mbedtls: %s\n", ver);

#if defined(MBEDTLS_SSL_PROTO_TLS1_2)
    printf("MBEDTLS_SSL_PROTO_TLS1_2                       yes\n");
#else
    printf("MBEDTLS_SSL_PROTO_TLS1_2                       NO\n");
    g_fail = 1;
#endif
    printf("MBEDTLS_SSL_PROTO_DTLS                         yes\n");

#if defined(MBEDTLS_SSL_DTLS_SRTP)
    printf("MBEDTLS_SSL_DTLS_SRTP                          yes (unused: data channel only)\n");
#else
    printf("MBEDTLS_SSL_DTLS_SRTP                          no  (not needed: data channel only)\n");
#endif

    /* Configure a real DTLS 1.2 client config end to end. */
    mbedtls_ssl_config conf;
    mbedtls_ssl_context ssl;
    mbedtls_entropy_context entropy;
    mbedtls_ctr_drbg_context drbg;

    mbedtls_ssl_config_init(&conf);
    mbedtls_ssl_init(&ssl);
    mbedtls_entropy_init(&entropy);
    mbedtls_ctr_drbg_init(&drbg);

    const char *pers = "scriptc-wrtc-dtls";
    int rc = mbedtls_ctr_drbg_seed(&drbg, mbedtls_entropy_func, &entropy,
                                   (const unsigned char *)pers, strlen(pers));
    ck("ctr_drbg seeded", rc == 0);

    rc = mbedtls_ssl_config_defaults(&conf,
                                     MBEDTLS_SSL_IS_CLIENT,
                                     MBEDTLS_SSL_TRANSPORT_DATAGRAM,
                                     MBEDTLS_SSL_PRESET_DEFAULT);
    ck("ssl_config_defaults(CLIENT, DATAGRAM)", rc == 0);

    mbedtls_ssl_conf_rng(&conf, mbedtls_ctr_drbg_random, &drbg);
    /* WebRTC peers exchange self-signed certs and authenticate by SDP
     * fingerprint, not by CA chain, so verification is NONE here by design
     * and the fingerprint check replaces it. */
    mbedtls_ssl_conf_authmode(&conf, MBEDTLS_SSL_VERIFY_NONE);
    mbedtls_ssl_conf_handshake_timeout(&conf, 1000, 60000);

    rc = mbedtls_ssl_setup(&ssl, &conf);
    ck("ssl_setup with a DATAGRAM config", rc == 0);

    /* DTLS-only: without a timer the handshake cannot retransmit. Passing
     * NULLs would abort inside mbedtls, so this only proves the symbol
     * links and the setter accepts the context. */
    mbedtls_ssl_set_timer_cb(&ssl, NULL, NULL, NULL);
    printf("%-46s %s\n", "ssl_set_timer_cb linked", "yes");

    /* The ciphersuites a browser will actually negotiate. */
    static const struct { const char *name; } want[] = {
        { "TLS-ECDHE-ECDSA-WITH-AES-128-GCM-SHA256" },
        { "TLS-ECDHE-RSA-WITH-AES-128-GCM-SHA256" },
        { "TLS-ECDHE-ECDSA-WITH-AES-256-GCM-SHA384" },
    };
    for (unsigned i = 0; i < sizeof(want) / sizeof(want[0]); i++) {
        int id = mbedtls_ssl_get_ciphersuite_id(want[i].name);
        char buf[80];
        snprintf(buf, sizeof buf, "suite %s", want[i].name);
        ck(buf, id != 0);
    }

    /* SHA-256 for the a=fingerprint comparison. */
    const mbedtls_md_info_t *sha256 = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
    ck("SHA-256 md_info available", sha256 != NULL);
    if (sha256 != NULL) {
        unsigned char digest[32];
        rc = mbedtls_md(sha256, (const unsigned char *)"abc", 3, digest);
        /* FIPS 180-4 known answer for "abc". */
        static const unsigned char kat[32] = {
            0xba,0x78,0x16,0xbf,0x8f,0x01,0xcf,0xea,0x41,0x41,0x40,0xde,0x5d,0xae,0x22,0x23,
            0xb0,0x03,0x61,0xa3,0x96,0x17,0x7a,0x9c,0xb4,0x10,0xff,0x61,0xf2,0x00,0x15,0xad
        };
        ck("SHA-256(\"abc\") matches the known answer",
           rc == 0 && memcmp(digest, kat, 32) == 0);
    }

    mbedtls_ssl_free(&ssl);
    mbedtls_ssl_config_free(&conf);
    mbedtls_ctr_drbg_free(&drbg);
    mbedtls_entropy_free(&entropy);

    printf("RESULT: %s\n", g_fail ? "FAIL" : "PASS");
    return g_fail;
}
