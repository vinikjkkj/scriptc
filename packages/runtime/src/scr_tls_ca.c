/* node:tls — the CA-store introspection slice: getCACertificates,
 * rootCertificates, and setDefaultCACertificates (scr_runtime.h has the
 * contracts). Its own link gate ("tlsca." libCalls), deliberately free
 * of mbedTLS: everything here is PEM-BLOCK bookkeeping over the host
 * bundle, so a program that only inspects the CA store keeps the lean
 * link line. scr_tls.c (when it links — cc.ts compiles this unit
 * alongside it) consults scr_tls_ca_default_override for its client
 * trust anchors, which is what makes setDefaultCACertificates LIVE
 * semantics: the next https/tls dial verifies against the replaced set.
 *
 * Divergences, documented: the host bundle stands in for Node's
 * compiled-in Mozilla roots ('bundled' and rootCertificates) AND for the
 * platform store ('system') — the same /etc/ssl/cert.pem stance
 * scr_tls.c's anchors established, and on win32 the OS ROOT store is
 * that host bundle (no PEM file ships there); and set-time validation is PEM-BLOCK
 * shaped (a well-formed block with corrupt DER inside is kept here where
 * Node's X509 parse would drop it — such a cert then fails verification
 * instead, the same observable outcome one step later). Deduplication is
 * byte-exact over the extracted block where Node compares parsed X509
 * identities; re-encoded duplicates of one certificate stay distinct
 * entries, which no equality the tests observe can distinguish without a
 * parser. */
#include "scr_runtime.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifdef _WIN32
#include <windows.h>
#include <wincrypt.h> /* the OS ROOT store — see scr_ca_win_root_pem */
#endif

/* The per-type caches: +1 held here for the process lifetime (an atexit
 * teardown releases them so the RC audit stays clean). 'default' also
 * keeps the concatenated PEM buffer scr_tls.c parses into anchors. */
static ScrArr *scr_ca_bundled = NULL;
static ScrArr *scr_ca_system = NULL;
static ScrArr *scr_ca_extra = NULL;
static ScrArr *scr_ca_default = NULL;
static char *scr_ca_override_buf = NULL;
static size_t scr_ca_override_len = 0;
static uint64_t scr_ca_override_gen = 0; /* 0 = never set */

static void scr_ca_oom(void) {
  fputs("scriptc: out of memory\n", stderr);
  abort();
}

static void scr_ca_teardown(void) {
  if (scr_ca_bundled != NULL) scr_arr_release(scr_ca_bundled);
  if (scr_ca_system != NULL) scr_arr_release(scr_ca_system);
  if (scr_ca_extra != NULL) scr_arr_release(scr_ca_extra);
  if (scr_ca_default != NULL) scr_arr_release(scr_ca_default);
  scr_ca_bundled = scr_ca_system = scr_ca_extra = scr_ca_default = NULL;
  free(scr_ca_override_buf);
  scr_ca_override_buf = NULL;
}

static bool scr_ca_teardown_armed = false;

static void scr_ca_arm_teardown(void) {
  if (!scr_ca_teardown_armed) {
    scr_ca_teardown_armed = true;
    atexit(scr_ca_teardown);
  }
}

/* Portable bounded substring search (memmem is GNU/BSD-only; win32 has
 * neither). Needles here are short constant markers — the naive scan is
 * plenty. */
static const char *scr_ca_find(const char *hay, size_t hay_len, const char *needle, size_t needle_len) {
  if (needle_len == 0 || hay_len < needle_len) return NULL;
  for (size_t i = 0; i + needle_len <= hay_len; i++) {
    if (hay[i] == needle[0] && memcmp(hay + i, needle, needle_len) == 0) return hay + i;
  }
  return NULL;
}

/* Every "-----BEGIN CERTIFICATE-----" ... "-----END CERTIFICATE-----"
 * block of `text` (other PEM kinds — keys, CRLs — skip, like Node's CA
 * loaders), pushed onto `arr` as one string each, END line included.
 * Returns the number of blocks found. */
static size_t scr_ca_push_pem_blocks(ScrArr *arr, const char *text, size_t len) {
  static const char BEGIN[] = "-----BEGIN CERTIFICATE-----";
  static const char END[] = "-----END CERTIFICATE-----";
  size_t found = 0;
  const char *p = text;
  const char *limit = text + len;
  while (p < limit) {
    const char *b = scr_ca_find(p, (size_t)(limit - p), BEGIN, sizeof BEGIN - 1);
    if (b == NULL) break;
    const char *e = scr_ca_find(b, (size_t)(limit - b), END, sizeof END - 1);
    if (e == NULL) break;
    const char *stop = e + (sizeof END - 1);
    /* Node's entries carry the block's trailing newline when the source
     * had one — keep it so round-trips through writeFileSync + parse
     * stay concatenation-safe. */
    if (stop < limit && *stop == '\r') stop++;
    if (stop < limit && *stop == '\n') stop++;
    scr_arr_push_ref(arr, scr_str_new(b, (size_t)(stop - b)));
    found++;
    p = stop;
  }
  return found;
}

/* One whole file, malloc'd (NULL on any failure — absent bundles answer
 * empty stores, the same silence Node has on hosts without the file). */
static char *scr_ca_read_file(const char *path, size_t *out_len) {
  FILE *f = fopen(path, "rb");
  if (f == NULL) return NULL;
  if (fseek(f, 0, SEEK_END) != 0) {
    fclose(f);
    return NULL;
  }
  long sz = ftell(f);
  if (sz < 0) {
    fclose(f);
    return NULL;
  }
  rewind(f);
  char *buf = malloc((size_t)sz + 1);
  if (buf == NULL) scr_ca_oom();
  size_t got = fread(buf, 1, (size_t)sz, f);
  fclose(f);
  buf[got] = '\0';
  *out_len = got;
  return buf;
}

#ifdef _WIN32
/* The win32 arm of the bundle probe. Windows answers none of the paths
 * below -- it ships no PEM file, because its trust is a certificate
 * DATABASE -- so this store used to read EMPTY there, and
 * rootCertificates was an empty array while Node's is 145 entries. That
 * is the same gap scr_tls.c's anchor probe had, and the two must move
 * together: the anchor arm now reads the OS ROOT store, so a binary
 * whose dials trust those roots must not report that it trusts nothing.
 *
 * Certificates come out DER-encoded, so they are re-encoded into the PEM
 * text this unit is built around and handed to the SAME block extractor
 * the POSIX bundles use -- entries are then byte-shaped identically on
 * every platform (BEGIN/END markers, 64-column body, trailing newline
 * included), which is what keeps `looksPem` and the concatenation
 * round-trip platform-independent. Still no mbedTLS: this is base64 over
 * bytes, and the lean link line only gains crypt32. */
static void scr_ca_b64_append(char **buf, size_t *len, size_t *cap, const unsigned char *src,
                              size_t n) {
  static const char A[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  /* 4 chars per 3 bytes, a newline every 64 chars, plus slack. */
  size_t need = *len + ((n + 2) / 3) * 4 + ((n / 48) + 2) * 1 + 8;
  if (need > *cap) {
    while (*cap < need) *cap = *cap * 2 + 1024;
    char *nb = realloc(*buf, *cap);
    if (nb == NULL) scr_ca_oom();
    *buf = nb;
  }
  char *o = *buf + *len;
  size_t col = 0;
  for (size_t i = 0; i < n; i += 3) {
    unsigned v = (unsigned)src[i] << 16;
    if (i + 1 < n) v |= (unsigned)src[i + 1] << 8;
    if (i + 2 < n) v |= (unsigned)src[i + 2];
    *o++ = A[(v >> 18) & 0x3f];
    *o++ = A[(v >> 12) & 0x3f];
    *o++ = (i + 1 < n) ? A[(v >> 6) & 0x3f] : '=';
    *o++ = (i + 2 < n) ? A[v & 0x3f] : '=';
    col += 4;
    if (col == 64) {
      *o++ = '\n';
      col = 0;
    }
  }
  if (col != 0) *o++ = '\n';
  *len = (size_t)(o - *buf);
}

static void scr_ca_append(char **buf, size_t *len, size_t *cap, const char *s) {
  size_t n = strlen(s);
  if (*len + n + 1 > *cap) {
    while (*cap < *len + n + 1) *cap = *cap * 2 + 1024;
    char *nb = realloc(*buf, *cap);
    if (nb == NULL) scr_ca_oom();
    *buf = nb;
  }
  memcpy(*buf + *len, s, n);
  *len += n;
}

/* The OS ROOT store as PEM text, malloc'd, or NULL when the store will
 * not open or holds nothing usable. */
static char *scr_ca_win_root_pem(size_t *out_len) {
  HCERTSTORE store = CertOpenSystemStoreW(0, L"ROOT");
  if (store == NULL) return NULL;
  char *buf = NULL;
  size_t len = 0, cap = 0;
  /* A certificate DATABASE may hold one root under several entries, and
   * a PEM file does not: this box's ROOT store answers 99 contexts with
   * repeats among them. Left in, the repeats would be byte-identical
   * blocks, and setDefaultCACertificates' byte-exact dedupe would then
   * collapse them -- so `setDefaultCACertificates(getCACertificates
   * ('bundled'))` would not round-trip its length, which 2557 pins and
   * Node holds. Dedupe the DER here instead, where the database shape
   * is, and the store this unit exposes keeps a PEM file's shape. */
  unsigned char **seen = NULL;
  size_t *seen_len = NULL;
  size_t seen_n = 0, seen_cap = 0;
  PCCERT_CONTEXT ctx = NULL;
  while ((ctx = CertEnumCertificatesInStore(store, ctx)) != NULL) {
    if ((ctx->dwCertEncodingType & X509_ASN_ENCODING) == 0 || ctx->pbCertEncoded == NULL ||
        ctx->cbCertEncoded == 0) {
      continue;
    }
    size_t n = (size_t)ctx->cbCertEncoded;
    bool dup = false;
    for (size_t i = 0; i < seen_n; i++) {
      if (seen_len[i] == n && memcmp(seen[i], ctx->pbCertEncoded, n) == 0) {
        dup = true;
        break;
      }
    }
    if (dup) continue;
    if (seen_n == seen_cap) {
      seen_cap = seen_cap * 2 + 32;
      unsigned char **ns = realloc(seen, seen_cap * sizeof *ns);
      size_t *nl = realloc(seen_len, seen_cap * sizeof *nl);
      if (ns == NULL || nl == NULL) scr_ca_oom();
      seen = ns;
      seen_len = nl;
    }
    unsigned char *copy = malloc(n);
    if (copy == NULL) scr_ca_oom();
    memcpy(copy, ctx->pbCertEncoded, n);
    seen[seen_n] = copy;
    seen_len[seen_n] = n;
    seen_n++;
    scr_ca_append(&buf, &len, &cap, "-----BEGIN CERTIFICATE-----\n");
    scr_ca_b64_append(&buf, &len, &cap, ctx->pbCertEncoded, n);
    scr_ca_append(&buf, &len, &cap, "-----END CERTIFICATE-----\n");
  }
  for (size_t i = 0; i < seen_n; i++) free(seen[i]);
  free(seen);
  free(seen_len);
  CertCloseStore(store, 0);
  if (buf == NULL) return NULL;
  buf[len] = '\0'; /* scr_ca_append always leaves room for the NUL */
  *out_len = len;
  return buf;
}
#endif /* _WIN32 */

/* The host bundle, probed in scr_tls.c's documented order. */
static ScrArr *scr_ca_load_host_bundle(void) {
  ScrArr *arr = scr_arr_new(SCR_ELEM_STR, 128);
  static const char *const bundles[] = {
      "/etc/ssl/cert.pem",                  /* macOS, Alpine */
      "/etc/ssl/certs/ca-certificates.crt", /* Debian/Ubuntu */
      "/etc/pki/tls/certs/ca-bundle.crt",   /* Fedora/RHEL */
      "/etc/ssl/ca-bundle.pem",             /* openSUSE */
  };
  for (size_t i = 0; i < sizeof bundles / sizeof bundles[0]; i++) {
    size_t len = 0;
    char *text = scr_ca_read_file(bundles[i], &len);
    if (text == NULL) continue;
    scr_ca_push_pem_blocks(arr, text, len);
    free(text);
    return arr; /* first bundle wins, like the anchor probe */
  }
#ifdef _WIN32
  {
    size_t len = 0;
    char *text = scr_ca_win_root_pem(&len);
    if (text != NULL) {
      scr_ca_push_pem_blocks(arr, text, len);
      free(text);
    }
  }
#endif
  return arr;
}

static ScrArr *scr_ca_bundled_arr(void) {
  if (scr_ca_bundled == NULL) {
    scr_ca_arm_teardown();
    scr_ca_bundled = scr_ca_load_host_bundle();
  }
  return scr_ca_bundled;
}

static ScrArr *scr_ca_system_arr(void) {
  if (scr_ca_system == NULL) {
    scr_ca_arm_teardown();
    scr_ca_system = scr_ca_load_host_bundle();
  }
  return scr_ca_system;
}

static ScrArr *scr_ca_extra_arr(void) {
  if (scr_ca_extra == NULL) {
    scr_ca_arm_teardown();
    scr_ca_extra = scr_arr_new(SCR_ELEM_STR, 4);
    const char *path = getenv("NODE_EXTRA_CA_CERTS");
    if (path != NULL && path[0] != '\0') {
      size_t len = 0;
      char *text = scr_ca_read_file(path, &len);
      if (text != NULL) {
        scr_ca_push_pem_blocks(scr_ca_extra, text, len);
        free(text);
      }
    }
  }
  return scr_ca_extra;
}

/* 'default' with no override: bundled ∪ extra (Node's own composition
 * when no --use-*-ca flag redirects it). */
static ScrArr *scr_ca_default_arr(void) {
  if (scr_ca_default == NULL) {
    scr_ca_arm_teardown();
    ScrArr *bundled = scr_ca_bundled_arr();
    ScrArr *extra = scr_ca_extra_arr();
    size_t nb = (size_t)scr_arr_len(bundled);
    size_t ne = (size_t)scr_arr_len(extra);
    scr_ca_default = scr_arr_new(SCR_ELEM_STR, nb + ne > 0 ? nb + ne : 1);
    for (size_t i = 0; i < nb; i++) scr_arr_push_ref(scr_ca_default, scr_arr_get_ref(bundled, (double)i));
    for (size_t i = 0; i < ne; i++) scr_arr_push_ref(scr_ca_default, scr_arr_get_ref(extra, (double)i));
  }
  return scr_ca_default;
}

ScrArr *scr_tls_ca_get(ScrStr *type) {
  ScrArr *arr = NULL;
  if (strcmp(type->data, "default") == 0) arr = scr_ca_default_arr();
  else if (strcmp(type->data, "bundled") == 0) arr = scr_ca_bundled_arr();
  else if (strcmp(type->data, "system") == 0) arr = scr_ca_system_arr();
  else if (strcmp(type->data, "extra") == 0) arr = scr_ca_extra_arr();
  if (arr == NULL) {
    /* Node's ERR_INVALID_ARG_VALUE TypeError, message-exact. */
    char msg[256];
    int n = snprintf(msg, sizeof msg, "The argument 'type' is invalid. Received '%s'", type->data);
    scr_throw_error_msg_code(SCR_ERR_TYPE, msg, n < 0 ? 0 : (size_t)n, "ERR_INVALID_ARG_VALUE");
    return NULL;
  }
  return scr_arr_retain(arr);
}

ScrArr *scr_tls_ca_root(void) { return scr_arr_retain(scr_ca_bundled_arr()); }

void scr_tls_ca_set_default(ScrArr *certs) {
  size_t n = (size_t)scr_arr_len(certs);
  /* Extract + dedupe first — a throw must leave the current set intact
   * (Node's own error contract, pinned by the suite's error test). */
  ScrArr *next = scr_arr_new(SCR_ELEM_STR, n > 0 ? n : 1);
  size_t blocks = 0;
  for (size_t i = 0; i < n; i++) {
    ScrStr *entry = scr_arr_get_ref(certs, (double)i); /* +1 */
    size_t before = (size_t)scr_arr_len(next);
    blocks += scr_ca_push_pem_blocks(next, entry->data, entry->len);
    /* Dedupe the freshly pushed blocks against everything before them. */
    size_t after = (size_t)scr_arr_len(next);
    for (size_t j = after; j > before; j--) {
      ScrStr *cand = scr_arr_get_ref(next, (double)(j - 1)); /* +1 */
      bool dup = false;
      for (size_t k = 0; k + 1 < j && !dup; k++) {
        ScrStr *prev = scr_arr_get_ref(next, (double)k); /* +1 */
        dup = prev->len == cand->len && memcmp(prev->data, cand->data, cand->len) == 0;
        scr_str_release(prev);
      }
      scr_str_release(cand);
      if (dup) {
        /* Drop the duplicate: rebuild without index j-1 (rare path —
         * a simple splice via slice would copy anyway; do it in place). */
        ScrArr *trimmed = scr_arr_new(SCR_ELEM_STR, after);
        for (size_t k = 0; k < (size_t)scr_arr_len(next); k++) {
          if (k == j - 1) continue;
          scr_arr_push_ref(trimmed, scr_arr_get_ref(next, (double)k));
        }
        scr_arr_release(next);
        next = trimmed;
      }
    }
    scr_str_release(entry);
  }
  if (n > 0 && blocks == 0) {
    scr_arr_release(next);
    static const char MSG[] = "No valid certificates found in the provided array";
    scr_throw_error_msg_code(SCR_ERR_ERROR, MSG, sizeof MSG - 1, "ERR_CRYPTO_OPERATION_FAILED");
    return;
  }
  /* Commit: the cached 'default' array and the concatenated anchor
   * buffer scr_tls.c parses (NUL-terminated for mbedTLS's PEM mode). */
  scr_ca_arm_teardown();
  if (scr_ca_default != NULL) scr_arr_release(scr_ca_default);
  scr_ca_default = next;
  size_t total = 0;
  size_t count = (size_t)scr_arr_len(next);
  for (size_t i = 0; i < count; i++) {
    ScrStr *s = scr_arr_get_ref(next, (double)i);
    total += s->len;
    scr_str_release(s);
  }
  char *buf = malloc(total + 1);
  if (buf == NULL) scr_ca_oom();
  size_t off = 0;
  for (size_t i = 0; i < count; i++) {
    ScrStr *s = scr_arr_get_ref(next, (double)i);
    memcpy(buf + off, s->data, s->len);
    off += s->len;
    scr_str_release(s);
  }
  buf[off] = '\0';
  free(scr_ca_override_buf);
  scr_ca_override_buf = buf;
  scr_ca_override_len = off;
  scr_ca_override_gen++;
}

bool scr_tls_ca_default_override(const char **pem, size_t *len, uint64_t *gen) {
  if (scr_ca_override_gen == 0) return false;
  *pem = scr_ca_override_buf;
  *len = scr_ca_override_len;
  *gen = scr_ca_override_gen;
  return true;
}
