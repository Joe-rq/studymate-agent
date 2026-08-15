# StudyMate Agent — 产品介绍

> **版本**：v0.10
> **日期**：2026-08-11
> **状态**：工程回归通过，可演示（[Demo 视频](../screenshots/demo_v2/studymate_demo.mp4) · 78 秒带中文旁白）；Web UI 重做分支进行中（未合并 main）；真实搜索 + 真实 LLM 三日金样本待验收

---

## 一句话描述

一个覆盖「考试建档 → 智能搜索 → 知识构建 → 计划生成 → 每日学习 → 自适应出题 → 批改反馈 → SM-2 间隔复习」全链路的 **AI 备考 Agent**，配备拟人化学习搭子，支持 CLI 和 Web 双界面。

---

## 核心能力

### 1. 考试项目建档

从零开始创建一个完整的备考项目：

```bash
studymate exam create --name "2026年初级会计资格考试" --date 2026-09-15 \
  --subjects "经济学基础,会计学" --daily 60
```

- 定义考试名称、日期、科目、每日学习时长
- 支持设置学习者基线水平（beginner/intermediate/advanced）
- 项目状态机管理：`created → researching → materials_ready → sources_approved → planned → active`

### 2. 智能搜索与资料研究

自动搜索考试相关资料并智能分类：

```bash
studymate exam research    # 搜索并分析考试资料
studymate exam sources     # 查看并审批资料来源
```

- **SerpAPI 集成**：接入 Google 搜索引擎（需 `SERP_API_KEY`）
- **Mock 模式**：无 API Key 时自动降级为演示模式
- **资料分类**：自动将搜索结果分类为教材/真题/笔记/视频等类型
- **置信度评估**：每个来源标注可信度（high/medium/low）
- **人工审批**：用户确认后才进入知识构建流程
- **结论引用**：调研结论保存来源 ID；无法提供有效来源时明确标记“证据不足”

### 3. 知识图谱构建

从学习资料中自动提取知识体系：

```bash
studymate knowledge build    # 构建知识库
studymate knowledge status   # 查看知识库状态
```

- **内容抓取**：WebContentFetcher 抓取网页正文（HTML 清洗、标题提取）
- **智能分块**：按 Markdown 标题层级语义切分
- **概念提取**：LLM 提取核心概念、定义、前置依赖
- **拓扑排序**：三色 DFS 检测循环依赖，生成学习路径
- **掌握度追踪**：每个概念维护 mastery (0-1)、难度、权重、证据计数

### 4. 自适应学习计划

基于知识图谱和考试时间生成最优复习计划：

```bash
studymate plan --exam 2026-09-15 --daily 60
```

- **三阶段规划**：学习期 (65%) → 巩固期 → 冲刺期 (最后 3-5 天)
- **容量估算**：根据概念难度和掌握度动态计算任务时长
- **休息日安排**：每 7 天自动插入缓冲日
- **测验穿插**：每 4 天安排一次阶段测验
- **不可用日期**：支持设置休息日（如周末、节假日）
- **正式确认**：Web 生成计划后保持待确认状态，用户确认后才进入 active

### 5. 每日学习闭环

```bash
studymate today              # 查看今日任务
studymate quiz               # 生成每日测验
studymate grade --answers answers.json  # 批改并自适应调整
```

**任务调度**：
- 从日计划中提取 learn/review/quiz/sprint 任务
- 按优先级排序：学习 > 测验 > 复习
- 未完成任务自动顺延到次日
- 顺延任务记录原任务 ID，刷新或重复执行不会重复插入

**智能出题**：
- 基于当日学习/复习知识点生成题目
- 支持单选题和多选题
- 题目解析回链到知识切片
- 根据掌握度动态调整难度

**自动批改**：
- 客观题秒级判分
- 错误分类：概念不清 / 记忆模糊 / 粗心 / 多选部分正确
- 薄弱知识点定位与解释
- 生成 Markdown 格式成绩报告

### 6. SM-2 间隔重复算法

**Phase 8 新增**：实现真正的自适应复习调度

```
概念 [需求定律] 复习后状态:
  掌握度: 0.40 ↑ 0.64（本次正确率 80%）
  SM-2: 质量 4/5 (正确), 下次复习 2026-08-15 (+23 天), EF=2.60
```

**算法特性**：
- 每个概念独立维护 SR 状态：`interval`, `easeFactor`, `repetitions`, `dueDate`
- 回忆质量映射：quiz score (0-1) → SM-2 quality (0-5)
  - 0.9-1.0 → 完美 (q=5)
  - 0.8-0.9 → 正确 (q=4)
  - 0.6-0.8 → 正确但费力 (q=3)
  - 0.4-0.6 → 模糊 (q=2)
  - 0.2-0.4 → 困难 (q=1)
  - 0.0-0.2 → 完全忘记 (q=0)
- 正确回忆 (q≥3)：间隔按 easeFactor 递增
- 忘记 (q<3)：重置间隔为 1 天，降低难度系数
- 完美回忆 (q=5)：提升难度系数，延长复习间隔

**集成点**：
- MasteryTracker：每次批改后更新 SR 状态
- Planner：使用 `SRState.dueDate` 调度复习任务
- CLI：grade 命令输出 SM-2 状态变化
- Web API：`GET /api/concepts/sr-state` 查询所有概念 SR 状态

### 7. 计划动态调整

根据答题表现自动优化后续计划：

- **复习加时**：掌握度低的复习任务自动延长（最多 +15 分钟）
- **插入复习**：mastery < 0.3 的概念自动插入新复习任务
- **重测安排**：反复错误的概念安排重新测验
- **调整日志**：所有调整记录到 `adjustment_log.jsonl`，可审计

### 8. 学习指标追踪

```bash
studymate metrics
```

四项核心指标：
- **计划完成率**：最近 7 天任务完成百分比
- **复习后正确率**：复习后的答题正确率
- **知识保留率**：概念掌握度保持情况
- **题目弃用率**：被跳过/删除的题目比例

### 9. 拟人化备考搭子

一个有记忆、有性格、会成长的学习伙伴：

```bash
studymate character list            # 查看可选搭子
studymate character select shen_ye  # 选择搭子
studymate chat                      # 多轮对话
```

**内置角色**：

| 头像 | 名字 | 定位 | 称呼你 |
|------|------|------|--------|
| ☀️ | 晴川 | 温柔阳光学长 | 同学 |
| 🌙 | 凛川 | 高冷学霸 | 你 |
| 🌸 | 柚宁 | 元气少女 | 宝 |
| 🍡 | 芽团 | 治愈萌系吉祥物 | 主人 |

**搭子特性**：
- **持久记忆**：跨 session 记住你的学习情况和承诺
- **关系等级**：随互动增加亲密度
- **连续打卡**：追踪学习连续天数
- **关键时刻介入**：低分鼓励、高分庆祝、考前提醒等 8 种触发场景
- **自适应语气**：根据分数、掌握度趋势、距考试天数调整表达

---

## 技术架构

```
┌─────────────────────────────────────────────────────────────┐
│                      用户界面层                               │
│   CLI (Commander.js)  │  Web UI (React 18 + Vite 5)         │
├─────────────────────────────────────────────────────────────┤
│                      API 服务层                               │
│   Express 5 REST API (25+ endpoints)                        │
├─────────────────────────────────────────────────────────────┤
│                      应用工作流层                              │
│   bootstrap_exam │ research_exam │ build_knowledge │         │
│   grade_and_adapt                                          │
├─────────────────────────────────────────────────────────────┤
│                      Agent 层 (16 个)                        │
│   material_collector │ chunker │ concept_mapper │ planner   │
│   task_dispatcher │ quiz_generator │ grader │               │
│   mistake_analyzer │ mastery_tracker │ plan_adjuster │      │
│   spaced_repetition │ metrics │ exam_researcher │           │
│   study_buddy │ buddy_state │ buddy_interventions           │
├─────────────────────────────────────────────────────────────┤
│                      领域模型层                               │
│   ExamProject │ SourceRecord │ BuddyState │ Concept         │
├─────────────────────────────────────────────────────────────┤
│                      基础设施层                               │
│   LLM Client │ Event Log (v2) │ Workspace │ Character       │
│   SearchProvider (SerpAPI/Mock) │ ContentFetcher (Web/Mock) │
├─────────────────────────────────────────────────────────────┤
│                      数据层（文件驱动）                        │
│   workspace/                                                 │
│   ├── materials/    # 原始资料                               │
│   ├── chunks/       # 知识切片                               │
│   ├── graph/        # 知识图谱 (concepts.json)               │
│   ├── plan/         # 学习计划 (master + daily)              │
│   ├── tasks/        # 每日任务                               │
│   ├── quizzes/      # 测验题目                               │
│   ├── results/      # 批改结果                               │
│   ├── mistakes/     # 错题记录                               │
│   ├── progress/     # 掌握度历史                             │
│   ├── buddy/        # 搭子对话历史                           │
│   └── event_log/    # 审计日志（append-only，非可重放）     │
└─────────────────────────────────────────────────────────────┘
```

---

## 快速开始

### 环境要求

- Node.js >= 20.0.0
- npm

### 安装与运行

```bash
# 克隆并安装
git clone https://github.com/qrx-joe/studymate-agent.git
cd studymate-agent
npm install
npm run build

# 初始化工作空间
studymate init

# 方式 1：CLI 完整流程
studymate exam create --name "期末考试" --date 2026-09-15 --subjects "微观经济学" --daily 60
studymate exam research
studymate exam sources --approve all
studymate knowledge build
studymate plan --exam 2026-09-15 --daily 60
studymate today
studymate quiz
studymate grade --answers demo/answers/2026-07-13_answers.json

# 方式 2：Web UI
npm run serve
# 打开 http://localhost:3456
```

### 环境变量（可选）

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `OPENAI_API_KEY` | LLM API 密钥 | 无（使用 Mock） |
| `OPENAI_BASE_URL` | API 地址 | `https://api.openai.com/v1` |
| `LLM_MODEL` | 模型名称 | `gpt-4o-mini` |
| `SERP_API_KEY` | SerpAPI 搜索密钥 | 无（使用 Mock） |

---

## Web UI 功能

| 页面 | 功能 |
|------|------|
| Dashboard | 学习概览、今日任务、掌握度统计 |
| Onboarding | 4 步建档向导（创建考试 → 搜索 → 审批 → 构建） |
| Tasks | 每日任务列表、完成打卡 |
| Quiz | 在线答题界面 |
| Grade | 成绩报告、错题分析 |
| Plan | 学习计划日历视图 |
| Chat | 与备考搭子对话 |
| Settings | 角色选择、偏好设置 |

---

## 测试覆盖

- **336 个测试** 全部通过
- **42 个测试文件** 覆盖所有核心模块
- **e2e 测试**：完整工作流、幂等性、故障恢复
- **单元测试**：每个 Agent 独立测试

```bash
npm run test        # 运行所有测试
npm run test:watch  # 监听模式
```

---

## 项目状态

### 当前完成状态

| Phase | 内容 | 状态 |
|-------|------|------|
| 0-1 | 基础设施稳定 + 考试研究流程 | ✅ 工程实现 |
| 2-4 | 计划/测验/自适应核心 | ✅ 工程实现 |
| 5 | 搭子产品化 + Web UI | ✅ 工程实现 |
| 6 | e2e 测试 + 发布加固 | 🟡 Mock E2E 已完成，真实三日金样本待验收 |
| 7 | 完整 Web UI 建档流程 | ✅ 含来源和计划确认 |
| 8 | SM-2 间隔重复算法 | ✅ |
| 9 | Learner Model 长期记忆（画像/洞察/自适应难度） | ✅ 工程实现 |
| 当前 | Web UI 重做（治愈系双主题 + IP 搭子形象 + 移动端导航 + 微交互） | 🔵 `feat/web-ui-redesign` 分支进行中，未合并 main |

### 当前限制

- 单用户/单考试项目
- 搜索需要 SerpAPI Key（否则使用 Mock）
- LLM 需要 API Key（否则使用 Mock）
- 无语音/动画交互
- 移动端：Web UI 重做分支已加响应式导航与顶栏，完整移动端体验待完善
- 尚未保存一份真实搜索 + 真实 LLM 连续三日金样本验收记录

### 后续规划

- 多科目并行管理
- 主观题 AI 评分
- IRT 自适应出题
- 数据导出（PDF 错题本、Excel 报表）
- 移动端完整体验（响应式导航已在 `feat/web-ui-redesign` 分支落地）

---

## 文档索引

| 文档 | 说明 |
|------|------|
| `docs/PRD_v1.0.md` | 完整产品需求文档（九步闭环设计） |
| `docs/PRD_MVP_v0.1.md` | MVP 范围定义 |
| `docs/PRODUCT_INTRO.md` | 本文档（当前阶段产品介绍） |
| `docs/plans/` | 各阶段实施计划 |
| `AGENTS.md` | AI Agent 贡献指南 |
| `README.md` | 项目快速入门 |

---

> **StudyMate Agent** — 让 AI 成为你的备考搭档，用数据驱动的方式高效学习。
