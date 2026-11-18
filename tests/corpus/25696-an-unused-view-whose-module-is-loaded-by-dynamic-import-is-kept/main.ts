// The view module is started by a dynamic import (not a top-level init call), so its time is not modelled: its unused view is kept and the program prints as Node does.
import { BOXED } from "./box.ts";
import { fromJson } from "./spec.ts";
const m = await import("./view.ts");
console.log(typeof BOXED, typeof m.UNUSED_VIEW, fromJson('{"alpha":{"code":9,"type":"int","defaultValue":1},"beta":{"code":8,"type":"bool","defaultValue":true},"gamma":{"code":7,"type":"string","defaultValue":"j"}}').alpha.code);
