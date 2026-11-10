// A module with top-level await settles its import() two jobs later than the same module without one.
import { st } from "./state.ts";
const chain = (): void => { st.i++; if (st.i < 60) Promise.resolve().then(chain); };
Promise.resolve().then(chain);
import("./plain.ts").then(() => console.log("plain settled at", st.i));
import("./tla.ts").then(() => console.log("tla settled at", st.i));
