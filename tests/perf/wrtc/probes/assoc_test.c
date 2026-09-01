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

#include "sctp_peer.inc"

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
