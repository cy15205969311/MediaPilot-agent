import {
  Image as ImageIcon,
  Lightbulb,
  MessageSquare,
  Sparkles,
  TrendingUp,
} from "lucide-react";

import type { ConversationMessage, ThreadItem, UiTaskType } from "./types";

export const taskOptions: Array<{
  id: UiTaskType;
  label: string;
  icon: typeof Lightbulb;
}> = [
  { id: "topic_planning", label: "选题策划", icon: Lightbulb },
  { id: "content_generation", label: "内容生成", icon: Sparkles },
  { id: "image_generation", label: "图片生成", icon: ImageIcon },
  { id: "hot_post_analysis", label: "爆款拆解", icon: TrendingUp },
  { id: "comment_reply", label: "评论回复", icon: MessageSquare },
];

export const quickActions = [
  "帮我生成 7 天爆款选题池",
  "帮我拆解这篇对标账号的笔记",
  "将这篇图文改写成短视频口播脚本",
  "给我一组高转化率的评论区互动话术",
];

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

export const initialMessages: ConversationMessage[] = [
  {
    id: "welcome-agent-msg",
    role: "assistant",
    content:
      "你好！我是你的新媒体增长副驾。请在上方会话设置中告诉我你希望我扮演的角色，我会立刻切换到对应语境，为你生成选题、正文、配图和互动回复。现在，你想先做哪一步？",
    createdAt: new Date().toISOString(),
  },
];
