// BYTES_PER_ELEMENT on every typed-array kind, read off an instance.
const a = new Uint8Array(3);
const b = new Uint8ClampedArray(3);
const c = new Int16Array(3);
const d = new Uint16Array(3);
const e = new Int32Array(3);
const f = new Uint32Array(3);
const g = new Float32Array(3);
const h = new Float64Array(3);
const i = new Int8Array(3);
const j = new Float16Array(3);
console.log(a.BYTES_PER_ELEMENT, b.BYTES_PER_ELEMENT, c.BYTES_PER_ELEMENT, d.BYTES_PER_ELEMENT);
console.log(e.BYTES_PER_ELEMENT, f.BYTES_PER_ELEMENT, g.BYTES_PER_ELEMENT, h.BYTES_PER_ELEMENT);
console.log(i.BYTES_PER_ELEMENT, j.BYTES_PER_ELEMENT);
function make(): Float64Array {
  return h;
}
console.log(make().BYTES_PER_ELEMENT, a.BYTES_PER_ELEMENT * 10 + b.BYTES_PER_ELEMENT);
