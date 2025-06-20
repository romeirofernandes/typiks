import React from "react";
import { Button } from "@/components/ui/Button";
import { useNavigate } from "react-router-dom";

const Landing = () => {
  const navigate = useNavigate()

  const handleStartPlayingClick = ()=> {
    console.log("Need to add the player searching and game starting logic here")
  }
  return (
    <>
      <div className="max-w-5xl min-h-screen flex items-center justify-center mx-auto">
        <div className="flex flex-col justify-center items-center gap-7">
          <h1 className="text-4xl">Typiks.</h1>
          <Button variant="default" onClick={handleStartPlayingClick} className="px-8 py-6 rounded-lg text-lg font-medium">Start typing</Button>
        </div>
      </div>
    </>
  );
};

export default Landing;
