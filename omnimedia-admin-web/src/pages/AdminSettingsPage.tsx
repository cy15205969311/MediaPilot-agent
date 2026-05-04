import { useEffect, useMemo, useState } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";

import {
  APIError,
  fetchAdminSystemSettings,
  updateAdminSystemSettings,
} from "../api";
import type {
  AdminSystemSettingItem,
  AdminSystemSettingsApiResponse,
  AdminToast,
} from "../types";

type AdminSettingsPageProps = {
  onToast: (toast: AdminToast) => void;
};

type FormValue = string | boolean;
type FormState = Record<string, FormValue>;
type FieldType = "text" | "number" | "boolean";

type SettingFieldDefinition = {
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  inputMode?: "text" | "numeric" | "decimal" | "email";
  hidden?: boolean;
};

type SettingSectionDefinition = {
  category: string;
  title: string;
  description: string;
  fields: SettingFieldDefinition[];
};

const theme = {
  primary: "#ff7a59",
  cardBg: "#ffffff",
  cardBorder: "#e2e8f0",
  textPrimary: "#0f172a",
  textSecondary: "#475569",
  textMuted: "#94a3b8",
};

const SETTINGS_SECTIONS: SettingSectionDefinition[] = [
  {
    category: "basic",
    title: "基础设置",
    description: "统一维护平台名称、默认邮箱、语言与时区基线。",
    fields: [
      { key: "system_name", label: "系统名称", type: "text", placeholder: "请输入系统名称", inputMode: "text" },
      { key: "admin_email", label: "管理员邮箱", type: "text", placeholder: "请输入管理员邮箱", inputMode: "email" },
      { key: "timezone", label: "时区设置", type: "text", placeholder: "例如 UTC+8 (北京时间)", inputMode: "text" },
      { key: "language", label: "默认语言", type: "text", placeholder: "例如 简体中文", inputMode: "text" },
    ],
  },
  {
    category: "token",
    title: "Token配置",
    description: "配置平台计费单价、新用户初始资产与运营门槛。",
    fields: [
      { key: "token_price", label: "Token单价", type: "number", placeholder: "例如 0.008", inputMode: "decimal" },
      { key: "new_user_bonus", label: "新用户赠送额度", type: "number", placeholder: "例如 10000000", inputMode: "numeric" },
      { key: "daily_free_quota", label: "每日免费额度", type: "number", placeholder: "例如 100", inputMode: "numeric" },
      { key: "minimum_topup", label: "最低充值额度", type: "number", placeholder: "例如 10000", inputMode: "numeric" },
    ],
  },
  {
    category: "security",
    title: "安全设置",
    description: "控制后台账号登录、会话和访问控制的安全基线。",
    fields: [
      { key: "two_factor_auth", label: "双因素认证", type: "boolean" },
      { key: "ip_whitelist_enabled", label: "IP白名单", type: "boolean" },
      {
        key: "ip_whitelist_ips",
        label: "白名单 IP 列表",
        type: "text",
        hidden: true,
      },
      { key: "login_captcha_enabled", label: "登录验证码", type: "boolean" },
      { key: "session_timeout_enabled", label: "会话超时保护", type: "boolean" },
      {
        key: "session_timeout_minutes",
        label: "会话超时时长",
        type: "number",
        hidden: true,
      },
    ],
  },
  {
    category: "notification",
    title: "通知设置",
    description: "决定哪些后台事件会主动推送给运营与管理员。",
    fields: [
      { key: "user_signup_notification", label: "用户注册通知", type: "boolean" },
      { key: "anomaly_alert_notification", label: "异常告警通知", type: "boolean" },
      { key: "system_maintenance_notification", label: "系统维护通知", type: "boolean" },
      { key: "daily_report_notification", label: "每日报表推送", type: "boolean" },
    ],
  },
];

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof APIError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

function normalizeSettingValue(value: AdminSystemSettingItem["value"], type: FieldType): FormValue {
  if (type === "boolean") {
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "number") {
      return value !== 0;
    }
    const normalized = String(value ?? "").trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
  }
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function buildFormSnapshot(response: AdminSystemSettingsApiResponse): {
  metadata: Record<string, AdminSystemSettingItem>;
  values: FormState;
  defaults: FormState;
} {
  const metadata: Record<string, AdminSystemSettingItem> = {};
  const values: FormState = {};
  const defaults: FormState = {};

  for (const section of SETTINGS_SECTIONS) {
    const items = response.categories[section.category] ?? [];
    for (const item of items) {
      metadata[item.key] = item;
    }

    for (const field of section.fields) {
      const item = items.find((candidate) => candidate.key === field.key);
      if (!item) {
        values[field.key] = field.type === "boolean" ? false : "";
        defaults[field.key] = field.type === "boolean" ? false : "";
        continue;
      }

      values[field.key] = normalizeSettingValue(item.value, field.type);
      defaults[field.key] = normalizeSettingValue(item.default_value, field.type);
    }
  }

  return { metadata, values, defaults };
}

function SettingsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className="rounded-[28px] border bg-white p-6 shadow-[0_18px_48px_rgba(15,23,42,0.05)]"
          style={{ borderColor: theme.cardBorder }}
        >
          <div className="animate-pulse">
            <div className="mb-3 h-6 w-32 rounded-full bg-slate-200" />
            <div className="mb-6 h-4 w-4/5 rounded-full bg-slate-100" />
            <div className="space-y-4">
              {Array.from({ length: 4 }).map((__, rowIndex) => (
                <div key={rowIndex}>
                  <div className="mb-2 h-4 w-24 rounded-full bg-slate-100" />
                  <div className="h-12 rounded-2xl bg-slate-100" />
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function AdminSettingsPage(props: AdminSettingsPageProps) {
  const { onToast } = props;
  const [metadata, setMetadata] = useState<Record<string, AdminSystemSettingItem>>({});
  const [formValues, setFormValues] = useState<FormState>({});
  const [initialValues, setInitialValues] = useState<FormState>({});
  const [defaultValues, setDefaultValues] = useState<FormState>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let active = true;

    const loadSettings = async () => {
      setIsLoading(true);

      try {
        const response = await fetchAdminSystemSettings();
        if (!active) {
          return;
        }

        const snapshot = buildFormSnapshot(response);
        setMetadata(snapshot.metadata);
        setFormValues(snapshot.values);
        setInitialValues(snapshot.values);
        setDefaultValues(snapshot.defaults);
      } catch (error) {
        if (!active) {
          return;
        }

        onToast({
          tone: "error",
          title: "系统设置加载失败",
          message: getErrorMessage(error, "系统配置暂时不可用，请稍后重试。"),
        });
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void loadSettings();

    return () => {
      active = false;
    };
  }, [onToast]);

  const isDirty = useMemo(
    () => JSON.stringify(formValues) !== JSON.stringify(initialValues),
    [formValues, initialValues],
  );

  const handleInputChange = (key: string, value: FormValue) => {
    setFormValues((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const handleResetToDefault = () => {
    setFormValues(defaultValues);
  };

  const renderSecurityExpansion = (field: SettingFieldDefinition) => {
    if (field.key === "ip_whitelist_enabled") {
      const enabled = Boolean(formValues.ip_whitelist_enabled);
      const value =
        typeof formValues.ip_whitelist_ips === "string"
          ? formValues.ip_whitelist_ips
          : "";

      return (
        <div
          className={`grid overflow-hidden transition-all duration-300 ease-out ${
            enabled ? "mt-3 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
          }`}
        >
          <div className="min-h-0">
            <div className="rounded-[20px] border border-slate-200 bg-white px-4 py-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                允许访问的 IP 列表
              </div>
              <textarea
                className="min-h-[112px] w-full resize-none rounded-2xl border border-transparent bg-slate-100/90 px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-[#ff7a59] focus:bg-white focus:ring-4 focus:ring-red-100"
                onChange={(event) =>
                  handleInputChange("ip_whitelist_ips", event.target.value)
                }
                placeholder="请输入允许访问后台的 IPv4 地址，多个 IP 请用逗号分隔，例如：192.168.1.1, 10.0.0.5"
                rows={4}
                value={value}
              />
            </div>
          </div>
        </div>
      );
    }

    if (field.key === "session_timeout_enabled") {
      const enabled = Boolean(formValues.session_timeout_enabled);
      const value =
        typeof formValues.session_timeout_minutes === "string"
          ? formValues.session_timeout_minutes
          : "";

      return (
        <div
          className={`grid overflow-hidden transition-all duration-300 ease-out ${
            enabled ? "mt-3 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
          }`}
        >
          <div className="min-h-0">
            <div className="rounded-[20px] border border-slate-200 bg-white px-4 py-4">
              <div className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                会话超时阈值
              </div>
              <div className="flex flex-col gap-3 text-sm text-slate-600 sm:flex-row sm:items-center">
                <span>自动登出时间：</span>
                <input
                  className="h-11 w-full max-w-[160px] rounded-2xl border border-transparent bg-slate-100/90 px-4 text-sm text-slate-900 outline-none transition focus:border-[#ff7a59] focus:bg-white focus:ring-4 focus:ring-red-100"
                  inputMode="numeric"
                  min={1}
                  onChange={(event) =>
                    handleInputChange("session_timeout_minutes", event.target.value)
                  }
                  type="number"
                  value={value}
                />
                <span>分钟无操作</span>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return null;
  };

  const handleSave = async () => {
    setIsSaving(true);

    try {
      const response = await updateAdminSystemSettings(formValues);
      const snapshot = buildFormSnapshot(response);
      setMetadata(snapshot.metadata);
      setFormValues(snapshot.values);
      setInitialValues(snapshot.values);
      setDefaultValues(snapshot.defaults);
      onToast({
        tone: "success",
        title: "系统设置已生效",
        message: "最新配置已经写入后台，并会影响后续注册、建号和治理流程。",
      });
    } catch (error) {
      onToast({
        tone: "error",
        title: "保存失败",
        message: getErrorMessage(error, "保存系统设置失败，请稍后重试。"),
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="p-4 lg:p-6">
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.28em]" style={{ color: "#f97316" }}>
            System Controls
          </div>
          <h1 className="mt-2 text-3xl font-semibold" style={{ color: theme.textPrimary }}>
            系统设置
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6" style={{ color: theme.textSecondary }}>
            用统一的 KV 配置中心管理平台名称、计费策略、安全开关和通知规则，保存后立即作用于后台治理逻辑。
          </p>
        </div>

        <div className="inline-flex items-center gap-2 rounded-2xl border bg-white px-4 py-3 text-sm" style={{ borderColor: theme.cardBorder, color: theme.textMuted }}>
          <ShieldCheck className="h-4 w-4 text-[#ff7a59]" />
          仅 super_admin 可修改系统配置
        </div>
      </div>

      {isLoading ? (
        <SettingsSkeleton />
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          {SETTINGS_SECTIONS.map((section) => (
            <section
              key={section.category}
              className="rounded-[28px] border bg-white p-6 shadow-[0_18px_48px_rgba(15,23,42,0.05)]"
              style={{ borderColor: theme.cardBorder }}
            >
              <div className="mb-6">
                <h2 className="text-lg font-semibold" style={{ color: theme.textPrimary }}>
                  {section.title}
                </h2>
                <p className="mt-2 text-sm leading-6" style={{ color: theme.textMuted }}>
                  {section.description}
                </p>
              </div>

              <div className="space-y-4">
                {section.fields
                  .filter((field) => !field.hidden)
                  .map((field) => {
                  const item = metadata[field.key];
                  const value = formValues[field.key];

                  if (field.type === "boolean") {
                    const enabled = Boolean(value);
                    return (
                      <div
                        key={field.key}
                        className="rounded-[24px] border border-slate-200 bg-slate-50/80 px-5 py-4"
                      >
                        <div className="flex items-center justify-between gap-4">
                          <div className="pr-4">
                            <div className="text-sm font-medium" style={{ color: theme.textPrimary }}>
                              {field.label}
                            </div>
                            <div className="mt-1 text-xs leading-5" style={{ color: theme.textMuted }}>
                              {item?.description ?? "切换该配置项的开关状态。"}
                            </div>
                          </div>
                          <button
                            aria-checked={enabled}
                            className={`relative inline-flex h-7 w-12 shrink-0 rounded-full transition ${enabled ? "bg-[#ff7a59]" : "bg-slate-300"}`}
                            onClick={() => handleInputChange(field.key, !enabled)}
                            role="switch"
                            type="button"
                          >
                            <span
                              className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition ${enabled ? "left-6" : "left-1"}`}
                            />
                          </button>
                        </div>
                        {section.category === "security" ? renderSecurityExpansion(field) : null}
                      </div>
                    );
                  }

                  return (
                    <label key={field.key} className="block">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <span className="text-sm font-medium" style={{ color: theme.textPrimary }}>
                          {field.label}
                        </span>
                        <span className="text-[11px]" style={{ color: theme.textMuted }}>
                          {item?.description ?? "可直接编辑该配置项。"}
                        </span>
                      </div>
                      <input
                        className="h-12 w-full rounded-2xl border border-transparent bg-slate-100/90 px-4 text-sm text-slate-900 outline-none transition focus:border-[#ff7a59] focus:bg-white focus:ring-4 focus:ring-red-100"
                        inputMode={field.inputMode}
                        onChange={(event) => handleInputChange(field.key, event.target.value)}
                        placeholder={field.placeholder}
                        type={field.type === "number" ? "number" : "text"}
                        value={typeof value === "string" ? value : ""}
                      />
                    </label>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <div className="mt-6 flex flex-col gap-3 rounded-[28px] border bg-white px-5 py-4 shadow-[0_18px_48px_rgba(15,23,42,0.04)] sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: theme.cardBorder }}>
        <button
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#ff7a59] px-5 text-sm font-semibold text-white transition hover:bg-[#f26d4c] disabled:cursor-not-allowed disabled:opacity-70"
          disabled={isLoading || isSaving || !isDirty}
          onClick={() => {
            void handleSave();
          }}
          type="button"
        >
          {isSaving ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
          保存设置
        </button>

        <button
          className="inline-flex h-11 items-center justify-center rounded-xl border bg-white px-5 text-sm font-medium transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
          disabled={isLoading || isSaving}
          onClick={handleResetToDefault}
          style={{ borderColor: theme.cardBorder, color: theme.textSecondary }}
          type="button"
        >
          重置为默认
        </button>
      </div>
    </div>
  );
}
