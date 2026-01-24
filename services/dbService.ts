import { 
  collection, 
  doc, 
  setDoc, 
  getDocs, 
  getDoc, // Added Import
  deleteDoc, 
  writeBatch,
  query,
  where,
  addDoc,
  updateDoc
} from "firebase/firestore";
import { db } from "../src/lib/firebase";
import { SavedChannel, ChannelGroup, RecommendedPackage, Notification } from "../types";

export const saveChannelToDb = async (userId: string, channel: SavedChannel) => {
  await setDoc(doc(db, "users", userId, "channels", channel.id), channel);
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
    batch.set(ref, ch);
  });
  await batch.commit();
};

// --- Recommended Packages (Admin/Public) ---

export const savePackageToDb = async (pkg: RecommendedPackage) => {
  await setDoc(doc(db, "recommended_packages", pkg.id), pkg);
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
  await setDoc(doc(db, "recommended_topics", pkg.id), pkg);
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

export const sendInquiry = async (userId: string, userName: string, message: string) => {
  await addDoc(collection(db, "inquiries"), {
    userId,
    userName,
    message,
    createdAt: Date.now(),
    isAnswered: false
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
  await updateDoc(doc(db, "inquiries", inquiryId), {
    isAnswered: true,
    answer,
    answeredAt: Date.now()
  });

  // 2. Send Notification
  await sendNotification(userId, {
    userId, // Redundant in Notification type but required by interface
    title: "문의에 대한 답변이 도착했습니다",
    message: "1:1 문의하기 탭에서 관리자의 답변을 확인하세요.",
    type: "info"
  });
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
