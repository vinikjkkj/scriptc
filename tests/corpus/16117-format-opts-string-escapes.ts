// Quoted strings inside nested values keep Node's escaping at every depth.
import { formatWithOptions } from "node:util";

const q = { level1: { level2: { text: "it's \"quoted\"\n tab\there" } } };
console.log(formatWithOptions({ depth: 1 }, "%O", q));
console.log(formatWithOptions({ depth: null }, "%O", q));
console.log(formatWithOptions({ depth: 0 }, "%s", "plain 'string'"));
