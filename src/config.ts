import { SomeCompanionConfigField } from '@companion-module/base'

export interface IPLOCModuleConfig {
	host?: string
	port?: string
}

export function getConfigFields(): SomeCompanionConfigField[] {
	return [
		{
			type: 'static-text',
			id: 'info',
			width: 12,
			label: 'Information',
			value: 'This Module has been tested on IPL-OCP 4.0.0',
		},
		{
			type: 'textinput',
			id: 'host',
			label: 'Target host',
			tooltip: 'The host of the NodeCG instance running IPL OCP',
			width: 6,
			default: 'localhost',
		},
		{
			type: 'number',
			id: 'port',
			label: 'Port',
			tooltip: 'The port of the NodeCG instance running IPL OCP',
			width: 6,
			default: 9090,
			min: 1,
			max: 65535,
		},
	]
}
