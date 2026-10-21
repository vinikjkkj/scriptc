// switch over an `unknown` / untyped discriminant (mysql2's packet and
// charset dispatch): string, number and boolean cases, grouped cases, a
// default, and a value of a kind no case names.
/** @param {unknown} d */
function kind(d) {
  switch (d) {
    case 'a':
    case 'b':
      return 'letter';
    case 7:
      return 'seven';
    case true:
      return 'yes';
    case null:
      return 'null';
    default:
      return 'other';
  }
}

console.log(kind('a'), kind('b'), kind(7), kind(true), kind(null), kind('7'), kind(8), kind({}));

/** @param {{ type: unknown }} p */
function handle(p) {
  let out = '';
  switch (p.type) {
    case 'open':
      out += 'O';
      break;
    case 'close':
      out += 'C';
      break;
    default:
      out += '?';
  }
  return out;
}
console.log(handle({ type: 'open' }), handle({ type: 'close' }), handle({ type: 3 }));
