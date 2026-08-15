"""StudyMate Agent 商业计划书生成器
为 2026 香港科技大学百万奖金创业大赛(初创组 + 人工智能赛道)准备

输出: business_plan_studymate.pdf (竖版 A4, 约 15 页)

技术栈: ReportLab 4.5 + 中文字体 + matplotlib 图表
"""
import os
import sys
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm, cm, inch
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle,
    KeepTogether, Image, HRFlowable, Flowable, CondPageBreak,
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import registerFontFamily
from reportlab.pdfgen import canvas

# ─────────────────────────────────────────────────────────────────────
# 调色板(来自 palette.cascade)
# ─────────────────────────────────────────────────────────────────────
PAGE_BG      = colors.HexColor("#ffffff")  # 正文用纯白,避免灰底
SECTION_BG   = colors.HexColor("#edeeef")
CARD_BG      = colors.HexColor("#e5e8ea")
TABLE_STRIPE = colors.HexColor("#f2f3f4")
HEADER_FILL  = colors.HexColor("#3e5560")  # 深蓝灰,表格表头
COVER_BLOCK  = colors.HexColor("#4f6672")
BORDER       = colors.HexColor("#a6bec9")
ICON         = colors.HexColor("#416f85")
ACCENT       = colors.HexColor("#c95a35")  # 橙色强调
ACCENT_2     = colors.HexColor("#5fbd46")
TEXT_PRIMARY = colors.HexColor("#1b1d1e")
TEXT_MUTED   = colors.HexColor("#7b8285")
SEM_SUCCESS  = colors.HexColor("#469f63")
SEM_ERROR    = colors.HexColor("#a9524a")
SEM_INFO     = colors.HexColor("#476b8f")

# ─────────────────────────────────────────────────────────────────────
# 字体注册 (Windows 字体路径)
# ─────────────────────────────────────────────────────────────────────
FONT_DIR = r"C:\Windows\Fonts"
pdfmetrics.registerFont(TTFont("SimHei", os.path.join(FONT_DIR, "simhei.ttf")))
pdfmetrics.registerFont(TTFont("MSYH", os.path.join(FONT_DIR, "msyh.ttc")))
pdfmetrics.registerFont(TTFont("MSYH-Bold", os.path.join(FONT_DIR, "msyhbd.ttc")))
pdfmetrics.registerFont(TTFont("Deng", os.path.join(FONT_DIR, "Deng.ttf")))

registerFontFamily("SimHei", normal="SimHei", bold="SimHei")
registerFontFamily("MSYH", normal="MSYH", bold="MSYH-Bold")

# 默认使用雅黑(更现代,适合商业文档)
CN_FONT = "MSYH"
CN_FONT_BOLD = "MSYH-Bold"
CN_FONT_SERIF = "SimHei"  # 黑体作为衬线替代,用于标题强调

# ─────────────────────────────────────────────────────────────────────
# 页面参数
# ─────────────────────────────────────────────────────────────────────
PAGE_W, PAGE_H = A4
MARGIN_L = 22 * mm
MARGIN_R = 22 * mm
MARGIN_T = 22 * mm
MARGIN_B = 22 * mm
AVAIL_W = PAGE_W - MARGIN_L - MARGIN_R  # ≈ 451pt
AVAIL_H = PAGE_H - MARGIN_T - MARGIN_B

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_PDF = os.path.join(OUT_DIR, "business_plan_studymate.pdf")

# ─────────────────────────────────────────────────────────────────────
# 样式定义
# ─────────────────────────────────────────────────────────────────────
S_H1 = ParagraphStyle(
    "H1", fontName=CN_FONT_BOLD, fontSize=20, leading=28,
    textColor=HEADER_FILL, alignment=TA_LEFT,
    spaceBefore=18, spaceAfter=10, wordWrap="CJK",
)
S_H2 = ParagraphStyle(
    "H2", fontName=CN_FONT_BOLD, fontSize=14, leading=20,
    textColor=TEXT_PRIMARY, alignment=TA_LEFT,
    spaceBefore=14, spaceAfter=6, wordWrap="CJK",
)
S_H3 = ParagraphStyle(
    "H3", fontName=CN_FONT_BOLD, fontSize=11.5, leading=16,
    textColor=ACCENT, alignment=TA_LEFT,
    spaceBefore=8, spaceAfter=4, wordWrap="CJK",
)
S_BODY = ParagraphStyle(
    "Body", fontName=CN_FONT, fontSize=10.5, leading=17,
    textColor=TEXT_PRIMARY, alignment=TA_LEFT,
    spaceBefore=0, spaceAfter=7, wordWrap="CJK",
    firstLineIndent=21,  # 2字符缩进
)
S_BODY_NOINDENT = ParagraphStyle(
    "BodyNI", parent=S_BODY, firstLineIndent=0,
)
S_BULLET = ParagraphStyle(
    "Bullet", fontName=CN_FONT, fontSize=10.5, leading=16,
    textColor=TEXT_PRIMARY, alignment=TA_LEFT,
    leftIndent=18, firstLineIndent=0, bulletIndent=4,
    spaceBefore=1, spaceAfter=3, wordWrap="CJK",
)
S_CAPTION = ParagraphStyle(
    "Caption", fontName=CN_FONT, fontSize=9, leading=12,
    textColor=TEXT_MUTED, alignment=TA_CENTER,
    spaceBefore=3, spaceAfter=12, wordWrap="CJK",
)
S_CALLOUT_BIG = ParagraphStyle(
    "CalloutBig", fontName=CN_FONT_BOLD, fontSize=22, leading=26,
    textColor=ACCENT, alignment=TA_CENTER, wordWrap="CJK",
)
S_CALLOUT_LABEL = ParagraphStyle(
    "CalloutLabel", fontName=CN_FONT, fontSize=9, leading=12,
    textColor=TEXT_MUTED, alignment=TA_CENTER, wordWrap="CJK",
)
S_TABLE_HEADER = ParagraphStyle(
    "TH", fontName=CN_FONT_BOLD, fontSize=10, leading=13,
    textColor=colors.white, alignment=TA_CENTER, wordWrap="CJK",
)
S_TABLE_CELL = ParagraphStyle(
    "TC", fontName=CN_FONT, fontSize=9.5, leading=13,
    textColor=TEXT_PRIMARY, alignment=TA_LEFT, wordWrap="CJK",
)
S_TABLE_CELL_CENTER = ParagraphStyle(
    "TCC", parent=S_TABLE_CELL, alignment=TA_CENTER,
)

# ─────────────────────────────────────────────────────────────────────
# 辅助组件
# ─────────────────────────────────────────────────────────────────────
def h1(text):
    """H1 标题 + 下方装饰横线"""
    return [
        CondPageBreak(AVAIL_H * 0.18),  # 防止标题孤行
        Paragraph(text, S_H1),
        HRFlowable(width="100%", thickness=1.5, color=ACCENT,
                   spaceBefore=0, spaceAfter=12),
    ]

def h2(text):
    return [CondPageBreak(AVAIL_H * 0.12), Paragraph(text, S_H2)]

def h3(text):
    return [Paragraph(text, S_H3)]

def p(text):
    return Paragraph(text, S_BODY)

def pni(text):  # 无缩进段落
    return Paragraph(text, S_BODY_NOINDENT)

def bullet(text):
    return Paragraph(f"• {text}", S_BULLET)

def caption(text):
    return Paragraph(text, S_CAPTION)

def callout_box(big, label, width=140):
    """数据 callout 卡片"""
    data = [
        [Paragraph(big, S_CALLOUT_BIG)],
        [Paragraph(label, S_CALLOUT_LABEL)],
    ]
    t = Table(data, colWidths=[width], hAlign="CENTER")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), SECTION_BG),
        ("LINEBELOW", (0, 0), (-1, 0), 0, colors.transparent),
        ("BOX", (0, 0), (-1, -1), 0.8, ACCENT),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))
    return t

def metrics_row(metrics):
    """一行 3-6 个 callout 卡片
    metrics: [(big1, label1), (big2, label2), ...]
    使用单元格内嵌套结构,确保完全对齐
    """
    n = len(metrics)
    gap = 6
    card_w = (AVAIL_W - gap * (n - 1)) / n

    # 每个 callout 用一个独立的 Table,宽度严格统一
    def make_card(big, label):
        data = [
            [Paragraph(big, S_CALLOUT_BIG)],
            [Paragraph(label, S_CALLOUT_LABEL)],
        ]
        t = Table(data, colWidths=[card_w])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), SECTION_BG),
            ("BOX", (0, 0), (-1, -1), 0.8, ACCENT),
            ("TOPPADDING", (0, 0), (-1, 0), 10),
            ("BOTTOMPADDING", (0, 0), (-1, 0), 2),
            ("TOPPADDING", (0, 1), (-1, 1), 2),
            ("BOTTOMPADDING", (0, 1), (-1, 1), 10),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]))
        return t

    # 用一个外层 Table,列宽严格 = card_w + gap,确保对齐
    row_data = []
    col_widths = []
    for i, (big, label) in enumerate(metrics):
        row_data.append(make_card(big, label))
        col_widths.append(card_w)
        if i < n - 1:
            row_data.append("")  # 间隔列
            col_widths.append(gap)
    outer = Table([row_data], colWidths=col_widths, hAlign="CENTER")
    outer.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return outer

def std_table(data_rows, col_ratios, caption_text=None, header_align="CENTER"):
    """标准表格构建器
    data_rows: 第一行是表头
    col_ratios: 列宽比例
    """
    col_widths = [r * AVAIL_W for r in col_ratios]
    # 转 Paragraph
    body = []
    for ri, row in enumerate(data_rows):
        prow = []
        for ci, cell in enumerate(row):
            if ri == 0:
                prow.append(Paragraph(cell, S_TABLE_HEADER))
            else:
                prow.append(Paragraph(cell, S_TABLE_CELL))
        body.append(prow)
    t = Table(body, colWidths=col_widths, hAlign="CENTER", repeatRows=1)
    style_cmds = [
        ("BACKGROUND", (0, 0), (-1, 0), HEADER_FILL),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("GRID", (0, 0), (-1, -1), 0.4, BORDER),
        ("LINEBELOW", (0, 0), (-1, 0), 1.2, HEADER_FILL),
    ]
    # 隔行换色
    for i in range(1, len(body)):
        if i % 2 == 0:
            style_cmds.append(("BACKGROUND", (0, i), (-1, i), TABLE_STRIPE))
    t.setStyle(TableStyle(style_cmds))
    out = [Spacer(1, 6), t]
    if caption_text:
        out.append(Spacer(1, 4))
        out.append(caption(caption_text))
    else:
        out.append(Spacer(1, 12))
    return out

def embed_image(path, max_width=None, max_height=None):
    """按比例嵌入图片"""
    from PIL import Image as PILImage
    if max_width is None:
        max_width = AVAIL_W
    if max_height is None:
        max_height = AVAIL_H * 0.42
    pil = PILImage.open(path)
    ow, oh = pil.size
    rw = max_width / ow if ow > max_width else 1.0
    rh = max_height / oh if oh > max_height else 1.0
    r = min(rw, rh)
    return Image(path, width=ow * r, height=oh * r)


# ─────────────────────────────────────────────────────────────────────
# 封面绘制(直接在 canvas 上画)
# ─────────────────────────────────────────────────────────────────────
def draw_cover(c, doc):
    """封面:Template 02 Corporate Editorial 风格
    顶部色条 + 底部强调线 + 居中标题
    """
    W, H = A4

    # Layer 0: 背景(纯白)
    c.setFillColor(colors.white)
    c.rect(0, 0, W, H, stroke=0, fill=1)

    # Layer 1: 顶部深色色条
    bar_h = 14 * mm
    c.setFillColor(HEADER_FILL)
    c.rect(0, H - bar_h, W, bar_h, stroke=0, fill=1)

    # 顶部色条内的左侧标签
    c.setFillColor(colors.white)
    c.setFont(CN_FONT, 9)
    c.drawString(22 * mm, H - bar_h + 5 * mm,
                 "2026 香港科技大学百万奖金创业大赛 · 上海赛区")
    c.setFont(CN_FONT, 9)
    c.drawRightString(W - 22 * mm, H - bar_h + 5 * mm,
                      "初创组 · 人工智能赛道")

    # Layer 2: 几何装饰(右侧细竖线 + 左下角短线)
    c.setStrokeColor(ACCENT)
    c.setLineWidth(2.5)
    # 左侧细竖线(从标题区到底部)
    c.line(22 * mm, 50 * mm, 22 * mm, H - 60 * mm)
    # 右下角短强调线
    c.setStrokeColor(ACCENT)
    c.setLineWidth(3)
    c.line(W - 60 * mm, 35 * mm, W - 22 * mm, 35 * mm)

    # Layer 3: 内容文字

    # Kicker(顶部小字)
    c.setFillColor(TEXT_MUTED)
    c.setFont(CN_FONT, 10)
    c.drawString(30 * mm, H - 50 * mm, "BUSINESS PLAN")
    c.setFont(CN_FONT, 9)
    c.drawString(30 * mm, H - 56 * mm, "商业计划书 · 2026 年 8 月")

    # Hero 主标题(项目名,最大最重)
    c.setFillColor(TEXT_PRIMARY)
    c.setFont(CN_FONT_BOLD, 38)
    c.drawString(30 * mm, H - 85 * mm, "StudyMate Agent")
    c.setFont(CN_FONT_BOLD, 26)
    c.setFillColor(HEADER_FILL)
    c.drawString(30 * mm, H - 100 * mm, "AI 备考学习搭子")

    # 副标题 / 一句话定位
    c.setFillColor(TEXT_MUTED)
    c.setFont(CN_FONT, 13)
    c.drawString(30 * mm, H - 118 * mm,
                 "基于大模型与间隔重复算法的个性化备考学习闭环")

    # Summary 块(中段描述)
    c.setFillColor(TEXT_PRIMARY)
    c.setFont(CN_FONT, 11)
    summary_lines = [
        "StudyMate Agent 将教材导入、知识图谱构建、间隔重复计划、",
        "自动测验、错题分析与学习路径自适应调整整合为完整闭环,",
        "并叠加拟人化「学习搭子」人设陪伴,提升用户备考坚持率。",
    ]
    y = H - 145 * mm
    for line in summary_lines:
        c.drawString(30 * mm, y, line)
        y -= 18

    # 三大核心标签
    tags = ["学习闭环", "知识图谱", "AI 学习搭子"]
    tag_y = H - 205 * mm
    tag_x = 30 * mm
    for tag in tags:
        tw = c.stringWidth(tag, CN_FONT_BOLD, 10) + 16
        c.setFillColor(SECTION_BG)
        c.roundRect(tag_x, tag_y - 3, tw, 20, 3, stroke=0, fill=1)
        c.setFillColor(ACCENT)
        c.setFont(CN_FONT_BOLD, 10)
        c.drawString(tag_x + 8, tag_y + 3, tag)
        tag_x += tw + 10

    # 底部信息块
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.5)
    c.line(22 * mm, 50 * mm, W - 22 * mm, 50 * mm)

    c.setFillColor(TEXT_MUTED)
    c.setFont(CN_FONT, 9)
    c.drawString(22 * mm, 40 * mm, "团队名称:[请填写团队名称]")
    c.drawString(22 * mm, 33 * mm, "队长:[请填写队长姓名]")
    c.drawString(22 * mm, 26 * mm, "提交日期:2026 年 8 月 11 日")

    c.setFont(CN_FONT, 9)
    c.drawRightString(W - 22 * mm, 40 * mm, "技术来源:团队自主研发")
    c.drawRightString(W - 22 * mm, 33 * mm, "组别:初创组")
    c.drawRightString(W - 22 * mm, 26 * mm, "赛道:人工智能")

    # 底部色块(底部强调)
    c.setFillColor(ACCENT)
    c.rect(0, 0, W, 6 * mm, stroke=0, fill=1)


# ─────────────────────────────────────────────────────────────────────
# 页眉页脚
# ─────────────────────────────────────────────────────────────────────
def on_page(c, doc):
    """正文页眉页脚(从第 2 页起)"""
    c.saveState()
    W, H = A4
    # 页眉
    c.setFont(CN_FONT, 8.5)
    c.setFillColor(TEXT_MUTED)
    c.drawString(MARGIN_L, H - 12 * mm, "StudyMate Agent · 商业计划书")
    c.drawRightString(W - MARGIN_R, H - 12 * mm,
                      "2026 港科大百万奖金创业大赛")
    # 页眉横线
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.4)
    c.line(MARGIN_L, H - 14 * mm, W - MARGIN_R, H - 14 * mm)
    # 页脚
    c.setFont(CN_FONT, 8.5)
    c.setFillColor(TEXT_MUTED)
    c.drawCentredString(W / 2, 12 * mm, f"— {doc.page} —")
    c.restoreState()


# ─────────────────────────────────────────────────────────────────────
# 内容构建
# ─────────────────────────────────────────────────────────────────────
def build_story():
    story = []

    # ════════════════════════════════════════════════════════════════
    # 封面占位(实际封面由 onFirstPage 绘制,这里只占一页)
    # ════════════════════════════════════════════════════════════════
    # 用一个不可见的极小 Flowable + PageBreak,封面内容由 onFirstPage 绘制
    story.append(Spacer(1, 1))
    story.append(PageBreak())

    # ════════════════════════════════════════════════════════════════
    # 第 2 页:目录 + 公司概况
    # ════════════════════════════════════════════════════════════════
    story.extend(h1("目录"))
    toc_entries = [
        ("一、公司概况与项目简介", "3"),
        ("二、市场机遇与目标用户", "4"),
        ("三、产品与解决方案", "6"),
        ("四、技术架构与创新性", "8"),
        ("五、竞品分析", "10"),
        ("六、商业模式与定价", "11"),
        ("七、产品路线图", "12"),
        ("八、财务预测", "13"),
        ("九、团队介绍", "14"),
        ("十、风险与对策", "15"),
    ]
    toc_data = []
    for title, page in toc_entries:
        dots = "·" * 60
        toc_data.append([
            Paragraph(title, ParagraphStyle(
                "TOC", fontName=CN_FONT, fontSize=11, leading=18,
                textColor=TEXT_PRIMARY, wordWrap="CJK")),
            Paragraph(dots, ParagraphStyle(
                "TOCDots", fontName=CN_FONT, fontSize=7, leading=18,
                textColor=BORDER)),
            Paragraph(page, ParagraphStyle(
                "TOCPage", fontName=CN_FONT_BOLD, fontSize=11, leading=18,
                textColor=ACCENT, alignment=TA_RIGHT)),
        ])
    toc_t = Table(toc_data, colWidths=[AVAIL_W * 0.6, AVAIL_W * 0.3, AVAIL_W * 0.1],
                  hAlign="CENTER")
    toc_t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(toc_t)

    # 公司概况提前到目录下方一页
    story.append(PageBreak())
    story.extend(h1("一、公司概况与项目简介"))

    # 关键数据 callout
    story.append(metrics_row([
        ("6 大", "核心功能模块"),
        ("12-Factor", "Agent 架构理念"),
        ("100%", "团队自主研发"),
    ]))
    story.append(Spacer(1, 14))

    story.extend(h2("1.1 项目定位"))
    story.append(p(
        "StudyMate Agent 是一款面向考研、注册会计师(CPA)、雅思托福等高"
        "强度备考人群的 AI 个性化学习助手。我们以「让每一个学习者拥有一"
        "位专属 AI 备考搭子」为愿景,通过大语言模型(LLM)、知识图谱与"
        "间隔重复算法,将传统学习工具中割裂的「导入资料—制定计划—测验"
        "评估—错题复习—路径调整」五个环节整合为完整闭环,并叠加拟人化"
        "「学习搭子」人设陪伴,显著提升备考坚持率与知识掌握效率。"
    ))

    story.extend(h2("1.2 公司基本信息"))
    story.extend(std_table(
        [
            ["项目", "内容"],
            ["项目名称", "StudyMate Agent(智学伴)"],
            ["拟注册公司", "[请填写公司全称,如:上海智学伴科技有限公司]"],
            ["团队名称", "[请填写参赛团队名称]"],
            ["队长", "[请填写队长姓名]"],
            ["所属赛道", "人工智能(AI 教育应用)"],
            ["参赛组别", "初创组"],
            ["项目阶段", "MVP 已完成,具备完整可用学习闭环"],
        ],
        col_ratios=[0.25, 0.75],
    ))

    story.extend(h2("1.3 技术来源声明"))
    story.append(p(
        "本项目所有核心代码、产品架构、学习算法与产品交互设计均由团队"
        "成员完全自主研发,基于业界公开开源技术栈(TypeScript、React、"
        "OpenAI 兼容 LLM API 等)构建,不涉及任何第三方知识产权,不存在"
        "技术产权纠纷,符合大赛对原创性与知识产权的全部要求。"
    ))

    story.append(PageBreak())

    # ════════════════════════════════════════════════════════════════
    # 第 4-5 页:市场机遇
    # ════════════════════════════════════════════════════════════════
    story.extend(h1("二、市场机遇与目标用户"))

    story.extend(h2("2.1 学习者痛点"))
    story.append(p(
        "高强度备考人群(考研、CPA、雅思等)普遍面临三大核心痛点:"
    ))
    story.append(bullet(
        "<b>资料多、不知从何学起</b>:考生手握数百页 PDF 与多本教材,"
        "难以系统化梳理知识结构,常陷入「盲目刷题」式低效学习。"
    ))
    story.append(bullet(
        "<b>计划制定靠经验、坚持难</b>:间隔重复(Spaced Repetition)"
        "已被认知科学证明可显著提升记忆效率,但传统工具(如 Anki)要求"
        "用户自行制卡,门槛高、坚持率低。"
    ))
    story.append(bullet(
        "<b>错题复盘流于表面</b>:多数学习工具仅记录错题,缺乏基于掌握"
        "度的个性化路径调整,导致「错过的题再错」。"
    ))

    story.extend(h2("2.2 目标市场规模(TAM / SAM / SOM)"))
    story.append(metrics_row([
        ("343 万", "2026 考研报名(年)"),
        ("80 万", "2025 CPA 报名(年)"),
        ("8 万", "雅思年考生"),
        ("500 万+", "TAM 估算"),
    ]))
    story.append(Spacer(1, 12))

    story.extend(std_table(
        [
            ["考试类型", "年度报考规模", "智能学习工具渗透率假设", "潜在用户(SAM)"],
            ["全国硕士研究生招生考试", "约 343 万", "20%", "约 70 万"],
            ["注册会计师(CPA)", "约 80 万", "10%", "约 8 万"],
            ["雅思 / 托福", "约 30 万", "10%", "约 3 万"],
            ["司法 / 医师 / 教师资格等", "数百万人级", "5%", "数十万级"],
            ["TAM 合计", "—", "—", "500 万+"],
        ],
        col_ratios=[0.3, 0.22, 0.23, 0.25],
        caption_text="表 2-1 目标市场分层估算(数据来源:教育部、中注协、ETS 等公开数据)",
    ))

    story.extend(h2("2.3 可服务市场与初期切入(SOM)"))
    story.append(p(
        "初期 SOM 聚焦一线城市(上海、北京、深圳)的考研与 CPA 备考人群,"
        "保守估算首年可触达并转化为付费用户的规模约为 5,000–10,000 人。"
        "该群体付费意愿强(已为培训课程支付数千至数万元)、对 AI 工具接"
        "受度高、传播路径清晰(社群与 KOL),是验证商业模式的最佳切入点。"
    ))

    story.append(PageBreak())

    # ════════════════════════════════════════════════════════════════
    # 第 6-7 页:产品与解决方案
    # ════════════════════════════════════════════════════════════════
    story.extend(h1("三、产品与解决方案"))

    story.extend(h2("3.1 核心学习闭环"))
    story.append(p(
        "StudyMate Agent 的产品核心是一条由 6 个智能体(Agent)协作驱动"
        "的完整学习闭环,覆盖从资料导入到学习路径自适应调整的全流程:"
    ))
    story.append(metrics_row([
        ("导入", "材料采集"),
        ("图谱", "知识结构化"),
        ("计划", "间隔重复"),
        ("测验", "自动出题评分"),
        ("错题", "深度分析"),
        ("自适应", "路径调整"),
    ]))
    story.append(Spacer(1, 10))

    story.extend(h2("3.2 六大核心功能模块"))
    story.extend(std_table(
        [
            ["模块", "功能说明", "对应痛点"],
            ["① 文档采集 Agent", "支持 PDF / Markdown 教材导入,自动分块与向量化, "
             "构建可检索知识库。", "资料杂乱无章"],
            ["② 概念图谱 Agent", "LLM 提取核心概念并建立前置依赖关系,拓扑排序生成"
             "科学学习顺序。", "不知从何学起"],
            ["③ 学习计划 Agent", "基于考试日期与每日学习时长,生成符合间隔重复(SM-2)"
             "原则的逐日学习计划。", "计划制定靠经验"],
            ["④ 测验 Agent", "基于知识图谱自动生成多选题,LLM 评分并给出详细解析。"
             , "缺乏即时检验"],
            ["⑤ 错题分析 Agent", "汇总错题生成弱项画像(weakness_profile),计算 EMA "
             "掌握度。", "错题复盘流于表面"],
            ["⑥ 计划调整 Agent", "根据错题与掌握度自动调整后续学习计划,实现真正"
             "的个性化。", "学过的不再错"],
        ],
        col_ratios=[0.22, 0.55, 0.23],
        caption_text="表 3-1 六大功能模块与痛点对应关系",
    ))

    story.extend(h2("3.3 差异化亮点:AI 学习搭子"))
    story.append(p(
        "除功能闭环外,我们创新性地引入「拟人化学习搭子」机制:用户可选"
        "择不同性格的 AI 搭子(温柔学长、高冷学霸、元气少女、治愈吉祥物),"
        "搭子会基于用户的学习进度、测验成绩、连续学习天数,在关键节点"
        "(如完成测验、连续打卡、检测到弱项)给出符合人设的鼓励与建议,"
        "并维持持久记忆与好感度关系。这一设计直接对应「坚持难」痛点,"
        "显著提升用户情感粘性与长期留存。"
    ))

    story.append(PageBreak())

    # ════════════════════════════════════════════════════════════════
    # 第 8-9 页:技术架构
    # ════════════════════════════════════════════════════════════════
    story.extend(h1("四、技术架构与创新性"))

    story.extend(h2("4.1 系统架构总览"))
    story.append(p(
        "StudyMate Agent 采用「12-Factor Agents」工程理念:大语言模型"
        "负责产出结构化 JSON 决策,TypeScript 控制层负责状态管理与流程"
        "路由,所有状态以事件溯源(Event Sourcing)方式持久化到本地工作"
        "区,确保可追溯、可回放、可调试。"
    ))
    # 嵌入架构图
    arch_path = os.path.join(OUT_DIR, "bp_arch.png")
    if os.path.exists(arch_path):
        story.append(Spacer(1, 6))
        story.append(embed_image(arch_path, max_width=AVAIL_W, max_height=AVAIL_H * 0.42))
        story.append(caption("图 4-1 StudyMate Agent 系统架构(三层:用户层 / 应用层 / 数据层)"))

    story.extend(h2("4.2 关键技术创新点"))
    story.extend(std_table(
        [
            ["技术创新点", "实现方式", "技术价值"],
            ["12-Factor Agent 架构", "LLM 输出结构化 JSON,代码层路由,事件溯源日志。"
             , "可调试、可回放、低成本试错"],
            ["概念拓扑排序", "LLM 提取概念依赖关系,自动拓扑排序生成学习顺序。"
             , "学习顺序科学化,提升理解效率"],
            ["SM-2 + EMA 双算法", "SM-2 间隔重复 + EMA(指数移动平均)掌握度追踪。"
             , "兼顾记忆规律与实时状态评估"],
            ["错题驱动闭环", "错题自动触发计划调整 Agent,动态重排学习路径。"
             , "实现真正的个性化学习"],
            ["拟人化搭子系统", "持久化记忆、承诺追踪、连续打卡、好感度关系。"
             , "情感粘性,提升留存"],
        ],
        col_ratios=[0.25, 0.45, 0.30],
    ))

    story.extend(h2("4.3 技术成熟度"))
    story.append(p(
        "项目已实现完整可运行 MVP,具备以下工程化能力:"
    ))
    story.append(bullet("三端交付:命令行 CLI + Web UI(React 18 + Vite 5)+ REST API(Express 5)"))
    story.append(bullet("生产级部署:Docker 多阶段镜像 + docker-compose,支持一键启动"))
    story.append(bullet("质量保障:Vitest 单元测试 + E2E 测试 + GitHub Actions CI 流水线"))
    story.append(bullet("离线降级:无 API Key 时自动切换 Mock LLM,保证 Demo 可演示"))
    story.append(bullet("隐私合规:本地工作区隔离 + PRIVACY.md 隐私声明 + 用户数据不出本地"))

    story.append(PageBreak())

    # ════════════════════════════════════════════════════════════════
    # 第 10 页:竞品分析
    # ════════════════════════════════════════════════════════════════
    story.extend(h1("五、竞品分析"))

    story.extend(h2("5.1 竞品对比矩阵"))
    story.extend(std_table(
        [
            ["竞品", "核心定位", "学习闭环", "个性化深度", "差异化短板"],
            ["<b>StudyMate Agent(本项目)</b>", "AI 备考搭子闭环", "完整", "深度", "—"],
            ["Anki", "开源闪卡间隔重复", "仅复习", "手动制卡", "无内容生成、无闭环"],
            ["Quizlet", "商业闪卡学习", "仅练习", "浅层", "无学习路径规划"],
            ["Duolingo", "语言学习平台", "语言闭环", "自适应", "仅限语言学科"],
            ["SuperMIA StudyMate", "商业 AI 题库", "出题评分", "进度跟踪", "无错题闭环、无搭子"],
            ["开源 StudyMate-AI", "课件摘要+问答", "单向", "弱", "无复习规划、无商业化"],
        ],
        col_ratios=[0.22, 0.22, 0.15, 0.16, 0.25],
        caption_text="表 5-1 主要竞品功能对比",
    ))

    story.extend(h2("5.2 差异化定位"))
    compete_path = os.path.join(OUT_DIR, "bp_compete.png")
    if os.path.exists(compete_path):
        story.append(Spacer(1, 6))
        story.append(embed_image(compete_path, max_width=AVAIL_W, max_height=AVAIL_H * 0.42))
        story.append(caption("图 5-1 竞品差异化定位矩阵(横轴:闭环完整度;纵轴:个性化深度)"))

    story.append(p(
        "StudyMate Agent 在「学习闭环完整度」与「个性化反馈深度」两个维度"
        "同时领先:既有开源方案(StudyMate-AI、Multi-Agent)多停留在单向"
        "问答与摘要,缺乏复习闭环;商业产品(Quizlet、Anki)虽有成熟复习"
        "机制,但缺乏内容自动生成与路径自适应。我们的核心壁垒在于「闭环"
        "+ 深度个性化 + 情感陪伴」三位一体的产品形态。"
    ))

    story.append(PageBreak())

    # ════════════════════════════════════════════════════════════════
    # 第 11 页:商业模式
    # ════════════════════════════════════════════════════════════════
    story.extend(h1("六、商业模式与定价"))

    story.extend(h2("6.1 收入模式"))
    story.append(p(
        "采用「C 端订阅 + B 端授权」双轮驱动模式。C 端通过分层订阅服务"
        "个人学习者,B 端通过 API / 私有化部署服务培训机构与高校。"
    ))

    story.extend(std_table(
        [
            ["版本", "定价", "目标用户", "核心权益"],
            ["免费版", "￥0", "所有学习者", "基础问答 + 限量测验 + 1 个学习项目"],
            ["个人版", "￥39 / 月", "重度备考个人", "无限测验 + 知识图谱 + 错题闭环 + 全部搭子"],
            ["专业版", "￥99 / 月", "KOL / 自媒体", "个人版全部 + 多项目 + 数据导出 + 优先客服"],
            ["机构版", "定制报价", "培训机构 / 高校", "私有化部署 + 品牌定制 + API 接入 + 培训"],
        ],
        col_ratios=[0.15, 0.15, 0.25, 0.45],
        caption_text="表 6-1 分层订阅定价方案",
    ))

    story.extend(h2("6.2 推广渠道(Go-to-Market)"))
    story.append(bullet(
        "<b>垂直社群合作</b>:与考研、CPA、雅思培训机构(如学而思、文都、"
        "高顿)合作,将产品嵌入学习体系或提供联盟优惠。"
    ))
    story.append(bullet(
        "<b>KOL 内容营销</b>:在小红书、B 站、知乎投放「30 天 AI 备考挑战」"
        "等内容,以学习成果对比图吸引自学者。"
    ))
    story.append(bullet(
        "<b>高校推广</b>:与高校教务处、考研自习室、学生社团合作,提供免"
        "费试用换取种子用户与口碑。"
    ))
    story.append(bullet(
        "<b>SEO 自然流量</b>:针对「考研复习计划」「CPA 错题分析」等长尾"
        "关键词做内容 SEO,获取高意向搜索流量。"
    ))

    story.append(PageBreak())

    # ════════════════════════════════════════════════════════════════
    # 第 12 页:产品路线图
    # ════════════════════════════════════════════════════════════════
    story.extend(h1("七、产品路线图"))

    story.extend(h2("7.1 12 个月里程碑"))
    story.append(metrics_row([
        ("M3", "MVP 公开发布"),
        ("M6", "付费版上线"),
        ("M12", "收支平衡"),
    ]))
    story.append(Spacer(1, 10))

    roadmap_path = os.path.join(OUT_DIR, "bp_roadmap.png")
    if os.path.exists(roadmap_path):
        story.append(embed_image(roadmap_path, max_width=AVAIL_W, max_height=AVAIL_H * 0.45))
        story.append(caption("图 7-1 StudyMate Agent 12 个月产品路线图"))

    story.extend(h2("7.2 阶段重点"))
    story.append(bullet(
        "<b>M1–M3(研发期)</b>:完善核心学习闭环功能、制作样例数据与 Demo"
        " 录制,目标发布 MVP。"
    ))
    story.append(bullet(
        "<b>M4–M6(内测与商业化试点)</b>:小规模内测收集反馈、上线付费版、"
        "启动社群营销,验证付费转化。"
    ))
    story.append(bullet(
        "<b>M7–M12(扩张期)</b>:增强知识图谱与推荐算法、上线移动端 H5、"
        "拓展 B 端机构合作、评估融资与收支平衡。"
    ))

    story.append(PageBreak())

    # ════════════════════════════════════════════════════════════════
    # 第 13 页:财务预测
    # ════════════════════════════════════════════════════════════════
    story.extend(h1("八、财务预测"))

    story.extend(h2("8.1 12 个月收入、成本与净利润预测"))
    finance_path = os.path.join(OUT_DIR, "bp_finance.png")
    if os.path.exists(finance_path):
        story.append(embed_image(finance_path, max_width=AVAIL_W, max_height=AVAIL_H * 0.42))
        story.append(caption("图 8-1 12 个月财务预测(柱状:收入与成本;折线:净利润)"))

    story.extend(h2("8.2 关键假设与说明"))
    story.extend(std_table(
        [
            ["月份", "付费用户", "月收入(万元)", "月成本(万元)", "净利润(万元)"],
            ["M1–M3(研发期)", "0", "0", "约 8 / 月", "约 -8 / 月"],
            ["M6(商业化试点)", "约 1,000", "约 4.5", "约 14", "约 -9.5"],
            ["M9(扩张期)", "约 6,000", "约 24", "约 29", "约 -5"],
            ["M12(目标平衡)", "约 18,000", "约 70", "约 50", "约 +20"],
        ],
        col_ratios=[0.28, 0.18, 0.18, 0.18, 0.18],
        caption_text="表 8-1 关键节点财务指标(单位:人民币万元)",
    ))

    story.append(p(
        "<b>核心假设</b>:(1) 个人版 ARPU 约 ￥39 / 月,按 80% 折扣后"
        "约 ￥31;(2) LLM API 成本随用户增长线性上升,通过任务分级"
        "(简单题用小模型)控制单用户成本;(3) 人力成本随团队扩张由"
        "3 人(M1)逐步增至 6 人(M12);(4) 市场费用占收入 15–20%。"
        "M9–M10 达到盈亏平衡点,M12 实现稳定正向净利润。"
    ))

    story.append(PageBreak())

    # ════════════════════════════════════════════════════════════════
    # 第 14 页:团队介绍
    # ════════════════════════════════════════════════════════════════
    story.extend(h1("九、团队介绍"))

    story.append(p(
        "StudyMate Agent 由 5 名核心成员组成,分工覆盖产品、架构、Agent "
        "算法、工程质量、商业化与测试全链路,具备从需求洞察到工程交付"
        "的完整闭环能力。团队采用「主负责人 + 协同评审」机制,每个关键"
        "模块均有明确 owner,同时通过代码评审与方案评审保证质量。"
    ))

    story.extend(h2("9.1 核心成员与分工"))
    story.extend(std_table(
        [
            ["姓名", "角色", "核心职责", "对项目的价值"],
            ["<b>乔瑞雪</b>",
             "队长 / 产品与系统负责人",
             "产品方向把控、核心系统架构设计、全栈实现、Demo 演示、团队协调。",
             "证明项目有人能从需求一路推进到可交付产品,统一产品与技术决策。"],
            ["姜亚雷",
             "后端与工程质量负责人",
             "API 稳定性、安全边界、部署架构、CI/CD 流水线、代码评审。",
             "补足工程可靠性与规模化能力,保障服务可上线、可运维。"],
            ["乔瑞琪",
             "Agent 与学习闭环负责人",
             "LLM 工作流编排、Prompt 评测、错题回流机制、学习策略数据设计。",
             "主导项目最核心的 AI Agent 能力,决定学习闭环的智能水平。"],
            ["芈祉嫣",
             "用户验证与商业化负责人",
             "用户访谈、试点运营、定价验证、渠道拓展、财务模型构建。",
             "把商业预测转化为真实验证,连接产品与市场。"],
            ["陈鸿邦",
             "全栈交付与测试负责人",
             "Web / API 集成、E2E 测试、发布流程、演示环境。",
             "保证产品可以稳定演示和交付。"],
        ],
        col_ratios=[0.11, 0.20, 0.40, 0.29],
        caption_text="表 9-1 核心团队成员与分工(队长乔瑞雪持股 ≥ 20%,符合大赛要求)",
    ))

    story.extend(h2("9.2 团队能力结构"))
    story.append(metrics_row([
        ("5 人", "完整闭环团队"),
        ("3 位", "工程 / Agent 技术骨干"),
        ("1 位", "专职商业化验证"),
    ]))
    story.append(Spacer(1, 12))

    story.extend(h2("9.3 团队优势"))
    story.append(bullet(
        "<b>角色无短板</b>:产品、架构、AI Agent、工程质量、商业化五大"
        "关键角色齐备,无常见创业团队「重技术轻商业」或「有产品无工程」"
        "的结构性缺陷。"
    ))
    story.append(bullet(
        "<b>核心技术自研</b>:3 位技术骨干(乔瑞雪、姜亚雷、乔瑞琪)覆盖"
        "系统架构、工程质量、AI Agent 三大技术支柱,核心代码完全自主"
        "可控,不依赖外部技术授权。"
    ))
    story.append(bullet(
        "<b>商业化前置</b>:设专职商业化负责人(芈祉嫣)从 MVP 阶段即"
        "开展用户访谈与定价验证,确保产品迭代始终由真实市场需求驱动。"
    ))
    story.append(bullet(
        "<b>交付节奏可控</b>:全栈交付与测试负责人(陈鸿邦)把关发布"
        "质量,支撑团队保持 hackathon 风格的高效迭代——核心学习闭环已"
        "在 8 周内完成。"
    ))

    story.append(PageBreak())

    # ════════════════════════════════════════════════════════════════
    # 第 15 页:风险与对策
    # ════════════════════════════════════════════════════════════════
    story.extend(h1("十、风险与对策"))

    story.extend(std_table(
        [
            ["风险类别", "具体风险", "应对策略"],
            ["技术风险",
             "依赖第三方 LLM API,服务稳定性与成本波动影响产品可用性。",
             "支持多家模型服务商(GPT-4o-mini / 通义千问 / 智谱),按任务"
             "复杂度分级调用;关键路径预留本地轻量模型降级方案。"],
            ["数据与合规风险",
             "用户上传教材可能涉及版权;学习数据属个人隐私。",
             "用户协议明确「教材仅用于生成学习内容、不外泄」;数据本地"
             "存储 + 加密;发布 PRIVACY.md 合规声明。"],
            ["市场风险",
             "教育工具竞争激烈,用户迁移成本高、增长乏力。",
             "聚焦考研 / CPA 垂直场景打透;通过「学习搭子」情感粘性提升"
             "留存;与培训机构合作导入流量。"],
            ["运营与资金风险",
             "初期持续投入研发与服务器,市场验证慢则资金压力大。",
             "保守团队规模(3–6 人);优先验证付费转化;同步寻求天使 / "
             "VC 融资补充燃料。"],
            ["模型生成风险",
             "LLM 可能生成不准确或偏差内容。",
             "关键答案基于检索到的教材原文验证;为重要解释标注知识点"
             "与参考来源;建立社区纠错机制。"],
            ["监管政策风险",
             "AI 教育工具可能面临新规(如生成式 AI 服务管理办法)。",
             "密切关注政策动态,内容审核符合要求;加强本地化模型研究,"
             "降低单点依赖。"],
        ],
        col_ratios=[0.18, 0.4, 0.42],
        caption_text="表 10-1 主要风险识别与对策",
    ))

    story.append(Spacer(1, 14))
    story.extend(h2("结语"))
    story.append(p(
        "StudyMate Agent 以「AI 备考学习搭子」为定位,通过完整的学习闭环"
        "与情感化陪伴,切实解决高强度备考人群的核心痛点。我们已具备可运"
        "行 MVP、清晰的商业化路径与稳健的财务模型,期待与大赛评委及合作"
        "伙伴一起,让每一位学习者都拥有一位专属 AI 备考搭子。"
    ))

    story.append(Spacer(1, 20))
    story.append(HRFlowable(width="40%", thickness=1, color=ACCENT,
                            spaceBefore=0, spaceAfter=10, hAlign="CENTER"))
    story.append(Paragraph("— 本商业计划书完 —", ParagraphStyle(
        "End", fontName=CN_FONT, fontSize=10, leading=14,
        textColor=TEXT_MUTED, alignment=TA_CENTER, wordWrap="CJK")))

    return story


def main():
    print(f"输出:{OUTPUT_PDF}")
    doc = SimpleDocTemplate(
        OUTPUT_PDF,
        pagesize=A4,
        leftMargin=MARGIN_L,
        rightMargin=MARGIN_R,
        topMargin=MARGIN_T,
        bottomMargin=MARGIN_B,
        title="StudyMate Agent 商业计划书",
        author="StudyMate Agent Team",
        creator="StudyMate Agent Team",
        subject="2026 香港科技大学百万奖金创业大赛 · 商业计划书",
    )

    story = build_story()
    doc.build(
        story,
        onFirstPage=draw_cover,
        onLaterPages=on_page,
    )

    size_kb = os.path.getsize(OUTPUT_PDF) / 1024
    print(f"✓ 生成成功,大小 {size_kb:.1f} KB")


if __name__ == "__main__":
    main()
