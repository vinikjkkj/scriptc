// WHICH PACKAGE DOES A DIAGNOSTIC NAME when the types come from a
// DefinitelyTyped twin? `dtwin` ships the JS; `@types/dtwin` ships the
// declarations and no code at all.
//
// Before this fixture, every answer here was "@types/dtwin" — the package
// the DECLARATION was found in — and that is wrong three ways: the program
// never imports it, it ships nothing that could run in the embedded engine,
// and the --npm-static opt-in machinery then acted on the wrong name and
// reported "no runtime JS entry resolves", which is true of every
// declarations-only package and closed the only route that could have
// worked. Measured on zapo's store-postgres (`import pg from 'pg'` with
// @types/pg installed), reproduced here in four files.
//
// Pinned by tests/harness/npm-static.test.ts:
//   flagless        SC2013 must name 'dtwin' at the import AND at the use
//                   site, and no diagnostic may mention '@types/'.
//   --npm-static auto   the status row must be keyed 'dtwin'.
import { Pool } from "dtwin";

const p = new Pool(4);
console.log("described:", p.describe(), "size:", p.size);
