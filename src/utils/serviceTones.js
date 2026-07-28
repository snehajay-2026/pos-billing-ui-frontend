// Shared visual tones + helpers for service-industry pages.
// Keeps status pills, category badges, and avatar gradients in sync.

export const STATUS_FLOW = ["pending", "in_progress", "completed"];

export const STATUS_LABEL = {
  pending: "Pending",
  in_progress: "In Progress",
  completed: "Completed",
};

export const STATUS_TONES = {
  pending: {
    bg: "rgba(245, 158, 11, 0.16)",
    color: "#b45309",
    dot: "#f59e0b",
    solid: "#f59e0b",
    halo: "rgba(245, 158, 11, 0.18)",
  },
  in_progress: {
    bg: "rgba(14, 165, 233, 0.14)",
    color: "#0369a1",
    dot: "#0ea5e9",
    solid: "#0ea5e9",
    halo: "rgba(14, 165, 233, 0.18)",
  },
  completed: {
    bg: "rgba(16, 185, 129, 0.14)",
    color: "#047857",
    dot: "#10b981",
    solid: "#10b981",
    halo: "rgba(16, 185, 129, 0.18)",
  },
};

export const SERVICE_CATEGORIES = [
  { value: "Consulting", label: "Consulting" },
  { value: "Repair", label: "Repair" },
  { value: "Training", label: "Training" },
  { value: "Installation", label: "Installation" },
  { value: "Maintenance", label: "Maintenance" },
  { value: "Other", label: "Other" },
];

export const CATEGORY_TONES = {
  Consulting: { bg: "rgba(99, 102, 241, 0.14)", color: "#4338ca" },
  Repair: { bg: "rgba(244, 63, 94, 0.14)", color: "#be123c" },
  Training: { bg: "rgba(34, 197, 94, 0.14)", color: "#15803d" },
  Installation: { bg: "rgba(245, 158, 11, 0.16)", color: "#b45309" },
  Maintenance: { bg: "rgba(20, 184, 166, 0.16)", color: "#0f766e" },
  Other: { bg: "rgba(100, 116, 139, 0.16)", color: "#475569" },
};

export const initialsFromName = (name = "") => {
  const cleaned = String(name).trim();
  if (!cleaned) return "??";
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

export const initialsFromEmail = (email = "") => {
  const handle = String(email).split("@")[0] || "";
  const letters = (handle.match(/[A-Za-z]/g) || []).join("");
  return (letters || handle || "??").slice(0, 2).toUpperCase();
};

export const formatDateTime = (dateStr, timeStr) => {
  if (!dateStr && !timeStr) return "—";
  try {
    const d = dateStr ? new Date(dateStr) : null;
    const dateLabel = d
      ? d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
      : "";
    const t = timeStr ? formatTime(timeStr) : "";
    return [dateLabel, t].filter(Boolean).join(" · ");
  } catch {
    return [dateStr, timeStr].filter(Boolean).join(" · ");
  }
};

export const formatTime = (timeStr) => {
  if (!timeStr) return "";
  // Accept "HH:MM" or full ISO; show as 12-hour clock
  const m = /^(\d{1,2}):(\d{2})/.exec(timeStr);
  if (!m) return timeStr;
  let hour = Number(m[1]);
  const min = m[2];
  const ampm = hour >= 12 ? "PM" : "AM";
  hour = hour % 12 || 12;
  return `${hour}:${min} ${ampm}`;
};

export const formatCurrency = (n) => {
  const num = Number(n) || 0;
  return `₹${num.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
};
