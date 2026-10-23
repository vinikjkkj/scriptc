'use strict'

exports.parse = function (source, transform) {
  return new ListParser(source, transform).parse()
}

class ListParser {
  constructor (source, transform) {
    this.source = source
    this.transform = transform || identity
    this.position = 0
    this.entries = []
  }

  parse (nested) {
    var text = this.source.substr(this.position + 1, this.source.length - 2)
    var parts = text.split(',')
    for (var i = 0; i < parts.length; i++) this.entries.push(this.transform(parts[i]))
    return this.entries
  }
}

function identity (value) {
  return value
}
