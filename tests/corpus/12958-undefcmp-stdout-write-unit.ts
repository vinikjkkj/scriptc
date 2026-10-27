// A library call with an observable effect compared with undefined: the write happens.
console.log(process.stdout.write("v\n") !== undefined);
console.log(process.stdout.write("u\n") === null);
