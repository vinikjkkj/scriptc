# Replacing `@roamhq/wrtc` with vendored C — the scoping prototype

`packages/voip`'s entry stops at `relay/WaSctpRelay.ts:5`, `import wrtc from
'@roamhq/wrtc'` — a 15,567,872-byte prebuilt N-API addon (measured: this is
the byte count of `node_modules/@roamhq/wrtc-win32-x64/wrtc.node` at
`^0.10.0`). What rides on it is one `RTCPeerConnection` carrying SCTP data
channels: no audio, no video, no codecs. So the question is whether ICE →
DTLS → SCTP can be built here without vendoring libwebrtc.

**Nothing in this directory is compiled by scriptc.** `runtimeFingerprint()`
(`packages/compiler/src/backend/cc.ts:1501`) hashes `.c`/`.h` under
`packages/runtime/src` and `packages/runtime/vendor` only, so a file here
cannot invalidate one cached object.

## What the prototype proves

`wrtcprobe.c` is 755 lines of hand-written C. Linked against the mbedTLS
already vendored in this repo and a vendored usrsctp, compiled by `zig cc`
for `x86_64-windows-gnu`, it establishes a real WebRTC data channel against
the real `@roamhq/wrtc` under Node v25.9.0 and exchanges bytes both ways:

```
[probe] DTLS handshake OK, peer fingerprint VERIFIED,
        suite=TLS-ECDHE-ECDSA-WITH-CHACHA20-POLY1305-SHA256
[probe] SCTP_ASSOC_CHANGE state=1
[probe] -> DCEP DATA_CHANNEL_OPEN stream=0 label=wa-web-call
NODE ondatachannel label=wa-web-call id=0 ordered=false protocol=""
[probe] -> SCTP data ppid=53 stream=0 hex=0001020304
NODE recv len=5 hex=0001020304
[probe] <- SCTP data ppid=53 stream=0 len=4
echo_hex=deadbeef
```

`label=wa-web-call`, `id=0`, `ordered=false` is exactly what
`WaSctpRelay.ts:338` asks for.

## The negative controls — read these before trusting the line above

A DTLS or SCTP stack that appears to work is the most dangerous thing this
directory could produce, so every security property is measured by making it
fail on purpose. Each is an env var on the probe.

| run | change | required outcome | measured |
|---|---|---|---|
| A | none | channel opens, `deadbeef` echoed | exit 0, `stun_binding_responses=1` |
| B | `PROBE_CORRUPT_FP=1` — flip one bit of the peer fingerprint the SDP carried | handshake REFUSED | exit 4, `FATAL fingerprint mismatch`, Node never saw `ondatachannel` |
| C1 | `PROBE_CORRUPT_ICEPWD=1` — sign our binding REQUESTS with a key the peer never published | peer answers none of them | `stun_binding_responses=0` (vs 1 in A) |
| C2 | `PROBE_CORRUPT_LOCAL_ICEPWD=1` — sign our binding RESPONSES with a key we did not advertise | peer must never accept the path | `NODE connectionState=failed`, `stopped_at=dtls`, exit 1, no `ondatachannel` |

C1 still completes the run, and that is correct ICE rather than a hole: the
peer's own inbound checks prove the path independently. The counter, not the
exit code, is what discriminates there.

## Provenance

- **usrsctp** `0.9.5.0`, commit `07f871bda23943c43c9e74cc54f25130459de830`,
  BSD-3-Clause. 23 `.c` + 38 `.h`, 93,072 lines, 2,829,478 bytes under
  `usrsctplib/`. **No transitive dependency**: all 23 TUs compile with
  `zig cc -target x86_64-windows-gnu` from three `-D` flags and two `-I`
  paths, no CMake, no OpenSSL (its built-in SHA-1 is the default; the
  `openssl/sha.h` include is behind `SCTP_USE_OPENSSL_SHA1`).
  GitHub's generated tag tarball is not an upstream-published attestation,
  so the commit id is the anchor; `build.sh` records the hashes this host
  measured so drift is visible.
- **mbedTLS** 3.6.7 — already vendored, already linked, unchanged. The stock
  `mbedtls_config.h` that `ensureTlsArchive()` compiles already enables
  `MBEDTLS_SSL_PROTO_DTLS`, `MBEDTLS_SSL_CLI_C`, `MBEDTLS_SSL_SRV_C`,
  `MBEDTLS_SSL_DTLS_ANTI_REPLAY`, `MBEDTLS_X509_CRT_WRITE_C`,
  `MBEDTLS_ECDSA_C`, `MBEDTLS_ECP_DP_SECP256R1_ENABLED` and `MBEDTLS_SHA1_C`
  — self-signed P-256 identity, DTLS 1.2 both roles, and the HMAC-SHA1 STUN
  MESSAGE-INTEGRITY needs. `MBEDTLS_SSL_DTLS_SRTP` is off and that is
  irrelevant: `use_srtp` is a media extension, and data channels carry SCTP
  over plain DTLS.

## Reproducing

```sh
sh research/sctp-datachannel/build.sh /some/scratch
npm i @roamhq/wrtc@^0.10.0          # beside drive.mjs
node research/sctp-datachannel/drive.mjs /some/scratch/wrtcprobe.exe
```
