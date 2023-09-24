export type BundleMap = {
  [name: string]: ReplicantMap
}

export interface ReplicantMap {
  [name: string]: any
}

export interface ReplicantMetadataOpts {
  schemaPath: string
  persistent: boolean
  persistenceInterval: number
}

export interface ReplicantMetadata {
  revision: number
  schemaSum: string
  opts: ReplicantMetadataOpts
}

export interface ReplicantOperation {
  method: string
  path: string
  args: {
    prop?: string
    newValue: unknown
  },
  result?: unknown
}
