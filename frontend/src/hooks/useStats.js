import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";

function getServerBaseUrl() {
  const serverUrl = import.meta.env.VITE_SERVER_URL || "127.0.0.1:8787";
  return serverUrl.startsWith("http") ? serverUrl : `http://${serverUrl}`;
}

/**
 * Fetch the current user's ranked stats via GET /api/users/:uid/stats.
 * Returns { stats, loading, error, refetch }.
 *
 * Pass `enabled: false` to suppress the automatic fetch on mount and call
 * `refetch()` manually when the data is needed.
 */
export function useStats({ enabled = true } = {}) {
  const { state: { currentUser } } = useAuth();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(Boolean(enabled && currentUser));
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refetch = useCallback(async () => {
    if (!currentUser) return null;

    try {
      setLoading(true);
      setError(null);
      const idToken = await currentUser.getIdToken();
      const response = await fetch(
        `${getServerBaseUrl()}/api/users/${currentUser.uid}/stats`,
        { headers: { Authorization: `Bearer ${idToken}` } }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch stats (${response.status})`);
      }

      const data = await response.json();
      if (mountedRef.current) {
        setStats(data);
        setError(null);
      }
      return data;
    } catch (err) {
      if (mountedRef.current) setError(err);
      return null;
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    if (enabled) {
      refetch();
    }
  }, [enabled, refetch]);

  return { stats, loading, error, refetch };
}
