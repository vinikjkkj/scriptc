// A typed record crosses into a dynamic value once per message here, with the SAME participant strings in every crossing: the string leaves of the conversions share one box
// per string. Nothing the program can observe may change: strings compare by value, Object.is is by value, Map and Set keys are by value, an edit of one tree's field replaces
// that tree's slot and never another tree's, and the JSON and inspect text is the text.
interface Member { jid: string; role: string; note: string; seq: number }
interface Group { id: string; members: Member[] }

function viaDyn(x: unknown): any {
  return x;
}

const jids: string[] = [];
for (let i = 0; i < 40; i++) jids.push('5511800000' + (1000 + i) + '@s.whatsapp.net');
const longJid = 'L'.repeat(300) + '@s.whatsapp.net'; // longer than the sharing limit: its own box every time
const unique = (m: number, i: number): string => 'note-' + m + '-' + i + '-' + 'z'.repeat(i % 5); // a fresh string per conversion

function group(m: number): Group {
  const members: Member[] = [];
  for (let i = 0; i < jids.length; i++) members.push({ jid: jids[i]!, role: i % 7 === 0 ? 'admin' : 'member', note: unique(m, i), seq: m });
  members.push({ jid: longJid, role: 'member', note: '', seq: m });
  return { id: 'g' + m, members };
}

const trees: any[] = [];
for (let m = 0; m < 12; m++) trees.push(viaDyn(group(m)));

let same = 0;
let objectIs = 0;
for (let i = 0; i < jids.length; i++) {
  for (let m = 1; m < trees.length; m++) {
    if (trees[0].members[i].jid === trees[m].members[i].jid) same++;
    if (Object.is(trees[0].members[i].jid, trees[m].members[i].jid)) objectIs++;
  }
}
console.log('same value', same, 'Object.is', objectIs);
console.log('long', trees[0].members[jids.length].jid === trees[5].members[jids.length].jid, trees[0].members[jids.length].jid.length);
console.log('roles', trees[3].members[0].role, trees[3].members[1].role, trees[3].members[7].role);

// Map and Set keys by value, across trees
const seen = new Set<string>();
const counts = new Map<string, number>();
for (const t of trees) {
  for (const mem of t.members) {
    seen.add(mem.jid);
    counts.set(mem.jid, (counts.get(mem.jid) ?? 0) + 1);
  }
}
console.log('distinct', seen.size, 'count of first', counts.get(jids[0]!), 'count of long', counts.get(longJid));

// an edit of one tree's field replaces that tree's slot only
trees[0].members[3].jid = 'edited@s.whatsapp.net';
trees[1].members[3].jid += '!';
trees[2].members[3].jid = trees[2].members[3].jid.toUpperCase();
console.log(trees[0].members[3].jid, '|', trees[1].members[3].jid, '|', trees[2].members[3].jid, '|', trees[3].members[3].jid, '|', trees[11].members[3].jid, '|', jids[3]);
// another field of the same record is untouched
console.log(trees[0].members[3].role, trees[0].members[3].seq, trees[1].members[3].note);

// property writes and deletes on shared-box trees
for (const t of trees) {
  t.members[5].extra = t.members[5].jid;
  delete t.members[6].role;
}
console.log(JSON.stringify(trees[4].members[5]), JSON.stringify(trees[4].members[6]));
console.log(Object.keys(trees[9].members[5]).join(','), Object.keys(trees[9].members[6]).join(','));

// string methods on a shared string do not touch the others
const a: string = trees[6].members[10].jid;
const b: string = trees[7].members[10].jid;
console.log(a.length, a.slice(0, 8), a.indexOf('@'), a.toUpperCase().slice(0, 8), b.slice(0, 8), a === b, a < b, a.localeCompare(b));

// inspect and JSON of a whole tree
console.log(JSON.stringify(trees[8]).length, JSON.stringify(trees[8].members.slice(0, 2)));
console.log(trees[10].members.slice(0, 2));

// a string converted when it is held only once, then again when it is shared
const once = 'only-once-' + 'x'.repeat(10);
const t1 = viaDyn({ s: once });
const t2 = viaDyn({ s: once });
const t3 = viaDyn({ s: once });
t2.s = 'changed';
console.log(t1.s, t2.s, t3.s, t1.s === t3.s, Object.is(t1.s, t3.s));
