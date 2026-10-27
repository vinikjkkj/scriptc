// map, filter, forEach, reduce, some, every, find, findIndex with dyn callbacks.
const xs: any[] = [1, 2, "3", 4, null, 6];
const doubled: any[] = xs.map((x: any) => (typeof x === "number" ? x * 2 : x));
console.log(doubled.join(","));
const evens: any[] = xs.filter((x: any) => typeof x === "number" && x % 2 === 0);
console.log(evens.join(","), evens.length);
let seen = 0;
xs.forEach((x: any, i: number) => {
  if (x != null) seen += i;
});
console.log(seen);
const total: any = xs.reduce((acc: any, x: any) => (typeof x === "number" ? acc + x : acc), 0);
console.log(total);
console.log(xs.some((x: any) => x === "3"), xs.every((x: any) => x != null));
console.log(xs.find((x: any) => typeof x === "string"), xs.findIndex((x: any) => x === null));
console.log(xs.find((x: any) => x === 99), xs.findIndex((x: any) => x === 99));
