> **STORE ROWS SUPERSEDED, 2026-09-08** -- see
> `tests/perf/storestatus/CORRECTIONS-pkgstatus-0907.md`. Measured at
> `3f3dd523`; re-measured at `f91fcd55`, where the three islanded store rows
> read **39**, not 46, over ~47,000 statements rather than ~1,450.

| package (driver) | binary? | bytes | oracle | build error SITES | compiler's own line | analyse state | stmts reached / failed | blocker SITES | roots | cascade SC2004 | distinct msgs | runtime fences | advisories | unreached SITES |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `store-memory` | **yes** | 17,807,360 | MATCH | 0 | (none - 0 errors) | ANALYSED | 30690 / 0 | 0 | 0 | 0 | 0 | 1 | 0 | 1 |
| `store-sqlite` | **no** | n/a | n/a | 7 | 7 errors. | ANALYSED | 1535 / 5 | 7 | 6 | 1 | 7 | 0 | 1 | 202 |
| `store-mongo` | **no** | n/a | n/a | 1 | 1 error. | ANALYSED | 3131 / 149 | 242 | 201 | 41 | 181 | 0 | 3 | 1447 |
| `store-mysql` | **no** | n/a | n/a | 46 | 46 errors. | ANALYSED | 1462 / 24 | 46 | 26 | 20 | 16 | 0 | 1 | 208 |
| `store-postgres` | **no** | n/a | n/a | 46 | 46 errors. | ANALYSED | 1449 / 24 | 46 | 26 | 20 | 16 | 0 | 1 | 208 |
| `store-redis` | **no** | n/a | n/a | 46 | 46 errors. | ANALYSED | 1450 / 24 | 46 | 26 | 20 | 16 | 0 | 1 | 205 |
| `media-utils` | **no** | n/a | n/a | 5 | 5 errors. | **ISLANDED — UNMEASURED** | 3 / 3 | n/a — island (5 island-boundary sites) | n/a | n/a | n/a | n/a | n/a | n/a |
| `wam` | **no** | n/a | n/a | 86 | 86 errors. | ANALYSED | 1462 / 76 | 86 | 82 | 4 | 12 | 0 | 0 | 189 |
| `voip` | **no** | n/a | n/a | 4 | 4 errors. | **ISLANDED — UNMEASURED** | 6 / 2 | n/a — island (4 island-boundary sites) | n/a | n/a | n/a | n/a | n/a | n/a |

### provenance resolution, per driver (the compiler's own notes)

**store-memory**
  - zapo-js@1.8.2 ← https://github.com/vinikjkkj/zapo@refs/tags/v1.8.2 @ 757a8071b819 (source compiles statically)
  - @zapo-js/native: not installed under the entry's node_modules; island path used

**store-sqlite**
  - @zapo-js/store-sqlite@1.2.0 ← https://github.com/vinikjkkj/zapo@refs/tags/v1.8.0 @ 9a49e1fffdec (source compiles statically)
  - argo-codec@0.2.1: no provenance attestation published; island path used
  - @zapo-js/native: not installed under the entry's node_modules; island path used

**store-mongo**
  - @zapo-js/store-mongo@1.2.0 ← https://github.com/vinikjkkj/zapo@refs/tags/v1.8.0 @ 9a49e1fffdec (source compiles statically)
  - mongodb@6.21.0 ← https://github.com/mongodb/node-mongodb-native@refs/heads/6.x @ 387b6dd29e0a (source compiles statically)
  - bson@6.10.4 ← https://github.com/mongodb/js-bson@refs/heads/main @ 302f96e9591c (source compiles statically)
  - mongodb-connection-string-url@3.0.2 ← https://github.com/mongodb-js/mongodb-connection-string-url@refs/heads/main @ 26e2c12671f3 (source compiles statically)
  - @mongodb-js/saslprep@1.5.2 ← https://github.com/mongodb-js/devtools-shared@refs/heads/main @ aff0d3bdf6e3 (source compiles statically)
  - mongodb-client-encryption: not installed under the entry's node_modules; island path used
  - kerberos: not installed under the entry's node_modules; island path used
  - @mongodb-js/zstd: not installed under the entry's node_modules; island path used
  - @aws-sdk/credential-providers: not installed under the entry's node_modules; island path used
  - gcp-metadata: not installed under the entry's node_modules; island path used
  - snappy: not installed under the entry's node_modules; island path used
  - socks: not installed under the entry's node_modules; island path used
  - aws4: not installed under the entry's node_modules; island path used
  - whatwg-url@14.2.0: no provenance attestation published; island path used
  - sparse-bitfield@3.0.3: no provenance attestation published; island path used
  - argo-codec@0.2.1: no provenance attestation published; island path used
  - @zapo-js/native: skipped — provenance package limit (16) reached; island path used

**store-mysql**
  - @zapo-js/store-mysql@1.2.0 ← https://github.com/vinikjkkj/zapo@refs/tags/v1.8.0 @ 9a49e1fffdec (source compiles statically)
  - mysql2@3.24.3: no source mapping for 'mysql2/promise' (published target: ./promise.js); island path used
  - argo-codec@0.2.1: no provenance attestation published; island path used
  - @zapo-js/native: not installed under the entry's node_modules; island path used

**store-postgres**
  - @zapo-js/store-postgres@1.2.0 ← https://github.com/vinikjkkj/zapo@refs/tags/v1.8.0 @ 9a49e1fffdec (source compiles statically)
  - pg@8.23.0: no provenance attestation published; island path used
  - argo-codec@0.2.1: no provenance attestation published; island path used
  - @zapo-js/native: not installed under the entry's node_modules; island path used

**store-redis**
  - @zapo-js/store-redis@1.3.0 ← https://github.com/vinikjkkj/zapo@refs/tags/v1.8.0 @ 9a49e1fffdec (source compiles statically)
  - ioredis@5.11.1: no provenance attestation published; island path used
  - argo-codec@0.2.1: no provenance attestation published; island path used
  - @zapo-js/native: not installed under the entry's node_modules; island path used

**media-utils**
  - @zapo-js/media-utils@1.0.0: no provenance attestation published; island path used

**wam**
  - @zapo-js/wam@0.1.1 ← https://github.com/vinikjkkj/zapo@refs/heads/master @ 1dc6b9f8de93 (source compiles statically)
  - @vinikjkkj/wa-wam@2.3000.1041713829-1ec0d3b: no source mapping for '@vinikjkkj/wa-wam' (published target: index.js); island path used
  - argo-codec@0.2.1: no provenance attestation published; island path used

**voip**
  - @zapo-js/voip@1.0.0: no provenance attestation published; island path used

