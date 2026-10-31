// @exit: 1
// A throw escaping a timer callback while a second timer is still armed:
// Node exits 1 and drops the second timer unfired.
setTimeout(() => { throw new Error("late"); }, 5);
setTimeout(() => console.log("never"), 50);
console.log("sync");
