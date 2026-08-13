import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import { meKeys, userKeys } from "@/lib/query-keys";

/**
 * Provision (or update) the current user's profile via POST /api/users.
 * The server creates a new profile for a first-time uid, returns the
 * existing profile otherwise, and reconciles the stored email when a guest
 * has been upgraded to a permanent account.
 *
 * Pass `forceRefresh: true` after Firebase credential linking so the ID
 * token carries the newly attached email claim; otherwise the cached token
 * still describes the anonymous account and the server cannot detect the
 * upgrade.
 */
export async function createOrGetUser(
  user,
  { body = {}, forceRefresh = false } = {}
) {
  const idToken = await user.getIdToken(forceRefresh);
  const { data } = await apiFetch(idToken, "/api/users", {
    method: "POST",
    body,
  });
  return data;
}

/**
 * Mutation wrapper around createOrGetUser for auth-entry flows
 * (sign in, sign up, guest login, guest upgrade). Invalidates the
 * provisioned user's profile/stats queries once the server responds.
 */
export function useProvisionUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ user, body = {}, forceRefresh = false }) =>
      createOrGetUser(user, { body, forceRefresh }),
    onSuccess: (data) => {
      const uid = data?.player?.id;
      if (uid) {
        queryClient.invalidateQueries({ queryKey: userKeys.detail(uid) });
        queryClient.invalidateQueries({ queryKey: meKeys.profile() });
      }
    },
  });
}