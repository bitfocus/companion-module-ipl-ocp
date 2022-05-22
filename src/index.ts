import InstanceSkel = require('../../../instance_skel')
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
import { modeNameToShortModeName, stageNameToShortStageName } from './helpers/SplatoonData'
import { NodeCGConnector } from './NodeCGConnector'

const DASHBOARD_BUNDLE_NAME = 'ipl-overlay-controls'

interface IPLOCModuleConfig {
  host?: string
  port?: string
}

type IPLOCBundleMap = {
  [DASHBOARD_BUNDLE_NAME]: ReplicantMap
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
  private readonly socket: NodeCGConnector<IPLOCBundleMap>

  constructor(system: CompanionSystem, id: string, config: IPLOCModuleConfig) {
    super(system, id, config)

    this.socket = new NodeCGConnector({
      host: config.host,
      port: config.port
    }, {
      [DASHBOARD_BUNDLE_NAME]: [
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
    })

    this.socket.on('connect', () => {
      this.checkFeedbacks('nodecg_connection_status')
      this.log('debug', `Connection opened`)
      this.status(this.STATUS_OK)
    })

    this.socket.on('disconnect', reason => {
      this.checkFeedbacks('nodecg_connection_status')
      const msg = `NodeCG connection closed. Reason: ${reason}`
      this.log('debug', msg)
      this.status(this.STATUS_ERROR, msg)
    })

    this.socket.on('error', err => {
      this.log('error', `Socket.io error: ${err}`)
    })

    this.socket.on('replicantUpdate', name => {
      this.assignDynamicVariablesAndFeedback(name as keyof ReplicantMap)
    })

    this.socket.start()

    this.initFeedbacks()
    this.actions()
    this.subscribeFeedbacks()

    return this
  }

  public init(): void {
    this.setVariableDefinitions([
      {
        label: 'Alpha Team Score',
        name: 'teams_alpha_score'
      },
      {
        label: 'Bravo Team Score',
        name: 'teams_bravo_score'
      },
      {
        label: 'Alpha Team Name',
        name: 'teams_alpha_name'
      },
      {
        label: 'Bravo Team Name',
        name: 'teams_bravo_name'
      },
      {
        label: 'No. of games in set',
        name: 'games_in_set'
      },
      {
        label: 'The next mode to be played',
        name: 'next_mode'
      },
      {
        label: 'The next stage to be played',
        name: 'next_stage'
      }
    ])
    this.setPresetDefinitions([
      {
        category: 'Match info',
        label: 'Next Stage',
        bank: {
          style: 'text',
          text: 'Next: $(ocp:next_mode) $(ocp:next_stage)',
          size: 'auto',
          color: this.rgb(255, 255, 255),
          bgcolor: this.rgb(0, 0, 0)
        },
        feedbacks: [],
        actions: []
      }
    ])
  }

  destroy() {
    this.socket.disconnect()
  }

  public updateConfig(config: IPLOCModuleConfig): void {
    this.config = config
    this.socket?.updateConfig({
      host: config.host,
      port: config.port
    })
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

  /**
   * Updates the Companion dynamic variables
   * @param replicantName replicant that got updated
   */
  assignDynamicVariablesAndFeedback(replicantName: keyof ReplicantMap) {
    switch (replicantName) {
      case 'activeRound':
        if (!isEmpty(this.socket.replicants[DASHBOARD_BUNDLE_NAME]['activeRound'])) {
          this.setVariable('teams_alpha_score', String(this.socket.replicants[DASHBOARD_BUNDLE_NAME]['activeRound']?.teamA.score))
          this.setVariable('teams_bravo_score', String(this.socket.replicants[DASHBOARD_BUNDLE_NAME]['activeRound']?.teamB.score))
          this.setVariable('teams_alpha_name', this.socket.replicants[DASHBOARD_BUNDLE_NAME]['activeRound']?.teamA.name)
          this.setVariable('teams_bravo_name', this.socket.replicants[DASHBOARD_BUNDLE_NAME]['activeRound']?.teamB.name)
          this.setVariable('games_in_set', String(this.socket.replicants[DASHBOARD_BUNDLE_NAME]['activeRound']?.games.length))

          const nextGame = this.socket.replicants[DASHBOARD_BUNDLE_NAME].activeRound?.games.find(game => game.winner === 'none')
          this.setVariables({
            'next_mode': nextGame?.mode == null ? '??' : (modeNameToShortModeName[nextGame.mode] ?? nextGame.mode),
            'next_stage': nextGame?.stage == null ? '???' : (stageNameToShortStageName[nextGame.stage] ?? nextGame.stage),
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
        const activeRound = self.socket.replicants[DASHBOARD_BUNDLE_NAME].activeRound
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
        const scoreboardData = self.socket.replicants[DASHBOARD_BUNDLE_NAME]['scoreboardData']
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
        return self.socket.replicants[DASHBOARD_BUNDLE_NAME]['musicShown'] ?? false
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
        return self.socket.replicants[DASHBOARD_BUNDLE_NAME].nextRoundStartTime?.isVisible ?? false
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
        return self.socket.replicants[DASHBOARD_BUNDLE_NAME].nextRound?.showOnStream ?? false
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
        if (!isEmpty(self.socket.replicants[DASHBOARD_BUNDLE_NAME]['activeBreakScene'])) {
          return self.socket.replicants[DASHBOARD_BUNDLE_NAME]['activeBreakScene'] === feedback.options.scene
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
        if (this.socket.replicants[DASHBOARD_BUNDLE_NAME].obsData?.status !== 'CONNECTED') {
          return {
            text: 'OFF',
            bgcolor: this.rgb(0, 0, 0),
            color: this.rgb(255, 255, 255)
          }
        }

        const nextTaskName = this.socket.replicants[DASHBOARD_BUNDLE_NAME].gameAutomationData?.nextTaskForAction?.name ?? ''
        if (this.socket.replicants[DASHBOARD_BUNDLE_NAME].gameAutomationData?.actionInProgress !== 'NONE' && !isBlank(nextTaskName)) {
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
          return this.socket.replicants[DASHBOARD_BUNDLE_NAME].obsData?.gameplayScene === this.socket.replicants[DASHBOARD_BUNDLE_NAME].obsData?.currentScene
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
        if (this.socket != null && this.socket.isConnected()) {
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
          const activeRound = this.socket.replicants[DASHBOARD_BUNDLE_NAME]['activeRound']
          if (activeRound != null && activeRound.teamA.score + activeRound.teamB.score < activeRound.games.length) {
            this.socket.sendMessage('setWinner', { winner: action.options.team })
          }
        },
      },
      remove_win: {
        label: 'Remove the last win for either team.',
        options: [],
        callback: () => {
          // Check there's scores to remove
          const activeRound = this.socket.replicants[DASHBOARD_BUNDLE_NAME]['activeRound']
          if (activeRound != null && activeRound.teamA.score + activeRound.teamB.score > 0) {
            this.socket.sendMessage('removeWinner')
          }
        },
      },
      show_caster: {
        label: 'Show Casters on Main Scene.',
        options: [],
        callback: () => {
          this.socket.sendMessage('mainShowCasters')
        },
      },
      show_predictions: {
        label: 'Show Predictions.',
        options: [],
        callback: () => {
          this.socket.sendMessage('showPredictionData')
        },
      },
      get_live_commentators: {
        label: 'Load Commentators from VC.',
        options: [],
        callback: () => {
          this.socket.sendMessage('getLiveCommentators')
        },
      },
      swap_colour: {
        label: 'Swap scoreboard color.',
        options: [],
        callback: () => {
          this.socket.proposeReplicantAssignment('swapColorsInternally', DASHBOARD_BUNDLE_NAME, !this.socket.replicants[DASHBOARD_BUNDLE_NAME]['swapColorsInternally'])
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
            this.socket.sendMessage('switchToNextColor')
          } else if (action.options.direction === 'previous') {
            this.socket.sendMessage('switchToPreviousColor')
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
            this.socket.proposeReplicantOperations('scoreboardData', DASHBOARD_BUNDLE_NAME, [
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
            this.socket.proposeReplicantOperations('scoreboardData', DASHBOARD_BUNDLE_NAME, [
              {
                path: '/',
                method: 'update',
                args: {
                  prop: 'isVisible',
                  newValue: !this.socket.replicants[DASHBOARD_BUNDLE_NAME].scoreboardData?.isVisible,
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
            newScene !== this.socket.replicants[DASHBOARD_BUNDLE_NAME]['activeBreakScene'] &&
            ['main', 'teams', 'stages'].includes(newScene)
          ) {
            this.socket.proposeReplicantAssignment('activeBreakScene', DASHBOARD_BUNDLE_NAME, newScene as ActiveBreakScene)
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
            this.socket.proposeReplicantAssignment('musicShown', DASHBOARD_BUNDLE_NAME, action.options.change === 'show')
          } else {
            this.socket.proposeReplicantAssignment('musicShown', DASHBOARD_BUNDLE_NAME, !this.socket.replicants[DASHBOARD_BUNDLE_NAME]['musicShown'])
          }
        },
      },
      set_stage_timer: {
        label: 'Set Next Stage Timer',
        options: [
          {
            type: 'textwithvariables',
            label: '+ Minutes',
            id: 'minutes',
            tooltip: 'How many minutes in the future you want the time set to. Must be numeric, may be a variable reference.',
            default: '5'
          },
        ],
        callback: (action) => {
          this.parseVariables(String(action.options.minutes), parsedMinutes => {
            const minutes = Number(parsedMinutes)

            if (minutes != null && !isNaN(minutes)) {
              const normalizedMinutes = Math.max(0, minutes)
              const time = DateTime.local().plus({ minutes: normalizedMinutes }).set({ second: 0 }).toUTC().toISO()
              this.socket.proposeReplicantOperations('nextRoundStartTime', DASHBOARD_BUNDLE_NAME, [
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
              this.log('error', `Value of option "Minutes" was "${parsedMinutes}", which is not numeric!`)
            }
          })
        },
      },
      add_to_stage_timer: {
        label: 'Add to next stage timer',
        options: [
          {
            type: 'textwithvariables',
            label: '+ Minutes',
            id: 'minutes',
            tooltip: 'How many minutes to add to the timer. Must be numeric, may be a variable reference.',
            default: '1'
          },
        ],
        callback: (action) => {
          this.parseVariables(String(action.options.minutes), parsedMinutes => {
            const minutes = Number(parsedMinutes)
            if (minutes == null || isNaN(minutes)) {
              this.log('error', `Value of option "Minutes" was "${parsedMinutes}", which is not numeric!`)
              return
            } else if (this.socket.replicants[DASHBOARD_BUNDLE_NAME]?.nextRoundStartTime?.startTime == null) {
              this.log('error', 'Replicant "nextRoundStartTime" has not yet been initialized.')
              return
            }

            const normalizedMinutes = Math.max(0, minutes)
            // @ts-ignore: TypeScript doesn't understand the above null check
            const time = DateTime.fromISO(this.socket.replicants[DASHBOARD_BUNDLE_NAME].nextRoundStartTime.startTime).plus({ minutes: normalizedMinutes }).toUTC().toISO()
            this.socket.proposeReplicantOperations('nextRoundStartTime', DASHBOARD_BUNDLE_NAME, [
              {
                path: '/',
                method: 'update',
                args: {
                  prop: 'startTime',
                  newValue: time,
                },
              },
            ])
          })
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
            this.socket.proposeReplicantOperations('nextRoundStartTime', DASHBOARD_BUNDLE_NAME, [
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
            this.socket.proposeReplicantOperations('nextRoundStartTime', DASHBOARD_BUNDLE_NAME, [
              {
                path: '/',
                method: 'update',
                args: {
                  prop: 'isVisible',
                  newValue: !this.socket.replicants[DASHBOARD_BUNDLE_NAME]['nextRoundStartTime']?.isVisible,
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
            this.socket.proposeReplicantOperations('nextRound', DASHBOARD_BUNDLE_NAME, [
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
            this.socket.proposeReplicantOperations('nextRound', DASHBOARD_BUNDLE_NAME, [
              {
                path: '/',
                method: 'update',
                args: {
                  prop: 'showOnStream',
                  newValue: !this.socket.replicants[DASHBOARD_BUNDLE_NAME]['nextRound']?.showOnStream,
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
          if (this.socket.replicants[DASHBOARD_BUNDLE_NAME].obsData?.status !== 'CONNECTED') {
            this.log('error', 'The OBS socket is not enabled!')
            return
          }

          const nextTaskName = this.socket.replicants[DASHBOARD_BUNDLE_NAME].gameAutomationData?.nextTaskForAction?.name ?? ''
          if (this.socket.replicants[DASHBOARD_BUNDLE_NAME].gameAutomationData?.actionInProgress !== 'NONE' && !isBlank(nextTaskName)) {
            this.socket.sendMessage('fastForwardToNextGameAutomationTask')
          } else if (this.socket.replicants[DASHBOARD_BUNDLE_NAME].obsData?.gameplayScene === this.socket.replicants[DASHBOARD_BUNDLE_NAME].obsData?.currentScene) {
            this.socket.sendMessage('endGame')
          } else {
            this.socket.sendMessage('startGame')
          }
        }
      },
      reconnect: {
        label: 'Reconnect to NodeCG',
        options: [],
        callback: () => {
          this.socket.start()
        }
      }
    })
  }
}

exports = module.exports = IPLOCInstance
