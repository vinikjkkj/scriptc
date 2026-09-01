'use strict'
// An ordinary CommonJS module. `config()` returns whatever the JSON holds, so
// the checker infers `any` for it -- the single commonest shape in shipped JS.
function config(text) {
    return JSON.parse(text)
}
module.exports = { config }
