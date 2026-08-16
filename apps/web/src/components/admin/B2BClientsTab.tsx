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

  const rotate = useMutation({
    mutationFn: ({ id, what }: { id: string; what: "password" | "apiKey" }) =>
      api.post<{ credentials: IssuedCredentials; revokedSessions: number }>(
        `/api/admin/b2b-clients/${id}/rotate`,
        { [what]: true },
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
                    onClick={() => rotate.mutate({ id: client.id, what: "password" })}
                    disabled={rotate.isPending}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Password
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => rotate.mutate({ id: client.id, what: "apiKey" })}
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
