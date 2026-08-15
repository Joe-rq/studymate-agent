# StudyMate PRD 修复下一步计划

> 日期：2026-08-15  
> 状态：已完成（阶段一~五全部落地，336 用例 / 42 文件全绿）
> 目标：先消除真实 `workspace/` 被测试污染的风险，再补齐批改恢复、部署认证、任务快照和证据文档，最终重新执行完整验收。

## 1. 当前结论

当前版本已经实现了大部分核心修复，包括计划容量缺口、初始复习间隔、Study Studio 多任务闭环、本地资料上传、无搜索 Key 降级、默认本机监听、指标边界和 LLM 审计元数据。

但项目尚不能认定为“修复全部完成”，主要阻塞如下：

1. 部分 API 写入链路仍未传递 `workspaceRoot`，测试可能再次覆盖真实 `workspace/`。
2. 批改工作流只实现了接口层聚合，不能抵御中途失败和并发重复提交。
3. 后端 Token 认证尚未形成可用的 Web 端到端闭环。
4. 计划调整后，已存在的 Markdown todo 不会立即同步重建。
5. 修复计划、README、测试文件数量和真实验收状态仍有不一致。
6. 真实搜索、真实 LLM、连续三日和浏览器人工验收尚未完成。

在完成测试隔离前，不应重跑全量 Vitest，也不应运行会写入默认 `workspace/` 的 Demo。

## 2. 阶段一：彻底修复测试隔离（P0）

### 2.1 目标

任何传入 `workspaceRoot` 的 API、工作流和测试都只能读写指定目录，不得回退到默认 `workspace/`。

### 2.2 修改范围

重点修复 `src/server/app.ts` 中以下调用，补传 `options.workspaceRoot`：

- `approveSources()`
- `savePlan()`
- `approvePlan()`
- `generateScopedQuiz()`
- `gradeAndAdapt()`

随后全局检查：

- 所有接受 `workspaceRoot` 的函数调用是否完整传递参数；
- 所有 `Paths.*` 写入是否能在测试模式下正确切换目录；
- Server、Application Workflow 和 Agent 三层是否存在中途丢失作用域的调用链。

### 2.3 回归测试

新增“默认 workspace 不变”保护测试：

1. 测试前记录默认 `workspace/` 中关键文件的存在状态、内容哈希和修改时间。
2. 使用临时 `workspaceRoot` 调用以下 API：
   - 来源确认；
   - 计划生成；
   - 计划确认；
   - 测验生成；
   - 普通批改。
3. 验证所有产物只出现在临时目录。
4. 验证默认 `workspace/` 的关键文件未新增、未删除、内容未变化。

### 2.4 完成门槛

- 所有隔离测试通过。
- 默认 `workspace/` 前后哈希一致。
- 全局搜索未发现遗漏的默认路径写入。
- 达到以上条件后，才允许重新运行全量 Vitest。

## 3. 阶段二：加强批改幂等与失败恢复（P1）

### 3.1 目标

同一测验的重复或并发提交不能重复累计错题、掌握度、计划调整和学习者模型；失败后必须可以判断当前状态并安全恢复。

### 3.2 最小实现方案

- 按 `quizId` 增加进程内互斥锁，阻止同一测验并发批改。
- 将批改回执区分为：
  - `processing`
  - `completed`
  - `failed`
- 工作流全部完成后才写入 `completed` 回执。
- 对相同答案的已完成请求返回原回执。
- 对不同答案的重复请求返回 `409 Conflict`。
- 不再使用空 `catch` 吞掉计划调整错误；仅对明确允许忽略的 `ENOENT` 降级。
- 文档明确：当前为本地文件工作流，不具备数据库事务级原子性。

### 3.3 回归测试

- 相同答案并发提交时，掌握度只更新一次。
- 不同答案并发提交时，一个请求成功，另一个返回 409。
- 分别在成绩、错题、掌握度、计划和学习者模型写入阶段注入失败。
- 失败后重试不会重复累计已经成功写入的副作用。
- 响应丢失后的相同答案重试继续返回同一结果。

### 3.4 完成门槛

- 串行重试、并发提交和中途失败测试全部通过。
- 不再把接口聚合描述为“完全原子”。
- 所有被忽略的异常都有明确类型和降级理由。

## 4. 阶段三：补齐部署认证闭环（P1）

### 4.1 目标

启用 `STUDYMATE_ACCESS_TOKEN` 后，Web UI 仍可正常使用；未认证访问不能读取或修改学习数据；Token 不进入 URL 和日志。

### 4.2 修改范围

- Web 增加 Token 输入或配置入口。
- Token 默认保存在 `sessionStorage`，关闭会话后失效。
- Web API 客户端统一发送：

  ```http
  Authorization: Bearer <token>
  ```

- API 返回 401 时，引导用户重新输入 Token。
- 删除后端 `?access_token=` 支持。
- 删除部署文档中通过 Query 参数传 Token 的说明。
- 检查错误响应、事件日志和启动日志，确保不输出 Token。
- 当服务绑定非回环地址时：
  - 生产模式未配置 Token则拒绝启动；或
  - 至少提供明确、不可忽略的高风险告警。

### 4.3 回归测试

- 未提供 Token 时，敏感 API 返回 401。
- 错误 Token 返回 401。
- 正确 Bearer Token 可以完成 Web 主要流程。
- Exam、Weakness、Buddy History 和计划修改接口均受保护。
- URL、事件日志和错误响应中不出现 Token。

### 4.4 完成门槛

- 开启 Token 后 Web 建档、学习、测验、批改和搭子页面可用。
- 未认证访问无法读取个人学习数据。
- 部署文档与真实认证方式一致。

## 5. 阶段四：统一计划与任务快照（P2）

### 5.1 目标

`plan_master.json`、`plan_daily/*.json`、Web Tasks、CLI `today` 和 Markdown todo 对同一日期给出一致结果。

### 5.2 推荐策略

以 JSON 为事实源，Markdown 为可重建快照：

- `saveAdjustedPlan()` 写完计划 JSON 后，找出实际受影响日期。
- 对已经存在 Markdown todo 的日期立即重建快照。
- 重建时合并任务完成进度，不得把 `done` 或 `skipped` 恢复成 `pending`。
- Markdown 文件头注明：

  > 本文件由计划与任务进度生成，JSON 数据为事实源。

- 如果快照内容没有变化，不重复写文件或追加事件。

### 5.3 回归测试

- 晚间批改不会向当天插入新任务。
- 调整计划后，次日 JSON 与已存在的 Markdown todo 同步更新。
- Web Tasks 与 CLI `today` 显示一致。
- 已完成和已跳过状态得到保留。
- 重复调整不会产生重复任务。

### 5.4 完成门槛

- 同一日期的各层任务数量、类型、概念和状态一致。
- README 不再声明超出实际行为的同步能力。

## 6. 阶段五：清理 Diff 与文档证据（P2）

### 6.1 Diff 清理

- 处理 CRLF 和尾随空白问题。
- 确保 `git diff --check` 无输出且退出码为 0。
- 避免把纯行尾变化和业务修改混在一起。
- 将商业计划、图片、PDF、PPTX 等与本次代码修复无关的文件排除在修复提交之外。

### 6.2 文档修正

- 将修复计划中的“待实施”和“297 个测试”更新为当前真实状态。
- 当前测试统计应以重新运行后的 Vitest 输出为准；现有静态扫描为：
  - 328 个测试用例；
  - 41 个测试文件。
- README 分别记录：
  - 代码实现；
  - 自动化测试；
  - Mock 黄金路径；
  - 真实搜索与真实 LLM；
  - 连续三日验收；
  - 浏览器人工验收。
- 未执行的层级明确标记为“未验证”，不能用“可运行”替代“已验证”。
- 删除或修正“完全原子”“全部完成”“调整后立即同步 Markdown”等超出证据范围的描述。

### 6.3 完成门槛

- 代码、测试输出、README、修复计划和部署文档互相一致。
- 每条完成声明都能指向对应测试、运行记录或人工验收记录。

## 7. 最终验收顺序

### 7.1 自动化与安全验证

1. 备份真实 `workspace/`，或记录关键文件哈希。
2. 运行 workspace 隔离回归测试。
3. 运行全量 Vitest。
4. 再次比较真实 `workspace/` 哈希。
5. 运行根 TypeScript 构建。
6. 运行 Web TypeScript 与生产构建。
7. 运行 CLI smoke。
8. 运行服务启动冒烟，确认：
   - 默认监听 `127.0.0.1`；
   - 本机 API 返回预期状态；
   - 局域网不可访问；
   - 开启 Token 后未认证请求返回 401。
9. 运行 `git diff --check`。

### 7.2 Mock 黄金路径

使用临时 workspace、Mock LLM 且不配置外部 Key，完成：

1. 创建考试项目。
2. 上传本地 Markdown。
3. 构建知识库。
4. 生成无静默遗漏的计划。
5. 连续完成至少两个 Study Session。
6. 生成并提交 Session 绑定测验。
7. 验证成绩、错题、掌握度、计划调整和 Session History 落盘。
8. 验证刷新恢复。
9. 验证相同答案重试和不同答案冲突。
10. 验证默认真实 workspace 完全未变化。

### 7.3 人工与真实能力验收

- 浏览器窄屏布局。
- 页面刷新后的活动 Session 恢复。
- 批改响应中断后的重试。
- 关闭桌宠模式。
- 开启访问 Token 后的完整 Web 流程。
- 使用真实搜索和真实 LLM 完成一次建档闭环。
- 连续三日保存计划、任务、测验、批改和调整证据。
- 保存 model、promptVersion、durationMs 和 tokenUsage 记录。

这些项目未执行前，应继续标记为“未验证”。

## 8. 建议提交拆分

修复完成后建议拆成以下提交：

1. `fix: isolate all server workspace writes`
2. `fix: harden grade idempotency and recovery`
3. `feat: complete web token authentication flow`
4. `fix: synchronize adjusted plans with task snapshots`
5. `test: add isolation concurrency and recovery coverage`
6. `docs: align remediation and acceptance evidence`
7. `chore: normalize line endings and remove diff noise`

每个提交前分别检查 `git status`、定向测试和对应 diff，避免混入商业计划素材或其他无关文件。

## 9. 下一动作

当前唯一优先动作是：

> 修复五处 `workspaceRoot` 漏传，并增加“运行相关 API 后默认 workspace 哈希不变”的回归测试。

在该步骤完成并验证前，不运行全量 Vitest，不运行 Demo，也不重新生成真实学习计划。
