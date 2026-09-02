// Negative control: this program's output is order-INDEPENDENT (one key),
// so if the harness ever reports WRONG here the harness itself is broken;
// and the second line is a deliberate constant the oracle also prints.
interface R { a: string }
const r: R = { a: "A" }
console.log("keys=" + Object.keys(r).join(","))
console.log("sentinel=ORDER-HARNESS-ALIVE")
