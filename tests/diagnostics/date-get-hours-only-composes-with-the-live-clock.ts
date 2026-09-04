/* `getHours` composes with the live clock and with nothing else, and the
 * fence has to say why or a reader will read it as an unfinished feature.
 *
 * The local hour is not a function of the milliseconds. It needs the offset
 * the host's zone was at that instant, and the platforms disagree about
 * history: glibc carries the full zone database, while Windows' CRT applies
 * the zone's CURRENT rule to every instant. Measured, one instant every ~9
 * days from 2000 to 2030 on a Windows host in America/Sao_Paulo: 260 of
 * 1200 disagreed with Node, every one of them inside a DST period the zone
 * no longer observes.
 *
 * That divergence belongs to the machine that RUNS the binary, which is not
 * the machine that compiles it -- so an arbitrary-millisecond form would be
 * exact on one host and silently an hour off on another, decided by
 * something the compiler cannot see. `new Date()` is the one instant no
 * zone database can be wrong about: the current offset is what the host is
 * using right now, which is what Node's ICU reports for the present.
 *
 * The hint names the spelling that does work for a past instant --
 * `toISOString()`, which is UTC and therefore a pure function of the time
 * value -- because "this has no lowering yet" is not advice.
 */

/* 1. an explicit millisecond value */
console.log(new Date(1700000000000).getHours())

/* 2. a millisecond value the program computed -- no more knowable than a
 *    literal one, and it must not look like it is */
const ms = Date.now() - 86400000
console.log(new Date(ms).getHours())

/* 3. the date-string form: the parse is bounded AND the zone is unknown */
console.log(new Date('2024-01-15T00:00:00Z').getHours())
