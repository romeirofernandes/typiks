import React from "react";
import { m, useReducedMotion } from "framer-motion";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DotLoader } from "@/components/ui/dot-loader";
import { FiArrowRight, FiZap } from "react-icons/fi";

const WaitingRoom = () => {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();

  return (
    <div className="flex h-full min-h-[60vh] items-center justify-center p-4">
      <div className="w-full max-w-md">
        <m.div
          initial={{ opacity: 0, y: reduceMotion ? 0 : -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
        >
          <Card className="overflow-hidden border-border/50 bg-card/80 backdrop-blur-sm">
            <CardHeader className="pb-6 text-center">
              <m.div
                initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: 0.06 }}
                className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/20"
              >
                <FiZap className="h-8 w-8 text-primary" />
              </m.div>
              <m.div
                initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: 0.1 }}
              >
                <CardTitle className="font-sans text-xl">Preparing Your Match</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  Setting up the arena...
                </p>
              </m.div>
            </CardHeader>
            <CardContent className="space-y-6 py-8 text-center">
              {/* Animated Loader */}
              <m.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.25, delay: 0.16 }}
                className="flex items-center justify-center gap-4"
              >
                <DotLoader 
                  duration={100}
                  className="scale-150"
                  dotClassName="bg-muted-foreground/30 [&.active]:bg-primary"
                />
              </m.div>

              {/* Status Messages */}
              <m.div
                initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: 0.22 }}
                className="space-y-2"
              >
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Entering Room
                </p>
                <div className="mx-auto h-1 max-w-[200px] rounded-full bg-primary/30">
                  <m.div
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 2, ease: "easeInOut" }}
                    className="h-full w-full origin-left rounded-full bg-primary"
                  />
                </div>
              </m.div>

              {/* Action Button */}
              <m.div
                initial={{ opacity: 0, y: reduceMotion ? 0 : 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.3 }}
              >
                <Button
                  className="w-full gap-2"
                  onClick={() => navigate("/game", { state: { fromDashboard: true } })}
                >
                  Enter Game
                  <FiArrowRight className="h-4 w-4" />
                </Button>
              </m.div>
            </CardContent>
          </Card>
        </m.div>

        {/* Background decoration */}
        <m.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.5 }}
          transition={{ delay: 0.4 }}
          className="absolute inset-0 -z-10 overflow-hidden"
        >
          <div className="absolute -left-1/4 -top-1/4 h-1/2 w-1/2 rounded-full bg-primary/5 blur-3xl" />
          <div className="absolute -bottom-1/4 -right-1/4 h-1/2 w-1/2 rounded-full bg-chart-3/5 blur-3xl" />
        </m.div>
      </div>
    </div>
  );
};

export default WaitingRoom;
