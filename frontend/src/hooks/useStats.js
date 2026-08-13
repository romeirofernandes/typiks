import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { apiFetch } from "@/lib/api-client";
import { userKeys } from "@/lib/query-keys";

/**
 * Fetch the current user's ranked stats via GET /api/users/:uid/stats.
 * Returns { stats, loading, error, refetch }.
 *
 * Pass `enabled: false` to suppress the automatic fetch on mount and call
 * `refetch()` manually when the data is needed.
 */
export function useStats({ enabled = true } = {}) {
  const { state: { currentUser } } = useAuth();
  const uid = currentUser?.uid;

  const query = useQuery({
    queryKey: userKeys.stats(uid),
    queryFn: () =>
      apiFetch(currentUser, `/api/users/${uid}/stats`).then(({ data }) => data),
    enabled: Boolean(enabled && uid),
    staleTime: 60 * 1000,
  });

  return {
    stats: query.data,
    loading: query.isPending || query.isFetching,
    error: query.error,
    refetch: query.refetch,
  };
}