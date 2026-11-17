// No regex at all, and an engine site that the guard keeps from running.
const body: string = process.argv.length > 40 ? String(process.argv[40]) : "";
console.log("hello");
let total = 0;
for (let i = 1; i <= 10; i++) total += i * i;
console.log(total);
if (body !== "") console.log(new Function("x", body)(2));
