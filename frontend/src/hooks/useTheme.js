import { useEffect, useState } from "react";
import { flushSync } from "react-dom";

export function useTheme() {
  const [theme, setTheme] = useState(
    () => localStorage.getItem("theme") || "light"
  );

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    localStorage.setItem("theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    const switchTheme = () => {
      flushSync(() => {
        setTheme((prevTheme) => (prevTheme === "light" ? "dark" : "light"));
      });
    };

    if (!document.startViewTransition) {
      switchTheme();
      return;
    }

    document.startViewTransition(switchTheme);
  };

  return { theme, setTheme, toggleTheme };
}
