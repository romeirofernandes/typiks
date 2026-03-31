import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Keyboard } from "@/components/ui/keyboard";

export default function HeroSection() {
  return (
    <section className="h-[100vh] flex items-center justify-center pt-28 pb-10 px-4 [font-family:var(--font-sans)] normal-case">
      <div className="w-full max-w-5xl mx-auto text-center flex flex-col items-center">
        <h1 className="text-4xl sm:text-5xl md:text-7xl font-bold tracking-tighter text-foreground">
          Type Fast. Win Loud.
        </h1>
        <p className="mt-5 text-base sm:text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
          Real-time typing battles with friends. Join a room, race the clock, and
          climb the leaderboard.
        </p>

        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Button asChild variant="default" size="lg" className="w-full sm:w-auto">
            <Link to="/game">Play Now</Link>
          </Button>
          <Button asChild variant="secondary" size="lg" className="w-full sm:w-auto">
            <a href="#testimonials">See what others have to say</a>
          </Button>
        </div>

        <div className="mt-8 w-full overflow-x-auto">
          <div className="mx-auto w-fit origin-top scale-[0.72] sm:scale-[0.85] md:scale-100">
            <Keyboard theme="typiks" enableSound={true} enableHaptics={true} />
          </div>
        </div>
      </div>
    </section>
  );
}
