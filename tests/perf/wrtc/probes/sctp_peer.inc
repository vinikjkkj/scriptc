/* sctp_peer.inc — the hand-written scripted SCTP peer.
 *
 * Included by BOTH assoc_test.c and joined_test.c so there is exactly one
 * copy. It is deliberately hand-written rather than a second instance of
 * scr_sctp_assoc.c: replying with the implementation under test would let a
 * wire-format bug agree with itself, and every bug this peer has caught so
 * far was found precisely because the two sides disagree independently.
 *
 * It answers INIT with INIT ACK plus a State Cookie, COOKIE ECHO with
 * COOKIE ACK, DATA with a cumulative SACK over the CONTIGUOUS prefix,
 * a DCEP OPEN with a DCEP ACK, and it retransmits its own unacked DATA and
 * re-probes with HEARTBEATs. Those last two are not decoration: without
 * them a dropped DCEP ACK killed the channel and looked like a client bug.
 */

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

