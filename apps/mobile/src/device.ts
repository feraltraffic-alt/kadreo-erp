import AsyncStorage from "@react-native-async-storage/async-storage";
import { ApiError, type ClockInput, type MobileApi, type MobileSiteRules } from "@kadreo/domain";
import * as Crypto from "expo-crypto";
import * as Location from "expo-location";
import { useEffect, useState } from "react";
import { isDemo } from "./session";

/* ------------------------------------------------------------------- clock */

let offsetMs = 0;
const clockListeners = new Set<() => void>();
/** Keeps the app's clock on the server's (the demo server runs on a fixed morning). */
export function syncServerTime(serverIso: string) {
  const next = new Date(serverIso).getTime() - Date.now();
  if (Math.abs(next - offsetMs) < 1500) return;
  offsetMs = next;
  clockListeners.forEach((l) => l());
}
/** Now for display and, in the demo, for the device time sent with a clock-in. */
export function now(): Date {
  return new Date(Date.now() + offsetMs);
}
/** Device time for clock events: the real device clock in production (skew is checked by the server). */
export function deviceTime(): string {
  return (isDemo ? now() : new Date()).toISOString();
}

export function useNow(intervalMs = 1000): Date {
  const [t, setT] = useState(now());
  useEffect(() => {
    const tick = () => setT(now());
    const h = setInterval(tick, intervalMs);
    clockListeners.add(tick);
    return () => {
      clearInterval(h);
      clockListeners.delete(tick);
    };
  }, [intervalMs]);
  return t;
}

export const newKey = () => Crypto.randomUUID();

/* ------------------------------------------------------- demo device settings */

type GpsMode = "inside" | "outside" | "unavailable";
interface DemoDevice {
  gps: GpsMode;
  offline: boolean;
}
const demo: DemoDevice = { gps: "inside", offline: false };
const listeners = new Set<() => void>();
export function setDemoDevice(patch: Partial<DemoDevice>) {
  Object.assign(demo, patch);
  listeners.forEach((l) => l());
}
export function useDemoDevice(): DemoDevice {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((x) => x + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return demo;
}
export const isOfflineSimulated = () => demo.offline;

/* --------------------------------------------------------------- geolocation */

export interface Fix {
  lat: number;
  lng: number;
  accuracyM: number;
}

/** One position fix within 15 s (14.1 step 3). No continuous tracking (7.4). */
export async function getFix(site: MobileSiteRules): Promise<Fix | null> {
  if (isDemo) {
    await new Promise((r) => setTimeout(r, 350));
    if (demo.gps === "unavailable") return null;
    // Inside: a few metres off the site point; outside: about 1.2 km north-east.
    return demo.gps === "inside" ? { lat: site.lat + 0.0002, lng: site.lng - 0.0001, accuracyM: 18 } : { lat: site.lat + 0.008, lng: site.lng + 0.009, accuracyM: 24 };
  }
  const perm = await Location.requestForegroundPermissionsAsync();
  if (perm.status !== "granted") return null;
  try {
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 15000)),
    ]);
    return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: Math.round(pos.coords.accuracy ?? 999) };
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------- offline queue */

/**
 * Clock events recorded without network (7.6): kept on the device and sent when the network is
 * back, with the original device time and offline=true. WatermelonDB replaces this in R2.
 */
const QUEUE_KEY = "kadreo.mobile.clock-queue";
let queue: ClockInput[] = [];
const queueListeners = new Set<() => void>();
let loaded = false;

async function persist() {
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    /* ignore */
  }
  queueListeners.forEach((l) => l());
}
async function loadQueue() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (raw) queue = JSON.parse(raw);
  } catch {
    /* ignore */
  }
  queueListeners.forEach((l) => l());
}

export function enqueue(input: ClockInput) {
  queue = [...queue, { ...input, offline: true }];
  void persist();
}

export function useQueue(): ClockInput[] {
  const [, force] = useState(0);
  useEffect(() => {
    void loadQueue();
    const l = () => force((x) => x + 1);
    queueListeners.add(l);
    return () => void queueListeners.delete(l);
  }, []);
  return queue;
}

export function isNetworkError(e: unknown): boolean {
  return !(e instanceof ApiError);
}

/** Sends queued events in order; stops at the first network error. Returns how many were sent. */
export async function flushQueue(api: MobileApi): Promise<number> {
  let sent = 0;
  while (queue.length && !demo.offline) {
    const next = queue[0]!;
    try {
      await api.clock(next);
    } catch (e) {
      if (isNetworkError(e)) break;
      // Rejected by the server: dropped from the queue; the worker sees it under «Проблемы с отметкой».
    }
    queue = queue.slice(1);
    sent++;
    await persist();
  }
  return sent;
}
