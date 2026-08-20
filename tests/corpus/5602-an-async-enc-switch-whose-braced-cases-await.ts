// The zapo site in full: the `<enc>` switch lives in an ASYNC function,
// three of its four case bodies `await`, one of them `continue`s out of the
// enclosing for-loop from INSIDE a braced body, and the grouped
// `case 'msg': case 'pkmsg':` re-reads the same attribute one line down.
//
// This is 5600's shape with everything the real
// `src/message/primitives/incoming.ts:531-611` carries put back. It matters
// on its own because the union desugar had never lowered a BRACED case body
// at all before this change, so it had never lowered one that awaits, and an
// `await` inside a desugared if/else is a different statement tree from an
// `await` inside a switch case.
//
// The second row ABORTS the process on base, on both backends.
type WaNode = { tag: string; attrs: Record<string, string> }

async function decrypt(kind: string, n: number): Promise<string> {
    await new Promise<void>((r) => setTimeout(r, 1))
    return kind + n
}

async function handle(children: WaNode[]): Promise<string[]> {
    const out: string[] = []
    let firstEncType: string | undefined
    let encCount = 0
    for (const child of children) {
        if (child.tag !== 'enc') { continue }
        encCount += 1
        if (firstEncType === undefined) {
            firstEncType = child.attrs.type
        }
        let result: string | null = null
        switch (child.attrs.type) {
            case 'skmsg': {
                if (child.attrs.from === undefined) {
                    out.push('skip:no-from')
                    continue
                }
                result = await decrypt('skmsg', encCount)
                break
            }
            case 'msg':
            case 'pkmsg': {
                const encType: 'msg' | 'pkmsg' = child.attrs.type === 'msg' ? 'msg' : 'pkmsg'
                result = await decrypt(encType, encCount)
                break
            }
            case 'msmsg': {
                result = 'msmsg-sync'
                break
            }
            default:
                continue
        }
        out.push(String(result))
    }
    out.push('count=' + encCount + ' first=' + String(firstEncType))
    return out
}

async function main(): Promise<void> {
    console.log((await handle([{ tag: 'enc', attrs: { type: 'msg' } }])).join(','))
    console.log((await handle([{ tag: 'enc', attrs: { v: '2' } }])).join(','))
    console.log((await handle([{ tag: 'enc', attrs: { type: 'skmsg' } }])).join(','))
    console.log((await handle([
        { tag: 'enc', attrs: { type: 'skmsg', from: 'g@us' } },
        { tag: 'enc', attrs: { nope: '1' } },
        { tag: 'enc', attrs: { type: 'pkmsg' } },
        { tag: 'enc', attrs: { type: 'msmsg' } },
    ])).join(','))
    console.log('done')
}
void main()
