// Timers fire in expiry order, and an expiry is the clock at the setTimeout call plus the delay. The 1 ms timer is registered first, so even after a
// 12 ms pause (a busy wait, standing in for a loaded machine) before the 5 ms timer is registered, the 1 ms one expires first and runs first.
// Node and the compiled runtime agree on this for every pause, which the injected busy wait makes a certainty instead of a race.
const order = [];
setTimeout(() => order.push("one-ms"), 1);
const end = Date.now() + 12;
while (Date.now() < end) {}
setTimeout(() => order.push("five-ms"), 5);
setTimeout(() => console.log(order.join(" ")), 60);
