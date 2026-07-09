# Demo 脚本（逐字稿）

## 开场

"大家好，今天我要展示的是 StudyMate Agent，一个本地文件驱动的个人备考 Agent。它的核心问题是：考证党、考研党手里有大量自己的 PDF 教材和笔记，但传统 App 只能用固定题库。我们想让 Agent 自动接管你自己的资料，生成计划、出题、批改、回流错题。"

---

## 步骤 1：初始化（10 秒）

```bash
node dist/cli.js init
```

"首先初始化 workspace，所有数据都存在本地，包括资料、切片、计划、错题和事件日志。"

---

## 步骤 2：导入教材（15 秒）

```bash
node dist/cli.js ingest demo/materials/micro-economics.md
```

"上传一份微观经济学 Markdown 教材，Agent 自动按标题层级切成 5 个知识切片。"

---

## 步骤 3：生成计划（20 秒）

```bash
node dist/cli.js plan --exam 2026-09-15 --daily 60
```

"设置考试日期和每天 60 分钟，Agent 抽取 4 个核心概念，并按依赖关系生成 14 天复习计划。"

---

## 步骤 4：今日任务（15 秒）

```bash
node dist/cli.js today
```

"今天是 7 月 9 日，Agent 推送今日任务：学习 node_1 需求曲线。"

---

## 步骤 5：生成测验（20 秒）

```bash
node dist/cli.js quiz
```

"基于今日概念，Agent 自动生成 3 道选择题。我们可以看生成的 Markdown 试卷。"

---

## 步骤 6：批改与错题回流（30 秒）

```bash
node dist/cli.js grade --answers demo/answers/2026-07-09_answers.json
```

"提交答案后，Agent 自动批改：得分 33，2 道错题，薄弱知识点是价格弹性和市场均衡。这些错题会回流到后续计划，增加相关复习权重。"

---

## 步骤 7：事件日志（20 秒）

```bash
wc -l workspace/event_log/events.jsonl
cat workspace/event_log/events.jsonl
```

"最后，整个过程产生了 8 条事件日志。这是 12-Factor Agents 的核心设计：所有状态变更都追加到事件日志，可审计、可暂停、可 Replay。"

---

## 收尾

"这就是 StudyMate Agent 的最小闭环。两天内我们实现了资料导入到错题回流的完整链路，代码已开源在 GitHub。谢谢！"

---

## 备用：如果现场没有网络

使用 mock LLM 模式（不设置 OPENAI_API_KEY 即可），Demo 仍然可以完整跑通。
