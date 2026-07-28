export const persistWaitingQueue = (queue, storageKey = "hotel_lodging_waiting_list") => {
  const normalizedQueue = Array.isArray(queue) ? queue : [];

  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(normalizedQueue));
    } catch (error) {
      // ignore storage write failures
    }
  }

  return normalizedQueue;
};
