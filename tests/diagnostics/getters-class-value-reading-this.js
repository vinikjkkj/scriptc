import util from "node:util";
function show(v) { console.log(util.inspect(v, { showHidden: true, getters: true })); }
class Counter { n = 21; get doubled() { return this.n * 2; } }
show(JSON.parse("0") || Counter);
