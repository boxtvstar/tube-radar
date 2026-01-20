import { 
  collection, 
  doc, 
  setDoc, 
  getDocs, 
  deleteDoc, 
  writeBatch,
  query,
  where
} from "firebase/firestore";
import { db } from "../src/lib/firebase";
import { SavedChannel, ChannelGroup } from "../types";

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
