import { modeNameToShortModeName, stageNameToShortStageName } from './helpers/SplatoonData'
import { NodeCGConnector } from './NodeCGConnector'
import {
	InstanceBase,
	InstanceStatus,
	SomeCompanionConfigField,
	combineRgb,
	runEntrypoint,
} from '@companion-module/base'
import { IPLOCModuleConfig, getConfigFields } from './config'
import { UpgradeScripts } from './upgrades'
import { getActionDefinitions } from './actions'
import { getFeedbackDefinitions } from './feedbacks'
import { DASHBOARD_BUNDLE_NAME, IPLOCBundleMap, ReplicantMap, isEmpty } from './util'

class IPLOCInstance extends InstanceBase<IPLOCModuleConfig> {
	private readonly socket = new NodeCGConnector<IPLOCBundleMap>(
		{},
		{
			[DASHBOARD_BUNDLE_NAME]: [
				'activeRound',
				'scoreboardData',
				'swapColorsInternally',
				'activeBreakScene',
				'musicShown',
				'nextRoundStartTime',
				'nextRound',
				'obsData',
				'gameAutomationData',
			],
		}
	)

	async init(config: IPLOCModuleConfig): Promise<void> {
		this.setFeedbackDefinitions(getFeedbackDefinitions(this, this.socket))
		this.setActionDefinitions(getActionDefinitions(this, this.socket))

		this.subscribeFeedbacks()

		this.setVariableDefinitions([
			{
				name: 'Alpha Team Score',
				variableId: 'teams_alpha_score',
			},
			{
				name: 'Bravo Team Score',
				variableId: 'teams_bravo_score',
			},
			{
				name: 'Alpha Team Name',
				variableId: 'teams_alpha_name',
			},
			{
				name: 'Bravo Team Name',
				variableId: 'teams_bravo_name',
			},
			{
				name: 'No. of games in set',
				variableId: 'games_in_set',
			},
			{
				name: 'The next mode to be played',
				variableId: 'next_mode',
			},
			{
				name: 'The next stage to be played',
				variableId: 'next_stage',
			},
		])
		this.setPresetDefinitions({
			matchinfo: {
				category: 'Match info',
				name: 'Next Stage',
				type: 'button',
				style: {
					text: 'Next: $(ocp:next_mode) $(ocp:next_stage)',
					size: 'auto',
					color: combineRgb(255, 255, 255),
					bgcolor: combineRgb(0, 0, 0),
				},
				feedbacks: [],
				steps: [],
			},
		})

		this.socket.on('connect', () => {
			this.checkFeedbacks('nodecg_connection_status')
			this.log('debug', `Connection opened`)
			this.updateStatus(InstanceStatus.Ok)
		})

		this.socket.on('disconnect', (reason) => {
			this.checkFeedbacks('nodecg_connection_status')
			const msg = `NodeCG connection closed. Reason: ${reason}`
			this.log('debug', msg)
			this.updateStatus(InstanceStatus.Disconnected, msg)
		})

		this.socket.on('error', (err) => {
			this.log('error', `Socket.io error: ${err}`)
		})

		this.socket.on('replicantUpdate', (name) => {
			this.assignDynamicVariablesAndFeedback(name as keyof ReplicantMap)
		})

		this.socket.updateConfig({
			host: config.host,
			port: config.port,
		})

		this.socket.start()
	}

	async destroy() {
		this.socket.disconnect()
	}

	async configUpdated(config: IPLOCModuleConfig): Promise<void> {
		this.socket.updateConfig({
			host: config.host,
			port: config.port,
		})
	}

	public getConfigFields(): SomeCompanionConfigField[] {
		return getConfigFields()
	}

	/**
	 * Updates the Companion dynamic variables
	 * @param replicantName replicant that got updated
	 */
	assignDynamicVariablesAndFeedback(replicantName: keyof ReplicantMap) {
		switch (replicantName) {
			case 'activeRound':
				if (!isEmpty(this.socket.replicants[DASHBOARD_BUNDLE_NAME]['activeRound'])) {
					const nextGame = this.socket.replicants[DASHBOARD_BUNDLE_NAME].activeRound?.games.find(
						(game) => game.winner === 'none'
					)

					this.setVariableValues({
						teams_alpha_score: String(this.socket.replicants[DASHBOARD_BUNDLE_NAME]['activeRound']?.teamA.score),
						teams_bravo_score: String(this.socket.replicants[DASHBOARD_BUNDLE_NAME]['activeRound']?.teamB.score),
						teams_alpha_name: this.socket.replicants[DASHBOARD_BUNDLE_NAME]['activeRound']?.teamA.name,
						teams_bravo_name: this.socket.replicants[DASHBOARD_BUNDLE_NAME]['activeRound']?.teamB.name,
						games_in_set: String(this.socket.replicants[DASHBOARD_BUNDLE_NAME]['activeRound']?.games.length),
						next_mode: nextGame?.mode == null ? '??' : modeNameToShortModeName[nextGame.mode] ?? nextGame.mode,
						next_stage: nextGame?.stage == null ? '???' : stageNameToShortStageName[nextGame.stage] ?? nextGame.stage,
					})
				}
				this.checkFeedbacks('team_colour')
				break
			case 'scoreboardData':
				this.checkFeedbacks('scoreboard_visibility')
				break
			case 'nextRoundStartTime':
				this.checkFeedbacks('timer_visibility')
				break
			case 'musicShown':
				this.checkFeedbacks('music_visibility')
				break
			case 'activeBreakScene':
				this.checkFeedbacks('break_scene_visibility')
				break
			case 'nextRound':
				this.checkFeedbacks('show_next_match_on_stream')
				break
			case 'gameAutomationData':
			case 'obsData':
				this.checkFeedbacks('automation_action_state')
				break
		}
	}
}

runEntrypoint(IPLOCInstance, UpgradeScripts)
