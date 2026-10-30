class Holder {
  tag = "h";
}

const h = new Holder();
const table = new WeakMap<Holder, number>();
table.set(h, 7);
console.log(String(table));
console.log(`${table}`);
console.log("" + table);
console.log([table], { inner: table });
