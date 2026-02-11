import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { fetchMyChannelId } from '../../services/youtubeService';

export type UserRole = 'admin' | 'approved' | 'pending' | 'regular' | 'pro' | 'guest';

interface AuthContextType {
  user: User | null;
  role: UserRole | null;
  plan: string | null;
  membershipTier: string | null;
  expiresAt: string | null;
  loading: boolean;
  hiddenItemIds: string[];
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  membershipJustApproved: { matches: boolean; daysLeft: number; name: string; plan?: string; limit?: number } | null;
  setMembershipJustApproved: (val: { matches: boolean; daysLeft: number; name: string; plan?: string; limit?: number } | null) => void;
  dismissItem: (itemId: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [plan, setPlan] = useState<string | null>(null);
  const [membershipTier, setMembershipTier] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hiddenItemIds, setHiddenItemIds] = useState<string[]>([]);
  const [membershipJustApproved, setMembershipJustApproved] = useState<{ matches: boolean; daysLeft: number; name: string; plan?: string; limit?: number } | null>(null);

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (!currentUser) {
        setRole(null);
        setPlan(null);
        setMembershipTier(null);
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
        const currentTier = data.membershipTier || null;
        const storedChannelId = data.channelId;
        const currentExpiresAt = data.expiresAt;
        const currentHiddenItemIds = data.hiddenItemIds || [];

        setRole(currentRole);
        setPlan(currentPlan);
        setMembershipTier(currentTier);
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
                       // Determine Target Plan/Role based on Tier
                       // Role is always 'approved' for members. Separation is via 'plan'.
                       let targetRole: UserRole = 'approved';
                       let targetPlan = 'free';

                       const tier = (match.tier || '').toLowerCase();
                       if (tier.includes('gold') || tier.includes('pro') || tier.includes('골드')) {
                           targetPlan = 'gold'; // Gold Plan
                       }
                       else if (tier.includes('silver') || tier.includes('regular') || tier.includes('실버')) {
                           targetPlan = 'silver'; // Silver Plan
                       }
                       
                       // LOGIC: Calculate Expiry
                       let newExpiry = '';
                       const now = new Date(); 

                       // 1. Explicit 'remainingDays'
                       if (match.remainingDays) {
                           const parsedDays = parseInt(String(match.remainingDays).replace(/[^0-9]/g, ''));
                           if (!isNaN(parsedDays)) {
                              const exp = new Date(now.getTime() + parsedDays * 24 * 60 * 60 * 1000);
                              newExpiry = exp.toISOString();
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
                           const exp = new Date(baseDate.getTime() + 32 * 24 * 60 * 60 * 1000);
                           newExpiry = exp.toISOString();
                       }

                       const expiryTime = new Date(newExpiry).getTime();
                       const currentExpiryTime = currentExpiresAt ? new Date(currentExpiresAt).getTime() : 0;
                       
                       // Conditions to Update
                       const finalRole = currentRole === 'admin' ? 'admin' : targetRole;
                       const currentPlanSafe = currentPlan || 'free';

                             // Check for Popup Trigger (Session based)
                             // Show if: New upgrade/change OR First time seen in this session
                             const popupKey = `membership_welcome_${user.uid}_${targetPlan}_${finalRole}`;
                             const hasShown = sessionStorage.getItem(popupKey);
                             
                             // Logic:
                             // 1. If Update Needed (Change detected) -> Show (unless suppressed)
                             // 2. OR If Valid Member & Not Shown in Session -> Show
                             // We unify this: If (Valid Member) AND (!hasShown), Show.
                             
                             if (!hasShown) {
                                const diffInMs = expiryTime - new Date().getTime();
                                const daysLeftVal = Math.max(Math.ceil(diffInMs / (1000 * 60 * 60 * 24)), 0);
                                
                                let limit = 1000;
                                if (targetPlan === 'silver') limit = 2000;
                                if (targetPlan === 'gold') limit = 5000;
                                if (finalRole === 'admin') limit = 10000;

                                setMembershipJustApproved({ 
                                    matches: true, 
                                    daysLeft: daysLeftVal, 
                                    name: user.displayName || 'Member',
                                    plan: targetPlan,
                                    limit: limit
                                });
                                sessionStorage.setItem(popupKey, 'true');
                             }

                             // Update DB if: Role changed, Plan changed, OR Expiry extended
                             if (finalRole !== currentRole || currentPlanSafe !== targetPlan || expiryTime > (currentExpiryTime + 86400000)) {
                                  await updateDoc(userRef, {
                                      role: finalRole,
                                      plan: targetPlan,
                                      membershipTier: match.tier,
                                      expiresAt: newExpiry,
                                      lastUpdate: new Date().toISOString()
                                  });
                                  
                                  // Log History
                                  try {
                                     const { addDoc, collection } = await import('firebase/firestore');
                                     await addDoc(collection(db, 'users', user.uid, 'history'), {
                                        action: 'membership_sync',
                                        details: `Membership synced via Whitelist (ID: ${storedChannelId}). Tier: ${match.tier} -> Plan: ${targetPlan}`,
                                        date: new Date().toISOString(),
                                        previousExpiry: currentExpiresAt,
                                        newExpiry: newExpiry
                                     });
                                  } catch(e) {}

                                  // Notify Admin of New Approval or Upgrade
                                  try {
                                     const { query, where, getDocs, collection } = await import('firebase/firestore');
                                     const { sendNotification } = await import('../../services/dbService');
                                     
                                     // Get all admin users
                                     const adminQuery = query(collection(db, 'users'), where('role', '==', 'admin'));
                                     const adminSnapshot = await getDocs(adminQuery);
                                     
                                     const isNewApproval = currentRole === 'pending';
                                     const isUpgrade = currentRole === 'approved' && currentPlanSafe !== targetPlan;
                                     
                                     let notificationMessage = '';
                                     if (isNewApproval) {
                                        notificationMessage = `새로운 회원이 승인되었습니다: ${user.displayName || user.email} (${match.tier})`;
                                     } else if (isUpgrade) {
                                        notificationMessage = `회원 등급이 변경되었습니다: ${user.displayName || user.email} (${currentPlanSafe} → ${targetPlan})`;
                                     }
                                     
                                     if (notificationMessage) {
                                        // Send notification to each admin
                                        for (const adminDoc of adminSnapshot.docs) {
                                           await sendNotification(adminDoc.id, {
                                              userId: adminDoc.id,
                                              title: isNewApproval ? '새 회원 승인' : '회원 등급 변경',
                                              message: notificationMessage,
                                              type: 'info'
                                           });
                                        }
                                     }
                                  } catch(e) {
                                     console.error('Failed to notify admin:', e);
                                  }
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
    <AuthContext.Provider value={{ user, role, plan, membershipTier, expiresAt, loading, hiddenItemIds, signInWithGoogle, logout, membershipJustApproved, setMembershipJustApproved, dismissItem }}>
      {children}
    </AuthContext.Provider>
  );
};
