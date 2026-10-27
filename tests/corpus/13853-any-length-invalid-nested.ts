// A length compound whose result is not a valid array length is Node's RangeError, and the
// array is left untouched. The read happens once; the thrown value is caught here.
const h: any = { list: [1, 2, 3] };
try {
  h.list.length -= 1.5;
} catch (e: any) {
  console.log(e.name, e.message);
}
console.log(h.list.length, JSON.stringify(h.list));
try {
  h.list.length -= 10;
} catch (e: any) {
  console.log(e.name, e.message);
}
console.log(h.list.length, JSON.stringify(h.list));
