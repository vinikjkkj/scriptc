// One variable changed from amb1.ts: the receiver is a real string, not ambient.
// The fence MUST fire here, which is what makes amb1's silence a difference in
// reachability rather than a missed refusal.
function f(s: string): string {
    return s.replace('@', ':0@')
}
console.log('a=' + f('u@v'))
