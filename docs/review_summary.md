# 智能备考 Agent — 复盘总结

> 用于后续快速回顾：为什么做、参考了什么、做了什么取舍、下一步是什么。

---

## 1. 核心结论：这是 Agent 的典型应用场景

智能备考 Agent 完全符合 Agent 的核心特征：

- **多步骤工作流**：资料 → 切片 → 计划 → 任务 → 出题 → 批改 → 错题回流 → 调优
- **工具调用**：PDF 解析、网页抓取、LLM 出题/评分、文件读写、Cron 调度
- **长期状态**：掌握度、错题、计划版本持续累积
- **人在回路**：关键决策（计划确认、错题复核）需要人类参与
- **反馈闭环**：错题数据回流，动态调整后续计划

因此，这个方向**值得做**，且有大量现成理论/工具可以借鉴。

---

## 2. 外部参考：本地资料库 + pi.dev

### 2.1 本地资料库（`/Users/qrq/AI/AI-resource`）

该仓库本身就是一个「Obsidian + AI/Agent」的研究知识库，与备考 Agent 高度相关的内容：

| 资料 | 用途 |
|---|---|
| `wiki/summaries/36-12-factor-agents.md` | PRD 工程原则的完整理论支撑 |
| `wiki/concepts/Stateless-Reducer.md` | 事件日志 + `foldState` 的设计依据 |
| `raw/papers/ESAA-Event-Sourcing-for-Autonomous-Agents.md` | 事件溯源用于 Agent 生命周期管理 |
| `wiki/summaries/37-agent-memory-architecture-wquguru.md` | Agent 长期记忆四层架构，可迁移到「掌握度/薄弱点」模型 |
| `wiki/entities/NanoClaw.md` | 本地 Ollama + 四图谱记忆，个人知识库落地参考 |
| `raw/articles/2026-05-17-nanoclaws-second-brain.md` | 新加坡外长用 Obsidian + iCloud + NanoClaw 做第二大脑 |
| `wiki/entities/nashsu-llm-wiki.md` | Obsidian 兼容的 LLM Wiki 产品化实现 |
| `references/tooling-tips.md` | Obsidian 插件配置、MCP、语义搜索配置参考 |

**空白点**：没有专门的 Anki/SRS/间隔重复文档，也没有 K12/考证/考研类 Agent 案例。业务层面的备考细节需要自己补。

### 2.2 pi.dev（https://pi.dev/）

pi.dev 是一个 minimal agent harness，强调「adapt the harness, not your workflow」。对 studymate-agent 的借鉴：

| pi.dev 特性 | 对我们的启发 | 落地建议 |
|---|---|---|
| **AGENTS.md / SYSTEM.md 作为运行时指令** | 项目级指令不只是文档，可被 harness 加载 | 把 `AGENTS.md` 升级为 Agent 可读取的配置约定 |
| **Prompt Templates（`/name` 展开）** | Prompt 作为可复用、可共享的 Markdown 文件 | 将 `src/prompts/` 下模板进一步参数化、版本化 |
| **Skills 能力包** | 把能力拆成可插拔的技能单元 | 把出题、批改、计划调整封装为独立 skill，便于扩展 |
| **Extensions 扩展系统** | 不把所有功能做进核心，支持第三方扩展 | 设计插件接口，未来支持 Anki/FSRS/Obsidian MCP 插件 |
| **15+ LLM Providers** | 多模型路由是基础设施 | 当前仅支持 OpenAI-compatible + Mock，增加 Ollama 本地模型 |
| **Tree-structured history** | 会话历史以树状保存，支持分支/回溯 | 学习历史也可以用 tree 结构保存，支持「回退到某天的计划」 |
| **Print/JSON / RPC / SDK 四种模式** | 同一套能力输出多种接口 | CLI 之外可提供 JSON 输出模式，方便被 Obsidian 插件或工作流调用 |

**关键借鉴**：不要把所有智能都塞进 CLI，而是把每个 Agent 能力做成可被调用的「技能/扩展」，让 Obsidian、脚本、其他工具都能接入。

---

## 3. GitHub 开源项目参考

### 可直接对标的项目

| 项目 | 说明 |
|---|---|
| [ai-tutor GitHub Topic](https://github.com/topics/ai-tutor) | 本地自适应学习工作区，上传资料 → 笔记/测验/抽认卡/导师 |
| [study-assistant GitHub Topic](https://github.com/topics/study-assistant?o=desc&s=stars) | AI 学习助手项目聚合入口 |
| [GeminiLight/awesome-ai-llm4education](https://github.com/GeminiLight/awesome-ai-llm4education) | AI/LLM for Education 论文清单 |

### Obsidian + Agent 集成

| 项目 | 说明 |
|---|---|
| [aaronsb/obsidian-mcp-plugin](https://github.com/aaronsb/obsidian-mcp-plugin) | MCP server，让 AI agent 语义化访问 Obsidian vault |
| [tuan3w/obsidian-vault-agent](https://github.com/tuan3w/obsidian-vault-agent) | Claude Code 插件，把资料处理成互联笔记 |
| [jlevere/obsidian-mcp-plugin](https://github.com/jlevere/obsidian-mcp-plugin) | 另一个 Vault MCP 实现 |
| [Vault Knowledge Base (OKB)](https://www.obsidianstats.com/plugins/okb) | 本地语义检索层，供 Codex/Claude Code 通过 MCP 调用 |

### 间隔重复 / 测验 / SRS

| 项目 | 说明 |
|---|---|
| [wpwilson10/spacedrep](https://github.com/wpwilson10/spacedrep) | 面向 AI agents 的间隔重复 CLI + MCP server |
| [open-spaced-repetition/fsrs4anki](https://github.com/open-spaced-repetition/fsrs4anki) | 现代 FSRS 算法，已内置于 Anki 23.10+ |
| [w41ch0ng/MandarinMCP](https://github.com/w41ch0ng/MandarinMCP) | 中文学习 MCP server：词汇、测验、SRS、Anki 导出 |
| [vlopezferrando/simple-spaced-repetition](https://github.com/vlopezferrando/simple-spaced-repetition) | 简化版 Anki 算法实现 |

---

## 4. 关键取舍（MVP 版）

| 原 PRD | MVP 决策 | 原因 |
|---|---|---|
| 9 步闭环 | 保留核心 6-7 步 | 先跑通最小可用闭环 |
| 复杂知识图谱 + PageRank | 概念列表 + 简单前置依赖 | 降低 LLM 幻觉风险，缩短开发周期 |
| IRT 自适应出题 | 固定难度区间出题 | IRT 放到 v0.3 |
| 主观题 AI 评分 | 只做客观题 | 避免评分争议，简化人在回路 |
| 图片 OCR / 视频转文字 | 不做 | PDF + URL 已覆盖 MVP 场景 |
| Web 看板 / 独立前端 | 用 Obsidian 作为默认界面 | 降低前端开发成本，用户接受度高 |
| 多模型路由 | 默认 Claude/GPT，可选 Ollama | 简化配置 |
| Anki/FSRS 深度集成 | 仅导出 Markdown 错题本 | 先完成内部闭环，再对接外部工具 |
| 艾宾浩斯固定间隔 | 保留固定间隔 | 简单可预测，后续可插拔替换为 FSRS |

---

## 5. Obsidian 集成建议

### 推荐路径

1. **第一阶段**：直接把 `workspace/` 作为一个 Obsidian vault。
   - `tasks/2026-07-10_todo.md` 替代 Daily note
   - `mistakes/*.md` 用标签 `#错题` 聚合
   - `graph/learning_path.json` 用 Dataview 渲染

2. **第二阶段**：通过 MCP 增强。
   - 使用 [aaronsb/obsidian-mcp-plugin](https://github.com/aaronsb/obsidian-mcp-plugin)
   - Agent 可以主动搜索 vault、创建错题卡片、更新掌握度

3. **第三阶段**：开发专属 Obsidian 插件。
   - 内嵌计划确认、答题、掌握度曲线

### 为什么 Obsidian 是绝配

- 原生支持 Markdown，与 PRD 的文件驱动架构一致
- 双链和 Graph view 天然适合知识图谱展示
- Daily note / Dataview / 标签系统适合任务和错题管理
- 用户群体本身就是「自学者/知识工作者」，与目标用户重合

---

## 6. 下一步建议（基于当前状态）

当前项目已完成 MVP 闭环：6 个 CLI 命令、9 个微 Agent、事件日志、Mock LLM、测试和路演材料均已就绪。接下来按优先级推进：

### 6.1 赛前必做（黑客松前）

1. **真实 LLM 验证**：用 `OPENAI_API_KEY` 跑一次完整闭环，检查 `concept_mapper` 和 `quiz_generator` 输出质量，修复 prompt 问题。
2. **稳定性加固**：给 LLM 调用加重试、给关键 JSON 输出加校验、确保 Mock 和真实模型都能跑通。
3. **Obsidian 包装**：给 `tasks/`、`mistakes/` 等 Markdown 加入 Obsidian 标签，生成截图或 GIF。
4. **路演彩排**：完整排练 3 次以上，控制在 3 分钟内，准备离线 Demo 兜底方案。

详见：`docs/plans/hackathon-2day-plan.md`

### 6.2 赛后可扩展方向

1. **技能化/插件化**：参考 pi.dev 的 Skills/Extensions，把出题、批改、计划调整拆成可插拔能力。
2. **多模型支持**：增加 Ollama 本地模型，降低使用成本。
3. **复杂记忆层**：引入向量检索 + 知识图谱，替代当前简单的概念列表。
4. **FSRS 间隔重复**：替换固定艾宾浩斯间隔，提升复习效率。
5. **Obsidian MCP / 插件**：让 Agent 能主动读写 Obsidian vault。
6. **Web 看板**：为不习惯终端的用户提供可视化界面。

---

## 7. 关键假设

- 用户愿意在终端/Obsidian 中操作（非纯 GUI 用户）
- PDF 以标准文本教材为主（非扫描版/复杂排版）
- 用户有至少一个可用的 LLM API（Claude/GPT）或本地 Ollama
- 初期单科目、单用户、单设备

---

## 8. 可快速复用的资源清单

**必读（本地）**：
- `/Users/qrq/AI/AI-resource/wiki/summaries/36-12-factor-agents.md`
- `/Users/qrq/AI/AI-resource/wiki/concepts/Stateless-Reducer.md`
- `/Users/qrq/AI/AI-resource/raw/papers/ESAA-Event-Sourcing-for-Autonomous-Agents.md`

**必看（GitHub）**：
- https://github.com/topics/ai-tutor
- https://github.com/aaronsb/obsidian-mcp-plugin
- https://github.com/open-spaced-repetition/fsrs4anki
- https://github.com/wpwilson10/spacedrep

---

> **最后更新**：2026-07-09  
> **对应 PRD**：`docs/PRD_MVP_v0.1.md`  
> **两天作战计划**：`docs/plans/hackathon-2day-plan.md`  
> **外部参考**：`/Users/qrq/AI/AI-resource`、https://pi.dev/
