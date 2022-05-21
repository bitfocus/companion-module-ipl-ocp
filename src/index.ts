import InstanceSkel = require('../../../instance_skel')
import io, { Socket } from 'socket.io-client'
import { colord } from 'colord'
import { DateTime } from 'luxon'
import { CompanionFeedbacks, CompanionSystem, SomeCompanionConfigField } from '../../../instance_skel_types'
import {
  ActiveBreakScene,
  ActiveRound,
  GameAutomationData,
  MusicShown,
  NextRound,
  NextRoundStartTime,
  ObsData,
  ScoreboardData,
  SwapColorsInternally
} from './types'

interface IPLOCModuleConfig {
  host?: string
  port?: string
}

interface ReplicantMetadataOpts {
  schemaPath: string
  persistent: boolean
  persistenceInterval: number
}

interface ReplicantMetadata {
  revision: number
  schemaSum: string
  opts: ReplicantMetadataOpts
}

interface ReplicantMap {
  activeRound?: ActiveRound
  scoreboardData?: ScoreboardData
  swapColorsInternally?: SwapColorsInternally
  activeBreakScene?: ActiveBreakScene
  musicShown?: MusicShown
  nextRoundStartTime?: NextRoundStartTime
  nextRound?: NextRound
  obsData?: ObsData
  gameAutomationData?: GameAutomationData
}

interface SocketEventResponse<T> {
  value: T
  revision: number
  schemaSum: string
}

interface ReplicantAssignmentEvent {
  name: string
  namespace: string
  newValue: unknown
}

interface ReplicantOperation {
  method: string
  path: string
  args: {
    prop: string
    newValue: unknown
  }
}

interface ReplicantOperationsEvent {
  name: string
  namespace: string
  revision: number
  operations: Array<ReplicantOperation>
}

interface ReplicantSocketEventMap {
  'replicant:assignment': (event: ReplicantAssignmentEvent) => void
  'replicant:operations': (event: ReplicantOperationsEvent) => void
}

interface ReplicantSocketMessageMessage {
  bundleName: string
  messageName: string
  content: unknown
}

interface ReplicantSocketMessageMap {
  message: (data: ReplicantSocketMessageMessage, cb: (response?: { name: string; message: string }) => void) => void
  'replicant:proposeOperations': (data: {
    name: string
    namespace: string
    operations: Array<ReplicantOperation>
    revision: number
    schemaSum: string
    opts: ReplicantMetadataOpts
  }) => void
  'replicant:proposeAssignment': (data: {
    name: string
    namespace: string
    value: unknown
    schemaSum: string
    opts: ReplicantMetadataOpts
  }) => void
  joinRoom: (roomName: string, cb: () => void) => void
  'replicant:declare': (
    data: { name: string; namespace: string; opts: ReplicantMetadata },
    cb: (data: SocketEventResponse<ReplicantMap[keyof ReplicantMap]>) => void
  ) => void
}

// Names of replicants we want to store locally for use
const replicantNames: Array<keyof ReplicantMap> & Array<string> = [
  'activeRound',
  'scoreboardData',
  'swapColorsInternally',
  'activeBreakScene',
  'musicShown',
  'nextRoundStartTime',
  'nextRound',
  'obsData',
  'gameAutomationData'
]

/**
 * returns if an object is empty
 * @param obj Object to check
 * @return {boolean}
 */
function isEmpty(obj: {} | undefined) {
  return obj != null && Object.keys(obj).length === 0
}

function isBlank(value?: string | null): boolean {
  return value === null || value === undefined || value.trim() === '';
}

class IPLOCInstance extends InstanceSkel<IPLOCModuleConfig> {
  private readonly replicants: ReplicantMap
  private readonly replicantsMetadata: Record<keyof ReplicantMap, ReplicantMetadata>
  private socket: Socket<ReplicantSocketEventMap, ReplicantSocketMessageMap> | undefined

  constructor(system: CompanionSystem, id: string, config: IPLOCModuleConfig) {
    super(system, id, config)

    // Stores replicants & metadata
    this.replicants = {}
    this.replicantsMetadata = replicantNames.reduce((result: Record<keyof ReplicantMap, ReplicantMetadata>, name) => {
      result[name] = {
        revision: 0,
        schemaSum: '',
        opts: {
          schemaPath: `bundles/ipl-overlay-controls/schemas/${name}.json`,
          persistent: true,
          persistenceInterval: 100,
        },
      }
      return result
    }, {} as Record<keyof ReplicantMap, ReplicantMetadata>)

    if (!this.config) {
      return this
    }

    this.initSocketConnection()
    this.initFeedbacks()
    this.actions()
    this.subscribeFeedbacks()

    return this
  }

  public init(): void {}

  destroy() {
    if (this.socket !== undefined) {
      this.socket.disconnect()
      delete this.socket
    }
  }

  public updateConfig(config: IPLOCModuleConfig): void {
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

  public config_fields(): SomeCompanionConfigField[] {
    return [
      {
        type: 'text',
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
        type: 'textinput',
        id: 'port',
        label: 'Port',
        tooltip: 'The port of the NodeCG instance running IPL OCP',
        width: 6,
        regex: this.REGEX_NUMBER,
        default: '9090',
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
      this.socket.close()
      delete this.socket
    }

    this.socket = io(`ws://${ip}:${port}`, { reconnection: true })

    // When we connect to socket
    this.socket!.on('connect', () => {
      this.checkFeedbacks('nodecg_connection_status')
      this.log('debug', `Connection opened`)
      this.status(this.STATUS_OK)

      //get the value of each initial replicant
      replicantNames.forEach((replicantName) => {
        this.socket!.emit('joinRoom', 'replicant:ipl-overlay-controls', () => {
          this.socket!.emit(
            'replicant:declare',
            {
              name: replicantName,
              namespace: 'ipl-overlay-controls',
              opts: this.replicantsMetadata[replicantName],
            },
            (data: SocketEventResponse<ReplicantMap[typeof replicantName]>) => {
              (this.replicants[replicantName] as unknown) = data.value
              this.replicantsMetadata[replicantName].revision = data.revision
              this.replicantsMetadata[replicantName].schemaSum = data.schemaSum
              this.assignDynamicVariablesAndFeedback(replicantName)
            }
          )
        })
      })
    })

    // On error
    this.socket!.on('error', (data) => {
      this.log('error', `Socket.io error: ${data}`)
    })

    // When a new value assignment happens
    this.socket!.on('replicant:assignment', (data) => {
      this.onSocketMessageAssignment(data)
    })

    this.socket!.on('replicant:operations', (data) => {
      this.onSocketMessageOperations(data)
    })

    this.socket!.on('disconnect', (data) => {
      this.checkFeedbacks('nodecg_connection_status')
      this.log('debug', `Connection closed due to ${data}`)
      this.status(this.STATUS_ERROR, `Connection closed due to ${data}`)
    })
  }

  /**
   * Runs when replicant receives an update
   * @param data Data received
   */
  onSocketMessageAssignment(data: ReplicantAssignmentEvent) {
    if (replicantNames.includes(data.name) && data.namespace === 'ipl-overlay-controls') {
      ;(this.replicants[data.name as keyof ReplicantMap] as unknown) = data.newValue
      this.assignDynamicVariablesAndFeedback(data.name as keyof ReplicantMap)
    }
  }

  /**
   * Update Local Replicants
   * @param data new data
   */
  onSocketMessageOperations(data: ReplicantOperationsEvent) {
    if (replicantNames.includes(data.name) && data.namespace === 'ipl-overlay-controls') {
      this.replicantsMetadata[data.name as keyof ReplicantMap].revision = data.revision
      data.operations.forEach((op) => {
        if (op.method === 'update') {
          const splitPath = op.path.split('/')
          let path: any = this.replicants[data.name as keyof ReplicantMap]
          for (let i = 1; i < splitPath.length; i++) {
            if (splitPath[i]) {
              path = path[splitPath[i]]
            }
          }
          path[op.args.prop] = op.args.newValue
        }
      })
      this.assignDynamicVariablesAndFeedback(data.name as keyof ReplicantMap)
    }
  }

  /**
   * Send Message to ocp
   * @param messageName message name
   * @param data data
   */
  sendSocketMessage(messageName: string, data?: unknown) {
    this.socket?.emit(
      'message',
      {
        bundleName: 'ipl-overlay-controls',
        messageName: messageName,
        content: data,
      },
      (response) => {
        if (response != null) {
          if (response.name === 'Error') {
            this.log('error', `Message Error ${response.message}`)
          }
        }
      }
    )
  }

  /**
   * Send Propose Operations Message to ocp
   * @param replicantName replicant name
   * @param operations {Array} Array of Objects with the operations
   */
  sendSocketReplicantProposeOperations(replicantName: keyof ReplicantMap, operations: Array<ReplicantOperation>) {
    if (replicantNames.includes(replicantName) && this.socket) {
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
  sendSocketReplicantProposeAssignment<Rep extends keyof ReplicantMap>(
    replicantName: Rep,
    newValue: ReplicantMap[Rep]
  ) {
    if (replicantNames.includes(replicantName) && this.socket) {
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
  assignDynamicVariablesAndFeedback(replicantName: keyof ReplicantMap) {
    switch (replicantName) {
      case 'activeRound':
        if (!isEmpty(this.replicants['activeRound'])) {
          this.setVariable('teams_alpha_score', String(this.replicants['activeRound']?.teamA.score))
          this.setVariable('teams_bravo_score', String(this.replicants['activeRound']?.teamB.score))
          this.setVariable('teams_alpha_name', this.replicants['activeRound']?.teamA.name)
          this.setVariable('teams_bravo_name', this.replicants['activeRound']?.teamB.name)
          this.setVariable('games_in_set', String(this.replicants['activeRound']?.games.length))
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

  initFeedbacks() {
    let feedbacks: CompanionFeedbacks = {}
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
        const activeRound = self.replicants.activeRound
        if (!isEmpty(activeRound)) {
          const teamColor = activeRound?.[feedback.options.team as 'teamA' | 'teamB'].color
          if (teamColor != null) {
            const bgcolour = colord(teamColor).toRgb()
            // Choose what text colour to use for feedback depending on the background colour
            const colour = (bgcolour.r * 299 + bgcolour.g * 587 + bgcolour.b * 114) / 1000 >= 128 ? 30 : 230
            return {
              bgcolor: self.rgb(bgcolour.r, bgcolour.g, bgcolour.b),
              color: self.rgb(colour, colour, colour),
            }
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
      options: [],
      callback: function () {
        const scoreboardData = self.replicants['scoreboardData']
        if (scoreboardData?.isVisible != null) {
          return scoreboardData.isVisible
        }

        return false
      },
    }

    feedbacks['music_visibility'] = {
      type: 'boolean',
      label: 'Music Visibility',
      description: 'Change background colour when music is visible.',
      style: {
        bgcolor: self.rgb(0, 255, 0),
      },
      options: [],
      callback: function () {
        return self.replicants['musicShown'] ?? false
      },
    }

    feedbacks['timer_visibility'] = {
      type: 'boolean',
      label: 'Timer Visibility',
      description: 'Change background colour when timer is visible.',
      style: {
        bgcolor: self.rgb(0, 255, 0),
      },
      options: [],
      callback: function () {
        return self.replicants.nextRoundStartTime?.isVisible ?? false
      },
    }

    feedbacks['show_next_match_on_stream'] = {
      type: 'boolean',
      label: 'Next Match Visibility',
      description: 'Change background colour when Next match is on stream.',
      style: {
        bgcolor: self.rgb(0, 255, 0),
      },
      options: [],
      callback: function () {
        return self.replicants.nextRound?.showOnStream ?? false
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

        return false
      },
    }

    feedbacks['automation_action_state'] = {
      type: 'advanced',
      label: 'Automation action state',
      description: 'Changes this toggle\'s color and text to reflect the dashboard\'s automation action state.',
      options: [],
      callback: () => {
        // if action is in progress, display text for next action
        const nextTaskName = this.replicants.gameAutomationData?.nextTaskForAction?.name ?? ''
        if (this.replicants.gameAutomationData?.actionInProgress !== 'NONE' && !isBlank(nextTaskName)) {
          return {
            text: {
              changeScene: 'CHANGE SCENE',
              showScoreboard: 'SHOW SB',
              showCasters: 'SHOW CASTERS',
              hideScoreboard: 'HIDE SB'
            }[nextTaskName] ?? nextTaskName,
            size: ['showScoreboard', 'hideScoreboard'].includes(nextTaskName) ? '18' : 'auto',
            bgcolor: this.rgb(0, 0, 0),
            color: this.rgb(255, 255, 255)
          }
        } else {
          return this.replicants.obsData?.gameplayScene === this.replicants.obsData?.currentScene
            ? {
              text: 'END GAME',
              bgcolor: this.rgb(255, 0, 0),
              color: this.rgb(255, 255, 255)
            } : {
              text: 'START GAME',
              bgcolor: this.rgb(0, 255, 0),
              color: this.rgb(0, 0, 0)
            }
        }
      }
    }

    feedbacks['nodecg_connection_status'] = {
      type: 'advanced',
      label: 'NodeCG connection status',
      description: 'Changes this toggle\'s color and text to reflect the NodeCG connection status',
      options: [],
      callback: () => {
        if (this.socket != null && this.socket.connected) {
          return {
            color: this.rgb(0, 0, 0),
            bgcolor: this.rgb(0, 255, 0),
            text: 'NODECG READY',
            size: '14'
          }
        } else {
          return {
            color: this.rgb(255, 255, 255),
            bgcolor: this.rgb(255, 0, 0),
            text: 'NODECG OFF',
            size: '14'
          }
        }
      }
    }

    this.setFeedbackDefinitions(feedbacks)
  }

  actions() {
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
          const activeRound = this.replicants['activeRound']
          if (activeRound != null && activeRound.teamA.score + activeRound.teamB.score < activeRound.games.length) {
            this.sendSocketMessage('setWinner', { winner: action.options.team })
          }
        },
      },
      remove_win: {
        label: 'Remove the last win for either team.',
        options: [],
        callback: () => {
          // Check there's scores to remove
          const activeRound = this.replicants['activeRound']
          if (activeRound != null && activeRound.teamA.score + activeRound.teamB.score > 0) {
            this.sendSocketMessage('removeWinner')
          }
        },
      },
      show_caster: {
        label: 'Show Casters on Main Scene.',
        options: [],
        callback: () => {
          this.sendSocketMessage('mainShowCasters')
        },
      },
      show_predictions: {
        label: 'Show Predictions.',
        options: [],
        callback: () => {
          this.sendSocketMessage('showPredictionData')
        },
      },
      get_live_commentators: {
        label: 'Load Commentators from VC.',
        options: [],
        callback: () => {
          this.sendSocketMessage('getLiveCommentators')
        },
      },
      swap_colour: {
        label: 'Swap scoreboard color.',
        options: [],
        callback: () => {
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
          if (action.options.direction === 'next') {
            this.sendSocketMessage('switchToNextColor')
          } else if (action.options.direction === 'previous') {
            this.sendSocketMessage('switchToPreviousColor')
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
                  newValue: !this.replicants.scoreboardData?.isVisible,
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
          const newScene = String(action.options.scene)
          if (
            newScene != null &&
            newScene !== this.replicants['activeBreakScene'] &&
            ['main', 'teams', 'stages'].includes(newScene)
          ) {
            this.sendSocketReplicantProposeAssignment('activeBreakScene', newScene as ActiveBreakScene)
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
          const minutes = Number(action.options.minutes)
          if (minutes != null && !isNaN(minutes)) {
            const time = DateTime.local().plus({ minutes }).toUTC().toISO()
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
          }
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
                  newValue: !this.replicants['nextRoundStartTime']?.isVisible,
                },
              },
            ])
          }
        },
      },
      next_on_stream_visibility: {
        label: 'Show/Hide/Toggle Show next match on stream',
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
            this.sendSocketReplicantProposeOperations('nextRound', [
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
            this.sendSocketReplicantProposeOperations('nextRound', [
              {
                path: '/',
                method: 'update',
                args: {
                  prop: 'showOnStream',
                  newValue: !this.replicants['nextRound']?.showOnStream,
                },
              },
            ])
          }
        },
      },
      do_automation_action: {
        label: 'Execute the next automation action (Start/Stop game, etc.)',
        options: [],
        callback: () => {
          const nextTaskName = this.replicants.gameAutomationData?.nextTaskForAction?.name ?? ''
          if (this.replicants.gameAutomationData?.actionInProgress !== 'NONE' && !isBlank(nextTaskName)) {
            this.sendSocketMessage('fastForwardToNextGameAutomationTask')
          } else if (this.replicants.obsData?.gameplayScene === this.replicants.obsData?.currentScene) {
            this.sendSocketMessage('endGame')
          } else {
            this.sendSocketMessage('startGame')
          }
        }
      },
      reconnect: {
        label: 'Reconnect to NodeCG',
        options: [],
        callback: () => {
          this.initSocketConnection()
        }
      }
    })
  }
}

exports = module.exports = IPLOCInstance
