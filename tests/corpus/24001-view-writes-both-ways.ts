// Writes through a view land on the object, writes on the object are seen through the view, and a later
// write is seen at its next read.
interface Row { id: number; name: string; tags?: string[]; score?: number }
const raw = JSON.parse('{"id":1,"name":"a","extra":true}') as unknown;
const row = raw as Row;
console.log(row.id, row.name, row.score);
row.id = 2;
row.name = "b";
row.score = 9.5;
console.log(JSON.stringify(raw));
const asAny = raw as { id: number; name: string; score?: number; fresh?: string };
asAny.name = "c";
asAny.fresh = "new";
console.log(row.name, row.score, JSON.stringify(row));
for (let i = 0; i < 3; i++) {
  asAny.id = i * 10;
  console.log(row.id);
}
row.score = undefined;
console.log(row.score, JSON.stringify(raw));
