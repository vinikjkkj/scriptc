import { note, tick } from "./shared.ts";
import { counter } from "./leaf.ts";

note("right:start");
export const rightTick = await tick();
note("right:end " + rightTick + " leaf " + counter);
