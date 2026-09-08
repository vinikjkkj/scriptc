#!/usr/bin/env node
// Rehearses a release without touching the registry.
//
// Three of the release's steps can only be done by a maintainer on
// npmjs.com (claim the scope, create the Release environment, configure
// trusted publishing). Everything BEFORE those steps — that the packed
// tarballs are well formed, and that they install into a working compiler
// — is checkable offline, and this script checks it so nobody has to take
// our word for it.
//
// What it does:
//   1. builds the workspace
//   2. packs @scriptc-fork/runtime, /compiler and /scriptc
//   3. asserts each packed manifest: versions agree, no `workspace:` spec
//      survived, and the workspace deps read `npm:@scriptc-fork/<pkg>@<v>`
//   4. extracts the three tarballs into the node_modules layout npm
//      produces from those alias specs — the fork's packages sitting in
//      directories named @scriptc/runtime and @scriptc/compiler
//   5. compiles and runs a real program through the installed CLI
//
// The point of step 4 is that the whole rename rests on one property: npm
// installs an aliased dependency into a directory named after the ALIAS,
// so ~100 files that `import "@scriptc/compiler"` — and the compiler's own
// self-referencing require.resolve calls — keep resolving. This reproduces
// that layout rather than reasoning about it.
//
// SELF-TEST. A check that cannot fail proves nothing, so this script also
// runs two negative controls and refuses to report success unless BOTH of
// them fail as designed:
//   A. the packed-manifest guard, fed a synthetic manifest that still
//      carries a `workspace:` spec, must reject it
//   B. the same build, in a copy of the consumer tree where @scriptc/compiler
//      has been renamed to @scriptc-fork/compiler — the layout you would get
//      if the alias were dropped — must FAIL
// Control B is the one that matters: it rules out the failure mode where
// the build passes for some reason unrelated to the tarballs (a globally
// installed scriptc, the workspace leaking in through a parent directory).
//
// Usage:
//   node scripts/release-dry-run.mjs [--dir <path>] [--keep] [--no-build]
//
// --dir   where to build the sandbox (default: a fresh dir under os.tmpdir(),
//         which honours TMPDIR/TMP — set it if your temp is on a small disk)
// --keep  leave the sandbox in place for inspection
//
// Publishes nothing, tags nothing, and never contacts a registry.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};

const EXPECTED_STDOUT = "hello from the fork";
const PACKAGES = ["runtime", "compiler", "cli"];
// The directory name each package must occupy in a consumer's tree. For
// runtime and compiler that is the ALIAS, not the package name — which is
// the whole point of the exercise.
const CONSUMER_DIR = {
  runtime: "@scriptc/runtime",
  compiler: "@scriptc/compiler",
  cli: "@scriptc-fork/scriptc",
};

let failures = 0;
const ok = (msg) => console.log(`  ok    ${msg}`);
const bad = (msg) => {
  failures++;
  console.log(`  FAIL  ${msg}`);
};
const step = (msg) => console.log(`\n== ${msg}`);
const die = (msg) => {
  console.error(`\nrelease-dry-run: ${msg}`);
  process.exit(1);
};

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

/** spawnSync with the repo's environment, returning status + merged output.
 *
 * On win32 pnpm is a .cmd shim, which Node refuses to spawn without a
 * shell. Passing an args ARRAY alongside shell:true is what raises
 * DEP0190 — the arguments are concatenated, not escaped — so the command
 * line is built and quoted here instead. Every argument this script passes
 * is one it constructed itself; the quoting exists so a sandbox path with
 * a space in it does not silently split. */
const shellQuote = (a) => (/[\s"&|<>^%]/.test(a) ? `"${a.replaceAll('"', '\\"')}"` : a);

function run(cmd, args, { cwd = root } = {}) {
  const common = { cwd, encoding: "utf8", env: process.env, maxBuffer: 64 * 1024 * 1024 };
  const r =
    process.platform === "win32" && cmd === "pnpm"
      ? spawnSync(`pnpm ${args.map(shellQuote).join(" ")}`, { ...common, shell: true })
      : spawnSync(cmd, args, common);
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}`, error: r.error };
}

/** Extract a .tgz into destDir, stripping the leading "package/".
 *
 * BOTH paths are passed relative to cwd and slash-normalized, which is not
 * fussiness: on Windows a drive-lettered argument is read as a remote host
 * spec because of the colon (bsdtar), and GNU tar — which is what a Git
 * install puts on PATH — escapes the backslashes and then cannot find the
 * directory. Relative, slash-separated paths are unambiguous to every tar
 * on every platform. */
function untar(tarball, destDir) {
  mkdirSync(destDir, { recursive: true });
  const base = dirname(tarball);
  const dest = relative(base, destDir).replaceAll("\\", "/") || ".";
  const r = spawnSync("tar", ["-xzf", basename(tarball), "-C", dest, "--strip-components=1"], {
    cwd: base,
    encoding: "utf8",
  });
  if (r.error) die(`could not run tar (${r.error.message}); a tar binary is required`);
  if (r.status !== 0) die(`tar failed on ${basename(tarball)}:\n${r.stderr}`);
}

// ---------------------------------------------------------------------------
// The packed-manifest guard. Pure function over a manifest object so the
// self-test can feed it a synthetic one.
// ---------------------------------------------------------------------------

/** Returns an array of problems; empty means the manifest is publishable. */
export function checkPackedManifest(pkg, manifest, expectedVersion) {
  const problems = [];
  const name = manifest.name;
  if (name !== `@scriptc-fork/${pkg === "cli" ? "scriptc" : pkg}`) {
    problems.push(`name is "${name}", expected the @scriptc-fork scope`);
  }
  if (manifest.version !== expectedVersion) {
    problems.push(`version is ${manifest.version}, expected ${expectedVersion}`);
  }
  // A surviving workspace: spec means pnpm pack's rewrite did not happen.
  // The package would install and then fail to resolve its own dependency.
  for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    for (const [dep, spec] of Object.entries(manifest[field] ?? {})) {
      if (typeof spec === "string" && spec.startsWith("workspace:")) {
        problems.push(`${field}["${dep}"] is still "${spec}" — pnpm pack did not rewrite it`);
      }
    }
  }
  // The alias must survive as an npm: alias, or a consumer's tree will not
  // contain the @scriptc/* directories every import specifier needs.
  for (const [dep, want] of [
    ["@scriptc/runtime", "@scriptc-fork/runtime"],
    ["@scriptc/compiler", "@scriptc-fork/compiler"],
  ]) {
    const spec = manifest.dependencies?.[dep];
    if (spec === undefined) continue;
    if (spec !== `npm:${want}@${expectedVersion}`) {
      problems.push(`dependencies["${dep}"] is "${spec}", expected "npm:${want}@${expectedVersion}"`);
    }
  }
  if (pkg === "cli" && manifest.bin?.scriptc === undefined) {
    problems.push(`bin.scriptc is missing — the installed command would not be "scriptc"`);
  }
  return problems;
}

// ---------------------------------------------------------------------------

function main() {
  const keep = flag("--keep");
  const dir = opt("--dir");
  let sandbox;
  if (dir === undefined) sandbox = mkdtempSync(join(tmpdir(), "scriptc-dry-run-"));
  else {
    mkdirSync(dir, { recursive: true });
    sandbox = dir;
  }
  const tarballs = join(sandbox, "tarballs");
  const consumer = join(sandbox, "consumer");
  const sabotage = join(sandbox, "consumer-negative-control");

  console.log(`release-dry-run: sandbox ${sandbox}`);
  console.log("this publishes nothing and contacts no registry\n");

  const version = readJson(join(root, "packages/cli/package.json")).version;
  console.log(`version under test: ${version}`);

  const helloSource = `const msg: string = ${JSON.stringify(EXPECTED_STDOUT)};\nconsole.log(msg);\n`;
  const exeName = process.platform === "win32" ? "hello.exe" : "hello";

  // -- 1. build -------------------------------------------------------------
  if (!flag("--no-build")) {
    step("building the workspace");
    const r = run("pnpm", ["-r", "--filter", "./packages/*", "run", "build"]);
    if (r.status !== 0) die(`pnpm build failed:\n${r.out}`);
    ok("pnpm build");
  }

  // -- 1b. the workspace itself ---------------------------------------------
  // The published tarball and the workspace resolve @scriptc/compiler by two
  // DIFFERENT routes: a consumer gets a directory literally named
  // @scriptc/compiler (from the npm: alias), while the workspace gets there
  // only through the self-alias devDependency on packages/compiler. So a
  // change can break the workspace while leaving a perfectly good tarball --
  // green publish, dead local build. The artifact checks below cannot see
  // that by construction, so the workspace is exercised separately here.
  step("checking the workspace still builds programs");
  const wsDir = join(sandbox, "workspace-check");
  mkdirSync(wsDir, { recursive: true });
  writeFileSync(join(wsDir, "hello.ts"), helloSource);
  const wsExe = join(wsDir, exeName);
  const wsCli = join(root, "packages/cli/dist/main.js");
  if (!existsSync(wsCli)) die(`${wsCli} is missing - run pnpm build first`);
  const wsBuilt = run("node", [wsCli, "build", join(wsDir, "hello.ts"), "-o", wsExe], { cwd: wsDir });
  if (wsBuilt.status !== 0) {
    bad(
      "the workspace CLI could not build a trivial program.\n" +
        '        If this names "@scriptc/compiler/scriptc.d.ts", the self-alias\n' +
        "        devDependency on packages/compiler has been removed. See RELEASING.md.\n" +
        wsBuilt.out,
    );
  } else if (run(wsExe, [], { cwd: wsDir }).out.trim() !== EXPECTED_STDOUT) {
    bad("the workspace CLI produced a binary that did not print the expected line");
  } else {
    ok("the workspace CLI builds and runs a program");
  }

  // -- 2. pack --------------------------------------------------------------
  step("packing the three packages");
  mkdirSync(tarballs, { recursive: true });
  const packed = {};
  for (const pkg of PACKAGES) {
    const r = run("pnpm", ["pack", "--pack-destination", tarballs], { cwd: join(root, "packages", pkg) });
    if (r.status !== 0) die(`pnpm pack failed in packages/${pkg}:\n${r.out}`);
    const hit = readdirSync(tarballs).find((f) => f.endsWith(".tgz") && !Object.values(packed).includes(f));
    if (hit === undefined) die(`pnpm pack produced no new tarball in packages/${pkg}`);
    packed[pkg] = hit;
    ok(`packages/${pkg} -> ${hit}`);
  }

  // -- 3. assert the packed manifests ---------------------------------------
  step("checking the packed manifests");
  const manifests = {};
  for (const pkg of PACKAGES) {
    const staging = join(sandbox, "inspect", pkg);
    untar(join(tarballs, packed[pkg]), staging);
    const manifest = readJson(join(staging, "package.json"));
    manifests[pkg] = manifest;
    const problems = checkPackedManifest(pkg, manifest, version);
    if (problems.length === 0) ok(`${manifest.name}@${manifest.version}`);
    else for (const p of problems) bad(`packages/${pkg}: ${p}`);
  }

  // -- 4. assemble the layout npm would produce ------------------------------
  step("assembling the consumer tree npm would produce from those alias specs");
  const nm = join(consumer, "node_modules");
  for (const pkg of PACKAGES) {
    untar(join(tarballs, packed[pkg]), join(nm, CONSUMER_DIR[pkg]));
    ok(`node_modules/${CONSUMER_DIR[pkg]}  <- ${manifests[pkg].name}`);
  }

  // The compiler's own third-party runtime deps. A real npm install would
  // fetch these; offline we copy them out of the workspace, which is also
  // more faithful — it is the same bytes the workspace resolved.
  const from = join(root, "packages/compiler/node_modules");
  for (const dep of ["typescript", "typescript5"]) {
    if (!existsSync(join(from, dep))) die(`packages/compiler/node_modules/${dep} is missing — run pnpm install first`);
    cpSync(join(from, dep), join(nm, dep), { recursive: true, dereference: true });
  }
  // typescript@7 ships its native binary as a per-platform optional
  // dependency; only the host's is installed. Copy whichever are present.
  const pnpmDir = join(root, "node_modules/.pnpm");
  let platformPkgs = 0;
  for (const entry of existsSync(pnpmDir) ? readdirSync(pnpmDir) : []) {
    if (!entry.startsWith("@typescript+typescript-")) continue;
    const scoped = join(pnpmDir, entry, "node_modules/@typescript");
    if (!existsSync(scoped)) continue;
    for (const name of readdirSync(scoped)) {
      cpSync(join(scoped, name), join(nm, "@typescript", name), { recursive: true, dereference: true });
      platformPkgs++;
    }
  }
  if (platformPkgs === 0) die("no @typescript/typescript-<platform> package found — run pnpm install first");
  ok(`typescript, typescript5, and ${platformPkgs} platform binary package(s)`);

  // -- 5. compile and run a real program ------------------------------------
  step("compiling a program through the installed CLI");
  const entry = join(consumer, "hello.ts");
  writeFileSync(entry, `const msg: string = ${JSON.stringify(EXPECTED_STDOUT)};\nconsole.log(msg);\n`);
  const cli = join(nm, CONSUMER_DIR.cli, "dist/main.js");
  if (!existsSync(cli)) die(`${cli} is missing — the CLI tarball has no dist/`);

  const exe = join(consumer, process.platform === "win32" ? "hello.exe" : "hello");
  const built = run("node", [cli, "build", "hello.ts", "-o", exe], { cwd: consumer });
  if (built.status !== 0) {
    bad(`the installed CLI could not build a trivial program:\n${built.out}`);
  } else if (!existsSync(exe)) {
    bad(`the CLI reported success but produced no binary at ${exe}`);
  } else {
    ok("scriptc build");
    const ran = run(exe, [], { cwd: consumer });
    const got = ran.out.trim();
    if (ran.status !== 0) bad(`the binary exited ${ran.status}`);
    else if (got !== EXPECTED_STDOUT) bad(`the binary printed ${JSON.stringify(got)}, expected ${JSON.stringify(EXPECTED_STDOUT)}`);
    else ok(`the binary printed ${JSON.stringify(got)}`);
  }

  // -- 6. self-test ---------------------------------------------------------
  // Without these the script is a machine for printing "ok".
  step("self-test: the checks above must be able to fail");

  // A. the manifest guard, fed something it must reject.
  const synthetic = {
    name: "@scriptc-fork/compiler",
    version,
    dependencies: { "@scriptc/runtime": "workspace:@scriptc-fork/runtime@*" },
  };
  const caught = checkPackedManifest("compiler", synthetic, version);
  if (caught.some((p) => p.includes("did not rewrite"))) ok("control A: the manifest guard rejects a surviving workspace: spec");
  else bad("control A: the manifest guard ACCEPTED a workspace: spec — the guard is dead and step 3 proved nothing");

  // B. the same build, in the layout you would get if the alias were dropped.
  // @scriptc/compiler moves to @scriptc-fork/compiler; every import specifier
  // and the compiler's own self-reference should then fail to resolve.
  if (built.status === 0) {
    cpSync(consumer, sabotage, { recursive: true, dereference: false });
    const snm = join(sabotage, "node_modules");
    rmSync(join(sabotage, exeName), { force: true });
    mkdirSync(join(snm, "@scriptc-fork"), { recursive: true });
    renameSync(join(snm, "@scriptc/compiler"), join(snm, "@scriptc-fork/compiler"));
    const sabotaged = run("node", [cli.replace(consumer, sabotage), "build", "hello.ts", "-o", join(sabotage, "hello-nc")], { cwd: sabotage });
    if (sabotaged.status !== 0) {
      ok("control B: renaming @scriptc/compiler out of the alias layout breaks the build, as it must");
    } else {
      bad(
        "control B: the build SUCCEEDED with @scriptc/compiler renamed away.\n" +
          "        The passing run above is not caused by the tarballs — something\n" +
          "        else on this machine is supplying the compiler (a global install,\n" +
          "        or the workspace resolving through a parent directory). Treat the\n" +
          "        result above as unproven.",
      );
    }
  } else {
    bad("control B: skipped, because the real build never succeeded");
  }

  // -- 7. report ------------------------------------------------------------
  console.log();
  if (keep || failures > 0) console.log(`sandbox kept at ${sandbox}`);
  else rmSync(sandbox, { recursive: true, force: true });

  if (failures > 0) {
    console.log(`release-dry-run: ${failures} failure(s) — this release candidate is NOT ready`);
    process.exit(1);
  }
  console.log("release-dry-run: the packed tarballs install into a working compiler.");
  console.log("Still required, and only a maintainer can do them — see RELEASING.md:");
  console.log("  1. claim the @scriptc-fork scope on npmjs.com");
  console.log("  2. create the 'Release' GitHub environment in this repository");
  console.log("  3. configure trusted publishing for each of the three packages");
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
