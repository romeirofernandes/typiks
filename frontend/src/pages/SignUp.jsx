import React, { useState, useEffect } from "react";
import { SignUpForm } from "@/components/signup-form";
import { useNavigate } from "react-router-dom";
import { ArrowLeft01Icon, Moon02Icon, Sun03Icon } from "hugeicons-react";
import { Button } from "@/components/ui/button";
import { flushSync } from "react-dom";
import BackgroundGrid from "@/components/landing/BackgroundGrid";

const SignUp = () => {
  const navigate = useNavigate();
  const [theme, setTheme] = useState(
    () => localStorage.getItem("theme") || "light"
  );

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
        setTheme((prevTheme) => {
          const newTheme = prevTheme === "light" ? "dark" : "light";
          if (newTheme === "dark") {
            document.documentElement.classList.add("dark");
          } else {
            document.documentElement.classList.remove("dark");
          }
          localStorage.setItem("theme", newTheme);
          return newTheme;
        });
      });
    };

    if (!document.startViewTransition) {
      switchTheme();
      return;
    }

    document.startViewTransition(switchTheme);
  };

  return (
    <BackgroundGrid>
      <div className="relative text-foreground">
        <div className="absolute top-0 left-0 right-0 p-6 flex justify-between items-center z-10 w-full max-w-7xl mx-auto">
        <Button
          onClick={() => navigate("/")}
          variant="secondary"
          aria-label="Go back"
        >
          <ArrowLeft01Icon size={18} />
        </Button>
        <Button
          onClick={toggleTheme}
          aria-label="toggle theme"
          variant="default"
        >
          {theme === "light" ? (
            <Moon02Icon size={18} />
          ) : (
            <Sun03Icon size={18} />
          )}
        </Button>
      </div>
      <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10 pt-20">
        <div className="w-full max-w-sm">
          <SignUpForm />
        </div>
    </div>
    </div>
    </BackgroundGrid>
  );
};

export default SignUp;
