// A record field whose value is an index-signature record, filled from a
// literal that is EMPTY or has declared fields — the BinaryNode protocol
// shape (`attrs: {}` / `attrs: { id: '1' }` into `attrs: Record<string,
// string>`). The outer literal width-coerces into the recursive Node
// shape, and each `attrs` FIELD must carry a record into an index-
// signature slot: the overflow-capture flow, which widthCoerce owned at
// top level but a nested field position could not reach. The empty
// literal captures to an empty map; a populated one writes its fields
// through. Interned per (source, target) shape like every width helper.
type Node = {
    readonly tag: string
    readonly attrs: Readonly<Record<string, string>>
    readonly content: readonly Node[]
}

function make(): Node {
    return {
        tag: 'root',
        attrs: {},
        content: [
            { tag: 'a', attrs: { id: '1', kind: 'x' }, content: [] },
            { tag: 'b', attrs: {}, content: [{ tag: 'c', attrs: { z: '9' }, content: [] }] }
        ]
    }
}

const n = make()
console.log(n.tag, Object.keys(n.attrs).length)
console.log(n.content[0].tag, n.content[0].attrs['id'], n.content[0].attrs['kind'])
console.log(n.content[1].tag, Object.keys(n.content[1].attrs).length, n.content[1].content[0].attrs['z'])
