#!/bin/sh
# Reproduce the interop probe. Nothing here is compiled by scriptc: this
# directory sits OUTSIDE packages/runtime/{src,vendor}, which is what
# runtimeFingerprint() hashes, so it cannot move a single cached object.
#
#   sh research/sctp-datachannel/build.sh /some/scratch/dir
#
# then, with @roamhq/wrtc installed beside drive.mjs:
#
#   node research/sctp-datachannel/drive.mjs <scratch>/wrtcprobe.exe
#
# Node v25.9.0 is the oracle. There is no clang on this host; zig cc is the
# compiler for every artefact below.
set -eu

OUT="${1:?usage: build.sh <scratch-dir>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
ZIG="${ZIG:-/g/zapo-work/tools/zig/zig.exe}"
TARGET="${SCRIPTC_TARGET:-x86_64-windows-gnu}"

MBEDTLS="$REPO/packages/runtime/vendor/mbedtls"

# usrsctp 0.9.5.0 = commit 07f871bda23943c43c9e74cc54f25130459de830.
# GitHub's generated tag tarball is not a vendor-published attestation, so
# the commit id above is the provenance anchor; the hashes below are what
# THIS host measured on 2026-08-26 and are recorded to detect drift, not as
# an upstream claim.
#   sha256   260107caf318650a57a8caa593550e39bca6943e93f970c80d6c17e59d62cd92
#   sha3-256 4e6eab8e2978da83d23189a5eba9a982ecf45d8657c2a7d6da0f8e4a4c3e569e
#   bytes    771701
USRSCTP_TAG=0.9.5.0
USRSCTP_URL="https://github.com/sctplab/usrsctp/archive/refs/tags/${USRSCTP_TAG}.tar.gz"

mkdir -p "$OUT"
cd "$OUT"

if [ ! -d "usrsctp-${USRSCTP_TAG}" ]; then
  curl -sSL -o usrsctp.tar.gz "$USRSCTP_URL"
  printf 'usrsctp.tar.gz sha256 '; sha256sum usrsctp.tar.gz | cut -d' ' -f1
  tar xzf usrsctp.tar.gz
fi
USRSCTP="$OUT/usrsctp-${USRSCTP_TAG}/usrsctplib"

# ── usrsctp: 23 TUs, no external dependency, no CMake ────────────────────
# __Userspace__ selects the userland stack; the AF_CONN path used here needs
# no sockets at all, so user_recv_thread.c is compiled but never entered.
mkdir -p uobj
( cd "$USRSCTP"
  for f in $(find . -name '*.c' | sort); do
    "$ZIG" cc -target "$TARGET" -std=c11 -Os \
      -D__Userspace__ -DSCTP_SIMPLE_ALLOCATOR -DSCTP_PROCESS_LEVEL_LOCKS \
      -I. -I./netinet -c "$f" -o "$OUT/uobj/$(basename "$f" .c).o"
  done )
( cd uobj && "$ZIG" ar rcs libusrsctp.a ./*.o )

# ── mbedTLS: the tree ALREADY vendored in this repo, stock config, the same
#    per-TU recipe ensureTlsArchive() in cc.ts uses ────────────────────────
mkdir -p mobj
( cd "$MBEDTLS/library"
  for f in *.c; do
    "$ZIG" cc -target "$TARGET" -std=c11 -Os \
      -I "$MBEDTLS/include" -I "$MBEDTLS/library" \
      -c "$f" -o "$OUT/mobj/${f%.c}.o"
  done )
( cd mobj && "$ZIG" ar rcs libmbedtls.a ./*.o )

# ── the probe ────────────────────────────────────────────────────────────
"$ZIG" cc -target "$TARGET" -std=c11 -O1 -g \
  -D__Userspace__ \
  -I "$MBEDTLS/include" -I "$USRSCTP" \
  "$HERE/wrtcprobe.c" \
  "$OUT/uobj/libusrsctp.a" "$OUT/mobj/libmbedtls.a" \
  -lws2_32 -liphlpapi -lbcrypt -ladvapi32 \
  -o "$OUT/wrtcprobe.exe"

ls -l "$OUT/wrtcprobe.exe"
