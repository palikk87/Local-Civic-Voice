import { Button } from "@/components/ui/button";
import { DistrictPicker } from "@/components/civic/DistrictPicker";

/**
 * Where do you live? — asked once, at sign-up, and easy to walk past.
 *
 * WHY IT IS HERE. A district set later is a district almost nobody sets: the
 * Edit profile dialog is not somewhere people go on their first day. Asking
 * once, at the moment somebody is already filling things in, is the difference
 * between a map with people on it and a map with nobody on it.
 *
 * WHY IT IS OPTIONAL, AND LOOKS IT. Amendment I holds that the power of the
 * vote originates in the individual. A ballot conditional on saying where you
 * live is the lock-in that Amendment forbids — so Skip is a real button, given
 * the same weight as the rest of the screen rather than hidden as small grey
 * text, and the words say plainly that the vote counts either way.
 *
 * NOTHING NEW IS ASKED FOR. It is the same picker as the profile, with the
 * same ZIP lookup and the same promise: the ZIP is used to find the district
 * and then discarded, and only the district chosen is ever saved.
 */
export function DistrictStep({ onDone }: { onDone: () => void }) {
  return (
    <div className="space-y-4" data-testid="signup-district-step">
      <div>
        <h2 className="font-display text-xl font-semibold text-foreground">
          Where should your vote count?
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Optional. Your vote counts either way — this places it in your own district, so the
          Pulse can be compared with how your representative actually voted.
        </p>
      </div>

      <DistrictPicker onChange={() => undefined} />

      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onDone} data-testid="skip-district">
          Skip for now
        </Button>
        <Button className="flex-1" onClick={onDone} data-testid="finish-signup">
          Done
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        You can add or remove this at any time from your profile.
      </p>
    </div>
  );
}
