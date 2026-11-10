// import(`./${x}`): a context with a bare `./` prefix names every module under the directory; a name that is a missing file or a directory rejects with Node's own errors.
import { twice } from "./lazy.ts";
async function load(spec: string): Promise<void> {
  try {
    const ns: any = await import(`./${spec}`);
    console.log("loaded", spec, ns.value, ns.twice(4));
  } catch (e) {
    const err = e as Error & { code?: string };
    console.log("rejected", err.name, err.code, err.message.split(__dirname_of()).join("<dir>"), (err as { url?: string }).url?.split(__dirname_of()).join("<dir>"));
  }
}
function __dirname_of(): string { return import.meta.dirname; }
console.log(twice(1));
await load("lazy.ts");
await load("missing.ts");
await load("sub");
