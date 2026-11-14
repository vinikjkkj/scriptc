// N byte-identical 11 KB chain results held live (the queued-query SQL). String census: STRCEN-TOP shows ONE string of this content with the table's reference plus 1,000 users (n=1) instead of n=1,000 copies; dupBytes drops from about 11 MB to 0. Positive control: the build without the table reads n=1,000.
const BIG = Array.from({ length: 250 }, () => "(user = ? AND server = ? AND device = ?)").join(" OR ");
function sql(i) { return "SELECT user, server, device, record FROM `t_" + (i % 1) + "_signal_session` WHERE session_id = ? AND (" + BIG + ")"; }
const keep = [];
for (let i = 0; i < 1000; i++) keep.push(sql(i));
let n = 0; for (const s of keep) n += s.length;
setTimeout(() => { console.log(keep.length, n, keep[999] === keep[0]); process.exit(0); }, 20);
