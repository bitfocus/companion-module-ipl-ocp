import { Regex, SomeCompanionConfigField } from '@companion-module/base'

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
			value: 'Tested with ipl-overlay-controls 4.7.0 running on NodeCG 2.1',
		},
		{
			type: 'textinput',
			id: 'host',
			label: 'Target host',
			tooltip: 'The host of the NodeCG instance running IPL OCP',
			width: 6,
			default: '127.0.0.1',
		},
		{
			type: 'textinput',
			id: 'port',
			label: 'Port',
			tooltip: 'The port of the NodeCG instance running IPL OCP',
			width: 6,
			regex: Regex.NUMBER,
			default: '9090',
		},
	]
}
