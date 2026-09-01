/**
 * WHERE A RECORD LIVES, for the web app.
 *
 * The rule itself lives in @civic/core/record-url so the phone cannot drift
 * from it — they had already drifted once, which is why it moved. This file is
 * the web's door to that rule, plus the one thing only a browser can answer:
 * what origin it is being served from.
 *
 * BOTH ADDRESSES KEEP WORKING. /reference/:id is what every link ever shared
 * uses, and it still serves the page — the branch URL is simply the canonical
 * one, which is what <PageMeta> tells a crawler. A redirect would have meant a
 * flash on every open and a lookup before we knew where to send anybody.
 */
export type { AddressableRecord, ReferenceType as RecordBranch } from "@civic/core/record-url";
export { recordPath } from "@civic/core/record-url";

import type { AddressableRecord } from "@civic/core/record-url";
import { recordPath } from "@civic/core/record-url";

/** The absolute form, for canonical links, share previews and copied links. */
export function recordUrl(record: AddressableRecord): string {
  const origin =
    typeof window === "undefined" ? "https://ayeandnay.com" : window.location.origin;
  return `${origin}${recordPath(record)}`;
}
