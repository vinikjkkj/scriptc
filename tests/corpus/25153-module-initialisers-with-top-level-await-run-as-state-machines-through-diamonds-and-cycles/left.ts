import { note, tick } from "./shared.ts";
import { counter } from "./leaf.ts";

note("left:start");
export const leftTick = await tick();
note("left:end " + leftTick + " leaf " + counter);
