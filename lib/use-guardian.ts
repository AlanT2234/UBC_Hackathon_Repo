"use client";

import { useSyncExternalStore } from "react";
import { getSnapshot, subscribe, type Snapshot } from "@/lib/api";

export function useGuardian(): Snapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
