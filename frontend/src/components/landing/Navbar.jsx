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

  return (
    <header className="fixed top-6 left-0 right-0 z-50 flex justify-center px-4 w-full">
      {/* Outer border wrapper */}
      <div className="w-full max-w-5xl shadow-sm border border-border bg-card">
        {/* Inner background wrapper */}
        <nav className="w-full flex items-center justify-between px-6 py-3">
          {/* Left: Brand */}
          <div className="font-bold text-xl tracking-tight text-foreground lowercase uppercase-none font-sans">
            <Link to="/">typiks</Link>
          </div>

          {/* Middle: Links */}
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-muted-foreground lowercase">
            <Link to="#features" className="hover:text-foreground transition-colors">
              features
            </Link>
            <Link to="#testimonials" className="hover:text-foreground transition-colors">
              testimonials
            </Link>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-4">
            {/* Theme Toggle Button */}
            <button
              onClick={toggleTheme}
              aria-label="toggle theme"
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
              className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center justify-center px-5 py-2 text-sm font-semibold lowercase transition-colors"
            >
              sign up
            </Link>
          </div>
        </nav>
      </div>
    </header>
  );
}
