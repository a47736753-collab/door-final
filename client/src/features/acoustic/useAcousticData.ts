import { useCallback, useEffect, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { replayEvents, type EventLogEntry } from "../../../../server/events";
import { demoPlan } from "../doorsopen/demo-data";
import type { EventPlan } from "../doorsopen/types";
import { latestLogOffset, sessionOffsets as computeSessionOffsets } from "./staleness";

/** Where the plan on screen came from. */
export type DataSource = "live" | "saved" | "sample";

export interface AcousticData {
  plan: EventPlan;
  /** Newest event-log offset this device knows about. */
  latestOffset: number;
  /** Per session: the offset of its last plan change. */
  sessionOffsets: Record<string, number>;
  source: DataSource;
  /** True when the event log is reachable, so results can be saved to it. */
  canRecord: boolean;
  record(type: string, payload: Record<string, unknown>): Promise<void>;
}

const CACHE_KEY = "doorsopen.acoustic.cache.v1";

interface Cache {
  plan: EventPlan;
  latestOffset: number;
  sessionOffsets: Record<string, number>;
}

function readCache(): Cache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Cache;
    return parsed?.plan?.sessions && parsed?.plan?.volunteers ? parsed : null;
  } catch {
    return null;
  }
}

function writeCache(cache: Cache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* storage full or blocked: the page still works, it just cannot work offline next time */
  }
}

/**
 * Gives the sound page its plan and offsets.
 *
 *  live    the event log answered: use it, and keep a copy on this device
 *  saved   the log is unreachable (offline, or no database): use the copy from last time
 *  sample  nothing saved yet: use the built-in sample plan
 *
 * The saved copy is what makes the feature work with no internet at the venue.
 */
export function useAcousticData(): AcousticData {
  const query = trpc.events.readEvents.useQuery(
    { branchId: "main", limit: 5000 },
    { refetchInterval: 5000, retry: false },
  );
  const utils = trpc.useUtils();
  const append = trpc.events.appendEvent.useMutation();

  const live = useMemo(() => {
    if (!query.isSuccess) return null;
    const events = query.data as unknown as EventLogEntry[];
    const hasPlan = events.some((event) => event.type === "PlanImported");
    const plan = hasPlan ? replayEvents(events) : demoPlan;
    return {
      plan,
      latestOffset: latestLogOffset(events),
      sessionOffsets: computeSessionOffsets(events, plan),
    } satisfies Cache;
  }, [query.isSuccess, query.data]);

  useEffect(() => {
    if (live) writeCache(live);
  }, [live]);

  const resolved = useMemo(() => {
    if (live) return { ...live, source: "live" as DataSource };
    const saved = readCache();
    if (saved) return { ...saved, source: "saved" as DataSource };
    return {
      plan: demoPlan,
      latestOffset: 0,
      sessionOffsets: computeSessionOffsets([], demoPlan),
      source: "sample" as DataSource,
    };
    // query.isError is included so the saved copy is re-read after a failed refresh
  }, [live, query.isError]);

  const record = useCallback(
    async (type: string, payload: Record<string, unknown>) => {
      await append.mutateAsync({ branchId: "main", type, payload, source: "sound-check-in" });
      await utils.events.readEvents.invalidate();
    },
    [append, utils],
  );

  return { ...resolved, canRecord: query.isSuccess, record };
}
