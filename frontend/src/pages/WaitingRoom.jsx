import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FiArrowLeft, FiUsers, FiClock } from "react-icons/fi";

const WaitingRoom = () => {
  const navigate = useNavigate();
  const [waitingTime, setWaitingTime] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setWaitingTime((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex items-center justify-between mb-8"
        >
          <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
            <Button
              variant="outline"
              onClick={() => navigate("/dashboard")}
              className="gap-2"
            >
              <FiArrowLeft className="w-4 h-4" />
              Cancel
            </Button>
          </motion.div>
        </motion.div>

        {/* Waiting Animation */}
        <div className="flex items-center justify-center min-h-[60vh]">
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
            className="text-center"
          >
            <Card className="w-96">
              <CardHeader>
                <CardTitle className="text-center">Finding Opponent</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Animated Dots */}
                <div className="flex justify-center space-x-2">
                  {[...Array(3)].map((_, i) => (
                    <motion.div
                      key={i}
                      className="w-4 h-4 bg-primary rounded-full"
                      animate={{
                        scale: [1, 1.2, 1],
                        opacity: [0.5, 1, 0.5],
                      }}
                      transition={{
                        duration: 1.5,
                        repeat: Infinity,
                        delay: i * 0.2,
                      }}
                    />
                  ))}
                </div>

                {/* Stats */}
                <div className="space-y-4">
                  <div className="flex items-center justify-center gap-2 text-muted-foreground">
                    <FiUsers className="w-4 h-4" />
                    <span>Looking for players...</span>
                  </div>

                  <div className="flex items-center justify-center gap-2 text-muted-foreground">
                    <FiClock className="w-4 h-4" />
                    <span>Waiting time: {formatTime(waitingTime)}</span>
                  </div>
                </div>

                {/* Pulse Animation */}
                <motion.div
                  className="w-32 h-32 mx-auto rounded-full border-4 border-primary/20"
                  animate={{
                    scale: [1, 1.1, 1],
                    borderColor: [
                      "hsl(var(--primary) / 0.2)",
                      "hsl(var(--primary) / 0.8)",
                      "hsl(var(--primary) / 0.2)",
                    ],
                  }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                  }}
                >
                  <div className="w-full h-full flex items-center justify-center">
                    <FiUsers className="w-12 h-12 text-primary" />
                  </div>
                </motion.div>

                <p className="text-sm text-muted-foreground">
                  We're matching you with a player of similar skill level...
                </p>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default WaitingRoom;
