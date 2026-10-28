// Promise.all over a Set typed Set<Promise<number>>: the static Set drain
// feeds the array form, and the payload is number[].
const s = new Set<Promise<number>>();
s.add(Promise.resolve(1));
s.add(Promise.resolve(2));
Promise.all(s).then((v) => console.log("set num", v.length, v[0]));
