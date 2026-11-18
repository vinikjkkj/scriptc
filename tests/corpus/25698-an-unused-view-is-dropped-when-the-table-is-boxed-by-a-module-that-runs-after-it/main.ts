// The unused view's module runs first, the module that boxes the table (making it a view) runs after: the view's own iteration never sees a view, so it is dropped.
import "./view.ts";
import { BOXED } from "./box.ts";
import { fromJson } from "./spec.ts";
console.log(typeof BOXED, fromJson('{"alpha":{"code":9,"type":"int","defaultValue":1},"beta":{"code":8,"type":"bool","defaultValue":true},"gamma":{"code":7,"type":"string","defaultValue":"j"}}').alpha.code);
