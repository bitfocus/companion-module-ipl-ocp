import { io, Socket } from 'socket.io-client'
import { isBlank } from './helpers/StringHelper'
import EventEmitter from 'events'
import TypedEventEmitter from 'typed-emitter'
import * as ObjectPath from 'object-path'
import { BundleMap, ReplicantMetadata, ReplicantOperation } from './types/replicant'
import { ReplicantDeclareResponse, ReplicantSocketEventMap, ReplicantSocketMessageMap } from './types/replicantSocket'
import { InstanceBase } from '@companion-module/base'

interface NodeCGOptions {
  host?: string
  port?: string
}

const ARRAY_MUTATOR_METHODS = ['copyWithin', 'fill', 'pop', 'push', 'reverse', 'shift', 'sort', 'splice', 'unshift']

type NodeCGConnectorEventMap = {
  connect: () => void
  disconnect: (reason: string) => void
  replicantUpdate: (name: string) => void
  error: (err: Error) => void
}

type ReplicantDataMap<B extends BundleMap> = { [Key in keyof B]: Array<keyof B[Key]> }

type ReplicantMetadataMap<B extends BundleMap> = { [Bundle in keyof B]: { [R in keyof B[Bundle]]: ReplicantMetadata } }

export class NodeCGConnector<
  B extends BundleMap
> extends (EventEmitter as new () => TypedEventEmitter<NodeCGConnectorEventMap>) {
  readonly replicants: B
  readonly replicantMetadata: ReplicantMetadataMap<B>
  readonly replicantNames: ReplicantDataMap<B>
  private opts: NodeCGOptions
  private socket: Socket<ReplicantSocketEventMap, ReplicantSocketMessageMap<B>> | undefined
  private instance: InstanceBase<unknown>

  constructor(instance: InstanceBase<unknown>, opts: NodeCGOptions, replicants: ReplicantDataMap<B>) {
    super()

    this.instance = instance
    this.replicantNames = replicants
    this.replicants = Object.keys(replicants).reduce((result, bundleName) => {
      result[bundleName] = {}
      return result
    }, {} as Record<string, unknown>) as B

    this.replicantMetadata = Object.entries(replicants).reduce((result, [bundle, replicants]) => {
      result[bundle] = replicants.reduce((resultForBundle: Record<string, ReplicantMetadata>, rep: string) => {
        resultForBundle[rep] = {
          revision: 0,
          schemaSum: '',
          opts: {
            schemaPath: `bundles/${bundle}/schemas/${rep}.json`,
            persistent: true,
            persistenceInterval: 100,
          },
        }
        return resultForBundle
      }, {})

      return result
    }, {} as Record<string, Record<string, ReplicantMetadata>>) as ReplicantMetadataMap<B>

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

    this.instance.log('info', 'socket declared')
    this.socket = io(`ws://${this.opts.host}:${this.opts.port}`, { reconnection: true })

    this.socket.on('connect', () => {
      for (const [bundle, replicants] of Object.entries(this.replicantNames)) {
        this.socket!.emit('joinRoom', bundle, () => {
          replicants.forEach((replicant: string) => {
            this.socket!.emit('joinRoom', `replicant:${bundle}:${replicant}`, () => {
              this.socket!.emit(
                'replicant:declare',
                {
                  name: String(replicant),
                  namespace: bundle,
                  opts: this.replicantMetadata[bundle][replicant],
                },
                (err, data: ReplicantDeclareResponse<unknown>) => {
                  if (err) {
                    this.instance.log('error', `Failed to declare replicant ${replicant}: ${err}`)
                    return
                  }

                  ;(this.replicants[bundle][replicant] as unknown) = data.value
                  this.replicantMetadata[bundle][replicant].revision = data.revision
                  this.replicantMetadata[bundle][replicant].schemaSum = data.schemaSum
                  this.emit('replicantUpdate', String(replicant))
                }
              )
            })
          })
        })
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
            operation.result = this.applyOperation(
              data.namespace,
              data.name,
              this.replicants[data.namespace][data.name],
              operation
            )
          })
        }

        metadata.revision = data.revision
        this.emit('replicantUpdate', data.name)
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

  public async readReplicant<Bundle extends keyof B, Name extends keyof B[Bundle]>(
    name: Name,
    bundleName: Bundle
  ): Promise<B[Bundle][Name]> {
    return new Promise((resolve, reject) => {
      this.socket!.emit('replicant:read', { namespace: String(bundleName), name: String(name) }, (err, value) => {
        if (err) {
          return reject(err)
        } else {
          return resolve(value as B[Bundle][Name])
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

  public proposeReplicantOperations<Bundle extends keyof B>(
    name: keyof B[Bundle],
    bundleName: Bundle,
    operations: Array<ReplicantOperation>
  ) {
    if (this.socket != null && this.shouldHandleReplicant(String(name), String(bundleName))) {
      this.socket.emit(
        'replicant:proposeOperations',
        {
          name: String(name),
          namespace: String(bundleName),
          operations: operations,
          revision: this.replicantMetadata[bundleName][name].revision,
          schemaSum: this.replicantMetadata[bundleName][name].schemaSum,
          opts: this.replicantMetadata[bundleName][name].opts,
        },
        (rejectReason, data) => {
          const metadata = this.replicantMetadata[bundleName][name]

          if (data?.schemaSum) {
            metadata.schemaSum = data.schemaSum
          }

          if (data && data.revision !== metadata.revision) {
            metadata.revision = data.revision
            ;(this.replicants[bundleName][name] as unknown) = data.value
            this.emit('replicantUpdate', String(name))
          }

          if (rejectReason) {
            this.instance.log('error', `Replicant assignment rejected: ${rejectReason}`)
          }
        }
      )
    }
  }

  public proposeReplicantAssignment<Bundle extends keyof B, Rep extends keyof B[Bundle]>(
    name: Rep,
    bundleName: Bundle,
    newValue: B[Bundle][Rep]
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

  private shouldHandleReplicant(name: string | number, bundle: string): boolean {
    return this.replicantNames[bundle]?.includes(name) ?? false
  }

  private applyOperation<T extends object>(
    namespace: string,
    name: string,
    replicant: T,
    operation: ReplicantOperation
  ): boolean {
    let result
    const path = NodeCGConnector.pathStrToPathArr(operation.path)
    if (ARRAY_MUTATOR_METHODS.includes(operation.method)) {
      const arr = ObjectPath.get(replicant, path)
      result = arr[operation.method].apply(arr, operation.args)
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

    // @ts-ignore
    return result
  }
}
