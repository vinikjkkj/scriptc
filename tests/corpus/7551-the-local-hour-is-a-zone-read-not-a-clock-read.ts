// `new Date().getHours()` -- the first LOCAL-time field read on the Date
// surface, and the reason it is not just another millisecond formatter:
// every other Date entry point is a pure function of its time value, and
// this one needs the offset the HOST's zone was at that instant.
//
// HOW THIS IS PINNED WITHOUT FLAKING. A program that prints the current
// local hour is byte-exact against Node except across an hour boundary,
// which makes it a time bomb rather than a test. What IS stable is the
// hour DELTA between local and UTC: when the clock rolls, both terms
// advance together, so the delta is the zone's whole-hour offset and does
// not move. The one way to read it wrong is to take the local hour and the
// UTC hour from different UTC hours, so the clock is sampled on both sides
// of the read and the delta is only accepted when the two samples agree --
// retried, so accepting it is certain rather than likely.
//
// WHAT IT CATCHES. An implementation that returned the UTC hour would print
// `utc-offset-hours 0`, and Node prints the host's real offset. On a host
// that IS in UTC the two agree and this program cannot tell them apart --
// said plainly rather than left for a reader to discover, because the check
// is only as strong as the host running it. On the machine this landed on
// (America/Sao_Paulo) Node and both backends print 21.
//
// WHAT DOES NOT COMPILE, AND WHY THAT IS THE FEATURE. Only the live-clock
// spelling lowers. `new Date(ms).getHours()` is fenced because the answer
// depends on the RUN host's zone HISTORY, which the compiler cannot see:
// glibc carries the full database and Windows' CRT applies the zone's
// current rule to every instant. Sampling one instant every ~9 days from
// 2000 to 2030 on a Windows host in America/Sao_Paulo, 260 of 1200
// disagreed with Node -- every one inside a DST period the zone no longer
// observes. `new Date()` is the one instant a zone database cannot be
// wrong about. The fence is pinned in
// tests/diagnostics/date-get-hours-only-composes-with-the-live-clock.ts.
//
// PINNED IN TIER_REGRESSIONS (tests/harness/llvm-differential.test.ts):
// before the lowering existed this program did not compile at all, so a
// revert does not fail it -- it lands in the refused column, where a
// suite reading only pass/fail goes green on the regression.

let delta = -1
let sampled = false
for (let round = 0; round < 8; round += 1) {
    const before = Date.now()
    const hour = new Date().getHours()
    const after = Date.now()
    // Both clock reads inside one UTC hour: the delta below is then the
    // zone offset and nothing else.
    if (Math.floor(before / 3600000) !== Math.floor(after / 3600000)) continue
    const utcHour = Number(new Date(before).toISOString().slice(11, 13))
    delta = ((hour - utcHour) % 24 + 24) % 24
    sampled = true
    console.log('hour-is-an-integer', Math.floor(hour) === hour)
    console.log('hour-in-range', hour >= 0 && hour < 24)
    break
}
console.log('sampled', sampled)
console.log('utc-offset-hours', delta)
