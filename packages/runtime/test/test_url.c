/* Oracle test for the file-URL bridge's win32 arm.
 * Reads case lines ("<op>\t<arg-hex>\t<expected-hex>\n" — see
 * gen-url-cases.mjs) from argv[1] and asserts byte equality against what
 * Node's fileURLToPath/pathToFileURL with { windows: true } produced.
 * Expected values carry an "OK:" or "ERR:" prefix; a thrown TypeError
 * compares through scr_caught_to_string ("TypeError: <message>" — the
 * same name+message Node reports). chdir("/") matches the generator.
 *
 * Exit 0 = all pass; prints each mismatch (capped) and exits 1 otherwise.
 */
#include "../src/scr_runtime.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define MAX_FIELD 8192

static int hex_val(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

static size_t hex_decode(const char *hex, char *out) {
  if (strcmp(hex, "-") == 0) return 0;
  size_t n = strlen(hex);
  if (n % 2 != 0 || n / 2 > MAX_FIELD) return (size_t)-1;
  for (size_t i = 0; i < n; i += 2) {
    int hi = hex_val(hex[i]), lo = hex_val(hex[i + 1]);
    if (hi < 0 || lo < 0) return (size_t)-1;
    out[i / 2] = (char)((hi << 4) | lo);
  }
  return n / 2;
}

static void hex_print(FILE *f, const char *bytes, size_t len) {
  if (len == 0) {
    fputc('-', f);
    return;
  }
  for (size_t i = 0; i < len; i++) fprintf(f, "%02x", (unsigned char)bytes[i]);
}

static long total = 0, failed = 0;

static void check(const char *op, ScrStr *arg, const char *got, size_t got_len,
                  const char *expected, size_t expected_len) {
  total++;
  if (got_len == expected_len && memcmp(got, expected, got_len) == 0) return;
  failed++;
  if (failed <= 40) {
    fprintf(stderr, "MISMATCH %s(", op);
    hex_print(stderr, arg->data, arg->len);
    fprintf(stderr, ") expected=");
    hex_print(stderr, expected, expected_len);
    fprintf(stderr, " got=");
    hex_print(stderr, got, got_len);
    fputc('\n', stderr);
  }
}

/* "OK:<value>" from a +1 result, or "ERR:<String(e)>" from the pending
 * exception. Returns a fresh ScrStr either way. */
static ScrStr *outcome(ScrStr *result) {
  char buf[MAX_FIELD + 8];
  if (result != NULL) {
    size_t n = result->len > MAX_FIELD ? MAX_FIELD : result->len;
    memcpy(buf, "OK:", 3);
    memcpy(buf + 3, result->data, n);
    scr_str_release(result);
    return scr_str_new(buf, n + 3);
  }
  if (!scr_exc_pending()) return scr_str_new("ERR:<none pending>", 18);
  ScrCaught *c = scr_exc_take();
  ScrStr *msg = scr_caught_to_string(c);
  scr_caught_release(c);
  size_t n = msg->len > MAX_FIELD ? MAX_FIELD : msg->len;
  memcpy(buf, "ERR:", 4);
  memcpy(buf + 4, msg->data, n);
  scr_str_release(msg);
  return scr_str_new(buf, n + 4);
}

int main(int argc, char **argv) {
  if (argc < 2) {
    fputs("usage: test_url <cases-file>\n", stderr);
    return 2;
  }
  FILE *f = fopen(argv[1], "r"); /* before chdir: the path may be relative */
  if (!f) {
    perror("fopen");
    return 2;
  }
  if (chdir("/") != 0) {
    fputs("chdir(\"/\") failed\n", stderr);
    return 2;
  }
  char line[MAX_FIELD * 6];
  static char argbuf[MAX_FIELD];
  static char expbuf[MAX_FIELD];
  while (fgets(line, sizeof line, f)) {
    size_t linelen = strlen(line);
    while (linelen > 0 && (line[linelen - 1] == '\n' || line[linelen - 1] == '\r')) {
      line[--linelen] = 0;
    }
    if (linelen == 0) continue;
    char *tab1 = strchr(line, '\t');
    char *tab2 = tab1 ? strchr(tab1 + 1, '\t') : NULL;
    if (!tab1 || !tab2) {
      fprintf(stderr, "bad line: %s\n", line);
      return 2;
    }
    *tab1 = 0;
    *tab2 = 0;
    const char *op = line;
    size_t arg_len = hex_decode(tab1 + 1, argbuf);
    size_t exp_len = hex_decode(tab2 + 1, expbuf);
    if (arg_len == (size_t)-1 || exp_len == (size_t)-1) {
      fprintf(stderr, "bad hex: %s\n", line);
      return 2;
    }
    ScrStr *arg = scr_str_new(argbuf, arg_len);
    ScrStr *got;
    if (strcmp(op, "u2p") == 0) {
      /* fileURLToPath(string, { windows: true }): parse, then the win32
       * arm — parse failures ARE the expected TypeError for bad URLs. */
      ScrUrl *u = scr_url_new(arg);
      if (u == NULL) {
        got = outcome(NULL);
      } else {
        got = outcome(scr_url_to_path_w32(u));
        scr_url_release(u);
      }
    } else if (strcmp(op, "u2p-posix") == 0) {
      /* fileURLToPath(string, { windows: false }) — the posix arm NAMED.
       * This used to call the public pair on the assumption that it "is
       * the posix arm on this (posix) host"; on a Windows host the public
       * pair is the win32 arm, so the leg checked the wrong side. */
      ScrUrl *u = scr_url_new(arg);
      if (u == NULL) {
        got = outcome(NULL);
      } else {
        got = outcome(scr_url_to_path_posix(u));
        scr_url_release(u);
      }
    } else if (strcmp(op, "p2u-posix") == 0) {
      ScrUrl *u = scr_url_from_path_posix(arg);
      if (u == NULL) {
        got = outcome(NULL);
      } else {
        got = outcome(scr_url_href(u));
        scr_url_release(u);
      }
    } else if (strcmp(op, "p2u") == 0) {
      ScrUrl *u = scr_url_from_path_w32(arg);
      if (u == NULL) {
        got = outcome(NULL);
      } else {
        got = outcome(scr_url_href(u));
        scr_url_release(u);
      }
    } else {
      fprintf(stderr, "unknown op: %s\n", op);
      return 2;
    }
    check(op, arg, got->data, got->len, expbuf, exp_len);
    scr_str_release(got);
    scr_str_release(arg);
  }
  fclose(f);
  fprintf(stderr, "%ld/%ld cases passed\n", total - failed, total);
  return failed == 0 ? 0 : 1;
}
