import {
	ActiveRound,
	ScoreboardData,
	SwapColorsInternally,
	ActiveBreakScene,
	MusicShown,
	NextRoundStartTime,
	NextRound,
	ObsState,
	ObsConfig,
	GameAutomationData,
	LocaleInfo,
} from './types'

/**
 * returns if an object is empty
 * @param obj Object to check
 * @return {boolean}
 */
export function isEmpty(obj: {} | undefined) {
	return obj != null && Object.keys(obj).length === 0
}

export function isBlank(value?: string | null): boolean {
	return value === null || value === undefined || value.trim() === ''
}

export const DASHBOARD_BUNDLE_NAME = 'ipl-overlay-controls'
export const UNKNOWN_STAGE_NAME = 'Unknown Stage'
export const UNKNOWN_MODE_NAME = 'Unknown Mode'

export type IPLOCBundleMap = {
	[DASHBOARD_BUNDLE_NAME]: IPLOCReplicantMap
}

export interface IPLOCReplicantMap {
	activeRound?: ActiveRound
	scoreboardData?: ScoreboardData
	swapColorsInternally?: SwapColorsInternally
	activeBreakScene?: ActiveBreakScene
	musicShown?: MusicShown
	nextRoundStartTime?: NextRoundStartTime
	nextRound?: NextRound
	obsState?: ObsState
	obsConfig?: ObsConfig
	gameAutomationData?: GameAutomationData
	localeInfo?: LocaleInfo
}
