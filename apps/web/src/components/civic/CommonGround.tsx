import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Handshake } from "lucide-react";
import { api } from "@/lib/api";

interface SharedPosition {
  reference: { id: string; masterReferenceId: string; title: string; referenceType: string };
  yourPosition: string;
  theirPosition: string;
}

interface CommonGroundResponse {
  shared: number;
  agreed: number;
  disagreed: number;
  agreements: SharedPosition[];
  disagreements: SharedPosition[];
}

/**
 * Where you and this person actually agree, and where you do not.
 *
 * NOT A COMPATIBILITY SCORE. Every platform that has tried to tell you about
 * another person did it by inferring — clicks, follows, a model's guess — and
 * the output is a similarity number, which sorts people into groups. That
 * mechanism is the thing everybody blames for the state of the conversation.
 *
 * Nothing is inferred here. Both of you took public positions on the same
 * government records, so the overlap is a matter of record: "you have both
 * taken a position on fourteen; here are the nine you agree on and the five
 * you do not."
 *
 * BOTH LISTS, ALWAYS. Showing only the common ground would introduce somebody
 * to the parts of a stranger they already like and hide the rest. The whole
 * value of a shared record is seeing that the person you argue with about the
 * border is with you on insulin.
 */
export function CommonGround({ userId, name }: { userId: string; name: string }) {
  const { data } = useQuery({
    queryKey: ["common-ground", userId],
    queryFn: () => api.get<CommonGroundResponse>(`/api/users/${userId}/common-ground`),
    enabled: Boolean(userId),
    retry: false,
  });

  // Blank on any shape the backend cannot return, rather than taking the
  // profile down with it.
  if (typeof data?.shared !== "number") return null;
  if (data.shared === 0) return null;

  const firstName = name.split(" ")[0] || name;

  return (
    <div className="mx-4 mb-6 rounded-xl border border-slate-700/40 bg-slate-800/60 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-amber-500">
        <Handshake className="h-4 w-4" aria-hidden="true" />
        Common ground
      </div>

      <p className="mt-2 text-sm text-slate-300">
        You and {firstName} have both taken a position on {data.shared} record
        {data.shared === 1 ? "" : "s"}. You agree on {data.agreed} and disagree on{" "}
        {data.disagreed}.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
            You agree
          </p>
          {data.agreements.length === 0 ? (
            <p className="mt-1 text-sm text-slate-500">Nothing yet.</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {data.agreements.map((entry) => (
                <li key={entry.reference.id} className="text-sm">
                  <Link
                    to={`/reference/${entry.reference.id}`}
                    className="text-slate-200 hover:underline"
                  >
                    {entry.reference.title}
                  </Link>
                  <span className="text-slate-500">
                    {" — both "}
                    {entry.yourPosition === "support" ? "backed it" : "opposed it"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-rose-400">
            You disagree
          </p>
          {data.disagreements.length === 0 ? (
            <p className="mt-1 text-sm text-slate-500">Nothing yet.</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {data.disagreements.map((entry) => (
                <li key={entry.reference.id} className="text-sm">
                  <Link
                    to={`/reference/${entry.reference.id}`}
                    className="text-slate-200 hover:underline"
                  >
                    {entry.reference.title}
                  </Link>
                  <span className="text-slate-500">
                    {" — you "}
                    {entry.yourPosition === "support" ? "backed it" : "opposed it"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
