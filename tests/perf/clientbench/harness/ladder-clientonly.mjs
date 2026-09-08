/* ladder-clientonly.mjs — the CLIENT-SIDE entry the fake server is not part of.
 *
 * The user's correction: "o fake server nao e pra compilar, ele fica como
 * processo separado." The compiled artifact is the zapo CLIENT driving real
 * message paths over a real socket to a Node process on the other end.
 *
 * messaging.bench.ts is BOTH halves in one file. It already carries the
 * abstraction for it -- PeerHandle / AbstractContactFixture /
 * AbstractGroupFixture -- and two concrete drivers over it:
 *
 *   mainInProcess       constructs FakeWaServer IN this process
 *   mainSeparateProcess spawns the server as a child (server-process.ts) and
 *                       talks to it through ServerRpc over a socket
 *
 * mainSeparateProcess contains ZERO references to FakeWaServer, to a
 * pipeline or to FakePeer; its fixtures come from rpc.buildContacts() and
 * rpc.buildGroups(). The ONLY thing that puts the server in the compiled
 * graph is the top-level `import { FakeWaServer } from '../src/api/FakeWaServer'`
 * that the in-process half needs.
 *
 * This produces, in a COPY, the entry that would exist if the client half
 * were its own file. It is a MEASUREMENT of what such an entry would refuse,
 * not a patch to zapo and not a claim that zapo ships one.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (dir === undefined) { console.error("usage: ladder-clientonly.mjs <bench-dir>"); process.exit(2); }
const file = join(dir, "messaging.bench.ts");
const text = readFileSync(file, "utf8");
if (text.includes("\r")) { console.error("CRLF; refusing to rewrite line endings"); process.exit(3); }
const lines = text.split("\n");

/* Remove a top-level declaration by its header, up to the next column-0 "}".
 * Any JSDoc block immediately above it goes too. */
function dropBlock(header) {
  const start = lines.findIndex((l) => l.startsWith(header));
  if (start < 0) { console.error("no block: " + header); process.exit(4); }
  let end = -1;
  for (let i = start + 1; i < lines.length; i++) { if (lines[i] === "}") { end = i; break; } }
  if (end < 0) { console.error("no terminator: " + header); process.exit(5); }
  let from = start;
  if (lines[from - 1] === " */") { while (from > 0 && !lines[from - 1].startsWith("/**")) from--; from--; }
  lines.splice(from, end - from + 1);
}

const BLOCKS = [
  "interface PairedFixture {",
  "async function bringUpPairedClient(",
  "interface ContactFixture {",
  "async function buildContacts(",
  "async function ensurePreKeyPool(",
  "interface GroupFixture {",
  "async function buildGroups(",
  "async function mainInProcess(",
];
for (const b of BLOCKS) dropBlock(b);

/* The two server-side imports. FakePeer is type-only (erased anyway) but it
 * names a server type, so it goes with the rest. */
for (const spec of ["../src/api/FakePeer", "../src/api/FakeWaServer"]) {
  const i = lines.findIndex((l) => l.includes("'" + spec + "'"));
  if (i < 0) { console.error("no import of " + spec); process.exit(6); }
  lines.splice(i, 1);
}

/* One driver left, so the flag no longer selects. */
const dispatch = lines.findIndex((l) => l.includes("const separateProcess = argSet.has('--separate-process')"));
if (dispatch < 0) { console.error("no mode dispatch"); process.exit(7); }
lines[dispatch] = "    const separateProcess = true // only driver in this entry";
/* ...and the ternary in main() that still names the driver that is gone. */
const tern = lines.findIndex((l) => l.includes("const { results, cleanup } = separateProcess"));
if (tern < 0) { console.error("no driver ternary"); process.exit(7); }
if (!lines[tern + 2].includes("mainInProcess")) { console.error("ternary not the shape expected"); process.exit(7); }
lines.splice(tern, 3, "    const { results, cleanup } = await mainSeparateProcess(config, profiler, argSet)");

const out = lines.join("\n");

/* Self-test. A patch that reports success without changing the program is
 * the failure mode this fleet keeps paying for. */
const must = { "FakeWaServer": 0, "mainInProcess": 0, "WaFakeConnectionPipeline": 0, "FakePeer": 0 };
for (const k of Object.keys(must)) {
  const n = out.split(k).length - 1;
  if (n !== must[k]) { console.error(`self-test: '${k}' appears ${n} times, expected ${must[k]}`); process.exit(8); }
}
for (const k of ["mainSeparateProcess", "ServerRpc", "scenarioSend1to1", "scenarioRecvGroup", "WaClient"]) {
  if (!out.includes(k)) { console.error(`self-test: '${k}' was removed and must not be`); process.exit(9); }
}
if (out.length >= text.length) { console.error("self-test: file did not shrink"); process.exit(10); }
writeFileSync(file, out);
console.log(`client-only entry: ${text.split("\n").length} lines -> ${lines.length} lines`);
