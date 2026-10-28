// filter() over an any-valued lookup: the predicate's any result keeps an
// element by its truthiness, so truthy and falsy non-boolean values decide.
function pick(mechanisms: any, known: string[]): string[] {
  return known.filter((name) => mechanisms.includes(name))
}
console.log(pick(['A', 'C'], ['A', 'B', 'C']).join(','))
console.log(pick([], ['A']).length, pick(['A'], []).length)
function flags(table: any, names: string[]): string[] {
  return names.filter((name) => table[name])
}
console.log(flags({ A: 'yes', B: '', C: 0, D: 7 }, ['A', 'B', 'C', 'D', 'E']).join(','))
