import { cn } from "@/lib/utils";

/**
 * The AYE & NAY mark — three interlocking arcs for the three branches of
 * government surrounding a central node (the citizen).
 */
export function Seal({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      className={cn("h-8 w-8", className)}
      aria-hidden="true"
    >
      <circle cx="24" cy="24" r="22" stroke="currentColor" strokeWidth="1.5" opacity="0.35" />
      <path
        d="M24 6a18 18 0 0 1 15.6 9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M39.6 33A18 18 0 0 1 8.4 33"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.7"
      />
      <path
        d="M8.4 15A18 18 0 0 1 24 6"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.5"
      />
      <circle cx="24" cy="24" r="5" fill="currentColor" />
    </svg>
  );
}
