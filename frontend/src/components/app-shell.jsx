import { useEffect, useMemo, useRef, useState } from "react";
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
import { Bot, DoorOpen, Users } from "lucide-react";

function SidebarNavButton({
  icon,
  label,
  active,
  expanded,
  onClick,
  badgeCount = 0,
  avatarId = null,
  muted = false,
}) {
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
          !active && "hover:border-border/70",
          muted && "pointer-events-none opacity-55 saturate-0"
        )}
      >
        {avatarId ? (
          <UserAvatar
            avatarId={avatarId}
            username={label}
            size={expanded ? "md" : "sm"}
            plain={expanded}
          />
        ) : (
          <Icon size={18} className="shrink-0" />
        )}
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
  const [isAvatarPreviewOpen, setIsAvatarPreviewOpen] = useState(false);
  const [statsUsername, setStatsUsername] = useState(null);
  const [statsAvatarId, setStatsAvatarId] = useState("avatar1");
  const [notificationCounts, setNotificationCounts] = useState({
    pendingFriendRequests: 0,
    pendingRoomInvites: 0,
    total: 0,
  });
  const presenceSocketRef = useRef(null);
  const presencePingTimerRef = useRef(null);
  const presenceReconnectTimerRef = useRef(null);
  const presenceSubscribersRef = useRef(new Set());

  useEffect(() => {
    const fetchSidebarUsername = async () => {
      if (!currentUser) {
        setStatsUsername(null);
        return;
      }

      try {
        const idToken = await currentUser.getIdToken();
        const serverUrl = import.meta.env.VITE_SERVER_URL || "127.0.0.1:8787";
        const fullUrl = serverUrl.startsWith("http") ? serverUrl : `http://${serverUrl}`;

        const response = await fetch(`${fullUrl}/api/users/${currentUser.uid}/stats`, {
          headers: {
            Authorization: `Bearer ${idToken}`,
          },
        });

        if (!response.ok) return;

        const payload = await response.json();
        setStatsUsername(payload?.username || null);
        setStatsAvatarId(payload?.avatarId || "avatar1");
      } catch (error) {
        console.error("Failed to fetch sidebar username:", error);
      }
    };

    fetchSidebarUsername();
  }, [currentUser]);

  useEffect(() => {
    const handleAvatarPreviewState = (event) => {
      setIsAvatarPreviewOpen(Boolean(event?.detail?.open));
    };

    window.addEventListener("typiks:avatar-preview-state", handleAvatarPreviewState);
    return () => {
      window.removeEventListener("typiks:avatar-preview-state", handleAvatarPreviewState);
    };
  }, []);

  useEffect(() => {
    if (!currentUser) return;

    let isMounted = true;
    let notificationTimerId = null;

    const clearPresenceTimers = () => {
      if (presencePingTimerRef.current) {
        window.clearInterval(presencePingTimerRef.current);
        presencePingTimerRef.current = null;
      }
      if (presenceReconnectTimerRef.current) {
        window.clearTimeout(presenceReconnectTimerRef.current);
        presenceReconnectTimerRef.current = null;
      }
    };

    const sendPresenceMessage = (payload) => {
      if (!presenceSocketRef.current || presenceSocketRef.current.readyState !== WebSocket.OPEN) {
        return;
      }

      try {
        presenceSocketRef.current.send(JSON.stringify(payload));
      } catch (error) {
        console.error("Failed to send presence message:", error);
      }
    };

    const broadcastPresenceUpdate = (userId, online) => {
      if (!userId) return;
      window.dispatchEvent(
        new CustomEvent("typiks:presence-update", {
          detail: { userId, online: Boolean(online) },
        })
      );
    };

    const broadcastPresenceSnapshot = (onlineMap) => {
      if (!onlineMap || typeof onlineMap !== "object") return;
      window.dispatchEvent(
        new CustomEvent("typiks:presence-snapshot", {
          detail: { onlineMap },
        })
      );
    };

    const pushPresenceSubscription = () => {
      sendPresenceMessage({
        type: "SUBSCRIBE",
        userIds: Array.from(presenceSubscribersRef.current),
      });
    };

    const handlePresenceSubscribeEvent = (event) => {
      const ids = Array.isArray(event?.detail?.userIds) ? event.detail.userIds : [];
      let changed = false;

      for (const id of ids) {
        if (typeof id !== "string" || !id) continue;
        if (presenceSubscribersRef.current.has(id)) continue;
        presenceSubscribersRef.current.add(id);
        changed = true;
      }

      if (changed) {
        pushPresenceSubscription();
      }
    };

    const connectPresenceSocket = async () => {
      try {
        const idToken = await currentUser.getIdToken();
        const serverUrl = import.meta.env.VITE_SERVER_URL || "127.0.0.1:8787";
        const httpUrl = serverUrl.startsWith("http") ? serverUrl : `http://${serverUrl}`;
        const wsBaseUrl = httpUrl
          .replace(/^http:/i, "ws:")
          .replace(/^https:/i, "wss:")
          .replace(/\/$/, "");

        const socket = new WebSocket(new URL("/ws/presence", wsBaseUrl));
        presenceSocketRef.current = socket;

        socket.onopen = () => {
          if (!isMounted || presenceSocketRef.current !== socket) return;
          sendPresenceMessage({
            type: "AUTH",
            idToken,
            visible: document.visibilityState === "visible",
          });
          pushPresenceSubscription();

          clearPresenceTimers();
          presencePingTimerRef.current = window.setInterval(() => {
            sendPresenceMessage({ type: "PING" });
          }, 15000);
        };

        socket.onclose = () => {
          if (presenceSocketRef.current === socket) {
            presenceSocketRef.current = null;
          }
          if (!isMounted) return;

          clearPresenceTimers();
          presenceReconnectTimerRef.current = window.setTimeout(() => {
            if (!isMounted) return;
            void connectPresenceSocket();
          }, 2000);
        };

        socket.onerror = () => {
          if (!isMounted) return;
          try {
            socket.close();
          } catch {
            // no-op
          }
        };

        socket.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data);
            if (!payload || typeof payload.type !== "string") return;

            if (payload.type === "PRESENCE_UPDATE") {
              broadcastPresenceUpdate(payload.userId, payload.online);
              return;
            }

            if (payload.type === "PRESENCE_SNAPSHOT") {
              broadcastPresenceSnapshot(payload.onlineMap);
              return;
            }

            if (payload.type === "NOTIFICATION_POKE") {
              void syncPresenceAndNotifications();
            }
          } catch {
            // no-op
          }
        };
      } catch (error) {
        console.error("Failed to connect presence socket:", error);
      }
    };

    const handleVisibility = () => {
      sendPresenceMessage({
        type: "VISIBILITY",
        visible: document.visibilityState === "visible",
      });
    };

    const syncPresenceAndNotifications = async () => {
      try {
        const idToken = await currentUser.getIdToken();
        const serverUrl = import.meta.env.VITE_SERVER_URL || "127.0.0.1:8787";
        const fullUrl = serverUrl.startsWith("http") ? serverUrl : `http://${serverUrl}`;

        const notificationRes = await fetch(`${fullUrl}/api/users/me/notifications`, {
          headers: {
            Authorization: `Bearer ${idToken}`,
          },
        });

        if (!notificationRes.ok || !isMounted) {
          return;
        }

        const payload = await notificationRes.json();
        if (!isMounted) return;

        setNotificationCounts({
          pendingFriendRequests: Number(payload?.pendingFriendRequests || 0),
          pendingRoomInvites: Number(payload?.pendingRoomInvites || 0),
          total: Number(payload?.total || 0),
        });
      } catch (error) {
        console.error("Failed to sync presence/notifications:", error);
      }
    };

    void connectPresenceSocket();
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("typiks:presence-subscribe", handlePresenceSubscribeEvent);
    syncPresenceAndNotifications();
    notificationTimerId = window.setInterval(syncPresenceAndNotifications, 25000);

    return () => {
      isMounted = false;
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("typiks:presence-subscribe", handlePresenceSubscribeEvent);
      if (notificationTimerId) {
        window.clearInterval(notificationTimerId);
      }
      clearPresenceTimers();
      if (presenceSocketRef.current) {
        try {
          presenceSocketRef.current.close();
        } catch {
          // no-op
        }
        presenceSocketRef.current = null;
      }
    };
  }, [currentUser]);

  const username =
    statsUsername ||
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
        key: "bot-mode",
        label: "Bot Mode",
        icon: Bot,
        active: location.pathname === "/bot-mode",
        onClick: () => navigate("/bot-mode"),
      },
      {
        key: "create-room",
        label: "Unranked Match",
        icon: DoorOpen,
        active: location.pathname === "/create-room",
        onClick: () => navigate("/create-room"),
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
                      badgeCount={item.badgeCount}
                    />
                  ))}
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
                    <span className="pointer-events-none invisible absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground opacity-0 shadow-sm transition-all duration-200 group-hover:visible group-hover:opacity-100">
                      Toggle theme
                    </span>
                  ) : null}
                </div>

                {expanded ? (
                  <Button
                    type="button"
                    variant={
                      isAvatarPreviewOpen
                        ? "ghost"
                        : location.pathname === "/profile"
                        ? "secondary"
                        : "ghost"
                    }
                    onClick={handleProfile}
                    className="h-11 w-full justify-start px-2.5"
                  >
                    <UserAvatar avatarId={statsAvatarId} username={username} size="md" plain />
                      <span className="ml-1 truncate text-sm font-medium">{username}</span>
                  </Button>
                ) : (
                  <SidebarNavButton
                    icon={UserIcon}
                    label="Profile"
                    active={location.pathname === "/profile"}
                    expanded={expanded}
                    onClick={handleProfile}
                    muted={isAvatarPreviewOpen}
                  />
                )}

                <div className={cn("group relative flex", !expanded && "justify-center")}>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={handleSignOut}
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
                      <SheetTitle className="text-2xl font-sans leading-none">typiks</SheetTitle>
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
                            badgeCount={item.badgeCount}
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
                          <UserAvatar avatarId={statsAvatarId} username={username} size="md" plain />
                          <span className="ml-2 truncate text-sm font-medium">{username}</span>
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
                          <ArrowLeft01Icon size={18} />
                          <span>Logout</span>
                        </Button>
                      </div>
                    </div>
                  </SheetContent>
                </Sheet>

                <span className="text-base font-sans font-semibold">typiks</span>
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
