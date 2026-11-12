import { note, tick } from "./shared.ts";

note("leaf:start");
export const counter = await tick();
note("leaf:end " + counter);
