// A spread whose source is a call returning a literal with typed (number and string) fields: the record shape is static, and the spread copies its keys in declaration order beside function members.
function meta(n) {
  return { id: 7, label: 'row', weight: 2 };
}
function row(n) {
  return { ...meta(n), score: function () { return this.weight + 1; }, label2: 'x' };
}
const r = row(3);
console.log(Object.keys(r).join(","), JSON.stringify(r), r.score());
for (const k of Object.keys(r)) console.log(k, typeof r[k]);
