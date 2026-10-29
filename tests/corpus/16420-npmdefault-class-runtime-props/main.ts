// A package's JS plus its .d.ts compile like typed TS BY DEFAULT: no
// --npm-static flag anywhere in this build. The class's fields are declared
// in the .d.ts, assigned by the constructor, and read through its methods.
import { Store } from "propkit";

const s = new Store("db.local", 3306);
console.log(s.endpoint(), s.host, s.port);
console.log(s.label("tcp://"), s.count);

const t = new Store("", 0);
console.log(t.endpoint(), t.count);
