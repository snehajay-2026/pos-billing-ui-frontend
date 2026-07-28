import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  FaComments,
  FaRobot,
  FaUserTie,
  FaPaperPlane,
  FaTimes,
  FaBolt,
  FaChartLine,
  FaBoxes,
  FaCog,
  FaCashRegister,
  FaBed,
  FaUtensils,
  FaChair,
  FaBroom,
  FaFileInvoice,
  FaArrowRight,
  FaMinus,
  FaExpand,
  FaRedo,
  FaTrash,
  FaGlobe,
  FaHistory,
  FaShieldAlt,
  FaCircle,
  FaListUl,
  FaConciergeBell,
  FaBoxOpen,
  FaTags,
  FaStore,
  FaShippingFast,
  FaPercent,
} from "react-icons/fa";
import { useUi } from "../../context/UiContext";
import { locales } from "../../locales";
import { getAiAssistantReply } from "../../services/aiAssistantService";
import { getInvoices } from "../../services/invoiceService";
import { getProducts } from "../../services/productService";
import { getStoreSettings } from "../../services/storeSettingsService";
import { getActiveStoreContext, getUserStoreType } from "../../utils/auth";
import "./HelpChatBot.css";

// ---------------------------------------------------------------------------
// Per-store suggestion sets — each store type gets its own quick-actions row.
// Every action maps to an intent the AI service understands.
// ---------------------------------------------------------------------------
const SUGGESTIONS_BY_STORE = {
  hotel: [
    { intent: "today_sales", icon: <FaChartLine />, label: "Today's sales", tone: "ok" },
    { intent: "hotel_bookings", icon: <FaBed />, label: "Room bookings", tone: "warm" },
    { intent: "table_bookings", icon: <FaChair />, label: "Dining tables", tone: "warm" },
    { intent: "housekeeping", icon: <FaBroom />, label: "Housekeeping", tone: "muted" },
    { intent: "menu_help", icon: <FaUtensils />, label: "Bulk import menu", tone: "info" },
    { intent: "low_stock", icon: <FaBoxes />, label: "Menu stock", tone: "warn" },
    { intent: "cashflow_help", icon: <FaCashRegister />, label: "Cash flow", tone: "ok" },
    { intent: "settings_help", icon: <FaCog />, label: "Settings", tone: "muted" },
  ],
  laundry: [
    { intent: "today_sales", icon: <FaChartLine />, label: "Today's sales", tone: "ok" },
    { intent: "top_products", icon: <FaTags />, label: "Top services", tone: "info" },
    { intent: "low_stock", icon: <FaBoxOpen />, label: "Consumable stock", tone: "warn" },
    { intent: "cashflow_help", icon: <FaCashRegister />, label: "Cash flow", tone: "ok" },
    { intent: "settings_help", icon: <FaCog />, label: "Settings", tone: "muted" },
    { intent: "help", icon: <FaConciergeBell />, label: "What can you do?", tone: "muted" },
  ],
  service: [
    { intent: "today_sales", icon: <FaChartLine />, label: "Today's revenue", tone: "ok" },
    { intent: "top_products", icon: <FaTags />, label: "Top services", tone: "info" },
    { intent: "invoice_help", icon: <FaFileInvoice />, label: "Create invoice", tone: "info" },
    { intent: "cashflow_help", icon: <FaCashRegister />, label: "Cash flow", tone: "ok" },
    { intent: "profit_gst", icon: <FaPercent />, label: "Profit & GST", tone: "info" },
    { intent: "settings_help", icon: <FaCog />, label: "Settings", tone: "muted" },
    { intent: "help", icon: <FaConciergeBell />, label: "What can you do?", tone: "muted" },
  ],
  "msme-service": [
    { intent: "today_sales", icon: <FaChartLine />, label: "Today's revenue", tone: "ok" },
    { intent: "top_products", icon: <FaTags />, label: "Top services", tone: "info" },
    { intent: "invoice_help", icon: <FaFileInvoice />, label: "Create invoice", tone: "info" },
    { intent: "cashflow_help", icon: <FaCashRegister />, label: "Cash flow", tone: "ok" },
    { intent: "profit_gst", icon: <FaPercent />, label: "Profit & GST", tone: "info" },
    { intent: "settings_help", icon: <FaCog />, label: "Settings", tone: "muted" },
    { intent: "help", icon: <FaConciergeBell />, label: "What can you do?", tone: "muted" },
  ],
  inventory: [
    { intent: "low_stock", icon: <FaBoxOpen />, label: "Low stock", tone: "warn" },
    { intent: "top_products", icon: <FaShippingFast />, label: "Top movers", tone: "info" },
    { intent: "today_sales", icon: <FaChartLine />, label: "Today's sales", tone: "ok" },
    { intent: "product_help", icon: <FaBoxes />, label: "Add product", tone: "info" },
    { intent: "invoice_help", icon: <FaFileInvoice />, label: "Create invoice", tone: "info" },
    { intent: "cashflow_help", icon: <FaCashRegister />, label: "Cash flow", tone: "ok" },
    { intent: "settings_help", icon: <FaCog />, label: "Settings", tone: "muted" },
  ],
  retail: [
    { intent: "today_sales", icon: <FaChartLine />, label: "Today's sales", tone: "ok" },
    { intent: "top_products", icon: <FaTags />, label: "Top products", tone: "info" },
    { intent: "low_stock", icon: <FaBoxOpen />, label: "Low stock", tone: "warn" },
    { intent: "invoice_help", icon: <FaFileInvoice />, label: "Create invoice", tone: "info" },
    { intent: "product_help", icon: <FaBoxes />, label: "Add product", tone: "info" },
    { intent: "cashflow_help", icon: <FaCashRegister />, label: "Cash flow", tone: "ok" },
    { intent: "settings_help", icon: <FaCog />, label: "Settings", tone: "muted" },
  ],
  default: [
    { intent: "today_sales", icon: <FaChartLine />, label: "Today's sales", tone: "ok" },
    { intent: "top_products", icon: <FaTags />, label: "Top products", tone: "info" },
    { intent: "low_stock", icon: <FaBoxOpen />, label: "Low stock", tone: "warn" },
    { intent: "invoice_help", icon: <FaFileInvoice />, label: "Create invoice", tone: "info" },
    { intent: "product_help", icon: <FaBoxes />, label: "Add product", tone: "info" },
    { intent: "cashflow_help", icon: <FaCashRegister />, label: "Cash flow", tone: "ok" },
    { intent: "settings_help", icon: <FaCog />, label: "Settings", tone: "muted" },
    { intent: "help", icon: <FaConciergeBell />, label: "What can you do?", tone: "muted" },
  ],
};

const STORE_LABEL = {
  hotel: "Hotel",
  laundry: "Laundry",
  service: "Service",
  "msme-service": "MSME Service",
  inventory: "Inventory",
  retail: "Retail",
};

const getSuggestionsForStore = (storeType) =>
  SUGGESTIONS_BY_STORE[storeType] || SUGGESTIONS_BY_STORE.default;

const formatTimestamp = (value) => {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const storeGreeting = (locale, storeName, storeType) => {
  const name = storeName || "your store";
  const typeLabel = STORE_LABEL[storeType] || "";
  const flavor =
    storeType === "hotel"
      ? "Ask about today's room revenue, low-stock menu items, or how to use the dining floor map."
      : storeType === "laundry"
        ? "Ask about today's revenue, top services or consumable stock levels."
        : storeType === "service" || storeType === "msme-service"
          ? "Ask about today's revenue, top services or profit + GST summaries."
          : storeType === "inventory"
            ? "Ask about low-stock items, top movers, or how to add new products."
            : 'Ask things like "how much did we sell today" or "what\'s running low on stock".';
  if (locale?.chatBotWelcome) {
    const scope = typeLabel ? ` (${typeLabel})` : "";
    return `${locale.chatBotWelcome}\n\nI'm connected to live data from **${name}**${scope}. ${flavor}`;
  }
  return `Hi! I'm your POS Helper for **${name}**${typeLabel ? ` (${typeLabel})` : ""}. ${flavor}`;
};

const HelpChatBot = () => {
  const { locale, languageOptions, language: currentLanguage } = useUi();
  const navigate = useNavigate();
  const location = useLocation();

  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [unread, setUnread] = useState(0);
  const [chatLanguage, setChatLanguage] = useState(currentLanguage);
  const chatLocale = locales[chatLanguage] || locale;

  const buildWelcomeMessage = useCallback(() => {
    const settings = getStoreSettings();
    const storeType = getActiveStoreContext()?.storeType || getUserStoreType();
    const storeName = getActiveStoreContext()?.storeId || settings?.name;
    return {
      id: `welcome-${Date.now()}`,
      author: "bot",
      text: storeGreeting(chatLocale, storeName, storeType),
      type: "text",
      intent: "greeting",
      timestamp: Date.now(),
    };
  }, [chatLocale]);

  const [messages, setMessages] = useState(() => [buildWelcomeMessage()]);

  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [assistantContext, setAssistantContext] = useState({ invoices: [], products: [] });
  const [showHistory, setShowHistory] = useState(false);
  const [activeStore, setActiveStore] = useState(() => {
    if (typeof window === "undefined") return null;
    return getActiveStoreContext();
  });

  const messageEndRef = useRef(null);
  const inputRef = useRef(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  // Resolve the *effective* store type — for SUPER_OWNER we honor the
  // currently-selected store (via activeStoreChanged events); for everyone
  // else we use the user's own storeType.
  const effectiveStoreType = useMemo(() => {
    if (activeStore?.storeType) return activeStore.storeType;
    return getUserStoreType();
  }, [activeStore]);

  const effectiveStoreLabel = useMemo(() => {
    if (activeStore?.storeId) return activeStore.storeId;
    const settings = getStoreSettings();
    return settings?.name || STORE_LABEL[effectiveStoreType] || "your store";
  }, [activeStore, effectiveStoreType]);

  // Listen for activeStoreChanged + authChanged so SUPER_OWNER store
  // switches are reflected immediately.
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const refreshStore = () => {
      setActiveStore(getActiveStoreContext());
    };
    window.addEventListener("activeStoreChanged", refreshStore);
    window.addEventListener("storage", refreshStore);
    window.addEventListener("authChanged", refreshStore);
    return () => {
      window.removeEventListener("activeStoreChanged", refreshStore);
      window.removeEventListener("storage", refreshStore);
      window.removeEventListener("authChanged", refreshStore);
    };
  }, []);

  const quickActions = useMemo(
    () => getSuggestionsForStore(effectiveStoreType),
    [effectiveStoreType]
  );

  // ----- Auto-scroll to bottom -----
  useEffect(() => {
    if (!open || minimized) return;
    messageEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, open, minimized, isTyping]);

  // ----- Track unread when collapsed -----
  useEffect(() => {
    if (!open || minimized) {
      const last = messages[messages.length - 1];
      if (last && last.author === "bot") {
        setUnread((current) => current + 1);
      }
    } else {
      setUnread(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  // ----- Refresh welcome when language or active store changes -----
  useEffect(() => {
    setMessages((current) => {
      if (current.length > 1) return current;
      return [buildWelcomeMessage()];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatLanguage, effectiveStoreType, activeStore]);

  // ----- Load context -----
  const refreshContext = useCallback(async () => {
    try {
      const [invoices, products] = await Promise.all([getInvoices(), getProducts()]);
      setAssistantContext({
        invoices: Array.isArray(invoices) ? invoices : [],
        products: Array.isArray(products) ? products : [],
      });
    } catch (error) {
      console.warn("Unable to load assistant context", error);
    }
  }, []);

  useEffect(() => {
    if (open) refreshContext();
  }, [open, refreshContext]);

  // ----- Helpers -----
  const appendMessage = (message) => {
    setMessages((current) => [
      ...current,
      { ...message, id: message.id || `m-${Date.now()}-${Math.random()}`, timestamp: Date.now() },
    ]);
  };

  const processUserMessage = (text) => {
    const trimmed = String(text || "").trim();
    if (!trimmed) return;

    // Allow internal "query:" paths (used by quick-action chips)
    if (trimmed.startsWith("query:")) {
      const intent = trimmed.slice("query:".length);
      const reply = getAiAssistantReply(intent, assistantContext);
      replyWithTyping(reply, intent);
      return;
    }

    appendMessage({ author: "user", text: trimmed, type: "text" });
    const reply = getAiAssistantReply(trimmed, assistantContext);
    replyWithTyping(reply, trimmed);
  };

  const replyWithTyping = (reply, _echo) => {
    setIsTyping(true);
    window.setTimeout(() => {
      setIsTyping(false);
      appendMessage({
        author: "bot",
        ...reply,
        timestamp: Date.now(),
      });
    }, 320);
  };

  const handleSend = () => {
    if (!inputValue.trim()) return;
    processUserMessage(inputValue);
    setInputValue("");
    if (inputRef.current) inputRef.current.focus();
  };

  const handleQuickAction = (action) => {
    const reply = getAiAssistantReply(action.intent, assistantContext);
    appendMessage({
      author: "user",
      text: action.label,
      type: "text",
      timestamp: Date.now(),
    });
    replyWithTyping(reply, action.label);
  };

  const handleInlineAction = (action) => {
    if (!action?.path) return;
    if (action.path.startsWith("query:")) {
      const intent = action.path.slice("query:".length);
      const reply = getAiAssistantReply(intent, assistantContext);
      appendMessage({
        author: "user",
        text: action.label,
        type: "text",
        timestamp: Date.now(),
      });
      replyWithTyping(reply, action.label);
      return;
    }
    // External navigation — close the chat and route.
    setOpen(false);
    setMinimized(false);
    if (location.pathname !== action.path) {
      navigate(action.path);
    }
  };

  const handleClearConversation = () => {
    setMessages([buildWelcomeMessage()]);
    setShowHistory(false);
    setUnread(0);
  };

  const handleTextareaKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ----- Render: rich message body -----
  const renderReplyBody = (message) => {
    const { type, text, cards = [], items = [], steps = [], actions = [] } = message;

    return (
      <div className="help-chatbot-msg-body">
        {text && (
          <p className={`help-chatbot-msg-text ${type === "summary" ? "is-summary-text" : ""}`}>
            {text}
          </p>
        )}

        {type === "summary" && cards.length > 0 && (
          <div className="help-chatbot-summary-grid">
            {cards.map((card, idx) => (
              <div
                key={`${card.label}-${idx}`}
                className={`help-chatbot-summary-card tone-${card.tone || "info"}`}
              >
                <span className="help-chatbot-summary-card-label">{card.label}</span>
                <strong className="help-chatbot-summary-card-value">{card.value}</strong>
              </div>
            ))}
          </div>
        )}

        {type === "list" && items.length > 0 && (
          <ul className="help-chatbot-list">
            {items.map((item, idx) => (
              <li key={`${item.label}-${idx}`} className="help-chatbot-list-item">
                <span className="help-chatbot-list-mark" aria-hidden="true">
                  <FaCircle />
                </span>
                <div className="help-chatbot-list-body">
                  <strong>{item.label}</strong>
                  {item.value && <span>{item.value}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}

        {type === "guide" && steps.length > 0 && (
          <ol className="help-chatbot-guide">
            {steps.map((step, idx) => (
              <li key={`step-${idx}`} className="help-chatbot-guide-step">
                <span className="help-chatbot-guide-step-num">{idx + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        )}

        {actions && actions.length > 0 && (
          <div className="help-chatbot-actions">
            {actions.map((action, idx) => (
              <button
                key={`${action.label}-${idx}`}
                type="button"
                className="help-chatbot-action-chip"
                onClick={() => handleInlineAction(action)}
              >
                <span>{action.label}</span>
                <FaArrowRight aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderMessage = (message) => {
    const isUser = message.author === "user";
    return (
      <div key={message.id} className={`help-chatbot-msg ${isUser ? "is-user" : "is-bot"}`}>
        {!isUser && (
          <span className="help-chatbot-avatar" aria-hidden="true">
            <FaRobot />
          </span>
        )}
        <div className="help-chatbot-bubble">
          {renderReplyBody(message)}
          <span className="help-chatbot-bubble-time">{formatTimestamp(message.timestamp)}</span>
        </div>
        {isUser && (
          <span className="help-chatbot-avatar help-chatbot-avatar-user" aria-hidden="true">
            <FaUserTie />
          </span>
        )}
      </div>
    );
  };

  const renderTypingIndicator = () => (
    <div className="help-chatbot-msg is-bot is-typing">
      <span className="help-chatbot-avatar" aria-hidden="true">
        <FaRobot />
      </span>
      <div className="help-chatbot-bubble">
        <div className="help-chatbot-typing">
          <span className="help-chatbot-typing-dot" />
          <span className="help-chatbot-typing-dot" />
          <span className="help-chatbot-typing-dot" />
        </div>
      </div>
    </div>
  );

  // ----- Render: launcher + chat panel -----
  const launcherLabel = chatLocale.chatBotOpenButton || "Help";
  const botTitle = chatLocale.chatBotTitle || "POS Helper";

  return (
    <>
      {!open && (
        <button
          type="button"
          className={`help-chatbot-fab ${unread > 0 ? "has-unread" : ""}`}
          onClick={() => {
            setOpen(true);
            setMinimized(false);
            setUnread(0);
          }}
          aria-label={launcherLabel}
          title={launcherLabel}
        >
          <span className="help-chatbot-fab-pulse" aria-hidden="true" />
          <span className="help-chatbot-fab-pulse help-chatbot-fab-pulse-2" aria-hidden="true" />
          <span className="help-chatbot-fab-icon">
            <FaComments />
          </span>
          {unread > 0 && (
            <span className="help-chatbot-fab-badge" aria-label={`${unread} new messages`}>
              {unread}
            </span>
          )}
          <span className="help-chatbot-fab-label">{launcherLabel}</span>
        </button>
      )}

      {open && (
        <div
          className={`help-chatbot-panel ${minimized ? "is-minimized" : ""}`}
          role="dialog"
          aria-label={botTitle}
        >
          <header className="help-chatbot-panel-head">
            <div className="help-chatbot-panel-head-left">
              <div className="help-chatbot-panel-avatar" aria-hidden="true">
                <FaBolt />
              </div>
              <div className="help-chatbot-panel-titles">
                <div className="help-chatbot-panel-title">
                  <strong>{botTitle}</strong>
                  <span className="help-chatbot-panel-status">
                    <FaCircle className="help-chatbot-panel-pulse" /> online
                  </span>
                </div>
                <div
                  className="help-chatbot-panel-subtitle"
                  title={`Connected to ${effectiveStoreLabel}`}
                >
                  <FaStore aria-hidden="true" />
                  <span className="help-chatbot-panel-subtitle-store">{effectiveStoreLabel}</span>
                  {effectiveStoreType && (
                    <span className={`help-chatbot-panel-storetag tag-${effectiveStoreType}`}>
                      {STORE_LABEL[effectiveStoreType] || effectiveStoreType}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="help-chatbot-panel-head-actions">
              <button
                type="button"
                className="help-chatbot-head-btn"
                onClick={refreshContext}
                title="Refresh data"
                aria-label="Refresh data"
              >
                <FaRedo />
              </button>
              <button
                type="button"
                className="help-chatbot-head-btn"
                onClick={handleClearConversation}
                title="Clear conversation"
                aria-label="Clear conversation"
              >
                <FaTrash />
              </button>
              <button
                type="button"
                className="help-chatbot-head-btn"
                onClick={() => setMinimized((m) => !m)}
                title={minimized ? "Expand" : "Minimize"}
                aria-label={minimized ? "Expand" : "Minimize"}
              >
                {minimized ? <FaExpand /> : <FaMinus />}
              </button>
              <button
                type="button"
                className="help-chatbot-head-btn help-chatbot-head-close"
                onClick={() => setOpen(false)}
                title="Close"
                aria-label="Close"
              >
                <FaTimes />
              </button>
            </div>
          </header>

          {!minimized && (
            <>
              <div className="help-chatbot-toolbar">
                <div className="help-chatbot-toolbar-left">
                  <label className="help-chatbot-toolbar-label">
                    <FaGlobe aria-hidden="true" />
                    <select
                      value={chatLanguage}
                      onChange={(e) => setChatLanguage(e.target.value)}
                      aria-label="Chat language"
                    >
                      {languageOptions.map((lang) => (
                        <option key={lang.code} value={lang.code}>
                          {lang.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="help-chatbot-toolbar-right">
                  <button
                    type="button"
                    className={`help-chatbot-toolbar-btn ${showHistory ? "is-active" : ""}`}
                    onClick={() => setShowHistory((s) => !s)}
                    title="Conversation"
                    aria-label="Conversation history"
                  >
                    <FaHistory aria-hidden="true" />
                    <span>{messages.length}</span>
                  </button>
                </div>
              </div>

              <div className="help-chatbot-scroll">
                <div className="help-chatbot-thread">
                  {messages.map(renderMessage)}
                  {isTyping && renderTypingIndicator()}
                  <div ref={messageEndRef} />
                </div>

                {showHistory && (
                  <div className="help-chatbot-history">
                    <div className="help-chatbot-history-head">
                      <FaListUl aria-hidden="true" />
                      <strong>Conversation snapshot</strong>
                    </div>
                    <ul>
                      {messages.slice(-6).map((message) => (
                        <li key={`hist-${message.id}`}>
                          <span className={`tag ${message.author}`}>
                            {message.author === "user" ? "You" : "Bot"}
                          </span>
                          <span className="text">
                            {message.text?.slice(0, 64) || message.intent}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="help-chatbot-quickrow" aria-label="Quick actions">
                {quickActions.map((action) => (
                  <button
                    key={action.intent}
                    type="button"
                    className={`help-chatbot-quick-chip tone-${action.tone}`}
                    onClick={() => handleQuickAction(action)}
                  >
                    <span className="help-chatbot-quick-chip-icon" aria-hidden="true">
                      {action.icon}
                    </span>
                    <span>{action.label}</span>
                  </button>
                ))}
              </div>

              <div className="help-chatbot-input">
                <textarea
                  ref={inputRef}
                  rows={1}
                  placeholder={chatLocale.chatBotInputPlaceholder || "Type your question..."}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleTextareaKey}
                />
                <button
                  type="button"
                  className="help-chatbot-send"
                  onClick={handleSend}
                  disabled={!inputValue.trim()}
                  aria-label="Send message"
                  title="Send"
                >
                  <FaPaperPlane />
                </button>
              </div>

              <div className="help-chatbot-foot">
                <FaShieldAlt aria-hidden="true" />
                <span>POS Helper uses your live data only — no info leaves this device.</span>
              </div>
            </>
          )}

          {minimized && (
            <button
              type="button"
              className="help-chatbot-minimized-bar"
              onClick={() => setMinimized(false)}
              aria-label="Open chat"
            >
              <FaRobot />
              <span>Tap to expand · {messages.length} message(s)</span>
              <FaExpand />
            </button>
          )}
        </div>
      )}
    </>
  );
};

export default HelpChatBot;
