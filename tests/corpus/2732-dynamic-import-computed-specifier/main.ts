// import() with a specifier computed at run time: it resolves against the program's modules, and a miss rejects with Node's own errors.
import { twice } from "./lazy.ts";
const names = ["./la", "zy.ts"];
async function load(spec: string): Promise<void> {
  try {
    const ns: any = await import(spec);
    console.log("loaded", spec, ns.value, ns.twice(4));
  } catch (e) {
    const err = e as Error & { code?: string };
    console.log("rejected", err.name, err.code, err.message.split(process.cwd()).join("<cwd>").split(__dirname_of()).join("<dir>"));
  }
}
function __dirname_of(): string { return import.meta.dirname; }
console.log(twice(1));
await load(names.join(""));
await load("./missing.ts");
await load("./sub");
await load("nopkg");
