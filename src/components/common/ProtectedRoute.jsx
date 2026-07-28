import { Navigate } from "react-router-dom";
import { getUserRole, getUserStoreType } from "../../utils/auth";

const ADMIN_ROLES = ["SUPER_OWNER", "STORE_ADMIN", "ADMIN"];

const ProtectedRoute = ({ role, roles, storeType, allowAdminOrStoreType, children }) => {
  const userRole = getUserRole();
  const userStore = getUserStoreType();

  if (!userRole) {
    return <Navigate to="/login" replace />;
  }

  if (allowAdminOrStoreType) {
    if (ADMIN_ROLES.includes(userRole) || userStore === allowAdminOrStoreType) {
      return children;
    }
    return <Navigate to="/" replace />;
  }

  if (roles) {
    const allowed = Array.isArray(roles) ? roles : [roles];
    if (!allowed.includes(userRole)) {
      return <Navigate to="/" replace />;
    }
  }

  if (storeType) {
    if (userRole === "SUPER_OWNER") {
      return children;
    }
    const allowedTypes = Array.isArray(storeType) ? storeType : [storeType];
    if (!allowedTypes.includes(userStore)) {
      return <Navigate to="/" replace />;
    }
  }

  return children;
};

export default ProtectedRoute;
