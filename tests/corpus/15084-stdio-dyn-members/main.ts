// fd, writable and a method value through the box; expandos are shared by every box of one stream.
var slot: any = process.stderr;
console.log("members", slot.fd, slot.writable);
(slot as any).note = "expando";
console.log("expando", (process.stderr as any).note === "expando");
const wf = slot.write;
wf.call(slot, "via method value\n");
try { slot.write(42); } catch (e: any) { console.log("caught", e.name, e.code); }
