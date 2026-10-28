// write with a callback fires on the next tick; Buffer and encoded strings write their bytes.
var slot: any = process.stdout;
slot.write("with-cb\n", (err: any) => { console.log("cb fired", err === null); });
process.stdout.write("static after cb\n");
slot.write(Buffer.from("buffer bytes\n"));
slot.write("6869210a", "hex");
console.log("sync-end");
