# 黑客松 48 小时作战计划

> 目标：两天内产出一个可演示、可解释、可复盘的个人备考 Agent Demo，并在路演中讲清楚问题、方案、Demo 路径、技术路线和商业化可能。

---

## 0. 当前基础（赛前已具备）

- GitHub 仓库已创建：https://github.com/Joe-rq/studymate-agent
- 6 个 CLI 命令已跑通：`init → ingest → plan → today → quiz → grade`
- Mock LLM 支持离线 Demo
- 8 个测试通过，事件日志基础设施可用
- 路演讲稿和 Demo 脚本已写好

**赛前最重要的风险点**：真实 LLM 出题质量尚未验证。

---

## 1. 评分标准拆解与应对策略

| 评分维度 | 权重 | 我们怎么拿分 | 对应工作 |
|---|---|---|---|
| **场景价值** | 人工 | 考证/考研/在职学习是真实刚需；资料是自己的，计划是别人的 | 讲稿第 1 部分强化痛点数据 |
| **商业化潜力** | 人工 | 个人订阅 → B2B2C 培训机构 → 企业培训 | 讲稿第 5 部分 + 一页商业画布 |
| **创新** | 人工 | 本地优先 + Obsidian vault + 事件溯源 + 错题回流 | 强调 12-Factor Agents 架构 |
| **体验** | 人工 | CLI 极简 + Markdown 全链路 + 可离线 | Demo 脚本控制在 3 分钟内 |
| **路演与协作** | 人工 | 分工明确、逐字稿、备用方案 | 彩排 3 次以上 |
| **连通性** | AI 技术 | CLI 串联多 Agent、文件 I/O、LLM API | 确保 6 步命令一次性跑通 |
| **稳定性** | AI 技术 | 错误处理、重试、Mock 兜底 | 真实 LLM 验证 + Mock 备用 |
| **代码表现** | AI 技术 | TypeScript 类型、测试、事件日志 | 保持测试全绿、代码可读 |
| **创客共鸣奖** | 互评 | 开源、可复用、有文档 | README + AGENTS.md 完善 |

---

## 2. Day 1：技术闭环与真实 LLM 验证

### 上午 09:00-12:00｜确认底座 + 跑通真实 LLM

- [ ] 设置 `OPENAI_API_KEY`，用真实模型跑一次完整闭环
- [ ] 检查 `concept_mapper` 输出：概念是否准确、依赖是否合理
- [ ] 检查 `quiz_generator` 输出：题目是否相关、解析是否回链 Chunk
- [ ] 记录真实 LLM 的耗时和成本
- [ ] 修复任何真实 LLM 暴露的 prompt 问题

**验收标准**：真实 LLM 跑完整 6 步无报错，生成可理解的计划 + 题目。

### 下午 13:00-18:00｜稳定性与扩展性

- [ ] 增加 LLM 调用重试机制（最多 3 次，指数退避）
- [ ] 给关键 Agent 增加输入/输出校验，防止 JSON 解析崩溃
- [ ] 实现 `plan_adjuster` 的薄弱点权重调整（目前可能只做了占位）
- [ ] 添加 `--model` 参数或 `LLM_MODEL` 环境变量支持多模型
- [ ] 清理 workspace，重新跑一次端到端冒烟测试
- [ ] 更新 `demo/answers/`，使其匹配真实 LLM 生成的题目答案

**验收标准**：`npm test` 全绿，Mock 和真实 LLM 都能跑通 Demo。

### 晚上 19:00-21:00｜Obsidian 集成演示包装

- [ ] 把整个 `workspace/` 作为 Obsidian vault 打开截图
- [ ] 在 `tasks/` 和 `mistakes/` 的 Markdown 里加入 Obsidian 标签（如 `#learn` `#review` `#mistake`）
- [ ] 写一个 `docs/obsidian-setup.md` 简单说明
- [ ] 生成 1-2 张产品截图或 GIF，用于路演 PPT

---

## 3. Day 2：Demo 包装与路演准备

### 上午 09:00-12:00｜路演材料与视觉

- [ ] 制作 5-7 页路演 PPT（问题 → 方案 → Demo 路径 → 技术 → 商业）
- [ ] 把 Demo 脚本控制在 **2 分 30 秒**，预留 Q&A 时间
- [ ] 准备一页「架构图」：6 个 Agent + 事件日志 + Obsidian
- [ ] 准备一页「评分对应表」：我们如何在每个维度拿分
- [ ] 录制一个 3 分钟 Demo 视频作为备用

### 下午 13:00-15:00｜彩排与兜底

- [ ] 完整彩排 3 次，计时
- [ ] 准备两套 Demo 环境：
  - 在线版：有网络，用真实 LLM
  - 离线版：无网络，用 Mock LLM
- [ ] 准备常见评委 Q&A：
  - 与 Anki/Quizlet 的区别？
  - LLM 出题幻觉怎么解决？
  - 多科目/多用户怎么做？
  - 商业模式怎么跑通？

### 下午 15:00-18:00｜代码收尾与提交

- [ ] 跑最终测试：`npm run build && npm test && npm run smoke`
- [ ] 清理临时文件和敏感信息
- [ ] 提交最终代码并 push 到 GitHub
- [ ] 更新 README，放上 Demo 视频/截图链接
- [ ] 打印/保存一份离线 Demo 命令清单

---

## 4. 现场 Demo 最简命令

```bash
# 赛前预编译好
npm run build

# Demo 全程
node dist/cli.js init
node dist/cli.js ingest demo/materials/micro-economics.md
node dist/cli.js plan --exam 2026-09-15 --daily 60
node dist/cli.js today
node dist/cli.js quiz
node dist/cli.js grade --answers demo/answers/2026-07-09_answers.json
wc -l workspace/event_log/events.jsonl
```

**无网络时使用 Mock LLM**：不设置 `OPENAI_API_KEY` 即可自动降级。

---

## 5. 关键风险与 Plan B

| 风险 | Plan B |
|---|---|
| 现场网络差 | 用 Mock LLM 跑完整 Demo |
| 真实 LLM 超时 | 提前生成好 `workspace/` 快照，现场直接展示 |
| 评委提问偏技术 | 准备架构图 + 事件日志解释 |
| 评委质疑商业 | 强调考证/考研市场规模和付费意愿 |
| 时间超时 | 跳过 `today` 命令，直接展示 `plan` 和 `quiz` |

---

## 6. 推荐优先级（如果只能做一件事）

**第一优先级**：用真实 LLM 完整跑一次并修复问题。没有真实模型验证，Demo 就是玩具。

**第二优先级**：准备一个离线可用的 workspace 快照，确保任何网络环境下都能 3 分钟讲清楚。

**第三优先级**：路演 PPT 和 3 次彩排。技术再好，讲不清楚等于 0。
