# StudyMate PRD 差距修复计划

> 日期：2026-08-15  
> 状态：已实施
> 依据：当前 `main` 分支代码审查、PRD v1.0、MVP PRD、Study Studio P0a/P0b 方案  
> 原则：先修数据正确性和学习闭环，再补体验、部署与文档；每一步保持可独立验证和回滚。

## 1. 总体判断

StudyMate 已具备完整的工程骨架：资料导入、切片、概念提取、计划、任务、测验、批改、错题、掌握度、计划调整、Study Studio 和备考搭子均有代码实现，当前 TypeScript 构建、Web 构建和 336 个测试通过。

但现阶段不能认定为“PRD 已完成”。主要阻塞不是页面完整度，而是以下业务正确性问题：

1. 计划生成在容量不足时会静默丢失概念。
2. 静态未来计划错误使用 SM-2 `dueDate`，导致到期后每天重复复习。
3. Study Studio 完成一次 Session 后，无法自然开始当天下一任务。
4. Session 信任前端回传的成绩和掌握度变化，后端不是唯一事实源。
5. Focus 结束即把旧任务标记为完成，可能污染 Tasks、CLI 和指标。
6. 无搜索 Key 时，Web 建档无法通过空 Mock 来源继续，也没有本地文件上传入口。
7. VPS 部署缺少访问控制，存在个人学习数据暴露风险。

## 2. 修复目标

完成本计划后，应满足以下核心结果：

- 每个可学习概念要么被排入计划，要么进入明确的 `unscheduledConcepts`，禁止静默丢失。
- 初始复习计划符合明确的固定间隔；真实作答后再由 SM-2 更新下一次复习日期。
- 用户能够在同一天连续完成多个任务，刷新后仍可恢复当前 Session。
- Quiz、Grade、Mastery、Plan Adjustment 和 Reflect 由服务端事务性编排，前端不能伪造成绩。
- 任务只有在定义清楚的完成点才进入 `done`，中途退出不应虚增完成率。
- 无外部 Key 时仍有一条可演示、可验证的本地资料闭环。
- 公网或 VPS 场景默认不裸露 API。
- 产品文档只声明已经过相应证据层验证的能力。

## 3. P0：计划正确性

### 3.1 禁止容量裁剪静默丢失概念

**现状**

`generatePlan()` 先把概念绑定到学习日，再按 `dailyMinutes` 过滤任务。超出容量的 `learn` 任务被直接跳过，不会顺延或报错。

**目标行为**

- 所有 `learningOrder` 中的可验证概念必须被处理。
- 优先向后续可学习日期顺延，跳过不可学习日和休息日。
- 如果考试前总容量仍不足，计划必须返回结构化缺口，不得假装成功。
- 人类确认计划前应看到容量不足的原因和取舍建议。

**建议数据结构**

```ts
interface PlanCapacitySummary {
  requiredMinutes: number;
  availableMinutes: number;
  scheduledConceptCount: number;
  unscheduledConceptIds: string[];
}
```

**最小修改范围**

- `src/agents/planner.ts`
- `src/server/app.ts` 的计划生成响应与错误映射
- `web/src/api.ts`
- `web/src/pages/Onboarding.tsx`
- `tests/agents/planner.test.ts`
- `tests/server/api.test.ts`

**验收标准**

- 40 个概念、14 天、每天 60 分钟的样本不再静默只安排 10 个概念。
- 容量足够时，所有概念至少出现一次 `learn`。
- 容量不足时，返回准确的 `unscheduledConceptIds`，计划确认页明确提示。
- 不可学习日期、每日上限和既有阶段规则仍然生效。

### 3.2 分离“初始计划”与“运行时 SM-2”

**现状**

Planner 在生成整张未来计划时初始化 `srState`，并用同一个静态 `dueDate` 判断所有未来日期。到期后，后续每天都会被视为 due。

**目标行为**

- 初次生成计划时使用确定性的固定间隔，例如 `1 → 3 → 7 → 15 → 30`。
- `srState` 只表示真实学习和真实复习后的运行时状态。
- 批改后通过 `processReview()` 更新下一次 due date。
- 计划调整只把最新 due date 对应的任务插入一次，并保持幂等。

**建议方案**

1. Planner 不再在生成未来计划时修改 `Concept.srState`。
2. 初始计划使用 `learnDayMap + REVIEW_INTERVALS` 生成固定复习任务。
3. 首次真实完成学习任务时创建初始 `srState`。
4. 每次真实批改后更新 `srState`，再由 PlanAdjuster 调整未来计划。

**最小修改范围**

- `src/agents/planner.ts`
- `src/agents/spaced_repetition.ts`
- `src/agents/mastery_tracker.ts`
- `src/agents/plan_adjuster.ts`
- 相应 Planner、SM-2、Mastery 和 PlanAdjuster 测试

**验收标准**

- 新概念不会从首次到期日起每天出现 `review`。
- 固定间隔测试明确断言复习日期，而不只断言“存在 review”。
- 一次批改只产生一个新的下次复习日期。
- 重复提交不会重复插入同一概念、同一日期的复习任务。

## 4. P1：Study Studio 真实闭环

### 4.1 支持当天连续任务

**现状**

`buildAggregate()` 把当天已完成 Session 继续当作当前 Session 返回；前端只有在 `session === null` 时显示启动器。因此第一个 Session 完成后，即使还有候选任务，也无法从 UI 开始下一项。

**目标行为**

需要先明确并固定一种模型：

- 推荐：一天允许多个 Session，每个 Session 负责一个主要学习/复习任务和一次关联测验。
- 完成当前 Session 后，返回 `nextTask` 和“继续下一项/结束今天”两个选择。
- 已完成 Session 进入历史记录，不再阻塞新的 active Session。

**最小修改范围**

- `src/application/workflows/study_session.ts`
- `src/application/workflows/session_history.ts`
- `src/server/app.ts`
- `web/src/pages/StudioPage.tsx`
- Study Session workflow/API/E2E 测试

**验收标准**

- 当天至少两项任务时，完成第一项后可启动第二项。
- 刷新页面只恢复 active Session，不把 completed Session 当成 active。
- `session_history` 每个完成 Session 只追加一次。
- 当天全部任务完成后才展示“今日任务已完成”。

### 4.2 让服务端成为 Grade 与 Reflect 的唯一事实源

**现状**

前端先调用 `/api/grade`，再把 `score`、`correct` 和 `masteryChanges` 提交到 `/api/studio/advance`。服务端没有校验这些数据是否来自真实批改回执。

**目标行为**

- 前端只提交 `sessionId`、`quizId` 和答案。
- 服务端原子执行：批改 → 错题 → 掌握度 → 计划调整 → Session 推进。
- Session 只记录服务端工作流产生的 Grade 结果。
- Reflect 从 Session 和批改回执读取数据，禁止使用客户端计算结果。

**推荐接口**

```http
POST /api/studio/grade
{
  "sessionId": "ss_...",
  "quizId": "quiz_...",
  "answers": []
}
```

响应直接返回更新后的 `StudioAggregate` 和服务端 Grade 详情。

**恢复要求**

- 如果批改成功、响应丢失，重复请求应返回同一回执并继续推进 Session。
- 如果答案不同，应返回明确的 `409`，不得再次修改掌握度。
- Grade receipt 应在副作用提交策略中发挥真正的幂等保护作用。

**验收标准**

- 修改请求体中的分数或 mastery 不会影响 Session。
- Studio E2E 必须真实调用 Quiz Generate 和 Grade，不再直接伪造 `80/5/4`。
- `/grade` 成功后模拟网络中断，重试仍可进入 Feedback。
- Reflect 的答题数、正确率和掌握度变化与落盘文件一致。

### 4.3 修正任务完成时点

**现状**

Focus → Recall 时立即调用 `completeTask(..., 'done')`。用户随后退出，旧 Tasks、CLI 和完成率仍会认为任务已完成。

**建议语义**

- `focus_completed`：只表示阅读阶段完成，不等于任务完成。
- `task done`：推荐在该任务对应 Session 完成时写入。
- 如果产品决定 Recall 完成即算学习任务完成，应在 PRD 和 UI 中明确，并为中断状态单独记录。

**验收标准**

- Focus 或 Recall 中途退出不会把任务计入完成率。
- Session 完成时只写入一次 `task_completed` 事件。
- Tasks 页面、CLI、Dashboard 和指标对同一任务状态一致。

### 4.4 让 Quiz 与当前 Session 任务一致

**现状**

Studio 复用全局“今日测验”，可能加载已经存在但与当前任务无关的 Quiz；生成接口也没有接收当前 Session/task 范围。

**目标行为**

- Session 创建时确定 `focusNodeIds` 或当前 `nodeId`。
- Quiz 必须绑定 `sessionId` 和合法概念范围。
- 历史薄弱点可以补充题目，但不能完全替代当前学习目标。
- 一个 Session 的 Quiz 不应被另一个 Session 无条件复用。

**验收标准**

- Quiz 中至少包含当前 Session 概念。
- Quiz 的 `sessionId`、`quizId`、题目节点和批改回执可追踪。
- 第二个 Session 不会错误复用第一个 Session 的批改状态。

## 5. P1：Web 建档与离线演示

### 5.1 增加本地资料入口

Web 应至少支持一种不依赖搜索 API 的资料输入方式：

- 上传 PDF；
- 上传 Markdown；
- 或选择已有本地 workspace 材料。

上传接口必须限制文件类型、大小和目标目录，服务端生成安全文件名，不能接受任意输出路径。

**验收标准**

- 无 `SERP_API_KEY`、无 `OPENAI_API_KEY` 时，可用本地 Markdown + Mock LLM 跑通建档、计划和首次测验。
- PDF/Markdown 上传失败时不改变 Exam 状态。
- Web 与 CLI 导入产物使用同一 Material/Chunk schema。

### 5.2 修正空 Mock 搜索流程

可选择以下一种明确行为：

1. 提供固定、内置、可抓取的 Mock 来源与 Mock ContentFetcher；或
2. 无搜索 Key 时跳过调研，明确引导用户上传本地资料。

禁止继续使用“搜索结果为空，但下一步要求至少选择一个来源”的死路。

### 5.3 知识构建失败不得推进状态

`buildKnowledge()` 只有在至少成功导入材料并生成有效概念后，才能把 Exam 推进到 `materials_ready`。

**验收标准**

- 所有抓取失败、零材料、零概念时保持原状态并返回可操作错误。
- 部分成功时返回成功数、失败数和未覆盖来源。
- Onboarding 不允许对零概念生成计划。

## 6. P1：部署与隐私保护

### 6.1 默认绑定本机

- 本地模式默认监听 `127.0.0.1`。
- 只有显式配置 `HOST=0.0.0.0` 时才允许局域网或容器外访问。
- 启动日志必须显示真实监听地址，不能统一打印 localhost。

### 6.2 公网部署需要访问控制

最低可接受方案：

- 反向代理认证或应用级访问 Token；
- 限制 CORS origin；
- 请求体大小限制；
- 基础速率限制；
- 部署文档明确 HTTPS、认证、备份和密钥要求。

**验收标准**

- 未认证请求不能读取 Exam、Weakness、Buddy History 或修改计划。
- Docker 文档不再把无认证配置描述为可直接用于公网 VPS。
- API Key、Cookie 和 Token 不进入事件日志或错误响应。

## 7. P2：计划调整与状态一致性

### 7.1 默认从次日调整

`adjustPlan()` 的默认 `fromDate` 应为 `today + 1 day`，与 PRD 和 CLI 文案一致。

如果确实需要调整今天，应由调用方显式传入，并避免修改已完成任务。

### 7.2 同步日计划和 Markdown Todo

计划调整后应明确以下规则：

- `plan_master.json` 和 `plan_daily/*.json` 是计划事实源。
- Tasks 页面动态读取计划和进度。
- 如果保留 Markdown todo，调整后必须同步重建，或在文件中明确其为快照。

**验收标准**

- 晚间批改不会向当天插入新的待办任务。
- 次日 JSON、Web Tasks、CLI today 和 Markdown todo 内容一致。

## 8. P2：指标、审计与文档真实性

### 8.1 处理占位指标

在实现题目跳过/删除反馈前：

- 从 UI 和产品说明中移除“题目弃用率”；或
- 返回 `null`/`unavailable`，禁止固定返回 `0` 冒充真实指标。

### 8.2 补全 LLM 审计元数据

让实际 LLM 调用使用 `completeWithMeta()`，并通过 `appendEventWithMeta()` 记录：

- model；
- promptVersion；
- durationMs；
- tokenUsage。

Mock LLM 也应标记为 Mock，避免与真实模型证据混淆。

### 8.3 明确 Event Log 能力边界

当前 Event Log 是 append-only 审计日志，不是可重放事件存储。短期应修改 PRD/产品文档，避免宣称“可从事件日志恢复全部状态”。如果未来要支持重放，需要单独设计 reducer、schema migration 和快照策略。

### 8.4 同步产品文档

至少更新：

- 实际测试数量与测试文件数量；
- Web 重做已经合并到 `main`；
- Mock 搜索的真实限制；
- 已完成、工程实现、Mock 验证、真实 API 验证之间的证据边界；
- 完整 PRD v1 和当前 MVP 的范围差异。

## 9. 暂不纳入当前修复的完整 PRD 能力

以下内容属于后续版本，不应混入本轮正确性修复：

- Word、图片 OCR、视频转写；
- PageRank 和复杂知识图谱；
- 主观题 AI 评分；
- IRT 自适应出题；
- 多模型路由；
- 多用户、多考试/多科目并行；
- PDF 错题本和 Excel 报表导出；
- Windows 原生常驻桌宠。

本轮应先保证已有 MVP 能正确运行，再决定是否扩展范围。

## 10. 实施顺序

### 阶段 A：计划算法修复

1. 增加“容量不足时概念不丢失”的失败测试。
2. 重写概念顺延/容量报告逻辑。
3. 增加固定复习日期测试。
4. 分离初始固定间隔和运行时 SM-2。
5. 运行 Planner、SM-2、PlanAdjuster 定向测试和全量测试。

### 阶段 B：Studio 服务端闭环

1. 定义一天多 Session 的状态模型。
2. 新增原子 `studio/grade` 工作流。
3. 将任务完成移动到正确时点。
4. 为 Quiz 绑定 Session 和当前任务范围。
5. 补网络中断、重复提交、当天第二任务 E2E。

### 阶段 C：Web 建档和部署安全

1. 增加本地资料上传/选择入口。
2. 修正无 Key 的 Mock 或降级流程。
3. 阻止零材料、零概念状态推进。
4. 默认本机监听并补访问控制方案。

### 阶段 D：指标与文档

1. 移除或真实实现占位指标。
2. 接入 LLM 元数据日志。
3. 更新 README、PRODUCT_INTRO 和部署文档。
4. 保存一份真实搜索 + 真实 LLM 连续三日金样本验收记录。

## 11. 总体验收门

完成修复不能只以“测试退出码为 0”为标准，必须同时满足：

### 代码与自动化

- 根 TypeScript 构建通过。
- Web 类型检查与生产构建通过。
- 全量 Vitest 通过。
- 新增 Planner 完整性、复习间隔、Studio 多任务和原子批改测试。
- CLI smoke 通过。

### Mock 黄金路径

- 本地 Markdown 导入。
- 生成无遗漏计划。
- 完成至少两个学习任务。
- 生成并提交测验。
- 错题、掌握度、计划调整和 Session History 真实落盘。
- 刷新恢复和重复提交结果正确。

### 真实能力验收

- 使用真实搜索和真实 LLM 跑通至少一次完整建档。
- 连续三天保存计划、任务、测验、批改和调整证据。
- 明确记录响应耗时、模型、Prompt 版本和 Token 使用。
- 浏览器窄屏、刷新、中断恢复和关闭桌宠场景人工通过。

## 12. 完成定义

只有满足以下条件，才可以把项目状态改为“当前 MVP PRD 已完成”：

1. 不存在静默丢失概念或重复铺满复习任务的问题。
2. Study Studio 的成绩、掌握度和 Reflect 均来自服务端事实源。
3. 当天多任务、刷新恢复和中断重试可用。
4. Web 用户有一条不依赖搜索 Key 的本地资料闭环。
5. 部署方式与隐私声明一致。
6. Mock、代码实现、本地运行、真实 API 和连续三日验收被分别陈述，不混为同一证据。

