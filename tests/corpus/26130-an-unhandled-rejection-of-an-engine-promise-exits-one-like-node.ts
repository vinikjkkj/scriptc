// @exit: 1
// A promise created inside new Function text rejects with nobody listening:
// Node reports it and exits 1 (stderr is not compared, stdout and the exit
// code are). The call result is never awaited or stored.
const mk: any = new Function("return Promise.reject(new TypeError('boom'))");
console.log("before");
mk();
console.log("after");
