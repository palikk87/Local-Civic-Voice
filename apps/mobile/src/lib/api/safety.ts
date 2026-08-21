/**
 * Blocking, muting and reporting.
 *
 * These had a menu in the app long before they had endpoints, and the handlers
 * behind it popped an Alert saying the thing had happened. Somebody being
 * harassed pressed Block and was told "you will no longer see posts from this
 * user" while nothing at all had been recorded.
 */
import { api } from "./api";

export type ReportReason =
  | "spam"
  | "harassment"
  | "hate"
  | "violence"
  | "misinformation"
  | "other";

export interface SafetyListEntry {
  id: string;
  user: { id: string; name: string; username: string | null; image: string | null };
  createdAt: string;
}

export const safetyApi = {
  block: (userId: string) =>
    api.post<{ success: boolean; isBlocked: boolean }>(`/api/safety/blocks/${userId}`),
  unblock: (userId: string) =>
    api.delete<{ success: boolean; isBlocked: boolean }>(`/api/safety/blocks/${userId}`),
  blocks: () => api.get<{ results: SafetyListEntry[] }>("/api/safety/blocks"),

  mute: (userId: string) =>
    api.post<{ success: boolean; isMuted: boolean }>(`/api/safety/mutes/${userId}`),
  unmute: (userId: string) =>
    api.delete<{ success: boolean; isMuted: boolean }>(`/api/safety/mutes/${userId}`),
  mutes: () => api.get<{ results: SafetyListEntry[] }>("/api/safety/mutes"),

  report: (body: {
    postId?: string;
    commentId?: string;
    userId?: string;
    reason: ReportReason;
    detail?: string;
  }) => api.post<{ success: boolean; reportId: string }>("/api/safety/reports", body),

  relationship: (userId: string) =>
    api.get<{ isBlocked: boolean; isMuted: boolean; contactClosed: boolean }>(
      `/api/safety/relationship/${userId}`,
    ),
};
