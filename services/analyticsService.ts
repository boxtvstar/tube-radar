import { addDoc, collection, doc, increment, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../src/lib/firebase";

const ANON_ID_KEY = "tube_radar_anon_id";

const getAnonId = (): string => {
  const existing = localStorage.getItem(ANON_ID_KEY);
  if (existing) return existing;
  const created = `anon_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(ANON_ID_KEY, created);
  return created;
};

export const createAnalyticsSession = async (params: {
  userId?: string | null;
  role?: string | null;
  plan?: string | null;
  page: string;
}): Promise<string | null> => {
  try {
    const sessionId = `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const anonId = getAnonId();
    const now = Date.now();

    await setDoc(doc(db, "analytics_sessions", sessionId), {
      sessionId,
      anonId,
      userId: params.userId || null,
      role: params.role || null,
      plan: params.plan || null,
      startedAt: now,
      lastSeenAt: now,
      durationSec: 0,
      pageViews: 1,
      lastPage: params.page,
      userAgent: navigator.userAgent?.slice(0, 300) || "",
      locale: navigator.language || "",
      referrer: document.referrer || ""
    });

    await addDoc(collection(db, "analytics_pageviews"), {
      sessionId,
      anonId,
      userId: params.userId || null,
      page: params.page,
      at: now
    });

    return sessionId;
  } catch (error) {
    console.warn("Failed to create analytics session", error);
    return null;
  }
};

export const heartbeatAnalyticsSession = async (
  sessionId: string,
  seconds: number,
  page: string
) => {
  try {
    await updateDoc(doc(db, "analytics_sessions", sessionId), {
      lastSeenAt: Date.now(),
      durationSec: increment(Math.max(0, seconds)),
      lastPage: page
    });
  } catch (error) {
    console.warn("Analytics heartbeat failed", error);
  }
};

export const trackAnalyticsPageView = async (sessionId: string, params: { page: string; userId?: string | null }) => {
  try {
    const anonId = getAnonId();
    const now = Date.now();
    await updateDoc(doc(db, "analytics_sessions", sessionId), {
      lastSeenAt: now,
      lastPage: params.page,
      pageViews: increment(1)
    });
    await addDoc(collection(db, "analytics_pageviews"), {
      sessionId,
      anonId,
      userId: params.userId || null,
      page: params.page,
      at: now
    });
  } catch (error) {
    console.warn("Analytics page view tracking failed", error);
  }
};
