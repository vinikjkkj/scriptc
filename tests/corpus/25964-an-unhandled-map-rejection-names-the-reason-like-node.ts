// @exit: 1
// A rejection nobody handles, whose reason is a Map: named `#<Map>`.

console.log("before");
async function w(): Promise<void> { throw new Map<string, number>([["a", 1]]); } void w();
