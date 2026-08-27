// An import-site count is not a surface measurement. This counts both:
// how many files import a package, and how many distinct names they pull.
import fs from "node:fs";
import path from "node:path";

const ROOT = "G:/blocks/pkgstatus-lab/app/pkgs";

function walk(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") && !p.includes("__tests__")) out.push(p);
  }
  return out;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function surface(pkgDir, spec) {
  const names = new Set();
  let sites = 0;
  const named = new RegExp("import\\s*(?:type\\s*)?\\{([^}]*)\\}\\s*from\\s*['\"]" + esc(spec) + "['\"]", "g");
  const def = new RegExp("import\\s+([A-Za-z_$][\\w$]*)\\s*(?:,\\s*\\{([^}]*)\\})?\\s*from\\s*['\"]" + esc(spec) + "['\"]", "g");
  for (const f of walk(path.join(ROOT, pkgDir))) {
    const t = fs.readFileSync(f, "utf8");
    let m;
    while ((m = named.exec(t)) !== null) {
      sites++;
      for (let n of m[1].split(",")) {
        n = n.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
        if (n) names.add(n);
      }
    }
    while ((m = def.exec(t)) !== null) {
      sites++;
      names.add("default as " + m[1]);
      if (m[2]) for (let n of m[2].split(",")) {
        n = n.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
        if (n) names.add(n);
      }
    }
  }
  console.log(`${(pkgDir + " <- " + spec).padEnd(38)} import sites: ${String(sites).padStart(2)}   distinct names: ${names.size}`);
  console.log("      " + [...names].sort().join(", "));
}

surface("wam", "@vinikjkkj/wa-wam");
surface("media-utils", "sharp");
surface("media-utils", "file-type");
surface("voip", "@roamhq/wrtc");
surface("store-mongo", "mongodb");
surface("store-mysql", "mysql2/promise");
surface("store-postgres", "pg");
surface("store-redis", "ioredis");
