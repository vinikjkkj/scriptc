#!/usr/bin/env node
/* survey.mjs — what the STATIC lane does with zapo's own fake-server bench
 * suite, as a re-runnable instrument.
 *
 * Seventeen files live in zapo's `packages/fake-server/bench/`. This drives
 * `scriptc build --backend c --provenance-sources --best-effort` at each of
 * them, records how far each got, and groups every diagnostic by DISTINCT
 * CAUSE with a call-site count — because a hundred diagnostics from one
 * cause is a completely different result from a hundred causes.
 *
 * Re-run it after a compiler change and diff `survey.json`: `--baseline
 * <old.json>` prints the delta instead of just the state.
 *
 * It is an INSTRUMENT, so it self-tests. Every run compiles two probe
 * programs whose outcome is known — one that must build and run and print
 * its expected line, one that must refuse with a diagnostic — and refuses
 * to report anything if either probe disagrees. An inert instrument and a
 * true zero are otherwise indistinguishable.
 *
 * Environment (all required unless noted):
 *   FB_APP    driver project: node_modules/{zapo-js,ws,@types/node} plus a
 *             `tree/` checkout of the zapo source at the attested commit
 *   FB_SCC    path to packages/cli/dist/main.js
 *   FB_OUT    where logs, binaries and the report land
 *   FB_BENCH  bench dir relative to FB_APP (default tree/packages/fake-server/bench)
 *   FB_TIMEOUT_S  per-entry wall cap (default 1800)
 *   FB_ONLY   comma-separated entry basenames, for re-testing one row
 */

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const APP = resolve(process.env.FB_APP ?? "");
const SCC = resolve(process.env.FB_SCC ?? "");
const OUT = resolve(process.env.FB_OUT ?? "");
const BENCH = process.env.FB_BENCH ?? "tree/packages/fake-server/bench";
const TIMEOUT_S = Number(process.env.FB_TIMEOUT_S ?? 1800);
const ONLY = (process.env.FB_ONLY ?? "").split(",").filter((s) => s !== "");
const args = process.argv.slice(2);
const SELF_TEST_ONLY = args.includes("--self-test");
const BASELINE = (() => {
  const i = args.indexOf("--baseline");
  return i >= 0 ? args[i + 1] : undefined;
})();

if (APP === "" || SCC === "" || OUT === "") {
  console.error("survey.mjs: FB_APP, FB_SCC and FB_OUT must be set");
  process.exit(2);
}

/* The suite, in dependency order: the three shared modules first (every
 * bench imports at least one), then the two process/RPC helpers, then the
 * eleven scenarios, then the CommonJS launcher. */
const ENTRIES = [
  "_common.ts",
  "_fixtures.ts",
  "_store-factory.ts",
  "server-rpc.ts",
  "server-process.ts",
  "appstate.bench.ts",
  "bulk-usync.bench.ts",
  "connect-lifecycle.bench.ts",
  "group-provision.bench.ts",
  "history-sync.bench.ts",
  "media-upload.bench.ts",
  "messaging-media.bench.ts",
  "messaging.bench.ts",
  "receipts-flood.bench.ts",
  "reconnect-resume.bench.ts",
  "retry.bench.ts",
  "run-all-stores.cjs",
];

/* ── running one build ─────────────────────────────────────────────────── */

function runBuild(entryRel, outExe, logPath, opts = {}) {
  const started = Date.now();
  const argv = [
    SCC, "build", entryRel,
    "--backend", "c",
    "--provenance-sources",
    ...(opts.bestEffort === false ? [] : ["--best-effort"]),
    "-o", outExe,
  ];
  const r = spawnSync(process.execPath, argv, {
    cwd: APP,
    encoding: "utf8",
    timeout: TIMEOUT_S * 1000,
    maxBuffer: 1 << 28,
  });
  const wallMs = Date.now() - started;
  writeFileSync(
    logPath,
    `$ scriptc build ${argv.slice(1).join(" ")}\n` +
      `--- stdout ---\n${r.stdout ?? ""}\n--- stderr ---\n${r.stderr ?? ""}\n` +
      `--- exit ${r.status} signal ${r.signal} wall ${wallMs}ms ---\n`,
  );
  return {
    status: r.status,
    signal: r.signal ?? null,
    timedOut: r.error?.code === "ETIMEDOUT",
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    wallMs,
  };
}

/* ── diagnostic parsing ────────────────────────────────────────────────── */

/* `<file>:<line>:<col> - error SC1234: <message>`. The renderer wraps long
 * messages, so continuation lines (indented, not a source frame, not a
 * hint, not a new head) join the message. */
const HEAD = /^(.*?):(\d+):(\d+) - (error|warning|advice) (SC\d+): (.*)$/;

function parseDiagnostics(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = HEAD.exec(lines[i]);
    if (m === null) continue;
    let message = m[6];
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (l.trim() === "") break;
      if (/^\s*\d+ \|/.test(l) || /^\s*\|/.test(l) || /^\s*hint:/.test(l)) break;
      if (HEAD.test(l)) break;
      message += " " + l.trim();
      i = j;
    }
    out.push({
      file: m[1].trim(),
      line: Number(m[2]),
      col: Number(m[3]),
      severity: m[4],
      code: m[5],
      message: message.trim(),
    });
  }
  return out;
}

/** The source line a diagnostic points at — "the construct that provoked
 * it". Read from disk, not from the rendered frame, so a wrapped frame
 * cannot truncate it. */
const sourceCache = new Map();
function sourceLine(file, line) {
  let abs = file;
  if (!existsSync(abs)) abs = resolve(APP, file);
  if (!existsSync(abs)) return null;
  let lines = sourceCache.get(abs);
  if (lines === undefined) {
    try {
      lines = readFileSync(abs, "utf8").split(/\r?\n/);
    } catch {
      lines = [];
    }
    sourceCache.set(abs, lines);
  }
  const t = lines[line - 1];
  return t === undefined ? null : t.trim().slice(0, 200);
}

/* ── cause keys ────────────────────────────────────────────────────────── */

/* A CAUSE is the code plus the exact message: SC1090 is the compiler's
 * universal "not supported yet" with hundreds of emission sites, so its
 * code carries no information and only the message names the capability.
 *
 * A FAMILY collapses the subject out of the message ('node:inspector' vs
 * 'node:vm') so one FIX can be counted across the capabilities it covers.
 * Both are reported; the headline ranking uses the cause. */
function causeKey(d) {
  return `${d.code} :: ${d.message}`;
}
function familyKey(d) {
  const t = d.message
    .replace(/'[^']*'/g, "'<x>'")
    .replace(/"[^"]*"/g, '"<x>"')
    .replace(/`[^`]*`/g, "`<x>`")
    .replace(/\b\d+\b/g, "<n>");
  return `${d.code} :: ${t}`;
}

/* The known-owned cause: `block/prov2` is fixing two located defects —
 * mapEntryToSource strips `dist/` but not `dist/esm/`, and the bare-import
 * prescan skips type-only imports. Both surface as a `zapo-js` specifier
 * that never became a source module. Sites matching this are ranked
 * SEPARATELY so the interesting number — what blocks these benches BESIDES
 * the thing already being fixed — is visible at a glance. */
function isProvOwned(d) {
  return /\bzapo-js\b/.test(d.message);
}

/* ── stage classification ──────────────────────────────────────────────── */

/* How far a build got. The frontend refuses with SC diagnostics before any
 * C is written; a C-compiler or linker failure carries the toolchain's own
 * text and no SC head; exit 0 means a binary exists and the run is the
 * next question. */
function classifyStage(res, diags, exePath) {
  if (res.timedOut) return "timeout";
  if (res.status === 0 && existsSync(exePath)) return "built";
  if (diags.length > 0) {
    const codes = [...new Set(diags.map((d) => d.code))];
    if (codes.some((c) => c.startsWith("SC9"))) return "ice";
    if (codes.some((c) => /^SC[23]/.test(c))) return "lowering";
    return "typecheck";
  }
  const t = res.stderr + res.stdout;
  if (/lld-link|undefined (symbol|reference)|LNK\d/i.test(t)) return "link";
  if (/zig cc|clang|cc1|\.c:\d+:\d+: error/i.test(t)) return "c-compile";
  return "unknown";
}

/* ── liveness: did the file's own code reach the binary? ───────────────── */

/* A build that exits 0 is not a build that compiled the file. A module that
 * only DECLARES things — `server-rpc.ts` is 527 lines of one exported class
 * — has nothing reachable from the entry's top level, so the whole file
 * dead-code-eliminates and the emitted C is a module-init flag and an empty
 * main. That is exit 0 and a 654 KB binary containing none of the subject.
 *
 * So every "built" row also reports what is IN the C: how many functions
 * were emitted, and how many best-effort RUNTIME FENCES were planted. A
 * fence is a refusal that `--best-effort` moved off the build and into a
 * throw at the site — `scr_throw_error_msg_code(..., "SCxxxx")` in the
 * emitted C — so a binary with fences is a binary that will die on the
 * first fenced line it runs. Those are blockers too; they are just blockers
 * the exit code does not mention. */
const FENCE_RE = /scr_throw_error_msg_code\(SCR_ERR_ERROR,\s*"((?:[^"\\]|\\.)*)",\s*\d+,\s*"(SC\d+)"\)/g;

/* The emitted C is named after the ENTRY's stem, not after `-o`: the CLI
 * takes `basename(input)` for the stem and only the directory from the
 * output path. Deriving the C path from the exe name works exactly when
 * those two happen to agree, which is true for every bench entry and
 * false for every probe — which is how the self-test found this. */
function liveness(exePath, entryRel) {
  const stem = entryRel.split("/").join("\\").split("\\").pop().replace(/\.(ts|tsx|js|mjs|cjs|c|ll)$/, "");
  const cPath = join(dirname(exePath), `${stem}.c`);
  if (!existsSync(cPath)) return null;
  let c;
  try {
    c = readFileSync(cPath, "utf8");
  } catch {
    return null;
  }
  const fns = [...new Set([...c.matchAll(/^static [^\n(]*?\b(sc_f_[A-Za-z0-9_]+)\(/gm)].map((m) => m[1]))];
  const fences = [];
  FENCE_RE.lastIndex = 0;
  let m;
  while ((m = FENCE_RE.exec(c)) !== null) {
    const raw = m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\").replace(/\\n/g, " ");
    const at = /\[(SC\d+) at (.+?):(\d+)\]\s*$/.exec(raw);
    fences.push({
      code: m[2],
      message: at !== null ? raw.slice(0, at.index).trim() : raw,
      file: at?.[2] ?? null,
      line: at !== null ? Number(at[3]) : null,
    });
  }
  return {
    cBytes: c.length,
    functions: fns.length,
    fenceSites: fences.length,
    fences,
    /* init + main and nothing else: the file compiled to nothing at all. */
    dceEmpty: fns.length <= 2,
  };
}

/* ── the forced-live driver ────────────────────────────────────────────── */

/* When a file dead-code-eliminates to nothing, "it built" answers a
 * question nobody asked. The forced-live lane writes a one-line driver
 * beside the entry that imports every VALUE export and puts them in an
 * array the program prints the length of — nothing can be elided — and
 * builds that instead. THAT build says whether the file's code compiles. */
function valueExportsOf(file) {
  let t;
  try {
    t = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const typeNames = new Set(
    [...t.matchAll(/^\s*(?:export\s+)?(?:declare\s+)?(?:type|interface)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]),
  );
  const names = new Set();
  for (const m of t.matchAll(
    /^export\s+(?:declare\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:class|function|const|let|var|enum)\s+([A-Za-z_$][\w$]*)/gm,
  )) {
    names.add(m[1]);
  }
  for (const m of t.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(",")) {
      const p = part.trim();
      if (p === "" || p.startsWith("type ")) continue;
      const as = /\bas\s+([A-Za-z_$][\w$]*)\s*$/.exec(p);
      names.add(as !== null ? as[1] : p);
    }
  }
  return [...names].filter((n) => !typeNames.has(n));
}

/* ── the self test ─────────────────────────────────────────────────────── */

/* An armed control on BOTH sides. The green probe must build AND run AND
 * print its expected line; the red probe must refuse with a diagnostic. A
 * survey whose green probe fails is measuring the environment; a survey
 * whose red probe passes is not seeing diagnostics at all. */
function selfTest() {
  const probeDir = join(OUT, "selftest");
  mkdirSync(probeDir, { recursive: true });
  const green = join(APP, "__fb_probe_green.ts");
  const red = join(APP, "__fb_probe_red.ts");
  writeFileSync(
    green,
    [
      "const xs: number[] = [2, 3, 4];",
      "let acc = 1;",
      "for (const x of xs) acc *= x;",
      'console.log("FBPROBE " + String(acc));',
      "",
    ].join("\n"),
  );
  // A construct the static lane refuses by design, not by accident: the
  // inspector module can never be supported (there is no V8 to inspect).
  writeFileSync(
    red,
    ["import * as inspector from 'node:inspector/promises'", "console.log(typeof inspector)", ""].join("\n"),
  );
  const results = {};
  try {
    const gExe = join(probeDir, "green.exe");
    rmSync(gExe, { force: true });
    const g = runBuild("__fb_probe_green.ts", gExe, join(probeDir, "green.log"));
    let ran = null;
    if (g.status === 0 && existsSync(gExe)) {
      const rr = spawnSync(gExe, [], { encoding: "utf8", timeout: 60_000 });
      ran = (rr.stdout ?? "").trim();
    }
    results.green = { status: g.status, ran, ok: ran === "FBPROBE 24" };

    const rExe = join(probeDir, "red.exe");
    rmSync(rExe, { force: true });
    const rb = runBuild("__fb_probe_red.ts", rExe, join(probeDir, "red.log"));
    const rd = parseDiagnostics(rb.stderr + rb.stdout);
    results.red = {
      status: rb.status,
      diagnostics: rd.length,
      codes: [...new Set(rd.map((d) => d.code))],
      ok: rb.status !== 0 && rd.length > 0,
    };

    /* Third probe, for the LIVENESS detector: a module that only declares
     * an exported class must build (exit 0) and must come out dceEmpty —
     * otherwise the detector cannot tell a compiled file from an elided
     * one, and every "built" row it reports is unfalsifiable. */
    const inert = join(APP, "__fb_probe_inert.ts");
    writeFileSync(
      inert,
      [
        "export class OnlyDeclared {",
        "  constructor(readonly n: number) {}",
        "  double(): number { return this.n * 2 }",
        "}",
        "",
      ].join("\n"),
    );
    const iExe = join(probeDir, "inert.exe");
    rmSync(iExe, { force: true });
    const ib = runBuild("__fb_probe_inert.ts", iExe, join(probeDir, "inert.log"));
    const iLive = liveness(iExe, "__fb_probe_inert.ts");
    rmSync(inert, { force: true });
    const gLive = liveness(join(probeDir, "green.exe"), "__fb_probe_green.ts");
    results.liveness = {
      inertStatus: ib.status,
      inertFunctions: iLive?.functions ?? null,
      greenFunctions: gLive?.functions ?? null,
      ok: iLive?.dceEmpty === true && gLive !== null && gLive.dceEmpty === false,
    };

    /* And the fence counter, against a literal it must match. A fence
     * count of zero from a broken regex is indistinguishable from a
     * binary with no fences. */
    const sample =
      'scr_throw_error_msg_code(SCR_ERR_ERROR, "nope [SC1090 at C:/x/y.ts:42]", 30, "SC1090");';
    FENCE_RE.lastIndex = 0;
    results.fenceRegex = { ok: FENCE_RE.exec(sample) !== null };
  } finally {
    rmSync(green, { force: true });
    rmSync(red, { force: true });
  }
  results.ok =
    results.green.ok === true &&
    results.red.ok === true &&
    results.liveness?.ok === true &&
    results.fenceRegex?.ok === true;
  return results;
}

/* ── main ──────────────────────────────────────────────────────────────── */

function sizeOf(p) {
  try {
    return statSync(p).size;
  } catch {
    return null;
  }
}

function main() {
  mkdirSync(join(OUT, "logs"), { recursive: true });
  mkdirSync(join(OUT, "bin"), { recursive: true });

  const st = selfTest();
  console.log(
    `self-test: green=${st.green.ok ? "PASS" : "FAIL"} (${JSON.stringify(st.green.ran)}) ` +
      `red=${st.red.ok ? "PASS" : "FAIL"} (${st.red.diagnostics} diags ${st.red.codes.join(",")})`,
  );
  if (!st.ok) {
    console.error("survey.mjs: SELF-TEST FAILED — the instrument is not armed; refusing to report.");
    writeFileSync(join(OUT, "survey.json"), JSON.stringify({ selfTest: st, aborted: true }, null, 2));
    return 3;
  }
  if (SELF_TEST_ONLY) return 0;

  const appSlash = APP.replace(/\\/g, "/") + "/";
  const rows = [];
  for (const entry of ENTRIES) {
    if (ONLY.length > 0 && !ONLY.includes(entry)) continue;
    const rel = `${BENCH}/${entry}`;
    if (!existsSync(join(APP, rel))) {
      rows.push({ entry, stage: "missing", diagCount: 0, diagnostics: [], notes: [] });
      continue;
    }
    const stem = entry.replace(/\.(bench\.)?(ts|cjs|mjs|js)$/, "");
    const exe = join(OUT, "bin", `${stem}.exe`);
    rmSync(exe, { force: true });
    process.stdout.write(`building ${entry} ... `);
    const res = runBuild(rel, exe, join(OUT, "logs", `${stem}.log`));
    const diags = parseDiagnostics(res.stderr + res.stdout).map((d) => ({
      ...d,
      source: sourceLine(d.file, d.line),
      file: d.file.replace(/\\/g, "/").replace(appSlash, ""),
    }));
    const stage = classifyStage(res, diags, exe);

    /* Provenance notes are printed by the pipeline: which packages fell
     * back to the island path and why. Not diagnostics, but the cause of
     * most of the diagnostics that follow. */
    const notes = [
      ...new Set(
        (res.stderr + res.stdout)
          .split(/\r?\n/)
          .filter((l) => /island path used|no source mapping|not installed under|provenance/i.test(l))
          .map((l) => l.trim()),
      ),
    ];

    const live = liveness(exe, rel);

    let ran = null;
    if (stage === "built") {
      const rr = spawnSync(exe, [], { encoding: "utf8", timeout: 300_000 });
      ran = {
        status: rr.status,
        signal: rr.signal ?? null,
        stdoutHead: (rr.stdout ?? "").split(/\r?\n/).slice(0, 25).join("\n"),
        stderrHead: (rr.stderr ?? "").split(/\r?\n/).slice(0, 25).join("\n"),
      };
    }

    /* Lane B — the same entry WITHOUT `--best-effort`. Every refusal that
     * best-effort moved into a runtime fence comes back as a build error
     * here, so the two lanes together separate "the compiler refuses this"
     * from "the compiler defers this to a throw". */
    const strictExe = join(OUT, "bin", `${stem}.strict.exe`);
    rmSync(strictExe, { force: true });
    const strictRes = runBuild(rel, strictExe, join(OUT, "logs", `${stem}.strict.log`), { bestEffort: false });
    const strictDiags = parseDiagnostics(strictRes.stderr + strictRes.stdout).map((d) => ({
      ...d,
      source: sourceLine(d.file, d.line),
      file: d.file.replace(/\\/g, "/").replace(appSlash, ""),
    }));

    /* Lane C — forced live, but only where lane A produced a binary with
     * nothing in it. Anywhere else it would measure the same thing twice. */
    let forcedLive = null;
    if (stage === "built" && live?.dceEmpty === true) {
      const exports = valueExportsOf(join(APP, rel));
      if (exports.length > 0) {
        const drvName = `__fb_live_${stem.replace(/[^\w]/g, "_")}.ts`;
        const drv = join(APP, drvName);
        const relImport = "./" + `${BENCH}/${entry}`.replace(/\.(ts|cjs|mjs)$/, "").replace(/\\/g, "/");
        writeFileSync(
          drv,
          [
            `import { ${exports.join(", ")} } from '${relImport}'`,
            `const kept: unknown[] = [${exports.join(", ")}]`,
            `console.log('FBLIVE ' + String(kept.length))`,
            "",
          ].join("\n"),
        );
        const lExe = join(OUT, "bin", `${stem}.live.exe`);
        rmSync(lExe, { force: true });
        const lRes = runBuild(drvName, lExe, join(OUT, "logs", `${stem}.live.log`));
        const lDiags = parseDiagnostics(lRes.stderr + lRes.stdout).map((d) => ({
          ...d,
          source: sourceLine(d.file, d.line),
          file: d.file.replace(/\\/g, "/").replace(appSlash, ""),
        }));
        rmSync(drv, { force: true });
        forcedLive = {
          exports,
          exit: lRes.status,
          stage: classifyStage(lRes, lDiags, lExe),
          diagCount: lDiags.length,
          diagnostics: lDiags,
          liveness: liveness(lExe, drvName),
        };
      }
    }

    rows.push({
      entry,
      stage,
      exit: res.status,
      wallMs: res.wallMs,
      diagCount: diags.length,
      causeCount: new Set(diags.map(causeKey)).size,
      diagnostics: diags,
      notes,
      ran,
      exeBytes: sizeOf(exe),
      liveness: live,
      strict: {
        exit: strictRes.status,
        stage: classifyStage(strictRes, strictDiags, strictExe),
        diagCount: strictDiags.length,
        diagnostics: strictDiags,
        wallMs: strictRes.wallMs,
      },
      forcedLive,
    });
    console.log(
      `${stage} (exit ${res.status}, ${diags.length} diags, ${(res.wallMs / 1000).toFixed(1)}s)` +
        (live !== null ? ` | C ${live.cBytes}B ${live.functions} fn ${live.fenceSites} fences${live.dceEmpty ? " DCE-EMPTY" : ""}` : "") +
        ` | strict ${strictRes.status}/${strictDiags.length}` +
        (forcedLive !== null ? ` | live ${forcedLive.stage}/${forcedLive.diagCount}` : ""),
    );
  }

  const report = {
    generatedAt: new Date().toISOString(),
    app: APP,
    scc: SCC,
    bench: BENCH,
    selfTest: st,
    rows,
  };
  report.causes = rankCauses(rows, (r) => r.diagnostics ?? []);
  report.causesStrict = rankCauses(rows, (r) => r.strict?.diagnostics ?? []);
  report.causesForcedLive = rankCauses(rows, (r) => r.forcedLive?.diagnostics ?? []);
  /* Fences are refusals too — the ones `--best-effort` moved into a throw.
   * They never appear in a diagnostic count, so they get their own census
   * or a "built" row silently under-reports its own blockers. */
  report.fences = rankFences(rows);
  writeFileSync(join(OUT, "survey.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(OUT, "SURVEY.md"), renderMarkdown(report, BASELINE));
  console.log(`\nwrote ${join(OUT, "survey.json")} and ${join(OUT, "SURVEY.md")}`);
  return 0;
}

function rankFences(rows) {
  const m = new Map();
  for (const r of rows) {
    for (const f of r.liveness?.fences ?? []) {
      const k = `${f.code} :: ${f.message}`;
      let e = m.get(k);
      if (e === undefined) {
        e = { key: k, code: f.code, message: f.message, sites: 0, entries: new Set(), examples: [] };
        m.set(k, e);
      }
      e.sites++;
      e.entries.add(r.entry);
      if (e.examples.length < 4) e.examples.push({ file: f.file, line: f.line });
    }
    for (const f of r.forcedLive?.liveness?.fences ?? []) {
      const k = `${f.code} :: ${f.message}`;
      let e = m.get(k);
      if (e === undefined) {
        e = { key: k, code: f.code, message: f.message, sites: 0, entries: new Set(), examples: [] };
        m.set(k, e);
      }
      e.sites++;
      e.entries.add(`${r.entry} (forced-live)`);
      if (e.examples.length < 4) e.examples.push({ file: f.file, line: f.line });
    }
  }
  return [...m.values()]
    .map((e) => ({ ...e, entries: [...e.entries].sort() }))
    .sort((a, b) => b.sites - a.sites || a.key.localeCompare(b.key));
}

function rankCauses(rows, select) {
  const byCause = new Map();
  const byFamily = new Map();
  for (const r of rows) {
    for (const d of select(r)) {
      const ck = causeKey(d);
      let c = byCause.get(ck);
      if (c === undefined) {
        c = {
          key: ck,
          code: d.code,
          message: d.message,
          sites: 0,
          entries: new Set(),
          examples: [],
          provOwned: isProvOwned(d),
        };
        byCause.set(ck, c);
      }
      c.sites++;
      c.entries.add(r.entry);
      if (c.examples.length < 4) c.examples.push({ file: d.file, line: d.line, source: d.source });

      const fk = familyKey(d);
      let f = byFamily.get(fk);
      if (f === undefined) {
        f = { key: fk, code: d.code, sites: 0, causes: new Set(), entries: new Set(), provOwned: true };
        byFamily.set(fk, f);
      }
      f.sites++;
      f.causes.add(ck);
      f.entries.add(r.entry);
      if (!isProvOwned(d)) f.provOwned = false;
    }
  }
  const fin = (m) =>
    [...m.values()]
      .map((c) => ({
        ...c,
        entries: [...c.entries].sort(),
        ...(c.causes !== undefined ? { causes: [...c.causes] } : {}),
      }))
      .sort((a, b) => b.sites - a.sites || a.key.localeCompare(b.key));
  return { byCause: fin(byCause), byFamily: fin(byFamily) };
}

function renderMarkdown(report, baselinePath) {
  const L = [];
  L.push("# The static lane against zapo's fake-server bench suite");
  L.push("");
  L.push(`generated ${report.generatedAt} — app \`${report.app}\``);
  L.push("");
  L.push(
    `self-test: green ${report.selfTest.green.ok ? "PASS" : "FAIL"}, red ${report.selfTest.red.ok ? "PASS" : "FAIL"}`,
  );
  L.push("");
  L.push("## The seventeen");
  L.push("");
  L.push("| entry | stage | exit | diags | causes | emitted C | fns | fences | live? | strict diags | wall |");
  L.push("|---|---|---:|---:|---:|---:|---:|---:|---|---:|---:|");
  for (const r of report.rows) {
    const lv = r.liveness;
    const liveMark =
      lv === null || lv === undefined ? "—" : lv.dceEmpty ? "**DCE-EMPTY**" : "yes";
    L.push(
      `| \`${r.entry}\` | **${r.stage}** | ${r.exit ?? ""} | ${r.diagCount ?? 0} | ${r.causeCount ?? 0} | ` +
        `${lv?.cBytes ?? "—"} | ${lv?.functions ?? "—"} | ${lv?.fenceSites ?? "—"} | ${liveMark} | ` +
        `${r.strict?.diagCount ?? "—"} | ${((r.wallMs ?? 0) / 1000).toFixed(1)}s |`,
    );
  }
  const fl = report.rows.filter((r) => r.forcedLive !== null && r.forcedLive !== undefined);
  if (fl.length > 0) {
    L.push("");
    L.push("### Forced-live lane (a driver that references every value export)");
    L.push("");
    L.push("| entry | exports forced | stage | diags | emitted C | fns |");
    L.push("|---|---:|---|---:|---:|---:|");
    for (const r of fl) {
      L.push(
        `| \`${r.entry}\` | ${r.forcedLive.exports.length} | **${r.forcedLive.stage}** | ${r.forcedLive.diagCount} | ` +
          `${r.forcedLive.liveness?.cBytes ?? "—"} | ${r.forcedLive.liveness?.functions ?? "—"} |`,
      );
    }
  }
  L.push("");
  const total = report.causes.byCause.reduce((a, c) => a + c.sites, 0);
  const owned = report.causes.byCause.filter((c) => c.provOwned).reduce((a, c) => a + c.sites, 0);
  L.push(`## Ranked causes — ${total} sites, ${report.causes.byCause.length} distinct causes`);
  L.push("");
  L.push(
    `\`zapo-js\`-attributed (owned by \`block/prov2\`): **${owned}** sites. Everything else: **${total - owned}**.`,
  );
  L.push("");
  L.push("| # | sites | files | owned | code | cause |");
  L.push("|---:|---:|---:|---|---|---|");
  report.causes.byCause.forEach((c, i) => {
    L.push(
      `| ${i + 1} | ${c.sites} | ${c.entries.length} | ${c.provOwned ? "prov2" : ""} | ${c.code} | ${c.message.replace(/\|/g, "\\|").slice(0, 240)} |`,
    );
  });
  L.push("");
  L.push("## Families (subject collapsed — one FIX per row)");
  L.push("");
  L.push("| # | sites | causes | files | code | family |");
  L.push("|---:|---:|---:|---:|---|---|");
  report.causes.byFamily.forEach((f, i) => {
    L.push(
      `| ${i + 1} | ${f.sites} | ${f.causes.length} | ${f.entries.length} | ${f.code} | ${f.key.split(" :: ")[1].replace(/\|/g, "\\|").slice(0, 240)} |`,
    );
  });
  if (report.fences.length > 0) {
    L.push("");
    L.push("## Runtime fences — refusals `--best-effort` moved into a throw");
    L.push("");
    L.push("| # | sites | files | code | fenced construct |");
    L.push("|---:|---:|---:|---|---|");
    report.fences.forEach((f, i) => {
      L.push(
        `| ${i + 1} | ${f.sites} | ${f.entries.length} | ${f.code} | ${f.message.replace(/\|/g, "\\|").slice(0, 240)} |`,
      );
    });
  }
  const strictTotal = report.causesStrict.byCause.reduce((a, c) => a + c.sites, 0);
  L.push("");
  L.push(`## Without \`--best-effort\`: ${strictTotal} sites, ${report.causesStrict.byCause.length} distinct causes`);
  L.push("");
  L.push(
    strictTotal === total
      ? "Identical to the best-effort lane — every refusal here is a hard fence, not a deferrable one."
      : "Different from the best-effort lane; the extra rows are what best-effort defers.",
  );
  if (baselinePath !== undefined && existsSync(baselinePath)) {
    const base = JSON.parse(readFileSync(baselinePath, "utf8"));
    L.push("");
    L.push(`## Delta against ${basename(baselinePath)}`);
    L.push("");
    L.push("| entry | stage before | stage now | diags before | diags now |");
    L.push("|---|---|---|---:|---:|");
    const prev = new Map((base.rows ?? []).map((r) => [r.entry, r]));
    for (const r of report.rows) {
      const p = prev.get(r.entry);
      L.push(`| \`${r.entry}\` | ${p?.stage ?? "—"} | ${r.stage} | ${p?.diagCount ?? "—"} | ${r.diagCount ?? 0} |`);
    }
  }
  L.push("");
  return L.join("\n");
}

process.exitCode = main();
