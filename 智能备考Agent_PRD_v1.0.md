# 智能备考 Agent — 产品需求文档（PRD）

> **版本**：v1.0  
> **日期**：2026-07-09  
> **作者**：AI 产品团队  
> **状态**：草案 → 评审

---

## 目录

1. [产品概述](#1-产品概述)
2. [目标用户与场景](#2-目标用户与场景)
3. [核心原则](#3-核心原则)
4. [功能需求：九步闭环](#4-功能需求九步闭环)
5. [非功能需求](#5-非功能需求)
6. [技术架构](#6-技术架构)
7. [数据模型](#7-数据模型)
8. [12-Factor Agents 对照实现](#8-12-factor-agents-对照实现)
9. [部署与运维](#9-部署与运维)
10. [里程碑规划](#10-里程碑规划)
11. [风险与对策](#11-风险与对策)

---

## 1. 产品概述

### 1.1 一句话描述

一个覆盖「资料采集 → 知识拆解 → 图谱构建 → 计划生成 → 任务执行 → 智能出题 → 自动批改 → 错题回流 → 动态调优」全链路的**个人轻量备考 Agent**，遵循 12-Factor Agents 工程原则，以文件驱动、事件日志为核心，实现可审计、可暂停、可回滚的自适应学习闭环。

### 1.2 产品愿景

让任何人在 5 分钟内启动一套专属备考系统，3 个月后通过数据驱动的自适应学习，以最小时间成本达到目标分数。

### 1.3 核心差异点

| 维度 | 传统备考 App | 本 Agent |
|------|------------|---------|
| **资料来源** | 固定题库 | 任意资料（网页/PDF/笔记/视频） |
| **知识组织** | 预设章节 | 自动构建知识图谱 + 依赖路径 |
| **计划制定** | 固定模板 | 基于遗忘曲线 + 掌握度动态调度 |
| **出题策略** | 随机抽题 | 基于 IRT 自适应 + 薄弱点靶向 |
| **错题处理** | 手动整理 | 自动归档 + 相似题推荐 + 计划回流 |
| **架构重量** | 云端 SaaS | 本地文件驱动，一条命令启动 |
| **可审计性** | 黑盒 | 全事件日志，可 Replay |

---

## 2. 目标用户与场景

### 2.1 用户画像

| 类型 | 特征 | 痛点 | 使用场景 |
|------|------|------|---------|
| **考证党** | 时间紧（1-3 个月）、资料杂 | 不知道从何开始，计划总被打乱 | 导入教材 + 真题，自动生成 60 天冲刺计划 |
| **考研党** | 科目多、周期长（6-12 个月） | 学了后面忘前面，缺乏系统复习 | 多科目并行管理，跨科目知识关联 |
| **在职学习者** | 碎片化时间、易遗忘 | 没有持续提醒，学了就忘 | 每日早晨推送 30 分钟任务包，通勤时完成 |
| **自学者** | 无老师指导、需检验效果 | 没人出题、没人批改、不知掌握程度 | 学完即测，即时反馈，薄弱点可视化 |

### 2.2 典型用户旅程

```
Day 0   用户上传 3 份 PDF 教材 + 粘贴 5 个网页链接
        ↓
Day 0   Agent 自动拆解为知识切片，构建知识图谱（约 30 分钟）
        ↓
Day 0   用户确认复习计划（可调整），设置考试日期
        ↓
Day 1   早晨 8:00 推送今日任务：学习「微观经济学·供需理论」+ 复习「宏观·GDP」
        ↓
Day 1   晚间 20:00 完成学习后，Agent 出题 8 道（5 选择 + 3 简答）
        ↓
Day 1   即时批改，得分 75%，错题自动归档，薄弱点「弹性计算」标记
        ↓
Day 2   计划自动调整：增加「弹性计算」复习权重，压缩已掌握内容
        ↓
Day N   循环往复，直到考试前 3 天进入冲刺模式（全真模拟 + 错题总复习）
```

---

## 3. 核心原则

### 3.1 12-Factor Agents 原则（工程底线）

本系统严格遵循 [humanlayer/12-factor-agents](https://github.com/humanlayer/12-factor-agents) 的 12 条工程原则，确保 Agent 从原型可演进为生产级系统。

### 3.2 轻量优先原则

- **文件即数据库**：所有状态存储在 Markdown / JSON / JSONL 文件中
- **Git 即版本控制**：每次状态变更自动 commit，天然可回滚
- **终端即界面**：TUI 为主，Web 看板为辅（可选）
- **零外部依赖**：核心链路不依赖 Milvus / Neo4j / PostgreSQL 等重型服务

### 3.3 人类在环原则（Human-in-the-Loop）

- 关键决策（计划生成、主观题评分、资料拆解结果）必须经过人类确认
- "问人类"是一等工具调用，与"查数据库""发邮件"同等地位
- 人类决策作为事件写入日志，Agent 继续执行

---

## 4. 功能需求：九步闭环

### 4.1 阶段 1：找资料（MaterialCollector Agent）

**目标**：将任意来源的学习资料采集到本地仓库。

**输入**：
- 用户粘贴的 URL（网页文章）
- 上传的文件（PDF / Word / 图片 / 视频）
- 关键词搜索指令
- RSS / 订阅源（可选）

**处理**：
1. 下载网页正文（去除广告、导航栏）
2. PDF / Word 提取文本与表格结构
3. 图片 OCR 识别（手写笔记支持）
4. 视频语音转文字（可选，调用 Whisper）
5. 自动去重（基于内容哈希）
6. 格式统一为 Markdown

**输出**：
```
workspace/
├── materials/
│   ├── 2026-07-09_微观经济学教材.md
│   ├── 2026-07-09_供需理论详解.md
│   └── 2026-07-09_历年真题汇编.md
```

**12-Factor 映射**：Factor 1（自然语言 → 工具调用）、Factor 11（任意渠道触发）

**人类在环点**：资料采集完成后，用户确认资料列表（可删除无关文件）。

---

### 4.2 阶段 2：拆资料（Chunker Agent）

**目标**：将原始资料语义级切片，保留上下文关联。

**输入**：`materials/` 目录下的 Markdown 文件

**处理**：
1. **语义切分**：按段落/章节/知识点边界切割（非固定长度）
2. **元数据标注**：
   - 所属章节层级（H1 → H2 → H3）
   - 关键概念提取（命名实体识别）
   - 难度等级标注（初 / 中 / 高，由 LLM 估计）
   - 来源文件链接
3. **Embedding 生成**：为每个 Chunk 生成向量（本地 Ollama 或 API）

**输出**：
```
workspace/
├── chunks/
│   ├── chunk_001.md    # 供需理论定义
│   ├── chunk_002.md    # 需求曲线推导
│   └── chunk_003.md    # 弹性计算案例
├── chunks_index.json   # 元数据索引
└── chunks_vectors.jsonl  # 向量存储（可选 SQLite-vec）
```

**12-Factor 映射**：Factor 3（主动管理上下文）、Factor 10（小 Agent）

**人类在环点**：用户可查看 Chunk 列表，合并/拆分/删除不准确的切片。

---

### 4.3 阶段 3：建知识地图（GraphBuilder Agent）

**目标**：自动构建知识图谱，识别概念依赖关系。

**输入**：`chunks/` 目录 + `chunks_index.json`

**处理**：
1. **实体抽取**：LLM 从 Chunks 中提取核心概念（如"供需理论""价格弹性""边际效用"）
2. **关系抽取**：识别概念间关系（前置依赖、包含、对比、因果）
3. **图谱构建**：生成有向图（节点 = 概念，边 = 依赖关系）
4. **重要性计算**：PageRank 算法计算节点中心性
5. **学习路径排序**：拓扑排序生成推荐学习顺序

**输出**：
```
workspace/
├── graph/
│   ├── knowledge_graph.json   # 节点 + 边 + 权重
│   ├── learning_path.json     # 拓扑排序后的学习序列
│   └── graph_visualization.md  # Mermaid 可视化（可选）
```

**12-Factor 映射**：Factor 4（结构化输出）、Factor 10（小 Agent）

**人类在环点**：用户可查看知识图谱可视化，手动调整依赖关系（如"我认为应该先学 B 再学 A"）。

---

### 4.4 阶段 4：生成复习计划（Planner Agent）

**目标**：基于知识图谱、考试日期、每日可用时间，生成最优复习计划。

**输入**：
- `knowledge_graph.json`（知识图谱）
- `learning_path.json`（学习路径）
- 用户配置：考试日期、每日可用时间（分钟）、目标分数

**处理**：
1. **艾宾浩斯遗忘曲线建模**：每个知识点的复习间隔 = 1天 → 3天 → 7天 → 15天 → 30天
2. **优先级计算**：
   ```
   priority = node_weight × (1 - mastery) × urgency_factor
   ```
   - `node_weight`：PageRank 重要性
   - `mastery`：当前掌握度（初始为 0）
   - `urgency_factor`：距离考试日期的倒数
3. **时间约束求解**：动态规划排期，确保每日任务量不超过可用时间
4. **计划生成**：输出阶段计划（里程碑）→ 周计划 → 日任务队列

**输出**：
```
workspace/
├── plan/
│   ├── plan_master.json      # 完整计划（所有任务）
│   ├── plan_week_1.json      # 第 1 周计划
│   └── plan_daily/           # 每日计划
│       ├── 2026-07-10.json
│       └── 2026-07-11.json
```

**12-Factor 映射**：Factor 4（结构化输出）、Factor 8（代码控制流）

**人类在环点**：计划生成后，用户确认或调整（如"周末多学 2 小时""跳过第 3 章"）。

---

### 4.5 阶段 5：每日任务执行（TaskDispatcher Agent）

**目标**：每日早晨推送学习任务，追踪进度，管理打卡。

**输入**：`plan_daily/YYYY-MM-DD.json`

**处理**：
1. **任务组装**：从计划中提取今日任务（新学 + 复习 + 测验）
2. **内容加载**：根据任务关联的 Chunk IDs，加载对应知识内容
3. **推送通知**：终端 TUI 显示 / 写入日历文件 / 发送邮件（可选）
4. **进度追踪**：用户标记完成/跳过/延期，更新状态
5. **未完成处理**：自动顺延到次日，优先级重新计算

**输出**：
```
workspace/
├── tasks/
│   ├── 2026-07-10_todo.json   # 今日任务清单
│   └── 2026-07-10_done.json   # 已完成记录
├── progress/
│   └── mastery_tracker.json   # 各知识点掌握度实时更新
```

**12-Factor 映射**：Factor 6（暂停/恢复）、Factor 11（Cron 触发）

**人类在环点**：用户每日确认任务清单，可随时暂停（今天不想学了），次日从断点恢复。

---

### 4.6 阶段 6：出题（QuizGenerator Agent）

**目标**：基于当日学习内容和历史薄弱点，智能生成针对性题目。

**输入**：
- 今日学习知识点（从 `tasks/` 提取）
- 历史薄弱点（从 `mistakes/` 提取）
- 用户能力评估（从 `progress/mastery_tracker.json` 提取）

**处理**：
1. **IRT 自适应选题**：根据掌握度动态调整题目难度
   - 掌握度 < 40%：基础题为主
   - 40% ≤ 掌握度 < 70%：中等难度
   - 掌握度 ≥ 70%：挑战题 + 综合应用题
2. **题型多样化**：
   - 单选题（概念辨析）
   - 多选题（综合判断）
   - 填空题（公式/定义记忆）
   - 简答题（逻辑推导）
   - 案例分析题（综合应用）
3. **考点覆盖约束**：确保当日知识点覆盖度 ≥ 80%
4. **防重复**：与历史题目做相似度检测（Embedding 余弦距离）

**输出**：
```
workspace/
├── quizzes/
│   ├── 2026-07-10_quiz.json   # 题目 + 选项 + 标准答案 + 解析
│   └── 2026-07-10_quiz.md     # 用户友好格式（Markdown 试卷）
```

**12-Factor 映射**：Factor 4（结构化输出）、Factor 10（小 Agent）

**人类在环点**：用户可预览题目，替换/删除不满意的题目。

---

### 4.7 阶段 7：批改（Grader Agent）

**目标**：自动阅卷，生成详细解析报告。

**输入**：`quizzes/YYYY-MM-DD_quiz.json` + 用户答案

**处理**：
1. **客观题自动判分**：
   - 单选/多选/填空：正则匹配，秒级判分
2. **主观题 AI 评分**：
   - LLM 按评分细则打分（0-100 分）
   - 提供评分依据（采分点匹配度）
   - 给出改进建议
3. **解析生成**：
   - 正确答案
   - 错误分析（概念不清 / 计算失误 / 审题错误）
   - 相关知识点链接（回跳 Chunk）
   - 拓展阅读推荐
4. **得分分析**：
   - 总分 / 各题型得分 / 各知识点得分
   - 与历史成绩对比趋势

**输出**：
```
workspace/
├── results/
│   ├── 2026-07-10_result.json   # 得分详情 + 解析
│   └── 2026-07-10_report.md     # 用户友好报告
```

**12-Factor 映射**：Factor 4（结构化输出）、Factor 9（错误压缩）

**人类在环点**：主观题评分后，用户可复核并修正分数（如"我认为应该得 8 分而不是 6 分"）。

---

### 4.8 阶段 8：错题回流（MistakeAnalyzer Agent）

**目标**：错题归档、错误分类、薄弱点定位、相似题推荐。

**输入**：`results/YYYY-MM-DD_result.json`

**处理**：
1. **错误分类**：
   - 概念不清（知识点理解错误）
   - 计算失误（公式套用错误）
   - 审题错误（理解偏差）
   - 记忆模糊（定义/公式遗忘）
2. **薄弱点定位**：映射到具体 KnowledgeNode
3. **相似题检索**：基于 Embedding 从题库/历史题目中检索相似题
4. **复习标记**：设置间隔复习时间（1天 → 3天 → 7天 → 15天）
5. **错题本生成**：按知识点聚合，支持导出 PDF

**输出**：
```
workspace/
├── mistakes/
│   ├── mistake_log.jsonl        # 所有错题记录（追加写入）
│   ├── weakness_profile.json    # 薄弱点画像
│   └── similar_questions/       # 相似题推荐
│       └── elastic_demand_similar.json
```

**12-Factor 映射**：Factor 5（统一状态）、Factor 9（错误压缩）

**人类在环点**：用户可查看错题本，手动调整错误分类或标记"已掌握"。

---

### 4.9 阶段 9：调整计划（PlanAdjuster Agent）

**目标**：基于错题数据动态优化后续复习计划。

**输入**：
- `mistakes/mistake_log.jsonl`
- `mistakes/weakness_profile.json`
- `progress/mastery_tracker.json`
- `plan/plan_master.json`

**处理**：
1. **掌握度重估**：
   ```
   new_mastery = old_mastery × 0.7 + (1 - error_rate) × 0.3
   ```
2. **权重重算**：错题率高的知识点增加训练权重
3. **计划重排**：
   - 增加薄弱项的复习频次和任务量
   - 压缩已熟练掌握内容的复习间隔
   - 检测时间冲突（计划超量）并给出调整建议
4. **冲突检测**：如果调整后每日任务超过可用时间，提示用户取舍

**输出**：
```
workspace/
├── plan/
│   ├── plan_master_v2.json      # 更新后的计划
│   └── plan_adjustment_log.jsonl  # 调整记录（可审计）
```

**12-Factor 映射**：Factor 8（代码控制流）、Factor 12（无状态 Reducer）

**人类在环点**：计划调整建议生成后，用户确认或手动调整（如"我不想减少第 5 章的时间"）。

---

### 4.10 闭环反馈

阶段 9 的输出（`plan_master_v2.json`）回流到阶段 4 的输入，形成完整闭环：

```
┌─────────────────────────────────────────────────────────┐
│  阶段 9: 调整计划 ──→ 阶段 4: 生成复习计划（迭代）        │
│       ↑                                         │
│       └─────────────────────────────────────────┘
│  （错题数据驱动，计划持续进化）
└─────────────────────────────────────────────────────────┘
```

---

## 5. 非功能需求

### 5.1 性能

| 指标 | 目标值 | 说明 |
|------|--------|------|
| 资料拆解（100页 PDF） | ≤ 5 分钟 | 本地 Ollama 运行 |
| 知识图谱构建（500 节点） | ≤ 3 分钟 | 一次性操作 |
| 出题（10 道题） | ≤ 10 秒 | LLM API 调用 |
| 客观题批改 | ≤ 1 秒 | 本地正则匹配 |
| 主观题批改 | ≤ 5 秒 | LLM API 调用 |
| 计划调整 | ≤ 2 秒 | 本地计算 |

### 5.2 可靠性

- **断点续传**：任何时刻可暂停，下次从事件日志恢复
- **自动保存**：每次 LLM 调用后自动序列化状态到事件日志
- **Git 备份**：每次状态变更自动 `git commit`，可回滚到任意版本
- **错误恢复**：API 错误 / Schema 校验失败时，压缩错误摘要追加到日志，LLM 自修正（最多 3 次重试）

### 5.3 可扩展性

- **新科目接入**：只需提供新资料，无需改代码
- **新题型接入**：在 `prompts/` 下新增题型 Prompt 模板
- **新模型接入**：在 `config/models.json` 中配置模型参数，自动路由

### 5.4 安全性与隐私

- **本地优先**：所有数据存储在用户本地，不上传云端
- **可选云同步**：用户可自主选择同步到私有 Git 仓库或云盘
- **数据导出**：支持导出全部数据为 Markdown / JSON 压缩包
- **数据删除**：一键清空所有数据（`rm -rf workspace/`）

---

## 6. 技术架构

### 6.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                     用户界面层（可选）                        │
│  终端 TUI (pi)  │  Markdown 阅读器  │  Obsidian 插件（未来）  │
├─────────────────────────────────────────────────────────────┤
│                    Agent 编排层（核心）                        │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐        │
│  │ 主循环   │  │ 状态机   │  │ 事件日志 │  │ 人类工具 │        │
│  │ Agent   │  │ 路由   │  │ 管理器   │  │ 调用    │        │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘        │
│       └────────────┴────────────┴────────────┘               │
├─────────────────────────────────────────────────────────────┤
│                    微 Agent 层（9 个）                         │
│  MaterialCollector → Chunker → GraphBuilder → Planner       │
│       ↓              ↓            ↓            ↓            │
│  TaskDispatcher → QuizGenerator → Grader → MistakeAnalyzer  │
│       ↓                                                      │
│  PlanAdjuster ─────────────────────────────────────────────→ │
│  （回流到 Planner）                                          │
├─────────────────────────────────────────────────────────────┤
│                    模型层（可插拔）                            │
│  Claude 3.5  │  GPT-4o  │  GLM-4  │  Qwen2.5  │  Ollama   │
│  （复杂推理）   （通用任务）  （中文优化） （本地免费）        │
├─────────────────────────────────────────────────────────────┤
│                    数据层（文件驱动）                          │
│  workspace/                                                  │
│  ├── materials/    # 原始资料（Markdown）                      │
│  ├── chunks/       # 知识切片                                │
│  ├── graph/        # 知识图谱（JSON）                        │
│  ├── plan/         # 复习计划（JSON）                        │
│  ├── tasks/        # 每日任务（JSON）                        │
│  ├── quizzes/      # 题目（JSON + Markdown）                  │
│  ├── results/      # 批改结果（JSON）                        │
│  ├── mistakes/     # 错题（JSONL）                          │
│  ├── progress/     # 掌握度追踪（JSON）                      │
│  ├── prompts/      # Prompt 模板（Markdown）                │
│  └── event_log/    # 事件日志（JSONL）← 单一事实来源          │
├─────────────────────────────────────────────────────────────┤
│                    基础设施层                                  │
│  Git（版本控制）│  Cron（定时触发）│  SQLite-vec（可选向量） │
└─────────────────────────────────────────────────────────────┘
```

### 6.2 核心循环（12-Factor 状态机）

```typescript
// 主循环：代码控制流，LLM 只输出决策 JSON
// 遵循 Factor 8: Own Your Control Flow
async function mainLoop(thread: EventLog, event: Event): Promise<EventLog> {
  // 1. 从事件日志重建当前状态（Factor 5, 12）
  const state = foldState(thread);

  // 2. 构建上下文（Factor 3）
  const context = buildContext(state, event);

  // 3. 调用 LLM，获取结构化决策（Factor 1, 4）
  const decision = await llm.decide(context, prompts.decision);

  // 4. 代码路由执行（Factor 8）—— LLM 不决定路径
  switch (decision.action) {
    case 'collect_material': 
      return await materialAgent.run(thread, decision);
    case 'chunk_content': 
      return await chunkerAgent.run(thread, decision);
    case 'build_graph': 
      return await graphAgent.run(thread, decision);
    case 'generate_plan': 
      return await plannerAgent.run(thread, decision);
    case 'dispatch_task': 
      return await dispatcherAgent.run(thread, decision);
    case 'generate_quiz': 
      return await quizAgent.run(thread, decision);
    case 'grade_answer': 
      return await graderAgent.run(thread, decision);
    case 'analyze_mistake': 
      return await mistakeAgent.run(thread, decision);
    case 'adjust_plan': 
      return await adjusterAgent.run(thread, decision);
    case 'request_human_approval': 
      return await humanApprovalTool(thread, decision); // Factor 7
    case 'done': 
      return thread;
    default:
      // Factor 9: 错误压缩回上下文
      return await errorRecovery(thread, { error: 'unknown_action', action: decision.action });
  }
}

// 状态折叠：所有状态从事件日志重建（Factor 12: Stateless Reducer）
function foldState(thread: EventLog): AppState {
  return thread.events.reduce((state, event) => {
    return reducer(state, event);
  }, initialState);
}
```

### 6.3 多模型路由

```json
// config/models.json
{
  "router": {
    "default": "claude-3-5-sonnet",
    "rules": [
      { "task": "chunk", "model": "ollama/llama3.1:8b", "cost": "free" },
      { "task": "quiz_generation", "model": "claude-3-5-sonnet", "cost": "medium" },
      { "task": "subjective_grading", "model": "gpt-4o", "cost": "high" },
      { "task": "plan_adjustment", "model": "ollama/llama3.1:8b", "cost": "free" }
    ]
  },
  "budget": {
    "daily_limit_usd": 2.0,
    "alert_threshold": 0.8
  }
}
```

---

## 7. 数据模型

### 7.1 核心实体

#### Material（原始资料）

```json
{
  "id": "mat_001",
  "source": "https://example.com/economics-ch1",
  "type": "webpage",
  "title": "微观经济学第一章：供需理论",
  "content_path": "materials/2026-07-09_供需理论.md",
  "meta": {
    "captured_at": "2026-07-09T10:00:00Z",
    "word_count": 3500,
    "language": "zh"
  }
}
```

#### Chunk（知识切片）

```json
{
  "id": "chunk_042",
  "material_id": "mat_001",
  "content": "需求曲线表示在其他条件不变的情况下...",
  "embedding": [0.023, -0.156, 0.891, ...],
  "chapter_path": "1.2.3",
  "difficulty": "medium",
  "concepts": ["需求曲线", "价格", "需求量"],
  "source_link": "materials/2026-07-09_供需理论.md#L45-L78"
}
```

#### KnowledgeNode（知识节点）

```json
{
  "id": "node_007",
  "name": "价格弹性",
  "definition": "衡量需求量对价格变动的敏感程度...",
  "prerequisites": ["node_003", "node_005"],
  "weight": 0.85,
  "mastery": 0.42,
  "related_chunks": ["chunk_042", "chunk_043"]
}
```

#### StudyPlan（复习计划）

```json
{
  "id": "plan_001",
  "user_id": "user_default",
  "exam_date": "2026-09-15",
  "daily_minutes": 120,
  "target_score": 85,
  "schedule": [
    {
      "date": "2026-07-10",
      "tasks": [
        { "type": "learn", "node_id": "node_007", "duration": 45 },
        { "type": "review", "node_id": "node_003", "duration": 30 },
        { "type": "quiz", "node_ids": ["node_003", "node_005"], "duration": 45 }
      ]
    }
  ]
}
```

#### Task（每日任务）

```json
{
  "id": "task_2026-07-10_001",
  "plan_id": "plan_001",
  "type": "learn",
  "node_id": "node_007",
  "content_path": "chunks/chunk_042.md",
  "status": "pending",
  "scheduled_duration": 45,
  "actual_duration": null,
  "completed_at": null
}
```

#### Question（题目）

```json
{
  "id": "q_2026-07-10_003",
  "type": "single_choice",
  "difficulty": 0.6,
  "stem": "当需求价格弹性大于 1 时，价格上升会导致...",
  "options": ["总收入增加", "总收入减少", "总收入不变", "无法确定"],
  "answer": 1,
  "explanation": "弹性大于 1 意味着需求量变动百分比大于价格变动百分比...",
  "tags": ["node_007", "价格弹性"],
  "source_chunks": ["chunk_042"]
}
```

#### Answer（作答记录）

```json
{
  "id": "ans_2026-07-10_003",
  "question_id": "q_2026-07-10_003",
  "user_answer": 1,
  "is_correct": true,
  "score": 100,
  "time_spent": 45,
  "graded_at": "2026-07-10T20:15:00Z",
  "graded_by": "grader_agent"
}
```

#### Mistake（错题）

```json
{
  "id": "mist_2026-07-10_002",
  "answer_id": "ans_2026-07-10_002",
  "error_type": "concept_unclear",
  "weak_node_id": "node_007",
  "review_count": 0,
  "next_review": "2026-07-11",
  "review_intervals": [1, 3, 7, 15, 30],
  "similar_questions": ["q_2026-07-05_008", "q_2026-06-28_012"]
}
```

### 7.2 事件日志（Event Log）—— 单一事实来源

```jsonl
// event_log/events.jsonl
{"id":"evt_001","timestamp":"2026-07-09T10:00:00Z","agent":"material_collector","action":"material_imported","input":{"url":"https://example.com/econ"},"output":{"material_id":"mat_001"}}
{"id":"evt_002","timestamp":"2026-07-09T10:05:00Z","agent":"chunker","action":"chunks_generated","input":{"material_id":"mat_001"},"output":{"chunk_count":15,"chunk_ids":["chunk_001",...]}}
{"id":"evt_003","timestamp":"2026-07-09T10:30:00Z","agent":"graph_builder","action":"graph_built","input":{"chunk_count":15},"output":{"node_count":8,"edge_count":12}}
{"id":"evt_004","timestamp":"2026-07-09T10:35:00Z","agent":"planner","action":"plan_generated","input":{"exam_date":"2026-09-15"},"output":{"plan_id":"plan_001","total_days":68}}
{"id":"evt_005","timestamp":"2026-07-09T10:36:00Z","agent":"human_approval","action":"plan_approved","input":{"plan_id":"plan_001"},"output":{"approved":true,"user_adjustments":[]}}
{"id":"evt_006","timestamp":"2026-07-10T08:00:00Z","agent":"task_dispatcher","action":"tasks_dispatched","input":{"date":"2026-07-10"},"output":{"task_count":3}}
{"id":"evt_007","timestamp":"2026-07-10T20:00:00Z","agent":"quiz_generator","action":"quiz_generated","input":{"node_ids":["node_007"]},"output":{"quiz_id":"quiz_2026-07-10","question_count":8}}
{"id":"evt_008","timestamp":"2026-07-10T20:10:00Z","agent":"grader","action":"quiz_graded","input":{"quiz_id":"quiz_2026-07-10"},"output":{"total_score":75,"mistake_count":2}}
{"id":"evt_009","timestamp":"2026-07-10T20:12:00Z","agent":"mistake_analyzer","action":"mistakes_archived","input":{"mistake_count":2},"output":{"weak_nodes":["node_007"]}}
{"id":"evt_010","timestamp":"2026-07-10T20:15:00Z","agent":"plan_adjuster","action":"plan_adjusted","input":{"weak_nodes":["node_007"]},"output":{"plan_id":"plan_001_v2","adjustments":["increase_node_007_weight"]}}
```

---

## 8. 12-Factor Agents 对照实现

| 原则 | 实现方式 | 备考场景示例 |
|------|---------|------------|
| **1. Natural Language → Tool Calls** | LLM 输出严格 JSON Schema，代码路由执行 | `{"action":"generate_quiz","params":{"node_ids":["node_007"],"count":8}}` |
| **2. Own Your Prompts** | Prompt 放在 `prompts/` 目录，独立文件，Git 版本控制 | `prompts/planner-v1.md`、`prompts/grader-v2.md` |
| **3. Own Your Context Window** | 自定义 XML-like 格式，主动摘要，只加载相关 Chunk | 不重复粘贴全文，只传摘要 + 源链接 |
| **4. Tools Are Structured Outputs** | 全部使用 Zod / JSON Schema 校验，LLM 只输出决策 JSON | 出题 Agent 输出 `{"questions":[...]}`，渲染由代码处理 |
| **5. Unify Execution & Business State** | 单一事件日志 `event_log/events.jsonl`，所有状态 = fold(event_log) | 掌握度、进度、错题全在一个日志 |
| **6. Launch / Pause / Resume** | 每次 LLM 调用后序列化状态到事件日志 | 今天学到一半，明天从断点继续 |
| **7. Contact Humans with Tool Calls** | `request_human_approval` 工具调用，人类决策作为事件写入日志 | 计划生成后用户确认、批改结果用户复核 |
| **8. Own Your Control Flow** | 代码 `switch` 路由，LLM 只输出决策 JSON | 计划调整必须经过代码审批（防止 LLM 乱删已学内容） |
| **9. Compact Errors into Context** | 错误摘要追加到事件日志，限制重试 3 次 | 出题失败 → 压缩错误 → LLM 自修正 → 最多 3 次 |
| **10. Small, Focused Agents** | 9 个独立微 Agent，每个只做一件事，通过事件日志协作 | MaterialCollector、Chunker、GraphBuilder... |
| **11. Trigger from Anywhere** | Cron 触发（每日任务）、Webhook 触发（考试日期变更）、手动触发 | 每日早晨自动推送、考试日期变更自动调整 |
| **12. Stateless Reducer** | `function agent(thread, event) { return newThread; }` | 可单元测试、可 Replay、可 A/B 测试 |

---

## 9. 部署与运维

### 9.1 安装与启动

```bash
# 1. 安装 Pi Agent（如果尚未安装）
npm install -g pi

# 2. 克隆项目
git clone https://github.com/your-org/studymate-agent.git
cd studymate-agent

# 3. 安装依赖
npm install

# 4. 配置模型（可选，默认使用 Claude）
cp config/models.example.json config/models.json
# 编辑 config/models.json 设置 API Key

# 5. 初始化工作空间
pi run init
# 生成 workspace/ 目录结构

# 6. 启动 Agent
pi run start
# 进入交互式 TUI，开始备考之旅
```

### 9.2 目录结构

```
studymate-agent/
├── src/
│   ├── agents/              # 9 个微 Agent 实现
│   │   ├── material_collector.ts
│   │   ├── chunker.ts
│   │   ├── graph_builder.ts
│   │   ├── planner.ts
│   │   ├── task_dispatcher.ts
│   │   ├── quiz_generator.ts
│   │   ├── grader.ts
│   │   ├── mistake_analyzer.ts
│   │   └── plan_adjuster.ts
│   ├── core/
│   │   ├── event_log.ts     # 事件日志管理
│   │   ├── state_machine.ts # 状态机路由
│   │   ├── context_builder.ts # 上下文构建
│   │   ├── model_router.ts  # 多模型路由
│   │   └── human_tool.ts    # 人类在环工具
│   └── utils/
│       ├── file_utils.ts
│       ├── git_utils.ts
│       └── validators.ts
├── prompts/                 # 所有 Prompt 模板（Factor 2）
│   ├── material_collector.md
│   ├── chunker.md
│   ├── graph_builder.md
│   ├── planner.md
│   ├── quiz_generator.md
│   ├── grader.md
│   └── plan_adjuster.md
├── config/
│   ├── models.json          # 模型配置
│   └── schedule.json        # 调度配置
├── workspace/               # 用户数据（Git 忽略）
│   ├── materials/
│   ├── chunks/
│   ├── graph/
│   ├── plan/
│   ├── tasks/
│   ├── quizzes/
│   ├── results/
│   ├── mistakes/
│   ├── progress/
│   └── event_log/
├── tests/                   # 单元测试
│   ├── agents/
│   └── integration/
├── package.json
├── tsconfig.json
└── README.md
```

### 9.3 定时任务配置

```bash
# 使用 Cron 每日早晨 8:00 推送任务
0 8 * * * cd /path/to/studymate-agent && pi run dispatch --date=today

# 使用 Cron 每日晚间 20:00 自动生成测验
0 20 * * * cd /path/to/studymate-agent && pi run quiz --auto
```

### 9.4 备份与恢复

```bash
# 备份：整个 workspace 目录 + Git 历史
tar -czf studymate-backup-$(date +%Y%m%d).tar.gz workspace/ .git/

# 恢复：从备份重建状态
tar -xzf studymate-backup-20260709.tar.gz
pi run resume --from-event=evt_001
```

---

## 10. 里程碑规划

### Milestone 1：核心闭环（Week 1-2）

**目标**：跑通「资料 → 拆解 → 计划 → 任务 → 出题 → 批改」最小闭环

**交付物**：
- [ ] MaterialCollector Agent（支持 PDF + URL）
- [ ] Chunker Agent（语义切分）
- [ ] Planner Agent（艾宾浩斯排期）
- [ ] TaskDispatcher Agent（每日推送）
- [ ] QuizGenerator Agent（单选/多选）
- [ ] Grader Agent（客观题自动判分）
- [ ] 事件日志系统（核心基础设施）
- [ ] 终端 TUI 界面

**验收标准**：用户上传 1 份 PDF，2 分钟后拿到今日学习任务和 5 道练习题，完成答题后即时看到得分。

### Milestone 2：知识图谱 + 错题闭环（Week 3-4）

**目标**：增加知识图谱构建、错题分析、计划动态调整

**交付物**：
- [ ] GraphBuilder Agent（知识图谱 + 可视化）
- [ ] MistakeAnalyzer Agent（错题归档 + 薄弱点定位）
- [ ] PlanAdjuster Agent（基于错题动态调整）
- [ ] 人类在环工具（计划确认、批改复核）
- [ ] 暂停/恢复功能

**验收标准**：用户连续 3 天答题后，系统能识别薄弱知识点并自动增加相关训练量。

### Milestone 3：智能化升级（Week 5-6）

**目标**：自适应出题、主观题批改、多模型路由

**交付物**：
- [ ] IRT 自适应选题算法
- [ ] 主观题 AI 评分（LLM 评分 + 人类复核）
- [ ] 多模型路由（本地 Ollama + Claude/GPT 混合）
- [ ] 错误自恢复（Factor 9）
- [ ] 相似题推荐（基于 Embedding）

**验收标准**：用户能力评估准确，主观题评分与人类评分误差 < 10%。

### Milestone 4：生态与扩展（Week 7-8）

**目标**：支持多科目、多用户、插件化扩展

**交付物**：
- [ ] 多科目并行管理
- [ ] 插件系统（自定义题型、自定义资料解析器）
- [ ] Web 看板（可选，Obsidian 插件或独立页面）
- [ ] 数据导出（PDF 错题本、Excel 进度报表）
- [ ] 社区 Prompt 模板市场

**验收标准**：用户可同时管理 3 个科目的备考，数据可导出为 PDF 错题本。

---

## 11. 风险与对策

| 风险 | 影响 | 概率 | 对策 |
|------|------|------|------|
| **LLM 幻觉导致知识图谱错误** | 高 | 中 | 人类在环确认（Factor 7）；关键节点强制人工审核；多模型交叉验证 |
| **LLM API 成本过高** | 中 | 高 | 多模型路由（简单任务用本地 Ollama）；Token 预算管理；每日成本上限告警 |
| **资料拆解质量不稳定** | 中 | 中 | 人类可手动调整 Chunk；提供反馈机制让 Agent 学习；保留原始资料链接 |
| **计划过于僵化，用户无法坚持** | 高 | 中 | 计划调整 Agent 动态优化；人类可随时修改；提供"偷懒模式"（减少当日任务量） |
| **主观题评分争议** | 中 | 中 | 评分依据透明化（列出采分点）；用户可复核并修正；保留评分历史 |
| **数据丢失** | 高 | 低 | Git 自动 commit；每日自动备份；事件日志追加写入，不可覆盖 |
| **跨平台兼容性** | 低 | 低 | 纯文件驱动，无数据库依赖；TypeScript 编译为 JS，Node.js 运行 |

---

## 附录

### A. 术语表

| 术语 | 定义 |
|------|------|
| **Agent** | 自主执行特定任务的 AI 程序单元 |
| **Chunk** | 知识切片，语义级文本片段 |
| **Event Log** | 事件日志，所有状态变更的追加记录 |
| **Factor** | 12-Factor Agents 原则中的单条工程规范 |
| **Harness** | 对 Agent 行为的治理框架（源自 harness-lab） |
| **IRT** | 项目反应理论，自适应测试算法 |
| **MCP** | Model Context Protocol，模型上下文协议 |
| **Pi Agent** | 极简终端编码 Agent 工具集 |
| **Reducer** | 纯函数：(State, Event) → NewState |
| **TUI** | Terminal User Interface，终端用户界面 |

### B. 参考资源

- [humanlayer/12-factor-agents](https://github.com/humanlayer/12-factor-agents) — 12-Factor Agents 工程原则
- [Joe-rq/harness-lab](https://github.com/Joe-rq/harness-lab) — Agent 研发治理框架
- [Pi Agent](https://github.com/badlogic/pi) — 极简终端编码 Agent 工具集
- [MCP](https://modelcontextprotocol.io) — Model Context Protocol
- [LangGraph](https://github.com/langchain-ai/langgraph) — Agent 编排框架（参考对比）

---

> **文档结束**
> 
> 本 PRD 遵循 12-Factor Agents 工程原则，以文件驱动、事件日志为核心，实现可审计、可暂停、可回滚的自适应学习闭环。
