# StudyMate Agent — 黑客松路演讲稿

## 1. 问题场景（30 秒）

考证党、考研党、在职学习者都有一个共同痛点：

> **资料是自己的，但学习计划是别人的。**

- 教材、笔记、PDF 堆在电脑里，不知道从何开始
- 传统 App 只提供固定题库，无法处理你自己的资料
- 学了后面忘前面，没有基于遗忘曲线的动态复习
- 错题散落各处，无法自动回流到后续计划

中国考证培训市场规模超千亿，考研用户超 400 万，这是一群付费意愿强、时间敏感的用户。

## 2. 解决方案（30 秒）

StudyMate Agent = **本地文件驱动的个人备考 Agent**

用户只需要做三件事：
1. 上传 PDF/Markdown 教材
2. 设置考试日期和每日时间
3. 每天完成 Agent 推送的任务和测验

Agent 自动完成：资料解析 → 知识切片 → 概念抽取 → 计划生成 → 每日任务 → 智能出题 → 自动批改 → 错题回流 → 动态调优。

## 3. Demo 路径（2 分钟）

```bash
# 1. 初始化
node dist/cli.js init

# 2. 导入教材
node dist/cli.js ingest demo/materials/micro-economics.md

# 3. 生成计划
node dist/cli.js plan --exam 2026-09-15 --daily 60

# 4. 查看今日任务
node dist/cli.js today

# 5. 生成测验
node dist/cli.js quiz

# 6. 批改并回流错题
node dist/cli.js grade --answers demo/answers/2026-07-09_answers.json
```

预期输出：
- 14 天学习计划
- 今日学习任务 Markdown
- 3 道选择题
- 得分 33，错题 2 道，薄弱知识点自动标记
- 事件日志追加 8 条记录，全程可审计

## 4. 技术路线（45 秒）

- **TypeScript + Node.js**：跨平台，本地运行
- **Commander.js**：终端 CLI，零前端开发成本
- **pdf-parse**：PDF 文本提取
- **OpenAI-compatible API / Mock LLM**：概念抽取与出题
- **12-Factor Agents 架构**：事件日志为单一事实来源，代码控制流路由
- **文件驱动**：所有状态存在本地 Markdown/JSON，隐私优先

## 5. 商业化可能（45 秒）

| 阶段 | 模式 | 说明 |
|---|---|---|
| **短期** | 个人订阅 | $5-10/月，面向考证/考研党 |
| **中期** | B2B2C | 接入培训机构、在线教育平台 |
| **长期** | 企业培训 | 合规培训、产品知识考核 |

## 6. 竞争优势

- **本地优先**：资料不上云，隐私可控
- **任意资料**：PDF、Markdown、网页都能解析
- **动态计划**：基于艾宾浩斯 + 掌握度自动调整
- **可审计**：全链路事件日志，可 Replay
- **Obsidian 兼容**：workspace 直接作为 Obsidian vault

## 7. 结尾（15 秒）

> StudyMate 让每个人都能在 10 分钟内启动一套专属备考系统，把「我的资料」真正变成「我的计划」。

代码已开源：https://github.com/Joe-rq/studymate-agent
