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
 *
 * AND A ZIP CODE FINDS IT FOR YOU. Reported plainly: "almost no one knows what
 * their district or reps are". Searching by district number asks somebody to
 * already know the answer they came here for. A ZIP is the thing people know,
 * so typing one offers the districts it falls in.
 *
 * THE ZIP IS NOT KEPT, and the panel beside this has always said so. It goes to
 * a lookup and is gone; what gets saved is the district chosen, as before.
 *
 * A ZIP IS NOT A DISTRICT. Seventeen in every hundred lie across more than one
 * — 90002 across four — so this offers every district the ZIP touches, the
 * largest share first, with the representative's name against each. The person
 * still chooses. Anything else would be the app guessing where somebody lives
 * and being quietly wrong about one in six of them.
 */
import { useEffect, useMemo, useState } from "react";
import { Check, ExternalLink, Loader2, MapPin, Search, ShieldCheck, Trash2 } from "lucide-react";
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

interface ZipLookup {
  districts: DistrictOption[];
  spansSeveral: boolean;
  source: string;
  vintage: string;
}

interface Mine {
  districtId: string | null;
  stateCode: string | null;
  district: DistrictOption | null;
  explanation: { why: string; collected: string; shared: string; optional: string };
}

/**
 * THE OFFICIAL LOOKUP, FOR THE ONE IN SIX A ZIP CANNOT SETTLE.
 *
 * The House of Representatives runs a finder that takes a ZIP and, only when
 * that ZIP straddles districts, asks for a street address to settle it. The
 * address goes to the House — an institution that already has it — and never
 * touches this platform. It is the honest way to answer the hard case without
 * this app ever asking anybody where they live.
 *
 * They come back and pick the district they were told. We still store nothing
 * but that choice.
 */
const HOUSE_FINDER = "https://www.house.gov/representatives/find-your-representative";

function HouseFinderLink() {
  return (
    <a
      href={HOUSE_FINDER}
      target="_blank"
      rel="noreferrer"
      data-testid="house-finder-link"
      className="inline-flex items-center gap-1.5 text-sm text-accent underline underline-offset-2"
    >
      Look yourself up on house.gov
      <ExternalLink className="h-3.5 w-3.5" />
    </a>
  );
}

export function DistrictPicker({ onChange }: { onChange?: (districtId: string | null) => void }) {
  const [options, setOptions] = useState<DistrictOption[]>([]);
  const [mine, setMine] = useState<Mine | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  const [zip, setZip] = useState("");
  const [zipLooking, setZipLooking] = useState(false);
  const [zipResult, setZipResult] = useState<ZipLookup | null>(null);
  const [zipError, setZipError] = useState<string | null>(null);

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

  /**
   * Look the ZIP up. Nothing is saved by this — it reads a table and forgets.
   *
   * An empty answer and a failed lookup are different sentences on purpose:
   * "that ZIP is not in any district" is a claim about somebody's home, and it
   * must never be what a download failure looks like.
   */
  async function lookUpZip(value: string) {
    setZipLooking(true);
    setZipError(null);
    setZipResult(null);
    try {
      const found = await api.get<ZipLookup>(
        `/api/users/jurisdiction/by-zip/${encodeURIComponent(value)}`,
      );
      setZipResult(found);
      if (found.districts.length === 0) {
        setZipError("No district matched that ZIP. Check the digits, or search by state below.");
      }
    } catch (error) {
      setZipError(
        error instanceof Error && error.message
          ? error.message
          : "Could not look that up. You can still search by state below.",
      );
    } finally {
      setZipLooking(false);
    }
  }

  async function choose(districtId: string) {
    setSaving(true);
    try {
      await api.put("/api/users/me/jurisdiction", { districtId });
      const current = await api.get<Mine>("/api/users/me/jurisdiction");
      setMine(current);
      setSearch("");
      setZip("");
      setZipResult(null);
      setZipError(null);
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

      {/* THE ZIP BOX, FIRST, because it is the thing people know. Searching by
          district number is still here underneath for anybody who does know. */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (/^\d{5}$/.test(zip)) void lookUpZip(zip);
        }}
        className="space-y-2"
      >
        <label htmlFor="district-zip" className="text-sm font-medium text-foreground">
          Find it with your ZIP code
        </label>
        <div className="flex gap-2">
          <Input
            id="district-zip"
            data-testid="district-zip"
            value={zip}
            onChange={(event) => {
              const digits = event.target.value.replace(/\D/g, "").slice(0, 5);
              setZip(digits);
              setZipError(null);
              if (digits.length < 5) setZipResult(null);
            }}
            inputMode="numeric"
            placeholder="e.g. 90210"
            aria-label="Your ZIP code"
          />
          <Button
            type="submit"
            variant="secondary"
            data-testid="district-zip-find"
            disabled={zip.length !== 5 || zipLooking}
          >
            {zipLooking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Search className="mr-1.5 h-4 w-4" /> Find
              </>
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Used to look up the district and then discarded. It is not saved to your account.
        </p>
      </form>

      {zipError ? (
        <div data-testid="district-zip-error" className="space-y-1.5">
          <p className="text-sm text-amber-500">{zipError}</p>
          <HouseFinderLink />
          <p className="text-xs text-muted-foreground">
            It asks the House for your address, not us. Come back and pick what it tells you.
          </p>
        </div>
      ) : null}

      {zipResult && zipResult.districts.length > 0 ? (
        <div data-testid="district-zip-results" className="rounded-lg border border-border p-3">
          {/* SAID OUT LOUD WHEN IT IS NOT ONE ANSWER. A ZIP that straddles
              districts is common enough that hiding it would make the app wrong
              about roughly one person in six, silently. */}
          <p className="mb-2 text-sm text-muted-foreground">
            {zipResult.spansSeveral
              ? `That ZIP crosses ${zipResult.districts.length} districts. Pick the one whose representative is yours — most of the ZIP is in the first.`
              : "That ZIP is in this district."}
          </p>
          <ul className="space-y-1">
            {zipResult.districts.map((d) => (
              <li key={d.districtId}>
                <button
                  type="button"
                  onClick={() => void choose(d.districtId)}
                  disabled={saving}
                  className="flex w-full items-center justify-between rounded-md border border-border px-3 py-2 text-left transition-colors hover:border-accent/60 hover:bg-muted"
                >
                  <span>
                    <span className="font-medium text-foreground">{d.districtId}</span>
                    <span className="ml-2 text-sm text-muted-foreground">
                      {d.representative?.name ?? "seat vacant"}
                      {d.representative ? ` (${d.representative.party})` : ""}
                    </span>
                  </span>
                  {d.districtId === mine?.districtId ? (
                    <Check className="h-4 w-4 text-emerald-500" />
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
          {zipResult.spansSeveral ? (
            <div className="mt-3 space-y-1.5 border-t border-border/60 pt-3">
              <p className="text-sm text-muted-foreground">Not sure which is yours?</p>
              <HouseFinderLink />
              <p className="text-xs text-muted-foreground">
                It asks the House for your address, not us. Come back and pick what it tells
                you.
              </p>
            </div>
          ) : null}

          <p className="mt-2 text-xs text-muted-foreground">
            Boundaries from the U.S. Census Bureau ({zipResult.vintage}). Seats from
            congress.gov.
          </p>
        </div>
      ) : null}

      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Or search by state, district, or your representative's name"
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
