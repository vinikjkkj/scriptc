// Generate API.md from the actual route handlers: parameters are extracted
// from the reqStr/str/num/bool/list/obj calls inside each handler body, so
// the doc cannot drift from the code.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/* Paths are environment-driven so the harness runs from any checkout:
 *   ZAPO_REST_APP  the app directory (default: ../app beside this file)
 *   ZAPO_REST_LAB  where the generated files go (default: the cwd)
 * They used to be absolute paths into one block's scratch directory,
 * which is why nothing but that block could run them. */
const HERE = dirname(fileURLToPath(import.meta.url));
const APP = process.env["ZAPO_REST_APP"] ?? join(HERE, "..", "app");
const LAB = process.env["ZAPO_REST_LAB"] ?? process.cwd();

const src = readFileSync(join(APP, "zapo-rest.ts"), "utf8");
const cov = JSON.parse(readFileSync(join(LAB, "coverage.json"), "utf8"));

const lines = src.split("\n");

// Slice each handler: from `if (path === "/x")` to the next `if (path ===` line.
const starts = [];
for (let i = 0; i < lines.length; i++) {
  const m = /^\s*if \(path === "([^"]+)"\)/.exec(lines[i]);
  if (m) starts.push({ path: m[1], line: i });
}
const handlers = new Map();
for (let k = 0; k < starts.length; k++) {
  const from = starts[k].line;
  const to = k + 1 < starts.length ? starts[k + 1].line : lines.length;
  const body = lines.slice(from, to).join("\n");
  if (!handlers.has(starts[k].path)) handlers.set(starts[k].path, body);
}

// Section headings from the block comments in the source.
const sectionOf = new Map();
let curSection = "service";
for (let i = 0; i < lines.length; i++) {
  const s = /^\s*\/\* ── (.+?) ─+ \*\/\s*$/.exec(lines[i]);
  if (s) curSection = s[1];
  const m = /^\s*if \(path === "([^"]+)"\)/.exec(lines[i]);
  if (m && !sectionOf.has(m[1])) sectionOf.set(m[1], curSection);
}

function paramsOf(body) {
  const out = new Map();
  const re = /\b(reqStr|str|reqNum|num|reqBool|bool|reqList|list|obj)\(p, "([^"]+)"\)/g;
  let m;
  while ((m = re.exec(body))) {
    const kind = m[1];
    const name = m[2];
    const required = kind.startsWith("req");
    const type = /Str$|^str$/.test(kind) ? "string"
      : /Num$|^num$/.test(kind) ? "number"
      : /Bool$|^bool$/.test(kind) ? "boolean"
      : /List$|^list$/.test(kind) ? "string[] (comma-separated, or a JSON array)"
      : "object (JSON)";
    // A `x(p,"k") !== undefined ? reqX(p,"k") : default` ternary is an OPTIONAL
    // parameter with a default, even though it spells reqX inside.
    const guarded =
      body.includes(`str(p, "${name}") !== undefined ?`) ||
      body.includes(`num(p, "${name}") !== undefined ?`) ||
      body.includes(`bool(p, "${name}") !== undefined ?`);
    const eff = required && !guarded;
    const prev = out.get(name);
    if (prev === undefined || (eff && !prev.required)) out.set(name, { name, type, required: eff });
  }
  if (/\binputOf\(p\)/.test(body)) {
    out.set("(body)", { name: "(whole JSON body)", type: "object — the zapo input record; or wrap it in an \"input\" member", required: true });
  }
  return [...out.values()];
}

const isWrite = (p) =>
  /^\/(connect|disconnect|logout)$/.test(p) ||
  /\/(send|set|add|remove|promote|demote|create|delete|leave|join|revoke|approve|reject|cancel|clear|block|unblock|link|unlink|transfer|submit|accept|follow|unfollow|mute|react|vote|edit|update|deactivate|publish|reconcile|share|sync|flush|request|log|change|verify|confirm|download|upload)/i.test(p);

const groups = new Map();
for (const [p, body] of handlers) {
  const sec = sectionOf.get(p) ?? "other";
  if (!groups.has(sec)) groups.set(sec, []);
  groups.get(sec).push({ path: p, params: paramsOf(body) });
}

const BASE = "http://127.0.0.1:8787";
function curlFor(path, params) {
  const write = isWrite(path);
  if (!write) {
    const q = params
      .filter((x) => x.name !== "(whole JSON body)")
      .map((x) => `${x.name}=${x.required ? "VALUE" : "OPTIONAL"}`)
      .join("&");
    return `curl -s '${BASE}${path}${q ? "?" + q : ""}' -H 'x-api-key: $ZAPO_REST_TOKEN'`;
  }
  const bodyParams = params.filter((x) => x.name !== "(whole JSON body)");
  const json =
    params.some((x) => x.name === "(whole JSON body)") && bodyParams.length === 0
      ? "{ ...the zapo input record... }"
      : "{" + bodyParams.map((x) => `"${x.name}": ${x.type.startsWith("number") ? "0" : x.type.startsWith("boolean") ? "true" : x.type.startsWith("string[]") ? '["a","b"]' : x.type.startsWith("object") ? "{}" : '"VALUE"'}`).join(", ") + "}";
  return `curl -s -X POST '${BASE}${path}' -H 'x-api-key: $ZAPO_REST_TOKEN' \\\n       -H 'content-type: application/json' -d '${json}'`;
}

const out = [];
out.push("# zapo-rest — API reference");
out.push("");
out.push("Every route answers JSON. A success is `{\"ok\":true,\"result\":...}`; a failure is");
out.push("`{\"error\":\"...\",\"detail\":\"...\"}` with an HTTP status. Both a query string and a JSON");
out.push("body are accepted on **every** route and merged into one parameter bag, so any route");
out.push("can be driven with `?name=value` alone.");
out.push("");
out.push("| status | meaning |");
out.push("|---|---|");
out.push("| 200 | the call ran |");
out.push("| 400 | a required parameter is missing, or the body is not JSON |");
out.push("| 401 | `ZAPO_REST_TOKEN` is set and the `x-api-key` header does not match |");
out.push("| 404 | no such route |");
out.push("| 500 | zapo threw (not connected, WhatsApp refused, …) — `detail` carries the message |");
out.push("| **501** | **the compiler has no static lowering for this zapo method.** `diagnostic` carries the `[SCxxxx]` code. See \"Unimplemented\" at the end. |");
out.push("");
out.push(`Routes in this build: **${handlers.size}**, covering **${cov.impl} of ${cov.impl + cov.unimpl}** public members of zapo's client surface.`);
out.push("");

let n = 0;
for (const [sec, rs] of groups) {
  out.push(`## ${sec}`);
  out.push("");
  for (const r of rs.sort((a, b) => a.path.localeCompare(b.path))) {
    n++;
    out.push(`### \`${isWrite(r.path) ? "POST" : "GET"} ${r.path}\``);
    out.push("");
    if (r.params.length === 0) {
      out.push("No parameters.");
    } else {
      out.push("| parameter | type | required |");
      out.push("|---|---|---|");
      for (const p of r.params) out.push(`| \`${p.name}\` | ${p.type} | ${p.required ? "yes" : "no"} |`);
    }
    out.push("");
    out.push("```sh");
    out.push(curlFor(r.path, r.params));
    out.push("```");
    out.push("");
  }
}

out.push("## Unimplemented, and why");
out.push("");
out.push(`${cov.unimpl} of zapo's ${cov.impl + cov.unimpl} public client members are deliberately not routed. None is`);
out.push("omitted silently — each is listed here with its reason.");
out.push("");
out.push("| zapo member | reason |");
out.push("|---|---|");
for (const u of cov.unimplemented.sort((a, b) => a.key.localeCompare(b.key))) {
  out.push(`| \`${u.key}\` | ${u.reason} |`);
}
out.push("");

writeFileSync(join(LAB, "API.md"), out.join("\n"));
console.log(`API.md written: ${n} routes documented, ${cov.unimpl} unimplemented listed`);
