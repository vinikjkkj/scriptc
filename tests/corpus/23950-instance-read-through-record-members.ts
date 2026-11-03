// A class instance arrives as `unknown` and is read through record types: `x as R` is erased
// in JavaScript, so every member R declares is answered by the instance itself - a data field,
// a getter, a method, a member the base class declares. The record is the value's own answer
// at the moment of the read.
class Base {
  fieldCount = 0;
  get kind(): string {
    return "base";
  }
  describe(): string {
    return "B" + this.fieldCount;
  }
}
class ResultSetHeader extends Base {
  affectedRows = 0;
  insertId = 0;
  info = "";
  serverStatus = 2;
  warningStatus = 0;
  constructor(affected: number, insert: number) {
    super();
    this.affectedRows = affected;
    this.insertId = insert;
    this.info = "Rows matched: " + affected;
    this.fieldCount = 9;
  }
  get summary(): string {
    return this.affectedRows + "/" + this.insertId;
  }
  twice(n: number): number {
    return n * 2;
  }
}
interface Header {
  fieldCount: number;
  affectedRows: number;
  insertId: number;
  info: string;
  summary: string;
  kind: string;
}
interface Small {
  affectedRows: number;
}
interface WithMethods {
  twice(n: number): number;
  describe(): string;
  affectedRows: number;
}
interface Wide {
  affectedRows: number;
  missing?: string;
  other?: number;
}

function make(): unknown {
  return new ResultSetHeader(3, 41);
}

const u = make();
const h = u as Header;
console.log(h.fieldCount, h.affectedRows, h.insertId, h.info, h.summary, h.kind);
const s = u as Small;
console.log(s.affectedRows);
const m = u as WithMethods;
console.log(m.twice(21), m.describe(), m.affectedRows);
const w = u as Wide;
console.log(w.affectedRows, w.missing, w.other);

const list: unknown = [new ResultSetHeader(1, 2), new ResultSetHeader(5, 6)];
const hs = list as Header[];
console.log(hs.length, hs[1]!.insertId, hs[0]!.summary);

interface Pair {
  header: Header;
  n: number;
}
const nested: unknown = { header: new ResultSetHeader(7, 8), n: 1 };
const pr = nested as Pair;
console.log(pr.header.summary, pr.n);

const tuple: unknown = [new ResultSetHeader(9, 10), "second"];
const tp = tuple as [Header, string];
console.log(tp[0].insertId, tp[1]);
