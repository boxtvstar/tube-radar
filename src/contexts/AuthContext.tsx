import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';

export type UserRole = 'admin' | 'approved' | 'pending';

interface AuthContextType {
  user: User | null;
  role: UserRole | null;
  expiresAt: string | null; // Add expiresAt state
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null); // State for expiry
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        try {
          // Fetch or create user role
          const userRef = doc(db, 'users', currentUser.uid);
          const userSnap = await getDoc(userRef);

          if (userSnap.exists()) {
            const data = userSnap.data();
            
            // Just check generic role/expiry, no channel ID logic needed anymore
            setRole(data.role as UserRole);
            setExpiresAt(data.expiresAt || null);
            
            // Update last login time
            await updateDoc(userRef, {
              lastLoginAt: new Date().toISOString()
            });
          } else {
            // New user: default to 'pending'
            await setDoc(userRef, {
              email: currentUser.email,
              displayName: currentUser.displayName,
              photoURL: currentUser.photoURL,
              role: 'pending',
              createdAt: new Date().toISOString(),
              lastLoginAt: new Date().toISOString(),
              expiresAt: null,
              plan: 'free' // Default to free plan
            }, { merge: true });
            
            setRole('pending');
            setExpiresAt(null);
          }
        } catch (error) {
          console.error("Error fetching user data:", error);
          setRole('pending');
          setExpiresAt(null);
        }
      } else {
        setRole(null);
        setExpiresAt(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    setLoading(true);
    try {
      // Standard Generic Login (No Scopes)
      const result = await signInWithPopup(auth, provider);
      // setUser handled by onAuthStateChanged
    } catch (error) {
      console.error("Login failed:", error);
      setLoading(false);
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout failed:", error);
    } finally {
      // Force reload to ensure clean state and prevent black screen
      window.location.reload();
    }
  };

  if (loading) return <div className="min-h-screen bg-gray-900 flex items-center justify-center text-white">Loading...</div>;

  return (
    <AuthContext.Provider value={{ user, role, expiresAt, loading, signInWithGoogle, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
