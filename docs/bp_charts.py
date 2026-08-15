"""StudyMate 商业计划书 - 图表生成脚本
生成 4 张 PNG 用于嵌入 ReportLab PDF:
  1. bp_arch.png        - 系统架构图
  2. bp_compete.png     - 竞品差异化矩阵
  3. bp_roadmap.png     - 12 个月路线图甘特
  4. bp_finance.png     - 12 个月财务预测柱状+折线

调色板:教育科技冷蓝灰 + 橙色强调(来自 palette.cascade)
"""
import os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
import numpy as np

# ━━ Cascade Palette ━━
PAGE_BG      = "#f5f6f6"
SECTION_BG   = "#edeeef"
CARD_BG      = "#e5e8ea"
TABLE_STRIPE = "#f2f3f4"
HEADER_FILL  = "#3e5560"
COVER_BLOCK  = "#4f6672"
BORDER       = "#a6bec9"
ICON         = "#416f85"
ACCENT       = "#c95a35"
ACCENT_2     = "#5fbd46"
TEXT_PRIMARY = "#1b1d1e"
TEXT_MUTED   = "#7b8285"
SEM_SUCCESS  = "#469f63"
SEM_ERROR    = "#a9524a"
SEM_INFO     = "#476b8f"

# 中文字体
plt.rcParams["font.sans-serif"] = ["Microsoft YaHei", "SimHei", "SimSun"]
plt.rcParams["axes.unicode_minus"] = False
plt.rcParams["savefig.facecolor"] = "white"
plt.rcParams["savefig.edgecolor"] = "none"

OUT_DIR = os.path.dirname(os.path.abspath(__file__))


def rounded_box(ax, x, y, w, h, facecolor, text, text_color="white",
                fontsize=10, fontweight="bold", edgecolor="none"):
    """绘制圆角矩形节点"""
    box = FancyBboxPatch(
        (x, y), w, h,
        boxstyle="round,pad=0.02,rounding_size=0.08",
        facecolor=facecolor, edgecolor=edgecolor, linewidth=0,
        zorder=3,
    )
    ax.add_patch(box)
    ax.text(x + w / 2, y + h / 2, text,
            ha="center", va="center",
            fontsize=fontsize, fontweight=fontweight,
            color=text_color, zorder=4, wrap=True)
    return (x + w / 2, y + h / 2, w, h)


def arrow(ax, p1, p2, color=BORDER, style="->", lw=1.2):
    """绘制连接箭头"""
    a = FancyArrowPatch(
        p1, p2,
        arrowstyle=style, mutation_scale=12,
        color=color, lw=lw, zorder=2,
        connectionstyle="arc3,rad=0",
    )
    ax.add_patch(a)


# ─────────────────────────────────────────────────────────────────────
# 图 1: 系统架构图
# ─────────────────────────────────────────────────────────────────────
def gen_architecture():
    fig, ax = plt.subplots(figsize=(11, 6.5), dpi=200)
    ax.set_xlim(0, 14)
    ax.set_ylim(0, 9)
    ax.axis("off")
    fig.patch.set_facecolor("white")

    # 标题
    ax.text(7, 8.5, "StudyMate Agent 系统架构",
            ha="center", fontsize=15, fontweight="bold", color=TEXT_PRIMARY)

    # 分层标签(左侧)
    for y, label in [(6.7, "用户层"), (4.7, "应用层"), (2.5, "数据层")]:
        ax.text(0.3, y, label, fontsize=9, color=TEXT_MUTED,
                fontweight="bold", rotation=90, va="center")

    # 第 1 层:用户层
    rounded_box(ax, 3.0, 6.4, 3.2, 0.9, COVER_BLOCK,
                "Web UI (React 18 + Vite)", fontsize=10)
    rounded_box(ax, 7.4, 6.4, 3.2, 0.9, COVER_BLOCK,
                "CLI / REST API", fontsize=10)

    # 第 2 层:应用层(核心 Agent)
    agent_specs = [
        (0.8, 4.4, 2.4, 0.9, ICON, "文档采集\n材料导入"),
        (3.5, 4.4, 2.4, 0.9, ICON, "知识图谱\n概念拓扑"),
        (6.2, 4.4, 2.4, 0.9, ICON, "测验生成\n自动评分"),
        (8.9, 4.4, 2.4, 0.9, ICON, "错题分析\n掌握度追踪"),
        (11.6, 4.4, 2.0, 0.9, ICON, "学习搭子\n人设陪伴"),
    ]
    for spec in agent_specs:
        rounded_box(ax, *spec)

    # 第 3 层:数据层
    rounded_box(ax, 0.8, 2.2, 2.8, 0.9, HEADER_FILL,
                "Markdown / Chunks", fontsize=9)
    rounded_box(ax, 4.0, 2.2, 2.8, 0.9, HEADER_FILL,
                "concepts.json\n知识图谱", fontsize=9)
    rounded_box(ax, 7.2, 2.2, 2.8, 0.9, HEADER_FILL,
                "plan_master\n学习计划", fontsize=9)
    rounded_box(ax, 10.4, 2.2, 3.0, 0.9, HEADER_FILL,
                "events.jsonl\n事件溯源日志", fontsize=9)

    # 跨层连线:用户层 → 应用层
    arrow(ax, (4.6, 6.4), (4.7, 5.3), color=BORDER)
    arrow(ax, (9.0, 6.4), (7.4, 5.3), color=BORDER)

    # 应用层内部水平流转(核心闭环)
    flow_pairs = [(2.0, 5.4), (4.7, 6.2), (7.4, 8.9), (10.1, 11.6)]
    for x1, x2 in flow_pairs:
        arrow(ax, (x1, 4.85), (x2 - 0.15, 4.85), color=ACCENT, lw=1.6)

    # 应用层 → 数据层(纵向)
    for x in [2.0, 4.7, 7.4, 10.1]:
        arrow(ax, (x, 4.4), (x, 3.1), color=BORDER, style="<->")

    # 外部 LLM 模块(右下角)
    rounded_box(ax, 11.4, 0.3, 2.2, 0.8, ACCENT,
                "LLM API\n(GPT-4o-mini)", fontsize=9)
    arrow(ax, (12.5, 2.2), (12.5, 1.1), color=ACCENT, style="<->", lw=1.6)
    ax.text(13.0, 1.6, "结构化\nJSON 决策", fontsize=7.5,
            color=ACCENT, ha="left", va="center", fontweight="bold")

    # 闭环标注(左下)
    ax.text(2.0, 1.2, "学习闭环: 导入 → 知识图谱 → 计划 → 测验 → 错题 → 自适应调整",
            fontsize=9, color=ACCENT, fontweight="bold", ha="left",
            bbox=dict(boxstyle="round,pad=0.4", facecolor=SECTION_BG,
                      edgecolor=ACCENT, linewidth=0.8))

    out = os.path.join(OUT_DIR, "bp_arch.png")
    plt.savefig(out, bbox_inches="tight", dpi=200, facecolor="white")
    plt.close()
    print(f"  ✓ {out}")


# ─────────────────────────────────────────────────────────────────────
# 图 2: 竞品差异化矩阵
# ─────────────────────────────────────────────────────────────────────
def gen_compete():
    fig, ax = plt.subplots(figsize=(11, 6), dpi=200)
    fig.patch.set_facecolor("white")

    # 维度:横轴=学习闭环完整度,纵轴=个性化/反馈深度
    products = [
        ("StudyMate Agent", 9.0, 9.0, ACCENT, 280),
        ("SuperMIA StudyMate", 7.5, 6.5, SEM_INFO, 180),
        ("Anki", 6.0, 7.5, SEM_INFO, 150),
        ("Quizlet", 4.5, 4.0, SEM_INFO, 150),
        ("Duolingo", 8.0, 6.0, SEM_INFO, 150),
        ("StudyMate-AI (开源)", 5.5, 5.0, TEXT_MUTED, 130),
        ("Multi-Agent (开源)", 5.0, 4.5, TEXT_MUTED, 110),
    ]
    for name, x, y, color, size in products:
        is_self = "StudyMate" == name.split()[0] and "Agent" in name
        ax.scatter(x, y, s=size, c=color, alpha=0.85, edgecolors="white",
                   linewidth=1.5, zorder=3)
        offset_x = 0.15 if name != "StudyMate Agent" else 0.15
        offset_y = 0.25 if name != "StudyMate Agent" else 0.35
        ax.annotate(name, (x, y),
                    xytext=(x + offset_x, y + offset_y),
                    fontsize=10 if is_self else 9,
                    fontweight="bold" if is_self else "normal",
                    color=ACCENT if is_self else TEXT_PRIMARY,
                    zorder=4)

    # 象限分隔
    ax.axvline(5, color=BORDER, linestyle="--", lw=0.8, alpha=0.6)
    ax.axhline(5, color=BORDER, linestyle="--", lw=0.8, alpha=0.6)

    # 象限标签
    ax.text(2.5, 9.3, "深度个性化\n但闭环不完整", ha="center", va="top",
            fontsize=8.5, color=TEXT_MUTED, style="italic")
    ax.text(7.5, 9.3, "完整闭环 + 深度个性化\n(目标象限)", ha="center", va="top",
            fontsize=8.5, color=SEM_SUCCESS, fontweight="bold", style="italic")
    ax.text(2.5, 1.0, "基础工具", ha="center", va="bottom",
            fontsize=8.5, color=TEXT_MUTED, style="italic")
    ax.text(7.5, 1.0, "闭环完整但个性化弱", ha="center", va="bottom",
            fontsize=8.5, color=TEXT_MUTED, style="italic")

    ax.set_xlim(0, 10)
    ax.set_ylim(0, 10)
    ax.set_xlabel("学习闭环完整度（导入→测验→错题→复习→自适应）",
                  fontsize=11, color=TEXT_PRIMARY, fontweight="bold")
    ax.set_ylabel("个性化反馈与知识追踪深度",
                  fontsize=11, color=TEXT_PRIMARY, fontweight="bold")
    ax.set_title("竞品差异化定位矩阵", fontsize=14, fontweight="bold",
                 color=TEXT_PRIMARY, pad=15)

    ax.set_xticks([0, 2.5, 5, 7.5, 10])
    ax.set_xticklabels(["", "弱", "中", "强", "完整"], fontsize=9)
    ax.set_yticks([0, 2.5, 5, 7.5, 10])
    ax.set_yticklabels(["", "弱", "中", "强", "深度"], fontsize=9)
    ax.tick_params(colors=TEXT_MUTED)

    for spine in ["top", "right"]:
        ax.spines[spine].set_visible(False)
    for spine in ["bottom", "left"]:
        ax.spines[spine].set_color(BORDER)

    ax.grid(True, linestyle="--", alpha=0.25, color=BORDER)
    ax.set_axisbelow(True)

    out = os.path.join(OUT_DIR, "bp_compete.png")
    plt.savefig(out, bbox_inches="tight", dpi=200, facecolor="white")
    plt.close()
    print(f"  ✓ {out}")


# ─────────────────────────────────────────────────────────────────────
# 图 3: 12 个月路线图甘特
# ─────────────────────────────────────────────────────────────────────
def gen_roadmap():
    fig, ax = plt.subplots(figsize=(11, 5.5), dpi=200)
    fig.patch.set_facecolor("white")

    tasks = [
        ("核心闭环功能完善", 0, 3, ICON, "产品"),
        ("样例数据与 Demo 录制", 1, 3, ICON, "产品"),
        ("内测上线 + 用户反馈收集", 3, 4, SEM_INFO, "产品"),
        ("付费版上线 + 商业化试点", 5, 5, SEM_SUCCESS, "商业"),
        ("知识图谱增强 + 错题推荐优化", 4, 4, ACCENT, "产品"),
        ("移动端 H5 + 多账号体系", 6, 4, ACCENT, "产品"),
        ("机构 B 端合作拓展", 7, 5, SEM_SUCCESS, "商业"),
        ("SEO / KOL / 社群营销", 4, 8, ACCENT_2, "增长"),
        ("收支平衡评估 + 融资", 9, 3, ACCENT, "商业"),
    ]

    phase_colors = {"产品": ICON, "商业": SEM_SUCCESS, "增长": ACCENT_2}

    for i, (name, start, dur, color, phase) in enumerate(tasks):
        y = len(tasks) - i - 1
        ax.barh(y, dur, left=start, height=0.55,
                color=color, alpha=0.85, edgecolor="white", linewidth=1.5)
        ax.text(start + dur / 2, y, name, ha="center", va="center",
                fontsize=9, color="white", fontweight="bold")

    # 月份分隔
    for m in range(1, 13):
        ax.axvline(m, color=BORDER, linestyle="--", alpha=0.4, lw=0.6)

    # 关键里程碑
    milestones = [
        (3, "M3: MVP 发布"),
        (6, "M6: 付费版"),
        (12, "M12: 收支平衡"),
    ]
    for x, label in milestones:
        ax.axvline(x, color=ACCENT, linestyle="-", lw=1.2, alpha=0.8)
        ax.text(x, len(tasks) + 0.2, label, ha="center",
                fontsize=8.5, color=ACCENT, fontweight="bold")

    ax.set_xlim(0, 13)
    ax.set_ylim(-0.7, len(tasks) + 0.8)
    ax.set_xticks(range(0, 13))
    ax.set_xticklabels([f"M{i}" if i > 0 else "" for i in range(13)],
                       fontsize=9, color=TEXT_MUTED)
    ax.set_yticks([])
    ax.set_xlabel("项目启动后的月份", fontsize=10, color=TEXT_PRIMARY)
    ax.set_title("StudyMate Agent 12 个月产品路线图", fontsize=13,
                 fontweight="bold", color=TEXT_PRIMARY, pad=15)

    # 图例
    legend_handles = [mpatches.Patch(color=c, label=p, alpha=0.85)
                      for p, c in phase_colors.items()]
    ax.legend(handles=legend_handles, loc="lower right",
              frameon=False, fontsize=9, ncol=3)

    for spine in ["top", "right", "left"]:
        ax.spines[spine].set_visible(False)
    ax.spines["bottom"].set_color(BORDER)

    out = os.path.join(OUT_DIR, "bp_roadmap.png")
    plt.savefig(out, bbox_inches="tight", dpi=200, facecolor="white")
    plt.close()
    print(f"  ✓ {out}")


# ─────────────────────────────────────────────────────────────────────
# 图 4: 12 个月财务预测
# ─────────────────────────────────────────────────────────────────────
def gen_finance():
    fig, ax1 = plt.subplots(figsize=(11, 5.5), dpi=200)
    fig.patch.set_facecolor("white")

    months = list(range(1, 13))
    # 重做的合理财务模型(M1-3 研发期收入0,M4 起内测,M7 起商业化)
    revenue = [0, 0, 0, 0.8, 2.0, 4.5, 9.0, 15.0, 24.0, 36.0, 52.0, 70.0]      # 万元
    cost_api = [0.5, 0.8, 1.2, 1.5, 2.0, 3.0, 4.5, 6.5, 9.0, 12.0, 16.0, 21.0]
    cost_hr = [6, 6, 6, 6, 8, 8, 10, 12, 14, 16, 18, 20]
    cost_other = [1, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 9]
    total_cost = [a + b + c for a, b, c in zip(cost_api, cost_hr, cost_other)]
    net = [r - c for r, c in zip(revenue, total_cost)]

    x = np.arange(len(months))
    width = 0.26

    bars1 = ax1.bar(x - width, revenue, width, label="月收入",
                    color=SEM_SUCCESS, alpha=0.88, edgecolor="white", lw=0.5)
    bars2 = ax1.bar(x, total_cost, width, label="月总成本",
                    color=SEM_ERROR, alpha=0.88, edgecolor="white", lw=0.5)

    ax1.set_xlabel("运营月份", fontsize=10, color=TEXT_PRIMARY)
    ax1.set_ylabel("金额（万元）", fontsize=10, color=TEXT_PRIMARY)
    ax1.set_xticks(x)
    ax1.set_xticklabels([f"M{m}" for m in months], fontsize=9, color=TEXT_MUTED)
    ax1.tick_params(axis="y", colors=TEXT_MUTED, labelsize=9)
    ax1.set_ylim(-15, 80)

    for spine in ["top", "right"]:
        ax1.spines[spine].set_visible(False)
    for spine in ["bottom", "left"]:
        ax1.spines[spine].set_color(BORDER)
    ax1.grid(True, axis="y", linestyle="--", alpha=0.3, color=BORDER)
    ax1.set_axisbelow(True)

    # 净利润折线(右轴)
    ax2 = ax1.twinx()
    line = ax2.plot(x, net, color=ACCENT, lw=2.2, marker="o",
                    markersize=6, label="净利润", zorder=5)
    ax2.set_ylabel("净利润（万元）", fontsize=10, color=ACCENT)
    ax2.tick_params(axis="y", colors=ACCENT, labelsize=9)
    ax2.axhline(0, color=ACCENT, linestyle=":", lw=0.8, alpha=0.5)
    ax2.set_ylim(-25, 40)
    for spine in ["top"]:
        ax2.spines[spine].set_visible(False)
    ax2.spines["right"].set_color(ACCENT)

    # 盈亏平衡标注
    breakeven_m = next((i for i, n in enumerate(net) if n >= 0), None)
    if breakeven_m is not None:
        ax1.annotate(f"M{breakeven_m + 1}\n盈亏平衡",
                     xy=(breakeven_m, 0), xytext=(breakeven_m + 1.5, -12),
                     fontsize=9, color=ACCENT, fontweight="bold", ha="center",
                     arrowprops=dict(arrowstyle="->", color=ACCENT, lw=1))

    ax1.set_title("12 个月财务预测（收入、成本与净利润）", fontsize=13,
                  fontweight="bold", color=TEXT_PRIMARY, pad=15)

    # 合并图例
    lines1, labels1 = ax1.get_legend_handles_labels()
    lines2, labels2 = ax2.get_legend_handles_labels()
    ax1.legend(lines1 + lines2, labels1 + labels2,
               loc="upper left", frameon=False, fontsize=9)

    plt.tight_layout()
    out = os.path.join(OUT_DIR, "bp_finance.png")
    plt.savefig(out, bbox_inches="tight", dpi=200, facecolor="white")
    plt.close()
    print(f"  ✓ {out}")


if __name__ == "__main__":
    print("生成 StudyMate 商业计划书图表:")
    gen_architecture()
    gen_compete()
    gen_roadmap()
    gen_finance()
    print("全部完成。")
