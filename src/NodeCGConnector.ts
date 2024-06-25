import { io } from 'socket.io-client'
import { isBlank } from './helpers/StringHelper'
import EventEmitter from 'events'
import TypedEventEmitter from 'typed-emitter'
import ObjectPath from 'object-path'
import { BundleMap, ReplicantMetadata } from './types/replicant'
import {
	combineRgb,
	CompanionActionDefinitions,
	CompanionFeedbackDefinitions,
	InstanceBase,
	InstanceStatus,
} from '@companion-module/base'
import type NodeCG from '@nodecg/types'
import type NodeCGSocketProtocol from '@nodecg/types/types/socket-protocol'
import semver from 'semver'

interface NodeCGOptions {
	host?: string
	port?: string
}

const ARRAY_MUTATOR_METHODS = ['copyWithin', 'fill', 'pop', 'push', 'reverse', 'shift', 'sort', 'splice', 'unshift']

type NodeCGConnectorEventMap = {
	replicantUpdate: (name: string, bundleName: string) => void
}

type ReplicantNameMap<B extends BundleMap> = { [Key in keyof B]: Array<keyof B[Key]> }

type BundleVersionMap<B extends BundleMap> = { [Key in keyof B]: string | null }

export enum NodeCGConnectorFeedback {
	nodecg_connection_status = 'nodecg_connection_status',
}

export enum NodeCGConnectorAction {
	reconnect = 'reconnect',
}

interface DefaultBundleMap {
	nodecg: {
		bundles: NodeCG.Bundle[]
	}
}

const defaultReplicantNames = {
	nodecg: ['bundles'],
}

export class NodeCGConnector<
	Bundles extends BundleMap
> extends (EventEmitter as new () => TypedEventEmitter<NodeCGConnectorEventMap>) {
	replicants: Bundles & DefaultBundleMap
	replicantMetadata: Record<string, Record<string, ReplicantMetadata>>
	readonly replicantNames: ReplicantNameMap<Bundles & DefaultBundleMap>
	readonly requiredBundleVersions: BundleVersionMap<Bundles>
	private opts: NodeCGOptions
	private socket: NodeCGSocketProtocol.TypedClientSocket | undefined
	private instance: InstanceBase<unknown>

	constructor(
		instance: InstanceBase<unknown>,
		opts: NodeCGOptions,
		replicantNames: ReplicantNameMap<Bundles>,
		requiredBundleVersions: BundleVersionMap<Bundles>
	) {
		super()

		this.instance = instance
		this.replicantNames = {
			...replicantNames,
			...defaultReplicantNames,
		}
		this.replicantMetadata = this.getEmptyBundleMap() as Record<string, Record<string, ReplicantMetadata>>
		this.replicants = this.getEmptyBundleMap() as Bundles & DefaultBundleMap
		this.requiredBundleVersions = requiredBundleVersions

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
		this.instance.updateStatus(InstanceStatus.Connecting)

		this.socket.on('connect', async () => {
			this.replicantMetadata = this.getEmptyBundleMap() as Record<string, Record<string, ReplicantMetadata>>
			this.replicants = this.getEmptyBundleMap() as Bundles & DefaultBundleMap

			try {
				await this.declareReplicant('bundles', 'nodecg')
			} catch (e) {
				this.instance.log('error', `Failed to get NodeCG bundle list: ${e}`)
				this.instance.updateStatus(
					InstanceStatus.ConnectionFailure,
					'Failed to get list of bundles while connecting to NodeCG'
				)
				return
			}

			await this.onBundleListChange()

			this.instance.log('debug', `NodeCG connection opened`)
			this.instance.checkFeedbacks(NodeCGConnectorFeedback.nodecg_connection_status)
			this.instance.subscribeFeedbacks()
		})

		this.socket.on('connect_error', (err) => {
			const message = 'code' in err && err.code === 'parser error'
				? `Socket.io connection error - ${err} (Is your NodeCG installation up to date?)`
				: `Socket.io connection error - ${err}`

			this.instance.updateStatus(
				InstanceStatus.ConnectionFailure,
				message
			)
			this.instance.log('error', message)
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
				if (data.name === 'bundles' && data.namespace === 'nodecg') {
					await this.onBundleListChange()
				}
				this.emit('replicantUpdate', data.name, data.namespace)
			}
		})

		this.socket.on('disconnect', (reason) => {
			const msg = `NodeCG connection closed. Reason: ${reason}`
			this.instance.checkFeedbacks(NodeCGConnectorFeedback.nodecg_connection_status)
			this.instance.log('debug', msg)
			this.instance.updateStatus(InstanceStatus.Disconnected, msg)
			if (reason === 'io server disconnect') {
				this.socket?.connect()
			}
		})
	}

	public disconnect() {
		if (this.socket) {
			this.socket.close()
			delete this.socket
		}
	}

	private async readReplicant<T>(name: string, bundleName: string): Promise<T> {
		return new Promise((resolve, reject) => {
			this.socket!.emit('replicant:read', { namespace: bundleName, name: name }, (err, value) => {
				if (err) {
					return reject(err)
				} else {
					return resolve(value as T)
				}
			})
		})
	}

	private async onBundleListChange() {
		const missingBundles: string[] = []
		let badBundleVersionMessage = ''

		for (const [bundle, replicants] of Object.entries(this.replicantNames)) {
			if (bundle === 'nodecg') continue
			const installedBundle = this.replicants['nodecg']['bundles'].find((nodecgBundle) => nodecgBundle.name === bundle)

			if (installedBundle == null) {
				missingBundles.push(bundle)
				;(this.replicants as Record<string, unknown>)[bundle] = {}
				this.replicantMetadata[bundle] = {}
				continue
			}

			const requiredVersion = this.requiredBundleVersions[bundle]
			if (requiredVersion != null && !semver.satisfies(installedBundle.version, requiredVersion)) {
				badBundleVersionMessage += `${bundle} version does not match range ${requiredVersion} (Currently installed: ${installedBundle.version}). `
			}

			for (const replicant of replicants) {
				if (this.replicantMetadata[bundle][replicant] != null) {
					continue
				}

				try {
					await this.declareReplicant(replicant, bundle)
				} catch (e) {
					this.instance.log('error', `Failed to declare replicant ${replicant} for bundle ${bundle}: ${e}`)
				}
			}
		}

		if (missingBundles.length > 0) {
			this.instance.updateStatus(
				InstanceStatus.UnknownError,
				`Some NodeCG bundles are required by this module but are not installed: ${missingBundles.join(', ')}`
			)
		} else if (badBundleVersionMessage.length > 0) {
			this.instance.updateStatus(
				InstanceStatus.UnknownWarning,
				`${badBundleVersionMessage} This module may not be compatible with the currently installed bundle versions.`
			)
		} else {
			this.instance.updateStatus(InstanceStatus.Ok)
		}
	}

	private async declareReplicant(name: string, bundleName: string): Promise<void> {
		await this.socket!.emitWithAck('joinRoom', `replicant:${bundleName}:${name}`)
		this.instance.log('debug', `Joined room for replicant ${name} in bundle ${bundleName}`)

		return new Promise((resolve, reject) => {
			this.socket!.emit(
				'replicant:declare',
				{
					name: name,
					namespace: bundleName,
					opts: {},
				},
				(err, result) => {
					if (err != null) {
						return reject(err)
					}

					this.instance.log('debug', `Declared replicant ${name} in bundle ${bundleName}`)

					this.replicantMetadata[bundleName][name] = {
						revision: result!.revision,
						schemaSum: 'schema' in result! ? result.schemaSum : undefined,
						schema: 'schema' in result! ? result.schema : undefined,
					}

					this.replicants[bundleName][name] = result!.value
					this.emit('replicantUpdate', name, bundleName)
					resolve()
				}
			)
		})
	}

	public sendMessage<Bundle extends keyof Bundles>(
		messageName: string,
		bundleName: Bundle,
		data?: unknown
	): Promise<unknown> {
		return new Promise((resolve, reject) => {
			this.socket?.emit(
				'message',
				{
					bundleName: String(bundleName),
					messageName: messageName,
					content: data,
				},
				(err, result) => {
					if (err != null) {
						this.instance.log('error', `Sending message returned error: ${err}`)
						reject(err)
					} else {
						resolve(result)
					}
				}
			)
		})
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

	public getFeedbacks(): CompanionFeedbackDefinitions {
		return {
			[NodeCGConnectorFeedback.nodecg_connection_status]: {
				type: 'advanced',
				name: 'NodeCG connection status',
				description: "Changes this toggle's color and text to reflect the NodeCG connection status",
				options: [],
				callback: () => {
					if (this.isConnected()) {
						return {
							color: combineRgb(0, 0, 0),
							bgcolor: combineRgb(0, 255, 0),
							text: 'NODECG READY',
							size: '14',
						}
					} else {
						return {
							color: combineRgb(255, 255, 255),
							bgcolor: combineRgb(255, 0, 0),
							text: 'NODECG OFF',
							size: '14',
						}
					}
				},
			},
		}
	}

	public getActions(): CompanionActionDefinitions {
		return {
			[NodeCGConnectorAction.reconnect]: {
				name: 'Reconnect to NodeCG',
				options: [],
				callback: () => {
					this.start()
				},
			},
		}
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

	private getEmptyBundleMap() {
		return Object.keys(this.replicantNames).reduce((result, bundleName) => {
			result[bundleName] = {}
			return result
		}, {} as Record<string, unknown>)
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
