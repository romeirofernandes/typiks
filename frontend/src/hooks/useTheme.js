import { useEffect, useState } from "react";
// react-doctor-disable-next-line no-flush-sync -- required by document.startViewTransition: React docs mandate flushSync inside the transition callback so the theme class is committed before the cross-fade snapshot is taken
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
