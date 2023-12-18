// Type definitions for socket.io-client 2.3
// Project: http://socket.io/
// Definitions by: PROGRE <https://github.com/progre>
//                 Damian Connolly <https://github.com/divillysausages>
//                 Florent Poujol <https://github.com/florentpoujol>
//                 OpportunityLiu <https://github.com/OpportunityLiu>
// Definitions: https://github.com/DefinitelyTyped/DefinitelyTyped

// NOTE: Official typings for socket.io-client 2.x don't seem to exist - These have been found in (and modified from) the following PR:
// https://github.com/DefinitelyTyped/DefinitelyTyped/pull/46897

declare module 'socket.io-client' {
	import { SocketOptions, Socket as Engine } from 'engine.io-client'

	export interface EventsMap {
		[event: string]: any
	}

	export interface DefaultEventsMap {
		[event: string]: (...args: any[]) => void
	}

	export type EventNames<Map extends EventsMap> = keyof Map & (string | symbol)

	export type EventParams<Map extends EventsMap, Ev extends EventNames<Map>> = Parameters<Map[Ev]>

	export interface SocketReservedEventsMap {
		disconnect: (reason: string) => void
		disconnecting: (reason: string) => void
		error: (err: Error) => void
		connect: () => void
	}

	export type ReservedOrUserEventNames<ReservedEventsMap extends EventsMap, UserEvents extends EventsMap> =
		| EventNames<ReservedEventsMap>
		| EventNames<UserEvents>

	export type ReservedOrUserListener<
		ReservedEvents extends EventsMap,
		UserEvents extends EventsMap,
		Ev extends ReservedOrUserEventNames<ReservedEvents, UserEvents>
	> = FallbackToUntypedListener<
		Ev extends EventNames<ReservedEvents>
			? ReservedEvents[Ev]
			: Ev extends EventNames<UserEvents>
			? UserEvents[Ev]
			: never
	>

	type FallbackToUntypedListener<T> = [T] extends [never] ? (...args: any[]) => void | Promise<void> : T

	export interface SocketIOClientStatic {
		/**
		 * Looks up an existing 'Manager' for multiplexing. If the user summons:
		 *     'io( 'http://localhost/a' );'
		 *     'io( 'http://localhost/b' );'
		 *
		 * We reuse the existing instance based on the same scheme/port/host, and
		 * we initialize sockets for each namespace. If autoConnect isn't set to
		 * false in the options, then we'll automatically connect
		 * @param uri The uri that we'll connect to, including the namespace, where '/' is the default one (e.g. http://localhost:4000/somenamespace)
		 * @param opts Any connect options that we want to pass along
		 * @return A Socket object
		 */
		(uri: string, opts?: ConnectOptions): Socket

		/** @deprecated */
		connect: this

		/**
		 * The socket.io protocol revision number this client works with
		 * @default 4
		 */
		protocol: number

		/**
		 * Socket constructor - exposed for the standalone build
		 */
		Socket: SocketStatic

		/**
		 * Manager constructor - exposed for the standalone build
		 */
		Manager: ManagerStatic

		/**
		 * Managers cache
		 */
		managers: { [key: string]: Manager }
	}

	/**
	 * The base emitter class, used by Socket and Manager
	 */
	interface Emitter<
		ListenEvents extends EventsMap,
		EmitEvents extends EventsMap,
		ReservedEvents extends EventsMap = {}
	> {
		/**
		 * Adds a listener for a particular event. Calling multiple times will add
		 * multiple listeners
		 * @param event The event that we're listening for
		 * @param fn The function to call when we get the event. Parameters depend on the
		 * event in question
		 * @return This Emitter
		 */
		on<Ev extends ReservedOrUserEventNames<ReservedEvents, ListenEvents>>(
			event: Ev,
			fn: ReservedOrUserListener<ReservedEvents, ListenEvents, Ev>
		): this

		/**
		 * @see on( event, fn )
		 */
		addEventListener<Ev extends ReservedOrUserEventNames<ReservedEvents, ListenEvents>>(
			event: Ev,
			fn: ReservedOrUserListener<ReservedEvents, ListenEvents, Ev>
		): this

		/**
		 * Adds a listener for a particular event that will be invoked
		 * a single time before being automatically removed
		 * @param event The event that we're listening for
		 * @param fn The function to call when we get the event. Parameters depend on
		 * the event in question
		 * @return This Emitter
		 */
		once<Ev extends ReservedOrUserEventNames<ReservedEvents, ListenEvents>>(
			event: Ev,
			fn: ReservedOrUserListener<ReservedEvents, ListenEvents, Ev>
		): this

		/**
		 * Removes a listener for a particular type of event. This will either
		 * remove a specific listener, or all listeners for this type of event
		 * @param event The event that we want to remove the listener of
		 * @param fn The function to remove, or null if we want to remove all functions
		 * @return This Emitter
		 */
		off<Ev extends ReservedOrUserEventNames<ReservedEvents, ListenEvents>>(
			event: Ev,
			fn: ReservedOrUserListener<ReservedEvents, ListenEvents, Ev>
		): this

		/**
		 * @see off( event, fn )
		 */
		removeListener<Ev extends ReservedOrUserEventNames<ReservedEvents, ListenEvents>>(
			event: Ev,
			fn: ReservedOrUserListener<ReservedEvents, ListenEvents, Ev>
		): this

		/**
		 * @see off( event, fn )
		 */
		removeEventListener<Ev extends ReservedOrUserEventNames<ReservedEvents, ListenEvents>>(
			event: Ev,
			fn: ReservedOrUserListener<ReservedEvents, ListenEvents, Ev>
		): this

		/**
		 * Removes all event listeners on this object
		 * @return This Emitter
		 */
		removeAllListeners(): this

		/**
		 * Emits 'event' with the given args
		 * @param event The event that we want to emit
		 * @param args Optional arguments to emit with the event
		 * @return Emitter
		 */
		emit(event: string, ...args: any[]): this

		/**
		 * Returns all the callbacks for a particular event
		 * @param event The event that we're looking for the callbacks of
		 * @return An array of callback Functions, or an empty array if we don't have any
		 */
		listeners(event: string): Function[]

		/**
		 * Returns if we have listeners for a particular event
		 * @param event The event that we want to check if we've listeners for
		 * @return True if we have listeners for this event, false otherwise
		 */
		hasListeners(event: string): boolean
	}

	/**
	 * The Socket static interface
	 */
	interface SocketStatic {
		/**
		 * Creates a new Socket, used for communicating with a specific namespace
		 * @param io The Manager that's controlling this socket
		 * @param nsp The namespace that this socket is for (@default '/')
		 * @return A new Socket
		 */
		new (io: Manager, nsp: string): Socket
	}

	/**
	 * The Socket that we use to connect to a Namespace on the server
	 */
	export interface Socket<
		ListenEvents extends EventsMap = DefaultEventsMap,
		EmitEvents extends EventsMap = ListenEvents
	> extends Emitter<ListenEvents, EmitEvents, SocketReservedEventsMap> {
		/**
		 * The Manager that's controller this socket
		 */
		io: Manager

		/**
		 * The namespace that this socket is for
		 * @default '/'
		 */
		nsp: string

		/**
		 * The ID of the socket; matches the server ID and is set when we're connected, and cleared
		 * when we're disconnected
		 */
		id: string

		/**
		 * Are we currently connected?
		 * @default false
		 */
		connected: boolean

		/**
		 * Are we currently disconnected?
		 * @default true
		 */
		disconnected: boolean

		/**
		 * Opens our socket so that it connects. If the 'autoConnect' option for io is
		 * true (default), then this is called automatically when the Socket is created
		 */
		open(): this

		/**
		 * @see open();
		 */
		connect(): this

		/**
		 * Sends a 'message' event
		 * @param args Any optional arguments that we want to send
		 * @see emit
		 * @return This Socket
		 */
		send(...args: EventParams<EmitEvents, 'message'>): this

		/**
		 * An override of the base emit. If the event is one of:
		 *     connect
		 *     connect_error
		 *     connect_timeout
		 *     connecting
		 *     disconnect
		 *     error
		 *     reconnect
		 *     reconnect_attempt
		 *     reconnect_failed
		 *     reconnect_error
		 *     reconnecting
		 *     ping
		 *     pong
		 * then the event is emitted normally. Otherwise, if we're connected, the
		 * event is sent. Otherwise, it's buffered.
		 *
		 * If the last argument is a function, then it will be called
		 * as an 'ack' when the response is received. The parameter(s) of the
		 * ack will be whatever data is returned from the event
		 * @param event The event that we're emitting
		 * @param args Optional arguments to send with the event
		 * @return This Socket
		 */
		emit<Ev extends EventNames<EmitEvents>>(event: Ev, ...args: EventParams<EmitEvents, Ev>): this

		/**
		 * Disconnects the socket manually
		 * @return This Socket
		 */
		close(): this

		/**
		 * @see close()
		 */
		disconnect(): this

		/**
		 * Sets the compress flag.
		 * @param compress If `true`, compresses the sending data
		 * @default true
		 * @return this Socket
		 */
		compress(compress: boolean): this

		/**
		 * Specifies whether the emitted data contains binary.
		 * Increases performance when specified. Can be true or false.
		 * @return this Socket
		 */
		binary(binary: boolean): this
	}

	interface ManagerReservedEvents {
		open: () => void
		error: (err: Error) => void
		ping: () => void
		packet: (packet: Packet) => void
		close: (reason: string, description?: DisconnectDescription) => void
		reconnect_failed: () => void
		reconnect_attempt: (attempt: number) => void
		reconnect_error: (err: Error) => void
		reconnect: (attempt: number) => void
	}

	export enum PacketType {
		CONNECT,
		DISCONNECT,
		EVENT,
		ACK,
		CONNECT_ERROR,
		BINARY_EVENT,
		BINARY_ACK,
	}

	export interface Packet {
		type: PacketType
		nsp: string
		data?: any
		id?: number
		attachments?: number
	}

	export type DisconnectDescription =
		| Error
		| {
				description: string
				context?: unknown
		  }

	/**
	 * The Manager static interface
	 */
	interface ManagerStatic {
		/**
		 * Creates a new Manager
		 * @param uri The URI that we're connecting to (e.g. http://localhost:4000)
		 * @param opts Any connection options that we want to use (and pass to engine.io)
		 * @return A Manager
		 */
		new (uri: string, opts?: ManagerOptions): Manager
	}

	/**
	 * The Manager class handles all the Namespaces and Sockets that we're using
	 */
	interface Manager extends Emitter<{}, {}, ManagerReservedEvents> {
		/**
		 * All the namespaces currently controlled by this Manager, and the Sockets
		 * that we're using to communicate with them
		 */
		nsps: { [namespace: string]: Socket }

		/**
		 * The connect options that we used when creating this Manager
		 */
		opts: ManagerOptions

		/**
		 * The state of the Manager. Either 'closed', 'opening', or 'open'
		 */
		readyState: string

		/**
		 * The URI that this manager is for (host + port), e.g. 'http://localhost:4000'
		 */
		uri: string

		/**
		 * The currently connected sockets
		 */
		connecting: Socket[]

		/**
		 * The underlying engine.io
		 */
		engine: Engine

		/**
		 * If we should auto connect (also used when creating Sockets). Set via the
		 * opts object
		 */
		autoConnect: boolean

		/**
		 * Gets if we should reconnect automatically
		 * @default true
		 */
		reconnection(): boolean

		/**
		 * Sets if we should reconnect automatically
		 * @param v True if we should reconnect automatically, false otherwise
		 * @default true
		 * @return This Manager
		 */
		reconnection(v: boolean): Manager

		/**
		 * Gets the number of reconnection attempts we should try before giving up
		 * @default Infinity
		 */
		reconnectionAttempts(): number

		/**
		 * Sets the number of reconnection attempts we should try before giving up
		 * @param v The number of attempts we should do before giving up
		 * @default Infinity
		 * @return This Manager
		 */
		reconnectionAttempts(v: number): Manager

		/**
		 * Gets the delay in milliseconds between each reconnection attempt
		 * @default 1000
		 */
		reconnectionDelay(): number

		/**
		 * Sets the delay in milliseconds between each reconnection attempt
		 * @param v The delay in milliseconds
		 * @default 1000
		 * @return This Manager
		 */
		reconnectionDelay(v: number): Manager

		/**
		 * Gets the max reconnection delay in milliseconds between each reconnection
		 * attempt
		 * @default 5000
		 */
		reconnectionDelayMax(): number

		/**
		 * Sets the max reconnection delay in milliseconds between each reconnection
		 * attempt
		 * @param v The max reconnection delay in milliseconds
		 * @return This Manager
		 */
		reconnectionDelayMax(v: number): Manager

		/**
		 * Gets the randomisation factor used in the exponential backoff jitter
		 * when reconnecting
		 * @default 0.5
		 */
		randomizationFactor(): number

		/**
		 * Sets the randomisation factor used in the exponential backoff jitter
		 * when reconnecting
		 * @param v The reconnection randomisation factor
		 * @default 0.5
		 * @return This Manager
		 */
		randomizationFactor(v: number): Manager

		/**
		 * Gets the timeout in milliseconds for our connection attempts
		 * @default 20000
		 */
		timeout(): number

		/**
		 * Sets the timeout in milliseconds for our connection attempts
		 * @param v The connection timeout milliseconds
		 * @return This Manager
		 */
		timeout(v: number): Manager

		/**
		 * Sets the current transport socket and opens our connection
		 * @param fn An optional callback to call when our socket has either opened, or
		 * failed. It can take one optional parameter of type Error
		 * @return This Manager
		 */
		open(fn?: (err?: any) => void): Manager

		/**
		 * @see open( fn );
		 */
		connect(fn?: (err?: any) => void): Manager

		/**
		 * Creates a new Socket for the given namespace
		 * @param nsp The namespace that this Socket is for
		 * @return A new Socket, or if one has already been created for this namespace,
		 * an existing one
		 */
		socket(nsp: string): Socket
	}

	/**
	 * Options we can pass to the manager and the underlying Engine.IO client when connecting
	 */
	interface ManagerOptions extends SocketOptions {
		/**
		 * The path to get our client file from, in the case of the server
		 * serving it
		 * @default '/socket.io'
		 */
		path?: string

		/**
		 * Should we allow reconnections?
		 * @default true
		 */
		reconnection?: boolean

		/**
		 * How many reconnection attempts should we try?
		 * @default Infinity
		 */
		reconnectionAttempts?: number

		/**
		 * The time delay in milliseconds between reconnection attempts
		 * @default 1000
		 */
		reconnectionDelay?: number

		/**
		 * The max time delay in milliseconds between reconnection attempts
		 * @default 5000
		 */
		reconnectionDelayMax?: number

		/**
		 * Used in the exponential backoff jitter when reconnecting, 0 <= randomizationFactor <= 1
		 * @default 0.5
		 */
		randomizationFactor?: number

		/**
		 * The timeout in milliseconds for our connection attempt
		 * @default 20000
		 */
		timeout?: number

		/**
		 * Should we automatically connect?
		 * @default true
		 */
		autoConnect?: boolean

		/**
		 * Additional query parameters that are sent when connecting a namespace (then found in socket.handshake.query object on the server-side)
		 */
		query?: Record<string, string>
		/**
		 * The parser to use. Defaults to an instance of the Parser that ships with socket.io. See socket.io-parser.
		 */
		parser?: {
			Encoder: new () => object
			Decoder: new () => object
		}
	}

	/**
	 * Options we can pass to the socket when connecting
	 */
	interface ConnectOptions extends ManagerOptions {
		/**
		 * Should we force a new Manager for this connection?
		 * @default false
		 */
		forceNew?: boolean

		/**
		 * Should we multiplex our connection (reuse existing Manager) ?
		 * @default true
		 * @deprecated Use `forceNew` instead
		 */
		multiplex?: boolean
	}

	const io: SocketIOClientStatic
	export default io
}
