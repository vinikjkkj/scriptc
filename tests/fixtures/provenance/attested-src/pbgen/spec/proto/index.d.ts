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

/* The TABLE half, pinned PRECISELY: each `parts` field is a MIXED readonly
 * TUPLE, a more exact spelling of the array the index.js beside it
 * actually builds. A mixed tuple maps to a positional RECORD and the array
 * maps to an array, so before the compiled-twin rule the generated value
 * could not enter its own declared slot. Ping's ONE-position tuple agreed
 * already — a UNIFORM readonly tuple rides the array representation by
 * types.ts's own rule, which is what made the arity-1 schemas the only
 * ones that compiled in zapo. */
export type Part =
	| { readonly kind: 'literal'; readonly value: string }
	| { readonly kind: 'slot'; readonly label: string }

export interface Schema<
	Name extends string = string,
	Parts extends ReadonlyArray<Part> = ReadonlyArray<Part>
> {
	readonly name: Name
	readonly version: number
	readonly parts: Parts
}

export declare const TABLE: {
	readonly Ping: Schema<'ping', readonly [{ readonly kind: 'literal'; readonly value: 'ping' }]>
	readonly Mute: Schema<
		'mute',
		readonly [
			{ readonly kind: 'literal'; readonly value: 'mute' },
			{ readonly kind: 'slot'; readonly label: 'chatJid' }
		]
	>
	readonly Star: Schema<
		'star',
		readonly [
			{ readonly kind: 'literal'; readonly value: 'star' },
			{ readonly kind: 'slot'; readonly label: 'remote' },
			{ readonly kind: 'slot'; readonly label: 'id' }
		]
	>
}
