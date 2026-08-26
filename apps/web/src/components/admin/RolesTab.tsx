/**
 * Who may do what, and the ability to change it without a deploy.
 *
 * WHY THIS SCREEN EXISTS. The platform shipped with three fixed roles whose
 * powers lived in fourteen scattered `role !== "superadmin"` checks. The answer
 * to "what can a moderator actually do" could only be found by reading every
 * route, and changing it meant a code change, a review and a deploy. Roles are
 * rows now, and this is where they are edited.
 *
 * EVERY CHECKBOX HERE NAMES SOMETHING REAL. The capability list comes from the
 * API, which builds it from the same literals the routes check by name — there
 * is no way to invent a permission, because a permission that gates nothing is
 * worse than no permission system at all. It is believed, and acted on.
 *
 * THE OWNER IS SHOWN AND CANNOT BE EDITED. That is not an oversight to fix
 * later: it is the property that makes every other row here safe to change.
 * Somebody has to be able to undo a mistake, including the mistake of removing
 * their own access.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Lock, Plus, Shield, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { adminAuthHeader } from "@/lib/mobile/admin-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface CapabilityDefinition {
  key: string;
  label: string;
  grants: string;
  group: string;
  severe?: boolean;
}

interface RoleRow {
  slug: string;
  name: string;
  description: string | null;
  capabilities: string[];
  builtIn: boolean;
  editable: boolean;
  holders: number;
}

interface RolesResponse {
  data: {
    owner: RoleRow;
    roles: RoleRow[];
    capabilities: CapabilityDefinition[];
    note: string;
  };
}

export function RolesTab() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ name: string; capabilities: Set<string> }>({
    name: "",
    capabilities: new Set(),
  });
  const [creating, setCreating] = useState(false);
  const [newSlug, setNewSlug] = useState("");
  const [newName, setNewName] = useState("");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["admin", "roles"],
    queryFn: () => api.get<RolesResponse>("/api/admin/roles", { headers: adminAuthHeader() }),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["admin", "roles"] });

  const saveMutation = useMutation({
    mutationFn: (input: { slug: string; name: string; capabilities: string[] }) =>
      api.put(`/api/admin/roles/${input.slug}`, input, { headers: adminAuthHeader() }),
    onSuccess: () => {
      toast.success("Saved. It applies to their next request, not their next login.");
      setEditing(null);
      void invalidate();
    },
    onError: (e: Error) => toast.error("Could not save", { description: e.message }),
  });

  const createMutation = useMutation({
    mutationFn: (input: { slug: string; name: string; capabilities: string[] }) =>
      api.post("/api/admin/roles", input, { headers: adminAuthHeader() }),
    onSuccess: () => {
      toast.success("Role created");
      setCreating(false);
      setNewSlug("");
      setNewName("");
      void invalidate();
    },
    onError: (e: Error) => toast.error("Could not create the role", { description: e.message }),
  });

  const deleteMutation = useMutation({
    mutationFn: (slug: string) =>
      api.delete(`/api/admin/roles/${slug}`, { headers: adminAuthHeader() }),
    onSuccess: () => {
      toast.success("Role deleted");
      void invalidate();
    },
    onError: (e: Error) => toast.error("Could not delete it", { description: e.message }),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading roles…</p>;
  if (isError) {
    return (
      <p className="text-sm text-destructive">
        {error instanceof Error ? error.message : "Could not read the roles."}
      </p>
    );
  }

  const { owner, roles, capabilities, note } = data!.data;
  const groups = [...new Set(capabilities.map((c) => c.group))];

  function startEditing(role: RoleRow) {
    setEditing(role.slug);
    setDraft({ name: role.name, capabilities: new Set(role.capabilities) });
  }

  function toggle(key: string) {
    setDraft((current) => {
      const next = new Set(current.capabilities);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...current, capabilities: next };
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-lg font-semibold text-foreground">Roles</h2>
        <p className="mt-1 text-sm text-muted-foreground">{note}</p>
      </div>

      {/* The owner, first and uneditable. */}
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
        <div className="flex items-center gap-2">
          <Lock className="h-4 w-4 text-amber-500" aria-hidden="true" />
          <span className="font-medium text-foreground">{owner.name}</span>
          <Badge variant="secondary">{owner.holders} account</Badge>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{owner.description}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          The seat is not assignable from here, and the account holding it cannot be banned,
          deleted, re-keyed or re-roled by anybody — including itself. That is what makes every
          role below safe to change.
        </p>
      </div>

      {roles.map((role) => {
        const isEditing = editing === role.slug;
        return (
          <div key={role.slug} className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                {isEditing ? (
                  <Input
                    value={draft.name}
                    onChange={(e) => setDraft((c) => ({ ...c, name: e.target.value }))}
                    className="h-8 max-w-[220px]"
                  />
                ) : (
                  <span className="font-medium text-foreground">{role.name}</span>
                )}
                <span className="font-mono text-xs text-muted-foreground">{role.slug}</span>
                {role.builtIn ? <Badge variant="secondary">built in</Badge> : null}
                <Badge variant="outline">
                  {role.holders} {role.holders === 1 ? "account" : "accounts"}
                </Badge>
              </div>

              <div className="flex gap-2">
                {isEditing ? (
                  <>
                    <Button variant="outline" size="sm" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      disabled={saveMutation.isPending || !draft.name.trim()}
                      onClick={() =>
                        saveMutation.mutate({
                          slug: role.slug,
                          name: draft.name.trim(),
                          capabilities: [...draft.capabilities],
                        })
                      }
                    >
                      {saveMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Save"
                      )}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="outline" size="sm" onClick={() => startEditing(role)}>
                      Edit
                    </Button>
                    {!role.builtIn ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => deleteMutation.mutate(role.slug)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </>
                )}
              </div>
            </div>

            {role.description ? (
              <p className="mt-2 text-sm text-muted-foreground">{role.description}</p>
            ) : null}

            <div className="mt-3 space-y-3">
              {groups.map((group) => (
                <div key={group}>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {group}
                  </p>
                  <div className="mt-1 space-y-1">
                    {capabilities
                      .filter((capability) => capability.group === group)
                      .map((capability) => {
                        const held = isEditing
                          ? draft.capabilities.has(capability.key)
                          : role.capabilities.includes(capability.key);
                        return (
                          <label
                            key={capability.key}
                            className={`flex items-start gap-2 rounded p-1 text-sm ${
                              isEditing ? "cursor-pointer hover:bg-muted/50" : ""
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={held}
                              disabled={!isEditing}
                              onChange={() => toggle(capability.key)}
                              className="mt-1"
                            />
                            <span className="min-w-0">
                              <span
                                className={held ? "text-foreground" : "text-muted-foreground"}
                              >
                                {capability.label}
                              </span>
                              {capability.severe ? (
                                <AlertTriangle
                                  className="ml-1 inline h-3 w-3 text-amber-500"
                                  aria-label="Hands over real power"
                                />
                              ) : null}
                              <span className="block text-xs text-muted-foreground">
                                {capability.grants}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {creating ? (
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="font-medium text-foreground">A new role</p>
          <p className="mt-1 text-sm text-muted-foreground">
            It starts with nothing. Create it, then tick what it may do.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm text-muted-foreground">Name</label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Content Editor"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-muted-foreground">
                Slug (permanent)
              </label>
              <Input
                value={newSlug}
                onChange={(e) => setNewSlug(e.target.value.toLowerCase())}
                placeholder="content-editor"
              />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!newName.trim() || !newSlug.trim() || createMutation.isPending}
              onClick={() =>
                createMutation.mutate({
                  slug: newSlug.trim(),
                  name: newName.trim(),
                  capabilities: [],
                })
              }
            >
              Create
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" onClick={() => setCreating(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          New role
        </Button>
      )}
    </div>
  );
}
