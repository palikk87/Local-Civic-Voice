import { Link } from "react-router-dom";
import { Seal } from "@/components/civic/Seal";

export function Footer() {
  return (
    <footer className="border-t border-border/70 bg-primary text-primary-foreground">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid gap-8 md:grid-cols-[1.5fr_1fr_1fr]">
          <div>
            <Link to="/feed" className="flex items-center gap-2.5">
              <Seal className="h-8 w-8 text-accent" />
              <span className="font-display text-xl font-semibold">AYE & NAY</span>
            </Link>
            <p className="mt-3 max-w-sm text-sm text-primary-foreground/70">
              A high-trust civic platform where citizens engage with all three
              branches of government. Your voice, verified and transparent.
            </p>
          </div>

          <div>
            <h4 className="font-display text-sm font-semibold uppercase tracking-institutional text-accent">
              Engage
            </h4>
            <ul className="mt-4 space-y-2 text-sm text-primary-foreground/80">
              <li>
                <Link to="/explore" className="hover:text-primary-foreground">
                  Explore legislation
                </Link>
              </li>
              <li>
                <Link to="/explore?branch=bill" className="hover:text-primary-foreground">
                  Legislative bills
                </Link>
              </li>
              <li>
                <Link to="/explore?branch=executive_order" className="hover:text-primary-foreground">
                  Executive orders
                </Link>
              </li>
              <li>
                <Link to="/explore?branch=scotus_case" className="hover:text-primary-foreground">
                  Supreme Court cases
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-display text-sm font-semibold uppercase tracking-institutional text-accent">
              Principles
            </h4>
            <ul className="mt-4 space-y-2 text-sm text-primary-foreground/80">
              <li>
                <Link to="/documents" className="hover:text-primary-foreground">
                  The Constitution
                </Link>
              </li>
              <li>
                <Link to="/documents#bill-of-rights" className="hover:text-primary-foreground">
                  Bill of Rights
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-2 border-t border-primary-foreground/15 pt-6 text-xs text-primary-foreground/60 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} AYE & NAY. The Will of the People is the supreme authority.</p>
          <p>Votes shown are simulated for civic engagement.</p>
        </div>
      </div>
    </footer>
  );
}
