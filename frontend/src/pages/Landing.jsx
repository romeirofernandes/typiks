import React from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

const Landing = () => {
  const navigate = useNavigate();

  return (
    <div className="relative min-h-screen flex flex-col">
      <div className="absolute inset-0 -z-50 h-full w-full bg-white [background:radial-gradient(125%_125%_at_50%_10%,#f8fafc_40%,#22c55e_100%)] dark:[background:radial-gradient(125%_125%_at_50%_10%,#1e293b_40%,#16a34a_100%)]"></div>

      <div className="relative mx-auto flex w-full sm:max-w-3xl flex-col items-center justify-center flex-1 px-6 sm:px-6">
        <div className="w-full flex flex-col justify-center items-center space-y-4 sm:space-y-4">
          {/* Hero Title */}
          <h1 className="relative z-10 text-center text-3xl sm:text-4xl font-medium text-foreground md:text-5xl lg:text-6xl leading-tight">
            {"matiks is".split(" ").map((word, index) => (
              <motion.span
                key={index}
                initial={{ opacity: 0, filter: "blur(4px)", y: 10 }}
                animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
                transition={{
                  duration: 0.3,
                  delay: index * 0.1,
                  ease: "easeInOut",
                }}
                className="mr-2 sm:mr-3 inline-block"
              >
                {word}
              </motion.span>
            ))}{" "}
            <motion.span
              initial={{ opacity: 0, filter: "blur(4px)", y: 10 }}
              animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
              transition={{
                duration: 0.3,
                delay: 0.2,
                ease: "easeInOut",
              }}
              className="italic inline-block"
            >
              baniyagiri.
            </motion.span>
          </h1>

          {/* CTA Button */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, delay: 0.8 }}
            className="relative z-10 pb-3 sm:pb-5"
          >
            <Button
              onClick={() => navigate("/signup")}
              className="w-48 sm:w-60 transform bg-primary text-primary-foreground hover:bg-primary/90 px-6 sm:px-8 py-3 sm:py-4 text-base sm:text-lg font-medium transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg"
            >
              Start Typing
            </Button>
          </motion.div>

          {/* Demo Video Container */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 1 }}
            className="relative z-10 w-full rounded-2xl sm:rounded-3xl border border-border bg-card p-3 sm:p-4 shadow-lg"
          >
            <div className="w-full overflow-hidden rounded-xl border border-border bg-muted/50">
              {/* Placeholder for demo video */}
              <div className="aspect-[5/4] sm:aspect-[18/9] h-auto w-full sm:w-3xl flex items-center justify-center bg-muted text-muted-foreground">
                <div className="text-center">
                  <div className="text-3xl sm:text-4xl mb-2">🎮</div>
                  <p className="text-base sm:text-lg font-medium">Demo Video</p>
                  <p className="text-xs sm:text-sm">Coming Soon</p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Footer */}
      <Footer />
    </div>
  );
};

const Footer = () => {
  return (
    <footer className="relative">
      {/* Gradient line divider */}
      <div className="h-px max-w-3xl mx-auto bg-gradient-to-r from-transparent via-foreground/30 to-transparent"></div>

      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-4 sm:py-6">
        <div className="flex flex-row px-4 items-center justify-between gap-2 sm:gap-0 text-xs sm:text-sm">
          <span className="text-foreground">star the repo bitches.</span>
          <a
            href="https://github.com/romeirofernandes/typiks"
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground hover:text-foreground/80 transition-colors"
          >
            repo.
          </a>
        </div>
      </div>
    </footer>
  );
};

export default Landing;
