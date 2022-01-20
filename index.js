let instance_skel = require('../../instance_skel')
const socketIo = require('socket.io-client')
const { colord } = require('colord')
const colourHelper = require('./data/color.json')
const { DateTime } = require('luxon')

// Names of replicants we want to store locally for use
const replicantNames = [
	'activeRound',
	'scoreboardData',
	'swapColorsInternally',
	'activeBreakScene',
	'musicShown',
	'nextRoundStartTime',
]

/**
 * returns if an object is empty
 * @param obj Object to check
 * @return {boolean}
 */
function isEmpty(obj) {
	return Object.keys(obj).length === 0
}

class instance extends instance_skel {
	constructor(system, id, config) {
		super(system, id, config)

		// Stores replicants & metadata
		this.replicants = {}
		this.replicantsMetadata = {}
		replicantNames.forEach((replicantName) => {
			this.replicants[replicantName] = {}
			this.replicantsMetadata[replicantName] = {
				revision: 0,
				schemaSum: '',
				opts: {
					schemaPath: `bundles/ipl-overlay-controls/schemas/${replicantName}.json`,
					persistent: true,
					persistenceInterval: 100,
				},
			}
		})

		if (!this.config) {
			return this
		}

		this.initSocketConnection()
		this.initFeedbacks()
		this.actions()
		this.subscribeFeedbacks()

		return this
	}

	destroy() {
		if (this.socket !== undefined) {
			this.socket.disconnect()
			delete this.socket
		}
	}

	updateConfig(config) {
		this.config = config
		this.setVariableDefinitions([
			{
				label: 'Alpha Team Score',
				name: 'teams_alpha_score',
			},
			{
				label: 'Bravo Team Score',
				name: 'teams_bravo_score',
			},
			{
				label: 'Alpha Team Name',
				name: 'teams_alpha_name',
			},
			{
				label: 'Bravo Team Name',
				name: 'teams_bravo_name',
			},
			{
				label: 'No. of games in set',
				name: 'games_in_set',
			},
		])
		this.initSocketConnection()
	}

	config_fields() {
		return [
			{
				type: 'text',
				id: 'info',
				width: 12,
				label: 'Information',
				value: 'This Module has been tested on IPL-OCP 3.2.0',
			},
			{
				type: 'textinput',
				id: 'host',
				label: 'Target host',
				tooltip: 'The host of the NodeCG instance running IPL OCP',
				width: 6,
				default: "localhost"
			},
			{
				type: 'textinput',
				id: 'port',
				label: 'Port',
				tooltip: 'The port of the NodeCG instance running IPL OCP',
				width: 6,
				regex: this.REGEX_NUMBER,
				default: 9090
			},
		]
	}

	initSocketConnection() {
		// Check config has been set
		let ip = this.config.host
		let port = this.config.port
		this.status(this.STATUS_UNKNOWN)
		if (!ip || !port) {
			this.status(this.STATUS_ERROR, `Configuration error - no NodeCG host and/or port defined`)
			return
		}
		// Close previous connection is already open
		if (this.socket !== undefined) {
			this.socket.close(1000)
			delete this.socket
		}

		this.socket = socketIo(`ws://${ip}:${port}`, { reconnect: true })

		// When we connect to socket
		this.socket.on('connect', () => {
			this.log('debug', `Connection opened`)
			this.status(this.STATUS_OK)

			//get the value of each initial replicant
			replicantNames.forEach((replicantName) => {
				this.socket.emit('joinRoom', 'replicant:ipl-overlay-controls', () => {
					this.socket.emit(
						'replicant:declare',
						{
							name: replicantName,
							namespace: 'ipl-overlay-controls',
							opts: this.replicantsMetadata[replicantName],
						},
						(data) => {
							this.replicants[replicantName] = data.value
							this.replicantsMetadata[replicantName].revision = data.revision
							this.replicantsMetadata[replicantName].schemaSum = data.schemaSum
							this.assignDynamicVariablesAndFeedback(replicantName)
						}
					)
				})
			})
		})

		// On error
		this.socket.on('error', (data) => {
			this.log(this.STATUS_ERROR, `Socket.io error: ${data}`)
		})

		// When a new value assignment happens
		this.socket.on('replicant:assignment', (data) => {
			this.onSocketMessageAssignment(data)
		})

		this.socket.on('replicant:operations', (data) => {
			this.onSocketMessageOperations(data)
		})

		this.socket.on('disconnected', (data) => {
			this.log('debug', `Connection closed due to ${data}`)
			this.status(this.STATUS_ERROR, `Connection closed due to ${data}`)
		})
	}

	/**
	 * Runs when replicant receives an update
	 * @param data Data received
	 */
	onSocketMessageAssignment(data) {
		if (replicantNames.includes(data.name) && data.namespace === 'ipl-overlay-controls') {
			this.replicants[data.name] = data.newValue
			this.assignDynamicVariablesAndFeedback(data.name)
		}
	}

	/**
	 * Update Local Replicants
	 * @param data new data
	 */
	onSocketMessageOperations(data) {
		if (replicantNames.includes(data.name) && data.namespace === 'ipl-overlay-controls') {
			this.replicantsMetadata[data.name].revision = data.revision
			data.operations.forEach((op) => {
				if (op.method === 'update') {
					const splitPath = op.path.split('/')
					let path = this.replicants[data.name]
					for (let i = 1; i < splitPath.length; i++) {
						if (splitPath[i]) {
							path = path[splitPath[i]]
						}
					}
					path[op.args.prop] = op.args.newValue
				}
			})
			this.assignDynamicVariablesAndFeedback(data.name)
		}
	}

	/**
	 * Send Message to ocp
	 * @param messageName message name
	 * @param data data
	 */
	sendSocketMessage(messageName, data) {
		this.socket.emit('message', {
			bundleName: 'ipl-overlay-controls',
			messageName: messageName,
			content: data,
		})
	}

	/**
	 * Send Propose Operations Message to ocp
	 * @param replicantName replicant name
	 * @param operations {Array} Array of Objects with the operations
	 */
	sendSocketReplicantProposeOperations(replicantName, operations) {
		if (replicantNames.includes(replicantName)) {
			this.socket.emit('replicant:proposeOperations', {
				name: replicantName,
				namespace: 'ipl-overlay-controls',
				operations: operations,
				revision: this.replicantsMetadata[replicantName].revision,
				schemaSum: this.replicantsMetadata[replicantName].schemaSum,
				opts: this.replicantsMetadata[replicantName].opts,
			})
		}
	}

	/**
	 * Send Propose Assignment Message to ocp
	 * @param replicantName replicant name
	 * @param newValue new value to assign
	 */
	sendSocketReplicantProposeAssignment(replicantName, newValue) {
		if (replicantNames.includes(replicantName)) {
			this.socket.emit('replicant:proposeAssignment', {
				name: replicantName,
				namespace: 'ipl-overlay-controls',
				value: newValue,
				schemaSum: this.replicantsMetadata[replicantName].schemaSum,
				opts: this.replicantsMetadata[replicantName].opts,
			})
		}
	}

	/**
	 * Updates the Companion dynamic variables
	 * @param replicantName replicant that got updated
	 */
	assignDynamicVariablesAndFeedback(replicantName) {
		switch (replicantName) {
			case 'activeRound':
				if (!isEmpty(this.replicants['activeRound'])) {
					this.setVariable('teams_alpha_score', this.replicants['activeRound'].teamA.score)
					this.setVariable('teams_bravo_score', this.replicants['activeRound'].teamB.score)
					this.setVariable('teams_alpha_name', this.replicants['activeRound'].teamA.name)
					this.setVariable('teams_bravo_name', this.replicants['activeRound'].teamB.name)
					this.setVariable('games_in_set', this.replicants['activeRound'].games.length)
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
		}
	}

	/**
	 * Get next colour
	 * @param indexMovement index to change by
	 * @return {Object} object with colour data
	 */
	getColourData(indexMovement) {
		let newIndex = this.replicants['activeRound']['activeColor'].index + indexMovement
		if (newIndex > 6) {
			newIndex = 0
		} else if (newIndex < 0) {
			newIndex = 6
		}

		const category = this.replicants['activeRound']['activeColor'].categoryName
		let return_value = null
		if (['Ranked Modes', 'Turf War'].includes(category)) {
			colourHelper[category].forEach((data) => {
				if (data.index === newIndex) {
					return_value = {
						color: data,
						categoryName: category,
					}
				}
			})
		}
		return return_value
	}

	initFeedbacks() {
		let feedbacks = {}
		let self = this

		feedbacks['team_colour'] = {
			type: 'advanced',
			label: 'Change BG colour to teams colour',
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
				if (!isEmpty(self.replicants['activeRound'])) {
					const bgcolour = colord(self.replicants['activeRound'][feedback.options.team].color).toRgb()
					// Choose what text colour to use for feedback depending on the background colour
					const colour = (bgcolour.r * 299 + bgcolour.g * 587 + bgcolour.b * 114) / 1000 >= 128 ? 30 : 230
					return {
						bgcolor: self.rgb(bgcolour.r, bgcolour.g, bgcolour.b),
						color: self.rgb(colour, colour, colour),
					}
				}
				return {}
			},
		}

		feedbacks['scoreboard_visibility'] = {
			type: 'boolean',
			label: 'Scoreboard Visibility',
			description: 'Change background colour when scoreboard is visible.',
			style: {
				bgcolor: self.rgb(0, 255, 0),
			},
			callback: function (feedback) {
				if (!isEmpty(self.replicants['scoreboardData'])) {
					return self.replicants['scoreboardData'].isVisible
				}
			},
		}

		feedbacks['music_visibility'] = {
			type: 'boolean',
			label: 'Music Visibility',
			description: 'Change background colour when music is visible.',
			style: {
				bgcolor: self.rgb(0, 255, 0),
			},
			callback: function (feedback) {
				return self.replicants['musicShown']
			},
		}

		feedbacks['timer_visibility'] = {
			type: 'boolean',
			label: 'Timer Visibility',
			description: 'Change background colour when timer is visible.',
			style: {
				bgcolor: self.rgb(0, 255, 0),
			},
			callback: function (feedback) {
				if (!isEmpty(self.replicants['nextRoundStartTime'])) {
					return self.replicants['nextRoundStartTime'].isVisible
				}
			},
		}

		feedbacks['break_scene_visibility'] = {
			type: 'boolean',
			label: 'Break Scene Visibility',
			description: 'Change background colour when selected break scene is visible.',
			style: {
				bgcolor: self.rgb(0, 255, 0),
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
				if (!isEmpty(self.replicants['activeBreakScene'])) {
					return self.replicants['activeBreakScene'] === feedback.options.scene
				}
			},
		}

		this.setFeedbackDefinitions(feedbacks)
	}

	actions(system) {
		this.setActions({
			set_win: {
				label: 'Set win on last game',
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
					if (
						this.replicants['activeRound'].teamA.score + this.replicants['activeRound'].teamB.score <
						this.replicants['activeRound'].games.length
					) {
						this.sendSocketMessage('setWinner', { winner: action.options.team })
					}
				},
			},
			remove_win: {
				label: 'Remove the last win for either team.',
				callback: (action) => {
					// Check there's scores to remove
					if (this.replicants['activeRound'].teamA.score + this.replicants['activeRound'].teamB.score > 0) {
						this.sendSocketMessage('removeWinner')
					}
				},
			},
			show_caster: {
				label: 'Show Casters on Main Scene.',
				callback: (action) => {
					this.sendSocketMessage('mainShowCasters')
				},
			},
			show_predictions: {
				label: 'Show Predictions.',
				callback: (action) => {
					this.sendSocketMessage('showPredictionData')
				},
			},
			get_live_commentators: {
				label: 'Load Commentators from VC.',
				callback: (action) => {
					this.sendSocketMessage('getLiveCommentators')
				},
			},
			begin_next_match: {
				label: 'Begin next match.',
				callback: (action) => {
					this.sendSocketMessage('beginNextMatch')
				},
			},
			swap_colour: {
				label: 'Swap scoreboard color.',
				callback: (action) => {
					this.sendSocketReplicantProposeAssignment('swapColorsInternally', !this.replicants['swapColorsInternally'])
				},
			},
			cycle_colour: {
				label: 'Cycle colour in game',
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
					let movement = null
					if (action.options.direction === 'next') {
						movement = 1
					} else if (action.options.direction === 'previous') {
						movement = -1
					}
					if (movement) {
						const data = this.getColourData(movement)
						if (data) {
							this.sendSocketMessage('setActiveColor', data)
						}
					}
				},
			},
			scoreboard_visibility: {
				label: 'Show/Hide/Toggle Scoreboard on main',
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
						this.sendSocketReplicantProposeOperations('scoreboardData', [
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
						this.sendSocketReplicantProposeOperations('scoreboardData', [
							{
								path: '/',
								method: 'update',
								args: {
									prop: 'isVisible',
									newValue: !this.replicants['scoreboardData'].isVisible,
								},
							},
						])
					}
				},
			},
			change_break_scene: {
				label: 'Change break scene',
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
					if (action.options.scene !== this.replicants['activeBreakScene']) {
						this.sendSocketReplicantProposeAssignment('activeBreakScene', action.options.scene)
					}
				},
			},
			music_visibility: {
				label: 'Show/Hide/Toggle Music',
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
						this.sendSocketReplicantProposeAssignment('musicShown', action.options.change === 'show')
					} else {
						this.sendSocketReplicantProposeAssignment('musicShown', !this.replicants['musicShown'])
					}
				},
			},
			set_stage_timer: {
				label: 'Set Next Stage Timer',
				options: [
					{
						type: 'number',
						label: '+ Minutes',
						id: 'minutes',
						tooltip: 'How many minutes in the future you want the time set to',
						min: 0,
						max: 30,
						default: 5,
						step: 1,
						required: true,
						range: false,
					},
				],
				callback: (action) => {
					const time = DateTime.local().plus({ minutes: action.options.minutes }).toUTC().toISO()
					this.sendSocketReplicantProposeOperations('nextRoundStartTime', [
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
				label: 'Show/Hide/Toggle Timer',
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
						this.sendSocketReplicantProposeOperations('nextRoundStartTime', [
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
						this.sendSocketReplicantProposeOperations('nextRoundStartTime', [
							{
								path: '/',
								method: 'update',
								args: {
									prop: 'isVisible',
									newValue: !this.replicants['nextRoundStartTime'].isVisible,
								},
							},
						])
					}
				},
			},
		})
	}
}

exports = module.exports = instance
