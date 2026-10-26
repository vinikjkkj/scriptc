// Three levels of user subclasses, each adding fields: the walk over an
// instance typed as the root picks the key list of the constructed level.
class L0 { a = 'a0'; }
class L1 extends L0 { b = 'b1'; }
class L2 extends L1 { c = 'c2'; }
class L3 extends L2 { d = 'd3'; a = 'a3'; }
const items = [new L0(), new L1(), new L2(), new L3()];
for (const it of items) {
  const ks = [];
  for (const k in it) ks.push(k);
  console.log(ks.join(','));
}
