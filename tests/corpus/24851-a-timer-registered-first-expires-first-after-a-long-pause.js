// The mirror of 24850: the 5 ms timer is registered first and the 1 ms one only after a 12 ms busy wait, so the 5 ms timer's expiry (t + 5) is
// EARLIER than the 1 ms timer's (t + 12 + 1) and it runs first, in Node and in the compiled runtime alike. This is the order the old form of
// 15383 printed whenever a 4 ms pause happened to fall between its two setTimeout calls.
const order = [];
setTimeout(() => order.push("five-ms"), 5);
const end = Date.now() + 12;
while (Date.now() < end) {}
setTimeout(() => order.push("one-ms"), 1);
setTimeout(() => console.log(order.join(" ")), 60);
