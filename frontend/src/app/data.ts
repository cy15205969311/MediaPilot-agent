import { Lightbulb, MessageSquare, Sparkles, TrendingUp } from "lucide-react";

import type { ConversationMessage, ThreadItem, UiTaskType } from "./types";

// 核心任务类型（这部分本身是业务中立的，完美契合任何新媒体内容流，直接保留）
export const taskOptions: Array<{
  id: UiTaskType;
  label: string;
  icon: typeof Lightbulb;
}> = [
  { id: "topic_planning", label: "选题策划", icon: Lightbulb },
  { id: "content_generation", label: "内容生成", icon: Sparkles },
  { id: "hot_post_analysis", label: "爆款拆解", icon: TrendingUp },
  { id: "comment_reply", label: "评论回复", icon: MessageSquare },
];

// 快捷指令（去除了金融行业色彩，替换为全行业通用的高频内容痛点指令）
export const quickActions = [
  "帮我生成 7 天爆款选题池",
  "帮我拆解这篇对标账号的笔记",
  "将这篇图文改写成短视频口播脚本",
  "给我一组高转化率的评论区互动话术",
];

// ------------------------------------------------------------------
// 以下数据在真实 SaaS 环境中将被 API 响应覆盖 (fetchThreads 等)
// 这里提供通用的展示数据，防止在尚未接入 API 或数据为空时页面白屏。
// ------------------------------------------------------------------

// 历史会话初始化（覆盖不同场景：活动预热、日常运营、竞品分析）
export const initialThreads: ThreadItem[] = [
  {
    id: "thread-demo-001",
    title: "新品上市宣传期策划",
    time: "2 小时前",
    platform: "xiaohongshu",
  },
  {
    id: "thread-demo-002",
    title: "日常口播脚本优化",
    time: "昨天",
    platform: "douyin",
  },
  {
    id: "thread-demo-003",
    title: "竞品爆款起盘数据复盘",
    time: "3 天前",
    platform: "xiaohongshu",
  },
];

// 初始消息（作为新建会话时的默认欢迎语，主动引导用户去配置动态人设）
export const initialMessages: ConversationMessage[] = [
  {
    id: "welcome-agent-msg",
    role: "assistant",
    content: "你好！我是你的新媒体增长副驾。请在上方【会话设置】中告诉我你需要我扮演什么角色（例如：美妆品牌主理人、数码评测达人、生活方式博主），我会立刻切换到该语境为你服务。现在，你想让我做什么？",
    // 使用动态的本地时间戳生成，防止时间显示异常
    createdAt: new Date().toISOString(), 
  },
];