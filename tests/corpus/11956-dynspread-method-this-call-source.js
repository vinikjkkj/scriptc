// A shorthand method reads `this` (the receiver the dyn literal builds) beside a spread whose source is a call.
function meta(f) { return { id: f.id, name: f.name }; }
function row(f) {
  return { ...meta(f), describe() { return this.name + '#' + this.id; } };
}
const r = row({ id: 4, name: 'nm' });
console.log(r.describe(), JSON.stringify(r), Object.keys(r).join(","));
