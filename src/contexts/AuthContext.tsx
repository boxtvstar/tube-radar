import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { fetchMyChannelId } from '../../services/youtubeService';

export type UserRole = 'admin' | 'approved' | 'pending';

interface AuthContextType {
  user: User | null;
  role: UserRole | null;
  expiresAt: string | null;
  loading: boolean;
  hiddenItemIds: string[];
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  membershipJustApproved: { matches: boolean; daysLeft: number; name: string } | null;
  setMembershipJustApproved: (val: { matches: boolean; daysLeft: number; name: string } | null) => void;
  dismissItem: (itemId: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hiddenItemIds, setHiddenItemIds] = useState<string[]>([]);
  const [membershipJustApproved, setMembershipJustApproved] = useState<{ matches: boolean; daysLeft: number; name: string } | null>(null);

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (!currentUser) {
        setRole(null);
        setExpiresAt(null);
        setHiddenItemIds([]);
        setLoading(false);
        return;
      }
    });
    return unsubscribeAuth;
  }, []);

  // Real-time listener for User Profile & Membership Logic
  useEffect(() => {
    if (!user) return;

    setLoading(true);
    const userRef = doc(db, 'users', user.uid);
    
    // Create/Ensure user doc exists first (if new login)
    // We can do a quick check or just setDoc with merge if we suspect new user.
    // But `onSnapshot` handles existence.
    // However, for new Googler login, we might need to create the doc first.
    // Let's do the creation logic once.
    
    const initUser = async () => {
       const snap = await getDoc(userRef);
       if (!snap.exists()) {
          await setDoc(userRef, {
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL,
            role: 'pending',
            createdAt: new Date().toISOString(),
            lastLoginAt: new Date().toISOString(),
            expiresAt: null,
            plan: 'free',
            channelId: null
          }, { merge: true });
       } else {
          // Update last login
          await updateDoc(userRef, {
             lastLoginAt: new Date().toISOString(),
             // Update profile info if changed
             displayName: user.displayName,
             photoURL: user.photoURL
          });
       }
    };
    initUser();

    // LISTEN to changes (including when they submit Channel ID)
    const unsubscribeSnapshot = onSnapshot(userRef, async (docSnap) => {
        if (!docSnap.exists()) return;

        const data = docSnap.data();
        const currentRole = data.role as UserRole;
        const currentPlan = data.plan || 'free';
        const storedChannelId = data.channelId;
        const currentExpiresAt = data.expiresAt;
        const currentHiddenItemIds = data.hiddenItemIds || [];

        setRole(currentRole);
        setExpiresAt(currentExpiresAt || null);
        setHiddenItemIds(currentHiddenItemIds);
        
        // --- Membership Auto-Approval Logic (Real-time) ---
        // If channelId is present (e.g. just submitted), check whitelist.
        if (storedChannelId) {
             try {
                 const whitelistRef = doc(db, 'system_data', 'membership_whitelist');
                 const whitelistSnap = await getDoc(whitelistRef);
                 
                 if (whitelistSnap.exists()) {
                    const whitelist = whitelistSnap.data();
                    const details = whitelist.memberDetails as any[] || [];
                    
                    // Match Strictly by Channel ID
                    const match = details.find(m => m.id === storedChannelId);
                    
                    if (match) {
                       // LOGIC: Calculate Expiry
                       let newExpiry = '';
                       const now = new Date(); 

                       // 1. Explicit 'remainingDays'
                       if (match.remainingDays) {
                           const parsedDays = parseInt(String(match.remainingDays).replace(/[^0-9]/g, ''));
                           if (!isNaN(parsedDays)) {
                              newExpiry = new Date(now.getTime() + parsedDays * 24 * 60 * 60 * 1000).toISOString();
                           }
                       } 
                       
                       // 2. Monthly Renewal Logic
                       if (!newExpiry && match.lastUpdate) {
                           const dateStr = match.lastUpdate;
                           const anchorDate = new Date(dateStr);
                           if (!isNaN(anchorDate.getTime())) {
                               const anchorDay = anchorDate.getDate();
                               let nextRenewal = new Date(now.getFullYear(), now.getMonth(), anchorDay);
                               if (now.getDate() >= anchorDay) {
                                   nextRenewal.setMonth(nextRenewal.getMonth() + 1);
                               }
                               newExpiry = nextRenewal.toISOString();
                           }
                       }

                       // 3. Fallback
                       if (!newExpiry) {
                           const baseDate = match.lastUpdate ? new Date(match.lastUpdate) : new Date();
                           newExpiry = new Date(baseDate.getTime() + 32 * 24 * 60 * 60 * 1000).toISOString();
                       }

                       const expiryTime = new Date(newExpiry).getTime();
                       const currentExpiryTime = currentExpiresAt ? new Date(currentExpiresAt).getTime() : 0;
                       
                       // Conditions to Update
                       const isRoleUpgrade = currentRole !== 'approved' && currentRole !== 'admin';
                       const isPlanUpgrade = currentPlan !== 'membership';
                       const isExtension = expiryTime > (currentExpiryTime + 24 * 60 * 60 * 1000); 

                       if (isRoleUpgrade || isPlanUpgrade || isExtension) {
                           console.log(`[Membership] Auto-approving/Extending user by ID match: ${match.id}`);
                           
                           const updates: any = {
                              role: currentRole === 'admin' ? 'admin' : 'approved',
                              plan: 'membership',
                              expiresAt: newExpiry,
                              matchedAt: new Date().toISOString(),
                              membershipTier: match.tier
                           };

                           const diffInMs = expiryTime - new Date().getTime();
                           const daysLeftVal = Math.max(Math.ceil(diffInMs / (1000 * 60 * 60 * 24)), 0);

                           // Prevent infinite loop: Only update if something actually changed
                           // Compare 'currentExpiresAt' vs 'newExpiry' string equality? No, simple role check is safer.
                           // Or check if currentExpiresAt is different enough.
                           // IMPORTANT: updateDoc will trigger onSnapshot AGAIN. 
                           // We must ensure we don't loop.
                           // isExtension check helps. 
                           // isRoleUpgrade helps.
                           
                           await updateDoc(userRef, updates);
                           
                           // Log History (Only if we updated)
                           try {
                              const { addDoc, collection } = await import('firebase/firestore');
                              await addDoc(collection(db, 'users', user.uid, 'history'), {
                                 action: 'membership_sync',
                                 details: `Membership synced via Whitelist (ID: ${storedChannelId}). Tier: ${match.tier}`,
                                 date: new Date().toISOString(),
                                 previousExpiry: currentExpiresAt,
                                 newExpiry: newExpiry
                              });
                           } catch(e) {}

                           // Local State Update for Popup (Optional, since snapshot handles role/expiry)
                           setMembershipJustApproved({ 
                             matches: true, 
                             daysLeft: daysLeftVal, 
                             name: user.displayName || 'Member' 
                           });
                       }
                    }
                 }
             } catch (e) {
                 console.error("Membership check failed", e);
             }
        }

        setLoading(false);
    });

    return () => unsubscribeSnapshot();
  }, [user]);

  const dismissItem = async (itemId: string) => {
    if (!user) return;
    try {
      const userRef = doc(db, 'users', user.uid);
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        const currentIds = snap.data().hiddenItemIds || [];
        if (!currentIds.includes(itemId)) {
          await updateDoc(userRef, {
            hiddenItemIds: [...currentIds, itemId]
          });
        }
      }
    } catch (error) {
      console.error("Failed to dismiss item:", error);
    }
  };

  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    // Simplified Login: No sensitive scopes to avoid "Unverified App" warning
    // provider.addScope('https://www.googleapis.com/auth/youtube.readonly');
    
    setLoading(true);
    try {
      const result = await signInWithPopup(auth, provider);
      
      // Fetch and Save Channel ID immediately
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const token = credential?.accessToken;
      
      if (token) {
         try {
           const channelId = await fetchMyChannelId(token);
           if (channelId) {
              const userRef = doc(db, 'users', result.user.uid);
              await setDoc(userRef, { channelId }, { merge: true });
           }
         } catch (err) {
            console.warn("Failed to fetch/save channel ID on login", err);
         }
      }

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
      window.location.reload();
    }
  };

  if (loading) return <div className="min-h-screen bg-gray-900 flex items-center justify-center text-white">Loading...</div>;

  return (
    <AuthContext.Provider value={{ user, role, expiresAt, loading, hiddenItemIds, signInWithGoogle, logout, membershipJustApproved, setMembershipJustApproved, dismissItem }}>
      {children}
    </AuthContext.Provider>
  );
};
