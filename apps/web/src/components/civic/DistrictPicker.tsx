/**
 * Tell us your district, or don't.
 *
 * WHY THIS EXISTS AND WHAT IT IS ALLOWED TO ASK FOR. Bill of Rights Article IV:
 * "AYE & NAY shall collect only the minimum data necessary to verify
 * citizenship and jurisdiction." Jurisdiction is named there as a legitimate
 * purpose, which is what makes this screen permissible — and the same sentence
 * is why it asks for a district and never a street, a ZIP it keeps, or a
 * position from the browser.
 *
 * OPTIONAL, AND SAID SO ON THE SCREEN. Article I holds that the power of the
 * vote originates in the individual. A ballot conditional on handing over an
 * address would be the lock-in that article forbids, so declining costs nothing
 * — the vote still counts nationally, it simply is not placed on a map.
 *
 * THE LIST IS THE REAL ONE. Districts and the people holding them come from the
 * congress.gov roster, so somebody choosing theirs sees their representative's
 * name and can tell at a glance whether they picked right. That is also why no
 * guessing is needed: the confirmation is built into the choice.
 */
import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, MapPin, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface DistrictOption {
  districtId: string;
  stateCode: string;
  stateName: string;
  district: number | null;
  representative: { name: string; party: string; photoUrl: string | null } | null;
}

interface Mine {
  districtId: string | null;
  stateCode: string | null;
  district: DistrictOption | null;
  explanation: { why: string; collected: string; shared: string; optional: string };
}

export function DistrictPicker({ onChange }: { onChange?: (districtId: string | null) => void }) {
  const [options, setOptions] = useState<DistrictOption[]>([]);
  const [mine, setMine] = useState<Mine | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [list, current] = await Promise.all([
          api.get<{ districts: DistrictOption[] }>("/api/users/jurisdiction/districts"),
          api.get<Mine>("/api/users/me/jurisdiction"),
        ]);
        if (cancelled) return;
        setOptions(list.districts);
        setMine(current);
      } catch {
        if (!cancelled) toast.error("Could not load the district list.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return options
      .filter(
        (d) =>
          d.districtId.toLowerCase().includes(q) ||
          d.stateName.toLowerCase().includes(q) ||
          (d.representative?.name ?? "").toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [options, search]);

  async function choose(districtId: string) {
    setSaving(true);
    try {
      await api.put("/api/users/me/jurisdiction", { districtId });
      const current = await api.get<Mine>("/api/users/me/jurisdiction");
      setMine(current);
      setSearch("");
      onChange?.(districtId);
      toast.success("Your district is set.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That did not save.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true);
    try {
      await api.delete("/api/users/me/jurisdiction");
      const current = await api.get<Mine>("/api/users/me/jurisdiction");
      setMine(current);
      onChange?.(null);
      toast.success("Removed. Your votes are untouched.");
    } catch {
      toast.error("That did not save.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading districts…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <MapPin className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium text-foreground">Your district</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          optional
        </span>
      </div>

      {mine?.district ? (
        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-medium text-foreground">
                {mine.district.districtId} — {mine.district.stateName}
              </p>
              {mine.district.representative ? (
                <p className="text-sm text-muted-foreground">
                  Represented by {mine.district.representative.name} (
                  {mine.district.representative.party})
                </p>
              ) : null}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void remove()}
              disabled={saving}
              aria-label="Remove my district"
            >
              <Trash2 className="mr-1.5 h-4 w-4" />
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          You have not said. Your votes still count — they just are not placed on a map.
        </p>
      )}

      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by state, district, or your representative's name"
        aria-label="Search for your district"
      />

      {matches.length > 0 ? (
        <ul className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-border p-1">
          {matches.map((d) => {
            const isMine = d.districtId === mine?.districtId;
            return (
              <li key={d.districtId}>
                <button
                  type="button"
                  onClick={() => void choose(d.districtId)}
                  disabled={saving}
                  className={cn(
                    "flex w-full items-center justify-between rounded-md px-3 py-2 text-left transition-colors hover:bg-muted",
                    isMine && "bg-muted",
                  )}
                >
                  <span>
                    <span className="font-medium text-foreground">{d.districtId}</span>
                    <span className="ml-2 text-sm text-muted-foreground">
                      {d.representative?.name ?? "seat vacant"}
                    </span>
                  </span>
                  {isMine ? <Check className="h-4 w-4 text-emerald-500" /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {/*
        The reason and the limit, on the screen, in the moment somebody is
        deciding. A person handing over their district is owed both here rather
        than in a policy document nobody opens — and the text comes from the API
        so it cannot drift out of step with what the server actually does.
      */}
      {mine?.explanation ? (
        <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
          <div className="mb-1.5 flex items-center gap-1.5 font-medium text-foreground">
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
            What this is for
          </div>
          <ul className="space-y-1 text-muted-foreground">
            <li>{mine.explanation.why}</li>
            <li>{mine.explanation.collected}</li>
            <li>{mine.explanation.shared}</li>
            <li>{mine.explanation.optional}</li>
          </ul>
        </div>
      ) : null}
    </div>
  );
}
