// SCRAM mechanism selection: the candidate list is filtered by a predicate
// over a server-supplied list whose type is `any`, so the callback's return
// is `any` and find() tests its truthiness.
function startSession(mechanisms: any, stream: any): string {
  const candidates = ['SCRAM-SHA-256']
  if (stream) candidates.unshift('SCRAM-SHA-256-PLUS')
  const mechanism = candidates.find((candidate) => mechanisms.includes(candidate))
  if (!mechanism) {
    throw new Error('SASL: Only mechanism(s) ' + candidates.join(' and ') + ' are supported')
  }
  return mechanism
}
console.log(startSession(['SCRAM-SHA-256', 'SCRAM-SHA-256-PLUS'], true))
console.log(startSession(['SCRAM-SHA-256'], false))
console.log(startSession(['SCRAM-SHA-256'], true))
try {
  startSession(['PLAIN'], false)
} catch (e) {
  console.log((e as Error).message)
}
