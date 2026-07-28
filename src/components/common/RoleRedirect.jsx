import { Navigate } from "react-router-dom";
import { getActiveStoreContext, getUser } from "../../utils/auth";

const ADMIN_ROLES = ["SUPER_OWNER", "STORE_ADMIN", "ADMIN"];
const DASHBOARD_ROLES = [...ADMIN_ROLES];

const RoleRedirect = () => {
  const user = getUser();

  if (user?.role === "SUPER_OWNER" && getActiveStoreContext()) {
    return <Navigate to="/pos" replace />;
  }

  if (user?.role && DASHBOARD_ROLES.includes(user.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Navigate to="/pos" replace />;
};

export default RoleRedirect;
