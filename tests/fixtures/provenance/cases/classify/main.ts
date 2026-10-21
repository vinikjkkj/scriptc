// Imports one package of each SHAPE the structural authored-JavaScript rule has
// to tell apart. Only the specifiers matter: this entry is resolved, not built.
import { TABLE } from "wamshape";
import { ROOT } from "mysqlshape";
import { PROMISE } from "mysqlshape/promise";
import { greet } from "greeter";
import { J } from "jsonly";
import { D } from "distjs";

console.log(String(TABLE.a) + String(ROOT) + String(PROMISE) + greet("x") + String(J) + String(D));
