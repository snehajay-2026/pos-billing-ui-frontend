import { apiGet, apiPost, apiPut, apiDelete } from "./api";

export const getUsers = async () => apiGet("/api/users");
export const createUser = async (user) => apiPost("/api/users", user);
export const updateUser = async (id, user) => apiPut(`/api/users/${id}`, user);
export const deleteUser = async (id) => apiDelete(`/api/users/${id}`);
