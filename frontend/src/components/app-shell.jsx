import { useMemo, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";

import BackgroundGrid from "@/components/landing/BackgroundGrid";
import { ThemeToggleButton } from "@/components/theme-toggle-button";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { auth } from "@/firebase";
import {
  ArrowLeft01Icon,
  GlobeIcon,
  PlayIcon,
  Menu01Icon,
  RankingIcon,
  UserIcon,
} from "hugeicons-react";

function SidebarNavButton({ icon, label, active, expanded, onClick }) {
  const Icon = icon;

  return (
    <div className={cn("group relative flex", !expanded && "justify-center")}>
      <Button
        type="button"
        variant={active ? "secondary" : "ghost"}
        onClick={onClick}
        aria-label={label}
        className={cn(
          "h-11 border border-transparent transition-colors",
          expanded ? "w-full justify-start px-3" : "size-11 justify-center",
          !active && "hover:border-border/70"
        )}
      >
        <Icon size={18} className="shrink-0" />
        {expanded ? <span className="ml-3 truncate">{label}</span> : null}
      </Button>

      {!expanded ? (
        <span className="pointer-events-none invisible absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground opacity-0 shadow-sm transition-all duration-200 group-hover:visible group-hover:opacity-100">
          {label}
        </span>
      ) : null}
    </div>
  );
}

export default function AppShell() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [expanded, setExpanded] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);

  const username =
    currentUser?.displayName || currentUser?.email?.split("@")[0] || "username";

  const navItems = useMemo(
    () => [
      {
        key: "dashboard",
        label: "Dashboard",
        icon: GlobeIcon,
        active: location.pathname === "/dashboard",
        onClick: () => navigate("/dashboard"),
      },
      {
        key: "start-game",
        label: "Start Game",
        icon: PlayIcon,
        active:
          location.pathname === "/start-game" ||
          location.pathname === "/game" ||
          location.pathname === "/game/waiting",
        onClick: () => navigate("/start-game"),
      },
      {
        key: "leaderboard",
        label: "Leaderboard",
        icon: RankingIcon,
        active: location.pathname === "/leaderboard",
        onClick: () => navigate("/leaderboard"),
      },
    ],
    [location.pathname, navigate]
  );

  const handleProfile = () => {
    navigate("/profile");
  };

  const handleSignOut = async () => {
    try {
      await auth.signOut();
      navigate("/");
    } catch (error) {
      console.error("Sign out error:", error);
    }
  };

  return (
    <BackgroundGrid>
      <div className="min-h-svh text-foreground font-mono antialiased">
        <div className="h-svh w-full p-3">
          <div className="flex h-full w-full flex-col gap-3 lg:flex-row">
            <aside
              className={cn(
                "relative z-30 hidden shrink-0 flex-col justify-between py-2 transition-[width] duration-300 lg:flex",
                expanded ? "w-60" : "w-[4.5rem]"
              )}
            >
              <div className="flex flex-col gap-3">
                <div className={cn("flex h-11 items-center", expanded ? "justify-between px-2" : "justify-center")}>
                  {expanded ? (
                    <span className="text-2xl font-sans font-semibold leading-none">typiks</span>
                  ) : null}

                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setExpanded((prev) => !prev)}
                    aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
                    className="size-11 border border-transparent hover:border-border/70"
                  >
                    <ArrowLeft01Icon
                      size={18}
                      className={cn("transition-transform duration-300", !expanded && "rotate-180")}
                    />
                  </Button>
                </div>

                <nav className="flex flex-col gap-2 px-2" aria-label="Sidebar actions">
                  {navItems.map((item) => (
                    <SidebarNavButton
                      key={item.key}
                      icon={item.icon}
                      label={item.label}
                      active={item.active}
                      expanded={expanded}
                      onClick={item.onClick}
                    />
                  ))}
                </nav>
              </div>

              <div className="flex flex-col gap-2 border-t border-border/80 px-2 pt-3">
                <div className={cn("group relative flex", !expanded && "justify-center")}>
                  <ThemeToggleButton
                    variant="secondary"
                    title="Toggle theme"
                    className={cn(expanded ? "h-11 w-full justify-center" : "size-11")}
                  />

                  {!expanded ? (
                    <span className="pointer-events-none invisible absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground opacity-0 shadow-sm transition-all duration-200 group-hover:visible group-hover:opacity-100">
                      Toggle theme
                    </span>
                  ) : null}
                </div>

                <SidebarNavButton
                  icon={UserIcon}
                  label={expanded ? username : "Profile"}
                  active={location.pathname === "/profile"}
                  expanded={expanded}
                  onClick={handleProfile}
                />

                <div className={cn("group relative flex", !expanded && "justify-center")}>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={handleSignOut}
                    aria-label="Logout"
                    className={cn(
                      expanded ? "w-full justify-start px-3" : "size-11 justify-center"
                    )}
                  >
                    <ArrowLeft01Icon size={18} className="rotate-180" />
                    {expanded ? <span>Logout</span> : null}
                  </Button>

                  {!expanded ? (
                    <span className="pointer-events-none invisible absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground opacity-0 shadow-sm transition-all duration-200 group-hover:visible group-hover:opacity-100">
                      Logout
                    </span>
                  ) : null}
                </div>
              </div>
            </aside>

            <div className="flex min-h-0 flex-1 flex-col gap-3">
              <div className="flex items-center justify-between rounded-lg border border-border/80 bg-background/90 p-2 lg:hidden">
                <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                  <SheetTrigger asChild>
                    <Button type="button" variant="outline" size="icon" className="size-10" aria-label="Open sidebar">
                      <Menu01Icon size={18} />
                    </Button>
                  </SheetTrigger>

                  <SheetContent side="left" className="w-[18rem] border-r border-border p-0">
                    <SheetHeader className="border-b border-border px-4 py-4">
                      <SheetTitle className="text-2xl leading-none">typiks</SheetTitle>
                    </SheetHeader>

                    <div className="flex h-full flex-col justify-between p-3">
                      <nav className="flex flex-col gap-2" aria-label="Mobile sidebar actions">
                        {navItems.map((item) => (
                          <SidebarNavButton
                            key={item.key}
                            icon={item.icon}
                            label={item.label}
                            active={item.active}
                            expanded
                            onClick={() => {
                              item.onClick();
                              setMobileOpen(false);
                            }}
                          />
                        ))}
                      </nav>

                      <div className="flex flex-col gap-2 border-t border-border/80 pt-3">
                        <ThemeToggleButton variant="secondary" title="Toggle theme" className="w-full justify-center" />

                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            handleProfile();
                            setMobileOpen(false);
                          }}
                          className="h-11 w-full justify-start px-3"
                        >
                          <UserIcon size={18} />
                          <span className="truncate">{username}</span>
                        </Button>

                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            handleSignOut();
                            setMobileOpen(false);
                          }}
                          className="h-11 w-full justify-start border-destructive/40 px-3 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        >
                          <ArrowLeft01Icon size={18} className="rotate-180" />
                          <span>Logout</span>
                        </Button>
                      </div>
                    </div>
                  </SheetContent>
                </Sheet>

                <span className="text-base font-semibold">typiks</span>
              </div>

              <main className="relative z-10 min-h-0 flex-1 overflow-hidden rounded-xl border border-border/80 bg-background/95 p-4 shadow-xl sm:p-6">
                <div className="h-full overflow-y-auto pr-1">
                  <Outlet />
                </div>
              </main>
            </div>
          </div>
        </div>
      </div>
    </BackgroundGrid>
  );
}
