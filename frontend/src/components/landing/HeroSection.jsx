import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Keyboard } from "@/components/ui/keyboard";
import { useAuth } from "@/context/AuthContext";

export default function HeroSection() {
  const { currentUser } = useAuth();
  const scrollToTestimonials = (e) => {
    e?.preventDefault?.();
    const el = document.getElementById("testimonials");
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <section className="min-h-screen flex items-center justify-center pt-32 pb-8 px-4 [font-family:var(--font-sans)] normal-case overflow-hidden">
      <div className="w-full mx-auto text-center flex flex-col items-center gap-8 sm:gap-10 md:gap-4">
        <div className="space-y-3 sm:space-y-5">
          <h1 className="text-5xl sm:text-6xl md:text-7xl font-bold tracking-tighter text-foreground leading-[1.05]">
            Type Fast. Win Loud.
          </h1>
          <p className="text-sm sm:text-lg md:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Join a room, race the clock,
            and climb the leaderboard.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-3 md:pt-3 pb-3">
          <Button asChild variant="default" size="lg" className="w-full sm:w-auto">
            <Link to={currentUser ? "/dashboard" : "/signup"}>Play Now</Link>
          </Button>
          <Button
            variant="secondary"
            size="lg"
            className="w-full sm:w-auto"
            onClick={scrollToTestimonials}>
            See what others have to say
          </Button>
        </div>

        <div className="w-full overflow-visible pt-1 sm:pt-2">
            <Keyboard size="lg" theme="typiks" enableSound={true} enableHaptics={true} disableNativeBehavior={false} />
        </div>
      </div>
    </section>
  );
}
