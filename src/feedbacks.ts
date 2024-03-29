import { colord } from 'colord'
import { CompanionFeedbackDefinitions, InstanceBase, combineRgb } from '@companion-module/base'
import { IPLOCModuleConfig } from './config'
import { DASHBOARD_BUNDLE_NAME, IPLOCBundleMap, isBlank, isEmpty } from './util'
import { NodeCGConnector } from './NodeCGConnector'

export function getFeedbackDefinitions(
	_self: InstanceBase<IPLOCModuleConfig>,
	socket: NodeCGConnector<IPLOCBundleMap>
): CompanionFeedbackDefinitions {
	let feedbacks: CompanionFeedbackDefinitions = {}

	feedbacks['team_colour'] = {
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
					const bgcolour = colord(teamColor).toRgb()
					// Choose what text colour to use for feedback depending on the background colour
					const colour = (bgcolour.r * 299 + bgcolour.g * 587 + bgcolour.b * 114) / 1000 >= 128 ? 30 : 230
					return {
						bgcolor: combineRgb(bgcolour.r, bgcolour.g, bgcolour.b),
						color: combineRgb(colour, colour, colour),
					}
				}
			}
			return {}
		},
	}

	feedbacks['scoreboard_visibility'] = {
		type: 'boolean',
		name: 'Scoreboard Visibility',
		description: 'Change background colour when scoreboard is visible.',
		defaultStyle: {
			bgcolor: combineRgb(0, 255, 0),
		},
		options: [],
		callback: function () {
			const scoreboardData = socket.replicants[DASHBOARD_BUNDLE_NAME]['scoreboardData']
			if (scoreboardData?.isVisible != null) {
				return scoreboardData.isVisible
			}

			return false
		},
	}

	feedbacks['music_visibility'] = {
		type: 'boolean',
		name: 'Music Visibility',
		description: 'Change background colour when music is visible.',
		defaultStyle: {
			bgcolor: combineRgb(0, 255, 0),
		},
		options: [],
		callback: function () {
			return socket.replicants[DASHBOARD_BUNDLE_NAME]['musicShown'] ?? false
		},
	}

	feedbacks['timer_visibility'] = {
		type: 'boolean',
		name: 'Timer Visibility',
		description: 'Change background colour when timer is visible.',
		defaultStyle: {
			bgcolor: combineRgb(0, 255, 0),
		},
		options: [],
		callback: function () {
			return socket.replicants[DASHBOARD_BUNDLE_NAME].nextRoundStartTime?.isVisible ?? false
		},
	}

	feedbacks['show_next_match_on_stream'] = {
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
	}

	feedbacks['break_scene_visibility'] = {
		type: 'boolean',
		name: 'Break Scene Visibility',
		description: 'Change background colour when selected break scene is visible.',
		defaultStyle: {
			bgcolor: combineRgb(0, 255, 0),
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
	}

	feedbacks['automation_action_state'] = {
		type: 'advanced',
		name: 'Automation action state',
		description: "Changes this toggle's color and text to reflect the dashboard's automation action state.",
		options: [],
		callback: () => {
			if (socket.replicants[DASHBOARD_BUNDLE_NAME].obsData?.status !== 'CONNECTED') {
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
				return socket.replicants[DASHBOARD_BUNDLE_NAME].obsData?.gameplayScene ===
					socket.replicants[DASHBOARD_BUNDLE_NAME].obsData?.currentScene
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
	}

	feedbacks['nodecg_connection_status'] = {
		type: 'advanced',
		name: 'NodeCG connection status',
		description: "Changes this toggle's color and text to reflect the NodeCG connection status",
		options: [],
		callback: () => {
			if (socket != null && socket.isConnected()) {
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
	}

	return feedbacks
}
