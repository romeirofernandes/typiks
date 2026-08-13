import { useEffect, useState } from "react";

export function useVisualViewportHeight() {
  const [height, setHeight] = useState(() =>
    typeof window !== "undefined"
      ? window.visualViewport?.height ?? window.innerHeight
      : undefined
  );

  useEffect(() => {
    if (!("visualViewport" in window)) return;

    const update = () => setHeight(window.visualViewport.height);
    update();
    window.visualViewport.addEventListener("resize", update);
    window.visualViewport.addEventListener("scroll", update);
    return () => {
      window.visualViewport.removeEventListener("resize", update);
      window.visualViewport.removeEventListener("scroll", update);
    };
  }, []);

  return height;
}
