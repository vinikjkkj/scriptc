// The barrel re-exports VIEW, but the only importer reads VERSION: a re-export is not a read, so VIEW is not built.
import { VERSION } from "./barrel.ts";
console.log("version", VERSION);
