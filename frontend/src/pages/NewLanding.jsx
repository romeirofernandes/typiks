import Navbar from "@/components/landing/Navbar";
import BackgroundGrid from "@/components/landing/BackgroundGrid";
import HeroSection from "@/components/landing/HeroSection";

export default function NewLanding() {
  return (
    <BackgroundGrid>
      <div className="flex flex-col min-h-screen font-mono text-foreground lowercase">
        <Navbar />
        <main className="flex-1 z-10">
          <HeroSection />
        </main>
      </div>
    </BackgroundGrid>
  );
}
