// The hand-written declaration half. It DECLARES the parameter types -- which
// is the point: the declaration is not what makes them known inside the body,
// because the body is JavaScript and the mapped file is this `.d.ts`. Only
// implicit-any monomorphization at the CALL SITES makes `channel` a string
// inside `wireCodeOf`, and that gate is what this fixture is here to pin.
export type Channel = 'private' | 'realtime' | 'regular'

export declare const WIRE_CODES: {
    readonly regular: 0
    readonly realtime: 1
    readonly private: 2
}

export declare function wireCodeOf(channel: Channel): number

export declare function bucketOf(channel: Channel): number
