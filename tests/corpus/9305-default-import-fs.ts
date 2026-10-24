// Default import of node:fs in TypeScript.
import fs from 'node:fs'

console.log(fs.existsSync('/nonexistent-defimport-9305'), typeof fs.existsSync)
