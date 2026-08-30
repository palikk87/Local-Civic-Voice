import { fetch } from "expo/fetch";
import { authClient } from "../auth/auth-client";
import { BACKEND_URL } from "../config";

const baseUrl = BACKEND_URL;

// IMPORTANT: This sets the cookies/auth token in the headers
const request = async <T>(
  url: string,
  options: { method?: string; body?: string } = {}
): Promise<T> => {
  const response = await fetch(`${baseUrl}${url}`, {
    ...options,
    credentials: "include",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      Cookie: authClient.getCookie(),
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(error.error || "Request failed");
  }

  return response.json();
};

export interface UploadedMediaResponse {
  id: string;
  type: string;
  url: string;
  thumbnailUrl: string | null;
}

/**
 * Upload one file and get back what the server stored.
 *
 * SEPARATE FROM `request` because multipart must not carry a JSON
 * content-type, and because the body is FormData rather than a string.
 *
 * It exists at all because every caller was writing its own — against a
 * RELATIVE url, which on a phone has no origin to resolve against, so the
 * upload could never have reached the API. Each of them then fell back to
 * passing the local `file://` path off as an uploaded URL, which no other
 * device can load.
 */
export async function uploadMedia(file: {
  uri: string;
  name: string;
  type: string;
}): Promise<UploadedMediaResponse> {
  const body = new FormData();
  body.append("file", file as unknown as Blob);

  const response = await fetch(`${baseUrl}/api/media/upload`, {
    method: "POST",
    body: body as unknown as BodyInit,
    credentials: "include",
    // Content-Type is deliberately unset: the runtime has to add the multipart
    // boundary itself, and naming the type by hand omits it.
    headers: { Cookie: authClient.getCookie() },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Upload failed" }));
    throw new Error(error.error || "Upload failed");
  }

  const result = (await response.json()) as { media?: UploadedMediaResponse };
  if (!result.media?.url) {
    throw new Error("Upload returned no file");
  }
  return result.media;
}

export const api = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, body?: unknown) =>
    request<T>(url, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(url: string, body: unknown) =>
    request<T>(url, { method: "PUT", body: JSON.stringify(body) }),
  /**
   * A body is optional and rarely right on a DELETE — but closing an account
   * needs the password and the typed username travelling with the request, and
   * they must not go in the URL where they would land in a log.
   */
  delete: <T>(url: string, body?: unknown) =>
    request<T>(url, {
      method: "DELETE",
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  patch: <T>(url: string, body: unknown) =>
    request<T>(url, { method: "PATCH", body: JSON.stringify(body) }),
};
