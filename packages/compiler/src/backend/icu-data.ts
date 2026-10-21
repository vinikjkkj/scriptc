/**
 * The ICU locale data a compiled program carries (packages/runtime/src/data/icu-<ver>.bin, written by
 * scripts/gen-icu.mjs). A program links only what its literals name: this cuts the container down to the languages
 * (and the top-level resource keys, and packages) the IR asks for and writes it as a C translation unit that
 * supplies scr_ures_image(). A computed locale carries every language, still only the resource keys in use.
 *
 * Container layout (little endian): "SICU\1\0\0\0", version string, packages [name, key dictionary], locale names
 * (sorted), blocks [package index, locale index, byte length, node bytes], core records [key, value].
 * A node is [tag][varint payload length][payload]; a table payload is [varint count] then (varint key id, node)*.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { IcuUse } from "../ir/nodes.js";

interface Pkg { name: string; keys: string[] }
interface Block { pkg: number; loc: number; bytes: Buffer }
interface Image { version: string; pkgs: Pkg[]; locales: string[]; blocks: Block[]; core: [string, string][] }

function parse(buf: Buffer): Image {
  let p = 8;
  const u32 = (): number => { const v = buf.readUInt32LE(p); p += 4; return v; };
  const str = (): string => { const n = u32(); const s = buf.toString("utf8", p, p + n); p += n; return s; };
  const version = str();
  const pkgs: Pkg[] = [];
  for (let n = u32(); n > 0; n--) {
    const name = str();
    const keys: string[] = [];
    for (let k = u32(); k > 0; k--) keys.push(str());
    pkgs.push({ name, keys });
  }
  const locales: string[] = [];
  for (let n = u32(); n > 0; n--) locales.push(str());
  const blocks: Block[] = [];
  for (let n = u32(); n > 0; n--) {
    const pkg = u32(), loc = u32(), len = u32();
    blocks.push({ pkg, loc, bytes: buf.subarray(p, p + len) });
    p += len;
  }
  const core: [string, string][] = [];
  for (let n = u32(); n > 0; n--) { const k = str(); core.push([k, str()]); }
  return { version, pkgs, locales, blocks, core };
}

function varintAt(b: Buffer, p: number): [number, number] {
  let v = 0, sh = 0;
  for (;;) {
    const c = b[p++]!;
    v += (c & 0x7f) * 2 ** sh;
    if ((c & 0x80) === 0) return [v, p];
    sh += 7;
  }
}
function putVarint(n: number, out: number[]): void {
  while (n >= 0x80) { out.push((n % 128) | 0x80); n = Math.floor(n / 128); }
  out.push(n);
}

/** Keeps only the top-level entries of a bundle (a table node) whose key the predicate accepts. */
function filterTable(bytes: Buffer, keys: string[], keep: (k: string) => boolean): Buffer {
  if (bytes[0] !== 1) return bytes;
  const [plen, p1] = varintAt(bytes, 1);
  let p = p1;
  const end = p + plen;
  const [count, p2] = varintAt(bytes, p);
  p = p2;
  const entries: Buffer[] = [];
  for (let i = 0; i < count; i++) {
    const start = p;
    let id: number;
    [id, p] = varintAt(bytes, p);
    const nodeStart = p;
    const [nlen, q] = varintAt(bytes, p + 1);
    p = q + nlen;
    if (keep(keys[id]!)) entries.push(bytes.subarray(start, p));
    void nodeStart;
  }
  void end;
  const body: number[] = [];
  putVarint(entries.length, body);
  const out = [1];
  const total = body.length + entries.reduce((a, e) => a + e.length, 0);
  putVarint(total, out);
  return Buffer.concat([Buffer.from(out), Buffer.from(body), ...entries]);
}

export interface IcuSlice { image: Buffer; version: string }

/** The slice a program needs. `use.langs === null` keeps every language. */
export function sliceIcu(bin: Buffer, use: IcuUse): IcuSlice {
  const img = parse(bin);
  const all = use.langs === null || use.langs.includes("");
  const langs = new Set(use.langs ?? []);
  const nameOf = (l: number): string => img.locales[l]!;
  const langOf = (n: string): string => n.split("_")[0]!.toLowerCase();
  const byName = new Map(img.locales.map((n, i) => [n, i]));
  // the languages' bundles, then whatever they inherit from (explicit %%Parent, %%ALIAS, root)
  const wanted = new Set<number>();
  const want = (name: string): void => {
    const i = byName.get(name);
    if (i === undefined || wanted.has(i)) return;
    wanted.add(i);
  };
  for (let i = 0; i < img.locales.length; i++) {
    const n = nameOf(i);
    if (all || langs.has(langOf(n)) || n === "root") want(n);
  }
  // CLDR's parent table for names that have no bundle of their own (yue_Hans -> zh_Hans, ...)
  for (const [k, v] of img.core) {
    if (!k.startsWith("parentloc/")) continue;
    if (all || langs.has(langOf(k.slice("parentloc/".length)))) want(v);
  }
  // explicit parent / alias targets, to a fixed point
  const textOf = (b: Block, pkg: Pkg, key: string): string | null => {
    const id = pkg.keys.indexOf(key);
    if (id < 0 || b.bytes[0] !== 1) return null;
    const [, p1] = varintAt(b.bytes, 1);
    const [count, p2] = varintAt(b.bytes, p1);
    let p = p2;
    for (let i = 0; i < count; i++) {
      let kid: number;
      [kid, p] = varintAt(b.bytes, p);
      const [nlen, q] = varintAt(b.bytes, p + 1);
      if (kid === id && b.bytes[p] === 0) return b.bytes.toString("utf8", q, q + nlen);
      p = q + nlen;
    }
    return null;
  };
  for (let changed = true; changed;) {
    changed = false;
    for (const b of img.blocks) {
      if (!wanted.has(b.loc)) continue;
      for (const key of ["%%Parent", "%%ALIAS"]) {
        const t = textOf(b, img.pkgs[b.pkg]!, key);
        if (t !== null && !wanted.has(byName.get(t) ?? -1) && byName.has(t)) { want(t); changed = true; }
      }
    }
  }
  const pkgOk = (name: string): boolean => (name === "loc" ? true : name === "curr" ? use.curr : name === "unit" ? use.unit : name === "zone" ? use.zone : false);
  const locKeep = (k: string): boolean => k === "%%Parent" || k === "%%ALIAS" || (use.nf && k === "NumberElements") || (use.zone && k === "calendar");
  const blocks: Block[] = [];
  for (const b of img.blocks) {
    const pkg = img.pkgs[b.pkg]!;
    if (!wanted.has(b.loc) || !pkgOk(pkg.name)) continue;
    blocks.push({ ...b, bytes: pkg.name === "loc" ? filterTable(b.bytes, pkg.keys, locKeep) : b.bytes });
  }
  // core records: the plural rules only for the languages in play
  const coreKeep = (k: string): boolean => {
    if (k.startsWith("plural/")) return all || langs.has(langOf(k.split("/")[1]!));
    return true;
  };
  const core = img.core.filter(([k]) => coreKeep(k));
  const parts: Buffer[] = [];
  const u32 = (n: number): void => { const b = Buffer.alloc(4); b.writeUInt32LE(n); parts.push(b); };
  const str = (s: string): void => { const b = Buffer.from(s, "utf8"); u32(b.length); parts.push(b); };
  parts.push(Buffer.from("SICU\x01\x00\x00\x00"));
  str(img.version);
  u32(img.pkgs.length);
  for (const p of img.pkgs) { str(p.name); u32(p.keys.length); for (const k of p.keys) str(k); }
  u32(img.locales.length);
  for (const n of img.locales) str(n);
  u32(blocks.length);
  for (const b of blocks) { u32(b.pkg); u32(b.loc); u32(b.bytes.length); parts.push(b.bytes); }
  u32(core.length);
  for (const [k, v] of core) { str(k); str(v); }
  return { image: Buffer.concat(parts), version: img.version };
}

const cache = new Map<string, string>();

/** The C translation unit supplying scr_ures_image() for the slice. */
export function icuDataSource(rtDir: string, use: IcuUse): string {
  const key = JSON.stringify([use.langs, use.nf, use.curr, use.unit, use.zone]);
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const bin = readFileSync(join(rtDir, "data", "icu-78.2.bin"));
  const { image, version } = sliceIcu(bin, use);
  const lines: string[] = [];
  lines.push(`/* ${version}: ${use.langs === null ? "all languages" : use.langs.join(" ")} (${image.length} bytes) */`);
  lines.push("#include <stddef.h>");
  lines.push("static const unsigned char scr_icu_image_data[] =");
  const CH = 48;
  const hex = "0123456789abcdef";
  for (let i = 0; i < image.length; i += CH) {
    let s = '"';
    const end = Math.min(image.length, i + CH);
    for (let j = i; j < end; j++) s += "\\x" + hex[image[j]! >> 4] + hex[image[j]! & 15];
    lines.push(s + '"');
  }
  lines.push(";");
  lines.push("const unsigned char *scr_ures_image(size_t *len) {");
  lines.push("  *len = sizeof scr_icu_image_data - 1;");
  lines.push("  return scr_icu_image_data;");
  lines.push("}");
  const out = lines.join("\n") + "\n";
  cache.set(key, out);
  return out;
}
