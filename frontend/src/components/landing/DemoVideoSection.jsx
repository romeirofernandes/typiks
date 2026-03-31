export default function DemoVideoSection() {
  return (
    <section
      id="demo"
      className="py-24 px-4 pb-24 scroll-mt-28 [font-family:var(--font-sans)] normal-case">
      <div className="w-full max-w-5xl mx-auto">
        <div className="text-left">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground [font-family:var(--font-sans)]">
            Watch the demo
          </h2>
          <p className="mt-3 text-sm sm:text-base text-muted-foreground max-w-2xl">
            A quick look at a real-time match, start to finish.
          </p>
        </div>

        {/* glass video placeholder */}
        <div className="mt-8 rounded-2xl p-2 border border-border/60 bg-card/40 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/30">
          <div className="rounded-xl border border-border/50 bg-background/10 aspect-video w-full overflow-hidden flex items-center justify-center">
            <div className="text-center px-6">
              <p className="text-sm text-muted-foreground">Demo video placeholder.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Drop your embed here.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
