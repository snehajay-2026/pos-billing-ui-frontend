import { apiGet, apiPost, apiPut, apiDelete } from "./api";
import { getUser, getActiveStoreContext } from "../utils/auth";

const getUserMeta = () => {
  const active = getActiveStoreContext();
  const user = getUser();
  return {
    storeType: active?.storeType || user?.storeType || "nostore",
    email: user?.email || "nouser",
  };
};

export const getExpenses = async () => {
  const { storeType, email } = getUserMeta();
  return apiGet("/api/expenses", { storeType, email });
};

export const saveExpense = async (expense) => {
  const { storeType, email } = getUserMeta();
  const nextExpense = await apiPost("/api/expenses", expense, { storeType, email });
  window.dispatchEvent(new CustomEvent("dataUpdated", { detail: "expenses" }));
  return nextExpense;
};

export const updateExpense = async (expense) => {
  const { storeType, email } = getUserMeta();
  const updated = await apiPut(`/api/expenses/${expense.id}`, expense, { storeType, email });
  window.dispatchEvent(new CustomEvent("dataUpdated", { detail: "expenses" }));
  return updated;
};

export const deleteExpense = async (expenseId) => {
  const { storeType, email } = getUserMeta();
  await apiDelete(`/api/expenses/${expenseId}`, null, { storeType, email });
  window.dispatchEvent(new CustomEvent("dataUpdated", { detail: "expenses" }));
  return expenseId;
};

export const getExpenseById = async (expenseId) => {
  const expenses = await getExpenses();
  return expenses.find((item) => String(item.id) === String(expenseId));
};
