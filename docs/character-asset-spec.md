# StudyMate 角色状态资产规范

> 日期：2026-08-11
> 状态：初版规范，作为角色状态图制作的验收基准
> 适用范围：四个角色（芽团 tuanzi / 晴川 lu_xingye / 凛川 shen_ye / 柚宁 su_nian）的状态图资产
> 关联：[web companion 方案](./plans/2026-08-11-web-companion-study-studio-plan.md) §3.1、§5.3、§8

## 1. 背景与目标

- 现有四张精灵图（`web/public/mascot/*_sprite_8x256.png`）是**动作合集横向条**，存在抠图残边、裁切、相邻动作污染，且不同动作轮廓差异大，直接循环播放会产生跳变，**不能作为正式资产上线**。
- 目标：为每个角色制作**统一画布上的独立状态图**，让桌宠能在 `idle / reading / thinking / working / success / concern / waiting / sleeping / waving` 之间真实切换。
- 桌宠主体**只采用 CSS 微动**（呼吸、轻微位移），**不把动作合集当连续动画播放**，并完整支持 `prefers-reduced-motion`。

## 2. 状态清单

| 状态 | 触发场景 | 视觉要点 |
|---|---|---|
| `idle` | 默认待机，无任何请求/学习事件 | 表情自然放松，可配呼吸 CSS 微动 |
| `reading` | 正在阅读 Focus 原材料 / 概念定义 | 视线朝向内容、安静专注 |
| `thinking` | 有真实请求进行中（fetch 生命周期 active > 0），如生成 AI 解释、提交测验 | 视线抬起、轻微偏头 |
| `working` | 学习/答题进行中 | 握笔/前倾等「做事」姿态 |
| `success` | 请求全部成功 / 任务完成 / 高分 | 抬手庆祝、笑容明显 |
| `concern` | 最后一个请求失败（网络 / LLM 出错）、低分 | 垂落、担忧、不夸张 |
| `waiting` | 等待用户操作、无考试项目引导态 | 张望、耐心 |
| `sleeping` | 长时间无操作 / 深夜时段 | 闭眼、放松蜷缩 |
| `waving` | 欢迎 / 打招呼 | 挥手、睁眼 |

> 触发优先级建议：`sleeping`（长期无操作）< `idle` < `waiting`（引导态）< `reading / working`（学习态）< `thinking`（请求中）< `success / concern`（结果反馈）。结果反馈短暂展示后回落 `idle`。

## 3. 画布规范（统一画布）

- **尺寸**：设计稿 1024×1024 方形画布，导出时可按需缩放。
- **安全区**：四周保留 10% 留白（角色最外轮廓距画布边缘 ≥ 10% 边长），避免裁切。
- **脚底对齐**：所有状态的脚底 Y 坐标落于同一条基准线（基准线 = 画布高度 88% 处），保证状态切换时角色不上下跳动。
- **视觉中心**：角色头部/视觉重心位于画布水平中心 ±2% 内。
- **缩放一致**：不同状态的角色整体缩放比例一致（±1%），不因动作改变角色大小。

## 4. 资源格式与命名

- **格式**：透明背景 PNG（优先）或 WebP。PNG 要求无 alpha 残边（见 §8 验收）。
- **命名**：`{character_id}_{state}.png`，小写 + 下划线，例如：
  - `tuanzi_idle.png` / `tuanzi_thinking.png` / `tuanzi_success.png` …
  - `lu_xingye_idle.png` / `shen_ye_working.png` / `su_nian_waving.png` …
- **目录**：统一放在 `web/public/mascot/`（与现有精灵表同目录），文件名即映射键。

## 5. 资源映射配置

- 在 `web/src/components/Mascot.tsx` 维护 `STATE_BY_CHARACTER` 映射（替代当前的 `SPRITE_BY_CHARACTER`），结构：

```ts
type StateName = 'idle' | 'reading' | 'thinking' | 'working' | 'success' | 'concern' | 'waiting' | 'sleeping' | 'waving';

const STATE_BY_CHARACTER: Record<string, Record<StateName, string>> = {
  lu_xingye: {
    idle: '/mascot/lu_xingye_idle.png',
    thinking: '/mascot/lu_xingye_thinking.png',
    // …其余状态
  },
  // …
};
```

- 未到位的状态允许回退：缺失状态回退到该角色的 `idle`，`idle` 缺失回退到通用占位。**前端必须容错，不能因资产缺失白屏。**

## 6. 动画约束

- 桌宠主体**只用 CSS 微动**：呼吸（`transform: scale(1.0 → 1.02)`）、轻微上下位移（`translateY(±2px)`），时长 2–3s 缓动循环。
- **禁止**：把多帧动作合集作为连续动画循环；高频粒子、闪烁、大幅位移。
- `prefers-reduced-motion: reduce` 下，所有持续动画停止（当前 `global.css` 的 `.mascot-sprite.idle`、`.pet-bubble` 已遵循，新增动画同规则）。

## 7. 现有资产过渡方案

| 资产 | 现状 | 过渡处理 |
|---|---|---|
| `web/public/mascot/*_sprite_8x256.png` | 动作合集条，有色边/裁切/跳变问题 | 作为过渡占位；正式状态图逐张替换后下线 |
| `web/public/portraits/<id>/*.svg` | 每角色 4 情绪（neutral/happy/worried/celebrating） | 可先扩展 SVG 状态集支撑第一版表现，验证状态驱动价值后再投入独立 PNG |
| 状态图（新） | — | 按本规范制作，优先 `idle / thinking / success / concern / waiting` 5 个高频状态，其余逐步补齐 |

## 8. 验收检查清单

- [ ] 透明背景，边缘无绿色或粉色残边（放大 4 倍检查 1px 边界）。
- [ ] 角色主体不被画布裁切（满足 §3 安全区）。
- [ ] 不同状态的脚底、视觉中心、缩放比例一致（§3 三项分别核对）。
- [ ] Focus / 学习界面中没有持续跳跃或高频粒子动画（§6）。
- [ ] 开启减少动态效果后，持续动画停止。
- [ ] 状态缺失时前端正常回退，不白屏（§5）。
- [ ] 映射到真实状态机：`thinking` 仅在请求进行中出现，`success/concern` 仅由真实结果触发（对应 Task 5 的请求状态总线）。

## 9. 开放问题

1. **商业使用权**：正式发布前需确认原始角色图片的商用与再分发权（计划 §5.3）。
2. **状态优先级**：`sleeping` 的触发（长时间无操作 vs 深夜时段）与 `waving` 的首次展示时机，待产品确认。
3. **主题化**：状态图是否需要随 Ambient Theme（P1）换肤，若需要则状态图必须保持可上色/可叠加，避免每套主题各做一套。
