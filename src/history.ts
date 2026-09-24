/**
 * Home Assistant recorder history, read through the supported frontend
 * websocket API only (`history/history_during_period`) -- no recorder
 * database access, no REST scraping, no custom backend component.
 *
 * Everything here reports OBSERVED state transitions. It never infers
 * intent: nothing in this module can say whether a run was scheduled,
 * manual or app-started, and a run's end time is only ever reported when
 * the retrieved history proves it.
 */

import type { HomeAssistant } from "./types";

/** Default history window. Internal default, deliberately not config. */
export const HISTORY_LOOKBACK_DAYS = 7;

/**
 * One recorded period during which a zone switch was observed `on`.
 */
export interface ObservedZoneRun {
  zoneEntityId: string;
  /** Epoch ms of the recorded transition into "on". */
  startedAt: number;
  /**
   * Epoch ms of the immediately-following recorded transition to "off",
   * when that pairing is unambiguous. `undefined` means the end of this
   * run is not provable from the retrieved window -- it is never
   * guessed, and callers must not render a duration without it.
   */
  endedAt?: number;
}

export type ObservedRunsByZone = Map<string, ObservedZoneRun[]>;

/** Compressed state entry as returned by history/history_during_period. */
interface CompressedHistoryState {
  /** state */
  s?: unknown;
  /** last_updated, epoch SECONDS (float) */
  lu?: unknown;
}

type HistoryStatesResponse = Record<string, CompressedHistoryState[] | undefined>;

/**
 * Extracts observed ON runs from one entity's history entries, which
 * arrive in ascending time order.
 *
 * A run is only recorded for a genuine transition into "on" (the
 * previous recorded state was something else). Its end is only filled in
 * when the very next recorded entry is an explicit "off" -- if the next
 * entry is `unavailable`/`unknown`, or there is no next entry at all,
 * the run is left open rather than paired with a later "off" that may
 * belong to a different period.
 */
export function parseObservedRuns(
  zoneEntityId: string,
  entries: readonly CompressedHistoryState[],
): ObservedZoneRun[] {
  const runs: ObservedZoneRun[] = [];
  let previousState: string | undefined;

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const state = typeof entry?.s === "string" ? entry.s : undefined;
    const lastUpdated = typeof entry?.lu === "number" ? entry.lu : undefined;

    if (state === undefined || lastUpdated === undefined) continue;

    if (state === "on" && previousState !== "on") {
      const next = entries[index + 1];
      const nextState = typeof next?.s === "string" ? next.s : undefined;
      const nextUpdated = typeof next?.lu === "number" ? next.lu : undefined;

      runs.push({
        zoneEntityId,
        startedAt: lastUpdated * 1000,
        endedAt: nextState === "off" && nextUpdated !== undefined ? nextUpdated * 1000 : undefined,
      });
    }

    previousState = state;
  }

  return runs;
}

/**
 * Fetches recorded history for the configured zone switches and reduces
 * it to observed runs. Resolves to an empty map when the host `hass`
 * object doesn't expose `callWS` (older/unusual frontends), so callers
 * degrade to simply not showing history rather than breaking.
 */
export async function fetchObservedZoneRuns(
  hass: HomeAssistant,
  zoneEntityIds: readonly string[],
  lookbackDays: number = HISTORY_LOOKBACK_DAYS,
): Promise<ObservedRunsByZone> {
  const byZone: ObservedRunsByZone = new Map();
  if (!hass.callWS || zoneEntityIds.length === 0) return byZone;

  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

  const response = await hass.callWS<HistoryStatesResponse>({
    type: "history/history_during_period",
    start_time: startTime.toISOString(),
    end_time: endTime.toISOString(),
    entity_ids: [...zoneEntityIds],
    minimal_response: true,
    no_attributes: true,
    significant_changes_only: false,
    // Deliberately excluded: the synthetic "state at window start" entry
    // carries the window boundary as its timestamp, and showing that as
    // an observed transition time would be presenting a boundary
    // artefact as a fact.
    include_start_time_state: false,
  });

  for (const entityId of zoneEntityIds) {
    byZone.set(entityId, parseObservedRuns(entityId, response?.[entityId] ?? []));
  }

  return byZone;
}

/** Most recent observed run for a zone, or undefined if none recorded. */
export function latestObservedRun(runs: readonly ObservedZoneRun[] | undefined): ObservedZoneRun | undefined {
  if (!runs || runs.length === 0) return undefined;
  return runs[runs.length - 1];
}

/** All observed runs across all zones, most recent first. */
export function flattenRecentRuns(byZone: ObservedRunsByZone, limit: number): ObservedZoneRun[] {
  const all: ObservedZoneRun[] = [];
  for (const runs of byZone.values()) all.push(...runs);

  return all.sort((a, b) => b.startedAt - a.startedAt).slice(0, limit);
}
