// import() of a JSON file: without `with { type: "json" }` it rejects ERR_IMPORT_ATTRIBUTE_MISSING; with it, it resolves { default: parsed }
// (one namespace per file); the attribute on a non-JSON module rejects ERR_IMPORT_ATTRIBUTE_TYPE_INCOMPATIBLE.
import { st } from "./state.ts";
const dir = import.meta.dirname;
const chain = (): void => { st.i++; if (st.i < 40) Promise.resolve().then(chain); };
Promise.resolve().then(chain);
try {
  await import("./d.json");
} catch (e) {
  const err = e as Error & { code?: string; url?: string };
  console.log(err.name, err.code, err.message.split(dir).join("<dir>"), (err.url ?? "-").split(dir).join("<dir>"), "at", st.i);
}
const j: any = await import("./d.json", { with: { type: "json" } });
console.log(Object.keys(j).join(), JSON.stringify(j.default), "at", st.i);
const j2: any = await import("./d.json", { with: { type: "json" } });
console.log("same namespace", j2 === j, j.default.k[1]);
const e: any = await import("./e.json", { with: { type: "json" } });
console.log(e.default.list.length, e.default.s);
try {
  await import("./c.cjs", { with: { type: "json" } });
} catch (e2) {
  const err = e2 as Error & { code?: string };
  console.log(err.name, err.code, err.message.split(dir).join("<dir>"));
}
