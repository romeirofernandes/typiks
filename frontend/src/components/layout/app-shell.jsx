import { useEffect, useMemo, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useStats } from "@/hooks/useStats";
import { useVisualViewportHeight } from "@/hooks/useVisualViewportHeight";
import { usePresenceSocket } from "@/hooks/usePresenceSocket";

import BackgroundGrid from "@/components/landing/BackgroundGrid";
import { SharedLayoutBg } from "@/components/motion/shared-layout-bg";
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
import { UserAvatar } from "@/components/ui/user-avatar";
import {
  ArrowLeft01Icon,
  GlobeIcon,
  PlayIcon,
  Menu01Icon,
  RankingIcon,
  UserIcon,
  DashboardSquare01Icon
} from "hugeicons-react";
import { Bot, DoorOpen, Users, Gamepad2 } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { meKeys } from "@/lib/query-keys";

function SidebarNavButton({
  icon,
  label,
  active,
  expanded,
  onClick,
  badgeCount = 0,
  muted = false,
  highlight = false,
}) {
  const Icon = icon;

  return (
    <div className={cn("group relative flex", !expanded && "justify-center")}>
      <Button
        type="button"
        variant="ghost"
        onClick={onClick}
        aria-label={label}
        className={cn(
          "h-11 border border-transparent transition-colors",
          expanded ? "w-full justify-start px-3" : "size-11 justify-center",
          !active && "hover:border-border/70",
          active && "hover:bg-transparent hover:text-foreground",
          muted && "pointer-events-none opacity-55 saturate-0",
          highlight && !muted && "bg-primary/40 text-foreground hover:bg-primary/50 dark:bg-primary/30 dark:hover:bg-primary/40"
        )}
      >
        {<Icon size={18} className="shrink-0" />}
        {expanded ? (
          <>
            <span className="ml-3 truncate">{label}</span>
            {badgeCount > 0 ? (
              <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                {badgeCount > 99 ? "99+" : badgeCount}
              </span>
            ) : null}
          </>
        ) : badgeCount > 0 ? (
          <span className="absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
            {badgeCount > 99 ? "99+" : badgeCount}
          </span>
        ) : null}
      </Button>

      {!expanded ? (
        <span className="pointer-events-none invisible absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground opacity-0 shadow-sm transition-opacity duration-200 group-hover:visible group-hover:opacity-100">
          {label}
        </span>
      ) : null}
    </div>
  );
}

function usePresenceConnection({ currentUser, onAvatarPreviewOpenChange }) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const handleAvatarPreviewState = (event) => {
      onAvatarPreviewOpenChange(Boolean(event?.detail?.open));
    };

    window.addEventListener("typiks:avatar-preview-state", handleAvatarPreviewState);
    return () => {
      window.removeEventListener("typiks:avatar-preview-state", handleAvatarPreviewState);
    };
  }, [onAvatarPreviewOpenChange]);

  usePresenceSocket({
    currentUser,
    onNotificationPoke: () =>
      queryClient.invalidateQueries({ queryKey: meKeys.notifications() }),
  });
}

function DesktopSidebar({
  expanded,
  onToggleExpanded,
  isAvatarPreviewOpen,
  username,
  activeNavKey,
  navItems,
  profileActive,
  onNavigateProfile,
  onSignOut,
}) {
  return (
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
            onClick={onToggleExpanded}
            aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
            className="size-11 border border-transparent hover:border-border/70"
          >
            <ArrowLeft01Icon
              size={18}
              className={cn("transition-transform duration-300", !expanded && "rotate-180")}
            />
          </Button>
        </div>

        <nav className="flex flex-col px-2" aria-label="Sidebar actions">
          <SharedLayoutBg
            activeKey={activeNavKey}
            inset={0}
            className="flex flex-col gap-2"
            pillClassName="rounded-md"
            pillContainerClassName="bg-secondary"
          >
            {navItems.map((item) => (
              <SidebarNavButton
                key={item.key}
                icon={item.icon}
                label={item.label}
                active={item.active}
                expanded={expanded}
                onClick={item.onClick}
                badgeCount={item.badgeCount}
              />
            ))}
          </SharedLayoutBg>
        </nav>
      </div>

      <div
        className={cn(
          "flex flex-col gap-2 border-t border-border/80 px-2 pt-3 transition-opacity",
          isAvatarPreviewOpen && "pointer-events-none opacity-55 saturate-0"
        )}
      >
        <div className={cn("group relative flex", !expanded && "justify-center")}>
          <ThemeToggleButton
            variant={isAvatarPreviewOpen ? "outline" : "secondary"}
            title="Toggle theme"
            className={cn(expanded ? "h-11 w-full justify-center" : "size-11")}
          />

          {!expanded ? (
            <span className="pointer-events-none invisible absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground opacity-0 shadow-sm transition-opacity duration-200 group-hover:visible group-hover:opacity-100">
              Toggle theme
            </span>
          ) : null}
        </div>

        {expanded ? (
          <Button
            type="button"
            variant="ghost"
            onClick={onNavigateProfile}
            className={cn(
              "h-11 w-full justify-start px-2.5",
              !isAvatarPreviewOpen && "bg-primary/40 text-foreground hover:bg-primary/50 dark:bg-primary/30 dark:hover:bg-primary/40"
            )}
          >
            <UserAvatar
              username={username}
              size="md"
              plain
              className="transition-transform duration-200 hover:scale-105"
            />
              <span className="ml-1 truncate text-sm font-medium">{username}</span>
          </Button>
        ) : (
          <SidebarNavButton
            icon={UserIcon}
            label="Profile"
            active={profileActive}
            expanded={expanded}
            onClick={onNavigateProfile}
            muted={isAvatarPreviewOpen}
            highlight={!isAvatarPreviewOpen}
          />
        )}

        <div className={cn("group relative flex", !expanded && "justify-center")}>
          <Button
            type="button"
            variant="destructive"
            onClick={onSignOut}
            aria-label="Logout"
            className={cn(
              expanded ? "w-full justify-start px-3" : "size-11 justify-center",
              isAvatarPreviewOpen && "bg-muted text-muted-foreground hover:bg-muted"
            )}
          >
            <ArrowLeft01Icon size={18} className="rotate-180" />
            {expanded ? <span>Logout</span> : null}
          </Button>

          {!expanded ? (
            <span className="pointer-events-none invisible absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground opacity-0 shadow-sm transition-opacity duration-200 group-hover:visible group-hover:opacity-100">
              Logout
            </span>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

function MobileTopBar({
  mobileOpen,
  setMobileOpen,
  username,
  activeNavKey,
  navItems,
  onNavigateProfile,
  onSignOut,
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border/80 bg-background/90 p-2 lg:hidden">
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetTrigger asChild>
          <Button type="button" variant="outline" size="icon" className="size-10" aria-label="Open sidebar">
            <Menu01Icon size={18} />
          </Button>
        </SheetTrigger>

        <SheetContent side="left" className="w-[18rem] border-r border-border p-0">
          <SheetHeader className="border-b border-border px-4 py-4">
            <SheetTitle className="text-2xl font-sans leading-none">typiks</SheetTitle>
          </SheetHeader>

          <div className="flex h-full flex-col justify-between p-3">
            <nav className="flex flex-col" aria-label="Mobile sidebar actions">
              <SharedLayoutBg
                activeKey={activeNavKey}
                inset={0}
                className="flex flex-col gap-2"
                pillClassName="rounded-md"
                pillContainerClassName="bg-secondary"
              >
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
                    badgeCount={item.badgeCount}
                  />
                ))}
              </SharedLayoutBg>
            </nav>

            <div className="flex flex-col gap-2 border-t border-border/80 pt-3">
              <ThemeToggleButton variant="secondary" title="Toggle theme" className="w-full justify-center" />

              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  onNavigateProfile();
                  setMobileOpen(false);
                }}
                className="h-11 w-full justify-start px-3"
              >
                <UserAvatar
                  username={username}
                  size="md"
                  plain
                  className="transition-transform duration-200 hover:scale-105"
                />
                <span className="ml-2 truncate text-sm font-medium">{username}</span>
              </Button>

              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  onSignOut();
                  setMobileOpen(false);
                }}
                className="h-11 w-full justify-start border-destructive/40 px-3 text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <ArrowLeft01Icon size={18} />
                <span>Logout</span>
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <span className="text-base font-sans font-semibold">typiks</span>
    </div>
  );
}

export default function AppShell() {
  const { state: { currentUser } } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const visualViewportHeight = useVisualViewportHeight();

  const [expanded, setExpanded] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isAvatarPreviewOpen, setIsAvatarPreviewOpen] = useState(false);

  const notificationsQuery = useQuery({
    queryKey: meKeys.notifications(),
    queryFn: () =>
      apiFetch(currentUser, "/api/users/me/notifications").then(({ data }) => ({
        pendingFriendRequests: Number(data?.pendingFriendRequests || 0),
        pendingRoomInvites: Number(data?.pendingRoomInvites || 0),
        total: Number(data?.total || 0),
      })),
    enabled: Boolean(currentUser),
    staleTime: 30 * 1000,
    refetchInterval: 25000,
    refetchOnWindowFocus: false,
  });

  const notificationCounts = notificationsQuery.data ?? {
    pendingFriendRequests: 0,
    pendingRoomInvites: 0,
    total: 0,
  };

  const { stats: sidebarStats } = useStats();

  usePresenceConnection({
    currentUser,
    onAvatarPreviewOpenChange: setIsAvatarPreviewOpen,
  });

  const username =
    sidebarStats?.username ||
    currentUser?.displayName ||
    currentUser?.email?.split("@")[0] ||
    "username";

  const navItems = useMemo(
    () => [
      {
        key: "dashboard",
        label: "Dashboard",
        icon: DashboardSquare01Icon,
        active: location.pathname === "/dashboard",
        onClick: () => navigate("/dashboard"),
      },
      {
        key: "start-game",
        label: "Ranked Match",
        icon: PlayIcon,
        active:
          location.pathname === "/start-game" ||
          location.pathname === "/game" ||
          location.pathname === "/game/waiting",
        onClick: () => navigate("/start-game"),
      },
      {
        key: "create-room",
        label: "Unranked Match",
        icon: DoorOpen,
        active: location.pathname === "/create-room",
        onClick: () => navigate("/create-room"),
      },
      {
        key: "bot-mode",
        label: "Bot Mode",
        icon: Bot,
        active: location.pathname === "/bot-mode",
        onClick: () => navigate("/bot-mode"),
      },
      {
        key: "freeplay",
        label: "Free Play",
        icon: Gamepad2,
        active: location.pathname === "/freeplay",
        onClick: () => navigate("/freeplay"),
      },
      {
        key: "friends",
        label: "Friends",
        icon: Users,
        active: location.pathname === "/friends",
        onClick: () => navigate("/friends"),
        badgeCount: notificationCounts.pendingFriendRequests + notificationCounts.pendingRoomInvites,
      },
      {
        key: "the-globe",
        label: "The Globe",
        icon: GlobeIcon,
        active: location.pathname === "/the-globe",
        onClick: () => navigate("/the-globe"),
      },
      {
        key: "leaderboard",
        label: "Leaderboard",
        icon: RankingIcon,
        active: location.pathname === "/leaderboard",
        onClick: () => navigate("/leaderboard"),
      },
    ],
    [location.pathname, navigate, notificationCounts.pendingFriendRequests, notificationCounts.pendingRoomInvites]
  );

  const activeNavKey = useMemo(
    () => navItems.find((item) => item.active)?.key ?? "",
    [navItems]
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
        <div className="h-svh w-full p-3" style={{ height: visualViewportHeight }}>
          <div className="flex h-full w-full flex-col gap-3 lg:flex-row">
            <DesktopSidebar
              expanded={expanded}
              onToggleExpanded={() => setExpanded((prev) => !prev)}
              isAvatarPreviewOpen={isAvatarPreviewOpen}
              username={username}
              activeNavKey={activeNavKey}
              navItems={navItems}
              profileActive={location.pathname === "/profile"}
              onNavigateProfile={handleProfile}
              onSignOut={handleSignOut}
            />

            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
              <MobileTopBar
                mobileOpen={mobileOpen}
                setMobileOpen={setMobileOpen}
                username={username}
                activeNavKey={activeNavKey}
                navItems={navItems}
                onNavigateProfile={handleProfile}
                onSignOut={handleSignOut}
              />

              <main
                className="relative z-10 min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-border/80 bg-background/95 shadow-xl p-4 sm:p-6"
              >
                <div className="h-full min-w-0 overflow-y-auto pr-1">
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