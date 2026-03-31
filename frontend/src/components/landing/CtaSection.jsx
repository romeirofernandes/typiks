import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export default function CtaSection() {
  return (
    <section className="py-24 px-4 pb-24 scroll-mt-28 [font-family:var(--font-sans)] normal-case">
      <div className="w-full max-w-5xl mx-auto">
        <div className="border border-border/70 bg-card/40 backdrop-blur supports-[backdrop-filter]:bg-card/25 p-8 sm:p-10">
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground text-balance">
            Ready for your next race?
          </h2>
          <p className="mt-3 text-sm sm:text-base text-muted-foreground max-w-2xl text-pretty">
            Create an account, start a room, and run a fast match with friends.
          </p>

          <div className="mt-6">
            <Button asChild size="lg">
              <Link to="/signup">Create my account</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
