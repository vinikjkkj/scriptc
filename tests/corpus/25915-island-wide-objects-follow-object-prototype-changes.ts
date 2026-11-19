// A wide object marshalled repeatedly, then a key of the object is added to Object.prototype as an accessor and as a plain value: the later copies must still match Node.
const dump: any = new Function("o", "return JSON.stringify(o) + ':' + Object.keys(o).length + ':' + o.k3")
const wide = (rep: number) => {
  const o: any = {}
  for (let k = 0; k < 60; k++) o["k" + k] = k + rep
  return o
}
const out: string[] = []
for (let i = 0; i < 4; i++) out.push(dump(wide(i)))
const addProto: any = new Function("Object.defineProperty(Object.prototype, 'k3', { get() { return 'proto'; }, set(v) { }, configurable: true })")
addProto()
for (let i = 0; i < 3; i++) out.push(dump(wide(i)))
const rm: any = new Function("delete Object.prototype.k3")
rm()
for (let i = 0; i < 3; i++) out.push(dump(wide(i)))
console.log(out.join("\n"))
