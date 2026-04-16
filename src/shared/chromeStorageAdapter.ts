import type { StorageLike } from "./storage.js";

export const chromeStorageAdapter: StorageLike = {
  async get<T>(key: string): Promise<T | undefined> {
    const data = await chrome.storage.local.get(key);
    return data[key] as T | undefined;
  },

  async set<T>(key: string, value: T): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  }
};