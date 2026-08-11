/**
 * 角色专属的空间氛围与场景台词（参考桌面宠物设计）。
 * Dashboard 首页与桌宠层共用。
 */

export interface RoleLines {
  /** 空间名，如「林间书桌 · 芽团」。 */
  label: string;
  /** 首页准备态台词。 */
  ready: string;
  /** 学习/测验专注态台词。 */
  focus: string;
  /** 学习完成复盘态台词。 */
  reflect: string;
}

export const ROLE_LINES: Record<string, RoleLines> = {
  tuanzi: {
    label: '林间书桌 · 芽团',
    ready: '先把这一小节做完，其他的晚点再管。',
    focus: '芽团在旁边。你学你的。',
    reflect: '今天又多记住了一点。',
  },
  lu_xingye: {
    label: '午后图书馆 · 晴川',
    ready: '别急，先把眼前这节吃透。',
    focus: '这部分慢一点没关系。',
    reflect: '今天推进得很稳。',
  },
  shen_ye: {
    label: '午夜自习室 · 凛川',
    ready: '别切页面。先把这题弄懂。',
    focus: '这题上次也错过。再来。',
    reflect: '这次记住了。',
  },
  su_nian: {
    label: '清晨校园 · 柚宁',
    ready: '搭档，先搞定第一项！',
    focus: '稳住稳住，马上就过这节！',
    reflect: '搞定！今天进度漂亮。',
  },
};

/** 按路由推断当前学习场景。 */
export function sceneFromPath(path: string): keyof Omit<RoleLines, 'label'> {
  if (path.startsWith('/tasks') || path.startsWith('/quiz') || path.startsWith('/grade')) {
    return 'focus';
  }
  return 'ready';
}
