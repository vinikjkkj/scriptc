/* An ES request must never LOWER the floor. This tsconfig asks for ES2015
 * alone; under a verbatim adoption `Array.prototype.at` (ES2022) and
 * `Object.entries` (ES2017) would stop resolving. They must still resolve:
 * the forced es2025 floor stands and only non-ES additions are taken. */
console.log('at:      ' + [3, 1, 2].at(-1))
console.log('entries: ' + Object.entries({ k: 1 }).length)
console.log('padStart:' + '7'.padStart(3, '0'))
