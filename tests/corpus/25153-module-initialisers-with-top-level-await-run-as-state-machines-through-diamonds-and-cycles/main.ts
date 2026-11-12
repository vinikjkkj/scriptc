import { leftTick } from "./left.ts";
import { rightTick } from "./right.ts";
import "./pong.ts";
import { note, tick } from "./shared.ts";

note("main:start " + leftTick + " " + rightTick);
const ps: Promise<number>[] = [tick(), tick(), tick()];
const more = await Promise.all(ps);
note("main:end " + more.join(","));
const dyn = await import("./leaf.ts");
note("main:dynamic leaf " + dyn.counter);
