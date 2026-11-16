// An index-signature accumulator filled in an order the REQUIRED-field shape it is returned as does not declare. Every
// key prints once, in the fill order, on every enumeration surface (the shape has no optional member to drop).
type Req = { alpha: string; beta: string; gamma: string };
const ORDER = ['gamma', 'alpha', 'beta'];
function build(name: string): Req {
  const out: Record<string, string> = {};
  for (const k of ORDER) out[k] = name + k;
  return out as Req;
}
const r = build('v-');
console.log(JSON.stringify(r));
console.log(Object.keys(r).join(','));
console.log(JSON.stringify(Object.entries(r)));
console.log(r);
console.log(r.alpha, r.beta, r.gamma);
