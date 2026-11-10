// A Node builtin reached through `await import()`: the binding is the module namespace for member calls and reads, and the await resumes on Node's job.
import { st } from "./state.ts";
const chain = (): void => { st.i++; if (st.i < 40) Promise.resolve().then(chain); };
Promise.resolve().then(chain);
const p = await import("node:path");
console.log("path resumed at", st.i, p.join("a", "b"), p.sep, p.basename("/x/y.txt", ".txt"));
const fs = await import("fs");
console.log("fs resumed at", st.i, fs.existsSync("/definitely/not/here"), typeof fs.readFileSync === "function");
