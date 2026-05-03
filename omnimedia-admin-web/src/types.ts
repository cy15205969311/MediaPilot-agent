export type UserRole =
  | "super_admin"
  | "admin"
  | "operator"
  | "premium"
  | "user";

export type UserStatus = "active" | "frozen";

export type AuthenticatedUser = {
  id: string;
  username: string;
  nickname?: string | null;
  bio?: string | null;
  avatar_url?: string | null;
  role: UserRole;
  status: UserStatus;
  token_balance: number;
  created_at: string;
};

export type AuthResponse = {
  access_token: string;
  refresh_token: string;
  token_type: "bearer";
  user: AuthenticatedUser;
};

export type LogoutResponse = {
  logged_out: true;
};

export type AdminUserItem = {
  id: string;
  username: string;
  nickname?: string | null;
  avatar_url?: string | null;
  role: UserRole;
  status: UserStatus;
  token_balance: number;
  created_at: string;
};

export type AdminUsersApiResponse = {
  items: AdminUserItem[];
  total: number;
  skip: number;
  limit: number;
};

export type AdminDashboardTrendItem = {
  date: string;
  token_count: number;
};

export type AdminDashboardModelUsageItem = {
  model_name: string;
  count: number;
};

export type AdminDashboardData = {
  total_users: number;
  today_tokens: number;
  today_contents: number;
  oss_storage_bytes: number;
  trend_30_days: AdminDashboardTrendItem[];
  model_usage_ratio: AdminDashboardModelUsageItem[];
};

export type AdminUserStatusPayload = {
  status: UserStatus;
};

export type AdminUserPasswordResetApiResponse = {
  user_id: string;
  new_password: string;
  revoked_sessions: number;
};

export type AdminTokenAdjustAction = "add" | "deduct" | "set";

export type AdminUserTokenUpdatePayload = {
  action: AdminTokenAdjustAction;
  amount: number;
  remark: string;
};

export type AdminUserTokenUpdateApiResponse = {
  user_id: string;
  token_balance: number;
  transaction_id: string;
  amount: number;
  transaction_type: string;
  remark: string;
};

export type AdminToast = {
  tone: "success" | "error" | "warning";
  title: string;
  message: string;
};
