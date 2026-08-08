import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { useFriends } from "@/hooks/useFriends";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/ui/user-avatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Delete02Icon, UserIcon, StarIcon, GameController01Icon } from "hugeicons-react";

export default function Friends() {
  const { state: { currentUser } } = useAuth();
  const navigate = useNavigate();

  const {
    loading,
    friends,
    incomingRequests,
    outgoingRequests,
    roomInvites,
    username,
    setUsername,
    searchResults,
    searchingUsers,
    feedback,
    submitting,
    debouncedSendFriendRequest,
    sendFriendRequest,
    respondToRoomInvite,
    respondToRequest,
    removeFriend,
  } = useFriends(currentUser, {
    onAcceptInvite: (roomCode) => {
      navigate("/create-room", {
        state: {
          joinRoomCode: roomCode,
          fromInvite: true,
        },
      });
    },
  });

  if (loading) {
    return (
      <div className="flex h-full flex-col gap-5">
        <div className="border-b border-border/70 pb-5">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="mt-2 h-8 w-56" />
          <Skeleton className="mt-1 h-4 w-72" />
        </div>
        <Skeleton className="h-44 w-full" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-60 w-full" />
          <Skeleton className="h-60 w-full" />
        </div>
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-5">
      <div className="border-b border-border/70 pb-5">
        <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Friends</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Friends & Requests</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Add friends by username and manage incoming requests.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add Friend</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row">
            <Input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  debouncedSendFriendRequest();
                }
              }}
              placeholder="Search username"
              maxLength={24}
            />
            <Button onClick={debouncedSendFriendRequest} disabled={submitting || !username.trim()}>
              {submitting ? "Sending..." : "Send Request"}
            </Button>
          </div>

          {username.trim().length >= 2 ? (
            <div className="space-y-2 rounded-md border border-border/70 bg-card/30 p-3">
              {searchingUsers ? (
                <p className="text-sm text-muted-foreground">Searching users...</p>
              ) : searchResults.length === 0 ? (
                <p className="text-sm text-muted-foreground">No matching users found.</p>
              ) : (
                searchResults.map((user) => {
                  const actionLabel = user.isFriend
                    ? "Friends"
                    : user.hasOutgoingRequest
                      ? "Pending"
                      : user.hasIncomingRequest
                        ? "Respond"
                        : "Add";

                  const actionDisabled =
                    submitting || user.isFriend || user.hasOutgoingRequest || user.hasIncomingRequest;

                  return (
                    <div
                      key={user.id}
                      className="flex items-center justify-between gap-3 rounded-md border border-border/70 bg-card/40 px-3 py-2"
                    >
                      <div>
                        <p className="inline-flex items-center gap-2 font-semibold">
                          <UserAvatar avatarId={user.avatarId} username={user.username} size="sm" />
                          <span>{user.username}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">Rating: {user.rating}</p>
                      </div>
                      <Button
                        size="sm"
                        variant={actionDisabled ? "outline" : "default"}
                        disabled={actionDisabled}
                        onClick={() => sendFriendRequest(user.username)}
                      >
                        {actionLabel}
                      </Button>
                    </div>
                  );
                })
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {feedback ? (
        <p className="rounded-md border border-border/70 bg-card/40 px-3 py-2 text-sm text-muted-foreground">
          {feedback}
        </p>
      ) : null}

      {(incomingRequests.length > 0 || roomInvites.length > 0) ? (
        <Card>
          <CardHeader>
            <CardTitle>Notifications</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {incomingRequests.map((request) => (
              <div
                key={`notif-fr-${request.id}`}
                className="flex flex-col gap-3 rounded-md border border-border/70 bg-card/30 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="inline-flex items-center gap-2 font-semibold">
                    <UserAvatar avatarId={request.senderAvatarId} username={request.senderUsername} size="sm" />
                    <span>{request.senderUsername} sent you a friend request</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Rating: {request.senderRating} • {request.senderOnline ? "Online" : "Offline"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => respondToRequest(request.id, "accept")}>Accept</Button>
                  <Button size="sm" variant="outline" onClick={() => respondToRequest(request.id, "reject")}>Decline</Button>
                </div>
              </div>
            ))}

            {roomInvites.map((invite) => (
              <div
                key={`notif-ri-${invite.id}`}
                className="flex flex-col gap-3 rounded-md border border-border/70 bg-card/30 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="inline-flex items-center gap-2 font-semibold">
                    <UserAvatar avatarId={invite.inviterAvatarId} username={invite.inviterUsername} size="sm" />
                    <span>{invite.inviterUsername} invited you to room {invite.roomCode}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {invite.inviterOnline ? "Inviter online" : "Inviter offline"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => respondToRoomInvite(invite.id, "accept")}>Join</Button>
                  <Button size="sm" variant="outline" onClick={() => respondToRoomInvite(invite.id, "reject")}>Dismiss</Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Incoming Requests ({incomingRequests.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {incomingRequests.length === 0 ? (
              <p className="text-sm text-muted-foreground">No incoming requests.</p>
            ) : (
              incomingRequests.map((request) => (
                <div
                  key={request.id}
                  className="flex flex-col gap-2 rounded-md border border-border/70 bg-card/30 p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="inline-flex items-center gap-2 font-semibold">
                      <UserAvatar avatarId={request.senderAvatarId} username={request.senderUsername} size="sm" />
                      <span>{request.senderUsername}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Rating: {request.senderRating} • {request.senderOnline ? "Online" : "Offline"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => respondToRequest(request.id, "accept")}>
                      Accept
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => respondToRequest(request.id, "reject")}
                    >
                      Decline
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Outgoing Requests ({outgoingRequests.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {outgoingRequests.length === 0 ? (
              <p className="text-sm text-muted-foreground">No pending outgoing requests.</p>
            ) : (
              outgoingRequests.map((request) => (
                <div
                  key={request.id}
                  className="flex items-center justify-between rounded-md border border-border/70 bg-card/30 p-3"
                >
                  <div>
                    <p className="inline-flex items-center gap-2 font-semibold">
                      <UserAvatar avatarId={request.receiverAvatarId} username={request.receiverUsername} size="sm" />
                      <span>{request.receiverUsername}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">Waiting for response</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Rating: {request.receiverRating} • {request.receiverOnline ? "Online" : "Offline"}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="flex-1">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 font-sans text-lg">
            <UserIcon className="h-5 w-5" />
            Friends
            <span className="ml-1 font-mono text-sm text-muted-foreground">({friends.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {friends.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No friends yet. Add friends using their username above.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {friends.map((friend) => (
                <div
                  key={friend.id}
                  className="group flex flex-col gap-3 rounded-lg border border-border/50 bg-card p-4 transition-colors hover:border-border"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <UserAvatar avatarId={friend.avatarId} username={friend.username} />
                      </div>
                      <div>
                        <p className="font-semibold">{friend.username}</p>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <StarIcon className="h-3 w-3" />
                            {friend.rating}
                          </span>
                          <span className="flex items-center gap-1">
                            <GameController01Icon className="h-3 w-3" />
                            {friend.gamesPlayed}
                          </span>
                          <span className={friend.online ? "text-primary" : "text-muted-foreground"}>
                            {friend.online ? "Online" : "Offline"}
                          </span>
                        </div>
                      </div>
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                        >
                          <Delete02Icon className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remove friend?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will remove {friend.username} from your friends list.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive text-white hover:bg-destructive/90"
                            onClick={() => removeFriend(friend.id)}
                          >
                            Remove
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
