# lib-additions — a project's non-ES `lib` is a floor addition, never a replacement

`lib` is FORCED to `["lib.es2025.d.ts"]` (frontend/program.ts). A package can
therefore declare a global type surface its sources genuinely need and never be
given it: zapo's `@zapo-js/voip` asks for `"lib": ["ES2020", "DOM"]`, and every
module reachable from its entry passes through two type ALIASES of
`RTCPeerConnection`/`RTCDataChannel` (`relay/WaSctpRelay.ts:30-31`). With the
lib forced to es2025 alone the entry fails preflight on `SC0001 Cannot find
name` and nothing in the package is analysable from its own entry.

`libWithProjectAdditions` makes the forced value a FLOOR: the es2025 floor
always stands, `lib.es*.d.ts` requests are dropped (the floor covers them), and
everything else a project names is appended.

Three fixtures, and the pair that matters is `dom` / `no-dom`:

| fixture | tsconfig `lib` | pins |
| --- | --- | --- |
| `dom` | `["ES2020", "DOM"]` | a DOM type name resolves; the program compiles and runs |
| `no-dom` | absent | **the same source** still fails with `SC0001` — the addition is opt-in and does not leak |
| `es-only` | `["ES2015"]` | an ES request never LOWERS the floor: es2022+ surface still resolves |

`dom/main.ts` also pins the property that decides whether this mechanism is
safe at all: **a visible type is not an implemented capability.** The DOM
*type* resolves, and the DOM *value* (`new RTCPeerConnection()`) fences with
SC2020 naming the construct. If that ever stops fencing, a program that
refused loudly starts doing something wrong at run time.
