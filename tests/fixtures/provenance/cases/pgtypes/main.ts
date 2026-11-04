// A package whose declaration disagrees with its JS (pg-types: `arrayParser` is declared a function with
// `any` positions while lib/arrayParser.js exports an object with `create`), and whose declaration spells
// a name the JS never exports. The value is what Node holds, not what the declaration claims.
import { getTypeParser, splitAll, parseIntArray, arrayParser } from "pgtypes";

console.log(getTypeParser(23)("42"));
console.log(typeof getTypeParser(1)(7));
console.log(parseIntArray("{1,2,3}"));
console.log(splitAll("a,b", (e) => e + "!"));
console.log(typeof arrayParser);
