import React from "react";
import { motion } from "framer-motion";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useNavigate } from "react-router-dom";

const WaitingRoom = () => {
  const navigate = useNavigate();

  return (
    <div className="flex h-full items-center justify-center">
      <Card className="w-full max-w-md border-border/70 bg-card/40">
        <CardHeader>
          <CardTitle>Preparing your match...</CardTitle>
        </CardHeader>
        <CardContent className="text-center">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
            className="mx-auto mb-4 h-8 w-8 rounded-full border-2 border-primary border-t-transparent"
          />
          <p className="text-sm text-muted-foreground">Entering the room</p>

          <Button
            className="mt-5 w-full"
            onClick={() => navigate("/game", { state: { fromDashboard: true } })}
          >
            Open Game
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default WaitingRoom;
