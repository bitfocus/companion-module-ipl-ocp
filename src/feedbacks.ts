import { colord } from 'colord'
import { CompanionFeedbackDefinitions, combineRgb } from '@companion-module/base'
import { DASHBOARD_BUNDLE_NAME, IPLOCBundleMap, isBlank, isEmpty, UNKNOWN_MODE_NAME, UNKNOWN_STAGE_NAME } from './util'
import { NodeCGConnector } from './NodeCGConnector'
import { IPLOCInstance } from './index'

export enum IPLOCFeedback {
	team_colour = 'team_colour',
	scoreboard_visibility = 'scoreboard_visibility',
	music_visibility = 'music_visibility',
	timer_visibility = 'timer_visibility',
	show_next_match_on_stream = 'show_next_match_on_stream',
	break_scene_visibility = 'break_scene_visibility',
	automation_action_state = 'automation_action_state',
	automation_action_advancing_soon = 'automation_action_advancing_soon',
	next_selected_stage = 'next_selected_stage',
	next_selected_mode = 'next_selected_mode',
	colors_swapped = 'colors_swapped',
}

export function getFeedbackDefinitions(
	self: IPLOCInstance,
	socket: NodeCGConnector<IPLOCBundleMap>
): CompanionFeedbackDefinitions {
	return {
		...socket.getFeedbacks(),

		[IPLOCFeedback.team_colour]: {
			type: 'advanced',
			name: 'Change BG colour to teams colour',
			description: 'Change colour of background when updated.',
			options: [
				{
					type: 'dropdown',
					label: 'Team',
					id: 'team',
					default: 'teamA',
					choices: [
						{ id: 'teamA', label: 'Alpha Team' },
						{ id: 'teamB', label: 'Bravo Team' },
					],
				},
			],
			callback: function (feedback) {
				const activeRound = socket.replicants[DASHBOARD_BUNDLE_NAME].activeRound
				if (!isEmpty(activeRound)) {
					const teamColor = activeRound?.[feedback.options.team as 'teamA' | 'teamB'].color
					if (teamColor != null) {
						const bgcolor = colord(teamColor).toRgb()
						// Choose what text colour to use for feedback depending on the background colour
						const colour = (bgcolor.r * 299 + bgcolor.g * 587 + bgcolor.b * 114) / 1000 >= 128 ? 30 : 230
						return {
							bgcolor: combineRgb(bgcolor.r, bgcolor.g, bgcolor.b),
							color: combineRgb(colour, colour, colour),
						}
					}
				}
				return {}
			},
		},

		[IPLOCFeedback.scoreboard_visibility]: {
			type: 'boolean',
			name: 'Scoreboard Visibility',
			description: 'Change background colour when scoreboard is visible.',
			defaultStyle: {
				bgcolor: combineRgb(0, 255, 0),
				color: combineRgb(0, 0, 0),
			},
			options: [],
			callback: function () {
				const scoreboardData = socket.replicants[DASHBOARD_BUNDLE_NAME]['scoreboardData']
				if (scoreboardData?.isVisible != null) {
					return scoreboardData.isVisible
				}

				return false
			},
		},

		[IPLOCFeedback.music_visibility]: {
			type: 'boolean',
			name: 'Music Visibility',
			description: 'Change background colour when music is visible.',
			defaultStyle: {
				bgcolor: combineRgb(0, 255, 0),
				color: combineRgb(0, 0, 0),
			},
			options: [],
			callback: function () {
				return socket.replicants[DASHBOARD_BUNDLE_NAME]['musicShown'] ?? false
			},
		},

		[IPLOCFeedback.timer_visibility]: {
			type: 'boolean',
			name: 'Timer Visibility',
			description: 'Change background colour when timer is visible.',
			defaultStyle: {
				bgcolor: combineRgb(0, 255, 0),
				color: combineRgb(0, 0, 0),
			},
			options: [],
			callback: function () {
				return socket.replicants[DASHBOARD_BUNDLE_NAME].nextRoundStartTime?.isVisible ?? false
			},
		},

		[IPLOCFeedback.show_next_match_on_stream]: {
			type: 'boolean',
			name: 'Next Match Visibility',
			description: 'Change background colour when Next match is on stream.',
			defaultStyle: {
				bgcolor: combineRgb(0, 255, 0),
			},
			options: [],
			callback: function () {
				return socket.replicants[DASHBOARD_BUNDLE_NAME].nextRound?.showOnStream ?? false
			},
		},

		[IPLOCFeedback.break_scene_visibility]: {
			type: 'boolean',
			name: 'Break Scene Visibility',
			description: 'Change background colour when selected break scene is visible.',
			defaultStyle: {
				bgcolor: combineRgb(0, 255, 0),
				color: combineRgb(0, 0, 0),
			},
			options: [
				{
					type: 'dropdown',
					label: 'scene',
					id: 'scene',
					default: 'main',
					choices: [
						{ id: 'main', label: 'Main' },
						{ id: 'teams', label: 'Teams' },
						{ id: 'stages', label: 'Stages' },
					],
				},
			],
			callback: function (feedback) {
				if (!isEmpty(socket.replicants[DASHBOARD_BUNDLE_NAME]['activeBreakScene'])) {
					return socket.replicants[DASHBOARD_BUNDLE_NAME]['activeBreakScene'] === feedback.options.scene
				}

				return false
			},
		},

		[IPLOCFeedback.automation_action_state]: {
			type: 'advanced',
			name: 'Automation action state',
			description: "Changes this toggle's color and text to reflect the dashboard's automation action state.",
			options: [],
			callback: () => {
				if (socket.replicants[DASHBOARD_BUNDLE_NAME].obsState?.status !== 'CONNECTED') {
					return {
						text: 'OFF',
						bgcolor: combineRgb(0, 0, 0),
						color: combineRgb(255, 255, 255),
					}
				}

				const nextTaskName = socket.replicants[DASHBOARD_BUNDLE_NAME].gameAutomationData?.nextTaskForAction?.name ?? ''
				if (
					socket.replicants[DASHBOARD_BUNDLE_NAME].gameAutomationData?.actionInProgress !== 'NONE' &&
					!isBlank(nextTaskName)
				) {
					return {
						text:
							{
								changeScene: 'CHANGE SCENE',
								showScoreboard: 'SHOW SB',
								showCasters: 'SHOW CASTERS',
								hideScoreboard: 'HIDE SB',
							}[nextTaskName] ?? nextTaskName,
						size: ['showScoreboard', 'hideScoreboard'].includes(nextTaskName) ? '18' : 'auto',
						bgcolor: combineRgb(0, 0, 0),
						color: combineRgb(255, 255, 255),
					}
				} else {
					const obsState = socket.replicants[DASHBOARD_BUNDLE_NAME].obsState
					const currentConfig = socket.replicants[DASHBOARD_BUNDLE_NAME].obsConfig?.find(
						(item) => item.sceneCollection === obsState.currentSceneCollection
					)
					return currentConfig?.gameplayScene === obsState.currentScene
						? {
								text: 'END GAME',
								bgcolor: combineRgb(255, 0, 0),
								color: combineRgb(255, 255, 255),
						  }
						: {
								text: 'START GAME',
								bgcolor: combineRgb(0, 255, 0),
								color: combineRgb(0, 0, 0),
						  }
				}
			},
		},

		[IPLOCFeedback.automation_action_advancing_soon]: {
			type: 'boolean',
			name: 'Automation action advancing soon',
			description:
				'If the ongoing automation action is about to perform a task (e.g. switching the scene or showing the scoreboard)',
			defaultStyle: {
				bgcolor: combineRgb(255, 255, 0),
				color: combineRgb(0, 0, 0),
			},
			options: [],
			callback: () => {
				return self.automationActionAdvancingSoon
			},
		},

		[IPLOCFeedback.next_selected_mode]: {
			type: 'boolean',
			name: 'Next selected mode',
			description: 'If next selected mode matches',
			defaultStyle: {
				bgcolor: combineRgb(0, 255, 0),
				color: combineRgb(0, 0, 0),
			},
			options: [
				{
					type: 'dropdown',
					id: 'mode',
					label: 'Mode',
					default: UNKNOWN_MODE_NAME,
					choices: self.modeChoices,
				},
			],
			callback: (feedback) => {
				return self.nextSelectedMode === feedback.options.mode
			},
		},

		[IPLOCFeedback.next_selected_stage]: {
			type: 'boolean',
			name: 'Next selected stage',
			description: 'If next selected stage matches',
			defaultStyle: {
				bgcolor: combineRgb(0, 255, 0),
				color: combineRgb(0, 0, 0),
			},
			options: [
				{
					type: 'dropdown',
					id: 'stage',
					label: 'Stage',
					default: UNKNOWN_STAGE_NAME,
					choices: self.stageChoices,
				},
			],
			callback: (feedback) => {
				return self.nextSelectedStage === feedback.options.stage
			},
		},

		[IPLOCFeedback.colors_swapped]: {
			type: 'boolean',
			name: 'Colors swapped',
			description: 'If colors have been swapped',
			defaultStyle: {
				bgcolor: combineRgb(255, 0, 0),
				color: combineRgb(255, 255, 255),
			},
			options: [],
			callback: () => {
				return socket.replicants[DASHBOARD_BUNDLE_NAME].swapColorsInternally ?? false
			},
		},
	}
}
