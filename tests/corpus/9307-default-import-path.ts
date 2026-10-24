// Default import of node:path in TypeScript.
import path from 'node:path'

console.log(path.sep, path.join('a', 'b', '..', 'c'), path.basename('/x/y.txt'), path.extname('a.tar.gz'))
