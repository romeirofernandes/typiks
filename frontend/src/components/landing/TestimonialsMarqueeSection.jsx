const TESTIMONIALS = [
  {
    name: "Riya",
    tagline: "Ranked matches",
    quote: "The live progress feels insanely responsive.",
  },
  {
    name: "Ayaan",
    tagline: "Friends rooms",
    quote: "Setting up a room takes seconds. Perfect for quick battles.",
  },
  {
    name: "Mina",
    tagline: "Leaderboard grind",
    quote: "The leaderboard makes every round feel worth it.",
  },
  {
    name: "Sam",
    tagline: "Night sessions",
    quote: "Dark mode + the keyboard sounds are a vibe.",
  },
  {
    name: "Zoe",
    tagline: "Warmups",
    quote: "I can jump in, race, and be done in two minutes.",
  },
];

export default function TestimonialsMarqueeSection() {
  return (
    <section
      id="testimonials"
      className="py-24 px-4 pb-24 scroll-mt-28 [font-family:var(--font-sans)] normal-case">
      <div className="w-full max-w-5xl mx-auto">
        <div className="text-left">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground [font-family:var(--font-sans)]">
            What players say
          </h2>
        </div>

        <div className="mt-8 relative overflow-hidden border-y border-border/70 group">
          {/* subtle curved fades */}
          <div className="pointer-events-none absolute inset-y-0 left-0 w-14 sm:w-20 bg-gradient-to-r from-background via-background/80 to-transparent opacity-80 rounded-r-3xl blur-xl z-10" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-14 sm:w-20 bg-gradient-to-l from-background via-background/80 to-transparent opacity-80 rounded-l-3xl blur-xl z-10" />

          <div className="py-4">
            <div className="flex gap-4 min-w-max will-change-transform animate-[typiks-marquee_34s_linear_infinite] motion-reduce:animate-none group-hover:[animation-play-state:paused]">
              {[...TESTIMONIALS, ...TESTIMONIALS].map((t, idx) => (
                <article
                  key={`${t.name}-${idx}`}
                  className="w-[320px] shrink-0 border border-border/70 bg-card/40 backdrop-blur supports-[backdrop-filter]:bg-card/25 shadow-sm"
                >
                  <div className="p-5">
                    <p className="text-sm text-foreground/90">“{t.quote}”</p>
                    <div className="mt-4">
                      <div className="text-xs font-semibold text-foreground">
                        {t.name}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {t.tagline}
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
