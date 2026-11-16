// A dyn value cast to a record: the key-name tables the projection reads. Object.keys / JSON / entries over the projected record, a
// class instance projected through the same record type, and a record with keys of different lengths.
interface Wide { id: string; name: string; count: number; flag: boolean; veryLongKeyNameForTheTable: string }
class Impl { id = 'i1'; name = 'impl'; count = 3; flag = true; veryLongKeyNameForTheTable = 'long'; extra = 'x'; }
function make(s: string): unknown { return JSON.parse(s); }
const fromJson = make('{"id":"j1","name":"json","count":2,"flag":false,"veryLongKeyNameForTheTable":"L","extra":1}') as Wide;
console.log(Object.keys(fromJson).join(','));
console.log(JSON.stringify(fromJson));
console.log(JSON.stringify(Object.entries(fromJson)));
const inst: unknown = new Impl();
const fromInst = inst as Wide;
console.log(Object.keys(fromInst).join(','));
console.log(JSON.stringify(fromInst));
console.log(fromInst.veryLongKeyNameForTheTable, fromJson.veryLongKeyNameForTheTable.length);
// A record with a function-typed member projected from a class instance (the member-table lane).
interface Svc { id: number; label: string; ping: () => string }
class Impl2 { id = 7; label = 'svc'; ping(): string { return 'pong'; } }
const anyObj: unknown = new Impl2();
const svc = anyObj as Svc;
console.log(svc.id, svc.label, svc.ping());
console.log(Object.keys(svc).join(','));
// An engine value (the embedded QuickJS runs code the compiler cannot fold) projected through the key tables.
interface Ev { id: number; name: string }
const src = ['return', '{ id: a * 2, name: "eng" }'].join(' ');
const mk = new Function('a', src) as (a: number) => unknown;
const ev = mk(21) as Ev;
console.log(ev.id, ev.name);
console.log(Object.keys(ev).join(','));
console.log(JSON.stringify(ev));
