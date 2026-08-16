/* The npm differential case table — npm.test.ts's list, extracted so the
 * Linux lane runs the IDENTICAL cases (same entries, same argv lists)
 * against the in-container Linux Node oracle. The fixture node_modules
 * are COMMITTED TEST DATA; binaries embed the package sources at build
 * time, the Node lane resolves them from the repo mount. */
import { globSync } from "node:fs";
import { join } from "node:path";

export interface NpmCase {
  name: string;
  entry: string;
  /** Every argv list runs both sides; default: one run with no args. */
  argvs?: string[][];
}

/* POSIX spelling of a globbed path. globSync hands back backslashes on
 * win32, and BOTH readers below are `/`-shaped: the 2465../2556.. exclusion
 * regex silently matched nothing there (so seven --npm-static-only cases
 * ran in the flagless island lane and four of them failed as "SC0001 …
 * has no exported member" / "SC1090 console.log of 'any'"), and
 * `split("/").at(-2)` answered `undefined`, which is the name vitest then
 * printed for every case in the file. No-op off win32. */
const posix = (s: string): string => s.split("\\").join("/");

export function npmCases(fixturesRoot: string): NpmCase[] {
  return [
    ...globSync(join(fixturesRoot, "npm/cases/*/main.ts"))
      .map(posix)
      .sort()
      // 2465-2469 and 2556-2557 are the --npm-static bundler-emitted-CJS
      // cases (npm-static.test.ts drives them with the opt-in): their
      // consumers exercise the static rewrite's surface (lexer-visible
      // names the shipped .d.ts never declares, the __toESM interop
      // family), so they stay out of the flagless island lane by design.
      // 4031-4064 are the --npm-static [[Get]] / UMD-bang family. 4062
      // and 4063 are PRICE LISTS (the `-on-purpose` convention):
      // programs that deliberately do NOT match Node today, pinned in
      // npm-static.test.ts so the refusal has a price tag. 4031, 4032,
      // 4061 and 4064 DO match Node now, but they still need the opt-in
      // — a named import from an unopted package is an island call under
      // --dynamic, and the shapes they are about (a prototype method
      // behind a checked cast, a module body that is one forcing `!`)
      // never reach the static walkers there. Measured, not assumed: all
      // six fail the flagless build with `SC2013: importing '<pkg>'
      // requires the embedded dynamic engine`.
      // 4142 joins them for the same reason as 4113: it is a PRICE
      // LIST, so it must not run in a lane that compares to Node.
      // 4111-4112 join them: `o[k](...)` binds `o` (protobufjs's uint64
      // reader), pinned in npm-static.test.ts. Measured on the branch, not
      // assumed: both fail the flagless build with `SC2013: importing
      // 'pbkeyrecv' requires the embedded dynamic engine`, plus one
      // SC2013 per call site for the values.
      // 4151-4152 join them for the same measured reason: the element
      // spelling reaching String/Number methods is pinned in
      // npm-static.test.ts, and both fail the flagless build with
      // `SC2013: importing 'keyedstrnum' requires the embedded dynamic
      // engine` plus one SC2013 per call site.
      .filter((entry) => !/\/(246[5-9]|255[67]|(403[12]|406[1-4])|411[1-4]|4142|415[1-4])-[^/]+\/main\.ts$/.test(entry))
      .map((entry) => ({ name: entry.split("/").at(-2)!, entry })),
    {
      // THE acceptance test: a calculator CLI on the real commander package
      // (pinned in the fixture; see its README), across the happy paths,
      // --version/--help (island process.exit), and the error exits.
      name: "commander-calc",
      entry: join(fixturesRoot, "commander-calc/calc.ts"),
      argvs: [
        ["add", "2", "3"],
        ["sub", "10", "4.25"],
        ["mul", "4", "2.5"],
        ["div", "9", "2"],
        ["add", "0.1", "0.2"],
        ["add", "1e3", "-0.5"],
        // The typed async action (string|undefined + options record + async
        // body): omitted argument -> the undefined arm; option flags ->
        // record fields (missing ones take their undefined arms); the
        // trailing Command argument drops.
        ["echo", "hello"],
        ["echo"],
        ["echo", "hello", "--upper"],
        ["echo", "hello", "-p", "say: "],
        ["echo", "--upper", "-p", "p: ", "mixed"],
        ["--version"],
        ["--help"],
        ["add", "2"], // missing argument: usage error, exit 1
        ["boom"], // unknown command: suggestion error, exit 1
        [], // no command: help to stderr, exit 1
        // The rejecting async action under plain parse(): nobody observes
        // the rejection — the unhandled-rejection report fires, exit 1.
        ["fail", "flat tire"],
      ],
    },
    {
      // The classic CLI ENTRY LINE: parseAsync's engine promise bridges into a
      // static one; the rejecting async action reaches the inline .catch
      // handler (typed-catch narrowing, stderr message, exit 1) — the full
      // round trip through BOTH promise bridges (the action's static
      // promise wraps into the engine, commander's result promise bridges
      // back out).
      name: "commander-calc-async",
      entry: join(fixturesRoot, "commander-calc/calc-async.ts"),
      argvs: [
        ["double", "21"],
        ["fail", "flat tire"],
        ["--help"],
        ["boom"], // unknown command: island process.exit path, exit 1
      ],
    },
  ];
}
