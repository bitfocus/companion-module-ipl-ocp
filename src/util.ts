import {
	ActiveRound,
	ScoreboardData,
	SwapColorsInternally,
	ActiveBreakScene,
	MusicShown,
	NextRoundStartTime,
	NextRound,
	ObsData,
	GameAutomationData,
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

export type IPLOCBundleMap = {
	[DASHBOARD_BUNDLE_NAME]: ReplicantMap
}

export interface ReplicantMap {
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
