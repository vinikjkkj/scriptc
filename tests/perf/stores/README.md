# Store drivers in the static lane

What happens when scriptc's **static** lane is asked to compile a program that
uses each of zapo's five store drivers — `mysql2`, `pg`, `mongodb`, `ioredis`,
`better-sqlite3` — and what it would take to make any of them work.

This directory holds the probe programs and the walker that produced the map in
`G:\zapo-work\estado-stores.md`. Nothing here runs in the gate: `tests/perf/` is
excluded from the directory gate and no differential suite compiles these.

## The probes

`probes/*.ts` are the smallest realistic program per driver: connect, write one
row/key, read it back, close. Each was verified against a real server first
(zapo's own `packages/docker-compose.test.yml`) so a refusal is never a broken
program. The ports are the ephemeral host ports Compose assigned on the run that
produced the numbers; re-read them with `docker compose port <svc> <port>`.

`probes/pg-default.ts` is the same program spelled `import pg from "pg"` instead
of `import { Client } from "pg"`. That one-word difference is the difference
between "the package never leaves the island" and "the whole package tree
compiles statically", which is the single most surprising thing measured here.

`probes/redis-dynamic.ts` is the `--dynamic` spelling: the static lane's
`as unknown as T` cast is itself refused under `--dynamic`, and the dynamic
lane's `console.log(any)` is refused in the static lane, so no single source
text serves both.

## The walker

`npm-static-walk.sh <probe> <root-package>` repeatedly runs
`scriptc coverage --npm-static` and adds every package the island-fallback note
names, until no new package appears. It answers "how deep is this dependency
graph before the compiler stops complaining about the graph and starts
complaining about the code", which is the question that separates a tractable
driver from an intractable one.

Run it with the block environment sourced (`SCRIPTC_CC=zigcc`,
`SCRIPTC_TEST_CC="zig cc"`, `SCRIPTC_TARGET=x86_64-windows-gnu`) and a probe
directory that has a `tsconfig.json`: without one the compiler does not adopt
the project's `@types/node`, `@types/pg` and `@types/better-sqlite3` pull their
own copy in through `/// <reference types="node" />`, and the program dies in
256 duplicate-identifier errors that say nothing about any driver.
