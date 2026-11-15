interface Cell { code: number; label: string }
type N = "k00" | "k01" | "k02" | "k03" | "k04" | "k05" | "k06" | "k07" | "k08" | "k09" | "k10" | "k11" | "k12" | "k13" | "k14" | "k15" | "k16" | "k17" | "k18" | "k19";
function fill0(): Record<N, Cell> {
  const acc = {} as Record<N, Cell>;
  acc.k03 = { code: 16, label: 'cell3' };
  acc.k05 = { code: 26, label: 'cell5' };
  acc.k09 = { code: 46, label: 'cell9' };
  return acc;
}
function fill1(): Record<N, Cell> {
  const acc = {} as Record<N, Cell>;
  acc.k00 = { code: 1, label: 'cell0' };
  acc.k07 = { code: 36, label: 'cell7' };
  acc.k12 = { code: 61, label: 'cell12' };
  acc.k19 = { code: 96, label: 'cell19' };
  return acc;
}
function fill2(): Record<N, Cell> {
  const acc = {} as Record<N, Cell>;
  return acc;
}
function fill3(): Record<N, Cell> {
  const acc = {} as Record<N, Cell>;
  acc.k00 = { code: 1, label: 'cell0' };
  acc.k01 = { code: 6, label: 'cell1' };
  acc.k02 = { code: 11, label: 'cell2' };
  acc.k03 = { code: 16, label: 'cell3' };
  acc.k04 = { code: 21, label: 'cell4' };
  acc.k05 = { code: 26, label: 'cell5' };
  acc.k06 = { code: 31, label: 'cell6' };
  acc.k07 = { code: 36, label: 'cell7' };
  acc.k08 = { code: 41, label: 'cell8' };
  acc.k09 = { code: 46, label: 'cell9' };
  acc.k10 = { code: 51, label: 'cell10' };
  acc.k11 = { code: 56, label: 'cell11' };
  acc.k12 = { code: 61, label: 'cell12' };
  acc.k13 = { code: 66, label: 'cell13' };
  acc.k14 = { code: 71, label: 'cell14' };
  acc.k15 = { code: 76, label: 'cell15' };
  acc.k16 = { code: 81, label: 'cell16' };
  acc.k17 = { code: 86, label: 'cell17' };
  acc.k18 = { code: 91, label: 'cell18' };
  acc.k19 = { code: 96, label: 'cell19' };
  return acc;
}
function fill4(): Record<N, Cell> {
  const acc = {} as Record<N, Cell>;
  acc.k02 = { code: 11, label: 'cell2' };
  acc.k03 = { code: 16, label: 'cell3' };
  acc.k04 = { code: 21, label: 'cell4' };
  return acc;
}
function fill5(): Record<N, Cell> {
  const acc = {} as Record<N, Cell>;
  acc.k01 = { code: 6, label: 'cell1' };
  acc.k08 = { code: 41, label: 'cell8' };
  acc.k15 = { code: 76, label: 'cell15' };
  return acc;
}
function fill6(): Record<N, Cell> {
  const acc = {} as Record<N, Cell>;
  acc.k19 = { code: 96, label: 'cell19' };
  return acc;
}
function show(r: Record<N, Cell>): string {
  let s = Object.keys(r).length + ':';
  for (const [k, v] of Object.entries(r)) s += ' ' + k + '=' + v.code + '/' + v.label;
  return s + ' | ' + Object.values(r).map((v) => v.code).join(',');
}
console.log(show(fill0()));
console.log(show(fill1()));
console.log(show(fill2()));
console.log(show(fill3()));
console.log(show(fill4()));
console.log(JSON.stringify(fill5()), show(fill6()));
