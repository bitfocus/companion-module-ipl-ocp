import { DateTime } from 'luxon'
import { CompanionActionDefinitions } from '@companion-module/base'
import { NodeCGConnector } from './NodeCGConnector'
import { ActiveBreakScene } from './types'
import { DASHBOARD_BUNDLE_NAME, IPLOCBundleMap, isBlank, UNKNOWN_MODE_NAME, UNKNOWN_STAGE_NAME } from './util'
import semver from 'semver'
import { IPLOCInstance } from './index'

export function getActionDefinitions(
	self: IPLOCInstance,
	socket: NodeCGConnector<IPLOCBundleMap>
): CompanionActionDefinitions {
	const actions: CompanionActionDefinitions = {
		...socket.getActions(),
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
					socket.sendMessage('setWinner', DASHBOARD_BUNDLE_NAME, { winner: action.options.team })
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
					socket.sendMessage('removeWinner', DASHBOARD_BUNDLE_NAME)
				}
			},
		},
		show_caster: {
			name: 'Show Casters on Main Scene.',
			options: [],
			callback: () => {
				socket.sendMessage('mainShowCasters', DASHBOARD_BUNDLE_NAME)
			},
		},
		show_predictions: {
			name: 'Show Predictions.',
			options: [],
			callback: () => {
				socket.sendMessage('showPredictionData', DASHBOARD_BUNDLE_NAME)
			},
		},
		get_live_commentators: {
			name: 'Load Commentators from VC.',
			options: [],
			callback: () => {
				socket.sendMessage('getLiveCommentators', DASHBOARD_BUNDLE_NAME)
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
					socket.sendMessage('switchToNextColor', DASHBOARD_BUNDLE_NAME)
				} else if (action.options.direction === 'previous') {
					socket.sendMessage('switchToPreviousColor', DASHBOARD_BUNDLE_NAME)
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
					useVariables: true,
					label: '+ Minutes',
					id: 'minutes',
					tooltip:
						'How many minutes in the future you want the time set to. Must be numeric, may be a variable reference.',
					default: '5',
				},
			],
			callback: async (action) => {
				const parsedMinutes = await self.parseVariablesInString(String(action.options.minutes))

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
					useVariables: true,
					label: '+ Minutes',
					id: 'minutes',
					tooltip: 'How many minutes to add to the timer. Must be numeric, may be a variable reference.',
					default: '1',
				},
			],
			callback: async (action) => {
				const parsedMinutes = await self.parseVariablesInString(String(action.options.minutes))
				const minutes = Number(parsedMinutes)
				if (minutes == null || isNaN(minutes)) {
					self.log('error', `Value of option "Minutes" was "${parsedMinutes}", which is not numeric!`)
					return
				} else if (socket.replicants[DASHBOARD_BUNDLE_NAME]?.nextRoundStartTime?.startTime == null) {
					self.log('error', 'Replicant "nextRoundStartTime" has not yet been initialized.')
					return
				}

				const normalizedMinutes = Math.max(0, minutes)
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
				if (socket.replicants[DASHBOARD_BUNDLE_NAME].obsState?.status !== 'CONNECTED') {
					self.log('error', 'The OBS socket is not enabled!')
					return
				}

				const nextTaskName = socket.replicants[DASHBOARD_BUNDLE_NAME].gameAutomationData?.nextTaskForAction?.name ?? ''
				const obsState = socket.replicants[DASHBOARD_BUNDLE_NAME].obsState
				const currentConfig = socket.replicants[DASHBOARD_BUNDLE_NAME].obsConfig?.find(
					(item) => item.sceneCollection === obsState.currentSceneCollection
				)

				if (
					socket.replicants[DASHBOARD_BUNDLE_NAME].gameAutomationData?.actionInProgress !== 'NONE' &&
					!isBlank(nextTaskName)
				) {
					socket.sendMessage('fastForwardToNextGameAutomationTask', DASHBOARD_BUNDLE_NAME)
				} else if (currentConfig?.gameplayScene === obsState.currentScene) {
					socket.sendMessage('endGame', DASHBOARD_BUNDLE_NAME)
				} else {
					socket.sendMessage('startGame', DASHBOARD_BUNDLE_NAME)
				}
			},
		},
		set_next_selected_mode: {
			name: 'Select the next mode',
			options: [
				{
					type: 'dropdown',
					id: 'mode',
					label: 'Mode',
					default: UNKNOWN_MODE_NAME,
					choices: self.modeChoices,
				},
			],
			callback: (action) => {
				if (isBlank(action.options.mode as string)) {
					return
				}

				self.setNextSelectedMode(action.options.mode as string)
			},
		},
		set_next_selected_stage: {
			name: 'Select the next stage',
			options: [
				{
					type: 'dropdown',
					id: 'stage',
					label: 'Stage',
					default: UNKNOWN_STAGE_NAME,
					choices: self.stageChoices,
				},
			],
			callback: (action) => {
				if (isBlank(action.options.stage as string)) {
					return
				}

				self.setNextSelectedStage(action.options.stage as string)
			},
		},
		update_next_game: {
			name: 'Update next game',
			description:
				'Updates the next game with the selected stage and mode (See actions "Select the next mode" and "Select the next stage")',
			options: [
				{
					type: 'checkbox',
					id: 'resetStageOnSuccess',
					label: 'Remove next selected stage on success?',
					default: true,
				},
				{
					type: 'checkbox',
					id: 'resetModeOnSuccess',
					label: 'Remove next selected mode on success?',
					default: true,
				},
			],
			callback: (action) => {
				const activeRound = socket.replicants[DASHBOARD_BUNDLE_NAME].activeRound
				if (activeRound == null) return
				const nextGameIndex = activeRound.games.findIndex((game) => game.winner === 'none')
				if (nextGameIndex === -1) return

				const newGames = activeRound.games.map((game, i) =>
					i === nextGameIndex
						? {
								...game,
								mode: self.nextSelectedMode,
								stage: self.nextSelectedStage,
						  }
						: game
				)
				socket.sendMessage('updateActiveGames', DASHBOARD_BUNDLE_NAME, {
					games: newGames,
				})
				if (action.options.resetModeOnSuccess) {
					self.setNextSelectedMode(UNKNOWN_MODE_NAME)
				}
				if (action.options.resetStageOnSuccess) {
					self.setNextSelectedStage(UNKNOWN_STAGE_NAME)
				}
			},
		},
	}

	if (socket.replicants.nodecg != null) {
		const dashboardVersion = socket.replicants.nodecg.bundles?.find(
			(bundle) => bundle.name === DASHBOARD_BUNDLE_NAME
		)?.version

		if (dashboardVersion != null && semver.gte(dashboardVersion, '4.8.0')) {
			actions['start_next_match'] = {
				name: 'Start the next match',
				description: "Set the active match to the next match's teams.",
				options: [],
				callback: () => {
					socket.sendMessage('beginNextMatch', DASHBOARD_BUNDLE_NAME)
				},
			}
		}

		if (dashboardVersion != null && semver.gte(dashboardVersion, '4.14.0')) {
			actions['set_active_colors_from_gameplay_source'] = {
				name: 'Get colors from OBS',
				description: "Read the ink colors in play from OBS and set them as the active match's colors",
				options: [],
				callback: () => {
					socket.sendMessage('setActiveColorsFromGameplaySource', DASHBOARD_BUNDLE_NAME)
				},
			}
		}
	}

	return actions
}
