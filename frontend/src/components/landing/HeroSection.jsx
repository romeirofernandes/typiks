import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Keyboard } from "@/components/ui/keyboard";

export default function HeroSection() {
  const scrollToTestimonials = (e) => {
    e?.preventDefault?.();
    const el = document.getElementById("testimonials");
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <section className="h-[100vh] flex items-center justify-center pt-32 sm:pt-20 pb-10 px-4 [font-family:var(--font-sans)] normal-case overflow-x-hidden">
      <div className="w-full max-w-5xl mx-auto text-center flex flex-col items-center gap-7 sm:gap-8">
        <div className="space-y-4 sm:space-y-8">
          <h1 className="text-4xl sm:text-5xl md:text-8xl font-bold tracking-tighter text-foreground leading-[1.05]">
            Type Fast. Win Loud.
          </h1>
          <p className="text-base sm:text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Real-time typing battles with friends. Join a room, race the clock,
            and climb the leaderboard.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4">
          <Button asChild variant="default" size="lg" className="w-full sm:w-auto">
            <Link to="/signup">Play Now</Link>
          </Button>
          <Button
            variant="secondary"
            size="lg"
            className="w-full sm:w-auto"
            onClick={scrollToTestimonials}>
            See what others have to say
          </Button>
        </div>

        <div className="w-full overflow-visible pt-2 sm:pt-5">
            <Keyboard size="lg" theme="typiks" enableSound={true} enableHaptics={true} disableNativeBehavior={false} />
        </div>
      </div>
    </section>
  );
}
