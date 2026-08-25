import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, XCircle, AlertTriangle, Loader2, Send, KeySquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { api } from "@/lib/api";
import { adminAuthHeader, useAdminStore } from "@/lib/mobile/admin-store";

/**
 * Which keys this server actually holds, and does email actually send.
 *
 * WHY THIS IS A SCREEN AND NOT AN ENDPOINT. Three separate times on this
 * project a key was set and the thing it powers did not work, and each time the
 * only way to find out which of the two was wrong involved reading source code
 * or typing curl. Answering "is my key working?" should not require either. It
 * is one panel and one button.
 *
 * No key is ever shown. The fingerprint is four hex characters of its digest —
 * enough to compare against what you pasted, worth nothing to anybody who reads
 * it over your shoulder.
 */

interface KeyStatus {
  name: string;
  present: boolean;
  fingerprint: string | null;
  length: number | null;
  looksRight: boolean;
  powers: string;
  withoutIt: string;
}

interface KeysResponse {
  data: { keys: KeyStatus[]; warnings: string[]; note: string };
}

interface TestResult {
  sent: boolean;
  to: string;
  from?: string;
  note?: string;
  code?: string;
  detail?: string;
}

export function KeysAndEmailCard() {
  const session = useAdminStore((s) => s.session);
  const isSuperadmin = session?.role === "superadmin";

  const [to, setTo] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "keys"],
    queryFn: () => api.get<KeysResponse>("/api/admin/keys", { headers: adminAuthHeader() }),
  });

  async function sendTest() {
    const address = to.trim();
    if (!address) {
      setResult({ sent: false, to: "", detail: "Enter an address to send the test to." });
      return;
    }

    setSending(true);
    setResult(null);
    try {
      const response = await api.post<TestResult>(
        "/api/admin/email-health/test",
        { to: address },
        { headers: adminAuthHeader() },
      );
      setResult(response);
    } catch (e) {
      // The endpoint answers 502/503 with the provider's own words on failure,
      // and the api helper turns a non-2xx into a thrown Error carrying them.
      // That message is the answer, so it is shown rather than replaced.
      setResult({
        sent: false,
        to: address,
        detail: e instanceof Error ? e.message : "The test could not be sent.",
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <KeySquare className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <p className="font-medium text-foreground">API keys and email</p>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        What this API process can actually see. A key set anywhere else — the web host, a
        build-time variable, another service — is not used and does not appear here.
      </p>

      <Separator className="my-4" />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Checking…</p>
      ) : error ? (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Could not read the key status."}
        </p>
      ) : (
        <>
          {data?.data.warnings.length ? (
            <div className="mb-4 space-y-2">
              {data.data.warnings.map((warning) => (
                <div
                  key={warning}
                  className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3"
                >
                  <AlertTriangle
                    className="mt-0.5 h-4 w-4 shrink-0 text-amber-500"
                    aria-hidden="true"
                  />
                  <p className="text-sm text-foreground">{warning}</p>
                </div>
              ))}
            </div>
          ) : null}

          <ul className="space-y-3">
            {data?.data.keys.map((key) => (
              <li key={key.name} className="flex gap-3">
                {key.present ? (
                  <CheckCircle2
                    className={`mt-0.5 h-4 w-4 shrink-0 ${
                      key.looksRight ? "text-emerald-500" : "text-amber-500"
                    }`}
                    aria-hidden="true"
                  />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
                )}
                <div className="min-w-0">
                  <p className="font-mono text-sm text-foreground">
                    {key.name}{" "}
                    {key.present ? (
                      <span className="text-muted-foreground">
                        · {key.fingerprint} · {key.length} chars
                        {key.looksRight ? "" : " · unexpected format"}
                      </span>
                    ) : (
                      <span className="text-destructive">· not set</span>
                    )}
                  </p>
                  <p className="text-sm text-muted-foreground">{key.powers}</p>
                  {!key.present ? (
                    <p className="text-sm text-amber-500">{key.withoutIt}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>

          <p className="mt-4 text-xs text-muted-foreground">
            The four characters after each name are a fingerprint of the stored value, not part
            of the key. Compare them with a fingerprint of what you pasted to tell whether this
            server has the same value.
          </p>
        </>
      )}

      <Separator className="my-4" />

      <p className="font-medium text-foreground">Send a test email</p>
      <p className="mt-1 text-sm text-muted-foreground">
        The only way to know for certain. A key can be perfectly valid and every message still
        be refused, because Resend rejects mail from a domain that is not verified in the
        account the key belongs to — and that refusal looks exactly like a bad key. This says
        which it is, in the provider's own words.
      </p>

      {isSuperadmin ? (
        <>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Input
              type="email"
              placeholder="you@example.com"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void sendTest();
              }}
            />
            <Button disabled={sending} onClick={() => void sendTest()}>
              {sending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              {sending ? "Sending…" : "Send test"}
            </Button>
          </div>

          {result ? (
            <div
              className={`mt-3 rounded-md border p-3 text-sm ${
                result.sent
                  ? "border-emerald-500/40 bg-emerald-500/10"
                  : "border-destructive/40 bg-destructive/10"
              }`}
            >
              {result.sent ? (
                <>
                  <p className="text-foreground">
                    Accepted by the provider, sent from{" "}
                    <span className="font-mono">{result.from}</span>.
                  </p>
                  <p className="mt-1 text-muted-foreground">{result.note}</p>
                </>
              ) : (
                <>
                  <p className="text-foreground">Not sent.</p>
                  {/* Verbatim. This sentence usually names the problem —
                      an unverified sending domain says so here and nowhere
                      else in the product. */}
                  <p className="mt-1 break-words font-mono text-xs text-muted-foreground">
                    {result.detail}
                  </p>
                </>
              )}
            </div>
          ) : null}
        </>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          A superadmin sends the test — it spends the mail quota and can be pointed at any
          address.
        </p>
      )}
    </div>
  );
}
