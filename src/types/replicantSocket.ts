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

interface NodeCallback<T = undefined> {
  (err: string, response: undefined): void;
  (err: undefined, response: T): void;
}

export interface ReplicantSocketMessageMap<R extends ReplicantMap> {
  message: (data: ReplicantSocketMessageMessage, cb: (response?: { name: string; message: string }) => void) => void
  'replicant:proposeOperations': (
    data: {
      name: string
      namespace: string
      operations: Array<ReplicantOperation>
      revision: number
      schemaSum: string
      opts: ReplicantMetadataOpts
    },
    cb: (
      rejectReason: string | undefined,
      data: {
        value: any;
        revision: number;
        schema?: Record<string, any>;
        schemaSum?: string;
      }
    ) => void
  ) => void
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
    cb: (err: string | undefined, data: ReplicantDeclareResponse<R[keyof R]>) => void
  ) => void
  'replicant:read': (
    request: {
      name: string;
      namespace: string;
    },
    callback: NodeCallback<unknown>,
  ) => void;
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
