import {
  combineRgb,
  InstanceBase,
  InstanceStatus,
  Regex,
  runEntrypoint,
  SomeCompanionConfigField,
} from '@companion-module/base'
import { colord } from 'colord'
import { DateTime } from 'luxon'
import {
  ActiveBreakScene,
  ActiveRound,
  GameAutomationData,
  MusicShown,
  NextRound,
  NextRoundStartTime,
  ObsData,
  ScoreboardData,
  SwapColorsInternally,
} from './types'
import { modeNameToShortModeName, stageNameToShortStageName } from './helpers/SplatoonData'
import { NodeCGConnector } from './NodeCGConnector'
import { isBlank } from './helpers/StringHelper'

const DASHBOARD_BUNDLE_NAME = 'ipl-overlay-controls'

interface IPLOCModuleConfig {
  host?: string
  port?: string
}

type IPLOCBundleMap = {
  [DASHBOARD_BUNDLE_NAME]: ReplicantMap
}

enum IPLOCFeedback {
  team_colour = 'team_colour',
  scoreboard_visibility = 'scoreboard_visibility',
  music_visibility = 'music_visibility',
  timer_visibility = 'timer_visibility',
  show_next_match_on_stream = 'show_next_match_on_stream',
  break_scene_visibility = 'break_scene_visibility',
  automation_action_state = 'automation_action_state',
  nodecg_connection_status = 'nodecg_connection_status',
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
function isEmpty(obj: {} | undefined): boolean {
  return obj != null && Object.keys(obj).length === 0
}

class IPLOCInstance extends InstanceBase<IPLOCModuleConfig> {
  private socket!: NodeCGConnector<IPLOCBundleMap>

  public async init(config: IPLOCModuleConfig): Promise<void> {
    this.initFeedbacks()
    this.actions()
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

    this.socket = new NodeCGConnector(
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
          'obsData',
          'gameAutomationData',
        ],
      }
    )

    this.socket.on('connect', () => {
      this.checkFeedbacks(IPLOCFeedback.nodecg_connection_status)
      this.log('debug', `Connection opened`)
      this.updateStatus(InstanceStatus.Ok)
    })

    this.socket.on('disconnect', (reason) => {
      this.checkFeedbacks(IPLOCFeedback.nodecg_connection_status)
      const msg = `NodeCG connection closed. Reason: ${reason}`
      this.log('debug', msg)
      this.updateStatus(InstanceStatus.Disconnected, msg)
    })

    this.socket.on('replicantUpdate', (name) => {
      this.assignDynamicVariablesAndFeedback(name as keyof ReplicantMap)
    })

    this.updateStatus(InstanceStatus.Connecting)
    this.socket.start()
  }

  async destroy() {
    this.socket.disconnect()
  }

  public async configUpdated(config: IPLOCModuleConfig): Promise<void> {
    this.updateStatus(InstanceStatus.Connecting)
    this.socket?.updateConfig({
      host: config.host,
      port: config.port,
    })
  }

  public getConfigFields(): SomeCompanionConfigField[] {
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
      case 'obsData':
        this.checkFeedbacks(IPLOCFeedback.automation_action_state)
        break
    }
  }

  initFeedbacks() {
    const self = this
    this.setFeedbackDefinitions({
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
          const activeRound = self.socket.replicants[DASHBOARD_BUNDLE_NAME].activeRound
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
        },
        options: [],
        callback: function () {
          const scoreboardData = self.socket.replicants[DASHBOARD_BUNDLE_NAME]['scoreboardData']
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
        },
        options: [],
        callback: function () {
          return self.socket.replicants[DASHBOARD_BUNDLE_NAME]['musicShown'] ?? false
        },
      },

      [IPLOCFeedback.timer_visibility]: {
        type: 'boolean',
        name: 'Timer Visibility',
        description: 'Change background colour when timer is visible.',
        defaultStyle: {
          bgcolor: combineRgb(0, 255, 0),
        },
        options: [],
        callback: function () {
          return self.socket.replicants[DASHBOARD_BUNDLE_NAME].nextRoundStartTime?.isVisible ?? false
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
          return self.socket.replicants[DASHBOARD_BUNDLE_NAME].nextRound?.showOnStream ?? false
        },
      },

      [IPLOCFeedback.break_scene_visibility]: {
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
          if (!isEmpty(self.socket.replicants[DASHBOARD_BUNDLE_NAME]['activeBreakScene'])) {
            return self.socket.replicants[DASHBOARD_BUNDLE_NAME]['activeBreakScene'] === feedback.options.scene
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
          if (this.socket.replicants[DASHBOARD_BUNDLE_NAME].obsData?.status !== 'CONNECTED') {
            return {
              text: 'OFF',
              bgcolor: combineRgb(0, 0, 0),
              color: combineRgb(255, 255, 255),
            }
          }

          const nextTaskName =
            this.socket.replicants[DASHBOARD_BUNDLE_NAME].gameAutomationData?.nextTaskForAction?.name ?? ''
          if (
            this.socket.replicants[DASHBOARD_BUNDLE_NAME].gameAutomationData?.actionInProgress !== 'NONE' &&
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
            return this.socket.replicants[DASHBOARD_BUNDLE_NAME].obsData?.gameplayScene ===
              this.socket.replicants[DASHBOARD_BUNDLE_NAME].obsData?.currentScene
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

      [IPLOCFeedback.nodecg_connection_status]: {
        type: 'advanced',
        name: 'NodeCG connection status',
        description: "Changes this toggle's color and text to reflect the NodeCG connection status",
        options: [],
        callback: () => {
          if (this.socket != null && this.socket.isConnected()) {
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
      },
    })
  }

  actions() {
    this.setActionDefinitions({
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
          const activeRound = this.socket.replicants[DASHBOARD_BUNDLE_NAME]['activeRound']
          if (activeRound != null && activeRound.teamA.score + activeRound.teamB.score < activeRound.games.length) {
            this.socket.sendMessage('setWinner', DASHBOARD_BUNDLE_NAME, { winner: action.options.team })
          }
        },
      },
      remove_win: {
        name: 'Remove the last win for either team.',
        options: [],
        callback: () => {
          // Check there's scores to remove
          const activeRound = this.socket.replicants[DASHBOARD_BUNDLE_NAME]['activeRound']
          if (activeRound != null && activeRound.teamA.score + activeRound.teamB.score > 0) {
            this.socket.sendMessage('removeWinner', DASHBOARD_BUNDLE_NAME)
          }
        },
      },
      show_caster: {
        name: 'Show Casters on Main Scene.',
        options: [],
        callback: () => {
          this.socket.sendMessage('mainShowCasters', DASHBOARD_BUNDLE_NAME)
        },
      },
      show_predictions: {
        name: 'Show Predictions.',
        options: [],
        callback: () => {
          this.socket.sendMessage('showPredictionData', DASHBOARD_BUNDLE_NAME)
        },
      },
      get_live_commentators: {
        name: 'Load Commentators from VC.',
        options: [],
        callback: () => {
          this.socket.sendMessage('getLiveCommentators', DASHBOARD_BUNDLE_NAME)
        },
      },
      swap_colour: {
        name: 'Swap scoreboard color.',
        options: [],
        callback: () => {
          this.socket.proposeReplicantAssignment(
            'swapColorsInternally',
            DASHBOARD_BUNDLE_NAME,
            !this.socket.replicants[DASHBOARD_BUNDLE_NAME]['swapColorsInternally']
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
            this.socket.sendMessage('switchToNextColor', DASHBOARD_BUNDLE_NAME)
          } else if (action.options.direction === 'previous') {
            this.socket.sendMessage('switchToPreviousColor', DASHBOARD_BUNDLE_NAME)
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
            newScene !== this.socket.replicants[DASHBOARD_BUNDLE_NAME]['activeBreakScene'] &&
            ['main', 'teams', 'stages'].includes(newScene)
          ) {
            this.socket.proposeReplicantAssignment(
              'activeBreakScene',
              DASHBOARD_BUNDLE_NAME,
              newScene as ActiveBreakScene
            )
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
            this.socket.proposeReplicantAssignment(
              'musicShown',
              DASHBOARD_BUNDLE_NAME,
              action.options.change === 'show'
            )
          } else {
            this.socket.proposeReplicantAssignment(
              'musicShown',
              DASHBOARD_BUNDLE_NAME,
              !this.socket.replicants[DASHBOARD_BUNDLE_NAME]['musicShown']
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
          const parsedMinutes = await this.parseVariablesInString(String(action.options.minutes))

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
          const parsedMinutes = await this.parseVariablesInString(String(action.options.minutes))
          const minutes = Number(parsedMinutes)
          if (minutes == null || isNaN(minutes)) {
            this.log('error', `Value of option "Minutes" was "${parsedMinutes}", which is not numeric!`)
            return
          } else if (this.socket.replicants[DASHBOARD_BUNDLE_NAME]?.nextRoundStartTime?.startTime == null) {
            this.log('error', 'Replicant "nextRoundStartTime" has not yet been initialized.')
            return
          }

          const normalizedMinutes = Math.max(0, minutes)
          const time = DateTime.fromISO(this.socket.replicants[DASHBOARD_BUNDLE_NAME].nextRoundStartTime.startTime)
            .plus({ minutes: normalizedMinutes })
            .toUTC()
            .toISO()
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
        name: 'Execute the next automation action (Start/Stop game, etc.)',
        options: [],
        callback: () => {
          if (this.socket.replicants[DASHBOARD_BUNDLE_NAME].obsData?.status !== 'CONNECTED') {
            this.log('error', 'The OBS socket is not enabled!')
            return
          }

          const nextTaskName =
            this.socket.replicants[DASHBOARD_BUNDLE_NAME].gameAutomationData?.nextTaskForAction?.name ?? ''
          if (
            this.socket.replicants[DASHBOARD_BUNDLE_NAME].gameAutomationData?.actionInProgress !== 'NONE' &&
            !isBlank(nextTaskName)
          ) {
            this.socket.sendMessage('fastForwardToNextGameAutomationTask', DASHBOARD_BUNDLE_NAME)
          } else if (
            this.socket.replicants[DASHBOARD_BUNDLE_NAME].obsData?.gameplayScene ===
            this.socket.replicants[DASHBOARD_BUNDLE_NAME].obsData?.currentScene
          ) {
            this.socket.sendMessage('endGame', DASHBOARD_BUNDLE_NAME)
          } else {
            this.socket.sendMessage('startGame', DASHBOARD_BUNDLE_NAME)
          }
        },
      },
      reconnect: {
        name: 'Reconnect to NodeCG',
        options: [],
        callback: () => {
          this.socket.start()
        },
      },
    })
  }
}

runEntrypoint(IPLOCInstance, [])
