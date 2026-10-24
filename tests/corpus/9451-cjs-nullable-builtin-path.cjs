// A null-armed selector over a second builtin, read through two members.
const usePath = [1, 2, 3].length > 2
const path = usePath ? require('path') : null
console.log(path.join('a', 'b', 'c'))
console.log(path.basename('/x/y/z.txt'))

function pick(on) {
  const p = on ? require('path') : null
  try {
    return p.extname('file.tar.gz')
  } catch (e) {
    return e instanceof TypeError ? 'TypeError' : 'other'
  }
}
console.log(pick(true))
console.log(pick(false))
