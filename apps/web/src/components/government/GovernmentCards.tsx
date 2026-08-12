/**
 * Web port of the cards and detail sheet in mobile `(tabs)/government.tsx`.
 * Same information, same actions — rendered with Tailwind and shadcn/ui instead
 * of React Native primitives, and responsive for desktop.
 */
import { useState } from "react";
import { ChevronRight, Globe, Phone, Twitter, X } from "lucide-react";
import {
  initials,
  sinceLabel,
  type Member,
  type Official,
  type Party,
} from "@/lib/government-service";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type Person = Member | Official;

export const PARTY_STYLES: Record<Party, { bg: string; text: string; border: string }> = {
  D: { bg: "bg-blue-900/50", text: "text-blue-400", border: "border-blue-700/50" },
  R: { bg: "bg-red-900/50", text: "text-red-400", border: "border-red-700/50" },
  I: { bg: "bg-purple-900/50", text: "text-purple-400", border: "border-purple-700/50" },
};

const NEUTRAL_STYLE = {
  bg: "bg-slate-700/50",
  text: "text-slate-300",
  border: "border-slate-700/50",
};

export function stylesFor(party: Party | null) {
  return party ? PARTY_STYLES[party] : NEUTRAL_STYLE;
}

export function isMember(person: Person): person is Member {
  return "chamber" in person;
}

/** Official portrait, falling back to initials when there's no photo on file. */
export function Portrait({
  name,
  photoUrl,
  className,
}: {
  name: string;
  photoUrl: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!photoUrl || failed) {
    return (
      <div
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full bg-slate-700 text-base font-semibold text-slate-300",
          className ?? "h-16 w-16",
        )}
        aria-hidden="true"
      >
        {initials(name)}
      </div>
    );
  }

  return (
    <img
      src={photoUrl}
      alt={name}
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn("shrink-0 rounded-full bg-slate-700 object-cover", className ?? "h-16 w-16")}
    />
  );
}

function ContactRow({ person }: { person: Person }) {
  const twitter = "twitter" in person ? person.twitter : null;

  const links: Array<{ key: string; label: string; href: string; icon: typeof Phone; className?: string }> = [];

  if (person.phone) {
    links.push({
      key: "call",
      label: "Call",
      href: `tel:${person.phone.replace(/[^\d+]/g, "")}`,
      icon: Phone,
    });
  }
  if (person.website) {
    links.push({ key: "site", label: "Website", href: person.website, icon: Globe });
  }
  if (twitter) {
    links.push({
      key: "x",
      label: "X",
      href: `https://twitter.com/${twitter.replace("@", "")}`,
      icon: Twitter,
      className: "text-[#1DA1F2]",
    });
  }

  if (links.length === 0) return null;

  return (
    <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-700/50 pt-4">
      {links.map((link) => (
        <a
          key={link.key}
          href={link.href}
          target={link.href.startsWith("http") ? "_blank" : undefined}
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-slate-700/50 px-3 py-2 text-xs text-slate-300 transition-colors hover:bg-slate-700"
        >
          <link.icon className={cn("h-3.5 w-3.5", link.className ?? "text-slate-400")} />
          {link.label}
        </a>
      ))}
    </div>
  );
}

export function MemberCard({
  member,
  onSelect,
}: {
  member: Member;
  onSelect: (person: Person) => void;
}) {
  const colors = PARTY_STYLES[member.party];

  return (
    <button
      type="button"
      onClick={() => onSelect(member)}
      className={cn(
        "w-full rounded-xl border bg-slate-800/70 p-4 text-left transition-colors hover:bg-slate-800",
        colors.border,
      )}
    >
      <div className="flex gap-4">
        <Portrait name={member.name} photoUrl={member.photoUrl} />

        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <h3 className="truncate text-lg font-semibold text-white">{member.name}</h3>
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", colors.bg, colors.text)}>
              {member.party}
            </span>
          </div>

          <p className="mb-2 text-sm text-slate-400">{member.title}</p>

          {member.leadershipRole ? (
            <span className="mb-2 inline-block rounded-full bg-amber-500/20 px-2 py-1 text-xs font-semibold text-amber-400">
              {member.leadershipRole}
            </span>
          ) : null}

          <div className="flex items-center gap-2">
            <span
              className={cn(
                "rounded-full px-2 py-1 text-xs font-medium",
                member.chamber === "house"
                  ? "bg-blue-900/40 text-blue-400"
                  : "bg-purple-900/40 text-purple-400",
              )}
            >
              {member.chamber === "house" ? "House" : "Senate"}
            </span>
            <span className="text-xs text-slate-500">{member.partyName}</span>
          </div>
        </div>

        <ChevronRight className="my-auto h-6 w-6 shrink-0 text-slate-500" />
      </div>

      <ContactRow person={member} />
    </button>
  );
}

export function OfficialCard({
  official,
  onSelect,
  rank,
}: {
  official: Official;
  onSelect: (person: Person) => void;
  rank?: number | null;
}) {
  const colors = stylesFor(official.party);

  return (
    <button
      type="button"
      onClick={() => onSelect(official)}
      className={cn(
        "w-full rounded-xl border bg-slate-800/70 p-4 text-left transition-colors hover:bg-slate-800",
        colors.border,
      )}
    >
      <div className="flex gap-4">
        {rank ? (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-sm font-bold text-amber-400">
            {rank}
          </div>
        ) : null}

        <Portrait name={official.name} photoUrl={official.photoUrl} />

        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <h3 className="truncate text-lg font-semibold text-white">{official.name}</h3>
            {official.party ? (
              <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", colors.bg, colors.text)}>
                {official.party}
              </span>
            ) : null}
          </div>

          <p className="text-sm text-slate-400">{official.title}</p>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            {official.acting ? (
              <span className="rounded-full bg-amber-500/20 px-2 py-1 text-xs font-semibold text-amber-400">
                Acting
              </span>
            ) : null}
            {official.appointedBy ? (
              <span className="text-xs text-slate-500">Appointed by {official.appointedBy}</span>
            ) : null}
            {official.since ? (
              <span className="text-xs text-slate-500">Since {sinceLabel(official.since)}</span>
            ) : null}
          </div>
        </div>

        <ChevronRight className="my-auto h-6 w-6 shrink-0 text-slate-500" />
      </div>

      <ContactRow person={official} />
    </button>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-700/30 py-2 last:border-0">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-right text-sm text-slate-300">{value}</span>
    </div>
  );
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Detail dialog — full record plus the constituent message form for members of Congress. */
export function DetailDialog({
  person,
  onClose,
}: {
  person: Person | null;
  onClose: () => void;
}) {
  const [message, setMessage] = useState("");

  if (!person) return null;

  const member = isMember(person) ? person : null;
  const official = isMember(person) ? null : (person as Official);
  const colors = stylesFor(person.party);

  const contactFormUrl = person.website
    ? person.website.endsWith("/")
      ? `${person.website}contact`
      : `${person.website}/contact`
    : null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          setMessage("");
          onClose();
        }
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto border-slate-700 bg-slate-900 sm:max-w-lg">
        <div className="mb-5 flex items-center gap-4">
          <Portrait name={person.name} photoUrl={person.photoUrl} />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-white">{person.name}</h2>
            <p className="text-sm text-slate-400">{person.title}</p>
          </div>
          {person.party ? (
            <span className={cn("rounded-full px-2 py-1 text-sm font-medium", colors.bg, colors.text)}>
              {person.party}
            </span>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full bg-slate-800 p-2 text-slate-400 transition-colors hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-5 rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
          {member ? (
            <>
              <DetailRow
                label="Chamber"
                value={member.chamber === "house" ? "House of Representatives" : "Senate"}
              />
              <DetailRow label="State" value={member.stateName} />
              {member.district !== null ? (
                <DetailRow label="District" value={String(member.district)} />
              ) : null}
              {member.leadershipRole ? (
                <DetailRow label="Leadership" value={member.leadershipRole} />
              ) : null}
              {member.servingSince ? (
                <DetailRow label="Serving since" value={String(member.servingSince)} />
              ) : null}
            </>
          ) : official ? (
            <>
              <DetailRow label="Branch" value={capitalise(official.branch)} />
              {official.acting ? <DetailRow label="Status" value="Acting" /> : null}
              {official.appointedBy ? (
                <DetailRow label="Appointed by" value={official.appointedBy} />
              ) : null}
              {official.since ? (
                <DetailRow label="In office since" value={sinceLabel(official.since)!} />
              ) : null}
              {official.successionOrder ? (
                <DetailRow label="Line of succession" value={`#${official.successionOrder}`} />
              ) : null}
            </>
          ) : null}
          {person.phone ? <DetailRow label="Phone" value={person.phone} /> : null}
          {"office" in person && person.office ? (
            <DetailRow label="Office" value={person.office} />
          ) : null}
        </div>

        {official?.bio ? (
          <p className="mb-5 text-sm leading-relaxed text-slate-400">{official.bio}</p>
        ) : null}

        <ContactRow person={person} />

        {member ? (
          <div className="mt-6">
            <h3 className="mb-2 font-semibold text-white">Send a message</h3>
            <p className="mb-4 text-sm text-slate-400">
              Let your representative know your thoughts on current legislation
            </p>

            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Write your message here..."
              rows={5}
              className="mb-4 min-h-[120px] border-slate-700 bg-slate-800 text-white"
            />

            <div className="flex gap-4">
              <Button variant="secondary" className="flex-1" onClick={onClose}>
                Cancel
              </Button>
              <Button
                className="flex-1 bg-amber-500 text-slate-900 hover:bg-amber-400"
                disabled={!contactFormUrl}
                asChild={Boolean(contactFormUrl)}
              >
                {contactFormUrl ? (
                  <a href={contactFormUrl} target="_blank" rel="noreferrer">
                    Open contact form
                  </a>
                ) : (
                  <span>Open contact form</span>
                )}
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function SectionHeading({
  title,
  blurb,
  count,
}: {
  title: string;
  blurb?: string;
  count?: number;
}) {
  return (
    <div className="mb-3 mt-6 first:mt-0">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-bold text-white">{title}</h2>
        {count !== undefined ? (
          <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs font-medium text-slate-400">
            {count}
          </span>
        ) : null}
      </div>
      {blurb ? <p className="mt-0.5 text-xs text-slate-500">{blurb}</p> : null}
    </div>
  );
}

export function FilterPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "min-h-[36px] shrink-0 rounded-full px-3.5 py-2 text-sm font-medium transition-colors",
        active ? "bg-amber-500 text-slate-900" : "bg-slate-800 text-slate-300 hover:bg-slate-700",
      )}
    >
      {label}
    </button>
  );
}
