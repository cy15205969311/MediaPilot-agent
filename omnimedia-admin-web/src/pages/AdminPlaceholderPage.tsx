import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CheckCircle,
  Clock,
  Download,
  Edit,
  Eye,
  FileText,
  Filter,
  MoreVertical,
  Plus,
  RefreshCw,
  Shield,
} from "lucide-react";

import { fetchAdminUsers } from "../api";
import type { AdminUserItem } from "../types";
import { formatNumber } from "../utils/format";

type AdminPlaceholderPageProps = {
  badge: string;
  title: string;
  description: string;
  highlights: string[];
  icon: ReactNode;
  ctaLabel?: string;
  ctaTo?: string;
};

const theme = {
  primary: "rgb(244, 63, 94)",
  secondary: "rgb(251, 146, 60)",
  primaryLight: "rgb(254, 242, 242)",
  cardBg: "rgb(255, 255, 255)",
  cardBorder: "rgb(226, 232, 240)",
  cardHover: "rgb(254, 242, 242)",
  textPrimary: "rgb(30, 41, 59)",
  textSecondary: "rgb(71, 85, 105)",
  textMuted: "rgb(148, 163, 184)",
  success: "rgb(34, 197, 94)",
  warning: "rgb(251, 191, 36)",
  error: "rgb(239, 68, 68)",
  info: "rgb(59, 130, 246)",
};

export function AdminPlaceholderPage(props: AdminPlaceholderPageProps) {
  const { title } = props;
  const [users, setUsers] = useState<AdminUserItem[]>([]);

  useEffect(() => {
    let ignore = false;

    const loadUsers = async () => {
      try {
        const payload = await fetchAdminUsers({ skip: 0, limit: 100 });
        if (!ignore) {
          setUsers(payload.items);
        }
      } catch {
        if (!ignore) {
          setUsers([]);
        }
      }
    };

    void loadUsers();
    return () => {
      ignore = true;
    };
  }, [setUsers]);

  const derived = useMemo(() => {
    const totalBalance = users.reduce((sum, user) => sum + user.token_balance, 0);
    return {
      superAdmins: users.filter((user) => user.role === "super_admin").length || 2,
      operators: users.filter((user) => user.role === "operator").length || 8,
      admins: users.filter((user) => user.role === "admin").length || 3,
      totalBalance,
      topUsers: [...users]
        .sort((a, b) => b.token_balance - a.token_balance)
        .slice(0, 3),
    };
  }, [users]);

  if (title.includes("角色权限")) {
    return <RolesModule superAdmins={derived.superAdmins} operators={derived.operators} admins={derived.admins} />;
  }
  if (title.includes("Token")) {
    return <TokensModule totalBalance={derived.totalBalance} users={users} />;
  }
  if (title.includes("审计")) {
    return <AuditModule users={users} />;
  }
  if (title.includes("模板")) {
    return <TemplatesModule />;
  }
  if (title.includes("存储")) {
    return <StorageModule topUsers={derived.topUsers} />;
  }
  if (title.includes("系统设置")) {
    return <SettingsModule />;
  }

  return <TemplatesModule />;
}

function RolesModule(props: { superAdmins: number; operators: number; admins: number }) {
  const roles = [
    {
      name: "超级管理员",
      users: props.superAdmins,
      color: theme.error,
      permissions: ["所有权限", "用户管理", "系统配置", "数据管理", "审计日志"],
    },
    {
      name: "运营人员",
      users: props.operators,
      color: theme.warning,
      permissions: ["用户管理", "内容审核", "数据查看", "Token管理"],
    },
    {
      name: "财务人员",
      users: props.admins,
      color: theme.info,
      permissions: ["财务报表", "Token流水", "用户充值", "数据导出"],
    },
  ];

  return (
    <div className="p-4 lg:p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold" style={{ color: theme.textPrimary }}>
          角色权限管理
        </h1>
        <button className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-red-500 to-orange-400 px-4 py-2 text-sm font-medium text-white">
          <Plus className="h-4 w-4" />
          新建角色
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {roles.map((role) => (
          <div
            key={role.name}
            className="rounded-xl p-6"
            style={{ backgroundColor: theme.cardBg, border: `1px solid ${theme.cardBorder}` }}
          >
            <div className="mb-4 flex items-center justify-between">
              <div
                className="flex h-12 w-12 items-center justify-center rounded-xl"
                style={{ backgroundColor: `${role.color}20` }}
              >
                <Shield className="h-6 w-6" style={{ color: role.color }} />
              </div>
              <button
                className="flex h-8 w-8 items-center justify-center rounded-lg"
                style={{ backgroundColor: theme.primaryLight }}
              >
                <MoreVertical className="h-4 w-4" style={{ color: theme.primary }} />
              </button>
            </div>
            <h3 className="mb-1 font-semibold" style={{ color: theme.textPrimary }}>
              {role.name}
            </h3>
            <div className="mb-4 text-sm" style={{ color: theme.textMuted }}>
              {role.users} 个成员
            </div>
            <div className="space-y-2">
              {role.permissions.map((perm) => (
                <div
                  key={perm}
                  className="flex items-center gap-2 text-sm"
                  style={{ color: theme.textSecondary }}
                >
                  <CheckCircle className="h-4 w-4" style={{ color: theme.success }} />
                  {perm}
                </div>
              ))}
            </div>
            <div className="mt-6 flex gap-2">
              <button
                className="flex-1 rounded-lg px-3 py-2 text-sm font-medium"
                style={{ backgroundColor: theme.primaryLight, color: theme.primary }}
              >
                编辑权限
              </button>
              <button
                className="rounded-lg px-3 py-2 text-sm"
                style={{ backgroundColor: theme.primaryLight, color: theme.primary }}
              >
                <Edit className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TokensModule(props: { totalBalance: number; users: AdminUserItem[] }) {
  const totalBalance = props.totalBalance || 128_500_000;
  const rows = props.users.slice(0, 5).map((user, index) => ({
    time: `2026-05-03 ${14 - Math.floor(index / 2)}:${index % 2 ? "15" : "23"}:${index % 2 ? "32" : "11"}`,
    user: user.nickname?.trim() || user.username,
    type: index === 1 ? "充值" : index === 4 ? "系统赠送" : "消耗",
    amount: index === 1 ? 50000 : index === 4 ? 1000 : -Math.max(890, Math.round(user.token_balance * 0.01)),
    balance: user.token_balance,
    note: index === 1 ? "在线充值" : index === 4 ? "新用户奖励" : "内容生成",
  }));

  const fallbackRows = [
    { time: "2026-05-03 14:23:11", user: "李小美", type: "消耗", amount: -1250, balance: 123750, note: "GPT-4 对话" },
    { time: "2026-05-03 14:15:32", user: "张创作者", type: "充值", amount: 50000, balance: 50000, note: "在线充值" },
    { time: "2026-05-03 14:08:45", user: "王运营", type: "消耗", amount: -890, balance: 88110, note: "内容生成" },
  ];

  return (
    <div className="p-4 lg:p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold" style={{ color: theme.textPrimary }}>
          Token流水管理
        </h1>
        <button
          className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm"
          style={{ backgroundColor: theme.cardBg, border: `1px solid ${theme.cardBorder}`, color: theme.textSecondary }}
        >
          <Download className="h-4 w-4" />
          导出报表
        </button>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "今日消耗", value: "1.2M", trend: "+12.3%", color: theme.error },
          { label: "今日充值", value: "2.5M", trend: "+8.1%", color: theme.success },
          { label: "本月消耗", value: "32.1M", trend: "+15.2%", color: theme.warning },
          { label: "账户余额", value: `${(totalBalance / 1_000_000).toFixed(1)}M`, trend: "-2.3%", color: theme.info },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl p-5" style={{ backgroundColor: theme.cardBg, border: `1px solid ${theme.cardBorder}` }}>
            <div className="mb-2 text-sm" style={{ color: theme.textSecondary }}>{stat.label}</div>
            <div className="mb-1 text-2xl font-bold" style={{ color: theme.textPrimary }}>{stat.value}</div>
            <div className="text-sm" style={{ color: stat.trend.startsWith("+") ? theme.success : theme.error }}>{stat.trend}</div>
          </div>
        ))}
      </div>

      <DataTable
        headers={["时间", "用户", "操作类型", "数量", "余额", "备注"]}
        rows={(rows.length ? rows : fallbackRows).map((tx) => [
          tx.time,
          tx.user,
          <Tag key="type" tone={tx.amount > 0 ? "success" : "error"}>{tx.type}</Tag>,
          <span key="amount" className="font-semibold" style={{ color: tx.amount > 0 ? theme.success : theme.error }}>
            {tx.amount > 0 ? "+" : ""}{formatNumber(tx.amount)}
          </span>,
          formatNumber(tx.balance),
          <span key="note" style={{ color: theme.textMuted }}>{tx.note}</span>,
        ])}
      />
    </div>
  );
}

function AuditModule(props: { users: AdminUserItem[] }) {
  const names = props.users.map((user) => user.nickname?.trim() || user.username);
  const logs = [
    { time: "2026-05-03 14:23:11", admin: "张管理员", action: "修改用户角色", target: names[0] || "李小美", detail: "普通用户 → 高级用户", level: "warning" },
    { time: "2026-05-03 14:15:32", admin: "王运营", action: "手动充值", target: names[1] || "张创作者", detail: "充值 50,000 Token", level: "info" },
    { time: "2026-05-03 14:08:45", admin: "张管理员", action: "冻结账户", target: names[2] || "违规用户001", detail: "原因：刷量作弊", level: "error" },
    { time: "2026-05-03 13:56:22", admin: "系统", action: "自动备份", target: "数据库", detail: "备份成功 (2.3GB)", level: "success" },
    { time: "2026-05-03 13:45:18", admin: "李运营", action: "删除模板", target: "过期模板#123", detail: "已归档至回收站", level: "warning" },
  ];

  return (
    <div className="p-4 lg:p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold" style={{ color: theme.textPrimary }}>审计日志</h1>
        <div className="flex gap-2">
          <OutlineButton icon={<Filter className="h-4 w-4" />} label="筛选" />
          <OutlineButton icon={<Download className="h-4 w-4" />} label="导出" />
        </div>
      </div>
      <div className="space-y-3">
        {logs.map((log) => (
          <div key={`${log.time}-${log.action}`} className="rounded-xl p-4" style={{ backgroundColor: theme.cardBg, border: `1px solid ${theme.cardBorder}` }}>
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${levelColor(log.level)}20` }}>
                <FileText className="h-5 w-5" style={{ color: levelColor(log.level) }} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center gap-3">
                  <span className="font-medium" style={{ color: theme.textPrimary }}>{log.action}</span>
                  <span className="rounded px-2 py-0.5 text-xs" style={{ backgroundColor: theme.primaryLight, color: theme.textMuted }}>{log.admin}</span>
                </div>
                <div className="mb-1 text-sm" style={{ color: theme.textSecondary }}>目标: <span className="font-medium">{log.target}</span></div>
                <div className="text-sm" style={{ color: theme.textMuted }}>{log.detail}</div>
                <div className="mt-2 flex items-center gap-2 text-xs" style={{ color: theme.textMuted }}>
                  <Clock className="h-3 w-3" />
                  {log.time}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TemplatesModule() {
  const templates = [
    { name: "小红书种草笔记", category: "小红书", uses: 2345, rating: 4.8, status: "active" },
    { name: "抖音短视频脚本", category: "抖音", uses: 1876, rating: 4.9, status: "active" },
    { name: "产品测评模板", category: "通用", uses: 1234, rating: 4.7, status: "active" },
    { name: "探店打卡模板", category: "小红书", uses: 987, rating: 4.6, status: "active" },
    { name: "好物推荐模板", category: "小红书", uses: 856, rating: 4.5, status: "inactive" },
    { name: "知识分享模板", category: "抖音", uses: 743, rating: 4.8, status: "active" },
  ];

  return (
    <div className="p-4 lg:p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold" style={{ color: theme.textPrimary }}>模板库管理</h1>
        <button className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-red-500 to-orange-400 px-4 py-2 text-sm font-medium text-white">
          <Plus className="h-4 w-4" />
          新建模板
        </button>
      </div>
      <div className="mb-6 flex gap-2 overflow-x-auto">
        {["全部模板", "小红书", "抖音", "通用", "自定义"].map((cat, index) => (
          <button key={cat} className="whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium" style={{ backgroundColor: index === 0 ? theme.primaryLight : theme.cardBg, border: `1px solid ${index === 0 ? theme.primary : theme.cardBorder}`, color: index === 0 ? theme.primary : theme.textSecondary }}>{cat}</button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {templates.map((template) => (
          <div key={template.name} className="rounded-xl p-5" style={{ backgroundColor: theme.cardBg, border: `1px solid ${theme.cardBorder}` }}>
            <div className="mb-3 flex items-start justify-between">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-red-500 to-orange-400">
                <FileText className="h-6 w-6 text-white" />
              </div>
              <div className="flex gap-1">
                <div className="h-2 w-2 rounded-full" style={{ backgroundColor: template.status === "active" ? theme.success : theme.textMuted }} />
              </div>
            </div>
            <h3 className="mb-1 font-semibold" style={{ color: theme.textPrimary }}>{template.name}</h3>
            <div className="mb-3 text-sm" style={{ color: theme.textMuted }}>{template.category}</div>
            <div className="mb-4 flex items-center justify-between text-sm">
              <div style={{ color: theme.textSecondary }}>使用 {formatNumber(template.uses)} 次</div>
              <div className="flex items-center gap-1" style={{ color: theme.warning }}><span>★</span><span>{template.rating}</span></div>
            </div>
            <div className="flex gap-2">
              <button className="flex-1 rounded-lg px-3 py-2 text-sm font-medium" style={{ backgroundColor: theme.primaryLight, color: theme.primary }}>编辑</button>
              <IconButton icon={<Eye className="h-4 w-4" />} />
              <IconButton icon={<MoreVertical className="h-4 w-4" />} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StorageModule(props: { topUsers: AdminUserItem[] }) {
  const ranking = props.topUsers.length
    ? props.topUsers.map((user, index) => ({
        rank: index + 1,
        user: user.nickname?.trim() || user.username,
        storage: `${Math.max(89, Math.round(user.token_balance / 1000))}MB`,
        files: Math.max(543, Math.round(user.token_balance / 100)),
        lastUpload: index === 0 ? "2小时前" : index === 1 ? "5小时前" : "1天前",
      }))
    : [
        { rank: 1, user: "王运营", storage: "200MB", files: 1234, lastUpload: "2小时前" },
        { rank: 2, user: "李小美", storage: "128MB", files: 876, lastUpload: "5小时前" },
        { rank: 3, user: "张创作者", storage: "89MB", files: 543, lastUpload: "1天前" },
      ];

  return (
    <div className="p-4 lg:p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold" style={{ color: theme.textPrimary }}>存储治理</h1>
        <OutlineButton icon={<RefreshCw className="h-4 w-4" />} label="刷新统计" />
      </div>
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl p-6" style={{ backgroundColor: theme.cardBg, border: `1px solid ${theme.cardBorder}` }}>
          <h3 className="mb-4 font-semibold" style={{ color: theme.textPrimary }}>总存储使用情况</h3>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm" style={{ color: theme.textSecondary }}>已使用</span>
            <span className="text-2xl font-bold" style={{ color: theme.textPrimary }}>856 GB</span>
          </div>
          <div className="mb-2 h-4 w-full rounded-full" style={{ backgroundColor: theme.primaryLight }}>
            <div className="h-4 rounded-full bg-gradient-to-r from-red-500 to-orange-400" style={{ width: "68%" }} />
          </div>
          <div className="flex justify-between text-sm" style={{ color: theme.textMuted }}><span>总容量 1TB</span><span>剩余 168 GB</span></div>
        </div>
        <div className="rounded-xl p-6" style={{ backgroundColor: theme.cardBg, border: `1px solid ${theme.cardBorder}` }}>
          <h3 className="mb-4 font-semibold" style={{ color: theme.textPrimary }}>文件类型分布</h3>
          <div className="space-y-3">
            {[
              { type: "图片", size: "456 GB", percentage: 53, color: theme.primary },
              { type: "视频", size: "234 GB", percentage: 27, color: theme.secondary },
              { type: "文档", size: "123 GB", percentage: 14, color: theme.info },
              { type: "其他", size: "43 GB", percentage: 6, color: theme.textMuted },
            ].map((item) => (
              <div key={item.type}>
                <div className="mb-1 flex justify-between text-sm"><span style={{ color: theme.textSecondary }}>{item.type}</span><span style={{ color: theme.textPrimary }}>{item.size}</span></div>
                <div className="h-2 w-full rounded-full" style={{ backgroundColor: theme.primaryLight }}><div className="h-2 rounded-full" style={{ width: `${item.percentage}%`, backgroundColor: item.color }} /></div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <DataTable
        title="用户存储排行"
        headers={["排名", "用户", "存储使用", "文件数量", "最近上传", "操作"]}
        rows={ranking.map((item, index) => [
          <div key="rank" className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold" style={{ backgroundColor: index === 0 ? `${theme.warning}20` : theme.primaryLight, color: index === 0 ? theme.warning : theme.textPrimary }}>{item.rank}</div>,
          item.user,
          <span key="storage" className="font-semibold" style={{ color: theme.textPrimary }}>{item.storage}</span>,
          formatNumber(item.files),
          <span key="last" style={{ color: theme.textMuted }}>{item.lastUpload}</span>,
          <button key="action" className="rounded-lg px-3 py-1 text-sm" style={{ backgroundColor: theme.primaryLight, color: theme.primary }}>查看详情</button>,
        ])}
      />
    </div>
  );
}

function SettingsModule() {
  return (
    <div className="p-4 lg:p-6">
      <h1 className="mb-6 text-2xl font-bold" style={{ color: theme.textPrimary }}>系统设置</h1>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SettingsCard title="基础设置" rows={[
          ["系统名称", "OmniMedia Console"],
          ["管理员邮箱", "admin@omnimedia.com"],
          ["时区设置", "UTC+8 (北京时间)"],
          ["语言", "简体中文"],
        ]} />
        <SettingsCard title="Token配置" editable rows={[
          ["Token单价", "¥0.008/Token"],
          ["新用户赠送", "1,000 Token"],
          ["每日免费额度", "100 Token"],
          ["最低充值", "10,000 Token"],
        ]} />
        <SwitchCard title="安全设置" rows={[
          ["双因素认证", true],
          ["IP白名单", false],
          ["登录验证码", true],
          ["会话超时", true],
        ]} />
        <SwitchCard title="通知设置" rows={[
          ["用户注册通知", true],
          ["异常告警通知", true],
          ["系统维护通知", false],
          ["每日报表推送", true],
        ]} />
      </div>
      <div className="mt-6 flex gap-3">
        <button className="rounded-lg bg-gradient-to-r from-red-500 to-orange-400 px-6 py-2 text-sm font-medium text-white">保存设置</button>
        <button className="rounded-lg px-6 py-2 text-sm font-medium" style={{ backgroundColor: theme.cardBg, border: `1px solid ${theme.cardBorder}`, color: theme.textSecondary }}>重置为默认</button>
      </div>
    </div>
  );
}

function DataTable(props: { title?: string; headers: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-hidden rounded-xl" style={{ backgroundColor: theme.cardBg, border: `1px solid ${theme.cardBorder}` }}>
      {props.title ? <div className="border-b p-4" style={{ borderColor: theme.cardBorder }}><h3 className="font-semibold" style={{ color: theme.textPrimary }}>{props.title}</h3></div> : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px]">
          <thead>
            <tr style={{ backgroundColor: theme.primaryLight }}>
              {props.headers.map((header) => <th key={header} className="px-4 py-3 text-left text-sm font-semibold" style={{ color: theme.textPrimary }}>{header}</th>)}
            </tr>
          </thead>
          <tbody>
            {props.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="transition-colors hover:bg-red-50" style={{ borderTop: `1px solid ${theme.cardBorder}` }}>
                {row.map((cell, cellIndex) => <td key={cellIndex} className="px-4 py-4 text-sm" style={{ color: theme.textSecondary }}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SettingsCard(props: { title: string; rows: string[][]; editable?: boolean }) {
  return (
    <div className="rounded-xl p-6" style={{ backgroundColor: theme.cardBg, border: `1px solid ${theme.cardBorder}` }}>
      <h3 className="mb-4 font-semibold" style={{ color: theme.textPrimary }}>{props.title}</h3>
      <div className="space-y-4">
        {props.rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between">
            <span className="text-sm" style={{ color: theme.textSecondary }}>{label}</span>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium" style={{ color: theme.textPrimary }}>{value}</span>
              {props.editable ? <IconButton icon={<Edit className="h-3 w-3" />} small /> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SwitchCard(props: { title: string; rows: Array<[string, boolean]> }) {
  return (
    <div className="rounded-xl p-6" style={{ backgroundColor: theme.cardBg, border: `1px solid ${theme.cardBorder}` }}>
      <h3 className="mb-4 font-semibold" style={{ color: theme.textPrimary }}>{props.title}</h3>
      <div className="space-y-3">
        {props.rows.map(([label, enabled]) => <div key={label} className="flex items-center justify-between"><span className="text-sm" style={{ color: theme.textSecondary }}>{label}</span><Switch enabled={enabled} /></div>)}
      </div>
    </div>
  );
}

function Switch(props: { enabled: boolean }) {
  return <button className="h-6 w-12 rounded-full transition-all" style={{ backgroundColor: props.enabled ? theme.success : theme.textMuted }}><div className="h-5 w-5 rounded-full bg-white transition-all" style={{ marginLeft: props.enabled ? "26px" : "2px" }} /></button>;
}

function Tag(props: { tone: "success" | "error"; children: ReactNode }) {
  const color = props.tone === "success" ? theme.success : theme.error;
  return <span className="rounded px-2 py-1 text-xs font-medium" style={{ backgroundColor: `${color}20`, color }}>{props.children}</span>;
}

function OutlineButton(props: { icon: ReactNode; label: string }) {
  return <button className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm" style={{ backgroundColor: theme.cardBg, border: `1px solid ${theme.cardBorder}`, color: theme.textSecondary }}>{props.icon}{props.label}</button>;
}

function IconButton(props: { icon: ReactNode; small?: boolean }) {
  return <button className={`${props.small ? "h-6 w-6" : "px-3 py-2"} flex items-center justify-center rounded-lg`} style={{ backgroundColor: theme.primaryLight, color: theme.primary }}>{props.icon}</button>;
}

function levelColor(level: string) {
  if (level === "error") return theme.error;
  if (level === "warning") return theme.warning;
  if (level === "success") return theme.success;
  return theme.info;
}
