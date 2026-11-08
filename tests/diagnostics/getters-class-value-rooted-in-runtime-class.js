import util from "node:util";
import { EventEmitter } from "node:events";
function show(v) { console.log(util.inspect(v, { showHidden: true, getters: true })); }
class Bus extends EventEmitter { constructor() { super(); } }
show(JSON.parse("0") || Bus);
