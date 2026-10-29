// An array replacer is a PropertyList: its order is the output order, a
// repeated name is written once, a number is written as its string, and a
// name the object lacks is dropped.
const al = { a: 1, b: 2, c: { a: 5, z: 6 }, arr: [{ b: 1, a: 2 }] };
console.log(JSON.stringify(al, ["c", "a", "a", 1, "b", "missing"]));
console.log(JSON.stringify(al, ["b", "a"]));
const nums = { "1": "one", "2": "two", x: 3 };
console.log(JSON.stringify(nums, [2, 1]));
