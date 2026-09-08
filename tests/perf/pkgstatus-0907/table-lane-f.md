> **STORE ROWS SUPERSEDED, 2026-09-08** -- see
> `tests/perf/storestatus/CORRECTIONS-pkgstatus-0907.md`. Measured at
> `3f3dd523`; re-measured at `f91fcd55`, where the three islanded store rows
> read **39**, not 46, over ~47,000 statements rather than ~1,450.

| package (driver) | binary? | bytes | oracle | build error SITES | compiler's own line | analyse state | stmts reached / failed | blocker SITES | roots | cascade SC2004 | distinct msgs | runtime fences | advisories | unreached SITES |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `src-store-sqlite` | **yes** | 28,903,424 | MATCH | 0 | (none - 0 errors) | ANALYSED | 47078 / 0 | 0 | 0 | 0 | 0 | 1 | 53 | 7 |
| `src-store-redis` | **no** | n/a | n/a | 39 | 39 errors. | ANALYSED | 46993 / 19 | 39 | 20 | 19 | 9 | 1 | 53 | 10 |
| `src-media-utils` | **no** | n/a | n/a | 27 | 27 errors. | ANALYSED | 228 / 26 | 27 | 25 | 2 | 17 | 0 | 0 | 0 |
| `src-voip` | **no** | n/a | n/a | 59 | 59 errors. | ANALYSED | 48988 / 59 | 59 | 53 | 6 | 29 | 1 | 53 | 16 |
| `src-wam` | **no** | n/a | n/a | 15 | 15 errors. | ANALYSED | 48022 / 10 | 15 | 15 | 0 | 3 | 1 | 56 | 8 |

### provenance resolution, per driver (the compiler's own notes)

**src-store-sqlite**
  - zapo-js@1.8.2 ← https://github.com/vinikjkkj/zapo@refs/tags/v1.8.2 @ 757a8071b819 (source compiles statically)
  - @zapo-js/native: not installed under the entry's node_modules; island path used
  - argo-codec@0.2.1: no provenance attestation published; island path used

**src-store-redis**
  - zapo-js@1.8.2 ← https://github.com/vinikjkkj/zapo@refs/tags/v1.8.2 @ 757a8071b819 (source compiles statically)
  - @zapo-js/native: not installed under the entry's node_modules; island path used
  - argo-codec@0.2.1: no provenance attestation published; island path used
  - ioredis@5.11.1: no provenance attestation published; island path used

**src-media-utils**
  - zapo-js@1.8.2 ← https://github.com/vinikjkkj/zapo@refs/tags/v1.8.2 @ 757a8071b819 (source compiles statically)
  - argo-codec@0.2.1: no provenance attestation published; island path used
  - @zapo-js/native: not installed under the entry's node_modules; island path used
  - file-type@19.6.0: no provenance attestation published; island path used
  - sharp@0.33.5: no provenance attestation published; island path used

**src-voip**
  - zapo-js@1.8.2 ← https://github.com/vinikjkkj/zapo@refs/tags/v1.8.2 @ 757a8071b819 (source compiles statically)
  - @zapo-js/native: not installed under the entry's node_modules; island path used
  - argo-codec@0.2.1: no provenance attestation published; island path used
  - libmlow-wasm@0.1.1: no provenance attestation published; island path used
  - @roamhq/wrtc@0.10.0: no provenance attestation published; island path used

**src-wam**
  - zapo-js@1.8.2 ← https://github.com/vinikjkkj/zapo@refs/tags/v1.8.2 @ 757a8071b819 (source compiles statically)
  - argo-codec@0.2.1: no provenance attestation published; island path used
  - @zapo-js/native: not installed under the entry's node_modules; island path used
  - @vinikjkkj/wa-wam@2.3000.1041713829-1ec0d3b: no source mapping for '@vinikjkkj/wa-wam' (published target: index.js); island path used

