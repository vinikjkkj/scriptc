/* scr_sctp_assoc.c — see the header for scope and for what is deliberately
 * missing. Sans-io: no sockets, no clock, no threads. */

#include <stdlib.h>
#include <string.h>

#include "scr_sctp.h"
#include "scr_sctp_assoc.h"

#define MAX_DGRAM 1500u
#define MAX_PAYLOAD 1200u /* leaves room for the SCTP + DATA headers */
#define OUTQ 16u
#define INQ 16u
#define RTX_INITIAL_MS 300u
#define RTX_MAX_MS 3000u
#define RTX_MAX_TRIES 10u

typedef struct {
  uint8_t buf[MAX_DGRAM];
  size_t len;
} Dgram;

/* One in-flight user message. Unordered reliable means a chunk is retained
 * until its TSN is cumulatively acked, and no partial-reliability rule can
 * ever abandon it. */
typedef struct {
  uint8_t payload[MAX_PAYLOAD];
  size_t len;
  uint32_t tsn;
  uint32_t ppid;
  bool in_use;
} Pending;

typedef struct {
  uint8_t data[MAX_PAYLOAD];
  size_t len;
  uint32_t ppid;
} InMsg;

struct ScrSctpAssoc {
  uint16_t local_port, remote_port;
  ScrSctpState state;

  uint32_t local_tag;   /* our initiate tag; peer echoes it as vtag  */
  uint32_t peer_tag;    /* their initiate tag; we send it as vtag    */
  uint32_t next_tsn;    /* next TSN we will assign                   */
  uint32_t last_acked;  /* highest cumulative TSN the peer confirmed */
  uint32_t peer_next;   /* next TSN we expect from the peer          */
  bool peer_seen;       /* have we received any DATA yet             */

  uint8_t cookie[256];
  size_t cookie_len;

  /* The retransmission timer covers whichever flight is outstanding:
   * INIT, COOKIE ECHO, or the oldest unacked DATA. One timer, because
   * only one of those is ever in flight at a time on this path. */
  uint64_t rtx_due;
  uint32_t rtx_ms;
  uint32_t rtx_tries;
  bool rtx_armed;

  Dgram outq[OUTQ];
  unsigned out_head, out_tail;

  Pending pend[OUTQ];
  InMsg inq[INQ];
  unsigned in_head, in_tail;

  bool channel_open;
  bool dcep_sent;
  char label[64];
  size_t label_len;

  ScrSctpStats stats;
};

/* ── output queue ─────────────────────────────────────────────────── */

static Dgram *out_alloc(ScrSctpAssoc *a) {
  unsigned next = (a->out_tail + 1u) % OUTQ;
  if (next == a->out_head) return NULL; /* full: drop, the timer resends */
  Dgram *d = &a->outq[a->out_tail];
  a->out_tail = next;
  d->len = 0;
  return d;
}

size_t scr_sctp_assoc_pop_output(ScrSctpAssoc *a, uint8_t *buf, size_t cap) {
  if (a == NULL || a->out_head == a->out_tail) return 0;
  Dgram *d = &a->outq[a->out_head];
  size_t n = d->len <= cap ? d->len : 0;
  if (n > 0) memcpy(buf, d->buf, n);
  a->out_head = (a->out_head + 1u) % OUTQ;
  return n;
}

/* Start a datagram with the common header. The verification tag is the
 * PEER's initiate tag once known, and 0 in the INIT that asks for it
 * (RFC 4960 s8.5.1). */
static size_t begin(ScrSctpAssoc *a, Dgram *d) {
  d->len = scr_sctp_write_header(d->buf, MAX_DGRAM, a->local_port,
                                 a->remote_port, a->peer_tag);
  return d->len;
}

static void finish(Dgram *d) { scr_sctp_finalize(d->buf, d->len); }

/* ── timer ────────────────────────────────────────────────────────── */

static void rtx_arm(ScrSctpAssoc *a, uint64_t now_ms, bool reset) {
  if (reset) {
    a->rtx_ms = RTX_INITIAL_MS;
    a->rtx_tries = 0;
  }
  a->rtx_due = now_ms + a->rtx_ms;
  a->rtx_armed = true;
}

static void rtx_cancel(ScrSctpAssoc *a) { a->rtx_armed = false; }

/* ── chunk emission ───────────────────────────────────────────────── */

static void send_init(ScrSctpAssoc *a, uint64_t now_ms) {
  Dgram *d = out_alloc(a);
  if (d == NULL) return;
  /* The INIT carries vtag 0 -- the peer has not given us one yet. */
  uint32_t save = a->peer_tag;
  a->peer_tag = 0;
  begin(a, d);
  a->peer_tag = save;
  d->len += scr_sctp_write_init(d->buf + d->len, MAX_DGRAM - d->len,
                                a->local_tag, 65535, 1, 1, a->next_tsn);
  finish(d);
  rtx_arm(a, now_ms, false);
}

static void send_cookie_echo(ScrSctpAssoc *a, uint64_t now_ms) {
  Dgram *d = out_alloc(a);
  if (d == NULL) return;
  begin(a, d);
  d->len += scr_sctp_write_cookie_echo(d->buf + d->len, MAX_DGRAM - d->len,
                                       a->cookie, a->cookie_len);
  finish(d);
  rtx_arm(a, now_ms, false);
}

static void send_sack(ScrSctpAssoc *a) {
  Dgram *d = out_alloc(a);
  if (d == NULL) return;
  begin(a, d);
  d->len += scr_sctp_write_sack(d->buf + d->len, MAX_DGRAM - d->len,
                                a->peer_next - 1u, 65535);
  finish(d);
}

/* Emit one DATA chunk for a pending slot. Used for both the first
 * transmission and every retransmission -- same bytes, same TSN, which is
 * what makes a retransmission indistinguishable to the peer from the
 * original. */
static void send_data_slot(ScrSctpAssoc *a, Pending *p) {
  Dgram *d = out_alloc(a);
  if (d == NULL) return;
  begin(a, d);
  d->len += scr_sctp_write_data(d->buf + d->len, MAX_DGRAM - d->len, p->tsn, 0,
                                p->ppid, p->payload, p->len,
                                /*unordered=*/true, /*beginning=*/true,
                                /*ending=*/true);
  finish(d);
  a->stats.data_sent++;
}

static Pending *pend_alloc(ScrSctpAssoc *a) {
  for (unsigned i = 0; i < OUTQ; i++)
    if (!a->pend[i].in_use) return &a->pend[i];
  return NULL;
}

static bool queue_message(ScrSctpAssoc *a, const uint8_t *data, size_t len,
                          uint32_t ppid, uint64_t now_ms) {
  if (len > MAX_PAYLOAD) return false; /* refused, never silently split */
  Pending *p = pend_alloc(a);
  if (p == NULL) return false;
  memcpy(p->payload, data, len);
  p->len = len;
  p->ppid = ppid;
  p->tsn = a->next_tsn++;
  p->in_use = true;
  send_data_slot(a, p);
  if (!a->rtx_armed) rtx_arm(a, now_ms, true);
  return true;
}

/* ── lifecycle ────────────────────────────────────────────────────── */

ScrSctpAssoc *scr_sctp_assoc_new(uint16_t local_port, uint16_t remote_port,
                                 uint32_t seed, uint64_t now_ms) {
  (void)now_ms;
  ScrSctpAssoc *a = calloc(1, sizeof *a);
  if (a == NULL) return NULL;
  a->local_port = local_port;
  a->remote_port = remote_port;
  a->state = SCR_SCTP_CLOSED;
  /* Tag and initial TSN must not be zero and must not be guessable in
   * production; the caller supplies the randomness. */
  a->local_tag = seed ? seed : 0x5C5C5C5Cu;
  a->next_tsn = (seed ^ 0xA5A5A5A5u) | 1u;
  a->rtx_ms = RTX_INITIAL_MS;
  return a;
}

void scr_sctp_assoc_free(ScrSctpAssoc *a) { free(a); }

ScrSctpState scr_sctp_assoc_state(const ScrSctpAssoc *a) {
  return a ? a->state : SCR_SCTP_CLOSED;
}

bool scr_sctp_assoc_channel_open(const ScrSctpAssoc *a) {
  return a != NULL && a->channel_open;
}

void scr_sctp_assoc_stats(const ScrSctpAssoc *a, ScrSctpStats *out) {
  if (a != NULL && out != NULL) *out = a->stats;
}

void scr_sctp_assoc_connect(ScrSctpAssoc *a, uint64_t now_ms) {
  if (a == NULL || a->state != SCR_SCTP_CLOSED) return;
  a->state = SCR_SCTP_COOKIE_WAIT;
  rtx_arm(a, now_ms, true);
  send_init(a, now_ms);
}

/* ── DCEP ─────────────────────────────────────────────────────────── */

static void send_dcep_open(ScrSctpAssoc *a, uint64_t now_ms) {
  uint8_t body[128];
  size_t n = scr_sctp_write_dcep_open(body, sizeof body,
                                      SCR_SCTP_DCEP_RELIABLE_UNORDERED, 0, 0,
                                      a->label, a->label_len, NULL, 0);
  if (n == 0) return;
  queue_message(a, body, n, SCR_SCTP_PPID_DCEP, now_ms);
  a->dcep_sent = true;
}

bool scr_sctp_assoc_open_channel(ScrSctpAssoc *a, const char *label,
                                 uint64_t now_ms) {
  if (a == NULL || a->state != SCR_SCTP_ESTABLISHED || a->dcep_sent) return false;
  size_t n = strlen(label);
  if (n >= sizeof a->label) return false;
  memcpy(a->label, label, n);
  a->label_len = n;
  send_dcep_open(a, now_ms);
  return true;
}

bool scr_sctp_assoc_send(ScrSctpAssoc *a, const uint8_t *data, size_t len,
                         uint64_t now_ms) {
  if (a == NULL || !a->channel_open) return false;
  return queue_message(a, data, len, SCR_SCTP_PPID_BINARY, now_ms);
}

size_t scr_sctp_assoc_pop_message(ScrSctpAssoc *a, uint8_t *buf, size_t cap,
                                  uint32_t *ppid) {
  if (a == NULL || a->in_head == a->in_tail) return 0;
  InMsg *m = &a->inq[a->in_head];
  size_t n = m->len <= cap ? m->len : 0;
  if (n > 0) memcpy(buf, m->data, n);
  if (ppid != NULL) *ppid = m->ppid;
  a->in_head = (a->in_head + 1u) % INQ;
  return n;
}

/* ── inbound ──────────────────────────────────────────────────────── */

static void on_sack(ScrSctpAssoc *a, const uint8_t *v, size_t vlen,
                    uint64_t now_ms) {
  if (vlen < 12) return;
  uint32_t cum = ((uint32_t)v[0] << 24) | ((uint32_t)v[1] << 16) |
                 ((uint32_t)v[2] << 8) | (uint32_t)v[3];
  a->stats.sacks_received++;
  a->last_acked = cum;
  bool any = false;
  for (unsigned i = 0; i < OUTQ; i++) {
    Pending *p = &a->pend[i];
    /* Serial comparison: TSNs wrap, so "<=" must be signed-difference
     * (RFC 4960 s1.6), not a plain unsigned compare. */
    if (p->in_use && (int32_t)(cum - p->tsn) >= 0) {
      p->in_use = false;
    } else if (p->in_use) {
      any = true;
    }
  }
  /* Nothing outstanding means the retransmission timer has nothing to
   * cover; leaving it armed would fire a spurious resend. */
  /* Nothing left outstanding: disarm, or the next tick resends a chunk the
   * peer already has. Something still outstanding: restart the timer from
   * NOW with a fresh backoff, because forward progress was made. */
  if (!any) rtx_cancel(a);
  else rtx_arm(a, now_ms, true);
}

static void on_data(ScrSctpAssoc *a, const uint8_t *v, size_t vlen,
                    uint64_t now_ms) {
  ScrSctpData d;
  if (!scr_sctp_read_data(v, vlen, &d)) return;

  /* Duplicate suppression. Unordered delivery means arrival order is not
   * a contract, but DELIVERING THE SAME MESSAGE TWICE is still wrong, and
   * a retransmission after a lost SACK produces exactly that. */
  if (a->peer_seen && (int32_t)(d.tsn - a->peer_next) < 0) {
    a->stats.duplicates_dropped++;
    send_sack(a); /* the peer resent because it missed our ack: re-ack */
    return;
  }
  a->peer_next = d.tsn + 1u;
  a->peer_seen = true;
  a->stats.data_received++;

  if (d.ppid == SCR_SCTP_PPID_DCEP) {
    if (scr_sctp_is_dcep_ack(d.payload, d.payload_len)) a->channel_open = true;
    send_sack(a);
    return;
  }

  unsigned next = (a->in_tail + 1u) % INQ;
  if (next != a->in_head && d.payload_len <= MAX_PAYLOAD) {
    InMsg *m = &a->inq[a->in_tail];
    memcpy(m->data, d.payload, d.payload_len);
    m->len = d.payload_len;
    m->ppid = d.ppid;
    a->in_tail = next;
  }
  send_sack(a);
  (void)now_ms;
}

void scr_sctp_assoc_input(ScrSctpAssoc *a, const uint8_t *pkt, size_t len,
                          uint64_t now_ms) {
  if (a == NULL || a->state == SCR_SCTP_ABORTED) return;
  /* A datagram whose checksum does not verify is not a datagram. Checking
   * before the walk means a corrupted length field can never steer the
   * parser. */
  if (!scr_sctp_verify(pkt, len)) return;

  ScrSctpHeader h;
  if (!scr_sctp_read_header(pkt, len, &h)) return;
  /* Once we know our tag, a packet not carrying it is not ours. */
  if (a->state != SCR_SCTP_COOKIE_WAIT && h.vtag != a->local_tag) return;

  ScrSctpChunkIter it;
  for (bool ok = scr_sctp_chunk_first(pkt, len, &it); ok;
       ok = scr_sctp_chunk_next(&it)) {
    switch (it.type) {
      case SCR_SCTP_CHUNK_INIT_ACK: {
        if (a->state != SCR_SCTP_COOKIE_WAIT) break;
        ScrSctpInitAck ia;
        if (!scr_sctp_read_init_ack(it.value, it.value_len, &ia)) break;
        if (ia.cookie == NULL || ia.cookie_len > sizeof a->cookie) break;
        a->peer_tag = ia.init_tag;
        a->peer_next = ia.initial_tsn;
        memcpy(a->cookie, ia.cookie, ia.cookie_len);
        a->cookie_len = ia.cookie_len;
        a->state = SCR_SCTP_COOKIE_ECHOED;
        rtx_arm(a, now_ms, true);
        send_cookie_echo(a, now_ms);
        break;
      }
      case SCR_SCTP_CHUNK_COOKIE_ACK:
        if (a->state == SCR_SCTP_COOKIE_ECHOED) {
          a->state = SCR_SCTP_ESTABLISHED;
          rtx_cancel(a);
        }
        break;
      case SCR_SCTP_CHUNK_DATA:
        on_data(a, it.value, it.value_len, now_ms);
        break;
      case SCR_SCTP_CHUNK_SACK:
        on_sack(a, it.value, it.value_len, now_ms);
        break;
      case SCR_SCTP_CHUNK_HEARTBEAT: {
        /* Echo the Heartbeat Info parameter verbatim (RFC 4960 s3.3.6):
         * the peer may have encoded state only it can read. */
        Dgram *d = out_alloc(a);
        if (d == NULL) break;
        begin(a, d);
        d->len += scr_sctp_write_heartbeat_ack(d->buf + d->len,
                                               MAX_DGRAM - d->len, it.value,
                                               it.value_len);
        finish(d);
        a->stats.heartbeats_answered++;
        break;
      }
      case SCR_SCTP_CHUNK_ABORT:
        a->state = SCR_SCTP_ABORTED;
        return;
      default:
        break; /* unknown chunk types are ignored, per the report rules */
    }
  }
}

void scr_sctp_assoc_tick(ScrSctpAssoc *a, uint64_t now_ms) {
  if (a == NULL || !a->rtx_armed || a->state == SCR_SCTP_ABORTED) return;
  if (now_ms < a->rtx_due) return;

  a->rtx_tries++;
  if (a->rtx_tries > RTX_MAX_TRIES) {
    a->state = SCR_SCTP_ABORTED;
    a->rtx_armed = false;
    return;
  }
  /* Exponential backoff with a ceiling (RFC 4960 s6.3.3 RTO doubling). */
  a->rtx_ms = a->rtx_ms * 2u;
  if (a->rtx_ms > RTX_MAX_MS) a->rtx_ms = RTX_MAX_MS;
  a->rtx_due = now_ms + a->rtx_ms;

  switch (a->state) {
    case SCR_SCTP_COOKIE_WAIT:
      send_init(a, now_ms);
      a->stats.retransmits++;
      break;
    case SCR_SCTP_COOKIE_ECHOED:
      send_cookie_echo(a, now_ms);
      a->stats.retransmits++;
      break;
    case SCR_SCTP_ESTABLISHED: {
      bool any = false;
      for (unsigned i = 0; i < OUTQ; i++) {
        if (a->pend[i].in_use) {
          send_data_slot(a, &a->pend[i]);
          a->stats.retransmits++;
          any = true;
        }
      }
      if (!any) a->rtx_armed = false;
      break;
    }
    default:
      a->rtx_armed = false;
      break;
  }
}
