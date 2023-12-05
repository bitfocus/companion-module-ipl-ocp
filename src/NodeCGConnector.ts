import { io } from 'socket.io-client'
import { isBlank } from './helpers/StringHelper'
import EventEmitter from 'events'
import TypedEventEmitter from 'typed-emitter'
import ObjectPath from 'object-path'
import { BundleMap, ReplicantMetadata } from './types/replicant'
import { InstanceBase } from '@companion-module/base'
import type NodeCG from '@nodecg/types'
import type NodeCGSocketProtocol from '@nodecg/types/types/socket-protocol'

interface NodeCGOptions {
  host?: string
  port?: string
}

const ARRAY_MUTATOR_METHODS = ['copyWithin', 'fill', 'pop', 'push', 'reverse', 'shift', 'sort', 'splice', 'unshift']

type NodeCGConnectorEventMap = {
  connect: () => void
  disconnect: (reason: string) => void
  replicantUpdate: (name: string, bundleName: string) => void
  error: (err: Error) => void
}

type ReplicantNameMap<B extends BundleMap> = { [Key in keyof B]: Array<keyof B[Key]> }

export class NodeCGConnector<
  Bundles extends BundleMap
> extends (EventEmitter as new () => TypedEventEmitter<NodeCGConnectorEventMap>) {
  readonly replicants: Bundles
  readonly replicantMetadata: Record<string, Record<string, ReplicantMetadata>>
  readonly replicantNames: ReplicantNameMap<Bundles>
  private opts: NodeCGOptions
  private socket: NodeCGSocketProtocol.TypedClientSocket | undefined
  private instance: InstanceBase<unknown>

  constructor(instance: InstanceBase<unknown>, opts: NodeCGOptions, replicantNames: ReplicantNameMap<Bundles>) {
    super()

    this.instance = instance
    this.replicantNames = replicantNames
    this.replicants = Object.keys(this.replicantNames).reduce((result, bundleName) => {
      result[bundleName] = {}
      return result
    }, {} as Record<string, unknown>) as Bundles
    this.replicantMetadata = {}

    this.opts = opts

    return this
  }

  public updateConfig(opts: NodeCGOptions): void {
    this.opts = opts
    this.start()
  }

  public start() {
    if (isBlank(this.opts.host) || isBlank(this.opts.port)) {
      throw new Error('NodeCG host or port is not defined.')
    }

    this.disconnect()

    this.socket = io(`ws://${this.opts.host}:${this.opts.port}`, { reconnection: true })

    this.socket.on('connect', async () => {
      for (const [bundle, replicants] of Object.entries(this.replicantNames)) {
        for (const replicant of replicants) {
          await this.socket!.emitWithAck('joinRoom', `replicant:${bundle}:${replicant}`)
          this.instance.log('debug', `Joined room for replicant ${replicant} in bundle ${bundle}`)

          this.socket!.emit(
            'replicant:declare',
            {
              name: replicant,
              namespace: bundle,
              opts: {},
            },
            (err, result) => {
              if (err != null) {
                this.instance.log('error', `Failed to declare replicant ${replicant} for bundle ${bundle}: ${err}`)
                return
              }

              this.instance.log('debug', `Declared replicant ${replicant} in bundle ${bundle}`)

              if (!this.replicantMetadata[bundle]) {
                this.replicantMetadata[bundle] = {}
              }
              this.replicantMetadata[bundle][replicant] = {
                revision: result!.revision,
                schemaSum: 'schema' in result! ? result.schemaSum : undefined,
                schema: 'schema' in result! ? result.schema : undefined,
              }

              this.replicants[bundle][replicant] = result!.value
              this.emit('replicantUpdate', replicant, bundle)
            }
          )
        }
      }

      this.emit('connect')
    })

    this.socket.on('connect_error', (data) => {
      this.emit('error', data)
    })

    this.socket.on('replicant:operations', async (data) => {
      if (this.shouldHandleReplicant(data.name, data.namespace)) {
        const metadata = this.replicantMetadata[data.namespace][data.name]
        const expectedRevision = metadata.revision + 1

        if (expectedRevision !== data.revision) {
          this.instance.log(
            'warn',
            `Expected revision for replicant ${data.name} to be ${expectedRevision}, but got ${data.revision}; forcing full update.`
          )
          this.replicants[data.namespace][data.name] = await this.readReplicant(data.name, data.namespace)
        } else {
          data.operations.forEach((operation) => {
            this.applyOperation(data.namespace, data.name, this.replicants[data.namespace][data.name], operation)
          })
        }

        metadata.revision = data.revision
        this.emit('replicantUpdate', data.name, data.namespace)
      }
    })

    this.socket.on('disconnect', (data) => {
      this.emit('disconnect', data)
    })
  }

  public disconnect() {
    if (this.socket) {
      this.socket.close()
      delete this.socket
    }
  }

  public async readReplicant<Bundle extends keyof Bundles, Name extends keyof Bundles[Bundle]>(
    name: Name,
    bundleName: Bundle
  ): Promise<Bundles[Bundle][Name]> {
    return new Promise((resolve, reject) => {
      this.socket!.emit('replicant:read', { namespace: String(bundleName), name: String(name) }, (err, value) => {
        if (err) {
          return reject(err)
        } else {
          return resolve(value as Bundles[Bundle][Name])
        }
      })
    })
  }

  public sendMessage<Bundle extends keyof Bundles>(messageName: string, bundleName: Bundle, data?: unknown) {
    this.socket?.emit(
      'message',
      {
        bundleName: String(bundleName),
        messageName: messageName,
        content: data,
      },
      (err) => {
        if (err != null) {
          this.instance.log('error', `Sending message returned error: ${err}`)
        }
      }
    )
  }

  public isConnected(): boolean {
    return this.socket != null && this.socket.connected
  }

  public proposeReplicantOperations<Bundle extends keyof Bundles>(
    name: keyof Bundles[Bundle],
    bundleName: Bundle,
    operations: Array<NodeCG.Replicant.Operation<unknown>>
  ) {
    if (this.socket != null && this.shouldHandleReplicant(String(name), String(bundleName))) {
      // shouldHandleReplicant above asserts that this is present
      const metadata = this.replicantMetadata[bundleName as string][name as string]

      this.socket.emit(
        'replicant:proposeOperations',
        {
          name: String(name),
          namespace: String(bundleName),
          operations: operations,
          revision: metadata.revision,
          schemaSum: metadata.schemaSum,
          opts: {},
        },
        (rejectReason, data) => {
          if (data?.schemaSum) {
            metadata.schemaSum = data.schemaSum
          }

          if (data && data.revision !== metadata.revision) {
            metadata.revision = data.revision
            ;(this.replicants[bundleName][name] as unknown) = data.value
            this.emit('replicantUpdate', String(name), String(bundleName))
          }

          if (rejectReason) {
            this.instance.log('error', `Replicant assignment rejected: ${rejectReason}`)
          }
        }
      )
    }
  }

  public proposeReplicantAssignment<Bundle extends keyof Bundles, Rep extends keyof Bundles[Bundle]>(
    name: Rep,
    bundleName: Bundle,
    newValue: Bundles[Bundle][Rep]
  ) {
    this.proposeReplicantOperations(name, bundleName, [{ path: '/', method: 'overwrite', args: { newValue } }])
  }

  private static pathStrToPathArr(path: string): string[] {
    const result = path
      .substring(1)
      .split('/')
      .map((part) => {
        return part.replace(/~1/g, '/')
      })

    if (result.length === 1 && result[0] === '') {
      return []
    }

    return result
  }

  private shouldHandleReplicant(name: string, bundle: string): boolean {
    return this.replicantMetadata[bundle]?.[name] != null
  }

  private applyOperation<T extends object>(
    namespace: string,
    name: string,
    replicant: T,
    operation: NodeCG.Replicant.Operation<unknown>
  ): boolean {
    let result
    const path = NodeCGConnector.pathStrToPathArr(operation.path)
    if (ARRAY_MUTATOR_METHODS.includes(operation.method)) {
      const arr = ObjectPath.get(replicant, path)
      result = arr[operation.method].apply(
        arr,
        'args' in operation && 'mutatorArgs' in operation.args ? operation.args.mutatorArgs : []
      )
    } else {
      switch (operation.method) {
        case 'overwrite': {
          this.replicants[namespace][name] = operation.args.newValue
          result = true
          break
        }

        case 'add':
        case 'update': {
          path.push(operation.args.prop!)

          let { newValue } = operation.args
          result = ObjectPath.set(replicant, path, newValue)
          break
        }

        case 'delete':
          if (path.length === 0 || ObjectPath.has(replicant, path)) {
            const target = ObjectPath.get(replicant, path)
            delete target[operation.args.prop!]
            result = target
          }
          break

        default:
          throw new Error(`Unsupported operation "${operation.method}"`)
      }
    }

    return result
  }
}
