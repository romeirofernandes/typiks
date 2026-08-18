import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { apiFetch } from "@/lib/api-client";
import { userKeys } from "@/lib/query-keys";

/**
 * Fetch the current user's daily contribution activity via
 * GET /api/users/:uid/activity?days=N.
 * Returns { activity, maxCount, loading }.
 */
export function useActivity(days) {
  const { state: { currentUser } } = useAuth();

  const query = useQuery({
    queryKey: userKeys.activity(currentUser?.uid, days),
    queryFn: () =>
      apiFetch(
        currentUser,
        `/api/users/${currentUser.uid}/activity?days=${days}`
      ).then(({ data }) => ({
        activity: data.activity || [],
        maxCount: data.maxCount || 0,
      })),
    enabled: Boolean(currentUser),
    staleTime: 60 * 1000,
  });

  return {
    activity: query.data?.activity ?? [],
    maxCount: query.data?.maxCount ?? 0,
    loading: query.isPending,
  };
}