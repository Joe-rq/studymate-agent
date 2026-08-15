# StudyMate Agent — 参赛材料索引

> 书生国智科探挑战赛 · 自由赛道「科艺融合 × AI4SS」· 2026-08

## 快速验证(无需 API Key)

```bash
npm install
npm run demo     # 生成示例考试数据(Mock 全流程)
npm run serve    # http://localhost:3456 完整 Web 应用
npm test         # 336 项测试(42 个测试文件)
```

## 材料

| 材料 | 位置 |
|---|---|
| 参赛 Skill | `skills/studymate-exam-prep/`(SKILL.md + agents/openai.yaml,符合 Agent Skills / SCP 规范) |
| 功能介绍 PPT | `docs/submission/StudyMate-AI4S-功能介绍.pptx`(10 页)/ `.pdf` |
| 开源仓库 | https://github.com/qrx-joe/studymate-agent |
| **可访问 Web 应用** | https://studymate-agent-aekmaorln-qrx-joes-projects.vercel.app(Vercel 生产部署,Web 界面与 `/api/*` 同源) |
| Demo 视频(B 站 2:45 加长版,最新 UI,中文配音) | https://www.bilibili.com/video/BV1Kob26QEY5/ |
| Demo 视频(B 站 78 秒精简版) | https://www.bilibili.com/video/BV1gduB6QEMD/ |
| 本地视频成片(2:45 加长版) | 仓库 `screenshots/demo_v3/studymate_demo.mp4`(提交包内 `screenshots/selected/studymate_demo.mp4`) |
| 本地视频成片(78 秒版) | 仓库 `screenshots/demo_v2/studymate_demo.mp4` |
| 界面截图 | 仓库 `screenshots/`(9 大页面 × 深浅主题;提交包内 `screenshots/selected/` 为精选) |

## 复现材料组合说明

按大赛提交口径「方法学与复现材料(择一或组合)」,本作品同时提供**两种**:

1. **源码仓库(GitHub)**:完整 TypeScript 源码 + 336 项测试,`npm install && npm run demo && npm run serve` 三条命令零密钥复现(见上方快速验证)。
2. **可访问 Web 应用(URL)**:上方 Vercel 链接,评审可直接打开体验完整 Web 界面,无需本地安装。

## 数据使用声明

- 本作品**不使用任何第三方科学数据集**:学习材料由使用者自行导入,或使用 `npm run demo` 在本地生成的示例考试数据;Demo 视频与截图均为本产品自有界面录制。
- 无 API Key 时以 Mock LLM/搜索降级运行,证明工作流执行;配置 `OPENAI_API_KEY` 后调用 OpenAI 兼容接口的真实大模型。
- 用户学习数据(材料、错题、掌握度)全部保存在本地 `workspace/`,本作品不收集、不上传任何用户数据。

## 证据边界

- **代码实现**:全部功能已在仓库实现,构建与测试全绿
- **Mock 验证**:无 API Key 时 Mock LLM/搜索跑通全流程,证明工作流执行
- **真实 API 验证**:配置 `OPENAI_API_KEY` 后切换真实大模型(OpenAI 兼容接口)
- 数据本地优先:材料、错题、掌握度全部留在本地 `workspace/`
