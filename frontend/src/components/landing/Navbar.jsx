import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { Link } from "react-router-dom";
import { Moon02Icon, Sun03Icon } from "hugeicons-react";

export default function Navbar() {
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
          return newTheme;
        });
      });
    };

    if (!document.startViewTransition) {
      switchTheme();
    } else {
      document.startViewTransition(switchTheme);
    }
  };

  const scrollToSection = (sectionId) => {
    const el = document.getElementById(sectionId);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <header className="fixed top-6 left-0 right-0 z-50 flex justify-center px-4 w-full">
      {/* Outer border wrapper */}
      <div className="w-full max-w-5xl shadow-sm border border-border bg-card">
        {/* Inner background wrapper */}
        <nav className="w-full flex items-center justify-between px-6 py-3">
          {/* Left: Brand */}
          <div className="text-xl tracking-tight text-foreground font-sans">
            <Link to="/">typiks</Link>
          </div>

          {/* Middle: Links */}
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-muted-foreground">
            <button
              type="button"
              onClick={() => scrollToSection("demo")}
              className="hover:text-foreground transition-colors">
              Demo
            </button>
            <button
              type="button"
              onClick={() => scrollToSection("features")}
              className="hover:text-foreground transition-colors">
              Features
            </button>
            <button
              type="button"
              onClick={() => scrollToSection("testimonials")}
              className="hover:text-foreground transition-colors">
              Testimonials
            </button>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-4">
            {/* Theme Toggle Button */}
            <button
              onClick={toggleTheme}
              aria-label="Toggle theme"
              className="bg-card hover:bg-muted text-foreground border border-border flex items-center justify-center p-2 transition-colors"
            >
              {theme === "light" ? (
                <Moon02Icon size={18} />
              ) : (
                <Sun03Icon size={18} />
              )}
            </button>

            {/* Sign Up Button */}
            <Link
              to="/signup"
              className="bg-primary text-primary-foreground hover:bg-primary/90 normal-case flex items-center justify-center px-5 py-2 text-sm transition-colors"
            >
              Sign Up
            </Link>
          </div>
        </nav>
      </div>
    </header>
  );
}
