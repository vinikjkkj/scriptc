/* The LLVM backend's runtime ABI guard: every `declare` of a scr_* symbol
 * the emitter produces must agree with the C prototype in scr_runtime.h —
 * parameter count, integer width, pointer-ness, return type, and
 * variadic-ness. The C backend gets this checked for free (clang
 * type-checks its calls against the header), but a .ll `declare` is taken
 * on faith by the linker, so a disagreement is silent UB that can run
 * clean under one toolchain and misbehave under another. This test kills
 * the class mechanically, from three directions:
 *
 *  1. Source scan: every fully-literal `declare ... @scr_*` template
 *     string in the backend/llvm sources is checked against the header.
 *  2. Emitted scan: a curated fs/path/os-heavy corpus slice compiles
 *     through the LLVM backend and every `declare @scr_*` in the emitted
 *     .ll — including the generic LIB_FN_SYMS path, whose signatures are
 *     derived from IR arg types per call site — is checked the same way.
 *  3. Name-existence scan: every scr_* symbol name the backend sources
 *     can EVER put in a .ll — the static string tables (LIB_FN_SYMS and
 *     friends, whose signatures only exist per call site so neither scan
 *     above sees an unexercised entry) plus every literal @scr_* template
 *     reference — must exist in the header as a prototype or an extern
 *     data symbol. This is what catches a two-string name skew (table
 *     says scr_foo_bar, runtime defines scr_foobar) at test time instead
 *     of at the user's link step.
 *
 * The header parser fails LOUDLY on any C type it cannot map so it can
 * never silently fall behind the header. */
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { compile } from "../src/index.js";
import { rcAdapters } from "../src/backend/emission/emit-types.js";
import type { IrType } from "../src/ir/nodes.js";
import { BOOL, F64, isRefCounted, STRING, RUNTIME_EMITTER_CLASS, RUNTIME_ERROR_CLASSES, RUNTIME_STREAM_CLASSES } from "../src/ir/nodes.js";

const repoRoot = join(import.meta.dirname, "../../..");
const runtimeSrcDir = join(repoRoot, "packages/runtime/src");
/* The ABI surface is the SET of runtime headers the emitted TU can
 * include — which emitter.ts spells out as `#include "scr_*.h"` lines:
 * scr_runtime.h always, plus scr_ws_global.h when the program builds a
 * global WebSocket. Checking against one file only was a real gap: the
 * C backend type-checks its ws calls against scr_ws_global.h, so nine
 * correct `declare`s in ws.ts reported as "no prototype" purely because
 * the parser could not see the header they agree with. The guard test
 * below fails if the emitter ever grows a third include. */
const HEADER_FILES = ["scr_runtime.h", "scr_ws_global.h", "scr_ws_dispatch.h"];
const llvmSrcDir = join(import.meta.dirname, "../src/backend/llvm");
const corpusDir = join(repoRoot, "tests/corpus");

/** The emitted-scan slice: in-tier programs that collectively exercise the
 * fs/path/os/crypto/fs.promises/scandir/stats surfaces — the family where
 * a declare/prototype mismatch has bitten. Small on purpose (each entry is
 * a full compile); the source scan above covers the literal declares of
 * every other surface. */
const EMIT_FIXTURES = [
  "1541-fs-readdir-dirent.ts",
  "957-builtins-namespace.ts",
  "992-fs-roundtrip.ts",
  "993-fs-readdir.ts",
  "994-fs-errors.ts",
  "996-fs-rc-stress.ts",
  "997-fs-modules/main.ts",
  "1006-json-fs-config.ts",
];

interface CProto {
  ret: string;
  params: string[];
  variadic: boolean;
}

const LL_I64_TYPES = new Set([
  "size_t", "ssize_t", "int64_t", "uint64_t", "intptr_t", "uintptr_t",
  "long", "long long", "unsigned long", "unsigned long long",
]);
const LL_I32_TYPES = new Set(["int", "int32_t", "uint32_t", "unsigned", "unsigned int"]);

interface HeaderTypes {
  enums: ReadonlySet<string>;
  ptrTypedefs: ReadonlySet<string>;
}

/** C type → the LLVM type the emitter must use for it. Throws on anything
 * unrecognized so header growth can never slip past the guard unmapped. */
function cTypeToLl(raw: string, types: HeaderTypes): string {
  const t = raw.replace(/\b(const|struct|restrict|volatile|extern|_Noreturn)\b/g, " ").replace(/\s+/g, " ").trim();
  if (t.includes("*")) return "ptr";
  if (t === "void") return "void";
  if (t === "double") return "double";
  if (t === "bool" || t === "_Bool") return "i1";
  if (t === "char" || t === "signed char" || t === "unsigned char" || t === "int8_t" || t === "uint8_t") return "i8";
  if (t === "short" || t === "unsigned short" || t === "int16_t" || t === "uint16_t") return "i16";
  if (t === "va_list") return "ptr"; // decays to a pointer in a parameter list on our targets
  if (LL_I64_TYPES.has(t)) return "i64";
  if (LL_I32_TYPES.has(t)) return "i32";
  if (types.enums.has(t)) return "i32"; // C enums are int-sized on every supported target
  if (types.ptrTypedefs.has(t)) return "ptr"; // typedef'd function pointers (ScrTraceFn, ...)
  throw new Error(`scr_runtime.h uses a C type this guard cannot map: "${raw}" — extend cTypeToLl`);
}

/** A parameter is "type [name]" — try the whole text as a type first (the
 * unnamed-parameter form), then with the trailing identifier dropped. */
function cParamToLl(param: string, types: HeaderTypes): string {
  if (param.includes("(")) return "ptr"; // function-pointer parameter
  if (param.includes("[")) return "ptr"; // array parameter — decays to a pointer
  try {
    return cTypeToLl(param, types);
  } catch {
    const m = /^(.*?)\s*[A-Za-z_][A-Za-z0-9_]*\s*$/.exec(param);
    if (m && m[1]!.trim() !== "") return cTypeToLl(m[1]!, types);
    throw new Error(`scr_runtime.h parameter this guard cannot parse: "${param}"`);
  }
}

/** Split a C parameter list on top-level commas (function-pointer
 * parameters carry nested parens). */
function splitParams(argsText: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of argsText) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim() !== "") out.push(cur.trim());
  return out;
}

/** Parse scr_runtime.h into name → prototype, plus the extern data
 * symbols (vtable globals and the like) the emitter references by name.
 * Only `;`-terminated prototypes count: a `static inline` definition has
 * no linkage symbol the emitter could declare, so a declare against one
 * must report as missing. */
async function parseHeader(): Promise<{ protos: Map<string, CProto>; dataSyms: Set<string> }> {
  const protos = new Map<string, CProto>();
  const dataSyms = new Set<string>();
  // The typedef tables are collected ACROSS the whole set first, then each
  // file is parsed with all of them in hand. They are one ABI surface: a
  // gated header uses the core's typedefs, and scr_ws_dispatch.h spells a
  // parameter `ScrWsGlobalFire` that is typedef'd in scr_ws_global.h --
  // scanned alone it reads as an unmappable type and the guard throws.
  // PROTOTYPES still parse one file at a time, which is the part that
  // matters: a concatenation would let one header's trailing text become
  // the next one's "return type".
  const shared: HeaderTypes = await collectHeaderTypes();
  for (const file of HEADER_FILES) {
    const one = await parseOneHeader(join(runtimeSrcDir, file), shared);
    for (const [k, v] of one.protos) if (!protos.has(k)) protos.set(k, v);
    for (const s of one.dataSyms) dataSyms.add(s);
  }
  return { protos, dataSyms };
}

/** Strip comments and preprocessor lines -- the shape every scan below
 * wants. */
async function headerSource(headerPath: string): Promise<string> {
  const raw = await readFile(headerPath, "utf8");
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/^[ \t]*#[^\n]*$/gm, " ");
}

/** Every enum and function-pointer typedef across the WHOLE header set.
 *
 * Collected across all of them rather than per file, because they ARE one
 * ABI surface: a gated header spells its parameters with the core's
 * typedefs. scr_ws_dispatch.h takes a `ScrWsGlobalFire`, which
 * scr_ws_global.h declares -- scanned alone it reads as an unmappable type
 * and cTypeToLl throws on EVERY test in this file. PROTOTYPES still parse
 * one file at a time, which is the part that matters: a concatenation
 * would let one header's trailing text become the next one's "return
 * type". */
async function collectHeaderTypes(): Promise<HeaderTypes> {
  const enums = new Set<string>();
  const ptrTypedefs = new Set<string>();
  for (const file of HEADER_FILES) {
    const src = await headerSource(join(runtimeSrcDir, file));
    for (const m of src.matchAll(/typedef\s+enum(?:\s+[A-Za-z_][A-Za-z0-9_]*)?\s*\{[^}]*\}\s*([A-Za-z_][A-Za-z0-9_]*)\s*;/g)) {
      enums.add(m[1]!);
    }
    for (const m of src.matchAll(/typedef\s+[^;{()]*\(\s*\*\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)\s*\(/g)) {
      ptrTypedefs.add(m[1]!);
    }
  }
  return { enums, ptrTypedefs };
}

async function parseOneHeader(
  headerPath: string,
  types: HeaderTypes,
): Promise<{ protos: Map<string, CProto>; dataSyms: Set<string> }> {
  const src = await headerSource(headerPath);
  const protos = new Map<string, CProto>();
  for (const m of src.matchAll(/\b(scr_[a-z0-9_]+)\s*\(/g)) {
    const name = m[1]!;
    // Balance parens forward from the opening one; a prototype ends `);`.
    let depth = 0;
    let end = -1;
    for (let i = m.index + m[0].length - 1; i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")" && --depth === 0) {
        end = i;
        break;
      }
    }
    if (end < 0) continue;
    const after = src.slice(end + 1).match(/^\s*(.)/);
    if (after?.[1] !== ";") continue; // a definition, macro use, or call — not a prototype
    // The return type sits between the previous declaration boundary and
    // the name; anything that doesn't look like one (a parameter list we
    // matched inside, a typedef) is skipped.
    const before = src.slice(0, m.index);
    const boundary = Math.max(before.lastIndexOf(";"), before.lastIndexOf("}"), before.lastIndexOf("{"));
    const retText = before.slice(boundary + 1).replace(/\s+/g, " ").trim();
    if (retText === "" || !/^[A-Za-z_][A-Za-z0-9_ *]*[ *]$/.test(`${retText} `)) continue;
    if (/\btypedef\b/.test(retText)) continue;
    // …and a STATEMENT KEYWORD is not a return type. `return scr_f(x);`
    // inside a `static inline` body matches everything above: the call
    // ends `);`, the boundary before it is the opening brace, and the one
    // word left is `return`, which passes the identifier-shape test. The
    // guard then read the CALL as a prototype and tried to map its
    // ARGUMENT as a C type — which is how one line of scr_dyn_fn_sig's
    // body came back as `a C type this guard cannot map: "d->v.fn."`.
    // No C declaration has any of these as its return type, so nothing
    // real is lost by skipping them, and a header is free to contain the
    // statement.
    if (/^(return|else|do|case|goto|sizeof)$/.test(retText)) continue;
    const argsText = src.slice(m.index + m[0].length, end).replace(/\s+/g, " ").trim();
    const parts = argsText === "" || argsText === "void" ? [] : splitParams(argsText);
    const variadic = parts[parts.length - 1] === "...";
    const params = (variadic ? parts.slice(0, -1) : parts).map((p) => cParamToLl(p, types));
    protos.set(name, { ret: cTypeToLl(retText, types), params, variadic });
  }
  const dataSyms = new Set<string>();
  for (const m of src.matchAll(/\bextern\s+[^;(){}]*?\b(scr_[a-z0-9_]+)\s*(?:\[[^\]]*\])?\s*;/g)) {
    dataSyms.add(m[1]!);
  }
  return { protos, dataSyms };
}

interface LlDeclare {
  ret: string;
  name: string;
  params: string[];
  variadic: boolean;
}

/** `declare zeroext i1 @scr_x(ptr, i1 zeroext, ...)` → shape (parameter
 * attributes stripped; only the type words matter for the C prototype). */
function parseDeclare(text: string): LlDeclare | undefined {
  const m = /^declare\s+(.+?)\s*@([A-Za-z0-9_$.]+)\((.*)\)$/.exec(text.trim());
  if (!m) return undefined;
  const ret = m[1]!.replace(/\b(zeroext|signext|noalias|nonnull)\b/g, " ").replace(/\s+/g, " ").trim();
  const parts = m[3]!.trim() === "" ? [] : m[3]!.split(",").map((p) =>
    p.replace(/\b(zeroext|signext|noalias|nonnull)\b/g, " ").replace(/\s+/g, " ").trim(),
  );
  const variadic = parts[parts.length - 1] === "...";
  return { ret, name: m[2]!, params: variadic ? parts.slice(0, -1) : parts, variadic };
}

function checkDeclare(d: LlDeclare, protos: Map<string, CProto>): string | undefined {
  const proto = protos.get(d.name);
  if (!proto) {
    return `${d.name}: declared by the LLVM backend but no runtime header (${HEADER_FILES.join(", ")}) has a prototype`;
  }
  const issues: string[] = [];
  if (d.ret !== proto.ret) issues.push(`return ${d.ret} vs C ${proto.ret}`);
  if (d.params.length !== proto.params.length) {
    issues.push(`${d.params.length} params vs C ${proto.params.length}`);
  } else {
    for (let i = 0; i < proto.params.length; i++) {
      if (d.params[i] !== proto.params[i]) issues.push(`param ${i} is ${d.params[i]} vs C ${proto.params[i]}`);
    }
  }
  if (d.variadic !== proto.variadic) issues.push(`variadic ${d.variadic} vs C ${proto.variadic}`);
  if (issues.length === 0) return undefined;
  return `${d.name}: ${issues.join("; ")} — declare "${d.ret} (${[...d.params, ...(d.variadic ? ["..."] : [])].join(", ")})"`;
}

describe("LLVM backend declares match scr_runtime.h prototypes", () => {
  /* HEADER_FILES is the whole ABI surface these scans check against, so a
   * header the emitted TU includes and this list omits is not a smaller
   * check — it is a check that reports every symbol in that header as
   * MISSING (which is exactly what scr_ws_global.h's nine did) or, worse
   * after someone silences those, one that stops looking. Pin the list to
   * the emitter's own include lines so the two cannot drift. */
  test("HEADER_FILES covers every runtime header the emitted TU includes", async () => {
    const emitterSrc = await readFile(
      join(repoRoot, "packages/compiler/src/backend/emission/emitter.ts"),
      "utf8",
    );
    const included = [...emitterSrc.matchAll(/#include\s+"(scr_[a-z0-9_]+\.h)"/g)].map((m) => m[1]!);
    expect(included.length).toBeGreaterThan(0); // extractor guard
    expect([...new Set(included)].sort()).toEqual([...HEADER_FILES].sort());
  });

  test("every literal declare in the backend sources", async () => {
    const { protos } = await parseHeader();
    const failures: string[] = [];
    let checked = 0;
    for (const file of await readdir(llvmSrcDir)) {
      if (!file.endsWith(".ts")) continue;
      const src = await readFile(join(llvmSrcDir, file), "utf8");
      // Fully-literal declares only: an interpolated symbol or signature is
      // per-call-site and covered by the emitted scan below.
      for (const m of src.matchAll(/declare\s+[^`$]*?@scr_[a-z0-9_]+\([^`$)]*\)/g)) {
        const d = parseDeclare(m[0]);
        if (!d) continue;
        checked++;
        const issue = checkDeclare(d, protos);
        if (issue !== undefined) failures.push(`${file}: ${issue}`);
      }
    }
    // The extractor guard: the backend sources carry well over a hundred
    // literal declares — finding almost none means the regex rotted, not
    // that the emitter went quiet.
    expect(checked).toBeGreaterThan(100);
    expect(failures).toEqual([]);
  });

  test("every scr_* name the backend sources can emit exists in the header", async () => {
    const { protos, dataSyms } = await parseHeader();
    const names = new Map<string, string>(); // name → first file seen in
    for (const file of await readdir(llvmSrcDir)) {
      if (!file.endsWith(".ts")) continue;
      const src = await readFile(join(llvmSrcDir, file), "utf8");
      // The static string tables: every double-quoted scr_* literal is a
      // symbol name some path can hand to the .ll (LIB_FN_SYMS et al.).
      for (const m of src.matchAll(/"(scr_[a-z0-9_]+)"/g)) {
        if (!names.has(m[1]!)) names.set(m[1]!, file);
      }
      // Literal @scr_* references inside template strings (declares AND
      // call sites). A reference whose name continues with `${...}` is an
      // interpolated per-type family (scr_arr_get_${suffix}) — the full
      // name only exists per suffix, so those ride the emitted scan.
      for (const m of src.matchAll(/@(scr_[a-z0-9_]+)/g)) {
        if (src.startsWith("${", m.index + m[0].length)) continue;
        if (!names.has(m[1]!)) names.set(m[1]!, file);
      }
    }
    const failures: string[] = [];
    for (const [name, file] of names) {
      if (protos.has(name) || dataSyms.has(name)) continue;
      failures.push(`${file}: ${name} — the backend can emit this symbol but no runtime header (${HEADER_FILES.join(", ")}) declares such a prototype or extern data symbol`);
    }
    // Extractor guard: the tables alone carry hundreds of names — finding
    // few means the scan rotted, not that the backend went quiet.
    expect(names.size).toBeGreaterThan(400);
    expect(failures).toEqual([]);
  });

  /* The fourth direction, and the one a differential found the hard way.
   * The generic LIB_FN_SYMS path derives its `declare` return type from
   * the IR CALL SITE's result type. That is right for every ordinary row,
   * because the IR result and the C return agree by construction. It is
   * wrong for one family: validate.ts gives an "always throws" libCall the
   * type of the expression it REPLACED (the global.undefRead pattern), so
   * the IR says `string[]` while the runtime entry says `void`. The
   * emitter then declares a value return over a void callee and reads a
   * result register the callee never set — no crash, no warning, and on
   * the first row that did it (tls.caCertsChk) five typed TypeErrors came
   * back as five throws with no name, no code and no message.
   *
   * This is LIB_FN_RET_SEXT's lesson in a second coat, and it is checkable
   * from the two tables alone: an always-throws member must not be a
   * generic row when its C entry returns void. It must be special-cased,
   * which is exactly what island.castFail and the fs `Chk` ladders are. */
  test("no always-throws libCall rides the generic path over a void runtime entry", async () => {
    const { protos } = await parseHeader();
    const emitterSrc = await readFile(join(llvmSrcDir, "emitter.ts"), "utf8");
    const table = /const LIB_FN_SYMS: Record<string, string> = \{([\s\S]*?)\n\};/.exec(emitterSrc);
    expect(table).not.toBeNull();
    const rows = [...table![1]!.matchAll(/^\s*"([^"]+)":\s*"(scr_[a-z0-9_]+)",/gm)].map(
      (m) => [m[1]!, m[2]!] as const,
    );
    // Extractor guards: the table is hundreds of rows and the list below
    // is a dozen names — finding few of either means a scan rotted.
    expect(rows.length).toBeGreaterThan(400);
    const validateSrc = await readFile(join(repoRoot, "packages/compiler/src/ir/validate.ts"), "utf8");
    const marker = validateSrc.indexOf("Always throws — the result type is the replaced expression's");
    expect(marker).toBeGreaterThan(0);
    const head = validateSrc.slice(Math.max(0, marker - 900), marker);
    const alwaysThrows = new Set([...head.matchAll(/e\.fn === "([^"]+)"/g)].map((m) => m[1]!));
    alwaysThrows.add("global.undefRead");
    expect(alwaysThrows.size).toBeGreaterThan(5);
    const failures = rows
      .filter(([fn, sym]) => alwaysThrows.has(fn) && protos.get(sym)?.ret === "void")
      .map(
        ([fn, sym]) =>
          `${fn} → ${sym}: an always-throws libCall (its IR result type is the replaced ` +
          `expression's, not void) is a GENERIC LIB_FN_SYMS row over a void runtime entry — ` +
          `the emitted declare would read a result the callee never set. Special-case it.`,
      );
    expect(failures).toEqual([]);
  });

  test("every declare emitted for the fs/path corpus slice", async () => {
    const { protos } = await parseHeader();
    const failures: string[] = [];
    const seen = new Set<string>();
    for (const fixture of EMIT_FIXTURES) {
      const outDir = await mkdtemp(join(tmpdir(), "scriptc-llvm-abi-"));
      const res = await compile(join(corpusDir, fixture), {
        outPath: join(outDir, "program"),
        outDir,
        backend: "llvm",
      });
      if (!res.ok) {
        throw new Error(
          `${fixture} left the LLVM tier (${res.diagnostics[0]?.message ?? "?"}) — swap in an in-tier fs fixture`,
        );
      }
      const ll = await readFile(res.cPath, "utf8");
      for (const line of ll.split("\n")) {
        if (!line.startsWith("declare ")) continue;
        const d = parseDeclare(line);
        if (!d || !d.name.startsWith("scr_")) continue;
        const key = line.trim();
        if (seen.has(key)) continue;
        seen.add(key);
        const issue = checkDeclare(d, protos);
        if (issue !== undefined) failures.push(`${fixture}: ${issue}`);
      }
    }
    expect(seen.size).toBeGreaterThan(50);
    expect(failures).toEqual([]);
  });

  /* Direction 4: the libCall TABLE's RETURN types.
   *
   * The generic LIB_FN_SYMS path spells its declare from the CALL SITE's
   * IR types, so a row's signature exists only where a program calls it —
   * which is why the three scans above can all pass over a wrong one. The
   * source scan sees no literal (the declare is interpolated). The
   * emitted scan sees only the rows the fs/path slice happens to reach.
   * And the name scan checks that the SYMBOL exists, not what it returns.
   *
   * That is not hypothetical. `int scr_big_cmp(const ScrBigInt *, const
   * ScrBigInt *)` sat in the table under an IR result type of f64, so the
   * emitter wrote `declare double @scr_big_cmp(ptr, ptr)` — reading xmm0
   * for a value that is returned in eax. It never linked wrong, never
   * warned, and never ran, because no bigint could reach this tier at all
   * until bigint literals joined it; the first program that got here
   * printed `-9223372036854775808n < 0n` as false.
   *
   * So this scan checks the TABLE rather than any emission: for every
   * LIB_FN_SYMS row, the C return type in the header must be one the
   * generic path can spell from an IR type (a pointer, double, bool or
   * void) — or else the row must be listed in LIB_FN_RET_SEXT with the
   * exact width the header gives it, which is the conversion path. It
   * covers every row, including the ones no fixture calls. */
  test("every LIB_FN_SYMS row returns a C type the generic path can spell", async () => {
    const { protos } = await parseHeader();
    const emitterSrc = await readFile(join(llvmSrcDir, "emitter.ts"), "utf8");
    const table = (name: string): string => {
      const at = emitterSrc.indexOf(`const ${name}`);
      expect(at, `${name} not found in emitter.ts`).toBeGreaterThan(0);
      return emitterSrc.slice(at, emitterSrc.indexOf("\n};", at));
    };
    const rows = [...table("LIB_FN_SYMS").matchAll(/^\s*"([a-zA-Z0-9_.]+)":\s*"(scr_[a-z0-9_]+)"/gm)]
      .map((m) => ({ fn: m[1]!, sym: m[2]! }));
    const widened = new Map(
      [...table("LIB_FN_RET_SEXT").matchAll(/^\s*"([a-zA-Z0-9_.]+)":\s*"(i[0-9]+)"/gm)]
        .map((m) => [m[1]!, m[2]!] as const),
    );
    // A return type the generic path derives from the IR result type. Any
    // other C return is a width the IR cannot know about.
    const SPELLABLE = new Set(["ptr", "double", "i1", "void"]);
    const failures: string[] = [];
    for (const { fn, sym } of rows) {
      const proto = protos.get(sym);
      if (proto === undefined) {
        failures.push(`${fn} -> ${sym}: no prototype in scr_runtime.h`);
        continue;
      }
      const declared = widened.get(fn);
      if (declared !== undefined) {
        if (declared !== proto.ret) {
          failures.push(`${fn} -> ${sym}: LIB_FN_RET_SEXT says ${declared}, C returns ${proto.ret}`);
        }
        continue;
      }
      if (!SPELLABLE.has(proto.ret)) {
        failures.push(
          `${fn} -> ${sym}: C returns ${proto.ret}, which the generic path cannot derive from an IR type — ` +
            `add a LIB_FN_RET_SEXT row so the call is made at the ABI's width and widened`,
        );
      }
    }
    // Every widened row must still BE a row: a stale entry would silently
    // stop applying if its symbol were renamed out of the table.
    const known = new Set(rows.map((r) => r.fn));
    for (const fn of widened.keys()) {
      if (!known.has(fn)) failures.push(`LIB_FN_RET_SEXT names ${fn}, which LIB_FN_SYMS does not`);
    }
    // Extractor guard: the table carries hundreds of rows.
    expect(rows.length).toBeGreaterThan(400);
    expect(failures).toEqual([]);
  });

  /* Direction 5: the RC adapter TABLE.
   *
   * emit-types.ts's `rcAdapters` is the one place both backends learn a
   * kind's retain/release symbols, and the LLVM tier turns each entry into
   * `declare ptr @<retain>(ptr)` / `declare void @<release>(ptr)` by
   * INTERPOLATION — so the literal-source scan above cannot see them (it
   * saw 64 of them while the tier carried its own hand-written switch, and
   * that switch was also nine kinds short). Checking the table directly is
   * both the replacement and a strict improvement: it covers every kind,
   * not just the ones some source line happened to spell out, and it is
   * what pins the assumption the derivation rests on — that EVERY runtime
   * `_v` pair really is `void *(void *)` / `void (void *)`. A pair that
   * isn't would link silently and corrupt refcounts. */
  const KIND_SAMPLES: Record<string, IrType | null> = {
    // Not refcounted: rcAdapters must answer null and each backend raises
    // its own error (emitter bug on C, `rc:` tier refusal on LLVM).
    f64: F64,
    bool: BOOL,
    void: { kind: "void" },
    undefinedT: { kind: "undefinedT" },
    nullT: { kind: "nullT" },
    procStream: { kind: "procStream" },
    // Refcounted.
    string: STRING,
    array: { kind: "array", elem: STRING },
    map: { kind: "map", key: STRING, value: STRING },
    set: { kind: "set", elem: STRING },
    regex: { kind: "regex" },
    bigint: { kind: "bigint" },
    keyobj: { kind: "keyobj" },
    hash: { kind: "hash" },
    hmac: { kind: "hmac" },
    cipher: { kind: "cipher" },
    decipher: { kind: "decipher" },
    bytes: { kind: "bytes", elem: "u8" },
    url: { kind: "url" },
    searchParams: { kind: "searchParams" },
    symbol: { kind: "symbol" },
    stats: { kind: "stats" },
    fileHandle: { kind: "fileHandle" },
    spawnRes: { kind: "spawnRes" },
    child: { kind: "child" },
    netServer: { kind: "netServer" },
    netSocket: { kind: "netSocket" },
    http2Session: { kind: "http2Session" },
    http2Stream: { kind: "http2Stream" },
    dgramSocket: { kind: "dgramSocket" },
    testCtx: { kind: "testCtx" },
    httpReq: { kind: "httpReq" },
    httpRes: { kind: "httpRes" },
    httpClientReq: { kind: "httpClientReq" },
    secureCtx: { kind: "secureCtx" },
    abortSignal: { kind: "abortSignal" },
    abortController: { kind: "abortController" },
    response: { kind: "response" },
    headers: { kind: "headers" },
    requestInit: { kind: "requestInit" },
    // A TYPE with no values: nothing constructs a ScrRequest, and the RC
    // pair exists only so the union arm and every container that could
    // hold one stay uniform. It gets a row for the same reason
    // asyncGenerator does -- the table is what forces a new kind to be
    // LOOKED at on both backends, and "nothing makes one" is a claim that
    // should be written down where the adapters are checked, not assumed.
    request: { kind: "request" },
    // A Date is the same shape of claim: nothing constructs a ScrDate,
    // the RC pair exists so record fields, union arms and Date[]
    // elements stay uniform, and the row is what forces the next
    // person to look at both backends before that changes.
    date: { kind: "date" },
    rtcPeerConnection: { kind: "rtcPeerConnection" },
    rtcDataChannel: { kind: "rtcDataChannel" },
    fsWatcher: { kind: "fsWatcher" },
    sqliteDb: { kind: "sqliteDb" },
    sqliteStmt: { kind: "sqliteStmt" },
    childStream: { kind: "childStream" },
    func: { kind: "func", params: [], ret: { kind: "void" } },
    classval: { kind: "classval", className: "C" },
    union: { kind: "union", unionId: "u0" },
    promise: { kind: "promise", inner: STRING },
    generator: { kind: "generator", yieldT: STRING, retT: STRING, nextT: STRING },
    // Same ScrGen handle and the same RC entry points as the synchronous
    // flavour: only the RESUME protocol differs (a promise over the
    // IteratorResult record instead of the record). It gets its own row
    // because it is its own IrType kind, and this table is what forces a
    // new kind to be looked at here at all.
    asyncGenerator: { kind: "asyncGenerator", yieldT: STRING, retT: STRING, nextT: STRING },
    dyn: { kind: "dyn" },
    jsval: { kind: "jsval" },
    caught: { kind: "caught" },
    // Emitted per-shape helpers, not runtime symbols.
    object: { kind: "object", className: "UserClass" },
    record: { kind: "record", shapeId: "r0" },
  };

  /** The `object` kind fans out into four rows — three runtime families
   * plus the emitted per-class helper — and only the sample above covers
   * the last one. */
  const OBJECT_ROWS: IrType[] = [
    { kind: "object", className: [...RUNTIME_ERROR_CLASSES.keys()][0]! },
    { kind: "object", className: RUNTIME_EMITTER_CLASS },
    { kind: "object", className: [...RUNTIME_STREAM_CLASSES.keys()][0]! },
  ];

  test("every IrType kind has a row in the sample table", async () => {
    // Parsed from the union itself: a new kind lands here as a failure,
    // which is the point — someone must decide whether it is refcounted
    // before the table can silently omit it on one backend only.
    const src = await readFile(join(import.meta.dirname, "../src/ir/nodes.ts"), "utf8");
    const start = src.indexOf("export type IrType =");
    const end = src.indexOf(";", src.indexOf('kind: "void"', start));
    const kinds = [...new Set(
      [...src.slice(start, end).matchAll(/\|\s*\{\s*kind:\s*"([A-Za-z0-9_]+)"/g)].map((m) => m[1]!),
    )];
    expect(kinds.length).toBeGreaterThan(40); // extractor guard
    expect([...kinds].sort()).toEqual(Object.keys(KIND_SAMPLES).sort());
  });

  /* The SAME question, asked in two places. `isRefCounted` (ir/nodes.ts)
   * gates frame tracking, retains, releases and NULL-initialized locals;
   * `rcAdapters` (emit-types.ts) names the symbols those releases call.
   * A kind the first says no to and the second answers for is a value the
   * backend knows how to free and never does — which is exactly what six
   * kinds were: bigint, keyobj, hash, hmac, cipher and decipher had
   * working adapters on both backends and no frame tracking on either, so
   * every Hash a program made leaked. The predicate cannot call the table
   * (the table is backend, the predicate is IR), so the agreement is
   * pinned here instead, over the same exhaustive sample the test above
   * keeps honest. */
  test("isRefCounted and rcAdapters agree, kind for kind", () => {
    const disagree: string[] = [];
    let checked = 0;
    for (const t of [...Object.values(KIND_SAMPLES), ...OBJECT_ROWS]) {
      if (t === null) continue;
      checked++;
      const byPredicate = isRefCounted(t);
      const byTable = rcAdapters(t) !== null;
      if (byPredicate !== byTable) {
        disagree.push(
          `${t.kind}: isRefCounted=${byPredicate} but rcAdapters=${byTable ? "a pair" : "null"}`,
        );
      }
    }
    expect(checked).toBeGreaterThan(45); // extractor guard
    expect(disagree).toEqual([]);
  });

  test("every runtime RC adapter pair matches its scr_runtime.h prototype", async () => {
    const { protos } = await parseHeader();
    const failures: string[] = [];
    let checked = 0;
    for (const t of [...Object.values(KIND_SAMPLES), ...OBJECT_ROWS]) {
      if (t === null) continue;
      const a = rcAdapters(t);
      // `emitted` pairs are defined by the program TU, not the runtime;
      // `null` means the kind carries no refcount. Neither is header ABI.
      if (a === null || a.origin === "emitted") continue;
      for (const [sym, shape] of [[a.retain, "ptr"], [a.release, "void"]] as const) {
        checked++;
        const issue = checkDeclare(
          { ret: shape, name: sym, params: ["ptr"], variadic: false },
          protos,
        );
        if (issue !== undefined) failures.push(`rcAdapters(${t.kind}): ${issue}`);
      }
    }
    // Extractor guard: ~40 refcounted kinds, two symbols each.
    expect(checked).toBeGreaterThan(70);
    expect(failures).toEqual([]);
  });
});
