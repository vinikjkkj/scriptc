// A flow-merged `let` whose assignments are a regex exec (string[] | null)
// beside an undefined initial value: the destination union nests the source's
// union as one arm, and the value must re-tag into it.
const re = /^([A-Za-z]+)(?: (\d+))?(?: (\d+))?/
class Result {
  constructor() {
    this.command = null
    this.rowCount = null
  }
  addCommandComplete(msg) {
    let match
    if (msg.text) {
      match = re.exec(msg.text)
    } else {
      match = re.exec(msg.command)
    }
    if (match) {
      this.command = match[1]
      if (match[3]) this.rowCount = Number(match[3])
    }
  }
}
const r = new Result()
r.addCommandComplete({ text: 'UPDATE 7 9' })
console.log(r.command, r.rowCount)
const s = new Result()
s.addCommandComplete({ command: 'SELECT 2' })
console.log(s.command, s.rowCount, s.rowCount === null)
