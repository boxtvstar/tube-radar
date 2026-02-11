import {
  collection,
  doc,
  setDoc,
  getDocs,
  getDoc, // Added Import
  onSnapshot, // Added Import
  deleteDoc,
  writeBatch,
  query,
  where,
  addDoc,
  updateDoc
} from "firebase/firestore";
import { db } from "../src/lib/firebase";
import { SavedChannel, ChannelGroup, RecommendedPackage, Notification, ApiUsage } from "../types";

// Helper function to remove undefined fields from objects (deep)
// Firestore doesn't allow undefined values, so we need to filter them out
const removeUndefinedFields = <T extends Record<string, any>>(obj: T): Partial<T> => {
  const cleaned: any = {};
  Object.keys(obj).forEach(key => {
    const value = obj[key];
    if (value === undefined) return;
    if (Array.isArray(value)) {
      cleaned[key] = value.map((item: any) =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? removeUndefinedFields(item)
          : item
      );
    } else if (value && typeof value === 'object' && !(value instanceof Date)) {
      cleaned[key] = removeUndefinedFields(value);
    } else {
      cleaned[key] = value;
    }
  });
  return cleaned;
};

export const saveChannelToDb = async (userId: string, channel: SavedChannel) => {
  const sanitizedChannel = removeUndefinedFields(channel);
  await setDoc(doc(db, "users", userId, "channels", channel.id), sanitizedChannel);
};

export const removeChannelFromDb = async (userId: string, channelId: string) => {
  await deleteDoc(doc(db, "users", userId, "channels", channelId));
};

export const getChannelsFromDb = async (userId: string): Promise<SavedChannel[]> => {
  const q = query(collection(db, "users", userId, "channels"));
  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map(doc => doc.data() as SavedChannel);
};

export const saveGroupToDb = async (userId: string, group: ChannelGroup) => {
  await setDoc(doc(db, "users", userId, "groups", group.id), group);
};

export const deleteGroupFromDb = async (userId: string, groupId: string) => {
  await deleteDoc(doc(db, "users", userId, "groups", groupId));
};

export const getGroupsFromDb = async (userId: string): Promise<ChannelGroup[]> => {
  const q = query(collection(db, "users", userId, "groups"));
  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map(doc => doc.data() as ChannelGroup);
};

// Batch operations for efficiency
export const batchSaveChannels = async (userId: string, channels: SavedChannel[]) => {
  const batch = writeBatch(db);
  channels.forEach(ch => {
    const ref = doc(db, "users", userId, "channels", ch.id);
    const sanitizedChannel = removeUndefinedFields(ch);
    batch.set(ref, sanitizedChannel);
  });
  await batch.commit();
};

// --- Recommended Packages (Admin/Public) ---

export const savePackageToDb = async (pkg: RecommendedPackage) => {
  const sanitized = removeUndefinedFields(pkg);
  await setDoc(doc(db, "recommended_packages", pkg.id), sanitized);
};

export const deletePackageFromDb = async (pkgId: string) => {
  await deleteDoc(doc(db, "recommended_packages", pkgId));
};

export const getPackagesFromDb = async (): Promise<RecommendedPackage[]> => {
  const q = query(collection(db, "recommended_packages"));
  const querySnapshot = await getDocs(q);
  return querySnapshot.docs
    .map(doc => doc.data() as RecommendedPackage)
    .sort((a, b) => b.createdAt - a.createdAt);
};

// --- Recommended Topics (New Feature) ---

export const saveTopicToDb = async (pkg: RecommendedPackage) => {
  const sanitized = removeUndefinedFields(pkg);
  await setDoc(doc(db, "recommended_topics", pkg.id), sanitized);
};

export const deleteTopicFromDb = async (pkgId: string) => {
  await deleteDoc(doc(db, "recommended_topics", pkgId));
};

export const getTopicsFromDb = async (): Promise<RecommendedPackage[]> => {
  const q = query(collection(db, "recommended_topics"));
  const querySnapshot = await getDocs(q);
  return querySnapshot.docs
    .map(doc => doc.data() as RecommendedPackage)
    .sort((a, b) => b.createdAt - a.createdAt);
};

// --- Notifications ---

export const sendNotification = async (userId: string, notification: Omit<Notification, 'id' | 'createdAt' | 'isRead'>) => {
  const id = Date.now().toString() + Math.random().toString(36).substr(2, 9);
  const newNotif: Notification = {
    id,
    createdAt: Date.now(),
    isRead: false,
    ...notification
  };
  await setDoc(doc(db, "users", userId, "notifications", newNotif.id), newNotif);
};

export const getNotifications = async (userId: string): Promise<Notification[]> => {
  const q = query(collection(db, "users", userId, "notifications"));
  const snapshot = await getDocs(q);
  return snapshot.docs
    .map(d => d.data() as Notification)
    .sort((a, b) => b.createdAt - a.createdAt);
};

export const markNotificationAsRead = async (userId: string, notificationId: string) => {
  await setDoc(doc(db, "users", userId, "notifications", notificationId), { isRead: true }, { merge: true });
};

export const deleteNotification = async (userId: string, notificationId: string) => {
  await deleteDoc(doc(db, "users", userId, "notifications", notificationId));
};



// --- Logs ---
export const logAdminMessage = async (logData: {
  recipientId: string;
  recipientName: string;
  message: string;
  adminId: string;
  type: 'individual' | 'all';
}) => {
  await addDoc(collection(db, "admin_message_logs"), {
    ...logData,
    createdAt: Date.now()
  });
};

export const getUserProposals = async (userId: string): Promise<(RecommendedPackage & { itemType: 'package' | 'topic' })[]> => {
  const packagesQuery = query(collection(db, "recommended_packages"), where("creatorId", "==", userId));
  const topicsQuery = query(collection(db, "recommended_topics"), where("creatorId", "==", userId));

  const [packagesSnapshot, topicsSnapshot] = await Promise.all([
    getDocs(packagesQuery),
    getDocs(topicsQuery)
  ]);

  const packages = packagesSnapshot.docs.map(doc => ({...doc.data() as RecommendedPackage, itemType: 'package' as const}));
  const topics = topicsSnapshot.docs.map(doc => ({...doc.data() as RecommendedPackage, itemType: 'topic' as const}));

  return [...packages, ...topics].sort((a, b) => b.createdAt - a.createdAt);
};

// --- Inquiries (Support Messages) ---

// --- Inquiries (Support Messages) ---

export const sendInquiry = async (userId: string, userName: string, content: string, userEmail?: string) => {
  await addDoc(collection(db, "inquiries"), {
    userId,
    userName,
    userEmail: userEmail || null,
    content, // Standardized field name
    createdAt: Date.now(),
    isAnswered: false,
    type: 'general'
  });
};

export const getInquiries = async () => {
  const q = query(collection(db, "inquiries"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a: any, b: any) => b.createdAt - a.createdAt);
};

export const getUserInquiries = async (userId: string) => {
  const q = query(collection(db, "inquiries"), where("userId", "==", userId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a: any, b: any) => b.createdAt - a.createdAt);
};

export const replyToInquiry = async (inquiryId: string, userId: string, answer: string) => {
  // 1. Update Inquiry Doc with Answer
  try {
    const docRef = doc(db, "inquiries", inquiryId);
    
    // Check if doc exists first to prevent errors
    const snap = await getDoc(docRef);
    if (!snap.exists()) throw new Error("Inquiry document not found");

    await updateDoc(docRef, {
      isAnswered: true,
      answer,
      answeredAt: Date.now()
    });

    // 2. Send Notification
    await sendNotification(userId, {
      userId, 
      title: "문의에 대한 답변이 도착했습니다",
      message: "1:1 문의하기 탭에서 관리자의 답변을 확인하세요.",
      type: "info"
    });
  } catch (e) {
    console.error("Reply failed in dbService:", e);
    throw e;
  }
};

// --- Membership Whitelist (Auto-Approval) ---
// Save updated channel IDs to a designated document in 'system_data' collection
export const saveWhitelist = async (memberIds: string[]) => {
  // We overwrite the entire list. Using a single doc for simplicity.
  // Assuming member list < 1MB (approx 50,000 IDs). If more, need sharding.
  await setDoc(doc(db, "system_data", "membership_whitelist"), {
    validChannelIds: memberIds,
    updatedAt: new Date().toISOString()
  });
};

// Check if a specific channel ID exists in the whitelist
export const checkWhitelist = async (channelId: string): Promise<boolean> => {
  if (!channelId) return false;
  try {
    const snap = await getDoc(doc(db, "system_data", "membership_whitelist"));
    if (snap.exists()) {
      const data = snap.data();
      return data.validChannelIds?.includes(channelId) || false;
    }
    return false;
  } catch (e) {
    console.error("Whitelist check failed", e);
    return false;
  }
};
// --- Usage Persistence (Points) ---

const getQuotaResetTime = (): Date => {
  const now = new Date();
  const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const todayReset = new Date(kst);
  todayReset.setHours(17, 0, 0, 0);
  if (kst < todayReset) {
    todayReset.setDate(todayReset.getDate() - 1);
  }
  return todayReset;
};

const getServiceDate = (): string => {
  // Returns YYYY-MM-DD of the current "service day" (starts at 5PM KST previous day?)
  // Actually, "reset at 5PM KST" means:
  // After 5PM KST on May 21st, it is considered "May 21st cycle" (or 22nd?).
  // Let's stick to the reset timestamp comparison.
  // The daily doc will store the `lastResetTime` (ISO string) closest to valid cycle.
  // If `storedResetTime` < `currentResetTime`, it means we entered a new cycle.
  return getQuotaResetTime().toISOString();
};

export const getUsageFromDb = async (userId: string, plan: string = 'general'): Promise<ApiUsage> => {
  const docRef = doc(db, "users", userId, "usage", "daily");
  const snap = await getDoc(docRef);
  
  // Determine Total based on Plan
  let total = 1000; // Default/General
  if (plan === 'silver') total = 2000;
  if (plan === 'gold') total = 5000;
  if (plan === 'admin') total = 10000;

  const currentResetTime = getQuotaResetTime();
  const defaultUsage: ApiUsage = {
    total,
    used: 0,
    lastReset: currentResetTime.toISOString(),
    details: { search: 0, list: 0, script: 0 },
    logs: []
  };

  if (!snap.exists()) {
    return defaultUsage;
  }

  const data = snap.data() as ApiUsage;
  const lastReset = new Date(data.lastReset);

  // If stored data is from a previous cycle, return empty (and UI will treat as fresh)
  // We don't necessarily need to write to DB here, we can wait for first update.
  // But returning fresh structure is important.
  if (lastReset < currentResetTime) {
    return defaultUsage;
  }

  // Ensure total reflects current plan (in case plan changed)
  return { ...data, total }; // Override total with current plan limit
};

// Real-time Usage Subscription
export const subscribeToUsage = (userId: string, plan: string, callback: (usage: ApiUsage) => void) => {
  const docRef = doc(db, "users", userId, "usage", "daily");
  const currentResetTime = getQuotaResetTime();

  // Determine Total based on Plan
  let total = 1000; // Default/General
  if (plan === 'silver') total = 2000;
  if (plan === 'gold') total = 5000;
  if (plan === 'admin') total = 10000;

  const defaultUsage: ApiUsage = {
    total,
    used: 0,
    lastReset: currentResetTime.toISOString(),
    details: { search: 0, list: 0, script: 0 },
    logs: []
  };

  return onSnapshot(docRef, (snap) => {
    if (!snap.exists()) {
      callback(defaultUsage);
      return;
    }

    const data = snap.data() as ApiUsage;
    const lastReset = new Date(data.lastReset);

    // If stored data is from a previous cycle, return empty (and UI will treat as fresh)
    if (lastReset < currentResetTime) {
      callback(defaultUsage);
    } else {
      // Ensure total reflects current plan
      callback({ ...data, total });
    }
  }, (error) => {
      console.error("Usage subscription error:", error);
  });
};

export const updateUsageInDb = async (userId: string, plan: string | undefined, cost: number, type: 'search' | 'list' | 'script', details: string): Promise<ApiUsage> => {
  const docRef = doc(db, "users", userId, "usage", "daily");
  const currentResetTime = getQuotaResetTime();
  
  // Determine Limit
  let limit = 1000;
  if (plan) {
      if (plan === 'silver') limit = 2000;
      if (plan === 'gold') limit = 5000;
      if (plan === 'admin') limit = 10000;
  } else {
      // Fetch user role if plan not provided (likely called from usageService)
      try {
         const userSnap = await getDoc(doc(db, "users", userId));
         if (userSnap.exists()) {
            const role = userSnap.data().role;
            if (role === 'regular') limit = 2000;
            else if (role === 'pro') limit = 5000;
            else if (role === 'admin') limit = 10000;
         }
      } catch (e) {
         // Default 1000
      }
  }

  // Read-Modify-Write (simplified transaction)
  const snap = await getDoc(docRef);
  let usage: ApiUsage;

  if (snap.exists()) {
    usage = snap.data() as ApiUsage;
    const lastReset = new Date(usage.lastReset);
    
    // Reset if stale
    if (lastReset < currentResetTime) {
      usage = {
         total: limit,
         used: 0,
         lastReset: currentResetTime.toISOString(),
         details: { search: 0, list: 0, script: 0 },
         logs: []
      };
    }
  } else {
    usage = {
      total: limit,
      used: 0,
      lastReset: currentResetTime.toISOString(),
      details: { search: 0, list: 0, script: 0 },
      logs: []
    };
  }

  // Check Quota
  if (usage.used + cost > limit) {
    throw new Error('Quota Exceeded');
  }

  // Update
  usage.used += cost;
  usage.total = limit; // Update limit in case plan changed
  
  if (type === 'search') usage.details.search += cost;
  else if (type === 'list') usage.details.list += cost;
  else if (type === 'script') usage.details.script = (usage.details.script || 0) + cost;

  // Add Log (Max 50)
  const newLog = {
    timestamp: new Date().toISOString(),
    type,
    cost,
    details
  };
  
  // Dedup logic (optional, keep simple for DB)
  usage.logs = [newLog, ...(usage.logs || [])].slice(0, 50);

  // Save
  await setDoc(docRef, usage);
  return usage;
};
