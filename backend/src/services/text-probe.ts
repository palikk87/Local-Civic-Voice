/**
 * Where, exactly, does pulling a law's text fail?
 *
 * WHY THIS EXISTS. "No official text available" is one sentence covering a
 * dozen different failures: a key that is not set, a key that is set but
 * rejected, an id that does not parse, a source that returned 404, a source
 * that returned a login page instead of a document, a document under the
 * 200-character floor. From outside they are indistinguishable, and every round
 * of guessing at which one it is costs a day.
 *
 * This walks the SAME source chain the real fetch walks — same URLs, same
 * order, same acceptance rules — and reports each attempt with its status,
 * its size, and the reason it was or was not accepted. It writes nothing.
 *
 * It runs in the deployment, because that is where the network is. Reasoning
 * about a fetch from a machine that cannot make it is how this took as long as
 * it did.
 */

import { prisma } from "../prisma";
import { ReferenceKind, parseReferenceId } from "./master-reference-id";

export interface ProbeAttempt {
  /** Which link in the chain: "congress.gov/text", "federalregister/search", … */
  source: string;
  url: string;
  /** HTTP status, or null when the request never completed. */
  status: number | null;
  /** Bytes returned. */
  bytes: number;
  /** Characters of usable text after stripping markup. */
  chars: number;
  accepted: boolean;
  /** In plain words: what happened. */
  note: string;
}

export interface ProbeReport {
  masterReferenceId: string;
  referenceType: string;
  sourceUrl: string | null;
  /** Parsed identity, or null when the id itself is the problem. */
  parsedId: string | null;
  keys: { congress: boolean; courtListener: boolean };
  storedTextChars: number;
  attempts: ProbeAttempt[];
  /** The first source that yielded usable text, or null if none did. */
  succeededWith: string | null;
}

/** The floor the real fetcher uses: shorter than this is an error page, not a law. */
const MIN_TEXT_CHARS = 200;

function htmlToText(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Never let a key reach the report. */
function redact(url: string): string {
  return url.replace(/api_key=[^&]+/g, "api_key=REDACTED");
}

/** One request, and everything learned from it — including the body, so a
 * lookup is never fetched twice just to be parsed. */
interface Fetched {
  attempt: ProbeAttempt;
  body: string;
}

async function attempt(
  source: string,
  url: string,
  headers: Record<string, string> = {},
): Promise<Fetched> {
  const base: ProbeAttempt = {
    source,
    url: redact(url),
    status: null,
    bytes: 0,
    chars: 0,
    accepted: false,
    note: "",
  };
  let raw = "";
  try {
    const response = await fetch(url, {
      headers: { Accept: "text/plain, text/html, application/json, */*", ...headers },
      signal: AbortSignal.timeout(15_000),
    });
    raw = await response.text();
    const looksLikeHtml = /<\/?(html|body|div|p|pre)\b/i.test(raw.slice(0, 2_000));
    const text = (looksLikeHtml ? htmlToText(raw) : raw).trim();

    base.status = response.status;
    base.bytes = raw.length;
    base.chars = text.length;

    if (!response.ok) {
      base.note = `refused with HTTP ${response.status}`;
      return { attempt: base, body: raw };
    }
    if (text.length <= MIN_TEXT_CHARS) {
      base.note = `returned only ${text.length} characters — below the ${MIN_TEXT_CHARS} floor, so treated as an error page rather than a document`;
      return { attempt: base, body: raw };
    }
    base.accepted = true;
    base.note = `usable: ${text.length} characters`;
    return { attempt: base, body: raw };
  } catch (error) {
    base.note = `request failed: ${error instanceof Error ? error.message : String(error)}`;
    return { attempt: base, body: raw };
  }
}

async function json<T>(
  source: string,
  url: string,
  headers: Record<string, string> = {},
): Promise<{ data: T | null; attempt: ProbeAttempt }> {
  const { attempt: a, body } = await attempt(source, url, headers);
  if (a.status !== 200) return { data: null, attempt: a };
  try {
    return { data: JSON.parse(body) as T, attempt: a };
  } catch {
    a.note = `answered 200 but the body was not JSON (${a.bytes} bytes)`;
    return { data: null, attempt: a };
  }
}

export async function probeReferenceText(referenceId: string): Promise<ProbeReport | null> {
  const ref = await prisma.governmentReference.findUnique({
    where: { id: referenceId },
    select: {
      masterReferenceId: true,
      referenceType: true,
      sourceUrl: true,
      congress: true,
      fullText: true,
    },
  });
  if (!ref) return null;

  const congressKey = process.env.CONGRESS_API_KEY;
  const report: ProbeReport = {
    masterReferenceId: ref.masterReferenceId,
    referenceType: ref.referenceType,
    sourceUrl: ref.sourceUrl,
    parsedId: null,
    keys: { congress: !!congressKey, courtListener: !!process.env.COURTLISTENER_API_KEY },
    storedTextChars: ref.fullText?.length ?? 0,
    attempts: [],
    succeededWith: null,
  };

  const push = (a: ProbeAttempt) => {
    report.attempts.push(a);
    if (a.accepted && !report.succeededWith) report.succeededWith = a.source;
  };

  if (ref.referenceType === "bill") {
    const key = parseReferenceId(ReferenceKind.BILL, ref.masterReferenceId);
    const congress = key?.kind === "bill" ? (key.congress ?? ref.congress) : null;
    if (key?.kind === "bill" && congress) {
      report.parsedId = `${key.billType}-${key.number}-${congress}`;
      const base = `https://api.congress.gov/v3/bill/${congress}/${key.billType}/${key.number}`;

      if (congressKey) {
        const { data, attempt: a } = await json<{
          textVersions?: Array<{ formats?: Array<{ type?: string; url?: string }> }>;
        }>("congress.gov/text (index)", `${base}/text?format=json&api_key=${congressKey}`);
        push(a);

        const versions = data?.textVersions ?? [];
        if (a.status === 200 && versions.length === 0) {
          a.note += " — but the response lists NO text versions, which is what congress.gov returns for a bill whose text has not been published yet";
        }
        for (const version of [...versions].reverse()) {
          const formats = version.formats ?? [];
          const preferred =
            formats.find((f) => (f.type ?? "").toLowerCase().includes("formatted text")) ??
            formats.find((f) => (f.type ?? "").toLowerCase().includes("text")) ??
            formats[0];
          if (!preferred?.url) continue;
          push((await attempt("congress.gov/text (document)", preferred.url)).attempt);
          if (report.succeededWith) break;
        }

        if (!report.succeededWith) {
          const { data: sum, attempt: sa } = await json<{ summaries?: Array<{ text?: string }> }>(
            "congress.gov/summaries",
            `${base}/summaries?format=json&api_key=${congressKey}`,
          );
          const latest = sum?.summaries?.[sum.summaries.length - 1]?.text;
          const chars = latest ? htmlToText(latest).trim().length : 0;
          sa.chars = chars;
          sa.accepted = chars > MIN_TEXT_CHARS;
          sa.note = latest
            ? sa.accepted
              ? `usable: ${chars} characters of CRS summary`
              : `summary present but only ${chars} characters`
            : "no summaries published for this bill";
          push(sa);
        }
      } else {
        push({
          source: "congress.gov",
          url: `${base}/text`,
          status: null,
          bytes: 0,
          chars: 0,
          accepted: false,
          note: "skipped — CONGRESS_API_KEY is not set in this environment",
        });
      }
    } else {
      report.parsedId = null;
      push({
        source: "congress.gov",
        url: "",
        status: null,
        bytes: 0,
        chars: 0,
        accepted: false,
        note: `skipped — "${ref.masterReferenceId}" does not parse into a bill identity with a Congress, so no congress.gov URL can be built`,
      });
    }

    if (!report.succeededWith && ref.sourceUrl) {
      push((await attempt("congress.gov/page", `${ref.sourceUrl}/text`)).attempt);
    }
  }

  if (ref.referenceType === "executive_order") {
    const docNumber = ref.sourceUrl?.match(
      /federalregister\.gov\/documents\/[\d/]+\/([\w-]+)/,
    )?.[1];
    report.parsedId = docNumber ?? null;

    if (docNumber) {
      const { data, attempt: da } = await json<{
        raw_text_url?: string | null;
        body_html_url?: string | null;
      }>(
        "federalregister/lookup",
        `https://www.federalregister.gov/api/v1/documents/${docNumber}.json?fields[]=raw_text_url&fields[]=body_html_url`,
      );
      da.accepted = false;
      da.note =
        da.status === 200
          ? `document record found; raw text ${data?.raw_text_url ? "published" : "NOT published"}`
          : da.note;
      push(da);
      for (const url of [data?.raw_text_url, data?.body_html_url]) {
        if (!url) continue;
        push((await attempt("federalregister/document", url)).attempt);
        if (report.succeededWith) break;
      }
    }

    const eoNumber = ref.masterReferenceId.replace(/^eo-/i, "").replace(/\D/g, "");
    if (!report.succeededWith && eoNumber) {
      const { data, attempt: sa } = await json<{
        results?: Array<{ executive_order_number?: string | number | null; raw_text_url?: string | null }>;
      }>(
        "federalregister/search",
        `https://www.federalregister.gov/api/v1/documents.json?conditions[presidential_document_type]=executive_order&conditions[term]=${eoNumber}&per_page=5&fields[]=executive_order_number&fields[]=raw_text_url`,
      );
      const match = data?.results?.find(
        (r) => String(r.executive_order_number ?? "").replace(/\D/g, "") === eoNumber,
      );
      sa.note = match
        ? `found EO ${eoNumber} in the search results`
        : `searched for EO ${eoNumber} and no result carried that exact number (${data?.results?.length ?? 0} result(s) returned)`;
      sa.accepted = false;
      push(sa);
      if (match?.raw_text_url) {
        push((await attempt("federalregister/search (document)", match.raw_text_url)).attempt);
      }
    }

    if (!report.succeededWith && ref.sourceUrl) {
      push((await attempt("source-page", ref.sourceUrl)).attempt);
    }
  }

  if (ref.referenceType === "scotus_case") {
    const docket = ref.masterReferenceId.replace(/^scotus-/i, "");
    report.parsedId = docket;
    const key = process.env.COURTLISTENER_API_KEY;

    if (key) {
      const auth = { Authorization: `Token ${key}` };
      const { data, attempt: sa } = await json<{
        results?: Array<{ opinions?: Array<{ id?: number }> }>;
      }>(
        "courtlistener/search",
        `https://www.courtlistener.com/api/rest/v4/search/?type=o&court=scotus&docket_number=${encodeURIComponent(docket)}`,
        auth,
      );
      sa.accepted = false;
      if (sa.status === 401 || sa.status === 403) {
        sa.note = `COURTLISTENER_API_KEY was rejected (HTTP ${sa.status}) — the key is set but not accepted`;
      }
      push(sa);
      const ids = (data?.results ?? [])
        .flatMap((r) => r.opinions?.map((o) => o.id) ?? [])
        .filter((id): id is number => typeof id === "number");
      if (ids.length === 0) {
        push({
          source: "courtlistener/v4",
          url: "https://www.courtlistener.com/api/rest/v4/search/",
          status: null,
          bytes: 0,
          chars: 0,
          accepted: false,
          note: `no SCOTUS opinion found for docket "${docket}"`,
        });
      }
      for (const id of ids.slice(0, 3)) {
        push(
          (
            await attempt(
              "courtlistener/opinion",
              `https://www.courtlistener.com/api/rest/v4/opinions/${id}/`,
              auth,
            )
          ).attempt,
        );
        if (report.succeededWith) break;
      }
    } else {
      push({
        source: "courtlistener/v4",
        url: "",
        status: null,
        bytes: 0,
        chars: 0,
        accepted: false,
        note: "skipped — COURTLISTENER_API_KEY is not set, so only the public page below is tried",
      });
    }

    if (!report.succeededWith && ref.sourceUrl) {
      push((await attempt("courtlistener/page", ref.sourceUrl)).attempt);
    }
  }

  return report;
}
