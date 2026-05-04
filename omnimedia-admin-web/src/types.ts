export type UserRole =
  | "super_admin"
  | "admin"
  | "finance"
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
  latest_session?: AdminLatestSessionItem | null;
};

export type AdminUsersApiResponse = {
  items: AdminUserItem[];
  total: number;
  skip: number;
  limit: number;
};

export type AdminLatestSessionItem = {
  device_info?: string | null;
  ip_address?: string | null;
  last_seen_at?: string | null;
  created_at?: string | null;
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

export type AdminRoleSummaryResponse = Partial<Record<UserRole, number>>;

export type AdminTemplatePlatform = "小红书" | "抖音" | "通用";

export type AdminTemplateItem = {
  id: string;
  title: string;
  platform: AdminTemplatePlatform;
  description: string;
  prompt_content: string;
  usage_count: number;
  rating: number;
  is_preset: boolean;
  created_at: string;
};

export type AdminTemplatesApiResponse = {
  items: AdminTemplateItem[];
  total: number;
};

export type AdminTemplateCreatePayload = {
  title: string;
  platform: AdminTemplatePlatform;
  description: string;
  prompt_content: string;
};

export type AdminTemplateUpdatePayload = Partial<AdminTemplateCreatePayload>;

export type AdminTemplateDeletePayload = {
  template_ids: string[];
};

export type AdminTemplateDeleteApiResponse = {
  deleted_count: number;
  deleted_ids: string[];
};

export type AdminTokenTransactionItem = {
  id: string;
  created_at: string;
  username: string;
  nickname?: string | null;
  transaction_type: string;
  amount: number;
  remark: string;
};

export type AdminTokenTransactionsApiResponse = {
  items: AdminTokenTransactionItem[];
  total: number;
  skip: number;
  limit: number;
};

export type AdminTokenStats = {
  today_consume: number;
  today_topup: number;
  month_consume: number;
  total_balance: number;
  today_consume_change_percent?: number | null;
  today_topup_change_percent?: number | null;
  month_consume_change_percent?: number | null;
  total_balance_change_percent?: number | null;
};

export type AdminAuditActionType =
  | "create_user"
  | "delete_user"
  | "role_change"
  | "topup"
  | "token_deduct"
  | "token_set"
  | "freeze"
  | "unfreeze"
  | "reset_password"
  | "delete_template";

export type AdminAuditLogItem = {
  id: string;
  operator_id?: string | null;
  operator_name: string;
  action_type: AdminAuditActionType;
  target_id?: string | null;
  target_name: string;
  details: Record<string, unknown>;
  created_at: string;
};

export type AdminAuditLogsApiResponse = {
  items: AdminAuditLogItem[];
  total: number;
  skip: number;
  limit: number;
};

export type AdminAuditLogsFilters = {
  operatorKeyword?: string;
  actionType?: AdminAuditActionType | "";
  startDate?: string;
  endDate?: string;
};

export type AdminUserStatusPayload = {
  status: UserStatus;
};

export type AdminUserCreatePayload = {
  username: string;
  password: string;
  role: UserRole;
};

export type AdminUserPasswordResetApiResponse = {
  user_id: string;
  new_password: string;
  revoked_sessions: number;
};

export type AdminUserDeleteApiResponse = {
  id: string;
  deleted: true;
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

export type AdminUserRoleUpdatePayload = {
  role: UserRole;
};

export type PermissionModule = "users" | "assets" | "content" | "finance";

export type Permission = {
  id: string;
  label: string;
  description: string;
  module: PermissionModule;
};

export type Role = {
  id: string;
  name: string;
  memberCount: number;
  permissions: string[];
  isSystem: boolean;
};

export type AdminToast = {
  tone: "success" | "error" | "warning";
  title: string;
  message: string;
};
