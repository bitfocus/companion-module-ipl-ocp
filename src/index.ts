import {
	combineRgb,
	DropdownChoice,
	InstanceBase,
	runEntrypoint,
	SomeCompanionConfigField,
} from '@companion-module/base'
import { modeNameToShortModeName, stageNameToShortStageName } from './helpers/SplatoonData'
import { NodeCGConnector } from './NodeCGConnector'
import { getActionDefinitions } from './actions'
import { getFeedbackDefinitions, IPLOCFeedback } from './feedbacks'
import { getConfigFields } from './config'
import { IPLOCBundleMap, IPLOCReplicantMap, UNKNOWN_MODE_NAME, UNKNOWN_STAGE_NAME } from './util'

const DASHBOARD_BUNDLE_NAME = 'ipl-overlay-controls'

interface IPLOCModuleConfig {
	host?: string
	port?: string
}

/**
 * returns if an object is empty
 * @param obj Object to check
 * @return {boolean}
 */
function isEmpty(obj: {} | undefined): boolean {
	return obj != null && Object.keys(obj).length === 0
}

export class IPLOCInstance extends InstanceBase<IPLOCModuleConfig> {
	private socket!: NodeCGConnector<IPLOCBundleMap>

	public modeChoices: DropdownChoice[] = []
	public stageChoices: DropdownChoice[] = []

	public nextSelectedMode: string = UNKNOWN_MODE_NAME
	public nextSelectedStage: string = UNKNOWN_STAGE_NAME

	private automationActionTimeCheckTimeout: NodeJS.Timeout | undefined = undefined
	public automationActionAdvancingSoon = false

	public async init(config: IPLOCModuleConfig): Promise<void> {
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
			{
				name: 'Name of the team that won the most recent game',
				variableId: 'last_winner_name'
			},
			{
				name: 'Name of the team that lost the most recent game',
				variableId: 'last_loser_name'
			}
		])
		this.setPresetDefinitions({
			nextStage: {
				type: 'button',
				category: 'Match info',
				name: 'Next Stage',
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

		this.socket = new NodeCGConnector<IPLOCBundleMap>(
			this,
			{
				host: config.host,
				port: config.port,
			},
			{
				[DASHBOARD_BUNDLE_NAME]: [
					'activeRound',
					'scoreboardData',
					'swapColorsInternally',
					'activeBreakScene',
					'musicShown',
					'nextRoundStartTime',
					'nextRound',
					'obsConfig',
					'obsState',
					'gameAutomationData',
					'localeInfo',
				],
			},
			{
				[DASHBOARD_BUNDLE_NAME]: '^4.14.0',
			}
		)

		this.setFeedbackDefinitions(getFeedbackDefinitions(this, this.socket))
		this.setActionDefinitions(getActionDefinitions(this, this.socket))

		this.socket.on('replicantUpdate', (name) => {
			this.assignDynamicVariablesAndFeedback(name as keyof IPLOCReplicantMap)
		})

		this.socket.start()
	}

	async destroy() {
		this.socket.disconnect()
	}

	public async configUpdated(config: IPLOCModuleConfig): Promise<void> {
		this.socket?.updateConfig({
			host: config.host,
			port: config.port,
		})
	}

	public getConfigFields(): SomeCompanionConfigField[] {
		return getConfigFields()
	}

	public setNextSelectedStage(stage: string) {
		this.nextSelectedStage = stage
		this.checkFeedbacks(IPLOCFeedback.next_selected_stage)
	}

	public setNextSelectedMode(mode: string) {
		this.nextSelectedMode = mode
		this.checkFeedbacks(IPLOCFeedback.next_selected_mode)
	}

	/**
	 * Updates the Companion dynamic variables
	 * @param replicantName replicant that got updated
	 */
	assignDynamicVariablesAndFeedback(replicantName: keyof IPLOCReplicantMap | 'bundles') {
		switch (replicantName) {
			case 'activeRound':
				if (!isEmpty(this.socket.replicants[DASHBOARD_BUNDLE_NAME]['activeRound'])) {
					const games = this.socket.replicants[DASHBOARD_BUNDLE_NAME].activeRound?.games
					const nextGame = games?.find(game => game.winner === 'none')
					const lastGame = games?.findLast(game => game.winner !== 'none')
					const teamAName = this.socket.replicants[DASHBOARD_BUNDLE_NAME]['activeRound']?.teamA.name
					const teamBName = this.socket.replicants[DASHBOARD_BUNDLE_NAME]['activeRound']?.teamB.name

					this.setVariableValues({
						teams_alpha_score: String(this.socket.replicants[DASHBOARD_BUNDLE_NAME]['activeRound']?.teamA.score),
						teams_bravo_score: String(this.socket.replicants[DASHBOARD_BUNDLE_NAME]['activeRound']?.teamB.score),
						teams_alpha_name: teamAName,
						teams_bravo_name: teamBName,
						games_in_set: String(this.socket.replicants[DASHBOARD_BUNDLE_NAME]['activeRound']?.games.length),
						next_mode: nextGame?.mode == null ? '??' : modeNameToShortModeName[nextGame.mode] ?? nextGame.mode,
						next_stage: nextGame?.stage == null ? '???' : stageNameToShortStageName[nextGame.stage] ?? nextGame.stage,
						last_winner_name: lastGame == null ? '--' : lastGame.winner === 'alpha' ? teamAName : teamBName,
						last_loser_name: lastGame == null ? '--' : lastGame.winner === 'alpha' ? teamBName : teamAName
					})
				}
				this.checkFeedbacks(IPLOCFeedback.team_colour)
				break
			case 'scoreboardData':
				this.checkFeedbacks(IPLOCFeedback.scoreboard_visibility)
				break
			case 'nextRoundStartTime':
				this.checkFeedbacks(IPLOCFeedback.timer_visibility)
				break
			case 'musicShown':
				this.checkFeedbacks(IPLOCFeedback.music_visibility)
				break
			case 'activeBreakScene':
				this.checkFeedbacks(IPLOCFeedback.break_scene_visibility)
				break
			case 'nextRound':
				this.checkFeedbacks(IPLOCFeedback.show_next_match_on_stream)
				break
			case 'gameAutomationData':
				this.checkFeedbacks(IPLOCFeedback.automation_action_advancing_soon)

				const executionTimeMillis = this.socket.replicants[DASHBOARD_BUNDLE_NAME].gameAutomationData?.nextTaskForAction?.executionTimeMillis
				const now = new Date().getTime()
				clearTimeout(this.automationActionTimeCheckTimeout)
				if (executionTimeMillis != null && now < executionTimeMillis) {
					if (executionTimeMillis - now > 1000) {
						this.automationActionAdvancingSoon = false

						this.automationActionTimeCheckTimeout = setTimeout(() => {
							this.automationActionAdvancingSoon = true
							this.checkFeedbacks(IPLOCFeedback.automation_action_advancing_soon)
						}, executionTimeMillis - now - 1000)
					} else {
						this.automationActionAdvancingSoon = true
					}
				} else {
					this.automationActionAdvancingSoon = false
				}

				this.checkFeedbacks(IPLOCFeedback.automation_action_advancing_soon)
				this.checkFeedbacks(IPLOCFeedback.automation_action_state)
				break
			case 'obsState':
			case 'obsConfig':
				this.checkFeedbacks(IPLOCFeedback.automation_action_state)
				break
			case 'bundles':
			case 'localeInfo':
				this.modeChoices = Object.entries(this.socket.replicants[DASHBOARD_BUNDLE_NAME].localeInfo?.modes ?? {}).map(
					([stage, name]) => ({ id: stage, label: name })
				)
				this.stageChoices = Object.entries(this.socket.replicants[DASHBOARD_BUNDLE_NAME].localeInfo?.stages ?? {}).map(
					([stage, name]) => ({ id: stage, label: name })
				)
				this.setNextSelectedMode(this.nextSelectedMode)
				this.setNextSelectedStage(this.nextSelectedStage)

				this.setActionDefinitions(getActionDefinitions(this, this.socket))
				this.setFeedbackDefinitions(getFeedbackDefinitions(this, this.socket))
				break
			case 'swapColorsInternally':
				this.checkFeedbacks(IPLOCFeedback.colors_swapped)
				break
		}
	}
}

runEntrypoint(IPLOCInstance, [])
