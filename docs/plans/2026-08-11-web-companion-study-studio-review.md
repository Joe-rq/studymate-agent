# StudyMate 网页桌宠与学习闭环方案 — 代码现状核对与审查记录

> 日期：2026-08-11
> 审查对象：[2026-08-11-web-companion-study-studio-plan.md](./2026-08-11-web-companion-study-studio-plan.md)
> 审查方式：对计划中的技术判断逐条与代码现状核对（只读，未改任何产品代码）
> 状态：审查完成，计划仍暂不实施

## 1. 审查结论

计划整体成熟、可执行，架构方向（桌宠作轻量表达层、Focus 材料优先、AI 解释按需、复用现有闭环）成立。技术前提与代码现状高度吻合。存在 5 个需补充的点，其中 1 个（改名影响面漏文件）会导致实际不一致。P0 建议再拆两批，理由见 §4。

## 2. 技术前提核对表

| # | 计划判断 | 代码现状 | 结论 |
|---|---|---|---|
| 1 | React 前端 + 任务/Quiz/Grade/Buddy/掌握度/事件日志齐全 | `web/`、`src/agents/*`、`src/application/workflows/grade_and_adapt.ts` | ✅ 成立 |
| 2 | 后端无 Study Session 聚合对象，需新增应用层编排 | `src/server/app.ts` 仅有 /quiz、/grade、/task、/buddy 等单点接口 | ✅ 成立 |
| 3 | 角色稳定 ID 不变，只改显示层 | ID 为 `tuanzi`/`lu_xingye`/`shen_ye`/`su_nian`；前端 `web/src/components/Mascot.tsx:18-23` 精灵映射、`web/public/portraits/<id>/` 均用 ID | ✅ 成立且必要 |
| 4 | Dashboard 需减法 | `web/src/pages/Dashboard.tsx:75-116` 为 5 个统计卡 + 3 个 CTA | ✅ 成立 |
| 5 | 右侧常驻 BuddyPanel | `web/src/App.tsx:74-76` `<aside class="buddy-sidebar">` | ✅ 成立 |
| 6 | 任务类型含 learn/review，当前任务可选 | `src/agents/task_dispatcher.ts:11` 类型含 learn/review/quiz/buffer/sprint | ✅ 成立 |
| 7 | Concept 有 definition + relatedChunks | `src/agents/concept_mapper.ts:16-17` | ✅ 成立 |
| 8 | sourceLink 是本机绝对路径、不能暴露 | `src/agents/chunker.ts:16,250` `sourceLink = material.contentPath`；当前无任何 API 暴露 chunks | ✅ 成立 |
| 9 | 事件日志可追加新事件且 schema 兼容 | `src/core/event_log.ts` Event 含 schemaVersion，append 纯追加 | ✅ 成立 |
| 10 | Grade 前端类型需扩展 | `web/src/api.ts:61-73` `GradeResult` 缺 masteryChanges/adjustments/latestInsight | ✅ 成立 |
| 11 | 现有精灵条不能直接作为正式资产 | `Mascot.tsx:28-39` 注释确认 FRAME_BY_MOOD 来自像素分析、idle 为 8 帧整表循环 | ✅ 成立 |

## 3. 需补充 / 修正的点

### 3.1 改名影响面漏了一个文件（会导致不一致）

`src/core/mock_llm.ts`：
- `:102-108` 硬编码 `['陆星野','沈夜','苏念','团子']` → 角色 ID 映射表
- `:65-76` 硬编码"团子"台词（mock 聊天回复）

只改 `src/characters/*.json` 的 name 字段，**mock 模式（无 API Key 时的默认模式，见 `src/server/app.ts:31-36`）下的聊天回复与角色匹配仍用旧名**，与显示层新名不一致。

另：`docs/PRODUCT_INTRO.md:166-169` 角色表格是对外文档，改名需同步。

→ 改名清单应明确包含：4 个 characters JSON + mock_llm.ts + PRODUCT_INTRO.md + 前端文案（如设置页、聊天页），后端 ID 不变。

### 3.2 "打开到开始 Session 的时间"指标没有数据落点

计划 §6 说"使用本地事件衡量"，但现有事件日志是后端 `appendEvent`。从页面加载到点开 Focus 的耗时长在浏览器侧，不经后端。

→ 需明确：前端 localStorage 计时，或在 `study_session_started` 事件里由前端上报 `openToStartMs` 字段。否则该指标无法测量。

### 3.3 Agent Insight / 计划调整原因可直接复用已有数据

计划 §5.2 说"计划调整原因需要从现有工作流结果或事件中提取"。实际：
- `PlanAdjustment.reason` 已存在（`src/agents/plan_adjuster.ts:36`）
- `gradeAndAdapt` 已返回 `adjustments` 与 `latestInsight`（`src/application/workflows/grade_and_adapt.ts:52,58,183-192`）

→ 前端只需扩展 `GradeResult` 类型带回这两个字段即可，不需要新的"提取"逻辑。

### 3.4 Reflect 的"明日首项任务"没有现成接口

`/api/plan/today`（`src/server/app.ts:330`）只支持当天。

→ 需给接口加日期参数，或新增只读接口返回明日任务。

### 3.5 桌宠偏好模式需扩展 Buddy preferences 结构

现有 preferences 仅 `reminderIntensity`/`emotionalStyle`/`formOfAddress`（`src/domain/buddy.ts`，由 `src/server/app.ts:552-564` 写入）。

→ 新增 quiet/companion/off 模式字段需扩展该结构；`loadBuddyState`（`src/agents/buddy_state.ts:26-50`）已做字段补齐，向后兼容可行。

### 3.6 桌宠状态驱动应分层

计划 §4 的 `study_session_*` 事件只覆盖 Session 粒度；"请求进行中"的 waiting/working 粒度更细，后端事件来不及。

→ 建议：请求级状态由前端 fetch 生命周期驱动（pending→waiting、成功→happy、失败→concern），Session 级状态由后端事件驱动。两者拼成完整状态驱动。

### 3.7 资产成本可降：先复用现有 SVG portraits

现有 `web/public/portraits/<id>/*.svg` 每角色 4 状态（neutral/happy/worried/celebrating）。

→ 第一阶段可把 SVG 状态集扩展为统一画布的状态图，先验证"状态驱动"价值，再投入 9 状态 × 4 角色 = 36 张独立 PNG/WebP。

## 4. P0 拆分建议（详见对应讨论）

**同意拆分，且把它升级为"可独立验证的里程碑"，不是简单切两半。** 依据：

1. **两类工作性质不同、验证信号不同**
   - 表现/资产层（改名、Today 减法、桌宠、主题）：验证方式是"看起来对"，无法验证学习效果。
   - 行为/闭环层（Studio、Session 持久化、聚合接口、Reflect）：验证方式是"数据落盘、刷新恢复、指标改善"。
   - 混在一起 → 闭环验证被资产制作阻塞：36 张状态图没画完，整个 P0 无法发布，但"跑通闭环"与"状态图数量"无因果。

2. **失败回滚与定位成本不同**
   - P0a 不动后端数据与 schema，可整体回滚。
   - P0b 新增后端状态对象、接口、事件、幂等，出问题影响面大。
   - 一次合入 → 出问题时无法区分表现层问题还是闭环逻辑问题。

3. **顺序有因果：入口先行**
   - Today 减法 + 浮动桌宠是闭环入口，入口未改则 P0b 验证缺少样本。
   - 改名是纯显示层，应最先做，避免后续新 UI 文案带旧名上线。

### 拆分方案

| 批次 | 内容 | 验证信号 |
|---|---|---|
| P0a 入口与陪伴层 | 改名迁移（含 mock_llm.ts / PRODUCT_INTRO.md）、Today 减法（一个主 CTA）、浮动桌宠替换 BuddyPanel、桌宠接入前端请求生命周期、确定 9 状态清单与画布规范（资产不阻塞） | UX：首屏一个主 CTA、桌宠不遮挡、reduced-motion 生效、偏好保存 |
| P0b 学习闭环 | /studio 页面 + 聚合接口、Session 创建/恢复/推进/结束 + 幂等、Focus 材料 + 按需 AI 解释（可降级）、Quiz/Grade 复用 gradeAndAdapt + 前端类型扩展、Reflect 汇总、study_session_* 事件 | 行为数据：Mock LLM 黄金路径、数据真实落盘、刷新恢复、幂等、无绝对路径泄漏 |

**拆分不改变范围**：Today、Studio、Reflect、桌宠、改名均在交付物内，只改变交付节奏。P0a 可先上线观察入口 UX，P0b 专注闭环数据；第一阶段的核心行为指标（打开到开始 Session 时间、Session 完成率）在 P0b 结束后正式测量。

## 5. 待确认问题

1. 是否按 §4 拆分 P0？若同意，建议把本节的拆分表并入计划文档 §7。
2. "打开到 Session 的耗时"采用 localStorage 还是随 study_session_started 上报？（见 §3.2）
3. 资产第一阶段是否复用现有 SVG portraits？（见 §3.7）
