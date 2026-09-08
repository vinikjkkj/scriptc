import { readFileSync } from "node:fs";
const keys = (f) => {
  const log = readFileSync(f, "utf8").replace(/\r/g, "");
  const re = /^(.*?):(\d+):(\d+) - error (SC\d+): (.*)$/gm;
  const out = new Set(); let m;
  while ((m = re.exec(log)) !== null) out.add(m[1].split("\\").join("/") + ":" + m[2] + ":" + m[4] + ":" + m[5]);
  return out;
};
const a = keys(process.argv[2]), b = keys(process.argv[3]);
const gone = [...a].filter((k) => !b.has(k));
const nu = [...b].filter((k) => !a.has(k));
console.log("before " + a.size + "  after " + b.size);
console.log("FIXED (in before, not after): " + gone.length);
console.log("NEW   (in after, not before): " + nu.length);
for (const k of nu.slice(0, 10)) console.log("   NEW  " + k.slice(0, 170));
