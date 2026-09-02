const proto: Record<string, number> = { pb: 1, pa: 2 }
const own: Record<string, number> = Object.create(proto) as Record<string, number>
own["ob"] = 3
own["oa"] = 4
let out = ""
for (const k in own) out += k + ";"
console.log("forin=" + out)
