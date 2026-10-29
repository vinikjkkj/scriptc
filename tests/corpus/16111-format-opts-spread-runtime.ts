// A spread argument list packs at run time: the default depth applies, with no options.
import { formatWithOptions } from "node:util";

const words: string[] = ["%s and %s", "p", "q"];
const list: string[] = ["tail", "more"];
console.log(formatWithOptions({ colors: false }, ...words));
console.log(formatWithOptions({ colors: false }, ...list));
