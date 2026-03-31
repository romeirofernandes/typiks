import Navbar from "@/components/landing/Navbar";
import BackgroundGrid from "@/components/landing/BackgroundGrid";
import HeroSection from "@/components/landing/HeroSection";
import DemoVideoSection from "@/components/landing/DemoVideoSection";
import FeaturesSection from "@/components/landing/FeaturesSection";
import TestimonialsMarqueeSection from "@/components/landing/TestimonialsMarqueeSection";
import Footer from "@/components/landing/Footer";

export default function NewLanding() {
  return (
    <BackgroundGrid>
      <div className="flex flex-col min-h-screen font-mono text-foreground lowercase overflow-x-hidden">
        <Navbar />
        <main className="flex-1 z-10">
          <HeroSection />
          <DemoVideoSection />
          <FeaturesSection />
          <TestimonialsMarqueeSection />
        </main>
        <Footer />
      </div>
    </BackgroundGrid>
  );
}
