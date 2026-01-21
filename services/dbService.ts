import { 
  collection, 
  doc, 
  setDoc, 
  getDocs, 
  deleteDoc, 
  writeBatch,
  query,
  where,
  addDoc
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
  // Sort by createdAt desc in code or query? Query requires index. Code is safer for small sets.
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
