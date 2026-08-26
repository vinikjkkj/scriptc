#!/usr/bin/env node
/* locate.mjs <sites.json> [substring-filter]
 * Renders a sites JSON with file:line:col resolved from the byte offsets
 * SrcLoc carries (file/start/end), so a refusal can be named to the line. */
import { readFileSync } from "node:fs";

const [file, filter] = process.argv.slice(2);
const j = JSON.parse(readFileSync(file, "utf8"));
const cache = new Map();
function lineOf(path, off) {
  if (path === null || off === null || off === undefined) return "?:?";
  if (!cache.has(path)) {
    try {
      cache.set(path, readFileSync(path, "utf8"));
    } catch {
      cache.set(path, null);
    }
  }
  const text = cache.get(path);
  if (text === null) return "?:?";
  let line = 1;
  let last = 0;
  for (let i = 0; i < off && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      last = i + 1;
    }
  }
  return `${line}:${off - last + 1}`;
}
const short = (p) =>
  (p ?? "")
    .replace(/^.*[/\\]lab[/\\]app[/\\]pkgs[/\\]/, "")
    .replace(/^.*250f9af[0-9a-f]*[/\\]/, "zapo-js:")
    .replace(/^.*[/\\]node_modules[/\\]/, "nm:");

for (const group of ["sites", "runtimeFences", "ice"]) {
  const rows = j[group] ?? [];
  if (rows.length === 0) continue;
  console.log(`--- ${group} (${rows.length}) ---`);
  for (const s of rows) {
    if (filter && !JSON.stringify(s).includes(filter)) continue;
    console.log(
      `${s.code}  ${short(s.file)}:${lineOf(s.file, s.start)}  ${s.message.split("\n")[0]}`,
    );
  }
}
