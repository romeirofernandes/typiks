import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { Moon02Icon, Sun03Icon } from "hugeicons-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ThemeToggleButton({
  className,
  variant = "secondary",
  size = "icon",
  ...props
}) {
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "light");

  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
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

  return (
    <Button
      type="button"
      onClick={toggleTheme}
      aria-label="Toggle theme"
      variant={variant}
      size={size}
      className={cn("size-10", className)}
      {...props}
    >
      <span className="relative size-4">
        <Moon02Icon
          size={16}
          className={cn(
            "absolute inset-0 will-change-[opacity,transform,filter] transition-[opacity,transform,filter] duration-300",
            "[transition-timing-function:cubic-bezier(0.2,0,0,1)]",
            theme === "light"
              ? "opacity-100 scale-100 blur-0"
              : "opacity-0 scale-[0.25] blur-[4px]"
          )}
          aria-hidden={theme !== "light"}
        />
        <Sun03Icon
          size={16}
          className={cn(
            "absolute inset-0 will-change-[opacity,transform,filter] transition-[opacity,transform,filter] duration-300",
            "[transition-timing-function:cubic-bezier(0.2,0,0,1)]",
            theme === "dark"
              ? "opacity-100 scale-100 blur-0"
              : "opacity-0 scale-[0.25] blur-[4px]"
          )}
          aria-hidden={theme !== "dark"}
        />
      </span>
    </Button>
  );
}
