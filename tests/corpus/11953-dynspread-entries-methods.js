// Iterate the result of a fixed-key spread: Object.entries, for-in, and method calls through the spread members.
function fields(f) {
  return { name: f.name, flags: f.flags, charset: f.charset };
}
function make(f, n) {
  return {
    ...fields(f),
    count: n,
    describe: function () { return this.name + ':' + this.count; },
    toJSON: function () { return { n: this.name }; },
  };
}
const r = make({ name: 'id', flags: 3, charset: 'utf8' }, 4);
console.log(JSON.stringify(Object.entries(r).map(([k, v]) => k + '=' + typeof v)));
console.log(r.describe(), JSON.stringify(r));
let keys = [];
for (const k in r) keys.push(k);
console.log(keys.join('|'));
const h = make({ name: 'z' }, 0);
console.log(h.describe(), JSON.stringify(h), Object.keys(h).join(","));
