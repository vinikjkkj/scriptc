// The module that boxes the table runs first, so the view module iterates a table that is already a view: the view is kept.
import { BOXED } from "./box.ts";
import "./view.ts";
import { fromJson } from "./spec.ts";
console.log(typeof BOXED, fromJson('{"alpha":{"code":9,"type":"int","defaultValue":1},"beta":{"code":8,"type":"bool","defaultValue":true},"gamma":{"code":7,"type":"string","defaultValue":"j"}}').alpha.code);
