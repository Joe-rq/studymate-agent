# 智能备考 Agent — MVP 版产品需求文档

> **版本**：v0.1（MVP）  
> **日期**：2026-07-09  
> **作者**：AI 产品团队  
> **状态**：草案 → 开发 ready  
> **原则**：先跑通最小闭环，再叠加智能

---

## 1. 产品定位（一句话）

一个**本地文件驱动、Obsidian 为默认界面**的个人备考 Agent，让用户上传 PDF 教材后，2 分钟内拿到今日学习任务和 5 道练习题，完成答题后即时看到得分与错题回流。

---

## 2. MVP 边界

### 2.1 做哪些

| 模块 | MVP 范围 |
|---|---|
| 资料输入 | **PDF 教材**（优先）、用户粘贴的网页 URL |
| 资料解析 | 文本 + 简单表格提取，转 Markdown |
| 知识切片 | 按标题层级（H1→H2→H3）语义切分 |
| 知识组织 | 提取核心概念列表 + 简单依赖关系，**不强制做复杂知识图谱** |
| 复习计划 | 基于艾宾浩斯固定间隔（1→3→7→15 天）生成日任务 |
| 任务推送 | 每日早晨生成 Markdown 格式的今日任务 |
| 出题 | **单选 + 多选**，基于当日知识点 |
| 批改 | 客观题自动判分，输出得分与解析 |
| 错题 | 记录错题、错误类型、薄弱知识点 |
| 计划调整 | 根据错题率，次日自动增加薄弱知识点复习权重 |
| 界面 | **Obsidian vault** 作为默认界面，TUI 作为可选 |

### 2.2 不做哪些（放到后续版本）

- 图片 OCR、视频语音转文字
- 复杂知识图谱与 PageRank
- IRT 自适应出题算法
- 主观题 AI 评分
- 多模型路由
- Web 看板 / 独立前端
- 插件系统
- 多用户 / 多科目并行
- 与 Anki/FSRS 的深度集成（MVP 只导出 Markdown 错题本）

---

## 3. 目标用户

| 用户 | 场景 |
|---|---|
| 考证党 | 导入 1-3 份 PDF 教材，生成 30-60 天冲刺计划 |
| 考研党 | 导入专业课 PDF，每日按计划学习 + 做题 |
| 在职学习者 | 每晚 30 分钟完成当日任务包 |

---

## 4. 核心闭环（MVP 六步）

```
PDF 导入 → 语义切片 → 概念/依赖抽取 → 生成计划 → 每日任务 → 出题/批改/错题回流
                ↑___________________________________________________________↓
```

### 4.1 资料导入（MaterialCollector）

**输入**：
- 本地 PDF 文件
- 网页 URL（可选）

**处理**：
1. PDF 提取文本与表格结构（使用 `pdfplumber` 或 `marker`）
2. 网页下载正文（使用 `readability-lxml` 或 `jina.ai/reader`）
3. 统一转为 Markdown，保留标题层级
4. 生成文件哈希，简单去重

**输出**：
```
workspace/
├── materials/
│   ├── 2026-07-09_微观经济学教材.md
│   └── 2026-07-09_历年真题解析.md
```

**人类在环**：用户可在 Obsidian 中删除/重命名无关文件。

---

### 4.2 语义切片（Chunker）

**输入**：`materials/` 下 Markdown 文件

**处理**：
1. 按标题层级切分（H1 → H2 → H3）
2. 每个 Chunk 不超过 800 tokens，最小不低于 100 tokens
3. 记录章节路径（如 `1.2.3`）和来源链接
4. LLM 提取关键概念列表

**输出**：
```
workspace/
├── chunks/
│   ├── chunk_001.md
│   └── chunk_002.md
├── chunks_index.json   # 元数据索引
```

**Chunk 元数据示例**：
```json
{
  "id": "chunk_001",
  "material_id": "mat_001",
  "title": "需求曲线的定义",
  "chapter_path": "1.2",
  "concepts": ["需求曲线", "需求量", "价格"],
  "source_link": "materials/2026-07-09_微观经济学教材.md#L15-L45"
}
```

**人类在环**：用户可合并/拆分 Chunk，调整标题层级。

---

### 4.3 概念与依赖抽取（ConceptMapper）

MVP 不构建复杂图谱，只做**概念列表 + 前置依赖**：

1. LLM 从 Chunks 中提取核心概念（如「价格弹性」「边际效用」）
2. 识别每个概念的前置概念（最多 3 个）
3. 生成学习顺序（拓扑排序）

**输出**：
```
workspace/
├── graph/
│   ├── concepts.json        # 概念列表 + 前置依赖
│   └── learning_path.json   # 推荐学习顺序
```

**Concept 示例**：
```json
{
  "id": "node_001",
  "name": "价格弹性",
  "prerequisites": ["node_002", "node_003"],
  "related_chunks": ["chunk_005", "chunk_006"],
  "mastery": 0.0
}
```

---

### 4.4 生成复习计划（Planner）

**输入**：
- `graph/concepts.json`
- 考试日期
- 每日可用时间（分钟）

**处理**：
1. 按学习路径顺序，将概念分配到每一天
2. 每个新概念学习后，自动在 1/3/7/15 天后安排复习
3. 每日任务量不超过可用时间
4. 周末任务量可配置（默认与工作日相同）

**输出**：
```
workspace/
├── plan/
│   ├── plan_master.json
│   └── plan_daily/
│       ├── 2026-07-10.json
│       └── 2026-07-11.json
```

**日任务示例**：
```json
{
  "date": "2026-07-10",
  "tasks": [
    { "type": "learn", "node_id": "node_001", "duration": 45 },
    { "type": "review", "node_id": "node_002", "duration": 20 },
    { "type": "quiz", "node_ids": ["node_002"], "duration": 25 }
  ]
}
```

**人类在环**：用户在 Obsidian 中确认或调整计划（跳过某天、增加周末时间）。

---

### 4.5 每日任务执行（TaskDispatcher）

**输入**：`plan_daily/YYYY-MM-DD.json`

**处理**：
1. 早晨生成今日任务 Markdown（默认 8:00，可配置 Cron）
2. 加载相关 Chunk 内容到任务文件
3. 用户标记完成/跳过
4. 未完成任务自动顺延

**输出**：
```
workspace/
├── tasks/
│   ├── 2026-07-10_todo.md    # 今日任务（Obsidian 直接可读）
│   └── 2026-07-10_done.json  # 完成记录
```

**人类在环**：每日早晨用户在 Obsidian 中确认任务清单。

---

### 4.6 出题（QuizGenerator）

**输入**：
- 今日学习/复习的知识点
- 历史薄弱点（可选）

**处理**：
1. 为每个知识点生成 1-2 道单选/多选题
2. 每日总题量 5-10 道（可配置）
3. 题型比例：单选 70%，多选 30%
4. 解析必须回链到对应 Chunk

**输出**：
```
workspace/
├── quizzes/
│   ├── 2026-07-10_quiz.json
│   └── 2026-07-10_quiz.md    # 用户友好的 Markdown 试卷
```

**Question 示例**：
```json
{
  "id": "q_2026-07-10_001",
  "type": "single_choice",
  "node_id": "node_001",
  "stem": "当需求价格弹性大于 1 时，价格上升会导致...",
  "options": ["总收入增加", "总收入减少", "总收入不变", "无法确定"],
  "answer": 1,
  "explanation": "弹性大于 1 意味着需求量变动百分比大于价格变动百分比...",
  "source_chunk": "chunk_005"
}
```

**人类在环**：用户可替换/删除不满意题目。

---

### 4.7 批改（Grader）

**输入**：`quizzes/YYYY-MM-DD_quiz.json` + 用户答案

**处理**：
1. 单选/多选自动判分
2. 输出得分、正确率、每题解析
3. 统计各知识点得分

**输出**：
```
workspace/
├── results/
│   ├── 2026-07-10_result.json
│   └── 2026-07-10_report.md
```

**人类在环**：MVP 只做客观题，无主观题复核。

---

### 4.8 错题回流（MistakeAnalyzer）

**输入**：`results/YYYY-MM-DD_result.json`

**处理**：
1. 错误分类：概念不清 / 计算失误 / 审题错误 / 记忆模糊
2. 映射到薄弱知识点
3. 设置下次复习时间（1 天后）
4. 生成 Markdown 错题本

**输出**：
```
workspace/
├── mistakes/
│   ├── mistake_log.jsonl
│   ├── weakness_profile.json
│   └── 2026-07-10_wrong.md   # 当日错题本（Markdown）
```

**Mistake 示例**：
```json
{
  "id": "mist_2026-07-10_001",
  "question_id": "q_2026-07-10_001",
  "error_type": "concept_unclear",
  "weak_node_id": "node_001",
  "next_review": "2026-07-11"
}
```

---

### 4.9 计划调整（PlanAdjuster）

**输入**：`mistakes/mistake_log.jsonl` + `progress/mastery_tracker.json`

**处理**：
1. 错题率 > 50% 的知识点，掌握度 `mastery` 下降
2. 次日计划增加薄弱知识点复习任务
3. 已掌握知识点（连续 3 次做对）减少复习频次
4. 若任务超量，提示用户取舍

**输出**：
```
workspace/
├── plan/
│   ├── plan_master_v2.json
│   └── plan_adjustment_log.jsonl
```

---

## 5. 非功能需求（MVP 版）

| 指标 | 目标值 |
|---|---|
| PDF 解析（100 页） | ≤ 3 分钟 |
| 语义切片（100 页） | ≤ 2 分钟 |
| 出题（5-10 道） | ≤ 10 秒 |
| 客观题批改 | ≤ 1 秒 |
| 计划调整 | ≤ 2 秒 |

**可靠性**：
- 每次 LLM 调用后追加事件日志
- 关键状态自动 git commit（可配置）
- 错误最多重试 3 次

**隐私**：
- 所有数据本地存储
- LLM 调用可选择本地 Ollama 或云端 API

---

## 6. 技术架构（MVP）

```
┌─────────────────────────────────────┐
|           Obsidian（默认界面）        |
|  阅读 materials / 完成任务 / 查看错题  |
├─────────────────────────────────────┤
|           Agent 编排层               |
|  event_log/  +  state_machine       |
├─────────────────────────────────────┤
|  微 Agent 层（MVP 保留）              |
|  MaterialCollector → Chunker        |
|  ConceptMapper → Planner            |
|  TaskDispatcher → QuizGenerator     |
|  Grader → MistakeAnalyzer           |
|  PlanAdjuster                       |
├─────────────────────────────────────┤
|  模型层                              |
|  默认：Claude / GPT（复杂任务）       |
|  可选：Ollama（本地免费）             |
├─────────────────────────────────────┤
|  数据层（文件驱动）                   |
|  workspace/ 下的 materials/ chunks/  |
|  graph/ plan/ tasks/ quizzes/        |
|  results/ mistakes/ progress/        |
|  event_log/ prompts/                 |
└─────────────────────────────────────┘
```

### 6.1 事件日志（单一事实来源）

```jsonl
{"agent":"material_collector","action":"material_imported","input":{"file":"微观经济学.pdf"},"output":{"material_id":"mat_001"}}
{"agent":"chunker","action":"chunks_generated","input":{"material_id":"mat_001"},"output":{"chunk_count":15}}
{"agent":"planner","action":"plan_generated","input":{"exam_date":"2026-09-15"},"output":{"plan_id":"plan_001"}}
{"agent":"human_approval","action":"plan_approved","input":{"plan_id":"plan_001"},"output":{"approved":true}}
{"agent":"task_dispatcher","action":"tasks_dispatched","input":{"date":"2026-07-10"},"output":{"task_count":3}}
{"agent":"quiz_generator","action":"quiz_generated","input":{"date":"2026-07-10"},"output":{"question_count":8}}
{"agent":"grader","action":"quiz_graded","input":{"quiz_id":"quiz_2026-07-10"},"output":{"score":75,"mistake_count":2}}
{"agent":"plan_adjuster","action":"plan_adjusted","input":{"weak_nodes":["node_001"]},"output":{"plan_id":"plan_001_v2"}}
```

---

## 7. 目录结构（MVP）

```
studymate-agent/
├── src/
│   ├── agents/              # 9 个微 Agent（MVP 保留核心实现）
│   ├── core/
│   │   ├── event_log.ts
│   │   ├── state_machine.ts
│   │   └── human_tool.ts
│   └── utils/
│       ├── file_utils.ts
│       └── validators.ts
├── prompts/                 # Prompt 模板
├── config/
│   └── models.json
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
│   ├── event_log/
│   └── prompts/
├── package.json
├── tsconfig.json
└── README.md
```

---

## 8. 里程碑规划（MVP）

### Milestone 1：资料到计划（Week 1）

- [ ] MaterialCollector：PDF + URL 导入
- [ ] Chunker：按标题层级语义切分
- [ ] ConceptMapper：概念列表 + 简单依赖
- [ ] Planner：艾宾浩斯日计划生成
- [ ] 事件日志基础设施

**验收**：用户上传 1 份 PDF，1 分钟后在 Obsidian 看到未来 7 天学习计划。

### Milestone 2：任务到错题闭环（Week 2）

- [ ] TaskDispatcher：每日任务 Markdown
- [ ] QuizGenerator：单选/多选生成
- [ ] Grader：客观题自动判分
- [ ] MistakeAnalyzer：错题记录 + 薄弱点画像
- [ ] PlanAdjuster：基于错题的简单权重调整

**验收**：用户完成今日任务和 5 道题，系统即时判分并生成明日调整后的计划。

### Milestone 3：易用性打磨（Week 3-4）

- [ ] Obsidian vault 模板（目录结构、Daily note 模板）
- [ ] TUI 命令行启动器
- [ ] 配置化（模型选择、每日时间、考试日期）
- [ ] 错误恢复与重试机制
- [ ] README + 使用文档

**验收**：非技术用户能在 10 分钟内完成安装并生成第一份计划。

---

## 9. 风险与对策（MVP）

| 风险 | 影响 | 对策 |
|---|---|---|
| LLM 出题质量不稳定 | 高 | 用户可替换题目；解析强制回链 Chunk |
| PDF 解析格式混乱 | 中 | 优先支持标准学术论文/教材 PDF；提供手动修正入口 |
| 计划过满用户放弃 | 高 | 提供「偷懒模式」；任务超量时提示取舍 |
| 本地 LLM 能力不足 | 中 | 复杂任务默认走 Claude/GPT；Ollama 仅做可选 |
| 数据丢失 | 高 | 事件日志追加写入；自动 git commit |

---

## 10. 与 Obsidian 的集成方式

### 10.1 默认方式：Obsidian vault

- 把整个 `workspace/` 目录作为一个 Obsidian vault。
- `tasks/2026-07-10_todo.md` 是 Daily note 的替代品。
- `mistakes/*.md` 用 Obsidian 标签 `#错题` 聚合。
- `graph/learning_path.json` 通过 Dataview 渲染成表格或列表。

### 10.2 增强方式：MCP（后续可选）

- 通过 [obsidian-mcp-plugin](https://github.com/aaronsb/obsidian-mcp-plugin) 让 Agent 主动查询 vault。
- Agent 可以搜索笔记、创建错题卡片、更新掌握度。

### 10.3 未来方式：Obsidian 插件

- 开发专属插件，在 Obsidian 内直接：确认计划、答题、查看掌握度曲线。

---

## 11. 后续版本规划（不做进 MVP）

| 版本 | 内容 |
|---|---|
| v0.2 | 图片 OCR、视频转文字、复杂知识图谱 |
| v0.3 | IRT 自适应出题、主观题 AI 评分 |
| v0.4 | 多模型路由、Anki/FSRS 导出 |
| v0.5 | 多科目并行、Web 看板、插件系统 |

---

> **MVP 目标**：用 2-4 周时间，让任何一个人能在 10 分钟内启动一套最小可用的个人备考系统，并跑通「导入 → 学习 → 做题 → 错题回流 → 计划调整」的完整闭环。
