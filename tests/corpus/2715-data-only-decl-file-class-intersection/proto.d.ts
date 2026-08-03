// A protobufjs-message declaration: a CLASS whose instances are pure data
// (encode/decode are STATIC, on typeof Class), plus its $Properties data
// interface. `decode` returns `Msg & Msg.$Shape` — the class-intersection
// a consumer types its decoded values with.
export namespace waproto {
    export class Msg {
        constructor(p?: waproto.Msg.$Properties)
        $unknowns?: Uint8Array[]
        details?: (Uint8Array | null)
        signature?: (Uint8Array | null)
        static decode(r: Uint8Array): waproto.Msg & waproto.Msg.$Shape
    }
    export namespace Msg {
        export interface $Properties {
            details?: (Uint8Array | null)
            signature?: (Uint8Array | null)
            $unknowns?: Uint8Array[]
        }
        export type $Shape = waproto.Msg.$Properties
    }
}
