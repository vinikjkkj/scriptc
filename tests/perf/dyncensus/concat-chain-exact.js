// N=100 fresh ~11 KB strings built by ONE five-operand concat chain per call, all held. String census (scr_str_census.h): capMax must equal lenMax (11085); with the binary fold every one carried 16,416 B of capacity (the +50% rule), the positive control (build without the n-ary arm shows capMax 16626).
const BIG = Array.from({ length: 250 }, () => "(user = ? AND server = ? AND device = ?)").join(" OR ");
function sql(i) { return "SELECT user, server, device, record FROM `t_" + (i % 3) + "_signal_session` WHERE session_id = ? AND (" + BIG + ")"; }
const keep = [];
for (let i = 0; i < 100; i++) keep.push(sql(i));
let n = 0; for (const s of keep) n += s.length;
setTimeout(() => { console.log(keep.length, n); process.exit(0); }, 20);
