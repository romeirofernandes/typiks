import { Button } from "@/components/ui/button";

import { Card } from "@/components/ui/card";
import { GlobeIcon, SparklesIcon, Target01Icon } from "hugeicons-react";

export default function FeaturesSection() {
  return (
    <section
      id="features"
      className="py-24 px-4 scroll-mt-28 [font-family:var(--font-sans)] normal-case">
      <div className="mx-auto w-full max-w-5xl">
        <div>
          <h2 className="text-foreground max-w-2xl text-balance text-4xl font-semibold tracking-tight">
            Built for fast, friendly competition
          </h2>
          <p className="text-muted-foreground mt-4 max-w-2xl text-balance text-base sm:text-lg">
            Create a room, invite your friends, and race in real time.
          </p>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Card className="overflow-hidden p-6 shadow-none bg-card/60 border-border/70 gap-0">
            <Target01Icon className="text-primary size-5" />
            <h3 className="text-foreground mt-5 text-lg font-semibold">
              Rooms in seconds
            </h3>
            <p className="text-muted-foreground mt-3 text-balance text-sm leading-relaxed">
              Start a private room and share one link. No setup, no friction — just
              jump in and go.
            </p>
            <RoomIllustration />
          </Card>

          <Card className="group overflow-hidden p-6 shadow-none bg-card/60 border-border/70 gap-0">
            <SparklesIcon className="text-primary size-5" />
            <h3 className="text-foreground mt-5 text-lg font-semibold">
              Real-time races
            </h3>
            <p className="text-muted-foreground mt-3 text-balance text-sm leading-relaxed">
              See the race unfold live. Every keypress feels responsive — so you
              can focus on speed and accuracy.
            </p>
            <RaceIllustration />
          </Card>

          <Card className="group overflow-hidden p-6 shadow-none bg-card/60 border-border/70 gap-0">
            <GlobeIcon className="text-primary size-5" />
            <h3 className="text-foreground mt-5 text-lg font-semibold">
              Progress that sticks
            </h3>
            <p className="text-muted-foreground mt-3 text-balance text-sm leading-relaxed">
              Track your best rounds and climb the board. It’s competitive — but
              always friendly.
            </p>
            <LeaderboardIllustration />
          </Card>
        </div>
      </div>
    </section>
  );
}

function RoomIllustration() {
  return (
    <div aria-hidden className="mt-8">
      <div className="rounded-xl border border-border/70 bg-background/60 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-medium text-muted-foreground">
              Room code
            </div>
            <div className="mt-1 font-semibold tracking-wider">TYPK-482</div>
          </div>
          <Button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            size="sm"
            variant="secondary"
            className="h-8 px-3">
            Copy invite
          </Button>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div className="flex -space-x-2">
            <AvatarBubble label="A" />
            <AvatarBubble label="R" />
            <AvatarBubble label="M" />
            <div className="bg-muted text-muted-foreground size-8 rounded-full border border-border/70 grid place-items-center text-[11px] font-semibold">
              +2
            </div>
          </div>

          <div className="inline-flex items-center rounded-full border border-border/70 bg-card px-2 py-1 text-[11px] font-medium text-muted-foreground">
            Private
          </div>
        </div>
      </div>
    </div>
  );
}

function RaceIllustration() {
  return (
    <div aria-hidden className="mt-8">
      <div className="rounded-xl border border-border/70 bg-background/60 p-4">
        <div className="flex items-center justify-between">
          <div className="inline-flex items-center gap-2">
            <span className="size-2 rounded-full bg-primary" />
            <span className="text-xs font-medium text-muted-foreground">Live</span>
          </div>
          <div className="text-xs font-semibold tabular-nums">00:18</div>
        </div>

        <div className="mt-4 space-y-3">
          <ProgressRow name="You" value={0.74} emphasized />
          <ProgressRow name="Riya" value={0.61} />
          <ProgressRow name="Sam" value={0.56} />
        </div>

        <div className="mt-4 rounded-lg border border-border/70 bg-card px-3 py-2 text-xs">
          <span className="text-muted-foreground">Next:</span>{" "}
          <span className="font-medium text-foreground">space → enter</span>
        </div>
      </div>
    </div>
  );
}

function LeaderboardIllustration() {
  return (
    <div aria-hidden className="mt-8">
      <div className="rounded-xl border border-border/70 bg-background/60 p-4">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium text-muted-foreground">
            Today’s top
          </div>
          <div className="text-xs font-semibold tabular-nums">WPM</div>
        </div>

        <div className="mt-4 space-y-2">
          <LeaderboardRow rank={1} name="You" wpm={104} highlighted />
          <LeaderboardRow rank={2} name="Ayaan" wpm={97} />
          <LeaderboardRow rank={3} name="Mina" wpm={92} />
        </div>

        <div className="mt-4 flex items-center justify-between rounded-lg border border-border/70 bg-card px-3 py-2 text-xs">
          <span className="text-muted-foreground">Best streak</span>
          <span className="font-semibold tabular-nums">6 wins</span>
        </div>
      </div>
    </div>
  );
}

function AvatarBubble({ label }) {
  return (
    <div className="bg-card text-foreground size-8 rounded-full border border-border/70 grid place-items-center text-[12px] font-semibold">
      {label}
    </div>
  );
}

function ProgressRow({ name, value, emphasized = false }) {
  const percent = Math.max(0, Math.min(1, value));
  return (
    <div className="grid grid-cols-[auto,1fr,auto] items-center gap-3">
      <div
        className={
          emphasized
            ? "text-xs font-semibold text-foreground"
            : "text-xs font-medium text-muted-foreground"
        }>
        {name}
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={
            emphasized ? "h-full bg-primary" : "h-full bg-foreground/20"
          }
          style={{ width: `${Math.round(percent * 100)}%` }}
        />
      </div>
      <div className="text-xs font-semibold tabular-nums">
        {Math.round(percent * 100)}%
      </div>
    </div>
  );
}

function LeaderboardRow({ rank, name, wpm, highlighted = false }) {
  return (
    <div
      className={
        highlighted
          ? "flex items-center justify-between rounded-lg border border-border/70 bg-primary/10 px-3 py-2"
          : "flex items-center justify-between rounded-lg border border-border/70 bg-card px-3 py-2"
      }>
      <div className="flex items-center gap-3">
        <div
          className={
            highlighted
              ? "text-xs font-semibold text-primary tabular-nums"
              : "text-xs font-semibold text-muted-foreground tabular-nums"
          }>
          #{rank}
        </div>
        <div className="text-xs font-medium text-foreground">{name}</div>
      </div>
      <div className="text-xs font-semibold tabular-nums">{wpm}</div>
    </div>
  );
}
