import { Link } from "react-router-dom";
import { Layout } from "@/components/layout/Layout";
import { Seal } from "@/components/civic/Seal";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <Layout>
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-28 text-center sm:px-6">
        <Seal className="h-14 w-14 text-muted-foreground" />
        <h1 className="mt-6 font-display text-5xl font-semibold text-foreground">
          404
        </h1>
        <p className="mt-3 text-muted-foreground">
          This page has drifted outside the record. Let's get you back to the
          Public Pulse.
        </p>
        <div className="mt-6 flex gap-3">
          <Button asChild>
            <Link to="/feed">Return home</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/explore">Explore</Link>
          </Button>
        </div>
      </div>
    </Layout>
  );
}
