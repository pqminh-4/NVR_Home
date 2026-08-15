import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { Camera, NvrEvent, SystemInfo } from "../lib/types";

export function useCameras() {
  return useQuery<Camera[]>({
    queryKey: ["cameras"],
    queryFn: () => api.get("/cameras"),
    refetchInterval: 15000,
  });
}

export function useSystemInfo(enabled = true) {
  return useQuery<SystemInfo>({
    queryKey: ["system"],
    queryFn: () => api.get("/system/info"),
    enabled,
    refetchInterval: 30000,
  });
}

export function useEventsFilters(filters: Record<string, string | number>, enabled = true) {
  const qs = new URLSearchParams(
    Object.entries(filters).map(([k, v]) => [k, String(v)]),
  ).toString();
  return useQuery<{ total: number; items: NvrEvent[] }>({
    queryKey: ["events", qs],
    queryFn: () => api.get(`/events?${qs}`),
    enabled,
  });
}

export function useInvalidate() {
  const qc = useQueryClient();
  return {
    cameras: () => qc.invalidateQueries({ queryKey: ["cameras"] }),
    events: () => qc.invalidateQueries({ queryKey: ["events"] }),
    system: () => qc.invalidateQueries({ queryKey: ["system"] }),
    settings: () => qc.invalidateQueries({ queryKey: ["settings"] }),
    faces: () => qc.invalidateQueries({ queryKey: ["faces"] }),
  };
}
