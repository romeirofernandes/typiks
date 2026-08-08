import { useEffect, useState } from "react";

export function useIsCoarsePointer() {
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(pointer: coarse)");
    const updatePointerType = () => {
      setIsCoarsePointer(mediaQuery.matches);
    };

    updatePointerType();
    mediaQuery.addEventListener("change", updatePointerType);
    return () => {
      mediaQuery.removeEventListener("change", updatePointerType);
    };
  }, []);

  return isCoarsePointer;
}
