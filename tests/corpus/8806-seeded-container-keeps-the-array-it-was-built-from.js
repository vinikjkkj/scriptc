// A Map seeded with an array bound to a name holds that array: a push after the
// seed is visible through the container, even after untyped code stored a
// value of another type in it (the container is untyped, the array is not copied).
const xs = [1, 2];
const arrs = new Map([["xs", xs]]);
function put(m, k, v) { m.set(k, v); }
put(arrs, "ys", "str");
xs.push(3);
console.log(arrs.get("xs").length, arrs.get("ys"), arrs.size);
