# StudyMate Agent - AI4S 提交说明

## 提交页两项必填

1. 作品链接：填写科学发现平台上 `studymate-exam-prep` 的作品详情/分享链接。
2. 参赛材料：上传最终生成的 `StudyMate-Agent-AI4S-Submission.zip`。

## 包内核心材料

- `skills/studymate-exam-prep/`：参赛 Skill。
- `src/`、`web/src/`、`api/`、`tests/`：完整项目源码与测试。
- `README.md`、`package.json`、`package-lock.json`：安装和运行说明。
- `docs/submission/StudyMate-AI4S-功能介绍.pptx`：可编辑功能介绍稿。
- `docs/submission/StudyMate-AI4S-功能介绍.pdf`：高保真展示版。
- `docs/demo-links.md`：在线演示、视频与验证入口。
- `screenshots/selected/`：精选界面截图和演示视频。

## 在线入口(免安装评审路径)

- **Web 应用**:https://studymate-agent-aekmaorln-qrx-joes-projects.vercel.app(Vercel 生产部署)
- **Demo 视频(B 站 2:45 加长版)**:https://www.bilibili.com/video/BV1Kob26QEY5/
- **开源仓库**:https://github.com/qrx-joe/studymate-agent

## 已完成验证

- `npm test`：42 个测试文件、336 项测试全部通过。
- `npm run build`：TypeScript 编译通过。
- `web/npm run build`：Web 生产构建通过。
- `npm run smoke`：CLI build 和帮助入口通过。
- 功能介绍 PPT：10 页逐页视觉检查通过；模板结构一致性检查通过。
- 功能介绍 PDF：10 页逐页渲染检查通过。

## 尚需人工完成

- 登录比赛官网确认报名、自由赛道队伍、成员信息、协议和剩余提交次数。
- ~~在科学发现平台公开发布 Skill，取得真实分享链接。~~(已完成,Skill 已公开发布)
- 推送最终代码到公开仓库，并确认链接可访问。
- 上传压缩包、提交后保存回执截图。

## 安全边界

最终包不包含 `.env.local`、API Key、`.git/`、`node_modules/`、构建产物、真实 `workspace/`、测试工作区、本机工具配置或临时文件。
