import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Send,
  KeySquare,
  Database,
  Server,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { api } from "@/lib/api";
import { adminAuthHeader, useAdminCan } from "@/lib/mobile/admin-store";

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

type SecretSource = "database" | "environment" | "unset";

interface KeyStatus {
  name: string;
  present: boolean;
  fingerprint: string | null;
  length: number | null;
  looksRight: boolean;
  powers: string;
  withoutIt: string;
  /** Which of the two places the value in use came from. */
  source: SecretSource;
}

interface StoredSecretInfo {
  name: string;
  source: SecretSource;
  storedInDatabase: boolean;
  presentInEnvironment: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
}

interface KeysResponse {
  data: {
    keys: KeyStatus[];
    warnings: string[];
    note: string;
    storage: {
      stored: StoredSecretInfo[];
      storable: string[];
      encryptionAvailable: boolean;
      encryptionUnavailableReason: string | null;
      encryptionSource: string | null;
      encryptionCaveat: string | null;
      note: string;
      cannotBeStored: { names: string[]; why: string };
    };
  };
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
  // ASK WHAT THE ROLE MAY DO, NOT WHAT IT IS CALLED. Both of these were
  // `role === "superadmin"`, so a role the owner built and granted these exact
  // capabilities to was refused nothing by the server and shown neither
  // control by the console.
  const canManageKeys = useAdminCan("keys.manage");
  const canTestEmail = useAdminCan("email.test");

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
                  {key.present ? <SourceLine source={key.source} /> : null}
                  {canManageKeys && data?.data.storage ? (
                    <KeyEditor
                      name={key.name}
                      stored={data.data.storage.stored.find((s) => s.name === key.name)}
                      canStore={data.data.storage.encryptionAvailable}
                      whyNot={data.data.storage.encryptionUnavailableReason}
                    />
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

          {data?.data.storage ? (
            <div className="mt-4 rounded-md border border-border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">{data.data.storage.note}</p>
              {data.data.storage.encryptionCaveat ? (
                <p className="mt-2 text-xs text-amber-500">
                  {data.data.storage.encryptionCaveat}
                </p>
              ) : null}
              <p className="mt-2 text-xs text-muted-foreground">
                <span className="font-mono">
                  {data.data.storage.cannotBeStored.names.join(", ")}
                </span>{" "}
                stay on the host. {data.data.storage.cannotBeStored.why}
              </p>
            </div>
          ) : null}
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

      {canTestEmail ? (
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

/** Which of the two places the value in use came from, said plainly. */
function SourceLine({ source }: { source: SecretSource }) {
  if (source === "database") {
    return (
      <p className="mt-1 flex items-center gap-1.5 text-xs text-emerald-500">
        <Database className="h-3 w-3" aria-hidden="true" />
        Stored here, in the platform's own database. Moves with it to any host.
      </p>
    );
  }
  if (source === "environment") {
    return (
      <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Server className="h-3 w-3" aria-hidden="true" />
        Set as a variable on whatever host is running this API. Re-typing it is part of moving.
      </p>
    );
  }
  return null;
}

/**
 * Set or clear one key, from a phone if that is what is to hand.
 *
 * WHY THIS EXISTS. Rotating a key used to mean opening the hosting dashboard
 * and redeploying, which put every rotation behind one person and one browser
 * tab. It takes effect on the next request now: the server reads its secrets
 * live rather than snapshotting them at boot, so nothing restarts.
 *
 * WRITE-ONLY, ALWAYS. There is no code path on the server that returns a stored
 * key, so there is nothing here to reveal one. The box is always empty; what
 * confirms a paste worked is the fingerprint and length above it changing.
 */
function KeyEditor({
  name,
  stored,
  canStore,
  whyNot,
}: {
  name: string;
  stored: StoredSecretInfo | undefined;
  canStore: boolean;
  whyNot: string | null;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    const pasted = value.trim();
    if (!pasted) {
      setMessage({ ok: false, text: "Paste a key first." });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const response = await api.put<{ data: { message: string } }>(
        `/api/admin/keys/${name}`,
        { value: pasted },
        { headers: adminAuthHeader() },
      );
      setValue("");
      setOpen(false);
      setMessage({ ok: true, text: response.data.message });
      await queryClient.invalidateQueries({ queryKey: ["admin", "keys"] });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Could not store the key." });
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await api.delete<{ data: { message: string } }>(
        `/api/admin/keys/${name}`,
        { headers: adminAuthHeader() },
      );
      setMessage({ ok: true, text: response.data.message });
      await queryClient.invalidateQueries({ queryKey: ["admin", "keys"] });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Could not clear the key." });
    } finally {
      setBusy(false);
    }
  }

  if (!canStore) {
    // Said once per key rather than hidden: somebody looking for the box needs
    // to know why there isn't one, and what to do about it.
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        {whyNot ?? "Keys cannot be stored on this deployment."}
      </p>
    );
  }

  return (
    <div className="mt-2">
      {message ? (
        <p className={`mb-2 text-xs ${message.ok ? "text-emerald-500" : "text-destructive"}`}>
          {message.text}
        </p>
      ) : null}

      {open ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={`Paste ${name}`}
            className="h-9 max-w-xs font-mono text-xs"
          />
          <Button size="sm" className="min-h-[36px]" onClick={save} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="min-h-[36px]"
            onClick={() => {
              setOpen(false);
              setValue("");
            }}
            disabled={busy}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" className="min-h-[36px]" onClick={() => setOpen(true)}>
            {stored?.storedInDatabase ? "Replace" : "Store here"}
          </Button>
          {stored?.storedInDatabase ? (
            <Button
              size="sm"
              variant="ghost"
              className="min-h-[36px] text-destructive"
              onClick={clear}
              disabled={busy}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Clear"}
            </Button>
          ) : null}
          {stored?.storedInDatabase && stored.updatedBy ? (
            <span className="text-xs text-muted-foreground">
              set by {stored.updatedBy}
              {stored.updatedAt ? ` on ${new Date(stored.updatedAt).toLocaleDateString()}` : ""}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}
