import { useQuery } from "@tanstack/react-query";
import type { PublicConfig, Summary } from "@hc/shared";
import { api, ApiError } from "./api";
import type { Line } from "./voice";

export const useConfig = () => useQuery({ queryKey: ["config"], queryFn: () => api<PublicConfig>("/config"), staleTime: 5 * 60_000 });

export interface Progress {
  registered: boolean;
  role: "manager" | "viewer" | null;
  email?: string;
  player?: { name: string; email: string; officeId: string; office?: string };
  summary?: Summary;
  activeAttempt?: { id: string; roundKey: string } | null;
  next?: { action: "resume" | "preround" | "total"; roundKey?: string };
}
// signed-out is a normal 200 { registered:false }; a network blip or 5xx must NOT look like a logout, so errors retry
export const useProgress = () =>
  useQuery({
    queryKey: ["progress"], staleTime: 10_000, retry: 4, retryDelay: (n) => Math.min(8000, 800 * 2 ** n),
    queryFn: () => api<Progress>("/me/progress").catch((e) => {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return { registered: false, role: null } as Progress;
      throw e;
    }),
  });

export const useLines = (section: string) =>
  useQuery({ queryKey: ["lines", section], queryFn: () => api<Line[]>(`/sahayika/lines?section=${section}`), staleTime: 5_000, refetchOnWindowFocus: true });
export const lineById = (lines: Line[] | undefined, id: string) => lines?.find((l) => l.id === id) ?? null;
/** The script (edited in the manager console) is the source of truth; the string is only a fallback if the script cannot load. */
export const scriptLine = (lines: Line[] | undefined, id: string, fallback: string): Line => lineById(lines, id) ?? { id: "faq", en: fallback, hi: "" };
