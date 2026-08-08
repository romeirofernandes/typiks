import React, { useEffect, useState } from 'react';
import { auth } from "../firebase";
import { onAuthStateChanged } from 'firebase/auth';
import { AuthContext } from "./auth-context";

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const value = {
    state: { currentUser, loading },
    actions: {},
    meta: {},
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};
