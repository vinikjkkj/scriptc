const o: unknown = JSON.parse('{"b":"B","a":"A"}')
console.log("keys=" + Object.keys(o as Record<string, string>).join(","))
console.log("json=" + JSON.stringify(o))
