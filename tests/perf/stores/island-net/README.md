# The island's node:net bridge links but never installs

Two programs, identical except for one unused `require('http')` in the embedded
package. Build both with `--dynamic` and run them:

    scriptc build net-only.ts      --dynamic -o net-only.exe
    scriptc build net-plus-http.ts --dynamic -o net-plus-http.exe

    net-only.exe       -> Uncaught Error: the island does not provide the 'node:net' builtin   (exit 1)
    net-plus-http.exe  -> isIP: 4                                                              (exit 0)

Both binaries are the same size, so the same TUs are linked either way. The
difference is a call in the emitted `main`.

`cc.ts` compiles `scr_net_island.c` when the embedded graph has an edge into
**`node:http`, `node:https`, `node:net` or `node:tls`**
(`packages/compiler/src/index.ts`, the `netIsland` field). The emitted `main`
calls `scr_net_island_install()` on a **narrower** predicate — `node:http` or
`node:https` only (`packages/compiler/src/backend/emission/emitter.ts`, and
`embedsHttpClient` in `backend/llvm/emitter.ts`). A graph whose only builtin
edge is `node:net` therefore links the bridge and never registers it:
`isl_netmod_attach` stays NULL, `builtins.net` and `builtins.tls` are never
added to the island's require table, and the program gets a "does not provide"
message about a builtin the runtime does in fact ship.

The IR is not the problem — `--emit-ir` on `net-only.ts` shows the edge:

    {"from":".../netprobe/index.js","specifier":"node:net","to":"node:net","kind":"any"}

Widening the emitter's predicate to match `cc.ts` is the whole fix. It does not
make any database driver work: the island's `node:net` is a load-only shim whose
`connect`, `createConnection`, `createServer` and `Socket` all throw
`node:net 'connect' is not supported in the scriptc island yet`. It changes an
honest program from a wrong error into the right one — which matters here,
because every TCP database driver (`mysql2`, `pg`, `mongodb`, `ioredis`) has
exactly this shape: it requires `net` and never requires `http`.
