class V extends String {
  constructor(format, value) { super(value); this.format = format; }
  shout() { return this.toUpperCase() + '!'; }
}
const v = new V('txt', 'hello');
console.log(v.format, v.length, String(v), v + '!', `${v}`, v.toUpperCase(), v instanceof V, v instanceof String, typeof v);
console.log(v.valueOf(), v.toString(), v == 'hello', v === 'hello', JSON.stringify(v), JSON.stringify({ v }), v.charAt(1), v.slice(1, 3), v[0], v.shout());
console.log(Object.keys(v), Object.prototype.toString.call(v), v.constructor === V, V.name);
console.log(v);
try { V('x', 'y'); } catch (e) { console.log(e.message, e instanceof TypeError); }
for (const k in v) console.log('k', k);
console.log([...v].join("-"), v.valueOf(), v.toString(), v == "hello", v === "hello", JSON.stringify(v), v.charAt(1), v.slice(1, 3), v[0], v.length);
console.log(Object.prototype.toString.call(v), Object.getPrototypeOf(v) === V.prototype, Object.getPrototypeOf(V.prototype) === String.prototype);
console.log(Object.hasOwn(v, "format"), Object.hasOwn(v, "0"), Object.hasOwn(v, "length"), "format" in v, "shout" in v);
