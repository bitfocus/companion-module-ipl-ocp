import { ReplicantMap, ReplicantMetadata, ReplicantMetadataOpts, ReplicantOperation } from './replicant'

export interface ReplicantSocketMessageMessage {
	bundleName: string
	messageName: string
	content: unknown
}

export interface ReplicantDeclareResponse<T> {
	value: T
	revision: number
	schemaSum: string
}

export interface ReplicantSocketMessageMap<R extends ReplicantMap> {
	message: (data: ReplicantSocketMessageMessage, cb: (response?: { name: string; message: string }) => void) => void
	'replicant:proposeOperations': (data: {
		name: string
		namespace: string
		operations: Array<ReplicantOperation>
		revision: number
		schemaSum: string
		opts: ReplicantMetadataOpts
	}) => void
	'replicant:proposeAssignment': (data: {
		name: string
		namespace: string
		value: unknown
		schemaSum: string
		opts: ReplicantMetadataOpts
	}) => void
	joinRoom: (roomName: string, cb: () => void) => void
	'replicant:declare': (
		data: { name: string; namespace: string; opts: ReplicantMetadata },
		cb: (data: ReplicantDeclareResponse<R[keyof R]>) => void
	) => void
}

interface ReplicantAssignmentEvent {
	name: string
	namespace: string
	newValue: unknown
}

interface ReplicantOperationsEvent {
	name: string
	namespace: string
	revision: number
	operations: Array<ReplicantOperation>
}

export interface ReplicantSocketEventMap {
	'replicant:assignment': (event: ReplicantAssignmentEvent) => void
	'replicant:operations': (event: ReplicantOperationsEvent) => void
}
