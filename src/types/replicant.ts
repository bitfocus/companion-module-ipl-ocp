export type BundleMap = {
	[name: string]: ReplicantMap
}

export type ReplicantMap = Record<string, any>

export interface ReplicantMetadata {
	revision: number
	schemaSum?: string
	schema?: Record<string, unknown>
}
