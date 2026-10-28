// postgres-bytea's shape: `var bufferFrom = Buffer.from || Buffer`, then the hex form and the
// escape form both call the stored value. The value is a function object (typeof "function"),
// and calling it with a string and an encoding decodes exactly as Buffer.from does.
var bufferFrom = Buffer.from || Buffer
var parseBytea = function parseBytea (input) {
  if (/^\\x/.test(input)) {
    return bufferFrom(input.substr(2), 'hex')
  }
  var output = ''
  var i = 0
  while (i < input.length) {
    if (input[i] !== '\\') {
      output += input[i]
      ++i
    } else {
      if (/[0-7]{3}/.test(input.substr(i + 1, 3))) {
        output += String.fromCharCode(parseInt(input.substr(i + 1, 3), 8))
        i += 4
      } else {
        var backslashes = 1
        while (i + backslashes < input.length && input[i + backslashes] === '\\') {
          backslashes++
        }
        for (var k = 0; k < Math.floor(backslashes / 2); ++k) {
          output += '\\'
        }
        i += Math.floor(backslashes / 2) * 2
      }
    }
  }
  return bufferFrom(output, 'binary')
}
console.log(typeof bufferFrom, bufferFrom === Buffer.from)
console.log(parseBytea('\\x48656c6c6f').toString())
console.log(parseBytea('\\x00ff10').toString('hex'), parseBytea('\\x').length)
console.log(parseBytea('a\\000b\\\\c').length, parseBytea('a\\000b\\\\c').toString('hex'))
console.log(parseBytea('abc\\101\\102').toString(), parseBytea('\\\\\\\\').toString('hex'))
console.log(parseBytea('\\303\\251').toString('hex'), parseBytea('plain').toString('hex'))
