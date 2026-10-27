/* Typed arrays / Buffer: ONE runtime representation (ScrBytes — see the
 * header contract). An ScrBytes either OWNS its storage or is a VIEW into
 * an owner's (backing set, chain depth exactly 1): DataView, subarray(),
 * and Buffer's slice() all alias JS-exactly; only the plain typed arrays'
 * slice() copies. Coercions are JS-exact
 * (ToUint8/ToUint32 modular truncation, double→float rounding); the
 * encoding conversions (utf8 with WHATWG replacement, hex, base64) match
 * Node byte-for-byte — the differential corpus holds them to it. */
#include "scr_runtime.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef SCR_RC_AUDIT
static long scr_live_bytes = 0;
long scr_bytes_live_count(void) { return scr_live_bytes; }
#endif

static void scr_bytes_oom(void) {
  scr_trap("scriptc: out of memory\n");
}

/* IEEE binary16 <-> double (ECMA-262 Number::toFloat16 and its inverse).
 * The read is exact: every binary16 value is a double. The write rounds the
 * double to the nearest binary16, ties to even, computed by scaling to the
 * target quantum (exact, a power of two) and nearbyint's default
 * round-to-nearest-even. Overflow past the largest finite half rounds to
 * infinity exactly where IEEE does (from 65520 up, halfway to 65536). */
static double scr_bytes_f16_to_f64(uint16_t h) {
  int sign = (h >> 15) & 1;
  int exp = (h >> 10) & 31;
  int mant = h & 1023;
  double v;
  if (exp == 0) v = ldexp((double)mant, -24);
  else if (exp == 31) v = mant ? NAN : INFINITY;
  else v = ldexp((double)(1024 + mant), exp - 25);
  return sign ? -v : v;
}

static uint16_t scr_bytes_f64_to_f16(double v) {
  if (v != v) return 0x7E00;
  uint16_t sign = signbit(v) ? 0x8000 : 0;
  double a = fabs(v);
  if (a == 0.0) return sign;
  if (a >= 65520.0) return sign | 0x7C00;
  int e;
  frexp(a, &e); /* a = m * 2^e, m in [0.5, 1): the half exponent is e - 1 */
  int E = e - 1;
  if (E < -14) {
    /* subnormal: the quantum is 2^-24; the integer result is the mantissa */
    double n = nearbyint(ldexp(a, 24));
    return sign | (uint16_t)n; /* n == 1024 encodes the smallest normal */
  }
  double n = nearbyint(ldexp(a, 10 - E)); /* in [1024, 2048] */
  if (n == 2048.0) { n = 1024.0; E++; }
  if (E > 15) return sign | 0x7C00;
  return sign | (uint16_t)((E + 15) << 10) | (uint16_t)(n - 1024.0);
}

/* ToUint8Clamp (ECMA-262 7.1.12): NaN and everything <= 0 to 0, everything
 * >= 255 to 255, otherwise round to the nearest integer with ties to the
 * EVEN neighbour. Used by every Uint8ClampedArray store. */
static uint8_t scr_bytes_to_u8c(double v) {
  if (!(v > 0.0)) return 0;
  if (v >= 255.0) return 255;
  double f = floor(v);
  if (f + 0.5 < v) return (uint8_t)(f + 1.0);
  if (v < f + 0.5) return (uint8_t)f;
  return ((uint8_t)f % 2 == 0) ? (uint8_t)f : (uint8_t)(f + 1.0);
}

size_t scr_bytes_elem_size(ScrBytesElem elem) {
  /* A TABLE, not a comparison chain, and the reason is size: this TU is in
   * RUNTIME_SOURCES and the win32 link line carries no -ffunction-sections
   * and no --gc-sections (cc.ts:423), so every branch here is paid by a
   * hello-world that never constructs a typed array. Indexed in enum
   * order: U8 U32 F32 I32 F64 I8 BUF I16 U16, then padding so the mask
   * below can never index out of bounds -- a garbage element size is a
   * garbage ALLOCATION size, which is worse than the 4 the comparison
   * chain used to fall through to. The mask is one instruction and the
   * padding is seven bytes of .rodata. */
  static const unsigned char sizes[16] = { 1, 4, 4, 4, 8, 1, 1, 2, 2,
                                           1, 2, 8, 8, 1, 1, 1 };
  /* index 9 is SCR_BYTES_U8C (one byte, like U8); 10 is F16; 11 and 12 are
   * the BigInt64 and BigUint64 views (eight bytes each). */
  return sizes[(unsigned)elem & 15u];
}

/* ── lifecycle ─────────────────────────────────────────────────────────── */

static ScrBytes *scr_bytes_alloc(ScrBytesElem elem, size_t len) {
  ScrBytes *b = calloc(1, sizeof(ScrBytes)) /* own = NULL */;
  if (!b) scr_bytes_oom();
  b->rc = 1;
  b->len = len;
  b->elem = elem;
  /* u8 is the one ambiguous elem (Uint8Array AND Buffer ride it), so it
   * starts UNCLASSIFIED and the producer must say; every other elem
   * names exactly one constructor. See the header. */
  b->flavor = (elem == SCR_BYTES_U8) ? SCR_BF_UNKNOWN : SCR_BF_PLAIN;
  b->data = calloc(len ? len : 1, scr_bytes_elem_size(elem));
  if (!b->data) scr_bytes_oom();
  b->backing = NULL;
  b->weakkey = 0;
  b->abuf = NULL;
#ifdef SCR_RC_AUDIT
  scr_live_bytes++;
#endif
  return b;
}

ScrBytes *scr_bytes_new(ScrBytesElem elem, double n) {
  /* ToIndex: NaN → 0, truncate toward zero; a negative or > 2^53-1 result
   * throws Node's RangeError ("Invalid typed array length: -1"). A
   * fractional 3.5 is length 3 — ToIndex never compares back. */
  double t = (n != n) ? 0 : trunc(n);
  if (!(t >= 0) || t > 9007199254740991.0 || t > (double)(SIZE_MAX / 8)) {
    char num[32];
    size_t numlen = scr_f64_to_str(t, num);
    char msg[80];
    int mlen = snprintf(msg, sizeof msg, "Invalid typed array length: %.*s",
                        (int)numlen, num);
    scr_throw_error_msg(SCR_ERR_RANGE, msg, (size_t)mlen);
    return NULL;
  }
  return scr_bytes_alloc(elem, (size_t)t);
}

ScrBytes *scr_bytes_copy(const ScrBytes *src) {
  ScrBytes *b = scr_bytes_alloc(src->elem, src->len);
  memcpy(b->data, src->data, src->len * scr_bytes_elem_size(src->elem));
  /* A copy of the SAME logical value keeps its flavor — the dyn/jsval
   * boundaries copy where Node passes the object through, so preserving
   * is what keeps them faithful. The two COPY CONSTRUCTORS built on this
   * (`new Uint8Array(buf)`, `Buffer.from(u8)`) take the constructor's
   * flavor instead, and the frontend stamps it over this one. */
  b->flavor = src->flavor;
  return b;
}

/* ── Buffer-ness (see the header) ──────────────────────────────────────── */

ScrBytes *scr_bytes_stamp_buffer(ScrBytes *b) {
  if (b) b->flavor = SCR_BF_BUFFER;
  return b;
}

ScrBytes *scr_bytes_stamp_plain(ScrBytes *b) {
  if (b) b->flavor = SCR_BF_PLAIN;
  return b;
}

ScrBytes *scr_bytes_stamp_dataview(ScrBytes *b) {
  if (b) b->flavor = SCR_BF_DATAVIEW;
  return b;
}

/* The libCall convention: the argument is BORROWED and the result OWNED,
 * so the stamp answers a RETAINED reference to the same value. */
ScrBytes *scr_bytes_mark_buffer(ScrBytes *b) {
  return scr_bytes_retain(scr_bytes_stamp_buffer(b));
}

ScrBytes *scr_bytes_mark_plain(ScrBytes *b) {
  return scr_bytes_retain(scr_bytes_stamp_plain(b));
}

ScrBytes *scr_bytes_mark_dataview(ScrBytes *b) {
  return scr_bytes_retain(scr_bytes_stamp_dataview(b));
}

bool scr_bytes_is_dataview(const ScrBytes *b) {
  return b != NULL && b->flavor == SCR_BF_DATAVIEW;
}

bool scr_bytes_is_plain_u8(const ScrBytes *b, const ScrStr *why) {
  if (b != NULL) {
    if (b->flavor == SCR_BF_PLAIN) return true;
    /* Buffer and DataView are both NOT-Uint8Array here, for different
     * reasons: a Buffer's constructor is Buffer, a DataView's is
     * DataView. Answering `!is_buffer` -- which is what this replaced --
     * got the DataView case wrong the moment DataView acquired a flavor,
     * because the question is three-way and the old spelling was two. */
    if (b->flavor == SCR_BF_BUFFER || b->flavor == SCR_BF_DATAVIEW) return false;
  }
  /* UNCLASSIFIED: the same loud refusal is_buffer raises, naming the same
   * read site, because the value's producer still has not said. */
  scr_bytes_is_buffer(b, why);
  return false;
}

bool scr_bytes_is_buffer(const ScrBytes *b, const ScrStr *why) {
  /* A DataView IS classified, and its answer here is a plain false --
   * `dv.constructor === Buffer` is false in Node and now it is false
   * here too, instead of the throw an unstamped value used to take. */
  if (b && b->flavor == SCR_BF_DATAVIEW) return false;
  if (!b || b->flavor == SCR_BF_UNKNOWN) {
    /* No producer classified this value, so neither answer is honest.
     * Refuse at the READ, naming it — a missed producer has to be
     * findable, never a silently wrong branch. */
    static const char head[] = "the Buffer-ness of this value is unknown "
                               "(its producer stamps no flavor): ";
    size_t whylen = why ? why->len : 0;
    size_t n = sizeof head - 1 + whylen;
    char *msg = malloc(n + 1);
    if (!msg) scr_bytes_oom();
    memcpy(msg, head, sizeof head - 1);
    if (whylen) memcpy(msg + sizeof head - 1, why->data, whylen);
    msg[n] = '\0';
    scr_throw_error_msg(SCR_ERR_ERROR, msg, n);
    free(msg);
    return false;
  }
  return b->flavor == SCR_BF_BUFFER;
}

/* Installed by scr_weak_new; see the note on the declaration. NULL in
 * every binary that never constructs a WeakMap, which is also every
 * binary in which no ScrBytes can carry the mark below. */
void (*scr_weak_died_hook)(void *key) = NULL;

/* ScrBytes' weak-key stamp. One per key kind, each living with its own
 * type, because each writes a field only that type has -- a shared stamp
 * would be a stray store into whichever struct it guessed wrong. */
void scr_bytes_weak_mark(void *key) {
  if (key != NULL) ((ScrBytes *)key)->weakkey = 1;
}

void scr_bytes_release(ScrBytes *b) {
  if (!b || b->rc == SIZE_MAX) return; /* NULL: an uninitialized `let` local */
  if (--b->rc == 0) {
    /* BEFORE any storage goes back, so no WeakMap can still be holding
     * this address when it stops naming this object. Doing it later —
     * in a sweep, at a seam, anywhere — would let a recycled address be
     * found under the dead key's entry and return the previous
     * occupant's value: a wrong answer, not a leak. The full argument is
     * at the head of scr_weak.c. Two loads on the cold rc == 0 path, and
     * only for a value that has actually been a key. */
    if (b->weakkey && scr_weak_died_hook != NULL) scr_weak_died_hook(b);
    if (b->backing) {
      /* An ArrayBuffer window over an owner's storage clears the owner's
       * weak cache slot as it dies (see ScrBytes.abuf). */
      if (b->elem == SCR_BYTES_BUF && b->backing->abuf == b) b->backing->abuf = NULL;
      scr_bytes_release(b->backing); /* a view: data points into the owner */
    } else {
      free(b->data);
    }
    if (b->own != NULL) scr_bytes_own_ops->free(b);
#ifdef SCR_RC_AUDIT
    scr_live_bytes--;
#endif
    free(b);
  }
}

/* The own named-property ops (ScrBytesOwn, scr_bytes_own.c). NULL unless the program's install call ran (the
 * compiler emits it when the program holds a dyn keyed write, which is the only way a value gets an own table). */
const ScrBytesOwnOps *scr_bytes_own_ops = NULL;

void *scr_bytes_retain_v(void *b) { return scr_bytes_retain((ScrBytes *)b); }
void scr_bytes_release_v(void *b) { scr_bytes_release((ScrBytes *)b); }

double scr_bytes_len(const ScrBytes *b) { return (double)b->len; }

double scr_bytes_byte_len(const ScrBytes *b) {
  return (double)(b->len * scr_bytes_elem_size(b->elem));
}

/* ── element access ────────────────────────────────────────────────────
 * JS reads undefined and IGNORES writes out of bounds on typed arrays;
 * both are unrepresentable here, so any invalid index traps — the array
 * runtime's exact discipline (SEMANTICS.md). */

/* Every typed-array element read and write lands here, so what this costs
 * is multiplied by the message rate: on the real zapo messaging bench the
 * suspend-and-sample profiler puts scr_bytes_get at 13.8-16.8% of the SEND
 * group phase, scr_bytes_set at 4.0-9.5%, and `trunc` at 5.4-6.1% as its
 * OWN symbol -- which only happens because it is a real call.
 *
 * This is the SAME defect scr_array.c fixed in 39b8bcd9 and it was never
 * carried across to the typed-array path, which is the one a protocol
 * client actually uses: every protobuf field, every AES block and every
 * HMAC byte is a Uint8Array element access.
 *
 * `i != trunc(i)` is the integrality test, and on a baseline x86-64 target
 * with no SSE4.1 clang cannot lower trunc to one `roundsd`, so it emits
 * `callq trunc` into libm. Measured on the shipping toolchain: the libm
 * shape is 36 instructions with a call, an xmm6 spill and a 56-byte frame;
 * the integer-domain shape is a leaf with no call, no spill and no frame.
 * The bound also converted b->len to a DOUBLE on every access; comparing
 * as integers drops that too.
 *
 * For 0 <= i < 2^53 none of it is needed: (int64_t)i truncates exactly and
 * is defined, one cvtsi2sd comes back, equality with i IS integrality.
 * Everything the fast window does not accept -- NaN, negatives, fractions,
 * both infinities, |i| >= 2^53 and every out-of-range index -- falls into
 * scr_bytes_check_index_slow, whose test is the original expression
 * character for character. The fast arm accepts a strict SUBSET of what
 * that expression accepts and returns the same (size_t)i, so the answer is
 * unchanged for every double. -0.0 still reads element 0: -0.0 >= 0 is
 * true and (double)0 == -0.0 is true.
 *
 * The slow arm is cold and noinline for the reason scr_array.c records:
 * inline, its char buf[32] and its two calls put a frame and callee-saved
 * pushes on the HOT path, and out of line the fast arm calls nothing.
 *
 * SCR_FASTIDX=0 sends every access down the slow arm -- the original
 * expression -- so an A/B runs the SAME binary and no code moves between
 * the arms. */
#if defined(__GNUC__) || defined(__clang__)
#define SCR_BYTES_COLD __attribute__((noinline, cold))
#else
#define SCR_BYTES_COLD
#endif

#define SCR_BYTES_FAST_MAX 9007199254740992.0 /* 2^53 */

static signed char scr_bytes_fastidx_cache = -1;

SCR_BYTES_COLD static int scr_bytes_fastidx_init(void) {
  const char *e = getenv("SCR_FASTIDX");
  scr_bytes_fastidx_cache = (e != NULL && e[0] == '0' && e[1] == 0) ? 0 : 1;
  return scr_bytes_fastidx_cache;
}

static int scr_bytes_fastidx(void) {
  int c = scr_bytes_fastidx_cache;
  return c >= 0 ? c : scr_bytes_fastidx_init();
}

SCR_BYTES_COLD static size_t scr_bytes_check_index_slow(const ScrBytes *b, double i) {
  if (!(i >= 0) || i != trunc(i) || i >= (double)b->len) {
    char buf[32];
    scr_f64_to_str(i, buf);
    scr_trap_fmt("scriptc: RangeError: typed array index %s out of bounds (length %zu)\n",
                 buf, b->len);
  }
  return (size_t)i;
}

static size_t scr_bytes_check_index(const ScrBytes *b, double i) {
  if (scr_bytes_fastidx() && i >= 0.0 && i < SCR_BYTES_FAST_MAX) {
    int64_t n = (int64_t)i;
    if ((double)n == i && (uint64_t)n < (uint64_t)b->len) return (size_t)n;
  }
  return scr_bytes_check_index_slow(b, i);
}

/* The double-typed view of a bigint element is a lowering bug: the compiler
 * routes every bigint view's element access through scr_bytes_get_big and
 * scr_bytes_set_big, so reaching this arm means a site built a double
 * access for a bigint view. Loud, never a made-up number. */
SCR_BYTES_COLD static void scr_bytes_bigint_as_double(const char *op, size_t idx, size_t len) {
  scr_trap_fmt("scriptc: internal error: %s at index %zu on a BigInt typed array "
               "(length %zu) -- its elements are bigints, so a double access is a "
               "lowering bug\n", op, idx, len);
}

/* The exported element index check (the gated bigint unit calls it). */
size_t scr_bytes_index_checked(const ScrBytes *b, double i) {
  return scr_bytes_check_index(b, i);
}

/* ToUint32: NaN/±Infinity → 0, truncate toward zero, wrap mod 2^32.
 * ToUint8 is its low byte (2^8 divides 2^32, so the residues agree). */
SCR_BYTES_COLD static uint32_t scr_bytes_to_u32_slow(double v) {
  double t;
  if (v != v || isinf(v)) return 0;
  t = trunc(v);
  t = fmod(t, 4294967296.0);
  if (t < 0) t += 4294967296.0;
  return (uint32_t)t;
}

/* The store arm's own pair of libm calls, and one of them is `fmod`. For
 * any v an int64 can hold, truncation toward zero followed by the 2^32
 * residue IS the low 32 bits of that int64 in two's complement -- which is
 * exactly what the wrap-to-unsigned conversion computes, for negatives as
 * well (-1 -> 4294967295 on both arms). NaN and both infinities fail the
 * window and reach the slow arm, which answers 0 as before. */
static uint32_t scr_bytes_to_u32(double v) {
  if (scr_bytes_fastidx() && v >= -9223372036854775808.0 &&
      v < 9223372036854775808.0)
    return (uint32_t)(int64_t)v;
  return scr_bytes_to_u32_slow(v);
}

double scr_bytes_get(const ScrBytes *b, double i) {
#ifdef SCR_ARRCEN_ON
  /* tests/perf/arrcensus/scr_arr_census.h. Inert -- the switch is
   * undefined -- unless that header is -include'd. The profile gives this
   * function a SHARE; only a count prices a per-call change. */
  scr_arrcen_note_bytes(SCR_ARRCEN_BYTESGET, (long long)b->len, (int)b->elem);
#ifdef SCR_ARRCEN_HAS_ARM
  scr_arrcen_note_arm(SCR_ARRCEN_BYTESGET, (long long)b->len, (int)b->elem, i, 0.0);
#endif
#endif
  size_t idx = scr_bytes_check_index(b, i);
  switch (b->elem) {
    case SCR_BYTES_U8:
    case SCR_BYTES_U8C:
      return (double)b->data[idx];
    case SCR_BYTES_F16: {
      uint16_t h;
      memcpy(&h, b->data + idx * 2, 2);
      return scr_bytes_f16_to_f64(h);
    }
    case SCR_BYTES_U32: {
      uint32_t v;
      memcpy(&v, b->data + idx * 4, 4);
      return (double)v;
    }
    case SCR_BYTES_F32: {
      float v;
      memcpy(&v, b->data + idx * 4, 4);
      return (double)v;
    }
    case SCR_BYTES_I32: {
      int32_t v;
      memcpy(&v, b->data + idx * 4, 4);
      return (double)v;
    }
    case SCR_BYTES_F64: {
      double v;
      memcpy(&v, b->data + idx * 8, 8);
      return v;
    }
    case SCR_BYTES_I8:
      return (double)(int8_t)b->data[idx];
    case SCR_BYTES_I16:
    case SCR_BYTES_U16: {
      /* ONE load; only the reinterpretation differs, which is the same
       * shape the store one function down already has. Two arms with two
       * memcpys cost every binary in the tree (see elem_size above). */
      uint16_t v;
      memcpy(&v, b->data + idx * 2, 2);
      return b->elem == SCR_BYTES_I16 ? (double)(int16_t)v : (double)v;
    }
    case SCR_BYTES_I64:
    case SCR_BYTES_U64:
      scr_bytes_bigint_as_double("element read", idx, b->len);
      return 0;
    case SCR_BYTES_BUF:
      /* An ArrayBuffer has no index signature, so no CORRECT program
       * reaches this arm and the type world never emits an element read
       * against bytes<buf>. Reaching it means a producer built a BUF
       * payload and handed it on wearing a typed array's type — the one
       * mistake this switch can be asked to make.
       *
       * It used to be the `return 0` below, and that is how a WebSocket
       * frame became an empty protobuf message with no diagnostic
       * anywhere: the ArrayBuffer the socket delivers was boxed into the
       * dyn tree's BYTES kind instead of its ARRBUF kind, so
       * `data instanceof Uint8Array` said true, the buffer travelled on
       * as a Uint8Array, and its `length` still answered (it is just
       * b->len) while every INDEX answered zero. A 3-byte big-endian
       * frame header read 0/0/0, the frame length computed to 0, and the
       * decoder was handed an empty view of a 347-byte reply — whose
       * honest answer to an empty buffer is an empty message.
       *
       * Loud beats lost, the same stance ScrBytesFlavor's UNKNOWN takes
       * one field over: a missed producer is a fence at a named site. */
      scr_trap_fmt("scriptc: internal error: element read at index %zu on an ArrayBuffer "
                   "payload (length %zu) -- an ArrayBuffer has no elements; the value "
                   "reached a typed-array read wearing the wrong kind\n",
                   idx, b->len);
      return 0;
  }
  return 0; /* unreachable */
}

/* The LIBCALL face of scr_runtime.h's inline element accessors, for the
 * LLVM lane. One implementation, two faces: everything these can answer,
 * the inline above answers with the same expression, and everything else
 * falls through to the function below in both. */
double scr_bytes_get_fast(const ScrBytes *b, double i) { return scr_bytes_get_inl(b, i); }
void scr_bytes_set_fast(ScrBytes *b, double i, double v) { scr_bytes_set_inl(b, i, v); }

void scr_bytes_set(ScrBytes *b, double i, double v) {
#ifdef SCR_ARRCEN_ON
  scr_arrcen_note_bytes(SCR_ARRCEN_BYTESSET, (long long)b->len, (int)b->elem);
#ifdef SCR_ARRCEN_HAS_ARM
  scr_arrcen_note_arm(SCR_ARRCEN_BYTESSET, (long long)b->len, (int)b->elem, i, v);
#endif
#endif
  size_t idx = scr_bytes_check_index(b, i);
  switch (b->elem) {
    case SCR_BYTES_U8:
      b->data[idx] = (uint8_t)scr_bytes_to_u32(v);
      break;
    case SCR_BYTES_U8C:
      b->data[idx] = scr_bytes_to_u8c(v);
      break;
    case SCR_BYTES_F16: {
      uint16_t h = scr_bytes_f64_to_f16(v);
      memcpy(b->data + idx * 2, &h, 2);
      break;
    }
    case SCR_BYTES_U32: {
      uint32_t u = scr_bytes_to_u32(v);
      memcpy(b->data + idx * 4, &u, 4);
      break;
    }
    case SCR_BYTES_F32: {
      float f = (float)v; /* round-to-nearest-even, exactly Float32Array */
      memcpy(b->data + idx * 4, &f, 4);
      break;
    }
    case SCR_BYTES_F64:
      /* The element IS the double the runtime already carries: no
       * coercion, no rounding — a Float64Array store is exact. */
      memcpy(b->data + idx * 8, &v, 8);
      break;
    case SCR_BYTES_I8:
      /* ToInt8 is ToUint32's residue narrowed to 8 bits, reinterpreted. */
      b->data[idx] = (uint8_t)scr_bytes_to_u32(v);
      break;
    case SCR_BYTES_I16:
    case SCR_BYTES_U16: {
      /* ToInt16 and ToUint16 are the SAME 16 bits -- ToUint32's 2^32
       * residue truncated -- and differ only in how the READ above
       * reinterprets them. One arm, exactly as I8 shares its store with
       * a hypothetical U8: `new Int16Array([70000])[0]` is 4464 and
       * `new Uint16Array([-1])[0]` is 65535 out of this same line. */
      uint16_t u = (uint16_t)scr_bytes_to_u32(v);
      memcpy(b->data + idx * 2, &u, 2);
      break;
    }
    case SCR_BYTES_I32: {
      /* ToInt32 is ToUint32 reinterpreted signed (same 2^32 residue). */
      uint32_t u = scr_bytes_to_u32(v);
      int32_t s;
      memcpy(&s, &u, 4);
      memcpy(b->data + idx * 4, &s, 4);
      break;
    }
    case SCR_BYTES_I64:
    case SCR_BYTES_U64:
      scr_bytes_bigint_as_double("element write", idx, b->len);
      break;
    case SCR_BYTES_BUF:
      /* The write twin of the read arm above, and the worse half: a
       * silent no-op here loses the caller's data instead of merely
       * answering zero. Same cause, same fence. */
      scr_trap_fmt("scriptc: internal error: element write at index %zu on an ArrayBuffer "
                   "payload (length %zu) -- an ArrayBuffer has no elements; the value "
                   "reached a typed-array write wearing the wrong kind\n",
                   idx, b->len);
      break;
  }
}

/* ── slice (copy) / subarray (view) ────────────────────────────────────── */

/* Relative index: ToIntegerOrInfinity, negatives from the end, clamped. */
static size_t scr_bytes_rel_index(double i, size_t len) {
  if (i != i) return 0;
  double t = trunc(i);
  if (t < 0) t += (double)len;
  if (t < 0) return 0;
  if (t > (double)len) return len;
  return (size_t)t;
}

ScrBytes *scr_bytes_slice(const ScrBytes *b, double start, double end) {
  size_t s = scr_bytes_rel_index(start, b->len);
  size_t e = scr_bytes_rel_index(end, b->len);
  size_t count = e > s ? e - s : 0;
  size_t esize = scr_bytes_elem_size(b->elem);
  ScrBytes *out = scr_bytes_alloc(b->elem, count);
  memcpy(out->data, b->data + s * esize, count * esize);
  /* TypedArray.prototype.slice builds through SpeciesConstructor, and
   * Buffer sets no Symbol.species, so a Buffer's slice IS a Buffer
   * (verified against Node, both directions). The flavor rides. */
  out->flavor = b->flavor;
  return out;
}

/* TypedArray.prototype.fill on non-u8 receivers: per-ELEMENT fill with
 * the element write's JS-exact coercion (ToUint32/ToInt32 wrap, f32
 * rounding), slice-clamped relative indices; answers the receiver +1
 * (chaining). Never throws — Buffer's throwing fill family is separate. */
ScrBytes *scr_bytes_fill_elem(ScrBytes *b, double v, double start, double end) {
  size_t s = scr_bytes_rel_index(start, b->len);
  size_t e = scr_bytes_rel_index(end, b->len);
  for (size_t i = s; i < e; i++) scr_bytes_set(b, (double)i, v);
  return scr_bytes_retain(b);
}

/* copyWithin(target, start, end): an in-place move with slice-style
 * relative indices, never throws, receiver back at +1.
 *
 * memmove and NOT memcpy, and that is the entire point of the method: the
 * source and destination ranges are the SAME buffer and are expected to
 * overlap. zapo-js 1.8.2 uses it to slide a trailing HMAC window down over
 * itself (media/crypto/WaMediaCrypto.ts:508), which is precisely the
 * overlapping case memcpy leaves undefined.
 *
 * The count is clamped twice, per spec: by how much source there is
 * (final - from) and by how much room remains at the destination
 * (len - to). */
ScrBytes *scr_bytes_copy_within(ScrBytes *b, double target, double start, double end) {
  size_t esz = scr_bytes_elem_size(b->elem);
  size_t to = scr_bytes_rel_index(target, b->len);
  size_t from = scr_bytes_rel_index(start, b->len);
  size_t fin = scr_bytes_rel_index(end, b->len);
  size_t avail = fin > from ? fin - from : 0;
  size_t room = b->len - to;
  size_t count = avail < room ? avail : room;
  if (count > 0) memmove(b->data + to * esz, b->data + from * esz, count * esz);
  return scr_bytes_retain(b);
}

/* subarray(start, end): a same-elem VIEW over the receiver's storage —
 * TypedArray.prototype.subarray and Buffer's slice()/subarray() all alias
 * in JS (mutations are visible both ways; buffer-swap through a slice is
 * the canonical Node use). Chain depth stays exactly 1: a subarray of a
 * view retains the OWNER, offsets composed here (the DataView rule).
 * Relative indices clamp like slice; never throws. */
ScrBytes *scr_bytes_subarray(ScrBytes *b, double start, double end) {
  size_t s = scr_bytes_rel_index(start, b->len);
  size_t e = scr_bytes_rel_index(end, b->len);
  size_t count = e > s ? e - s : 0;
  ScrBytes *owner = b->backing ? b->backing : b;
  ScrBytes *v = calloc(1, sizeof(ScrBytes)) /* own = NULL */;
  if (!v) scr_bytes_oom();
  v->rc = 1;
  v->len = count;
  v->elem = b->elem;
  /* subarray is species-built too — `buf.subarray()` is a Buffer, and
   * Buffer.prototype.slice IS this function. */
  v->flavor = b->flavor;
  v->data = b->data + s * scr_bytes_elem_size(b->elem);
  v->backing = scr_bytes_retain(owner);
  v->weakkey = 0;
  v->abuf = NULL;
#ifdef SCR_RC_AUDIT
  scr_live_bytes++;
#endif
  return v;
}

void scr_bytes_set_from(ScrBytes *dst, const ScrBytes *src, double offset) {
  double t = (offset != offset) ? 0 : trunc(offset);
  if (!(t >= 0) || (double)src->len + t > (double)dst->len) {
    static const char msg[] = "offset is out of bounds";
    scr_throw_error_msg(SCR_ERR_RANGE, msg, sizeof msg - 1);
    return;
  }
  size_t esize = scr_bytes_elem_size(dst->elem);
  memmove(dst->data + (size_t)t * esize, src->data, src->len * esize);
}

/* ── DataView (the ONE view kind — see the header contract) ────────────── */

/* `new <Typed>Array(arrayBuffer)`: a VIEW over the buffer's storage (chain
 * depth 1: the owner is retained, never the window), element count =
 * byteLength / size. A byte length that is not a multiple of the element
 * size is V8's RangeError. NULL with the exception pending on that. */
ScrBytes *scr_typed_view_over(ScrBytes *buf, ScrBytesElem elem) {
  ScrBytes *owner = buf->backing ? buf->backing : buf;
  const size_t esz = scr_bytes_elem_size(elem);
  const size_t bytes = buf->len * (buf->elem == SCR_BYTES_BUF ? 1 : scr_bytes_elem_size(buf->elem));
  if (bytes % esz != 0) {
    char msg[96];
    static const char *const names[] = { "Uint8Array", "Uint32Array", "Float32Array", "Int32Array",
                                         "Float64Array", "Int8Array", "ArrayBuffer", "Int16Array",
                                         "Uint16Array", "Uint8ClampedArray", "Float16Array",
                                         "BigInt64Array", "BigUint64Array" };
    const int n = snprintf(msg, sizeof msg, "byte length of %s should be a multiple of %zu",
                           names[(unsigned)elem < 13 ? (unsigned)elem : 0], esz);
    scr_throw_error_msg(SCR_ERR_RANGE, msg, (size_t)n);
    return NULL;
  }
  ScrBytes *v = calloc(1, sizeof(ScrBytes)) /* own = NULL */;
  if (!v) scr_bytes_oom();
  v->rc = 1;
  v->len = bytes / esz;
  v->elem = elem;
  v->flavor = SCR_BF_PLAIN;
  v->weakkey = 0;
  v->data = buf->data;
  v->backing = scr_bytes_retain(owner);
  v->abuf = NULL;
#ifdef SCR_RC_AUDIT
  scr_live_bytes++;
#endif
  return v;
}

ScrBytes *scr_bytes_array_buffer(ScrBytes *b) {
  ScrBytes *owner = b->backing ? b->backing : b;
  /* An owner that already IS an ArrayBuffer answers itself. */
  if (owner->elem == SCR_BYTES_BUF) return scr_bytes_retain(owner);
  if (owner->abuf != NULL) return scr_bytes_retain(owner->abuf);
  ScrBytes *w = calloc(1, sizeof(ScrBytes)) /* own = NULL */;
  if (!w) scr_bytes_oom();
  w->rc = 1;
  w->len = owner->len * scr_bytes_elem_size(owner->elem); /* an ArrayBuffer counts BYTES */
  w->elem = SCR_BYTES_BUF;
  w->flavor = SCR_BF_PLAIN;
  w->weakkey = 0;
  w->data = owner->data; /* the same storage: a window, not a copy */
  w->backing = scr_bytes_retain(owner);
  w->abuf = NULL;
  owner->abuf = w; /* weak; cleared when w dies (scr_bytes_release) */
#ifdef SCR_RC_AUDIT
  scr_live_bytes++;
#endif
  return w;
}

double scr_bytes_byte_offset(const ScrBytes *b) {
  return b->backing ? (double)(size_t)(b->data - b->backing->data) : 0;
}

ScrBytes *scr_dataview_new(ScrBytes *src, double byte_off, bool has_len, double byte_len) {
  /* `x.buffer` names the ONE buffer behind x — for a view src that is its
   * owner's storage, so indices stay buffer-relative exactly like JS. */
  ScrBytes *owner = src->backing ? src->backing : src;
  double buf_bytes = (double)(owner->len * scr_bytes_elem_size(owner->elem));
  /* ToIndex on the offset; every bad value takes Node's ONE message
   * (negative, > 2^53-1, Infinity, and past-the-end alike). */
  double off = (byte_off != byte_off) ? 0 : trunc(byte_off);
  if (!(off >= 0) || off > 9007199254740991.0 || off > buf_bytes) {
    char num[32];
    size_t numlen = scr_f64_to_str(off, num);
    char msg[96];
    int mlen = snprintf(msg, sizeof msg, "Start offset %.*s is outside the bounds of the buffer",
                        (int)numlen, num);
    scr_throw_error_msg(SCR_ERR_RANGE, msg, (size_t)mlen);
    return NULL;
  }
  double len;
  if (has_len) {
    len = (byte_len != byte_len) ? 0 : trunc(byte_len);
    if (!(len >= 0) || len > 9007199254740991.0 || off + len > buf_bytes) {
      char num[32];
      size_t numlen = scr_f64_to_str(len, num);
      char msg[64];
      int mlen = snprintf(msg, sizeof msg, "Invalid DataView length %.*s", (int)numlen, num);
      scr_throw_error_msg(SCR_ERR_RANGE, msg, (size_t)mlen);
      return NULL;
    }
  } else {
    len = buf_bytes - off;
  }
  ScrBytes *v = calloc(1, sizeof(ScrBytes)) /* own = NULL */;
  if (!v) scr_bytes_oom();
  v->rc = 1;
  v->len = (size_t)len; /* elem u8 — len IS the byte length */
  v->elem = SCR_BYTES_U8;
  /* THREE spellings share this constructor: `new DataView(x.buffer, ..)`,
   * `new Uint8Array(x.buffer, ..)` and `Buffer.from(x.buffer, ..)`. Only
   * the spelling knows which, so the frontend stamps the two it can name
   * and a bare DataView stays UNCLASSIFIED — DataView is neither of the
   * two constructors this flag distinguishes, and guessing one would be
   * the wrong answer for both. The DataView spelling now has a flavor of
   * its OWN (SCR_BF_DATAVIEW) and lowerDataViewNew stamps it over this
   * one; the default stays UNKNOWN so the other two spellings, which
   * stamp their own, are unaffected. */
  v->flavor = SCR_BF_UNKNOWN;
  v->data = owner->data + (size_t)off;
  v->backing = scr_bytes_retain(owner);
  v->weakkey = 0;
  v->abuf = NULL;
#ifdef SCR_RC_AUDIT
  scr_live_bytes++;
#endif
  return v;
}

/* IEEE 754 binary16 <-> double, for DataView.prototype.getFloat16 /
 * setFloat16 (ES2025; shipped in V8 13.x, so Node v24 has them).
 *
 * The narrowing rounds the DOUBLE straight to half, to nearest with ties
 * to even. Going through a float first would round twice and answer
 * wrong at the halfway points, which is exactly where a test would look.
 * NaN canonicalizes to 0x7e00; the sign of zero and of the infinities is
 * kept; |v| >= 65520 (the halfway point above the largest finite half)
 * rounds to infinity because the mantissa carry propagates into the
 * exponent field. */
static uint16_t scr_f64_to_f16_bits(double v) {
  uint64_t b;
  memcpy(&b, &v, 8);
  const uint16_t sign = (uint16_t)((b >> 48) & 0x8000u);
  const int exp = (int)((b >> 52) & 0x7ff);
  const uint64_t mant = b & 0xfffffffffffffULL;
  if (exp == 0x7ff) return (uint16_t)(sign | (mant ? 0x7e00u : 0x7c00u));
  if (exp == 0) return sign; /* zero and the double subnormals: below half's range */
  const int e = exp - 1023;
  if (e > 15) return (uint16_t)(sign | 0x7c00u);
  if (e >= -14) {
    uint32_t h = (uint32_t)(((e + 15) << 10) | (int)(mant >> 42));
    const uint64_t rem = mant & ((1ULL << 42) - 1);
    const uint64_t halfway = 1ULL << 41;
    if (rem > halfway || (rem == halfway && (h & 1u))) h++;
    return (uint16_t)(sign | h);
  }
  if (e < -25) return sign;
  const int shift = 28 - e; /* 43..53 */
  const uint64_t sig = (1ULL << 52) | mant;
  uint64_t q = sig >> shift;
  const uint64_t rem = sig & ((1ULL << shift) - 1);
  const uint64_t halfway = 1ULL << (shift - 1);
  if (rem > halfway || (rem == halfway && (q & 1u))) q++;
  return (uint16_t)(sign | (uint16_t)q);
}

static double scr_f16_bits_to_f64(uint16_t h) {
  const int sign = (h & 0x8000u) ? -1 : 1;
  const int exp = (h >> 10) & 0x1f;
  const int mant = h & 0x3ff;
  if (exp == 0x1f) return mant ? (double)NAN : sign * (double)INFINITY;
  if (exp == 0) return sign * ldexp((double)mant, -24);
  return sign * ldexp((double)(mant | 0x400), exp - 25);
}

static size_t scr_dataview_get_size(ScrDataViewGet kind) {
  switch (kind) {
    case SCR_DV_U8:
    case SCR_DV_I8:
      return 1;
    case SCR_DV_U16:
    case SCR_DV_I16:
    case SCR_DV_F16:
      return 2;
    case SCR_DV_U32:
    case SCR_DV_I32:
    case SCR_DV_F32:
      return 4;
    default:
      return 8;
  }
}

double scr_dataview_get(const ScrBytes *b, double byte_off, ScrDataViewGet kind, bool le) {
  size_t width = scr_dataview_get_size(kind);
  /* ToIndex, then the view-relative bounds check — Node's ONE constant
   * message for every failure mode (negative, NaN is fine, too large). */
  double off = (byte_off != byte_off) ? 0 : trunc(byte_off);
  if (!(off >= 0) || off > 9007199254740991.0 || off + (double)width > (double)b->len) {
    static const char msg[] = "Offset is outside the bounds of the DataView";
    scr_throw_error_msg(SCR_ERR_RANGE, msg, sizeof msg - 1);
    return 0;
  }
  const uint8_t *p = b->data + (size_t)off;
  /* Assemble host-independently; le false is the JS big-endian default. */
  uint64_t u = 0;
  for (size_t i = 0; i < width; i++) {
    u |= (uint64_t)p[le ? i : width - 1 - i] << (8 * i);
  }
  switch (kind) {
    case SCR_DV_U8:
    case SCR_DV_U16:
    case SCR_DV_U32:
      return (double)u;
    case SCR_DV_I8:
      return (double)(int8_t)u;
    case SCR_DV_I16:
      return (double)(int16_t)u;
    case SCR_DV_I32:
      return (double)(int32_t)u;
    case SCR_DV_F16:
      return scr_f16_bits_to_f64((uint16_t)u);
    case SCR_DV_F32: {
      uint32_t bits = (uint32_t)u;
      float f;
      memcpy(&f, &bits, 4);
      return (double)f;
    }
    case SCR_DV_F64: {
      double d;
      memcpy(&d, &u, 8);
      return d;
    }
    case SCR_DV_BIGU64:
      /* Number(view.getBigUint64(...)): u64 → double rounds to nearest
       * even — the same conversion Number(bigint) performs. */
      return (double)u;
    case SCR_DV_BIGI64:
      return (double)(int64_t)u;
  }
  return 0; /* unreachable */
}

void scr_dataview_set(ScrBytes *b, double byte_off, double value, ScrDataViewGet kind, bool le) {
  size_t width = scr_dataview_get_size(kind);
  /* ToIndex + the view-relative bounds check — the getters' ONE message. */
  double off = (byte_off != byte_off) ? 0 : trunc(byte_off);
  if (!(off >= 0) || off > 9007199254740991.0 || off + (double)width > (double)b->len) {
    static const char msg[] = "Offset is outside the bounds of the DataView";
    scr_throw_error_msg(SCR_ERR_RANGE, msg, sizeof msg - 1);
    return;
  }
  /* Coerce to the stored bit pattern. The integer kinds share ToUint32's
   * 2^32 residue (signed/unsigned store the same bits; narrower widths
   * take the low bytes — 2^width divides 2^32, so the residues agree);
   * F32 rounds double→float to nearest even, exactly the spec. */
  uint64_t u = 0;
  switch (kind) {
    case SCR_DV_U8:
    case SCR_DV_I8:
    case SCR_DV_U16:
    case SCR_DV_I16:
    case SCR_DV_U32:
    case SCR_DV_I32:
      u = (uint64_t)scr_bytes_to_u32(value);
      break;
    case SCR_DV_F16:
      u = scr_f64_to_f16_bits(value);
      break;
    case SCR_DV_F32: {
      float f = (float)value;
      uint32_t bits;
      memcpy(&bits, &f, 4);
      u = bits;
      break;
    }
    case SCR_DV_F64:
      memcpy(&u, &value, 8);
      break;
    default:
      return; /* the BIG kinds carry a bigint — scr_dataview_set_big */
  }
  /* Scatter host-independently; le false is the JS big-endian default. */
  uint8_t *p = b->data + (size_t)off;
  for (size_t i = 0; i < width; i++) {
    p[le ? i : width - 1 - i] = (uint8_t)(u >> (8 * i));
  }
}

/* The eight-byte forms, as RAW BITS, for the BigInt members of a dynamic
 * DataView receiver (scr_dyn_invoke.c). The static getBigInt64 spelling
 * answers a double (Number(view.getBigInt64(...))) and so loses the low
 * bits past 2^53; these answer the 64 bits themselves, and the caller
 * boxes them as the bigint they are. Same ToIndex and the same ONE
 * constant RangeError as every other DataView accessor. Return false with
 * the exception pending when the offset is invalid. */
bool scr_dataview_get_bits64(const ScrBytes *b, double byte_off, bool le, uint64_t *out) {
  double off = (byte_off != byte_off) ? 0 : trunc(byte_off);
  if (!(off >= 0) || off > 9007199254740991.0 || off + 8.0 > (double)b->len) {
    static const char msg[] = "Offset is outside the bounds of the DataView";
    scr_throw_error_msg(SCR_ERR_RANGE, msg, sizeof msg - 1);
    return false;
  }
  const uint8_t *p = b->data + (size_t)off;
  uint64_t u = 0;
  for (size_t i = 0; i < 8; i++) u |= (uint64_t)p[le ? i : 7 - i] << (8 * i);
  *out = u;
  return true;
}

bool scr_dataview_set_bits64(ScrBytes *b, double byte_off, uint64_t bits, bool le) {
  double off = (byte_off != byte_off) ? 0 : trunc(byte_off);
  if (!(off >= 0) || off > 9007199254740991.0 || off + 8.0 > (double)b->len) {
    static const char msg[] = "Offset is outside the bounds of the DataView";
    scr_throw_error_msg(SCR_ERR_RANGE, msg, sizeof msg - 1);
    return false;
  }
  uint8_t *p = b->data + (size_t)off;
  for (size_t i = 0; i < 8; i++) p[le ? i : 7 - i] = (uint8_t)(bits >> (8 * i));
  return true;
}

/* ── encodings (u8 only — the compiler routes only u8 receivers here) ──── */

static const char scr_hex_digits[] = "0123456789abcdef";

/* WHATWG UTF-8 decode with U+FFFD replacement per maximal invalid subpart
 * — what Buffer.prototype.toString("utf8") does. Output re-encodes as
 * (now valid) UTF-8: worst case 3 bytes per input byte. */
static ScrStr *scr_bytes_decode_utf8(const uint8_t *in, size_t n) {
  char *out = malloc(n * 3 + 1);
  if (!out) scr_bytes_oom();
  size_t o = 0;
  uint32_t cp = 0;
  int needed = 0;
  uint8_t lower = 0x80, upper = 0xbf;
  for (size_t i = 0; i <= n; i++) {
    if (i == n) {
      if (needed > 0) { /* EOF inside a sequence: one replacement */
        memcpy(out + o, "\xef\xbf\xbd", 3);
        o += 3;
      }
      break;
    }
    uint8_t byte = in[i];
    if (needed == 0) {
      if (byte <= 0x7f) {
        out[o++] = (char)byte;
      } else if (byte >= 0xc2 && byte <= 0xdf) {
        needed = 1; cp = byte & 0x1f;
      } else if (byte >= 0xe0 && byte <= 0xef) {
        if (byte == 0xe0) lower = 0xa0;
        if (byte == 0xed) upper = 0x9f;
        needed = 2; cp = byte & 0xf;
      } else if (byte >= 0xf0 && byte <= 0xf4) {
        if (byte == 0xf0) lower = 0x90;
        if (byte == 0xf4) upper = 0x8f;
        needed = 3; cp = byte & 0x7;
      } else {
        memcpy(out + o, "\xef\xbf\xbd", 3);
        o += 3;
      }
      continue;
    }
    if (byte < lower || byte > upper) {
      /* Invalid continuation: replace the subpart, REPROCESS this byte. */
      memcpy(out + o, "\xef\xbf\xbd", 3);
      o += 3;
      needed = 0; lower = 0x80; upper = 0xbf;
      i--;
      continue;
    }
    lower = 0x80; upper = 0xbf;
    cp = (cp << 6) | (byte & 0x3f);
    if (--needed == 0) {
      /* Re-encode the (valid, non-surrogate, <= 10FFFF) code point. */
      if (cp <= 0x7f) {
        out[o++] = (char)cp;
      } else if (cp <= 0x7ff) {
        out[o++] = (char)(0xc0 | (cp >> 6));
        out[o++] = (char)(0x80 | (cp & 0x3f));
      } else if (cp <= 0xffff) {
        out[o++] = (char)(0xe0 | (cp >> 12));
        out[o++] = (char)(0x80 | ((cp >> 6) & 0x3f));
        out[o++] = (char)(0x80 | (cp & 0x3f));
      } else {
        out[o++] = (char)(0xf0 | (cp >> 18));
        out[o++] = (char)(0x80 | ((cp >> 12) & 0x3f));
        out[o++] = (char)(0x80 | ((cp >> 6) & 0x3f));
        out[o++] = (char)(0x80 | (cp & 0x3f));
      }
    }
  }
  ScrStr *s = scr_str_new(out, o);
  free(out);
  return s;
}

/* WHATWG TextDecoder.decode (utf-8, default options): the SAME maximal-
 * subpart replacement decode as toString("utf8") above, with one
 * difference — a leading UTF-8 BOM is stripped (ignoreBOM defaults to
 * false in the spec; Buffer.toString keeps the BOM as U+FEFF). */
ScrStr *scr_text_decode(const ScrBytes *b) {
  const uint8_t *in = b->data;
  size_t n = b->len;
  if (n >= 3 && in[0] == 0xef && in[1] == 0xbb && in[2] == 0xbf) {
    in += 3;
    n -= 3;
  }
  return scr_bytes_decode_utf8(in, n);
}

/* ── node:string_decoder, the utf8 StringDecoder ─────────────────────────
 * The decoder VALUE is a one-field record holding the pending partial
 * sequence PACKED into an f64 (count in the low byte, then up to three
 * raw bytes — at most 3 pend, so 32 bits): the compiler's interned
 * %strdec helpers thread it through these three pure functions. The
 * algorithm is Node's utf8 StringDecoder pinned by oracle (corpus 1474):
 * write() decodes pending+chunk minus the trailing INCOMPLETE sequence
 * (the decode above — invalid bytes become U+FFFD immediately, only a
 * truncated valid lead buffers), end() flushes the buffered partial as
 * its replacement chars. */

/* Encoding helpers defined beside toString below (the strdec steps share
 * them). */
static ScrStr *scr_bytes_encode_b64(const uint8_t *in, size_t n, bool url);
static ScrStr *scr_bytes_decode_utf16le(const uint8_t *in, size_t n);
static bool scr_enc_is(const ScrStr *enc, const char *name);

static size_t scr_strdec_unpack(double pending, uint8_t out[3]) {
  uint32_t p = (uint32_t)pending;
  size_t n = p & 0xff;
  if (n > 3) n = 3;
  out[0] = (uint8_t)((p >> 8) & 0xff);
  out[1] = (uint8_t)((p >> 16) & 0xff);
  out[2] = (uint8_t)((p >> 24) & 0xff);
  return n;
}

static double scr_strdec_pack(const uint8_t *bytes, size_t n) {
  uint32_t p = (uint32_t)n;
  if (n > 0) p |= (uint32_t)bytes[0] << 8;
  if (n > 1) p |= (uint32_t)bytes[1] << 16;
  if (n > 2) p |= (uint32_t)bytes[2] << 24;
  return (double)p;
}

/* Node's utf8CheckIncomplete over the COMBINED tail: the length (0-3) of
 * a trailing truncated-but-valid sequence prefix. Bare continuations and
 * invalid leads are NOT incomplete — they decode (to U+FFFD) now. */
static size_t scr_strdec_tail(const uint8_t *buf, size_t n) {
  size_t scan = n < 3 ? n : 3;
  for (size_t back = 1; back <= scan; back++) {
    uint8_t b = buf[n - back];
    if ((b & 0xc0) == 0x80) continue; /* continuation: keep walking */
    size_t need = 0;
    if ((b & 0xe0) == 0xc0) need = 2;
    else if ((b & 0xf0) == 0xe0) need = 3;
    else if ((b & 0xf8) == 0xf0) need = 4;
    else return 0; /* ascii or invalid lead: nothing buffers */
    return back < need ? back : 0; /* complete: decode now */
  }
  return 0; /* 3 continuations (or empty): invalid, decode now */
}

/* The combined pending+chunk buffer (malloc'd; *out_n set). */
static uint8_t *scr_strdec_combined(double pending, const ScrBytes *chunk, size_t *out_n) {
  uint8_t pend[3];
  size_t np = scr_strdec_unpack(pending, pend);
  size_t n = np + chunk->len;
  uint8_t *buf = malloc(n > 0 ? n : 1);
  if (!buf) scr_bytes_oom();
  memcpy(buf, pend, np);
  memcpy(buf + np, chunk->data, chunk->len);
  *out_n = n;
  return buf;
}

/* The utf16le step, Node's utf16Text/fillLast: a pending partial fills
 * first (an odd byte completes its unit; a held LEAD surrogate completes
 * its pair — 4 bytes total), then the rest holds back an odd tail byte
 * (with NO surrogate check — Node's own quirk emits a lead surrogate
 * before an odd boundary) or a trailing lead surrogate's 2 bytes. The
 * emitted bytes decode JOINTLY, so pair halves split across the fill
 * boundary reassemble exactly like Node's string concatenation. */
static ScrStr *scr_strdec_u16(double pending, const ScrBytes *chunk, bool want_str, double *out_hold) {
  uint8_t held[3];
  size_t k = scr_strdec_unpack(pending, held);
  const uint8_t *c = chunk->data;
  size_t cn = chunk->len;
  uint8_t complete[4];
  size_t comp_n = 0;
  if (k > 0) {
    size_t total = k == 1 ? 2 : 4; /* 1 = odd byte; 2 or 3 = lead-surrogate hold */
    size_t need = total - k;
    if (cn < need) {
      uint8_t nh[3];
      memcpy(nh, held, k);
      memcpy(nh + k, c, cn);
      *out_hold = scr_strdec_pack(nh, k + cn);
      return want_str ? scr_str_new("", 0) : NULL;
    }
    memcpy(complete, held, k);
    memcpy(complete + k, c, need);
    comp_n = total;
    c += need;
    cn -= need;
  }
  size_t keep = cn;
  if (cn % 2 == 1) {
    keep = cn - 1;
  } else if (cn >= 2) {
    uint32_t last = (uint32_t)c[cn - 2] | ((uint32_t)c[cn - 1] << 8);
    if (last >= 0xd800 && last <= 0xdbff) keep = cn - 2;
  }
  *out_hold = scr_strdec_pack(c + keep, cn - keep);
  if (!want_str) return NULL;
  size_t n = comp_n + keep;
  uint8_t *buf = malloc(n > 0 ? n : 1);
  if (!buf) scr_bytes_oom();
  memcpy(buf, complete, comp_n);
  memcpy(buf + comp_n, c, keep);
  ScrStr *s = scr_bytes_decode_utf16le(buf, n);
  free(buf);
  return s;
}

/* The base64/base64url step: complete 3-byte groups encode now, the
 * 1-2-byte remainder buffers (the combined walk is Node's fillLast+text
 * exactly — base64 of a concatenation splits at group boundaries). */
static ScrStr *scr_strdec_b64(double pending, const ScrBytes *chunk, bool url, bool want_str, double *out_hold) {
  size_t n;
  uint8_t *buf = scr_strdec_combined(pending, chunk, &n);
  size_t tail = n % 3;
  *out_hold = scr_strdec_pack(buf + (n - tail), tail);
  ScrStr *s = want_str ? scr_bytes_encode_b64(buf, n - tail, url) : NULL;
  free(buf);
  return s;
}

/* One dispatcher computes the decoded string (when wanted) and the new
 * packed pending for a write. latin1/ascii/hex are stateless (write IS
 * toString); utf8 keeps the oracle-pinned combined walk. */
static ScrStr *scr_strdec_step(const ScrStr *enc, double pending, const ScrBytes *chunk,
                               bool want_str, double *out_hold) {
  if (scr_enc_is(enc, "utf16le")) return scr_strdec_u16(pending, chunk, want_str, out_hold);
  if (scr_enc_is(enc, "base64")) return scr_strdec_b64(pending, chunk, false, want_str, out_hold);
  if (scr_enc_is(enc, "base64url")) return scr_strdec_b64(pending, chunk, true, want_str, out_hold);
  if (scr_enc_is(enc, "latin1") || scr_enc_is(enc, "ascii") || scr_enc_is(enc, "hex")) {
    *out_hold = 0;
    return want_str ? scr_bytes_to_str(chunk, enc) : NULL;
  }
  size_t n;
  uint8_t *buf = scr_strdec_combined(pending, chunk, &n);
  size_t tail = scr_strdec_tail(buf, n);
  *out_hold = scr_strdec_pack(buf + (n - tail), tail);
  ScrStr *s = want_str ? scr_bytes_decode_utf8(buf, n - tail) : NULL;
  free(buf);
  return s;
}

/* decoder.write(chunk): the decoded complete prefix (+1). */
ScrStr *scr_strdec_write(const ScrStr *enc, double pending, const ScrBytes *chunk) {
  double hold;
  return scr_strdec_step(enc, pending, chunk, true, &hold);
}

/* The decoder state AFTER a write: the packed trailing partial sequence. */
double scr_strdec_next(const ScrStr *enc, double pending, const ScrBytes *chunk) {
  double hold = 0;
  scr_strdec_step(enc, pending, chunk, false, &hold);
  return hold;
}


/* The accessors of a decoder value (Node's lastNeed / lastTotal / lastChar), derived
 * from the buffered bytes the packed pending state holds and the encoding, the way
 * Node's native decoder derives them: utf8 totals its lead byte's sequence length,
 * base64 and base64url buffer toward 3, utf16le holds one byte or a lead surrogate,
 * and the stateless encodings never buffer. lastChar is the four-byte scratch the
 * native decoder keeps: the buffered bytes, zero-filled. */
void scr_strdec_state_info(const ScrStr *enc, double pending, size_t *need, size_t *total, uint8_t last[4]) {
  uint8_t pend[3];
  size_t k = scr_strdec_unpack(pending, pend);
  *need = 0;
  *total = 0;
  for (size_t i = 0; i < 4; i++) last[i] = i < k ? pend[i] : 0;
  if (k == 0) return;
  if (scr_enc_is(enc, "base64") || scr_enc_is(enc, "base64url")) {
    *total = 3;
  } else if (scr_enc_is(enc, "utf16le")) {
    *total = k == 1 ? 2 : 4; /* one byte, or a held high surrogate */
  } else if (scr_enc_is(enc, "utf8")) {
    if (pend[0] >= 0xc0 && pend[0] <= 0xdf) *total = 2;
    else if (pend[0] >= 0xe0 && pend[0] <= 0xef) *total = 3;
    else if (pend[0] >= 0xf0 && pend[0] <= 0xf7) *total = 4;
  }
  *need = *total > k ? *total - k : 0;
}

/* decoder.end(): the buffered partial flushes — utf8's truncated sequence
 * becomes its replacement chars (the maximal-subpart rule), base64's
 * remainder encodes (padded; unpadded for base64url), utf16le's held
 * bytes decode as they stand (an odd byte drops; a held lead surrogate is
 * the documented U+FFFD divergence), and the stateless encodings flush
 * nothing. +1. */
ScrStr *scr_strdec_end(const ScrStr *enc, double pending) {
  uint8_t pend[3];
  size_t np = scr_strdec_unpack(pending, pend);
  if (scr_enc_is(enc, "base64")) return scr_bytes_encode_b64(pend, np, false);
  if (scr_enc_is(enc, "base64url")) return scr_bytes_encode_b64(pend, np, true);
  if (scr_enc_is(enc, "utf16le")) return scr_bytes_decode_utf16le(pend, np);
  if (scr_enc_is(enc, "latin1") || scr_enc_is(enc, "ascii") || scr_enc_is(enc, "hex")) {
    return scr_str_new("", 0);
  }
  return scr_bytes_decode_utf8(pend, np);
}

/* toString(enc, start, end): Node slices then decodes — start/end clamp
 * to [0, len] with start > end collapsing to empty and negative ends
 * clamping to 0 (Node's slice-then-decode; an OMITTED end never reaches
 * here — the emitter supplies the receiver's length for the 2-arg
 * form). Delegates to the whole-buffer decoder
 * through a stack view — no allocation, no rc traffic. */
ScrStr *scr_bytes_to_str_range(const ScrBytes *b, const ScrStr *enc, double start, double end) {
  size_t len = b->len;
  size_t s0 = start <= 0 ? 0 : ((size_t)start > len ? len : (size_t)start);
  size_t e0 = end <= 0 ? 0 : ((size_t)end > len ? len : (size_t)end);
  if (e0 < s0) e0 = s0;
  ScrBytes view = { .rc = 1, .len = e0 - s0, .elem = b->elem, .data = b->data + s0, .backing = NULL };
  return scr_bytes_to_str(&view, enc);
}

/* The base64 encoder behind toString("base64") and toString("base64url"):
 * the url flavor swaps the alphabet's last two chars for -_ and drops the
 * padding, exactly Node. */
static ScrStr *scr_bytes_encode_b64(const uint8_t *in, size_t n, bool url) {
  static const char std_abc[] =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  static const char url_abc[] =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const char *abc = url ? url_abc : std_abc;
  size_t outlen = (n + 2) / 3 * 4;
  char *out = malloc(outlen + 1);
  if (!out) scr_bytes_oom();
  size_t o = 0;
  for (size_t i = 0; i < n; i += 3) {
    unsigned v = (unsigned)in[i] << 16;
    if (i + 1 < n) v |= (unsigned)in[i + 1] << 8;
    if (i + 2 < n) v |= (unsigned)in[i + 2];
    out[o++] = abc[(v >> 18) & 63];
    out[o++] = abc[(v >> 12) & 63];
    if (i + 1 < n) out[o++] = abc[(v >> 6) & 63];
    else if (!url) out[o++] = '=';
    if (i + 2 < n) out[o++] = abc[v & 63];
    else if (!url) out[o++] = '=';
  }
  ScrStr *s = scr_str_new(out, o);
  free(out);
  return s;
}

/* Append one code point as UTF-8 (the caller sized the buffer). */
static size_t scr_bytes_put_cp(char *out, size_t o, uint32_t cp) {
  if (cp <= 0x7f) {
    out[o++] = (char)cp;
  } else if (cp <= 0x7ff) {
    out[o++] = (char)(0xc0 | (cp >> 6));
    out[o++] = (char)(0x80 | (cp & 0x3f));
  } else if (cp <= 0xffff) {
    out[o++] = (char)(0xe0 | (cp >> 12));
    out[o++] = (char)(0x80 | ((cp >> 6) & 0x3f));
    out[o++] = (char)(0x80 | (cp & 0x3f));
  } else {
    out[o++] = (char)(0xf0 | (cp >> 18));
    out[o++] = (char)(0x80 | ((cp >> 12) & 0x3f));
    out[o++] = (char)(0x80 | ((cp >> 6) & 0x3f));
    out[o++] = (char)(0x80 | (cp & 0x3f));
  }
  return o;
}

/* Decode the next code point from an ScrStr's storage — ALWAYS valid
 * UTF-8 (the string runtime never stores ill-formed sequences), so no
 * validation re-runs here. */
static uint32_t scr_bytes_next_cp(const uint8_t *in, size_t *ip) {
  uint8_t b = in[*ip];
  if (b < 0x80) {
    *ip += 1;
    return b;
  }
  if ((b & 0xe0) == 0xc0) {
    uint32_t cp = ((uint32_t)(b & 0x1f) << 6) | (in[*ip + 1] & 0x3f);
    *ip += 2;
    return cp;
  }
  if ((b & 0xf0) == 0xe0) {
    uint32_t cp = ((uint32_t)(b & 0xf) << 12) | ((uint32_t)(in[*ip + 1] & 0x3f) << 6) |
                  (in[*ip + 2] & 0x3f);
    *ip += 3;
    return cp;
  }
  uint32_t cp = ((uint32_t)(b & 0x7) << 18) | ((uint32_t)(in[*ip + 1] & 0x3f) << 12) |
                ((uint32_t)(in[*ip + 2] & 0x3f) << 6) | (in[*ip + 3] & 0x3f);
  *ip += 4;
  return cp;
}

/* A NULL encoding is the ABSENT one, and every caller that spells it that
 * way means Node's default: scr_dyn_to_string(d, NULL) is the whole
 * String(v)/ToPrimitive family, and its BYTES arm reached here through
 * scr_dyn_string_coerce with nothing to say about encoding. Answering
 * false for every named encoding drops those callers onto the utf8
 * fall-through at the bottom of scr_bytes_to_str, which is the answer the
 * two walkers that build an explicit "utf8" already give. Reading
 * enc->len first instead was a NULL dereference that nothing had reached
 * yet — `"" + bufferChunk` reaches it. */
static bool scr_enc_is(const ScrStr *enc, const char *name) {
  if (enc == NULL) return false;
  size_t n = strlen(name);
  return enc->len == n && memcmp(enc->data, name, n) == 0;
}

/* toString("utf16le"): LE code-unit pairs (an odd tail byte drops, like
 * Node). Valid surrogate pairs combine into their code point; a LONE
 * surrogate becomes U+FFFD — Node keeps it as a lone UTF-16 unit, which
 * UTF-8 string storage cannot hold (SEMANTICS.md divergence; stdout
 * agrees byte-for-byte because Node's own write replaces it there too). */
static ScrStr *scr_bytes_decode_utf16le(const uint8_t *in, size_t n) {
  size_t units = n / 2;
  char *out = malloc(units * 3 + 2);
  if (!out) scr_bytes_oom();
  size_t o = 0;
  for (size_t u = 0; u < units; u++) {
    uint32_t cu = (uint32_t)in[u * 2] | ((uint32_t)in[u * 2 + 1] << 8);
    if (cu >= 0xd800 && cu <= 0xdbff && u + 1 < units) {
      uint32_t lo = (uint32_t)in[(u + 1) * 2] | ((uint32_t)in[(u + 1) * 2 + 1] << 8);
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        o = scr_bytes_put_cp(out, o, 0x10000 + ((cu - 0xd800) << 10) + (lo - 0xdc00));
        u++;
        continue;
      }
    }
    o = scr_bytes_put_cp(out, o, cu >= 0xd800 && cu <= 0xdfff ? 0xfffd : cu);
  }
  ScrStr *s = scr_str_new(out, o);
  free(out);
  return s;
}

ScrStr *scr_bytes_to_str(const ScrBytes *b, const ScrStr *enc) {
  const uint8_t *in = b->data;
  size_t n = b->len; /* u8: len == byte length */
  if (scr_enc_is(enc, "hex")) {
    char *out = malloc(n * 2 + 1);
    if (!out) scr_bytes_oom();
    for (size_t i = 0; i < n; i++) {
      out[i * 2] = scr_hex_digits[in[i] >> 4];
      out[i * 2 + 1] = scr_hex_digits[in[i] & 0xf];
    }
    ScrStr *s = scr_str_new(out, n * 2);
    free(out);
    return s;
  }
  if (scr_enc_is(enc, "base64")) return scr_bytes_encode_b64(in, n, false);
  if (scr_enc_is(enc, "base64url")) return scr_bytes_encode_b64(in, n, true);
  if (scr_enc_is(enc, "latin1")) {
    /* Each byte is U+00XX ("binary" normalizes here upstream). */
    char *out = malloc(n * 2 + 1);
    if (!out) scr_bytes_oom();
    size_t o = 0;
    for (size_t i = 0; i < n; i++) o = scr_bytes_put_cp(out, o, in[i]);
    ScrStr *s = scr_str_new(out, o);
    free(out);
    return s;
  }
  if (scr_enc_is(enc, "ascii")) {
    /* Node's ascii decode masks the high bit: byte & 0x7f. */
    char *out = malloc(n + 1);
    if (!out) scr_bytes_oom();
    for (size_t i = 0; i < n; i++) out[i] = (char)(in[i] & 0x7f);
    ScrStr *s = scr_str_new(out, n);
    free(out);
    return s;
  }
  if (scr_enc_is(enc, "utf16le")) return scr_bytes_decode_utf16le(in, n);
  /* utf8 (the compiler completes an omitted encoding to "utf8") */
  return scr_bytes_decode_utf8(in, n);
}

static int scr_hex_val(uint8_t c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

static int scr_b64_val(uint8_t c) {
  if (c >= 'A' && c <= 'Z') return c - 'A';
  if (c >= 'a' && c <= 'z') return c - 'a' + 26;
  if (c >= '0' && c <= '9') return c - '0' + 52;
  if (c == '+' || c == '-') return 62; /* '-': base64url, accepted like Node */
  if (c == '/' || c == '_') return 63; /* '_': base64url */
  return -1;
}

ScrBytes *scr_bytes_from_str(const ScrStr *s, const ScrStr *enc) {
  const uint8_t *in = (const uint8_t *)s->data;
  size_t n = s->len;
  if (scr_enc_is(enc, "latin1") || scr_enc_is(enc, "ascii")) {
    /* Node writes charCodeAt(i) & 0xFF for BOTH spellings — an astral
     * code point contributes its two surrogates' low bytes. */
    ScrBytes *b = scr_bytes_alloc(SCR_BYTES_U8, n);
    size_t o = 0, i = 0;
    while (i < n) {
      uint32_t cp = scr_bytes_next_cp(in, &i);
      if (cp > 0xffff) {
        cp -= 0x10000;
        b->data[o++] = (uint8_t)(0xd800 + (cp >> 10));
        b->data[o++] = (uint8_t)(0xdc00 + (cp & 0x3ff));
      } else {
        b->data[o++] = (uint8_t)cp;
      }
    }
    b->len = o; /* never grows past n: multi-byte cps shrink */
    return b;
  }
  if (scr_enc_is(enc, "utf16le")) {
    ScrBytes *b = scr_bytes_alloc(SCR_BYTES_U8, n * 2);
    size_t o = 0, i = 0;
    while (i < n) {
      uint32_t cp = scr_bytes_next_cp(in, &i);
      if (cp > 0xffff) {
        cp -= 0x10000;
        uint32_t hi = 0xd800 + (cp >> 10), lo = 0xdc00 + (cp & 0x3ff);
        b->data[o++] = (uint8_t)hi;
        b->data[o++] = (uint8_t)(hi >> 8);
        b->data[o++] = (uint8_t)lo;
        b->data[o++] = (uint8_t)(lo >> 8);
      } else {
        b->data[o++] = (uint8_t)cp;
        b->data[o++] = (uint8_t)(cp >> 8);
      }
    }
    b->len = o;
    return b;
  }
  if (enc->len == 3 && memcmp(enc->data, "hex", 3) == 0) {
    /* Node-lenient: parse pairs, stop at the first invalid pair or the
     * odd tail (Buffer.from("a1g2", "hex") is <Buffer a1>). */
    ScrBytes *b = scr_bytes_alloc(SCR_BYTES_U8, n / 2);
    size_t o = 0;
    for (size_t i = 0; i + 1 < n; i += 2) {
      int hi = scr_hex_val(in[i]);
      int lo = scr_hex_val(in[i + 1]);
      if (hi < 0 || lo < 0) break;
      b->data[o++] = (uint8_t)((hi << 4) | lo);
    }
    b->len = o; /* never grows: shrinking the count is safe */
    return b;
  }
  if (scr_enc_is(enc, "base64") || scr_enc_is(enc, "base64url")) {
    /* Node-lenient: skip bytes outside the (standard + url-safe)
     * alphabets — whitespace, '=', stray punctuation; decode 4-char
     * groups, and a 2/3-char tail into 1/2 bytes. Both spellings share
     * the decoder (Node accepts either alphabet under either name). */
    ScrBytes *b = scr_bytes_alloc(SCR_BYTES_U8, n / 4 * 3 + 2);
    size_t o = 0;
    unsigned acc = 0;
    int have = 0;
    for (size_t i = 0; i < n; i++) {
      int v = scr_b64_val(in[i]);
      if (v < 0) continue;
      acc = (acc << 6) | (unsigned)v;
      if (++have == 4) {
        b->data[o++] = (uint8_t)(acc >> 16);
        b->data[o++] = (uint8_t)(acc >> 8);
        b->data[o++] = (uint8_t)acc;
        acc = 0;
        have = 0;
      }
    }
    if (have == 2) b->data[o++] = (uint8_t)(acc >> 4);
    else if (have == 3) {
      b->data[o++] = (uint8_t)(acc >> 10);
      b->data[o++] = (uint8_t)(acc >> 2);
    }
    b->len = o;
    return b;
  }
  /* utf8: ScrStr storage IS the bytes */
  ScrBytes *b = scr_bytes_alloc(SCR_BYTES_U8, n);
  memcpy(b->data, in, n);
  return b;
}

ScrBytes *scr_bytes_from_arr(ScrBytesElem elem, const ScrArr *arr) {
  ScrBytes *b = scr_bytes_alloc(elem, arr->len);
  for (size_t i = 0; i < arr->len; i++) {
    double v;
    memcpy(&v, &arr->data[i], sizeof v); /* SCR_ELEM_F64 slots hold doubles */
    switch (elem) {
      case SCR_BYTES_U8:
        b->data[i] = (uint8_t)scr_bytes_to_u32(v);
        break;
      case SCR_BYTES_U8C:
        b->data[i] = scr_bytes_to_u8c(v);
        break;
      case SCR_BYTES_F16: {
        uint16_t h = scr_bytes_f64_to_f16(v);
        memcpy(b->data + i * 2, &h, 2);
        break;
      }
      case SCR_BYTES_I64:
      case SCR_BYTES_U64:
        scr_bytes_bigint_as_double("array fill", i, arr->len);
        break;
      case SCR_BYTES_U32: {
        uint32_t u = scr_bytes_to_u32(v);
        memcpy(b->data + i * 4, &u, 4);
        break;
      }
      case SCR_BYTES_F32: {
        float f = (float)v;
        memcpy(b->data + i * 4, &f, 4);
        break;
      }
      case SCR_BYTES_F64:
        memcpy(b->data + i * 8, &v, 8);
        break;
      case SCR_BYTES_I8:
        b->data[i] = (uint8_t)scr_bytes_to_u32(v);
        break;
      case SCR_BYTES_I16:
      case SCR_BYTES_U16: {
        uint16_t u = (uint16_t)scr_bytes_to_u32(v); /* same residue reinterpreted */
        memcpy(b->data + i * 2, &u, 2);
        break;
      }
      case SCR_BYTES_I32: {
        uint32_t u = scr_bytes_to_u32(v);
        memcpy(b->data + i * 4, &u, 4); /* same residue reinterpreted */
        break;
      }
    }
  }
  return b;
}

/* ── equals / compare / indexOf / fill / copy / swap / write (u8; the
 * error ladders mirror Node's validateOffset — 'an integer' first, then
 * the '>= 0 && <= max' render, ERR_OUT_OF_RANGE's Received rules — and
 * copy's C++-side ladder; pinned by corpus 1663) ─────────────────────── */

size_t scr_num_received(double v, char out[48]); /* the numeric section below */

/* validateOffset(name, 0, max): non-integers are 'an integer' (Number.
 * isInteger — ±Infinity render 'an integer' too), the rest '>= 0 && <=
 * max' (Node spells '&&' here, unlike the read/write families' 'and').
 * max < 0 means copy's no-upper-bound '>= 0' render. Exported: the
 * checked-dynamic compare/equals validators (scr_bytes_io.c) run the
 * same ladder after their own type gate. */
bool scr_bytes_validate_off(const char *name, double value, double max) {
  if (isfinite(value) && floor(value) == value && value >= 0 && (max < 0 || value <= max)) return true;
  char recv[48];
  scr_num_received(value, recv);
  char msg[160];
  int mlen;
  if (floor(value) != value || !isfinite(value)) {
    mlen = snprintf(msg, sizeof msg,
                    "The value of \"%s\" is out of range. It must be an integer. Received %s",
                    name, recv);
  } else if (max < 0) {
    mlen = snprintf(msg, sizeof msg,
                    "The value of \"%s\" is out of range. It must be >= 0. Received %s", name, recv);
  } else {
    char maxb[32];
    scr_f64_to_str(max, maxb);
    mlen = snprintf(msg, sizeof msg,
                    "The value of \"%s\" is out of range. It must be >= 0 && <= %s. Received %s",
                    name, maxb, recv);
  }
  scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)mlen, "ERR_OUT_OF_RANGE");
  return false;
}

bool scr_bytes_equals(const ScrBytes *a, const ScrBytes *b) {
  return a->len == b->len && memcmp(a->data, b->data, a->len) == 0;
}

/* src.compare(target, targetStart?, targetEnd?, sourceStart?, sourceEnd?)
 * — nargs counts the PRESENT index args (defaults skip validation, like
 * Node). Empty-range shortcuts and the memcmp-with-length-tiebreak are
 * Node's exactly. */
double scr_bytes_compare(const ScrBytes *src, const ScrBytes *target, double nargs,
                         double ts, double te, double ss, double se) {
  size_t n = (size_t)nargs;
  if (n < 1) ts = 0;
  else if (!scr_bytes_validate_off("targetStart", ts, 9007199254740991.0)) return 0;
  if (n < 2) te = (double)target->len;
  else if (!scr_bytes_validate_off("targetEnd", te, (double)target->len)) return 0;
  if (n < 3) ss = 0;
  else if (!scr_bytes_validate_off("sourceStart", ss, 9007199254740991.0)) return 0;
  if (n < 4) se = (double)src->len;
  else if (!scr_bytes_validate_off("sourceEnd", se, (double)src->len)) return 0;
  if (ts >= te) return ss >= se ? 0 : 1;
  if (ss >= se) return -1;
  /* Clamp the starts into range (a start past the length reads empty —
   * handled above; here both windows are non-empty). */
  size_t t0 = ts > (double)target->len ? target->len : (size_t)ts;
  size_t s0 = ss > (double)src->len ? src->len : (size_t)ss;
  size_t tn = (size_t)te - t0, sn = (size_t)se - s0;
  size_t m = sn < tn ? sn : tn;
  int c = memcmp(src->data + s0, target->data + t0, m);
  if (c != 0) return c < 0 ? -1 : 1;
  if (sn == tn) return 0;
  return sn < tn ? -1 : 1;
}

/* The shared search core: needle bytes, a coerced byteOffset (trunc; NaN
 * means 'search everything' — 0 forward, the end backward; negatives
 * count from the end, and a still-negative backward search answers -1),
 * and the utf16le alignment stride. */
double scr_bytes_index_of(const ScrBytes *b, const ScrBytes *needle, double off, double align, bool fwd) {
  size_t len = b->len, nlen = needle->len;
  size_t step = align == 2 ? 2 : 1;
  double o = (off != off) ? (fwd ? 0 : (double)len) : trunc(off);
  if (o < 0) {
    o += (double)len;
    if (o < 0) {
      if (!fwd) return -1;
      o = 0;
    }
  }
  if (nlen == 0) return o > (double)len ? (double)len : o; /* '' matches at the clamp */
  if (nlen > len) return -1;
  if (fwd) {
    size_t start = o > (double)len ? len : (size_t)o;
    if (step == 2) start += start % 2;
    for (size_t i = start; i + nlen <= len; i += step) {
      if (memcmp(b->data + i, needle->data, nlen) == 0) return (double)i;
    }
    return -1;
  }
  size_t start = o > (double)(len - nlen) ? len - nlen : (size_t)o;
  if (step == 2) start -= start % 2;
  for (size_t i = start;; i -= step) {
    if (memcmp(b->data + i, needle->data, nlen) == 0) return (double)i;
    if (i < step) break;
  }
  return -1;
}

double scr_bytes_index_of_num(const ScrBytes *b, double v, double off, bool fwd) {
  uint8_t byte = (uint8_t)scr_bytes_to_u32(v);
  ScrBytes needle = { .rc = 1, .len = 1, .elem = SCR_BYTES_U8, .data = &byte, .backing = NULL };
  return scr_bytes_index_of(b, &needle, off, 1, fwd);
}

/* fill's shared core over a normalized byte pattern. nargs counts the
 * present offset/end args. An EMPTY pattern zero-fills when zero_ok
 * (Node's '' string) and is the constant TypeError otherwise (an empty
 * Uint8Array value). Returns the receiver (+1) — fill chains. */
static ScrBytes *scr_bytes_fill_core(ScrBytes *b, const uint8_t *pat, size_t patn,
                                     bool zero_ok, double nargs, double offset, double end) {
  if (patn == 0 && !zero_ok) {
    static const char msg[] = "The argument 'value' is invalid. Received <Buffer >";
    scr_throw_error_msg_code(SCR_ERR_TYPE, msg, sizeof msg - 1, "ERR_INVALID_ARG_VALUE");
    return NULL;
  }
  size_t n = (size_t)nargs;
  if (n < 1) offset = 0;
  else if (!scr_bytes_validate_off("offset", offset, 9007199254740991.0)) return NULL;
  if (n < 2) end = (double)b->len;
  else if (!scr_bytes_validate_off("end", end, (double)b->len)) return NULL;
  if (offset < end) {
    size_t o = (size_t)offset > b->len ? b->len : (size_t)offset;
    size_t e = (size_t)end;
    if (patn == 0) {
      memset(b->data + o, 0, e - o);
    } else if (patn == 1) {
      memset(b->data + o, pat[0], e - o);
    } else {
      for (size_t i = o; i < e; i++) b->data[i] = pat[(i - o) % patn];
    }
  }
  return scr_bytes_retain(b);
}

ScrBytes *scr_bytes_fill(ScrBytes *b, const ScrBytes *pattern, double nargs, double offset, double end) {
  return scr_bytes_fill_core(b, pattern->data, pattern->len, false, nargs, offset, end);
}

ScrBytes *scr_bytes_fill_num(ScrBytes *b, double v, double nargs, double offset, double end) {
  uint8_t byte = (uint8_t)scr_bytes_to_u32(v);
  return scr_bytes_fill_core(b, &byte, 1, false, nargs, offset, end);
}

ScrBytes *scr_bytes_fill_str(ScrBytes *b, const ScrStr *s, const ScrStr *enc,
                             double nargs, double offset, double end) {
  ScrBytes *pat = scr_bytes_from_str(s, enc);
  ScrBytes *r = scr_bytes_fill_core(b, pat->data, pat->len, true, nargs, offset, end);
  scr_bytes_release(pat);
  return r;
}

/* src.copy(dst, targetStart?, sourceStart?, sourceEnd?): Node's C++-side
 * ladder — fractional indices TRUNCATE silently, targetStart/sourceEnd
 * check only >= 0 (past-the-end clamps to nothing), sourceStart is
 * bounded by the source length. Returns the byte count copied. */
double scr_bytes_copy_into(const ScrBytes *src, ScrBytes *dst, double nargs,
                           double ts, double ss, double se) {
  size_t n = (size_t)nargs;
  ts = n < 1 ? 0 : trunc(ts);
  ss = n < 2 ? 0 : trunc(ss);
  se = n < 3 ? (double)src->len : trunc(se);
  if (!scr_bytes_validate_off("targetStart", ts, -1)) return 0;
  if (!scr_bytes_validate_off("sourceStart", ss, (double)src->len)) return 0;
  if (!scr_bytes_validate_off("sourceEnd", se, -1)) return 0;
  if (ts >= (double)dst->len) return 0;
  size_t t0 = (size_t)ts;
  size_t s0 = (size_t)ss;
  size_t e0 = se > (double)src->len ? src->len : (size_t)se;
  if (s0 >= e0) return 0;
  size_t count = e0 - s0;
  if (count > dst->len - t0) count = dst->len - t0;
  memmove(dst->data + t0, src->data + s0, count);
  return (double)count;
}

/* swap16/32/64: in-place byte reversal per group; the receiver answers
 * (+1, chaining like fill). A length off the width is Node's constant
 * ERR_INVALID_BUFFER_SIZE RangeError. */
ScrBytes *scr_bytes_swap(ScrBytes *b, double width) {
  size_t w = (size_t)width;
  if (b->len % w != 0) {
    char msg[64];
    int mlen = snprintf(msg, sizeof msg, "Buffer size must be a multiple of %zu-bits", w * 8);
    scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)mlen, "ERR_INVALID_BUFFER_SIZE");
    return NULL;
  }
  for (size_t g = 0; g < b->len; g += w) {
    for (size_t i = 0; i < w / 2; i++) {
      uint8_t t = b->data[g + i];
      b->data[g + i] = b->data[g + w - 1 - i];
      b->data[g + w - 1 - i] = t;
    }
  }
  return scr_bytes_retain(b);
}

/* buf.write(string, offset?, length?, enc): encodes, clamps the byte
 * budget (offset and an explicit length validate against the buffer
 * length with Node's '&&' render; the length then clamps to the space
 * left), and truncates at a UNIT boundary — whole UTF-8 code points,
 * whole utf16le code units (a surrogate pair CAN split — Node writes the
 * lone lead), byte-level for the rest. Returns the bytes written. */
double scr_bytes_write_str(ScrBytes *b, const ScrStr *s, const ScrStr *enc,
                           double offset, double len, bool has_len) {
  if (!scr_bytes_validate_off("offset", offset, (double)b->len)) return 0;
  size_t o = (size_t)offset;
  size_t remaining = b->len - o;
  size_t budget;
  if (has_len) {
    if (!scr_bytes_validate_off("length", len, (double)b->len)) return 0;
    budget = (size_t)len > remaining ? remaining : (size_t)len;
  } else {
    budget = remaining;
  }
  ScrBytes *encd = scr_bytes_from_str(s, enc);
  size_t k = encd->len < budget ? encd->len : budget;
  if (k < encd->len) {
    if (scr_enc_is(enc, "utf16le")) {
      k -= k % 2;
    } else if (!scr_enc_is(enc, "hex") && !scr_enc_is(enc, "base64") &&
               !scr_enc_is(enc, "base64url") && !scr_enc_is(enc, "latin1") &&
               !scr_enc_is(enc, "ascii")) {
      /* utf8: back off a split multi-byte sequence (whole chars only). */
      size_t lead = k;
      while (lead > 0 && (encd->data[lead] & 0xc0) == 0x80) lead--;
      if (lead < k) {
        uint8_t l = encd->data[lead];
        size_t need = (l & 0xf8) == 0xf0 ? 4 : (l & 0xf0) == 0xe0 ? 3 : (l & 0xe0) == 0xc0 ? 2 : 1;
        if (lead + need > k) k = lead;
      }
    }
  }
  memcpy(b->data + o, encd->data, k);
  scr_bytes_release(encd);
  return (double)k;
}

/* buf.write(string, offset, length?, enc) with the encoding a RUN-TIME string
 * (the lowering's writeStrDyn). Node's Buffer#write order: the offset and an
 * explicit length validate first; then an empty name is utf8 (`!encoding`), a
 * name in the alias set (any case) encodes as its canonical name, and any
 * other name throws ERR_UNKNOWN_ENCODING ("Unknown encoding: <name>"). */
double scr_bytes_write_str_dyn(ScrBytes *b, const ScrStr *s, const ScrStr *enc,
                               double offset, double len, bool has_len) {
  if (!scr_bytes_validate_off("offset", offset, (double)b->len)) return 0;
  if (has_len && !scr_bytes_validate_off("length", len, (double)b->len)) return 0;
  const char *canon = "utf8";
  if (enc->len > 0) {
    canon = scr_bytes_enc_canon(enc);
    if (canon == NULL) {
      const char *lead = "Unknown encoding: ";
      size_t lead_n = strlen(lead);
      char *msg = malloc(lead_n + enc->len);
      memcpy(msg, lead, lead_n);
      memcpy(msg + lead_n, enc->data, enc->len);
      scr_throw_error_msg_code(SCR_ERR_TYPE, msg, lead_n + enc->len, "ERR_UNKNOWN_ENCODING");
      free(msg);
      return 0;
    }
  }
  ScrStr *e = scr_str_new(canon, strlen(canon));
  double n = scr_bytes_write_str(b, s, e, offset, len, has_len);
  scr_str_release(e);
  return n;
}

/* Buffer.concat(list, totalLength): the same concatenation truncated or
 * zero-padded to the validated total. */
ScrBytes *scr_bytes_concat_len(const ScrArr *list, double total) {
  /* An empty list short-circuits BEFORE the total validates — Node's
   * own `if (list.length === 0) return new FastBuffer()`. */
  if (list->len == 0) return scr_bytes_stamp_buffer(scr_bytes_alloc(SCR_BYTES_U8, 0));
  if (!scr_bytes_validate_off("length", total, 9007199254740991.0)) return NULL;
  ScrBytes *b = scr_bytes_stamp_buffer(scr_bytes_alloc(SCR_BYTES_U8, (size_t)total));
  size_t o = 0;
  for (size_t i = 0; i < list->len && o < b->len; i++) {
    const ScrBytes *part = (const ScrBytes *)(uintptr_t)list->data[i];
    size_t take = part->len < b->len - o ? part->len : b->len - o;
    memcpy(b->data + o, part->data, take);
    o += take;
  }
  return b;
}

/* Buffer.byteLength(string, enc): utf8 is the storage length (ScrStr IS
 * utf8 bytes), latin1/ascii count UTF-16 units, utf16le doubles them,
 * hex halves the length, base64/base64url use Node's padding-trimmed
 * (len * 3) >>> 2. The enc arrives NORMALIZED (the compiler folds
 * aliases). */
double scr_bytes_byte_length_str(ScrStr *s, const ScrStr *enc) {
  if (scr_enc_is(enc, "latin1") || scr_enc_is(enc, "ascii")) {
    return scr_str_utf16_len(s);
  }
  if (scr_enc_is(enc, "utf16le")) return 2 * scr_str_utf16_len(s);
  if (scr_enc_is(enc, "hex")) {
    return floor(scr_str_utf16_len(s) / 2);
  }
  if (scr_enc_is(enc, "base64") || scr_enc_is(enc, "base64url")) {
    size_t units = (size_t)scr_str_utf16_len(s);
    /* Trailing '=' padding trims (at most two) — checked on the raw
     * bytes: '=' is ASCII, so the last byte IS the last unit. */
    if (units > 0 && s->len >= 1 && s->data[s->len - 1] == '=') units--;
    if (units > 1 && s->len >= 2 && s->data[s->len - 2] == '=') units--;
    return (double)((units * 3) >> 2);
  }
  return (double)s->len; /* utf8 */
}

/* Node's encoding alias set, case-insensitive, folded to the canonical name
 * the encoders dispatch on (utf-8 -> utf8, binary -> latin1, ucs2/ucs-2/
 * utf-16le -> utf16le). NULL when the name is not in the set. The one
 * normaliser for run-time encoding names: Buffer.isEncoding, the write and
 * byteLength dyn paths, and StringDecoder (scr_json.c) all reach it. */
const char *scr_bytes_enc_canon(const ScrStr *s) {
  static const char *const table[][2] = {
      {"utf8", "utf8"},       {"utf-8", "utf8"},         {"ascii", "ascii"},     {"latin1", "latin1"},
      {"binary", "latin1"},   {"base64", "base64"},      {"hex", "hex"},         {"ucs2", "utf16le"},
      {"ucs-2", "utf16le"},   {"utf16le", "utf16le"},    {"utf-16le", "utf16le"}, {"base64url", "base64url"},
  };
  if (s->len < 3 || s->len > 9) return NULL;
  char low[10];
  for (size_t i = 0; i < s->len; i++) {
    char c = s->data[i];
    low[i] = c >= 'A' && c <= 'Z' ? (char)(c + 32) : c;
  }
  low[s->len] = 0;
  for (size_t i = 0; i < sizeof table / sizeof table[0]; i++) {
    if (strlen(table[i][0]) == s->len && memcmp(low, table[i][0], s->len) == 0) return table[i][1];
  }
  return NULL;
}

/* Buffer.isEncoding(name): case-insensitive over Node's alias set. */
bool scr_bytes_is_encoding(const ScrStr *s) { return scr_bytes_enc_canon(s) != NULL; }

ScrBytes *scr_bytes_concat(const ScrArr *list) {
  size_t total = 0;
  for (size_t i = 0; i < list->len; i++) {
    const ScrBytes *part = (const ScrBytes *)(uintptr_t)list->data[i];
    total += part->len;
  }
  ScrBytes *b = scr_bytes_stamp_buffer(scr_bytes_alloc(SCR_BYTES_U8, total));
  size_t o = 0;
  for (size_t i = 0; i < list->len; i++) {
    const ScrBytes *part = (const ScrBytes *)(uintptr_t)list->data[i];
    memcpy(b->data + o, part->data, part->len);
    o += part->len;
  }
  return b;
}

/* ── the buf.read* / buf.write* numeric families (Node's exact bounds
 * discipline; the error ladders below mirror lib/internal/buffer.js's
 * boundsError/checkInt/checkBounds byte-for-byte — pinned by corpus
 * 1660 against the live Node oracle) ───────────────────────────────── */

/* ERR_OUT_OF_RANGE's "Received" rendering: integers with |v| > 2^32 get
 * Node's addNumericalSeparator underscores applied to the plain String()
 * form — INCLUDING its quirks on exponent renderings ("1e_+21",
 * "1e+_300"); everything else is the shortest-roundtrip number. Shared
 * with the fs/net option-ladder validators (scr_num_received). */
size_t scr_num_received(double v, char out[48]) {
  char plain[32];
  size_t n = scr_f64_to_str(v, plain);
  if (!(isfinite(v) && trunc(v) == v && fabs(v) > 4294967296.0)) {
    memcpy(out, plain, n + 1);
    return n;
  }
  /* addNumericalSeparator: head of 1-3 chars (past a leading '-'), then
   * '_'-joined groups of 3 — walked over the STRING, exactly Node. */
  size_t start = plain[0] == '-' ? 1 : 0;
  size_t head = n;
  while (head >= start + 4) head -= 3;
  memcpy(out, plain, head);
  size_t o = head;
  for (size_t p = head; p < n; p += 3) {
    out[o++] = '_';
    memcpy(out + o, plain + p, 3);
    o += 3;
  }
  out[o] = 0;
  return o;
}

/* Node's boundsError: a non-integer index is "an integer" first, a
 * negative capacity (buffer shorter than the read/write width) is the
 * constant ERR_BUFFER_OUT_OF_BOUNDS text, and everything else renders
 * the ">= min and <= max" range. type NULL means "offset" (min 0);
 * "byteLength" renders min 1. All catchable RangeErrors. */
static void scr_bytes_bounds_error(double value, double length, const char *type) {
  char recv[48];
  scr_num_received(value, recv);
  char msg[160];
  int mlen;
  if (floor(value) != value) {
    mlen = snprintf(msg, sizeof msg,
                    "The value of \"%s\" is out of range. It must be an integer. Received %s",
                    type ? type : "offset", recv);
  } else if (length < 0) {
    static const char oob[] = "Attempt to access memory outside buffer bounds";
    scr_throw_error_msg_code(SCR_ERR_RANGE, oob, sizeof oob - 1, "ERR_BUFFER_OUT_OF_BOUNDS");
    return;
  } else {
    char lenbuf[32];
    scr_f64_to_str(length, lenbuf);
    mlen = snprintf(msg, sizeof msg,
                    "The value of \"%s\" is out of range. It must be >= %d and <= %s. Received %s",
                    type ? type : "offset", type ? 1 : 0, lenbuf, recv);
  }
  scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)mlen, "ERR_OUT_OF_RANGE");
}

/* The shared offset gate: width bytes at offset must lie inside b. */
static bool scr_bytes_rw_check(const ScrBytes *b, double offset, size_t width) {
  double cap = (double)b->len - (double)width;
  if (floor(offset) != offset || cap < 0 || offset < 0 || offset > cap) {
    scr_bytes_bounds_error(offset, cap, NULL);
    return false;
  }
  return true;
}
/* The same offset ladder for the Buffer-only dispatch (scr_json.c). */
bool scr_bytes_rw_check_pub(const ScrBytes *b, double offset, size_t width) { return scr_bytes_rw_check(b, offset, width); }

/* Node's checkInt for the integer writes: the VALUE range throws before
 * any offset check; widths past 4 bytes render the "2 ** N" range form
 * (checkInt's byteLength > 3 branch). NaN passes both comparisons —
 * exactly Node — and writes zeros downstream. */
static bool scr_bytes_check_int(const ScrBytes *b, double value, double offset,
                                size_t width, bool sign) {
  double max = sign ? exp2((double)(8 * width - 1)) - 1 : exp2((double)(8 * width)) - 1;
  double min = sign ? -exp2((double)(8 * width - 1)) : 0;
  if (value > max || value < min) {
    char recv[48];
    scr_num_received(value, recv);
    char msg[160];
    int mlen;
    if (width > 4) {
      if (sign) {
        mlen = snprintf(msg, sizeof msg,
                        "The value of \"value\" is out of range. It must be >= -(2 ** %zu) and < 2 ** %zu. Received %s",
                        8 * width - 1, 8 * width - 1, recv);
      } else {
        mlen = snprintf(msg, sizeof msg,
                        "The value of \"value\" is out of range. It must be >= 0 and < 2 ** %zu. Received %s",
                        8 * width, recv);
      }
    } else {
      char minb[32], maxb[32];
      scr_f64_to_str(min, minb);
      scr_f64_to_str(max, maxb);
      mlen = snprintf(msg, sizeof msg,
                      "The value of \"value\" is out of range. It must be >= %s and <= %s. Received %s",
                      minb, maxb, recv);
    }
    scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)mlen, "ERR_OUT_OF_RANGE");
    return false;
  }
  return scr_bytes_rw_check(b, offset, width);
}

static size_t scr_bytes_num_width(ScrBytesNumKind kind) {
  switch (kind) {
    case SCR_BN_U8:
    case SCR_BN_I8:
      return 1;
    case SCR_BN_U16:
    case SCR_BN_I16:
      return 2;
    case SCR_BN_F64:
      return 8;
    default:
      return 4; /* u32 / i32 / f32 */
  }
}

double scr_bytes_read_num(const ScrBytes *b, double offset, ScrBytesNumKind kind, bool le) {
  size_t width = scr_bytes_num_width(kind);
  if (!scr_bytes_rw_check(b, offset, width)) return 0;
  const uint8_t *p = b->data + (size_t)offset;
  uint64_t u = 0;
  for (size_t i = 0; i < width; i++) {
    u |= (uint64_t)p[le ? i : width - 1 - i] << (8 * i);
  }
  switch (kind) {
    case SCR_BN_U8:
    case SCR_BN_U16:
    case SCR_BN_U32:
      return (double)u;
    case SCR_BN_I8:
      return (double)(int8_t)u;
    case SCR_BN_I16:
      return (double)(int16_t)u;
    case SCR_BN_I32:
      return (double)(int32_t)u;
    case SCR_BN_F32: {
      uint32_t bits = (uint32_t)u;
      float f;
      memcpy(&f, &bits, 4);
      return (double)f;
    }
    case SCR_BN_F64: {
      double d;
      memcpy(&d, &u, 8);
      return d;
    }
  }
  return 0; /* unreachable */
}

double scr_bytes_write_num(ScrBytes *b, double value, double offset, ScrBytesNumKind kind, bool le) {
  size_t width = scr_bytes_num_width(kind);
  uint64_t u;
  if (kind == SCR_BN_F32 || kind == SCR_BN_F64) {
    /* Float writes carry no value check (any double stores; the float
     * cast rounds to nearest exactly like Float32Array assignment). */
    if (!scr_bytes_rw_check(b, offset, width)) return 0;
    if (kind == SCR_BN_F32) {
      float f = (float)value;
      uint32_t bits;
      memcpy(&bits, &f, 4);
      u = bits;
    } else {
      memcpy(&u, &value, 8);
    }
  } else {
    bool sign = kind == SCR_BN_I8 || kind == SCR_BN_I16 || kind == SCR_BN_I32;
    if (!scr_bytes_check_int(b, value, offset, width, sign)) return 0;
    double t = trunc(value);
    if (t != t) t = 0; /* NaN passed the range gate: zeros, like Node */
    u = (uint64_t)(int64_t)t; /* two's complement of the truncation */
  }
  uint8_t *p = b->data + (size_t)offset;
  for (size_t i = 0; i < width; i++) {
    p[le ? i : width - 1 - i] = (uint8_t)(u >> (8 * i));
  }
  return offset + (double)width;
}

/* readUIntLE/BE / readIntLE/BE — the variable-width family: byteLength
 * validates FIRST (1-6, its own error ladder), then the offset gate. */
double scr_bytes_read_var(const ScrBytes *b, double offset, double byte_length, bool sign, bool le) {
  if (floor(byte_length) != byte_length || byte_length < 1 || byte_length > 6) {
    scr_bytes_bounds_error(byte_length, 6, "byteLength");
    return 0;
  }
  size_t width = (size_t)byte_length;
  if (!scr_bytes_rw_check(b, offset, width)) return 0;
  const uint8_t *p = b->data + (size_t)offset;
  uint64_t u = 0;
  for (size_t i = 0; i < width; i++) {
    u |= (uint64_t)p[le ? i : width - 1 - i] << (8 * i);
  }
  if (sign && (u & ((uint64_t)1 << (8 * width - 1)))) {
    return (double)(int64_t)(u - ((uint64_t)1 << (8 * width)));
  }
  return (double)u;
}

/* writeUIntLE/BE / writeIntLE/BE: byteLength, then value, then offset —
 * Node's exact check order. Returns offset + byteLength. */
double scr_bytes_write_var(ScrBytes *b, double value, double offset, double byte_length, bool sign, bool le) {
  if (floor(byte_length) != byte_length || byte_length < 1 || byte_length > 6) {
    scr_bytes_bounds_error(byte_length, 6, "byteLength");
    return 0;
  }
  size_t width = (size_t)byte_length;
  if (!scr_bytes_check_int(b, value, offset, width, sign)) return 0;
  double t = trunc(value);
  if (t != t) t = 0;
  uint64_t u = (uint64_t)(int64_t)t;
  uint8_t *p = b->data + (size_t)offset;
  for (size_t i = 0; i < width; i++) {
    p[le ? i : width - 1 - i] = (uint8_t)(u >> (8 * i));
  }
  return offset + (double)width;
}
