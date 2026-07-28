import { apiGet, apiPost, apiPut, apiDelete } from "./api";
import { getUser, getActiveStoreContext } from "../utils/auth";

export const defaultServices = [
  {
    id: 1,
    name: "Consulting",
    description: "Business consulting services",
    rate: 500,
    gst: 18,
    hours: 2,
  },
  {
    id: 2,
    name: "Repair",
    description: "Device repair and maintenance",
    rate: 300,
    gst: 18,
    hours: 1,
  },
  {
    id: 3,
    name: "Training",
    description: "Employee training session",
    rate: 800,
    gst: 18,
    hours: 3,
  },
];

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

export const getServices = async () => {
  const { storeType, email } = getUserMeta();
  const services = await apiGet("/api/services", { storeType, email });
  if (Array.isArray(services) && services.length) return services;
  return [];
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

export const loadServices = async () => {
  const services = await getServices();
  if (services.length) return services;
  return defaultServices;
};
