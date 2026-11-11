// null is a valid rejection reason; unhandled, it exits with code 1 like any other.
const p: Promise<string> = Promise.reject(null);
console.log("started", typeof p);
