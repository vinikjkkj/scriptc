// Enumerate zapo's PUBLIC surface as the type checker sees it: every member
// of WaClient, and every member of each coordinator WaClient exposes.
import ts from "typescript";
import { writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/* Paths are environment-driven so the harness runs from any checkout:
 *   ZAPO_REST_APP  the app directory (default: ../app beside this file)
 *   ZAPO_REST_LAB  where the generated files go (default: the cwd)
 * They used to be absolute paths into one block's scratch directory,
 * which is why nothing but that block could run them. */
const HERE = dirname(fileURLToPath(import.meta.url));
const LAB = process.env["ZAPO_REST_LAB"] ?? process.cwd();

const APP = process.env["ZAPO_REST_APP"] ?? join(HERE, "..", "app");
const entry = APP + "/__surface_probe.ts";
writeFileSync(
  entry,
  `import { WaClient } from "zapo-js";\nexport declare const c: WaClient;\n`,
);

const config = {
  strict: true,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  target: ts.ScriptTarget.ES2022,
  esModuleInterop: true,
  types: ["node"],
  skipLibCheck: true,
};
const program = ts.createProgram([entry], config);
const checker = program.getTypeChecker();
const sf = program.getSourceFile(entry);
if (!sf) throw new Error("no probe source file");

let clientSym;
ts.forEachChild(sf, (n) => {
  if (ts.isVariableStatement(n)) {
    const d = n.declarationList.declarations[0];
    clientSym = checker.getTypeAtLocation(d.name);
  }
});
if (!clientSym) throw new Error("no client type");

const sigText = (sym, type) => {
  const t = checker.getTypeOfSymbolAtLocation(sym, sym.valueDeclaration ?? sym.declarations?.[0] ?? sf);
  const sigs = t.getCallSignatures();
  if (sigs.length) {
    return sigs
      .map((s) => checker.signatureToString(s, undefined, ts.TypeFormatFlags.NoTruncation))
      .join(" | ");
  }
  return ": " + checker.typeToString(t, undefined, ts.TypeFormatFlags.NoTruncation);
};

const isPublic = (sym) => {
  const d = sym.declarations?.[0];
  if (!d) return true;
  const mods = ts.getCombinedModifierFlags(d);
  if (mods & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) return false;
  if (sym.name.startsWith("_")) return false;
  return true;
};

const groups = [];

// 1. WaClient's own members
const clientMembers = checker
  .getPropertiesOfType(clientSym)
  .filter(isPublic)
  .filter((s) => s.name !== "constructor");

const coordinators = [];
const own = [];
for (const m of clientMembers) {
  const t = checker.getTypeOfSymbolAtLocation(m, m.declarations?.[0] ?? sf);
  const tn = checker.typeToString(t);
  if (/Coordinator|WaAuthClient/.test(tn) && t.getCallSignatures().length === 0) {
    coordinators.push([m.name, t, tn]);
  } else {
    own.push([m.name, sigText(m)]);
  }
}
groups.push({ group: "client", type: "WaClient", members: own });

for (const [name, t, tn] of coordinators) {
  const members = checker
    .getPropertiesOfType(t)
    .filter(isPublic)
    .filter((s) => s.name !== "constructor")
    .map((s) => [s.name, sigText(s)]);
  groups.push({ group: "client." + name, type: tn, members });
}

let total = 0;
const lines = [];
for (const g of groups) {
  total += g.members.length;
  lines.push(`\n## client${g.group === "client" ? "" : "." + g.group.slice(7)}  —  ${g.type}  (${g.members.length})`);
  for (const [n, s] of g.members) lines.push(`  ${n}${s.startsWith(":") ? s : s}`);
}
lines.push(`\n=== TOTAL public members: ${total} across ${groups.length} groups ===`);
const out = lines.join("\n");
console.log(out);
writeFileSync(join(LAB, "surface.txt"), out);
rmSync(entry, { force: true });
