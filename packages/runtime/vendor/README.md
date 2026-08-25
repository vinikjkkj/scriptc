# Vendored third-party code

## ryu/

- Project: https://github.com/ulfjack/ryu
- Commit: 4c0618b0e44f7ef027ebae05d2cc7812048f7c8f
- License: Apache-2.0 OR BSL-1.0, used under the Boost Software License 1.0 (see ryu/LICENSE-Boost)

The double-to-shortest-decimal core of Ryū (d2s and its headers only — the float and fixed/exponent variants are not vendored). scr_number.c textually `#include`s d2s.c and calls its internal `d2d` digit generator; ECMA-262 digit *placement* stays in scr_number.c. The only modification to upstream files: `#include "ryu/x.h"` flattened to `#include "x.h"` in d2s.c and d2s_intrinsics.h so the directory is self-contained. To update, re-fetch the listed files at the new commit and re-apply that include flattening.

## monocypher/

- Project: https://github.com/LoupVaillant/Monocypher
- Version: 4.0.2
- License: BSD-2-Clause OR CC0-1.0, used under CC0-1.0 (see monocypher/LICENCE.md)

X25519 key agreement and RFC 8032 Ed25519 signatures, with the SHA-512 the
latter is defined over. Four files: `monocypher.{c,h}` and the optional
`monocypher-ed25519.{c,h}` — the SHA-512 flavour of Ed25519, which is the one
Node exposes (Monocypher's built-in EdDSA uses BLAKE2b and is NOT
interoperable). Unmodified from upstream.

Chosen over hand-rolling: the field arithmetic is radix-2^51 over 64-bit
limbs with a comb for the base point, several times faster than the
TweetNaCl shape a from-scratch version would reach, and it is audited code
rather than freshly written crypto. Chosen over mbedTLS (already vendored)
because mbedTLS has no Ed25519 at all.

## quickjs-ng/

- Project: https://github.com/quickjs-ng/quickjs
- Version: v0.15.1
- Commit: 3c8f3d68953955950074c41c6e4d999562ae82a7
- License: MIT (see quickjs-ng/LICENSE)

The QuickJS-ng JavaScript engine, embedded by the opt-in `--dynamic` build mode (see packages/runtime/src/scr_island.c). Static builds never compile or link any of this.

The tree is a plain snapshot of the upstream commit with directories the library build does not need removed (tests/, docs/, examples/, test262 fixtures, CI config, generator scripts). No vendored file is modified; to update, re-clone upstream at the new commit, delete its .git directory, apply the same trim, and update this file.

The engine archive (libqjs.a) is built lazily on the first `--dynamic` compile into `.cache/<commit>-<flavor>/` next to this file — one flavor per lane (plain, asan). The cache directory is gitignored and safe to delete.

## zlib/

- Project: https://github.com/madler/zlib
- Version: 1.3.1 (release tarball zlib-1.3.1.tar.gz, sha256 9a93b2b7dfdac77ceba5a558a580e74667dd6fede4585b91eefb60f03b72df23)
- License: zlib (see zlib/LICENSE)

The CROSS-target arm of node:zlib (see packages/runtime/src/scr_zlib.c): host builds keep the historical system `-lz` link (macOS ships libz), but zig's cross sysroots have no libz, so SCRIPTC_TARGET builds compile this vendored copy per target instead. Only the flat `*.c`/`*.h` at the distribution root are vendored (LICENSE beside them) — contrib, tests, build machinery, and docs are not. No vendored file is modified; the gz* file-I/O TUs are vendored for faithfulness but never compiled (nothing references the gzFile API — see ZLIB_SOURCES in packages/compiler/src/backend/cc.ts). To update, re-fetch the release tarball, copy the same flat set, and bump `ZLIB_VERSION` in cc.ts.

The objects build lazily on the first zlib-using cross compile into `.cache/zlib-<version>-<flavor>/` next to this file — one flavor per driver/target (the lre-objects pattern). Zlib-free binaries never compile any of this; compressed OUTPUT bytes are zlib-version-dependent, which is why the corpus only compares round-trips and fixed-blob inflation.

## curl/

- Project: https://curl.se/ (Debian bookworm's libcurl4-openssl-dev 7.88.1, the exact library the Linux lane's pinned container image ships)
- Version: 7.88.1 (headers copied byte-for-byte from `node:24.15.0-bookworm`'s `/usr/include/aarch64-linux-gnu/curl/`; the arch-specific include dir is Debian multiarch layout — the headers themselves are architecture-independent, `system.h` selects per-arch typedefs at preprocessing time)
- License: curl (see curl/COPYRIGHT — the Debian machine-readable copyright file for the package the headers came from)

HEADERS ONLY — no curl C source is vendored and none is ever compiled. These headers now serve ONLY the RETIRED curl reference implementation of fetch (packages/runtime/src/scr_fetch_curl.c, selected by `SCRIPTC_FETCH_CURL=1`; kept compilable for one release as the native flip's reference — see scr_fetch.c, the default, which rides scr_net/scr_tls/scr_http/zlib and touches nothing here). Under the flag: host builds link the system `-lcurl` (macOS ships libcurl), and linux-gnu CROSS builds compile scr_fetch_curl.c against these headers, then link against a generated STUB `libcurl.so` (soname `libcurl.so.4`, empty definitions of exactly the symbols scr_fetch_curl.c calls — see CURL_STUB_SYMBOLS in packages/compiler/src/backend/cc.ts) so the produced binary records a plain `DT_NEEDED libcurl.so.4` that the TARGET system's real libcurl satisfies at load time, the standard cross-link import-stub technique. The 7.88.1 pin is a floor, not a lock: scr_fetch_curl.c's newest requirement is CURLOPT_PROTOCOLS_STR (7.85.0) and the unversioned symbol references bind to any libcurl.so.4. This whole directory leaves with scr_fetch_curl.c when the reference retires for good.

The stub builds lazily on the first flag-selected fetch cross compile into `.cache/curl-stub-<flavor>/` next to this file (the zlib-objects pattern). Default builds never see any of this, and no build ever compiles curl itself.

## sqlite/

- Project: https://sqlite.org/
- Version: 3.53.4 (release amalgamation `2026/sqlite-amalgamation-3530400.zip`, **SHA3-256 `628a44cfe82c66aed1ccbbe85a562d2e33ebe64b3288981ed76285612227934e`**, 2 946 650 bytes — the hash and size published on sqlite.org/download.html, both re-computed here after download rather than trusted; Fossil check-in `bf7c7f30031888f4e796e429ab3978879485`)
- License: PUBLIC DOMAIN (the blessing is in the header of `sqlite3.c` itself; SQLite ships no LICENSE file)

The database engine behind `better-sqlite3` in the STATIC lane (see the
design note atop packages/runtime/src/scr_sqlite.c). Two files —
`sqlite3.c` and `sqlite3.h` — from the release amalgamation zip;
`shell.c` (the CLI) and `sqlite3ext.h` (the loadable-extension API, which
this build omits) are not vendored. No vendored file is modified. To
update: re-fetch the release amalgamation, verify its published SHA3-256,
copy the same two files, and bump `SQLITE_VERSION` in
packages/compiler/src/backend/cc.ts.

Chosen over `libsql` and `sqlite3mc`: neither is meaningfully better for
this workload, and the amalgamation is by a wide margin the most tested C
in existence — the fork's value would be features (replication,
encryption) that a WhatsApp client's local store does not use, paid for
with a smaller test corpus. It is also the version `better-sqlite3`
13.0.3 itself ships, which is measured rather than assumed:
`db.pragma("compile_options")` on the prebuilt addon reports 3.53.4, so
the differential harness compares against the SAME engine and any
divergence it finds is ours.

The compile-time configuration lives in `SQLITE_DEFINES` in cc.ts and
matches better-sqlite3's own reported `compile_options` for every
OBSERVABLE flag (DQS=0, DEFAULT_FOREIGN_KEYS, ENABLE_COLUMN_METADATA,
LIKE_DOESNT_MATCH_BLOBS, the ENABLE_* SQL surface, USE_URI, the cache and
WAL defaults), with two named divergences: `THREADSAFE=0` where
better-sqlite3 ships 2 (a compiled binary has one thread), and
LOAD_EXTENSION stays omitted because `loadExtension` is refused by name.

The object builds lazily on the first SQLite-using compile into
`.cache/sqlite-<version>-<flavor>/sqlite3.o` next to this file — one
flavor per driver/target, the zlib-objects pattern. **SQLite-free
binaries never compile or link any of this, and that is the point:** the
amalgamation is 269,649 lines and its object is larger than every other
runtime unit put together, so the gate (`moduleUsesSqlite`) is what keeps
a hello-world's image at exactly the size it had before this directory
existed — proved per-section against a build of the same entry at the
previous revision, not asserted.

## mbedtls/

- Project: https://github.com/Mbed-TLS/mbedtls
- Version: mbedtls-3.6.7 (the 3.6 LTS line — 4.x moved the crypto core into the separate TF-PSA-Crypto repository; the self-contained LTS is what a vendored tree wants)
- License: Apache-2.0 (see mbedtls/LICENSE)

The TLS provider behind node:tls/node:https (see the design note atop packages/runtime/src/scr_tls.c for why mbedTLS over SecureTransport/BoringSSL/libtls). Only `include/` and `library/` are vendored (LICENSE beside them) — tests, docs, programs, scripts, and CMake machinery are not. No vendored file is modified and no custom config is applied (the stock `mbedtls_config.h` builds every `library/*.c` standalone with clang); to update, re-fetch the release tarball, copy the same two directories, and bump `MBEDTLS_VERSION` in packages/compiler/src/backend/cc.ts.

The archive (libmbedtls.a) is built lazily on the first TLS-using compile into `.cache/mbedtls-<version>-<flavor>/` next to this file — one flavor per lane (plain, asan), the libqjs.a pattern. TLS-free binaries never compile or link any of this.
