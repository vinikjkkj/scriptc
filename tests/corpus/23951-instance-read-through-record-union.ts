// The shape of a database driver's answer: a write answers a header instance, a read answers an
// array of row instances, and the declaration is a union of the two. The checked cast takes the
// arm the value fits, exactly as it does for a plain object.
class ResultSetHeader {
  fieldCount = 0;
  affectedRows = 0;
  insertId = 0;
  info = "";
  constructor(affected: number, insert: number) {
    this.affectedRows = affected;
    this.insertId = insert;
    this.info = "ok:" + affected;
  }
}
class TextRow {
  id = 0;
  name = "";
  constructor(id: number, name: string) {
    this.id = id;
    this.name = name;
  }
  get label(): string {
    return this.id + "=" + this.name;
  }
}
interface Header {
  fieldCount: number;
  affectedRows: number;
  insertId: number;
  info: string;
}
interface Row {
  id: number;
  name: string;
  label: string;
}
type Answer = Header | Row[];
type Pair = [Answer, string[]];

function answer(kind: number): unknown {
  if (kind === 0) return [new ResultSetHeader(2, 17), ["f1", "f2"]];
  return [[new TextRow(1, "a"), new TextRow(2, "b")], ["id", "name"]];
}
function describe(raw: unknown): string {
  const [res, fields] = raw as Pair;
  if (Array.isArray(res)) {
    return "rows " + res.map((r) => r.label).join(",") + " " + fields.length;
  }
  return "header " + res.affectedRows + " " + res.insertId + " " + res.info + " " + fields.length;
}
console.log(describe(answer(0)));
console.log(describe(answer(1)));
const plain: unknown = [{ fieldCount: 1, affectedRows: 4, insertId: 5, info: "plain" }, []];
console.log(describe(plain));
const many: unknown = [[], ["x"]];
console.log(describe(many));
