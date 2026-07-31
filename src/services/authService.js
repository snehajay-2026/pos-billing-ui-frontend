import { apiGet, apiPost, setCsrfToken, clearCsrfToken } from "./api";
import { resetStoreSettingsCache } from "./storeSettingsService";

let currentUser = undefined;

const setCurrentUser = (user) => {
  currentUser = user;
  window.__CURRENT_USER__ = user;
  window.dispatchEvent(new CustomEvent("authChanged", { detail: user }));
  return user;
};

export const getCurrentUser = () => currentUser;
export const isAuthLoading = () => currentUser === undefined;

export const loadCurrentUser = async () => {
  try {
    // /api/auth/user echoes a fresh CSRF token on every response. Capture
    // it so any tab that re-validates the session (cookie still valid,
    // but sessionStorage was empty after a hard refresh or new tab)
    // has a valid token to send on the next POST.
    const response = await apiGet("/api/auth/user");
    if (response && typeof response.csrfToken === "string") {
      setCsrfToken(response.csrfToken);
    }
    const user = response && response.csrfToken ? { ...response, csrfToken: undefined } : response;
    return setCurrentUser(user || null);
  } catch (err) {
    setCurrentUser(null);
    return null;
  }
};

export const canRegister = async () => {
  try {
    return await apiGet("/api/register/available");
  } catch (err) {
    return { available: false, isFirstUser: false };
  }
};

export const login = async (email, password) => {
  const response = await apiPost("/api/login", { email, password });
  // The backend echoes a freshly-minted CSRF token in the login JSON so
  // cross-origin frontends (Vercel -> Render) can pick it up — document
  // .cookie can't see the backend's Set-Cookie across origins.
  if (response && typeof response.csrfToken === "string") {
    setCsrfToken(response.csrfToken);
  }
  const user = response && response.csrfToken ? { ...response, csrfToken: undefined } : response;
  return setCurrentUser(user || null);
};

export const register = async (registration) => {
  return apiPost("/api/register", registration);
};

export const logout = async () => {
  try {
    await apiPost("/api/logout", {});
  } catch (err) {
    console.warn("Logout request failed", err);
  }
  clearCsrfToken();
  resetStoreSettingsCache();
  return setCurrentUser(null);
};

export const requestPasswordReset = async (email) => {
  return apiPost("/api/password-reset/request", { email });
};

export const confirmPasswordReset = async (email, token, password) => {
  return apiPost("/api/password-reset/confirm", { email, token, password });
};

export const updateCurrentUser = (updates) => {
  const user = getCurrentUser();
  const nextUser = user ? { ...user, ...updates } : null;
  return setCurrentUser(nextUser);
};
