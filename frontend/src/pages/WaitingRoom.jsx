import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";

import BackgroundGrid from "@/components/landing/BackgroundGrid";
import { ThemeToggleButton } from "@/components/theme-toggle-button";
import { Button } from "@/components/ui/button";
import { ArrowLeft01Icon } from "hugeicons-react";

const WaitingRoom = () => {
  const navigate = useNavigate();

  useEffect(() => {
    // Redirect to game page immediately
    navigate("/game", { replace: true });
  }, [navigate]);

  return (
    <BackgroundGrid>
      <div className="relative text-foreground min-h-svh font-mono">
        <div className="absolute top-0 left-0 right-0 p-6 flex justify-between items-center z-10 w-full max-w-7xl mx-auto">
          <Button
            onClick={() => navigate("/dashboard")}
            variant="secondary"
            aria-label="Back to dashboard"
          >
            <ArrowLeft01Icon size={18} />
          </Button>

          <ThemeToggleButton variant="secondary" />
        </div>

        <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10 pt-20">
          <div className="w-full max-w-sm text-center">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
              className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4"
            />
            <div className="text-base font-semibold">Preparing your match…</div>
            <div className="mt-1 text-sm text-muted-foreground">
              Entering the room
            </div>
          </div>
        </div>
      </div>
    </BackgroundGrid>
  );
};

export default WaitingRoom;
