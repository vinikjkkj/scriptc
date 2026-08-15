/* The LLVM tier's half of the embedded npm graph — emit-island.ts's
 * emitNpmEmbedding, row for row, in IR instead of C.
 *
 * --dynamic builds embed every reached npm module's SOURCE plus the
 * (importer, specifier) -> target resolution edges; the island's module
 * loader and its CommonJS require shim resolve exclusively from those two
 * tables, so binaries never read node_modules at runtime. The tables are
 * STATIC DATA: the engine still boots lazily on the first island entry,
 * and nothing here calls into it.
 *
 * The compression contract is the C emitter's, byte for byte: module text
 * at least NPM_COMPRESS_MIN long stores as raw DEFLATE when that shrinks
 * it, the row carries the inflated length beside the stored one, and the
 * loader inflates LAZILY through the inflater main installs. Both
 * emitters call the same deflateRawSync at the same level over the same
 * candidate test, so the two backends embed identical bytes. */
import { deflateRawSync } from "node:zlib";
import type { IrModule } from "../../ir/nodes.js";
import { NPM_COMPRESS_MIN } from "../../ir/nodes.js";

/** What the emitter has to lend: its interned NUL-terminated C-string
 * pool (module keys and edge fields are plain C strings on the runtime
 * side, exactly the currency `cstr` already mints). */
export interface IslandHost {
  cstr(text: string): string;
}

export interface NpmEmbedding {
  /** `%ScrIslandModule` / `%ScrIslandEdge` shapes — emitted ONLY for a
   * program that has an embedded graph, so every other program's module
   * prelude is unchanged to the byte. */
  typeDefs: string[];
  /** The source/facade byte arrays and the two tables. */
  defs: string[];
  nmods: number;
  nedges: number;
  /** True when some module stored compressed: main installs the inflater
   * first, and index.ts links scr_zlib.c on the same predicate
   * (moduleEmbedsCompressedNpm). */
  compressed: boolean;
}

/** LLVM `c"..."` payload for arbitrary bytes, NUL-terminated like the C
 * emitter's `static const char x[] = "..."` — `sizeof x - 1` there is the
 * stored length, which is what the table row carries. DEFLATE output is
 * binary, so this escapes on the byte and never on the code point. */
function llBytes(bytes: Buffer): string {
  let s = "";
  for (const b of bytes) {
    s +=
      b >= 0x20 && b < 0x7f && b !== 0x22 && b !== 0x5c
        ? String.fromCharCode(b)
        : `\\${b.toString(16).padStart(2, "0").toUpperCase()}`;
  }
  return `${s}\\00`;
}

export function emitNpmEmbeddingLl(host: IslandHost, mod: IrModule): NpmEmbedding | null {
  const embedded = mod.embedded;
  if (embedded === undefined || embedded.modules.length === 0) return null;

  // text -> {bytes to store, raw: 0 for plain | the inflated length}.
  // The candidate test is moduleEmbedsCompressedNpm's, by construction —
  // and it is emit-island.ts's `store` verbatim.
  const store = (text: string): { bytes: Buffer; raw: number } => {
    const plain = Buffer.from(text, "utf8");
    if (text.length < NPM_COMPRESS_MIN) return { bytes: plain, raw: 0 };
    const deflated = deflateRawSync(plain, { level: 9 });
    return deflated.length < plain.length
      ? { bytes: deflated, raw: plain.length }
      : { bytes: plain, raw: 0 };
  };
  const stored = embedded.modules.map((m) => ({
    src: store(m.source),
    esm: m.esm !== undefined ? store(m.esm) : null,
  }));

  const defs: string[] = [];
  const bytesGlobal = (name: string, bytes: Buffer, comment?: string): void => {
    defs.push(
      `@${name} = internal constant [${bytes.length + 1} x i8] c"${llBytes(bytes)}"` +
        (comment !== undefined ? ` ; ${comment}` : ""),
    );
  };
  stored.forEach((s, i) => {
    const m = embedded.modules[i]!;
    bytesGlobal(`sc_npm_src_${i}`, s.src.bytes, m.key.split("/node_modules/").pop());
    // CJS modules carry their synthesized ESM facade (default plus the
    // export names LEXED at build time): the island loader evaluates it
    // when an ES module imports the file.
    if (s.esm !== null) bytesGlobal(`sc_npm_esm_${i}`, s.esm.bytes);
  });

  const fmt = { esm: 0, cjs: 1, json: 2 } as const;
  const rows = stored.map((s, i) => {
    const m = embedded.modules[i]!;
    const facade =
      s.esm !== null
        ? `ptr @sc_npm_esm_${i}, i64 ${s.esm.bytes.length}, i64 ${s.esm.raw}`
        : `ptr null, i64 0, i64 0`;
    return (
      `%ScrIslandModule { ptr ${host.cstr(m.key)}, ptr @sc_npm_src_${i}, ` +
      `i64 ${s.src.bytes.length}, i64 ${s.src.raw}, i32 ${fmt[m.format]}, ${facade} }`
    );
  });
  defs.push(
    `@sc_npm_modules = internal constant [${rows.length} x %ScrIslandModule] [${rows.join(", ")}]`,
  );

  if (embedded.edges.length > 0) {
    // kind: 0 = any call form, 1 = import-resolved, 2 = require-resolved
    // (a dual package's condition split — the loader looks edges up with
    // its call form's kind).
    const kindOf = { any: 0, import: 1, require: 2 } as const;
    const erows = embedded.edges.map(
      (e) =>
        `%ScrIslandEdge { ptr ${host.cstr(e.from)}, ptr ${host.cstr(e.specifier)}, ` +
        `ptr ${host.cstr(e.to)}, i32 ${kindOf[e.kind]} }`,
    );
    defs.push(
      `@sc_npm_edges = internal constant [${erows.length} x %ScrIslandEdge] [${erows.join(", ")}]`,
    );
  }

  return {
    typeDefs: [
      // scr_runtime.h field for field: { key, src, len, src_raw, format,
      // esm, esm_len, esm_raw }. The `int format` sits between an i64 and
      // a pointer, so the C ABI pads it to 8 — LLVM's own struct layout
      // for a non-packed { ..., i32, ptr, ... } does exactly that, which
      // is why this is spelled as the C fields rather than as bytes.
      `%ScrIslandModule = type { ptr, ptr, i64, i64, i32, ptr, i64, i64 }`,
      // { from, spec, to, kind } — the trailing i32 pads to 32 bytes the
      // same way.
      `%ScrIslandEdge = type { ptr, ptr, ptr, i32 }`,
    ],
    defs,
    nmods: embedded.modules.length,
    nedges: embedded.edges.length,
    compressed: stored.some((s) => s.src.raw > 0 || (s.esm !== null && s.esm.raw > 0)),
  };
}
