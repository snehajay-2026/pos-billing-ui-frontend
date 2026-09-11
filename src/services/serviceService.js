import { apiGet, apiPost, apiPut, apiDelete } from "./api";
import { getUser, getActiveStoreContext } from "../utils/auth";

const getUserMeta = () => {
  const active = getActiveStoreContext();
  const user = getUser();
  const rawStoreType = active?.storeType || user?.storeType || "nostore";
  // SUPER_OWNER without an active store context defaults to a "service"
  // bucket so a single-tab flow (save here → read here) still works.
  const isSuperOwner = user?.role === "SUPER_OWNER";
  const storeType =
    isSuperOwner && (rawStoreType === "nostore" || rawStoreType === "system")
      ? "service"
      : rawStoreType;
  return {
    storeType,
    email: user?.email || "nouser",
  };
};

// getServices returns whatever the API gives us. An empty list is a real
// answer — the store's catalog is empty. We no longer substitute a hardcoded
// list of "Consulting / Repair / Training" services, because that hid DB
// configuration problems and let cashiers generate invoices against rates
// that never existed in the catalog.
export const getServices = async () => {
  const { storeType, email } = getUserMeta();
  const services = await apiGet("/api/services", { storeType, email });
  return Array.isArray(services) ? services : [];
};

export const createService = async (service) => {
  const { storeType, email } = getUserMeta();
  return apiPost("/api/services", service, { storeType, email });
};

export const updateService = async (service) => {
  const { storeType, email } = getUserMeta();
  return apiPut(`/api/services/${service.id}`, service, { storeType, email });
};

export const deleteService = async (id) => {
  const { storeType, email } = getUserMeta();
  return apiDelete(`/api/services/${id}`, null, { storeType, email });
};

// loadServices is now an alias for getServices. The previous implementation
// returned a hardcoded fallback (Consulting/Repair/Training) when the API
// returned an empty list, which masked DB outages and silently generated
// invoices against fake rates. Callers that previously relied on the
// fallback should now render an empty state instead.
export const loadServices = getServices;
