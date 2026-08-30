// Web port of mobile/src/app/admin/b2b-clients.tsx — B2B portal accounts.
//
// These accounts read every citizen's aggregated sentiment, so creating one is
// closer to granting a role than to adding a record. The API enforces that:
// listing is open to any admin, everything else is superadmin only.
//
// SECRETS ARE SHOWN ONCE. The password is stored as a scrypt hash and the API
// key as a SHA-256 digest, neither reversible, so there is no way to display
// them again — only to rotate. That is why the reveal dialog is deliberately
// hard to dismiss by accident.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Copy, KeyRound, Plus, RefreshCw, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { adminAuthHeader } from "@/lib/mobile/admin-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface B2BClient {
  id: string;
  username: string;
  name: string;
  type: string;
  tier: string;
  lastAccessAt: string | null;
  createdAt: string;
  activeSessions: number;
}

interface IssuedCredentials {
  username: string;
  password?: string;
  apiKey?: string;
}

const CLIENT_TYPES = ["research", "media", "campaign", "lobbyist", "ngo", "corporation"] as const;
const TIERS = ["basic", "professional", "enterprise"] as const;

const TIER_BADGE: Record<string, string> = {
  basic: "bg-slate-500/20 text-slate-500",
  professional: "bg-blue-500/20 text-blue-500",
  enterprise: "bg-amber-500/20 text-amber-600",
};

function formatDate(value: string | null): string {
  if (!value) return "never";
  return new Date(value).toLocaleString();
}

export function B2BClientsTab() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [issued, setIssued] = useState<IssuedCredentials | null>(null);
  const [settingPasswordFor, setSettingPasswordFor] = useState<B2BClient | null>(null);
  const [chosenPassword, setChosenPassword] = useState("");
  /**
   * The rotation waiting to be confirmed.
   *
   * THE INCIDENT THIS EXISTS FOR. A B2B password stopped working and the person
   * it belonged to was certain he had not changed it. The backend was already
   * unable to re-key anybody on its own — that was fixed twice, and it held.
   * The path that was left is this screen: "Password" and "API key" were plain
   * buttons that rotated a live credential on a single click, no confirmation,
   * sitting in the same row as a tier dropdown and wrapping onto two lines on a
   * narrow window. The only control in the row that asked before acting was
   * Delete, which is the less severe of the two: a deleted client is obviously
   * gone, whereas a rotated one looks exactly like a working account that has
   * started rejecting the right password.
   *
   * From the desk of the business paying for the dashboard, that is
   * indistinguishable from a breach. So the rule this puts back is the one the
   * project already had for the backend, applied to the UI: a credential moves
   * only when somebody deliberately says so, naming the account and the
   * consequence.
   */
  const [rotating, setRotating] = useState<{ client: B2BClient; what: "password" | "apiKey" } | null>(
    null,
  );
  const [form, setForm] = useState({
    username: "",
    name: "",
    type: "research",
    tier: "professional",
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "b2b-clients"],
    queryFn: () =>
      api.get<{ clients: B2BClient[] }>("/api/admin/b2b-clients", {
        headers: adminAuthHeader(),
      }),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin", "b2b-clients"] });

  const createClient = useMutation({
    mutationFn: () =>
      api.post<{ client: B2BClient; credentials: IssuedCredentials }>(
        "/api/admin/b2b-clients",
        form,
        { headers: adminAuthHeader() },
      ),
    onSuccess: (response) => {
      setCreateOpen(false);
      setForm({ username: "", name: "", type: "research", tier: "professional" });
      setIssued(response.credentials);
      void refresh();
    },
    onError: (e: Error) => toast.error(e.message || "Could not create the client"),
  });

  /**
   * Rotate, either to a generated value or to one the admin typed.
   *
   * The endpoint has always accepted `newPassword`; this UI only ever sent the
   * randomize flag, so the only way to give a client a password they had agreed
   * on was to rotate and then read the generated one back to them. A chosen
   * password is a legitimate need — onboarding calls, shared credentials
   * handed over in person — and refusing it here did not make anything safer,
   * it just moved the workaround off the platform.
   *
   * Generated is still the default and still the better path: a password an
   * administrator invented is a password an administrator knows.
   */
  const rotate = useMutation({
    mutationFn: ({
      id,
      what,
      newPassword,
    }: {
      id: string;
      what: "password" | "apiKey";
      newPassword?: string;
    }) =>
      api.post<{ credentials: IssuedCredentials; revokedSessions: number }>(
        `/api/admin/b2b-clients/${id}/rotate`,
        { [what]: true, ...(newPassword ? { newPassword } : {}) },
        { headers: adminAuthHeader() },
      ),
    onSuccess: (response) => {
      setIssued(response.credentials);
      if (response.revokedSessions > 0) {
        toast.success(`Rotated. ${response.revokedSessions} active session(s) signed out.`);
      }
      void refresh();
    },
    onError: (e: Error) => toast.error(e.message || "Could not rotate"),
  });

  const changeTier = useMutation({
    mutationFn: ({ id, tier }: { id: string; tier: string }) =>
      api.patch<{ client: B2BClient }>(
        `/api/admin/b2b-clients/${id}`,
        { tier },
        { headers: adminAuthHeader() },
      ),
    onSuccess: () => {
      toast.success("Tier updated. It applies to sessions already open.");
      void refresh();
    },
    onError: (e: Error) => toast.error(e.message || "Could not change the tier"),
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      api.delete<{ revokedSessions: number }>(`/api/admin/b2b-clients/${id}`, {
        headers: adminAuthHeader(),
      }),
    onSuccess: (response) => {
      toast.success(`Deleted. ${response.revokedSessions} active session(s) revoked.`);
      void refresh();
    },
    onError: (e: Error) => toast.error(e.message || "Could not delete the client"),
  });

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Could not copy — select the text and copy it manually");
    }
  };

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-sm">
        Could not load B2B clients. {(error as Error).message}
      </div>
    );
  }

  const clients = data?.clients ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Building2 className="h-5 w-5" />
            B2B portal accounts
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Analytics logins for the business dashboard. Superadmin only.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New client
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : clients.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          No B2B accounts yet. Create one, or run <code>scripts/seed-b2b.ts</code>.
        </div>
      ) : (
        <div className="space-y-3">
          {clients.map((client) => (
            <div key={client.id} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{client.name}</span>
                    <Badge className={TIER_BADGE[client.tier] ?? ""}>{client.tier}</Badge>
                    <Badge variant="outline">{client.type}</Badge>
                    {client.activeSessions > 0 && (
                      <Badge variant="secondary">
                        {client.activeSessions} signed in
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    {client.username} · created {formatDate(client.createdAt)} · last login{" "}
                    {formatDate(client.lastAccessAt)}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={client.tier}
                    onValueChange={(tier) => changeTier.mutate({ id: client.id, tier })}
                  >
                    <SelectTrigger className="w-[150px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIERS.map((tier) => (
                        <SelectItem key={tier} value={tier}>
                          {tier}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setRotating({ client, what: "password" })}
                    disabled={rotate.isPending}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Password
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSettingPasswordFor(client)}
                    disabled={rotate.isPending}
                  >
                    <KeyRound className="mr-2 h-4 w-4" />
                    Set password
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setRotating({ client, what: "apiKey" })}
                    disabled={rotate.isPending}
                  >
                    <KeyRound className="mr-2 h-4 w-4" />
                    API key
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      if (
                        window.confirm(
                          `Delete ${client.name}? This signs out every session it has open and cannot be undone.`,
                        )
                      ) {
                        remove.mutate(client.id);
                      }
                    }}
                    disabled={remove.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New B2B client</DialogTitle>
            <DialogDescription>
              A password and API key are generated for you and shown once.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <Input
              placeholder="Username (letters, digits, _ . -)"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
            <Input
              placeholder="Display name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <Select value={form.type} onValueChange={(type) => setForm({ ...form, type })}>
              <SelectTrigger>
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                {CLIENT_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={form.tier} onValueChange={(tier) => setForm({ ...form, tier })}>
              <SelectTrigger>
                <SelectValue placeholder="Tier" />
              </SelectTrigger>
              <SelectContent>
                {TIERS.map((tier) => (
                  <SelectItem key={tier} value={tier}>
                    {tier}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createClient.mutate()}
              disabled={createClient.isPending || !form.username.trim() || !form.name.trim()}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/*
        Deliberately NOT dismissible by clicking outside or pressing Escape.
        These values cannot be recovered, so closing this by accident means
        rotating again — the one interaction in this console where a stray
        click has a real cost.
      */}
      <Dialog open={!!issued} onOpenChange={() => undefined}>
        <DialogContent
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TriangleAlert className="h-5 w-5 text-amber-500" />
              Copy these now
            </DialogTitle>
            <DialogDescription>
              They are stored hashed and cannot be shown again. If you lose them, rotate.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <CredentialRow label="Username" value={issued?.username ?? ""} onCopy={copy} />
            {issued?.password && (
              <CredentialRow label="Password" value={issued.password} onCopy={copy} />
            )}
            {issued?.apiKey && (
              <CredentialRow label="API key" value={issued.apiKey} onCopy={copy} />
            )}
          </div>

          <DialogFooter>
            <Button onClick={() => setIssued(null)}>I have copied them</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/*
        Rotation, confirmed.

        Deliberately NOT window.confirm, which Delete still uses. A browser
        confirm is one Enter key away from accepted, and several people work
        this console with a keyboard. This asks for a click on a button that
        says what it is about to do, to an account it names.

        The consequence is spelled out rather than implied, because the reason
        this matters is not the new password — it is that every session the
        client has open stops working at once, and the person on the other end
        has no way to tell that from being locked out.
      */}
      <Dialog open={!!rotating} onOpenChange={(open) => !open && setRotating(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TriangleAlert className="h-5 w-5 text-amber-500" />
              {rotating?.what === "password" ? "Rotate the password" : "Rotate the API key"}
            </DialogTitle>
            <DialogDescription>
              {rotating ? (
                <>
                  This replaces the {rotating.what === "password" ? "password" : "API key"} for{" "}
                  <span className="font-medium text-foreground">{rotating.client.name}</span>{" "}
                  with a new one, right now.
                  {rotating.what === "password"
                    ? " Every session it has open is signed out, and nobody there will be able to sign in again until you have given them the new password."
                    : " Anything calling the API with the old key starts failing immediately."}{" "}
                  The new value is shown once and cannot be recovered. Recorded in the activity log
                  with your name.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRotating(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={rotate.isPending}
              onClick={() => {
                if (!rotating) return;
                rotate.mutate({ id: rotating.client.id, what: rotating.what });
                setRotating(null);
              }}
            >
              {rotating?.what === "password" ? "Rotate the password" : "Rotate the API key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Set a chosen password.
          Rotating to a generated value stays the default and the better path;
          this exists because "the client agreed a password on a call" is a real
          situation, and without it the workaround was to rotate and read the
          generated one down the phone — which is worse. */}
      <Dialog
        open={!!settingPasswordFor}
        onOpenChange={(open) => {
          if (!open) {
            setSettingPasswordFor(null);
            setChosenPassword("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Set a password</DialogTitle>
            <DialogDescription>
              For {settingPasswordFor?.name}. This signs out every session the old
              password opened, and is recorded in the activity log with your name.
            </DialogDescription>
          </DialogHeader>

          <Input
            type="text"
            autoComplete="off"
            placeholder="At least 12 characters"
            value={chosenPassword}
            onChange={(event) => setChosenPassword(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Shown as you type on purpose — you are about to read it to somebody, and a
            masked field is how a typo becomes a locked-out client.
          </p>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setSettingPasswordFor(null);
                setChosenPassword("");
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={chosenPassword.trim().length < 12 || rotate.isPending}
              onClick={() => {
                const client = settingPasswordFor;
                if (!client) return;
                rotate.mutate({
                  id: client.id,
                  what: "password",
                  newPassword: chosenPassword.trim(),
                });
                setSettingPasswordFor(null);
                setChosenPassword("");
              }}
            >
              Set it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CredentialRow({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy: (label: string, value: string) => void;
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto rounded bg-muted px-3 py-2 text-sm">
          {value}
        </code>
        <Button variant="outline" size="sm" onClick={() => onCopy(label, value)}>
          <Copy className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
