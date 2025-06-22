import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";

const WaitingRoom = () => {
  const navigate = useNavigate();

  useEffect(() => {
    // Redirect to game page immediately
    navigate("/game", { replace: true });
  }, [navigate]);

  return null; 
};

export default WaitingRoom;
