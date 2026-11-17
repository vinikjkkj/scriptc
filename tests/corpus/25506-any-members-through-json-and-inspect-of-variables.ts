// JSON.stringify, util.inspect and util.format over variables whose literals hold any-typed members.
import * as util from 'node:util';
const n: any = 5;
const o: any = { deep: { deeper: { deepest: [1, 2, 3] } } };
const u: any = undefined;
const r = { n, o, u, list: [n, o] };
console.log(JSON.stringify(r));
console.log(JSON.stringify(r, null, 2));
console.log(util.inspect(r));
console.log(util.inspect(r, { depth: 0 }));
console.log(util.inspect(r, { compact: false, breakLength: 40 }));
console.log(util.format('%j %s', r, r));
