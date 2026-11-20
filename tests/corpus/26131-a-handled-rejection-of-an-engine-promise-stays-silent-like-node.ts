// A rejected engine promise whose caller attaches a handler is no report and
// exits 0, with the engine loop running to the end.
const mk: any = new Function("return Promise.reject(new RangeError('later'))");
const p: any = mk();
p.catch((e: any) => console.log("caught", e.name, e.message));
console.log("sync done");
