import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { fetchMyChannelId } from '../../services/youtubeService';
import {
  MembershipStatus,
  deriveStatusFromLegacy,
  getDailyPointLimit,
  getEffectiveStatus,
  getLegacyPlanFromStatus,
  getLegacyRoleFromStatus,
  resolveStatusFromTier
} from '../lib/membership';

export type UserRole = 'admin' | 'approved' | 'pending' | 'regular' | 'pro' | 'guest';

interface AuthContextType {
  user: User | null;
  status: MembershipStatus | null;
  role: UserRole | null;
  plan: string | null;
  membershipTier: string | null;
  expiresAt: string | null;
  trialStatus: 'active' | 'expired' | 'converted' | null;
  trialExpiresAt: string | null;
  trialUsed: boolean;
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
  const [status, setStatus] = useState<MembershipStatus | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [plan, setPlan] = useState<string | null>(null);
  const [membershipTier, setMembershipTier] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [trialStatus, setTrialStatus] = useState<'active' | 'expired' | 'converted' | null>(null);
  const [trialExpiresAt, setTrialExpiresAt] = useState<string | null>(null);
  const [trialUsed, setTrialUsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hiddenItemIds, setHiddenItemIds] = useState<string[]>([]);
  const [membershipJustApproved, setMembershipJustApproved] = useState<{ matches: boolean; daysLeft: number; name: string; plan?: string; limit?: number } | null>(null);

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (!currentUser) {
        setStatus(null);
        setRole(null);
        setPlan(null);
        setMembershipTier(null);
        setExpiresAt(null);
        setTrialStatus(null);
        setTrialExpiresAt(null);
        setTrialUsed(false);
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
            status: 'pending',
            role: 'pending',
            createdAt: new Date().toISOString(),
            lastLoginAt: new Date().toISOString(),
            expiresAt: null,
            plan: 'free',
            channelId: null,
            trialStatus: null,
            trialExpiresAt: null,
            trialStartedAt: null,
            trialUsed: false,
            trialSource: null
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
        const currentTrialStatus = data.trialStatus || null;
        const currentTrialExpiresAt = data.trialExpiresAt || null;
        const currentTrialUsed = !!data.trialUsed;
        const currentHiddenItemIds = data.hiddenItemIds || [];
        let nextStatus = deriveStatusFromLegacy(data);
        let effectiveTier = currentTier;
        let effectiveExpiresAt = currentExpiresAt || null;
        const trialExpiryTime = currentTrialExpiresAt ? new Date(currentTrialExpiresAt).getTime() : 0;
        const effectiveStatusNow = getEffectiveStatus(nextStatus, user.email);
        const hasActiveTrial = nextStatus === 'trial' && trialExpiryTime > Date.now();

        if (effectiveStatusNow !== 'admin' && nextStatus === 'trial' && currentTrialExpiresAt && trialExpiryTime <= Date.now()) {
          try {
            await updateDoc(userRef, {
              status: 'pending',
              role: 'pending',
              plan: 'free',
              membershipTier: null,
              expiresAt: null,
              trialStatus: 'expired'
            });
            try {
              const { addDoc, collection } = await import('firebase/firestore');
              await addDoc(collection(db, 'users', user.uid, 'history'), {
                action: 'trial_expired',
                details: '3일 무료 체험 종료',
                date: new Date().toISOString()
              });
            } catch (e) {}
          } catch (e) {
            console.error('Trial expiry update failed', e);
          }
          nextStatus = 'pending';
          effectiveTier = null;
          effectiveExpiresAt = null;
        } else if (effectiveStatusNow !== 'admin' && hasActiveTrial) {
          nextStatus = 'trial';
          effectiveTier = null;
          effectiveExpiresAt = currentTrialExpiresAt;
        }
        
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
                       const currentPlanSafe = currentPlan || 'free';
                       const resolvedStatus = resolveStatusFromTier(match.tier);
                       const fallbackStatus =
                         nextStatus === 'silver' || nextStatus === 'gold' || nextStatus === 'platinum'
                           ? nextStatus
                           : 'silver';
                       const targetStatus = resolvedStatus || fallbackStatus;
                       const targetPlan = getLegacyPlanFromStatus(targetStatus);

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
                       const finalRole = getLegacyRoleFromStatus(targetStatus, user.email);

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

                                setMembershipJustApproved({
                                    matches: true,
                                    daysLeft: daysLeftVal,
                                    name: user.displayName || 'Member',
                                    plan: targetPlan,
                                    limit: getDailyPointLimit(targetStatus)
                                });
                                sessionStorage.setItem(popupKey, 'true');
                             }

                             // Update DB if: Role changed, Plan changed, OR Expiry extended
                             if (data.status !== targetStatus || finalRole !== currentRole || currentPlanSafe !== targetPlan || expiryTime > (currentExpiryTime + 86400000)) {
                                  await updateDoc(userRef, {
                                      status: targetStatus,
                                      role: finalRole,
                                      plan: targetPlan,
                                      membershipTier: match.tier,
                                      expiresAt: newExpiry,
                                      lastUpdate: new Date().toISOString(),
                                      trialStatus: currentTrialStatus === 'active' ? 'converted' : currentTrialStatus
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
                                     if (currentTrialStatus === 'active') {
                                        await addDoc(collection(db, 'users', user.uid, 'history'), {
                                          action: 'trial_converted',
                                          details: `무료 체험 중 정식 멤버십 전환 (${match.tier})`,
                                          date: new Date().toISOString()
                                        });
                                     }
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
                             nextStatus = targetStatus;
                             effectiveTier = match.tier || null;
                             effectiveExpiresAt = newExpiry;
                    } else {
                       // Whitelist에서 제거된 경우: 유료 등급 사용자를 pending으로 다운그레이드
                       if ((nextStatus === 'silver' || nextStatus === 'gold' || nextStatus === 'platinum') && !hasActiveTrial) {
                          await updateDoc(userRef, {
                             status: 'pending',
                             role: 'pending',
                             plan: 'free',
                             membershipTier: null,
                             expiresAt: null,
                          });
                          try {
                             const { addDoc, collection } = await import('firebase/firestore');
                             await addDoc(collection(db, 'users', user.uid, 'history'), {
                                action: 'membership_revoked',
                                details: `화이트리스트에서 제거됨 (ID: ${storedChannelId})`,
                                date: new Date().toISOString(),
                             });
                          } catch(e) {}
                          nextStatus = 'pending';
                          effectiveTier = null;
                          effectiveExpiresAt = null;
                       }
                    }
                 }
             } catch (e) {
                 console.error("Membership check failed", e);
             }
        }

        const effectiveStatus = getEffectiveStatus(nextStatus, user.email);
        const legacyRole = effectiveStatus === 'admin' ? 'admin' : getLegacyRoleFromStatus(nextStatus, user.email);
        const legacyPlan = effectiveStatus === 'admin' ? 'admin' : getLegacyPlanFromStatus(nextStatus);

        if (
          data.status !== nextStatus ||
          (effectiveStatus !== 'admin' && currentRole !== legacyRole) ||
          (effectiveStatus !== 'admin' && currentPlan !== legacyPlan)
        ) {
          try {
            await updateDoc(userRef, {
              status: nextStatus,
              ...(effectiveStatus === 'admin' ? {} : { role: legacyRole, plan: legacyPlan })
            });
          } catch (e) {
            console.error('Status migration sync failed', e);
          }
        }

        setStatus(nextStatus);
        setRole(legacyRole);
        setPlan(legacyPlan);
        setMembershipTier(effectiveTier);
        setExpiresAt(effectiveExpiresAt);
        setTrialStatus(currentTrialStatus);
        setTrialExpiresAt(currentTrialExpiresAt || null);
        setTrialUsed(currentTrialUsed);
        setHiddenItemIds(currentHiddenItemIds);

        setLoading(false);
    });

    return () => unsubscribeSnapshot();
  }, [user]);

  useEffect(() => {
    if (!user || status !== 'trial' || !trialExpiresAt) return;

    const expireAt = new Date(trialExpiresAt).getTime();
    const remainingMs = expireAt - Date.now();
    const userRef = doc(db, 'users', user.uid);

    const expireTrial = async () => {
      try {
        const snap = await getDoc(userRef);
        if (!snap.exists()) return;
        const data = snap.data();
        if (getEffectiveStatus(deriveStatusFromLegacy(data), user.email) === 'admin' || deriveStatusFromLegacy(data) !== 'trial') return;

        await updateDoc(userRef, {
          status: 'pending',
          role: 'pending',
          plan: 'free',
          membershipTier: null,
          expiresAt: null,
          trialStatus: 'expired'
        });

        try {
          const { addDoc, collection } = await import('firebase/firestore');
          await addDoc(collection(db, 'users', user.uid, 'history'), {
            action: 'trial_expired',
            details: '3일 무료 체험 종료',
            date: new Date().toISOString()
          });
        } catch (e) {}
      } catch (error) {
        console.error('Scheduled trial expiry failed', error);
      }
    };

    if (remainingMs <= 0) {
      void expireTrial();
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void expireTrial();
    }, remainingMs + 1000);

    return () => window.clearTimeout(timeoutId);
  }, [user, status, trialExpiresAt]);

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
    <AuthContext.Provider value={{ user, status, role, plan, membershipTier, expiresAt, trialStatus, trialExpiresAt, trialUsed, loading, hiddenItemIds, signInWithGoogle, logout, membershipJustApproved, setMembershipJustApproved, dismissItem }}>
      {children}
    </AuthContext.Provider>
  );
};
