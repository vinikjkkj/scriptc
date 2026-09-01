/* The SCTP association, driven over a DELIBERATELY LOSSY transport.
 *
 * An association proved only over a transport that cannot lose anything is
 * not proved at all. The DTLS half of this clause already paid for that
 * lesson, so this file starts lossy rather than adding loss later.
 *
 * The peer is a minimal scripted responder written here in the test, not a
 * second copy of the implementation: replying with the implementation's own
 * code would make a bug in the wire format agree with itself. It answers
 * INIT with INIT ACK plus a State Cookie, COOKIE ECHO with COOKIE ACK, DATA
 * with SACK, a DCEP OPEN with a DCEP ACK, and it can send HEARTBEATs.
 */
#include <stdio.h>
#include <string.h>

#include "scr_sctp.h"
#include "scr_sctp_assoc.h"

static int fails = 0, checks = 0;

static void ck(const char *what, int ok, const char *detail) {
  checks++;
  if (ok) printf("  ok   %-50s %s\n", what, detail ? detail : "");
  else {
    printf("  FAIL %-50s %s\n", what, detail ? detail : "");
    fails++;
  }
}

/* ── the scripted peer ───────────────────────────────────────────────── */

typedef struct {
  uint16_t local_port, remote_port;
  uint32_t my_tag;      /* the tag we hand the client        */
  uint32_t client_tag;  /* the tag the client handed us      */
  uint32_t next_tsn;    /* TSNs we assign to our own DATA    */
  uint32_t cum;         /* highest CONTIGUOUS client TSN acked */
  bool seen_any;
  bool pending_dcep_ack;/* out_len holds one datagram, so the DCEP ACK
                         * waits its turn behind the SACK */
  bool established;
  bool got_dcep_open;
  /* one queued outbound datagram */
  uint8_t out[1500];
  size_t out_len;
  /* The peer must retransmit its OWN unacked DATA. Without this a dropped
   * DCEP ACK is lost forever and the channel never opens -- which looked
   * like a client bug at 50%% loss and was entirely the test peer being
   * simpler than any real endpoint. */
  bool own_unacked;
  uint32_t own_tsn;
  uint8_t own_payload[64];
  size_t own_len;
  uint32_t own_ppid;
  uint64_t own_due;
  bool hb_outstanding;
  uint64_t hb_due;
  unsigned data_from_client;
  unsigned dup_from_client;
} Peer;

static void peer_begin(Peer *p, uint32_t vtag) {
  p->out_len = scr_sctp_write_header(p->out, sizeof p->out, p->local_port,
                                     p->remote_port, vtag);
}

static void peer_finish(Peer *p) { scr_sctp_finalize(p->out, p->out_len); }

/* INIT ACK: the 16-byte fixed part, then a State Cookie parameter. Built by
 * hand here rather than with a writer from the implementation. */
static void peer_send_init_ack(Peer *p) {
  peer_begin(p, p->client_tag);
  uint8_t v[16 + 4 + 8];
  memset(v, 0, sizeof v);
  v[0] = (uint8_t)(p->my_tag >> 24); v[1] = (uint8_t)(p->my_tag >> 16);
  v[2] = (uint8_t)(p->my_tag >> 8);  v[3] = (uint8_t)p->my_tag;
  v[4] = 0x00; v[5] = 0x01; v[6] = 0x00; v[7] = 0x00; /* a_rwnd */
  v[8] = 0; v[9] = 1;                                  /* OS  */
  v[10] = 0; v[11] = 1;                                /* MIS */
  v[12] = (uint8_t)(p->next_tsn >> 24); v[13] = (uint8_t)(p->next_tsn >> 16);
  v[14] = (uint8_t)(p->next_tsn >> 8);  v[15] = (uint8_t)p->next_tsn;
  v[16] = 0; v[17] = 7;    /* State Cookie parameter */
  v[18] = 0; v[19] = 12;   /* length 4 + 8           */
  for (int i = 0; i < 8; i++) v[20 + i] = (uint8_t)(0xC0 + i);

  uint8_t *c = p->out + p->out_len;
  c[0] = SCR_SCTP_CHUNK_INIT_ACK;
  c[1] = 0;
  size_t total = 4 + sizeof v;
  c[2] = (uint8_t)(total >> 8);
  c[3] = (uint8_t)total;
  memcpy(c + 4, v, sizeof v);
  p->out_len += total;
  peer_finish(p);
}

static void peer_send_simple(Peer *p, uint8_t type) {
  peer_begin(p, p->client_tag);
  uint8_t *c = p->out + p->out_len;
  c[0] = type;
  c[1] = 0;
  c[2] = 0;
  c[3] = 4;
  p->out_len += 4;
  peer_finish(p);
}

static void peer_send_sack(Peer *p) {
  peer_begin(p, p->client_tag);
  p->out_len += scr_sctp_write_sack(p->out + p->out_len,
                                    sizeof p->out - p->out_len, p->cum,
                                    65535);
  peer_finish(p);
}

/* A DATA chunk from the peer carrying an arbitrary payload. */
static void peer_emit_data(Peer *p, uint32_t tsn, uint32_t ppid,
                           const uint8_t *d, size_t n) {
  peer_begin(p, p->client_tag);
  p->out_len += scr_sctp_write_data(p->out + p->out_len,
                                    sizeof p->out - p->out_len, tsn,
                                    0, ppid, d, n, true, true, true);
  peer_finish(p);
}

/* Send and REMEMBER, so a dropped datagram can be resent. Only one is ever
 * outstanding on this path. */
static void peer_send_data(Peer *p, uint32_t ppid, const uint8_t *d, size_t n) {
  p->own_tsn = p->next_tsn++;
  memcpy(p->own_payload, d, n);
  p->own_len = n;
  p->own_ppid = ppid;
  p->own_unacked = true;
  p->own_due = 0;
  peer_emit_data(p, p->own_tsn, ppid, d, n);
}

static void peer_send_heartbeat(Peer *p) {
  peer_begin(p, p->client_tag);
  uint8_t *c = p->out + p->out_len;
  c[0] = SCR_SCTP_CHUNK_HEARTBEAT;
  c[1] = 0;
  c[2] = 0;
  c[3] = 12;
  /* Heartbeat Info parameter (type 1) with 8 opaque bytes. */
  c[4] = 0; c[5] = 1; c[6] = 0; c[7] = 12 - 4;
  for (int i = 0; i < 4; i++) c[8 + i] = (uint8_t)(0xB0 + i);
  p->out_len += 12;
  peer_finish(p);
}

static void peer_input(Peer *p, const uint8_t *pkt, size_t len) {
  if (!scr_sctp_verify(pkt, len)) return;
  ScrSctpChunkIter it;
  for (bool ok = scr_sctp_chunk_first(pkt, len, &it); ok;
       ok = scr_sctp_chunk_next(&it)) {
    if (it.type == SCR_SCTP_CHUNK_INIT && it.value_len >= 16) {
      p->client_tag = ((uint32_t)it.value[0] << 24) |
                      ((uint32_t)it.value[1] << 16) |
                      ((uint32_t)it.value[2] << 8) | (uint32_t)it.value[3];
      peer_send_init_ack(p);
    } else if (it.type == SCR_SCTP_CHUNK_COOKIE_ECHO) {
      p->established = true;
      peer_send_simple(p, SCR_SCTP_CHUNK_COOKIE_ACK);
    } else if (it.type == SCR_SCTP_CHUNK_SACK && it.value_len >= 12) {
      uint32_t cum = ((uint32_t)it.value[0] << 24) |
                     ((uint32_t)it.value[1] << 16) |
                     ((uint32_t)it.value[2] << 8) | (uint32_t)it.value[3];
      if (p->own_unacked && (int32_t)(cum - p->own_tsn) >= 0)
        p->own_unacked = false;
    } else if (it.type == SCR_SCTP_CHUNK_HEARTBEAT_ACK) {
      p->hb_outstanding = false;
    } else if (it.type == SCR_SCTP_CHUNK_DATA) {
      ScrSctpData d;
      if (!scr_sctp_read_data(it.value, it.value_len, &d)) continue;

      /* A CUMULATIVE ack names the highest CONTIGUOUS TSN received, not the
       * highest one seen. Acking the highest seen is the bug that makes a
       * lossy run look like a broken sender: the client frees a chunk the
       * peer never got and the message is gone for good. Out-of-order
       * arrivals therefore do NOT advance the cumulative point -- the
       * sender's timer refills the gap, which is correct here because this
       * association does not act on gap-ack blocks. */
      if (!p->seen_any) {
        p->cum = d.tsn;
        p->seen_any = true;
      } else if ((int32_t)(d.tsn - p->cum) <= 0) {
        p->dup_from_client++;
        peer_send_sack(p); /* re-ack: our previous SACK was evidently lost */
        continue;
      } else if (d.tsn == p->cum + 1u) {
        p->cum = d.tsn;
      } else {
        /* Ahead of the cumulative point: hold the ack where it is. */
        peer_send_sack(p);
        continue;
      }

      if (d.ppid == SCR_SCTP_PPID_DCEP) {
        p->got_dcep_open = true;
        /* SACK the DCEP chunk as well: without it the client retransmits
         * its channel-open forever. */
        peer_send_sack(p);
        p->pending_dcep_ack = true;
      } else {
        p->data_from_client++;
        peer_send_sack(p);
      }
    }
  }
}

/* ── the lossy pump ──────────────────────────────────────────────────── */

typedef struct {
  uint32_t st;
  unsigned drop_pct;
  unsigned sent, dropped;
} Wire;

static uint32_t xs32(Wire *w) {
  uint32_t x = w->st;
  x ^= x << 13; x ^= x >> 17; x ^= x << 5;
  w->st = x;
  return x;
}

static bool wire_pass(Wire *w) {
  w->sent++;
  if (w->drop_pct > 0 && (xs32(w) % 100u) < w->drop_pct) {
    w->dropped++;
    return false;
  }
  return true;
}

/* Hand the peer's queued datagrams to the client through the lossy wire,
 * including the DCEP ACK it defers behind the SACK. */
/* The peer's own retransmission timer: resend unacked DATA, and re-probe
 * with a heartbeat until one is answered. Every real endpoint does this;
 * without it the test measures the peer's simplicity, not the client. */
static void peer_tick(Peer *p, uint64_t t) {
  if (p->out_len > 0) return; /* its single buffer is still occupied */
  if (p->own_unacked && t >= p->own_due) {
    p->own_due = t + 500u;
    peer_emit_data(p, p->own_tsn, p->own_ppid, p->own_payload, p->own_len);
    return;
  }
  if (p->hb_outstanding && t >= p->hb_due) {
    p->hb_due = t + 700u;
    peer_send_heartbeat(p);
  }
}

static void peer_drain(Peer *p, ScrSctpAssoc *a, Wire *w, uint64_t t) {
  for (int guard = 0; guard < 4; guard++) {
    if (p->out_len > 0) {
      if (wire_pass(w)) scr_sctp_assoc_input(a, p->out, p->out_len, t);
      p->out_len = 0;
      continue;
    }
    if (p->pending_dcep_ack) {
      uint8_t ack[1] = { SCR_SCTP_DCEP_DATA_CHANNEL_ACK };
      peer_send_data(p, SCR_SCTP_PPID_DCEP, ack, 1);
      p->pending_dcep_ack = false;
      continue;
    }
    return;
  }
}

/* Virtual time: the association takes now_ms as a parameter, so the whole
 * run is deterministic and needs no sleeping. */
static int run_case(const char *label, unsigned drop_pct, uint32_t seed) {
  printf("\n%s (drop=%u%%, seed=%u)\n", label, drop_pct, seed);

  ScrSctpAssoc *a = scr_sctp_assoc_new(5000, 5000, seed, 0);
  Peer p;
  memset(&p, 0, sizeof p);
  p.local_port = 5000;
  p.remote_port = 5000;
  p.my_tag = 0x1234ABCDu;
  p.next_tsn = 900u;
  Wire w;
  memset(&w, 0, sizeof w);
  w.st = seed ? seed : 7u;
  w.drop_pct = drop_pct;

  uint64_t t = 0;
  scr_sctp_assoc_connect(a, t);

  uint8_t buf[1600];
  int opened_at = -1;
  int msgs_in = 0;
  const int MSGS = 5;
  int sent_count = 0;
  bool hb_sent = false;
  uint8_t payload[16];

  /* Virtual clock in 10 ms steps, 60 s of virtual time. */
  for (int step = 0; step < 6000; step++) {
    t = (uint64_t)step * 10u;
    scr_sctp_assoc_tick(a, t);

    /* client -> peer, then drain everything the peer owes back. The peer
     * can owe TWO datagrams for one inbound chunk (a SACK and then the
     * DCEP ACK) and its buffer holds one, so this is a loop rather than a
     * single hand-off. */
    size_t n;
    while ((n = scr_sctp_assoc_pop_output(a, buf, sizeof buf)) > 0) {
      if (wire_pass(&w)) peer_input(&p, buf, n);
      peer_drain(&p, a, &w, t);
  }
    peer_tick(&p, t);
    peer_drain(&p, a, &w, t);

    if (scr_sctp_assoc_state(a) == SCR_SCTP_ESTABLISHED && opened_at < 0) {
      scr_sctp_assoc_open_channel(a, "wa-web-call", t);
      opened_at = step;
    }

    if (scr_sctp_assoc_channel_open(a) && sent_count < MSGS) {
      snprintf((char *)payload, sizeof payload, "msg-%d", sent_count);
      if (scr_sctp_assoc_send(a, payload, strlen((char *)payload), t))
        sent_count++;
    }

    /* Heartbeat once, as soon as the association is up. Gating this on a
     * fixed step number made it never fire in the clean case, because the
     * loop finished first -- a green run that had not run the check. */
    if (!hb_sent && p.established) {
      p.hb_outstanding = true;
      p.hb_due = t;
      hb_sent = true;
    }

    uint32_t ppid;
    while (scr_sctp_assoc_pop_message(a, buf, sizeof buf, &ppid) > 0) msgs_in++;

    /* Exit only when EVERYTHING under test has finished, heartbeat
     * included. Leaving the heartbeat out of the exit condition made it a
     * race against message delivery: it passed at 50%% loss (slow enough
     * that the retry landed) and failed at 30%% (fast enough that the loop
     * had already left), which reads as a loss-dependent bug and is purely
     * the test exiting early. */
    if (p.data_from_client >= (unsigned)MSGS && scr_sctp_assoc_channel_open(a) &&
        hb_sent && !p.hb_outstanding)
      break;
  }

  ScrSctpStats s;
  scr_sctp_assoc_stats(a, &s);
  char d[160];

  ck("association reaches ESTABLISHED",
     scr_sctp_assoc_state(a) == SCR_SCTP_ESTABLISHED, NULL);
  ck("peer saw COOKIE ECHO", p.established, NULL);
  ck("DCEP open reached the peer", p.got_dcep_open, NULL);
  ck("channel is open (DCEP ACK processed)", scr_sctp_assoc_channel_open(a),
     NULL);

  snprintf(d, sizeof d, "%u of %d delivered", p.data_from_client, MSGS);
  ck("every user message reached the peer", p.data_from_client == (unsigned)MSGS, d);

  snprintf(d, sizeof d, "sent=%u rtx=%u sacks=%u dup=%u hb=%u | wire %u sent %u dropped",
           s.data_sent, s.retransmits, s.sacks_received, s.duplicates_dropped,
           s.heartbeats_answered, w.sent, w.dropped);
  printf("       %s\n", d);

  ck("heartbeat was answered", s.heartbeats_answered >= 1, NULL);
  /* Duplicates are EXPECTED under loss -- a retransmission after a lost
   * SACK is exactly one. The property that matters is that a duplicate is
   * never counted as a new message, which is what data_from_client == MSGS
   * asserts above. Reported, not asserted. */
  printf("       peer saw %u duplicate(s), none counted as new", p.dup_from_client);
  putchar(10);  /* newline without an escape: this file is edited through a shell */

  if (drop_pct > 0) {
    ck("the wire actually dropped datagrams", w.dropped > 0, NULL);
    /* The point of a lossy run: retransmission must have HAPPENED, or the
     * run proves only that nothing was lost on the paths that mattered. */
    ck("retransmission actually happened", s.retransmits > 0, NULL);
  }

  int ok = scr_sctp_assoc_state(a) == SCR_SCTP_ESTABLISHED &&
           scr_sctp_assoc_channel_open(a) &&
           p.data_from_client == (unsigned)MSGS;
  scr_sctp_assoc_free(a);
  return ok;
}

int main(void) {
  printf("SCTP association over a lossy transport (virtual clock)\n");
  run_case("clean", 0, 11u);
  run_case("10% loss", 10, 22u);
  run_case("30% loss", 30, 33u);
  run_case("50% loss", 50, 44u);
  printf("\n%d checks, %d failures\nRESULT: %s\n", checks, fails,
         fails ? "FAIL" : "PASS");
  return fails ? 1 : 0;
}
