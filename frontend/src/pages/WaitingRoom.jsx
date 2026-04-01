import React from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DotLoader } from "@/components/ui/dot-loader";
import { FiArrowRight, FiZap } from "react-icons/fi";

const WaitingRoom = () => {
  const navigate = useNavigate();

  return (
    <div className="flex h-full min-h-[60vh] items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-md"
      >
        <Card className="overflow-hidden border-border/50 bg-card/80 backdrop-blur-sm">
          <CardHeader className="pb-6 text-center">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
              className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/20"
            >
              <FiZap className="h-8 w-8 text-primary" />
            </motion.div>
            <CardTitle className="font-sans text-xl">Preparing Your Match</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Setting up the arena...
            </p>
          </CardHeader>
          <CardContent className="space-y-6 py-8 text-center">
            {/* Animated Loader */}
            <div className="flex items-center justify-center gap-4">
              <DotLoader 
                duration={100}
                className="scale-150"
                dotClassName="bg-muted-foreground/30 [&.active]:bg-primary"
              />
            </div>

            {/* Status Messages */}
            <div className="space-y-2">
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground"
              >
                Entering Room
              </motion.p>
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: "100%" }}
                transition={{ duration: 2, ease: "easeInOut" }}
                className="mx-auto h-1 max-w-[200px] rounded-full bg-primary/30"
              >
                <motion.div
                  initial={{ width: "0%" }}
                  animate={{ width: "100%" }}
                  transition={{ duration: 2, ease: "easeInOut" }}
                  className="h-full rounded-full bg-primary"
                />
              </motion.div>
            </div>

            {/* Action Button */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.8 }}
            >
              <Button
                className="w-full gap-2"
                onClick={() => navigate("/game", { state: { fromDashboard: true } })}
              >
                Enter Game
                <FiArrowRight className="h-4 w-4" />
              </Button>
            </motion.div>
          </CardContent>
        </Card>

        {/* Background decoration */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.5 }}
          transition={{ delay: 1 }}
          className="absolute inset-0 -z-10 overflow-hidden"
        >
          <div className="absolute -left-1/4 -top-1/4 h-1/2 w-1/2 rounded-full bg-primary/5 blur-3xl" />
          <div className="absolute -bottom-1/4 -right-1/4 h-1/2 w-1/2 rounded-full bg-chart-3/5 blur-3xl" />
        </motion.div>
      </motion.div>
    </div>
  );
};

export default WaitingRoom;
