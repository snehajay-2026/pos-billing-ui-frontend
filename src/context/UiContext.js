import { createContext, useContext, useEffect, useState } from "react";
import { locales, languageOptions } from "../locales";
import { getActiveStoreContext } from "../utils/auth";

const UiContext = createContext();

const getInitialLanguage = () => {
  const savedLanguage = localStorage.getItem("appLanguage");
  if (savedLanguage && locales[savedLanguage]) {
    return savedLanguage;
  }
  return "en";
};

export const UiProvider = ({ children }) => {
  const [posMode, setPosMode] = useState(false);
  const [language, setLanguage] = useState(getInitialLanguage);
  const [toasts, setToasts] = useState([]);
  const [activeStore, setActiveStore] = useState(() => {
    try {
      return getActiveStoreContext();
    } catch {
      return null;
    }
  });

  const showToast = (type, text, timeout = 4000) => {
    const id = `t_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const t = { id, type, text };
    setToasts((s) => [...s, t]);
    if (timeout > 0) {
      setTimeout(() => {
        setToasts((s) => s.filter((x) => x.id !== id));
      }, timeout);
    }
    return id;
  };

  const removeToast = (id) => setToasts((s) => s.filter((x) => x.id !== id));

  useEffect(() => {
    localStorage.setItem("appLanguage", language);
  }, [language]);

  useEffect(() => {
    const onActiveStoreChanged = (e) => {
      try {
        setActiveStore(e?.detail || null);
      } catch {
        setActiveStore(null);
      }
    };
    window.addEventListener("activeStoreChanged", onActiveStoreChanged);
    return () => window.removeEventListener("activeStoreChanged", onActiveStoreChanged);
  }, []);

  const locale = locales[language] || locales.en;

  return (
    <UiContext.Provider
      value={{
        posMode,
        setPosMode,
        activeStore,
        language,
        setLanguage,
        locale,
        languageOptions,
        toasts,
        showToast,
        removeToast,
      }}
    >
      {children}
    </UiContext.Provider>
  );
};

export const useUi = () => useContext(UiContext);
