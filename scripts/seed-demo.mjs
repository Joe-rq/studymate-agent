/**
 * StudyMate Demo 数据种子
 *
 * 生成 CPA 会计基础演示数据到 workspace/，让你在没有真实教材 / API key 的情况下
 * 也能跑通完整闭环（首页 → /studio 材料→回忆→测验→反馈→复盘 → /growth）。
 *
 * 运行：npm run demo
 * 注意：会覆盖 workspace/ 下演示相关文件（exam/concepts/chunks/materials/plan/quizzes/
 *       tasks 进度/buddy 状态/会话记录）。请先备份真实数据。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WS = path.join(__dirname, '..', 'workspace');

const now = new Date();
const today = now.toISOString().slice(0, 10);
const examDate = new Date(now.getTime() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);

function write(rel, data) {
  const f = path.join(WS, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(data, null, 2) + '\n');
}

// ── 概念（CPA 会计基础）──────────────────────────────────────────
const concepts = [
  {
    id: 'node_1',
    name: '会计基本假设',
    definition: '会计确认、计量和报告的前提，包括会计主体、持续经营、会计分期和货币计量四项基本假设。',
    prerequisiteIds: [],
    relatedChunks: ['chk_1'],
    mastery: 0,
  },
  {
    id: 'node_2',
    name: '复式记账原理',
    definition: '对每笔经济业务在至少两个账户中作双重记录，借方金额与贷方金额恒等，是借贷记账法的理论基础。',
    prerequisiteIds: ['node_1'],
    relatedChunks: ['chk_2'],
    mastery: 0,
  },
  {
    id: 'node_3',
    name: '收入确认',
    definition: '企业在日常活动中形成的、会导致所有者权益增加、与所有者投入资本无关的经济利益总流入。',
    prerequisiteIds: ['node_2'],
    relatedChunks: ['chk_3'],
    mastery: 0,
  },
  {
    id: 'node_4',
    name: '期间费用',
    definition: '不计入产品成本、直接计入当期损益的费用，包括管理费用、销售费用和财务费用。',
    prerequisiteIds: ['node_1'],
    relatedChunks: ['chk_4'],
    mastery: 0,
  },
];

// ── 材料与 chunk ──────────────────────────────────────────────────
const chunks = [
  {
    id: 'chk_1',
    materialId: 'mat_1',
    title: '第一章 会计基本假设',
    content:
      '会计基本假设是会计确认、计量和报告的前提。\n\n会计主体假设界定会计核算的空间范围；持续经营假设假定企业会长期经营下去；会计分期假设将连续经营过程人为划分为会计期间；货币计量假设以货币为统一计量单位。',
    chapterPath: '1',
    sourceLink: 'demo://chk_1',
  },
  {
    id: 'chk_2',
    materialId: 'mat_1',
    title: '第二章 复式记账原理',
    content:
      '复式记账对每笔经济业务在两个或两个以上相互联系的账户中同时登记，借贷金额相等。\n\n例如用银行存款购入存货：借记"存货"，贷记"银行存款"，两方金额相同，保持会计等式平衡。',
    chapterPath: '2',
    sourceLink: 'demo://chk_2',
  },
  {
    id: 'chk_3',
    materialId: 'mat_1',
    title: '第三章 收入确认',
    content:
      '收入是企业在日常活动中形成的经济利益总流入，会导致所有者权益增加。\n\n收入确认需同时满足：经济利益很可能流入企业、流入额能可靠计量、相关的成本能可靠计量。',
    chapterPath: '3',
    sourceLink: 'demo://chk_3',
  },
  {
    id: 'chk_4',
    materialId: 'mat_1',
    title: '第四章 期间费用',
    content:
      '期间费用是指企业本期发生的、不能直接归属于某个特定产品成本、而应直接计入当期损益的费用。\n\n包括管理费用（行政管理部门发生的费用）、销售费用（销售过程中发生的费用）和财务费用（利息、汇兑损益等）。',
    chapterPath: '4',
    sourceLink: 'demo://chk_4',
  },
];

const materials = [
  {
    id: 'mat_1',
    title: 'CPA 会计基础 · 第一章至第四章',
    sourceType: 'user_file',
    source: 'demo://mat_1',
    capturedAt: now.toISOString(),
    contentHash: 'demo',
    approved: true,
  },
];

// ── 今日测验（会计题，单选）─────────────────────────────────────
const quiz = {
  id: `quiz_${today}`,
  date: today,
  questions: [
    {
      id: `q_${today}_0`,
      nodeId: 'node_1',
      type: 'single_choice',
      stem: '下列哪项属于会计基本假设之一？',
      options: ['持续经营', '持续亏损', '持续融资', '持续扩张'],
      answer: 0,
      explanation: '会计基本假设包括会计主体、持续经营、会计分期和货币计量。',
      sourceChunkId: 'chk_1',
    },
    {
      id: `q_${today}_1`,
      nodeId: 'node_2',
      type: 'single_choice',
      stem: '复式记账要求每笔业务在至少几个账户中作记录？',
      options: ['一个', '两个', '三个', '四个'],
      answer: 1,
      explanation: '复式记账在至少两个账户中作双重记录，借贷金额相等。',
      sourceChunkId: 'chk_2',
    },
    {
      id: `q_${today}_2`,
      nodeId: 'node_4',
      type: 'single_choice',
      stem: '下列哪项属于期间费用？',
      options: ['直接材料', '直接人工', '管理费用', '制造费用'],
      answer: 2,
      explanation: '期间费用包括管理费用、销售费用和财务费用，直接计入当期损益。',
      sourceChunkId: 'chk_4',
    },
  ],
};

// ── 计划与今日任务 ────────────────────────────────────────────────
const planDaily = {
  date: today,
  tasks: [
    { type: 'learn', nodeId: 'node_1', duration: 30 },
    { type: 'review', nodeId: 'node_2', duration: 15 },
    { type: 'learn', nodeId: 'node_3', duration: 25 },
    { type: 'quiz', nodeId: 'node_4', duration: 10 },
  ],
};

const planMaster = {
  id: 'plan_1',
  examDate,
  dailyMinutes: 60,
  schedule: [{ ...planDaily, isRest: false }],
  version: 1,
};

// ── 考试项目 ──────────────────────────────────────────────────────
const exam = {
  id: 'exam_demo',
  name: '2026 年初级会计资格考试',
  examDate,
  status: 'planned',
  learnerProfile: {
    baseline: 'beginner',
    dailyMinutes: 60,
    unavailableDates: [],
  },
};

// ── 备份现有 workspace（若有数据），避免覆盖真实数据 ─────────────
function backupExistingWorkspace() {
  if (!fs.existsSync(WS)) return;
  let hasData = false;
  try {
    hasData = fs.readdirSync(WS).length > 0;
  } catch {
    return;
  }
  if (!hasData) return;
  const bak = path.join(__dirname, '..', 'workspace_pre_demo.bak');
  fs.rmSync(bak, { recursive: true, force: true });
  fs.renameSync(WS, bak);
  console.log('📦 原 workspace 已备份到 workspace_pre_demo.bak（可移回恢复）');
}
backupExistingWorkspace();
fs.mkdirSync(WS, { recursive: true });

write('exam.json', exam);
write('graph/concepts.json', { concepts, learningOrder: ['node_1', 'node_2', 'node_3', 'node_4'] });
write('chunks/index.json', chunks);
write('materials/index.json', materials);
write('plan/plan_master.json', planMaster);
write('plan/plan_daily/' + today + '.json', planDaily);
write('quizzes/' + today + '_quiz.json', quiz);
write('buddy/state.json', {
  characterId: 'lu_xingye',
  relationshipLevel: 0,
  preferences: { reminderIntensity: 'normal', emotionalStyle: 'warm', companionMode: 'companion' },
  memories: [],
  commitments: [],
  streakDays: 0,
  lastActiveDate: '',
});

console.log(`✅ Demo 数据已生成到 workspace/（日期 ${today}，考试 ${examDate}）`);
console.log(`   $ npm run serve   # 启动后端 3456（含 Web 前端）`);
console.log(`   $ npm run web     # 或单独启动前端 5173`);
console.log(`   （运行 demo 前若有原数据，已备份到 workspace_pre_demo.bak）`);
