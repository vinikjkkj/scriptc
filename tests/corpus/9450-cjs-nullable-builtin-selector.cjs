// A CommonJS builtin bound through a conditional whose other arm is null:
// the binding holds the module on one arm and null on the other, and a
// member read through it throws Node's TypeError on the null arm.
function load(useFs, file) {
  const fs = useFs ? require('fs') : null
  let size = -1
  if (useFs) {
    size = fs.readFileSync(file).length
  }
  return size
}

function probe(useFs) {
  try {
    const fs = useFs ? require('fs') : null
    const text = fs.readFileSync(__filename).toString()
    return text.length > 0
  } catch (e) {
    return e instanceof TypeError ? e.message : 'other'
  }
}

console.log(load(true, __filename) > 0)
console.log(load(false, __filename))
console.log(probe(true))
console.log(probe(false))
