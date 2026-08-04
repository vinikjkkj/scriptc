/* A protobufjs-style GENERATED surface: a declaration file whose
 * implementation twin (index.js, beside it) is real code. Every message is
 * a class with data-only instances — encode/decode are STATIC — plus the
 * $Properties interface the generator emits, and `decode` returns the
 * INTERSECTION `Msg & Msg.$Shape`. This is the shape zapo-js's
 * spec/proto/index.d.ts publishes for 641 messages. */
export declare namespace waproto {
	class Msg {
		constructor(p?: waproto.Msg.$Properties)
		details?: (Uint8Array|null)
		signature?: (Uint8Array|null)
		count?: (number|null)
		static encode(m: waproto.Msg.$Properties): Uint8Array
		static decode(r: Uint8Array): waproto.Msg & waproto.Msg.$Shape
	}
	namespace Msg {
		interface $Properties {
			details?: (Uint8Array|null)
			signature?: (Uint8Array|null)
			count?: (number|null)
		}
		type $Shape = waproto.Msg.$Properties
	}
}
