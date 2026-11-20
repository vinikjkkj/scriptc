// A parsed object cast to Record<string, number> is the same object: later writes show through, in both directions.
const j: any = JSON.parse('{"p":1,"q":2}');
const rj = j as Record<string, number>;
j.p = 10; console.log(rj.p, JSON.stringify(rj));
rj.q = 20; console.log(j.q, JSON.stringify(j));
j.r = 3; console.log(Object.keys(rj).join(","));
delete j.p; console.log(Object.keys(rj).join(","), rj.p);
for (const k in rj) console.log(k, rj[k]);
