import { DateTime } from 'luxon'
import { CompanionActionDefinitions, InstanceBase } from '@companion-module/base'
import { IPLOCModuleConfig } from './config'
import { NodeCGConnector } from './NodeCGConnector'
import { ActiveBreakScene } from './types'
import { IPLOCBundleMap, DASHBOARD_BUNDLE_NAME, isBlank } from './util'

export function getActionDefinitions(
	self: InstanceBase<IPLOCModuleConfig>,
	socket: NodeCGConnector<IPLOCBundleMap>
): CompanionActionDefinitions {
	return {
		set_win: {
			name: 'Set win on last game',
			options: [
				{
					type: 'dropdown',
					label: 'Team',
					id: 'team',
					default: 'alpha',
					choices: [
						{ id: 'alpha', label: 'Alpha Team' },
						{ id: 'bravo', label: 'Bravo Team' },
					],
				},
			],
			callback: (action) => {
				// First check we don't go over the number of games that can be assigned
				const activeRound = socket.replicants[DASHBOARD_BUNDLE_NAME]['activeRound']
				if (activeRound != null && activeRound.teamA.score + activeRound.teamB.score < activeRound.games.length) {
					socket.sendMessage('setWinner', { winner: action.options.team })
				}
			},
		},
		remove_win: {
			name: 'Remove the last win for either team.',
			options: [],
			callback: () => {
				// Check there's scores to remove
				const activeRound = socket.replicants[DASHBOARD_BUNDLE_NAME]['activeRound']
				if (activeRound != null && activeRound.teamA.score + activeRound.teamB.score > 0) {
					socket.sendMessage('removeWinner')
				}
			},
		},
		show_caster: {
			name: 'Show Casters on Main Scene.',
			options: [],
			callback: () => {
				socket.sendMessage('mainShowCasters')
			},
		},
		show_predictions: {
			name: 'Show Predictions.',
			options: [],
			callback: () => {
				socket.sendMessage('showPredictionData')
			},
		},
		get_live_commentators: {
			name: 'Load Commentators from VC.',
			options: [],
			callback: () => {
				socket.sendMessage('getLiveCommentators')
			},
		},
		swap_colour: {
			name: 'Swap scoreboard color.',
			options: [],
			callback: () => {
				socket.proposeReplicantAssignment(
					'swapColorsInternally',
					DASHBOARD_BUNDLE_NAME,
					!socket.replicants[DASHBOARD_BUNDLE_NAME]['swapColorsInternally']
				)
			},
		},
		cycle_colour: {
			name: 'Cycle colour in game',
			options: [
				{
					type: 'dropdown',
					label: 'Colour Direction',
					id: 'direction',
					default: 'next',
					choices: [
						{ id: 'next', label: 'Next Colour' },
						{ id: 'previous', label: 'Previous Colour' },
					],
				},
			],
			callback: (action) => {
				if (action.options.direction === 'next') {
					socket.sendMessage('switchToNextColor')
				} else if (action.options.direction === 'previous') {
					socket.sendMessage('switchToPreviousColor')
				}
			},
		},
		scoreboard_visibility: {
			name: 'Show/Hide/Toggle Scoreboard on main',
			options: [
				{
					type: 'dropdown',
					label: 'Change',
					id: 'change',
					default: 'toggle',
					choices: [
						{ id: 'hide', label: 'Hide Scoreboard' },
						{ id: 'show', label: 'Show Scoreboard' },
						{ id: 'toggle', label: 'Toggle Scoreboard' },
					],
				},
			],
			callback: (action) => {
				if (action.options.change === 'hide' || action.options.change === 'show') {
					socket.proposeReplicantOperations('scoreboardData', DASHBOARD_BUNDLE_NAME, [
						{
							path: '/',
							method: 'update',
							args: {
								prop: 'isVisible',
								newValue: action.options.change === 'show',
							},
						},
					])
				} else {
					socket.proposeReplicantOperations('scoreboardData', DASHBOARD_BUNDLE_NAME, [
						{
							path: '/',
							method: 'update',
							args: {
								prop: 'isVisible',
								newValue: !socket.replicants[DASHBOARD_BUNDLE_NAME].scoreboardData?.isVisible,
							},
						},
					])
				}
			},
		},
		change_break_scene: {
			name: 'Change break scene',
			options: [
				{
					type: 'dropdown',
					label: 'Scene',
					id: 'scene',
					default: 'main',
					choices: [
						{ id: 'main', label: 'Main' },
						{ id: 'teams', label: 'Teams' },
						{ id: 'stages', label: 'Stages' },
					],
				},
			],
			callback: (action) => {
				const newScene = String(action.options.scene)
				if (
					newScene != null &&
					newScene !== socket.replicants[DASHBOARD_BUNDLE_NAME]['activeBreakScene'] &&
					['main', 'teams', 'stages'].includes(newScene)
				) {
					socket.proposeReplicantAssignment('activeBreakScene', DASHBOARD_BUNDLE_NAME, newScene as ActiveBreakScene)
				}
			},
		},
		music_visibility: {
			name: 'Show/Hide/Toggle Music',
			options: [
				{
					type: 'dropdown',
					label: 'Change',
					id: 'change',
					default: 'toggle',
					choices: [
						{ id: 'hide', label: 'Hide Music' },
						{ id: 'show', label: 'Show Music' },
						{ id: 'toggle', label: 'Toggle Music' },
					],
				},
			],
			callback: (action) => {
				if (action.options.change === 'hide' || action.options.change === 'show') {
					socket.proposeReplicantAssignment('musicShown', DASHBOARD_BUNDLE_NAME, action.options.change === 'show')
				} else {
					socket.proposeReplicantAssignment(
						'musicShown',
						DASHBOARD_BUNDLE_NAME,
						!socket.replicants[DASHBOARD_BUNDLE_NAME]['musicShown']
					)
				}
			},
		},
		set_stage_timer: {
			name: 'Set Next Stage Timer',
			options: [
				{
					type: 'textinput',
					label: '+ Minutes',
					id: 'minutes',
					tooltip:
						'How many minutes in the future you want the time set to. Must be numeric, may be a variable reference.',
					default: '5',
					useVariables: true,
				},
			],
			callback: async (action, context) => {
				const parsedMinutes = await context.parseVariablesInString(String(action.options.minutes))
				const minutes = Number(parsedMinutes)

				if (minutes != null && !isNaN(minutes)) {
					const normalizedMinutes = Math.max(0, minutes)
					const time = DateTime.local().plus({ minutes: normalizedMinutes }).set({ second: 0 }).toUTC().toISO()
					socket.proposeReplicantOperations('nextRoundStartTime', DASHBOARD_BUNDLE_NAME, [
						{
							path: '/',
							method: 'update',
							args: {
								prop: 'startTime',
								newValue: time,
							},
						},
					])
				} else {
					self.log('error', `Value of option "Minutes" was "${parsedMinutes}", which is not numeric!`)
				}
			},
		},
		add_to_stage_timer: {
			name: 'Add to next stage timer',
			options: [
				{
					type: 'textinput',
					label: '+ Minutes',
					id: 'minutes',
					tooltip: 'How many minutes to add to the timer. Must be numeric, may be a variable reference.',
					default: '1',
					useVariables: true,
				},
			],
			callback: async (action, context) => {
				const parsedMinutes = await context.parseVariablesInString(String(action.options.minutes))
				const minutes = Number(parsedMinutes)
				if (minutes == null || isNaN(minutes)) {
					self.log('error', `Value of option "Minutes" was "${parsedMinutes}", which is not numeric!`)
					return
				} else if (socket.replicants[DASHBOARD_BUNDLE_NAME]?.nextRoundStartTime?.startTime == null) {
					self.log('error', 'Replicant "nextRoundStartTime" has not yet been initialized.')
					return
				}

				const normalizedMinutes = Math.max(0, minutes)
				// @ts-ignore: TypeScript doesn't understand the above null check
				const time = DateTime.fromISO(socket.replicants[DASHBOARD_BUNDLE_NAME].nextRoundStartTime.startTime)
					.plus({ minutes: normalizedMinutes })
					.toUTC()
					.toISO()
				socket.proposeReplicantOperations('nextRoundStartTime', DASHBOARD_BUNDLE_NAME, [
					{
						path: '/',
						method: 'update',
						args: {
							prop: 'startTime',
							newValue: time,
						},
					},
				])
			},
		},
		timer_visibility: {
			name: 'Show/Hide/Toggle Timer',
			options: [
				{
					type: 'dropdown',
					label: 'Change',
					id: 'change',
					default: 'toggle',
					choices: [
						{ id: 'hide', label: 'Hide Timer' },
						{ id: 'show', label: 'Show Timer' },
						{ id: 'toggle', label: 'Toggle Timer' },
					],
				},
			],
			callback: (action) => {
				if (action.options.change === 'hide' || action.options.change === 'show') {
					socket.proposeReplicantOperations('nextRoundStartTime', DASHBOARD_BUNDLE_NAME, [
						{
							path: '/',
							method: 'update',
							args: {
								prop: 'isVisible',
								newValue: action.options.change === 'show',
							},
						},
					])
				} else {
					socket.proposeReplicantOperations('nextRoundStartTime', DASHBOARD_BUNDLE_NAME, [
						{
							path: '/',
							method: 'update',
							args: {
								prop: 'isVisible',
								newValue: !socket.replicants[DASHBOARD_BUNDLE_NAME]['nextRoundStartTime']?.isVisible,
							},
						},
					])
				}
			},
		},
		next_on_stream_visibility: {
			name: 'Show/Hide/Toggle Show next match on stream',
			options: [
				{
					type: 'dropdown',
					label: 'Change',
					id: 'change',
					default: 'toggle',
					choices: [
						{ id: 'hide', label: 'Hide Next Match' },
						{ id: 'show', label: 'Show Next Match' },
						{ id: 'toggle', label: 'Toggle Next Match' },
					],
				},
			],
			callback: (action) => {
				if (action.options.change === 'hide' || action.options.change === 'show') {
					socket.proposeReplicantOperations('nextRound', DASHBOARD_BUNDLE_NAME, [
						{
							path: '/',
							method: 'update',
							args: {
								prop: 'showOnStream',
								newValue: action.options.change === 'show',
							},
						},
					])
				} else {
					socket.proposeReplicantOperations('nextRound', DASHBOARD_BUNDLE_NAME, [
						{
							path: '/',
							method: 'update',
							args: {
								prop: 'showOnStream',
								newValue: !socket.replicants[DASHBOARD_BUNDLE_NAME]['nextRound']?.showOnStream,
							},
						},
					])
				}
			},
		},
		do_automation_action: {
			name: 'Execute the next automation action (Start/Stop game, etc.)',
			options: [],
			callback: () => {
				if (socket.replicants[DASHBOARD_BUNDLE_NAME].obsData?.status !== 'CONNECTED') {
					self.log('error', 'The OBS socket is not enabled!')
					return
				}

				const nextTaskName = socket.replicants[DASHBOARD_BUNDLE_NAME].gameAutomationData?.nextTaskForAction?.name ?? ''
				if (
					socket.replicants[DASHBOARD_BUNDLE_NAME].gameAutomationData?.actionInProgress !== 'NONE' &&
					!isBlank(nextTaskName)
				) {
					socket.sendMessage('fastForwardToNextGameAutomationTask')
				} else if (
					socket.replicants[DASHBOARD_BUNDLE_NAME].obsData?.gameplayScene ===
					socket.replicants[DASHBOARD_BUNDLE_NAME].obsData?.currentScene
				) {
					socket.sendMessage('endGame')
				} else {
					socket.sendMessage('startGame')
				}
			},
		},
		reconnect: {
			name: 'Reconnect to NodeCG',
			options: [],
			callback: () => {
				socket.start()
			},
		},
	}
}
