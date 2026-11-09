import { value } from "./lazy.ts";
console.log("other: evaluating, lazy value is", value);
export const doubled = value * 2;
