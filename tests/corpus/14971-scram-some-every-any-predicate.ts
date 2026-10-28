// some() and every() over an any-valued list: the predicate's any result
// is tested for truthiness (every mechanism must be known, one must be
// SCRAM). Truthy and falsy non-boolean values must agree with JS.
function check(mechanisms: any, known: string[]): string {
  const anyKnown = known.some((name) => mechanisms.includes(name))
  const allKnown = known.every((name) => mechanisms.includes(name))
  return anyKnown + '/' + allKnown
}
console.log(check(['SCRAM-SHA-256'], ['SCRAM-SHA-256', 'SCRAM-SHA-256-PLUS']))
console.log(check(['SCRAM-SHA-256', 'SCRAM-SHA-256-PLUS'], ['SCRAM-SHA-256', 'SCRAM-SHA-256-PLUS']))
console.log(check(['PLAIN'], ['SCRAM-SHA-256']))
