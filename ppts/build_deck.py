"""
Builds the DealFlow360 hackathon deck.

Run:
  C:/Users/rajak/.workbuddy-ai/binaries/python/envs/default/Scripts/python.exe ppts/build_deck.py

Design: 16:9, forest-green accent (matches the product UI), light surfaces.
Every figure in here was counted from the repo, not copied from a doc.
"""

import os
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
from PIL import Image

# ---------------------------------------------------------------- theme
INK   = RGBColor(0x0E, 0x1A, 0x16)
INK2  = RGBColor(0x33, 0x45, 0x3F)
MUTED = RGBColor(0x6B, 0x7C, 0x75)
GREEN = RGBColor(0x0F, 0x6B, 0x4F)
GDARK = RGBColor(0x0A, 0x45, 0x34)
GLITE = RGBColor(0x2E, 0x8B, 0x6B)
MINT  = RGBColor(0xE8, 0xF2, 0xED)
MINT2 = RGBColor(0xF4, 0xF9, 0xF7)
LINE  = RGBColor(0xD6, 0xE2, 0xDC)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
AMBER = RGBColor(0xB4, 0x6B, 0x0B)
AMBER_BG = RGBColor(0xFD, 0xF3, 0xE3)
RED   = RGBColor(0xB3, 0x26, 0x1E)
RED_BG = RGBColor(0xFB, 0xEC, 0xEA)
BLUE  = RGBColor(0x1B, 0x5E, 0x8C)
BLUE_BG = RGBColor(0xE9, 0xF1, 0xF7)

FONT = "Segoe UI"
W, H = 13.333, 7.5
M = 0.72

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARCH_PNG = os.path.join(ROOT, "docs", "_build", "previews",
                        "DealFlow360-Architecture-rev2-p1.png")


# ---------------------------------------------------------------- primitives
def rect(slide, x, y, w, h, fill=None, line=None, lw=1.0,
         shape=MSO_SHAPE.RECTANGLE, adj=None, shadow=False):
    sh = slide.shapes.add_shape(shape, Inches(x), Inches(y), Inches(w), Inches(h))
    if fill is None:
        sh.fill.background()
    else:
        sh.fill.solid()
        sh.fill.fore_color.rgb = fill
    if line is None:
        sh.line.fill.background()
    else:
        sh.line.color.rgb = line
        sh.line.width = Pt(lw)
    sh.shadow.inherit = shadow
    if adj is not None:
        try:
            sh.adjustments[0] = adj
        except Exception:
            pass
    sh.text_frame.word_wrap = True
    return sh


def put(shape, lines, anchor=MSO_ANCHOR.TOP, align=PP_ALIGN.LEFT,
        ml=0.12, mr=0.12, mt=0.05, mb=0.05):
    tf = shape.text_frame
    tf.word_wrap = True
    tf.margin_left, tf.margin_right = Inches(ml), Inches(mr)
    tf.margin_top, tf.margin_bottom = Inches(mt), Inches(mb)
    tf.vertical_anchor = anchor
    tf.clear()
    first = True
    for ln in lines:
        p = tf.paragraphs[0] if first else tf.add_paragraph()
        first = False
        p.alignment = ln.get("align", align)
        if ln.get("sb"):
            p.space_before = Pt(ln["sb"])
        if ln.get("sa"):
            p.space_after = Pt(ln["sa"])
        r = p.add_run()
        r.text = ln.get("t", "")
        f = r.font
        f.name = ln.get("font", FONT)
        f.size = Pt(ln.get("sz", 14))
        f.bold = ln.get("b", False)
        f.color.rgb = ln.get("c", INK)
        if ln.get("caps"):
            r.font._rPr.set("cap", "all")
    return shape


def box(slide, x, y, w, h, lines, **kw):
    return put(rect(slide, x, y, w, h), lines, **kw)


def blank(prs):
    return prs.slides.add_slide(prs.slide_layouts[6])


def header(slide, kicker, title, sub=None, rule=True):
    box(slide, M, 0.42, 10.5, 0.3,
        [{"t": kicker, "sz": 11, "b": True, "c": GREEN}], anchor=MSO_ANCHOR.MIDDLE, ml=0)
    box(slide, M, 0.72, 11.9, 0.55,
        [{"t": title, "sz": 27, "b": True, "c": INK}], anchor=MSO_ANCHOR.MIDDLE, ml=0)
    y = 1.32
    if sub:
        box(slide, M, y, 11.9, 0.32,
            [{"t": sub, "sz": 13, "c": MUTED}], anchor=MSO_ANCHOR.MIDDLE, ml=0)
        y = 1.66
    if rule:
        rect(slide, M, y, 0.9, 0.045, fill=GREEN)
    return y + 0.28


def footer(slide, n, note="DealFlow360 · Odoo Hackathon"):
    box(slide, M, 7.02, 9.0, 0.28, [{"t": note, "sz": 9, "c": MUTED}],
        anchor=MSO_ANCHOR.MIDDLE, ml=0)
    box(slide, 12.0, 7.02, 0.62, 0.28, [{"t": str(n), "sz": 10, "b": True, "c": MUTED}],
        anchor=MSO_ANCHOR.MIDDLE, align=PP_ALIGN.RIGHT, ml=0, mr=0)


def table(slide, x, y, w, data, col_w, head_h=0.36, row_h=0.36,
          fs=10.5, hfs=10.5, zebra=True, align=None):
    rows, cols = len(data), len(data[0])
    gt = slide.shapes.add_table(rows, cols, Inches(x), Inches(y),
                                Inches(w), Inches(head_h + row_h * (rows - 1)))
    tbl = gt.table
    tbl.first_row = True
    tbl.horz_banding = False
    for i, cw in enumerate(col_w):
        tbl.columns[i].width = Inches(cw)
    tbl.rows[0].height = Inches(head_h)
    for r in range(1, rows):
        tbl.rows[r].height = Inches(row_h)

    for r in range(rows):
        for c in range(cols):
            cell = tbl.cell(r, c)
            cell.margin_left = Inches(0.09)
            cell.margin_right = Inches(0.07)
            cell.margin_top = Inches(0.03)
            cell.margin_bottom = Inches(0.03)
            cell.vertical_anchor = MSO_ANCHOR.MIDDLE
            if r == 0:
                cell.fill.solid()
                cell.fill.fore_color.rgb = GDARK
            else:
                cell.fill.solid()
                cell.fill.fore_color.rgb = (MINT2 if (zebra and r % 2 == 0) else WHITE)
            txt = data[r][c]
            bold = (r == 0)
            col = WHITE if r == 0 else (INK2 if c == 0 else INK)
            if isinstance(txt, tuple):
                txt, col, bold = txt
            tf = cell.text_frame
            tf.word_wrap = True
            tf.clear()
            p = tf.paragraphs[0]
            if align and c in align:
                p.alignment = align[c]
            run = p.add_run()
            run.text = txt
            run.font.name = FONT
            run.font.size = Pt(hfs if r == 0 else fs)
            run.font.bold = bold
            run.font.color.rgb = col
    return tbl


def bullets(slide, x, y, w, items, gap=0.06, dot=0.09, fs=11.5, title_fs=13):
    cy = y
    for it in items:
        rect(slide, x, cy + 0.07, dot, dot, fill=it.get("c", GREEN),
             shape=MSO_SHAPE.OVAL)
        h = 0.78 if it.get("d") else 0.26
        lines = [{"t": it["t"], "sz": title_fs, "b": True, "c": INK}]
        if it.get("d"):
            lines.append({"t": it["d"], "sz": fs, "c": INK2, "sb": 2})
        box(slide, x + dot + 0.16, cy, w - dot - 0.16, h, lines, ml=0, anchor=MSO_ANCHOR.TOP)
        cy += h + gap
    return cy


def cards(slide, x, y, w, h, items, cols=3, gapx=0.22, gapy=0.22,
          accent=GREEN, bg=WHITE, num=True, fs=11, tfs=12.5):
    n = len(items)
    rows = (n + cols - 1) // cols
    cw = (w - gapx * (cols - 1)) / cols
    ch = (h - gapy * (rows - 1)) / rows
    for i, it in enumerate(items):
        r, c = divmod(i, cols)
        cx = x + c * (cw + gapx)
        cy = y + r * (ch + gapy)
        card = rect(slide, cx, cy, cw, ch, fill=bg, line=LINE, lw=0.75,
                    shape=MSO_SHAPE.ROUNDED_RECTANGLE, adj=0.06)
        lines = []
        if num:
            lines.append({"t": str(i + 1).zfill(2), "sz": 10, "b": True, "c": accent})
        lines.append({"t": it["t"], "sz": tfs, "b": True, "c": INK, "sb": 2})
        if it.get("d"):
            lines.append({"t": it["d"], "sz": fs, "c": INK2})
        put(card, lines, ml=0.16, mr=0.16, mt=0.12, anchor=MSO_ANCHOR.TOP)
    return y + h


# ================================================================ slides
def build(prs):
    n = 0

    # ---------------------------------------------------------- 1 title
    s = blank(prs)
    rect(s, 0, 0, W, H, fill=GDARK)
    rect(s, 0, 0, 0.22, H, fill=GREEN)
    box(s, 1.0, 1.75, 11, 0.35,
        [{"t": "Odoo Hackathon · Sales Operations Platform", "sz": 13, "b": True,
          "c": RGBColor(0x8F, 0xD3, 0xB8)}], ml=0)
    box(s, 1.0, 2.15, 11, 1.0,
        [{"t": "DealFlow360", "sz": 62, "b": True, "c": WHITE}], ml=0)
    box(s, 1.0, 3.15, 11.2, 0.9,
        [{"t": "An intelligent, self-governing B2B quote-to-cash platform.",
          "sz": 21, "c": RGBColor(0xD7, 0xE9, 0xE1)},
         {"t": "It explains the consequences of a deal, governs its approval, and carries the "
               "accepted terms through stock allocation and billing.",
          "sz": 14, "c": RGBColor(0x9F, 0xBE, 0xB3), "sb": 6}], ml=0)
    rect(s, 1.0, 4.35, 1.1, 0.045, fill=GREEN)
    chips = ["Discount governance", "Live recommendations", "Multi-warehouse split",
             "Hybrid billing", "Portal negotiation", "Deal health"]
    cx = 1.0
    for c in chips:
        tw = len(c) * 0.076 + 0.34
        ch = rect(s, cx, 4.72, tw, 0.34, fill=RGBColor(0x14, 0x5C, 0x45),
                  shape=MSO_SHAPE.ROUNDED_RECTANGLE, adj=0.5)
        put(ch, [{"t": c, "sz": 10.5, "c": RGBColor(0xC9, 0xE6, 0xDA)}],
            anchor=MSO_ANCHOR.MIDDLE, align=PP_ALIGN.CENTER, ml=0.02)
        cx += tw + 0.14
    box(s, 1.0, 6.25, 11, 0.5,
        [{"t": "Team of 6  ·  Java 21 / Spring Boot 4  ·  React 19 + Vite  ·  PostgreSQL  ·  "
               "Supabase Auth", "sz": 12, "c": RGBColor(0x7E, 0xA0, 0x94)}], ml=0)
    n += 1

    # ---------------------------------------------------------- 2 problem
    s = blank(prs)
    y = header(s, "THE PROBLEM", "B2B sales doesn't fit in a quote-to-invoice form",
               "Six places where a real deal falls out of a simple sales tool")
    cards(s, M, y + 0.05, W - 2 * M, 4.05, [
        {"t": "Discount leakage", "d": "Ceilings differ by customer tier AND product category. "
                                       "A rep can breach a category limit while the order-level "
                                       "number still looks fine."},
        {"t": "Invisible approvals", "d": "Managers find out a deal is stuck after the momentum "
                                          "is already gone. Nobody owns the queue."},
        {"t": "Inventory fiction", "d": "Stock is spread across warehouses. Quotes promise "
                                        "quantities that no single depot can actually ship."},
        {"t": "Hybrid orders", "d": "One-time hardware and recurring subscriptions sit on the "
                                    "same order. Proration and credits get done by hand."},
        {"t": "Email negotiation", "d": "Customers negotiate in threads. The agreed terms drift "
                                        "away from the document that gets approved."},
        {"t": "Static PDFs", "d": "The quotation is a dead file, not a living, negotiable "
                                  "document both sides can act on."},
    ], cols=3)
    box(s, M, 6.28, W - 2 * M, 0.4,
        [{"t": "Brief: “Most simple sales tools handle the basics well. Real B2B teams operate "
               "in messier conditions.”", "sz": 12, "c": MUTED}], ml=0)
    footer(s, n := n + 1)

    # ---------------------------------------------------------- 3 requirements
    s = blank(prs)
    y = header(s, "PROBLEM STATEMENT", "What the brief actually demanded",
               "Seven responsibilities — all of them business logic, not screens")
    table(s, M, y, W - 2 * M, [
        ["Responsibility", "Required outcome", "Where it lives"],
        ["Multi-tier discount governance",
         "Ceilings per customer tier and per category, automatic Manager → Finance routing, "
         "full audit history", "policy · quotes · approvals"],
        ["Live recommendations",
         "Ranked upsell / cross-sell from co-purchase history, with real-time margin impact",
         "recommendations"],
        ["Multi-warehouse fulfillment",
         "Stock-aware split across depots, manual override, backorder, consolidation on receipt",
         "fulfillment"],
        ["Hybrid billing",
         "One-time and recurring lines on one order; schedules, proration, cancellation credits",
         "billing"],
        ["Portal negotiation",
         "Genuinely separate restricted portal: line comments, counter-discounts, one-click "
         "confirm", "portal"],
        ["Deal monitoring",
         "Stalled quotes, discount anomalies, promise slippage, nudges and escalations", "health"],
        ["Configuration & reporting",
         "Working setup forms, report filters, PDF and XLS export", "catalog · reporting"],
    ], col_w=[3.1, 6.5, 2.3], row_h=0.42, fs=10.5)
    t = rect(s, M, y + 4.3, W - 2 * M, 0.62, fill=AMBER_BG, line=RGBColor(0xEC, 0xD7, 0xB4),
             lw=0.75, shape=MSO_SHAPE.ROUNDED_RECTANGLE, adj=0.12)
    put(t, [{"t": "Non-negotiable constraints we designed against:",
             "sz": 11.5, "b": True, "c": AMBER},
            {"t": "Core rules (approval routing, discount governance, warehouse splitting, billing "
                  "proration) must be real application logic — not hardcoded or faked. The "
                  "customer portal must be a real, separate, restricted view.",
             "sz": 11, "c": INK2, "sb": 2}], ml=0.18)
    footer(s, n := n + 1)

    # ---------------------------------------------------------- 4 our answer
    s = blank(prs)
    y = header(s, "THE SOLUTION", "One workspace that governs a deal from quote to cash")
    q = rect(s, M, y, W - 2 * M, 0.86, fill=MINT, line=LINE, lw=0.75,
             shape=MSO_SHAPE.ROUNDED_RECTANGLE, adj=0.10)
    put(q, [{"t": "“A sales workspace that explains the consequences of a deal, governs its "
                  "approval, and carries the accepted terms through stock allocation and "
                  "billing.”", "sz": 15, "b": True, "c": GDARK}],
        anchor=MSO_ANCHOR.MIDDLE, align=PP_ALIGN.CENTER, ml=0.3)
    cards(s, M, y + 1.06, W - 2 * M, 1.5, [
        {"t": "Build", "d": "Catalog + line editor with live pricing, margin and policy "
                            "evaluation as you type."},
        {"t": "Explain", "d": "Every evaluation returns structured reasons — why this "
                              "approver, why this split, why this total."},
        {"t": "Govern", "d": "Sequential Manager → Finance routing from a blended risk "
                             "score; nothing inherits an approval."},
        {"t": "Negotiate", "d": "Customer deal room with line comments, counters and "
                                "exact-version acceptance."},
        {"t": "Fulfil", "d": "Deterministic warehouse split with override, backorder and "
                             "consolidation."},
        {"t": "Bill", "d": "One-time and recurring on one order, with proration, credits "
                           "and a real payment record."},
    ], cols=6, gapx=0.16, gapy=0.2, num=False, fs=10, tfs=11.5)
    footer(s, n := n + 1)

    # ---------------------------------------------------------- 5 differentiators
    s = blank(prs)
    y = header(s, "UNIQUE SOLUTIONS", "Six things we built beyond the checklist",
               "These are the parts a CRUD demo cannot fake")
    bullets(s, M, y, W - 2 * M, [
        {"t": "Blended risk score, not a single threshold",
         "d": "Evaluates the worst line, value-weighted excess, total excess money, overall "
              "discount and margin — then routes to the highest level any of them demands. "
              "Splitting a line cannot lower the route, because a compliant line never offsets a "
              "breach (max(0, …) per line).", "c": GREEN},
        {"t": "Three independent gates, and nothing inherits an approval",
         "d": "Approval, seller adoption and customer acceptance are separate gates in either "
              "order. Editing submitted terms supersedes the revision and retires its pending "
              "steps.", "c": GREEN},
        {"t": "Finalisation is one database transaction",
         "d": "Order creation, stock reservation under row locks, and the first invoice commit "
              "together or not at all. Under in-stock-only terms a shortage rolls the whole "
              "thing back.", "c": GREEN},
        {"t": "Explainability is a data structure, not a marketing word",
         "d": "Every engine emits structured reasons[] — “Finance is needed because the "
              "service discount exceeds its category ceiling by 8 points” — all of it "
              "rendered from real engine output.", "c": GREEN},
        {"t": "Deterministic engines instead of ML theatre",
         "d": "Four pure-function engines (pricing, risk, allocation, proration) with no I/O. "
              "No trained model is required and none is claimed.", "c": GREEN},
        {"t": "The portal is separate by construction",
         "d": "Portal responses use different DTO types with no field for cost, margin or policy "
              "thresholds. Out-of-scope reads return 404, not 403, so a probing client cannot "
              "map records.", "c": GREEN},
    ], gap=0.06, fs=10.5, title_fs=12.5)
    footer(s, n := n + 1)

    # ---------------------------------------------------------- 6 architecture
    s = blank(prs)
    y = header(s, "SYSTEM DESIGN", "How the pieces connect",
               "One modular Spring service, one React SPA, one PostgreSQL database")
    if os.path.exists(ARCH_PNG):
        iw, ih = Image.open(ARCH_PNG).size
        maxw, maxh = W - 2 * M, 4.55
        sc = min(maxw / iw, maxh / ih)
        pw, ph = iw * sc, ih * sc
        s.shapes.add_picture(ARCH_PNG, Inches(M + (maxw - pw) / 2), Inches(y + 0.05),
                             width=Inches(pw), height=Inches(ph))
    note = rect(s, M, y + 4.72, W - 2 * M, 0.5, fill=MINT2, line=LINE, lw=0.75,
                shape=MSO_SHAPE.ROUNDED_RECTANGLE, adj=0.14)
    put(note, [{"t": "Diagram note: this architecture sheet predates the frontend swap — the "
                     "delivered client is a Vite + React 19 SPA, not Next.js. The module "
                     "boundaries, engines and data layer are as built.",
                "sz": 10.5, "c": MUTED}], anchor=MSO_ANCHOR.MIDDLE, ml=0.18)
    footer(s, n := n + 1)

    # ---------------------------------------------------------- 7 backend
    s = blank(prs)
    y = header(s, "SYSTEM DESIGN · BACKEND", "One modular service, four pure engines")
    left = rect(s, M, y, 5.5, 4.5, fill=WHITE, line=LINE, lw=0.75,
                shape=MSO_SHAPE.ROUNDED_RECTANGLE, adj=0.03)
    put(left, [
        {"t": "16 domain modules", "sz": 13.5, "b": True, "c": GDARK},
        {"t": "auth · catalog · policy · quotes · approvals · portal · orders ·",
         "sz": 11, "c": INK2, "sb": 4},
        {"t": "fulfillment · billing · recommendations · health · reporting ·",
         "sz": 11, "c": INK2},
        {"t": "outbox · notifications · jobs · assistant", "sz": 11, "c": INK2},
        {"t": "", "sz": 6},
        {"t": "220 Java files  ·  198 main + 22 test", "sz": 11.5, "b": True, "c": GREEN, "sb": 4},
        {"t": "7 Flyway migrations (V1–V7), Hibernate set to", "sz": 11, "c": INK2},
        {"t": "ddl-auto=validate — Flyway owns the schema.", "sz": 11, "c": INK2},
        {"t": "", "sz": 6},
        {"t": "Controllers validate and authorise. Services own",
         "sz": 11, "c": INK2},
        {"t": "transactions. The four engines are pure functions.",
         "sz": 11, "c": INK2},
    ], ml=0.22, mr=0.22, mt=0.18)
    right_x = M + 5.78
    right_w = W - 2 * M - 5.78
    box(s, right_x, y, right_w, 0.3,
        [{"t": "THE FOUR ENGINES", "sz": 11, "b": True, "c": GREEN}], ml=0)
    cards(s, right_x, y + 0.34, right_w, 1.72, [
        {"t": "PricingEngine", "d": "Line + order discounts, tax, rounding"},
        {"t": "RiskEngine", "d": "Blended score → approval route"},
        {"t": "AllocationEngine", "d": "Warehouse split, shipping cost"},
        {"t": "ProrationCalculator", "d": "Calendar-based credits & adjustments"},
    ], cols=2, gapx=0.16, gapy=0.16, num=False, fs=10, tfs=11)
    t = rect(s, right_x, y + 2.24, right_w, 1.55, fill=GDARK,
             shape=MSO_SHAPE.ROUNDED_RECTANGLE, adj=0.06)
    put(t, [
        {"t": "THE TRANSACTION THAT MATTERS", "sz": 10.5, "b": True,
         "c": RGBColor(0x8F, 0xD3, 0xB8)},
        {"t": "OrderFinalizationService.tryFinalize", "sz": 12.5, "b": True, "c": WHITE, "sb": 3},
        {"t": "Called from every path that can complete a gate. It locks the quotation, "
              "re-checks every gate, then creates the order, reserves stock and raises the first "
              "invoice — in one transaction.", "sz": 10.5,
         "c": RGBColor(0xCB, 0xDF, 0xD7)},
        {"t": "Duplicate creation is blocked three ways: aggregate lock, explicit existence "
              "check, and a UNIQUE constraint on orders.quote_id.", "sz": 10.5,
         "c": RGBColor(0xCB, 0xDF, 0xD7), "sb": 3},
    ], ml=0.22, mr=0.22, mt=0.16)
    legend = rect(s, right_x, y + 3.94, right_w, 0.56, fill=MINT,
                  shape=MSO_SHAPE.ROUNDED_RECTANGLE, adj=0.14)
    put(legend, [{"t": "Money: BIGINT minor units, computed in BigDecimal, rounded HALF_UP "
                       "exactly once. Line residual is redistributed so lines always reconcile "
                       "to the total.", "sz": 10.5, "c": GDARK}],
        anchor=MSO_ANCHOR.MIDDLE, ml=0.2)
    footer(s, n := n + 1)

    # ---------------------------------------------------------- 8 integrity
    s = blank(prs)
    y = header(s, "SYSTEM DESIGN · INTEGRITY",
               "The parts that break demos — and how we handled them")
    table(s, M, y, W - 2 * M, [
        ["Failure mode", "Our mechanism", "Proven by"],
        ["Two reps sell the last unit",
         "Finalisation re-reads stock under (variant, warehouse)-ordered row locks; "
         "IN_STOCK_ONLY fails the whole transaction", "ConcurrencyAndIdempotencyIT"],
        ["Retry creates a second order or invoice",
         "Aggregate lock + existence check + UNIQUE(orders.quote_id); recurring charges keyed by "
         "a global charge_key", "ConcurrencyAndIdempotencyIT"],
        ["Double-click on approve / pay / accept",
         "Idempotency-Key header on every mutating endpoint — replay returns the original "
         "result, key reuse with a different body is refused", "BillingLifecycleIT"],
        ["Stale client overwrites a newer version",
         "Optimistic row versions + exact-revision acceptance; stale writes rejected",
         "FlowBNegotiationIT"],
        ["Portal leaks cost, margin or policy",
         "Separate portal DTOs with no such fields; out-of-scope reads return 404, not 403",
         "FlowAEndToEndIT"],
        ["A missed WebSocket frame loses an update",
         "Transactional outbox → private per-user STOMP queue → REST refetch, plus a "
         "durable notifications inbox", "WebSocketSecurityIT"],
    ], col_w=[3.3, 6.4, 3.2], row_h=0.62, fs=10.5)
    footer(s, n := n + 1)

    # ---------------------------------------------------------- 9 realtime
    s = blank(prs)
    y = header(s, "SYSTEM DESIGN · REAL TIME", "Live updates without lying to the user")
    steps = [
        ("01", "Mutation commits", "Every important mutation writes an outbox_events row inside "
                                   "the business transaction."),
        ("02", "Dispatcher claims", "A 1-second dispatcher claims rows with FOR UPDATE SKIP "
                                    "LOCKED and resolves recipients against current ownership."),
        ("03", "Private push", "A minimal frame (id, type, entity, version) goes to each user's "
                               "private STOMP queue — never a broadcast."),
        ("04", "Client refetches", "The browser refetches through REST. Reconnect triggers an "
                                   "authorised refresh, because frames can be missed."),
    ]
    cw = (W - 2 * M - 3 * 0.2) / 4
    for i, (num, t, d) in enumerate(steps):
        cx = M + i * (cw + 0.2)
        c = rect(s, cx, y + 0.05, cw, 2.0, fill=WHITE, line=LINE, lw=0.75,
                 shape=MSO_SHAPE.ROUNDED_RECTANGLE, adj=0.05)
        put(c, [{"t": num, "sz": 17, "b": True, "c": MINT if False else GLITE},
                {"t": t, "sz": 12.5, "b": True, "c": INK, "sb": 4},
                {"t": d, "sz": 10.5, "c": INK2}], ml=0.18, mr=0.18, mt=0.16)
        if i < 3:
            box(s, cx + cw, y + 0.95, 0.2, 0.3, [{"t": "›", "sz": 20, "b": True, "c": GLITE}],
                align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE, ml=0, mr=0)
    t = rect(s, M, y + 2.3, W - 2 * M, 1.0, fill=MINT,
             shape=MSO_SHAPE.ROUNDED_RECTANGLE, adj=0.11)
    put(t, [{"t": "Security posture", "sz": 12, "b": True, "c": GDARK},
            {"t": "Token in the CONNECT frame, not the URL. Subscriptions are per-user and "
                  "authenticated; an anonymous CONNECT is refused and a foreign subscription "
                  "closes the session. The WebSocket is never the source of truth — a "
                  "committed outbox row is.", "sz": 11.5, "c": INK2, "sb": 3}], ml=0.25)
    box(s, M, y + 3.5, W - 2 * M, 0.9, [
        {"t": "Jobs run in the background, not in the browser", "sz": 12, "b": True, "c": GDARK},
        {"t": "A leased minute sweep raises due recurring charges (one transaction per "
              "subscription), runs deal-health rules and expires stale quotations. "
              "POST /internal/job-runs triggers the same code by hand — useful on stage.",
         "sz": 11.5, "c": INK2, "sb": 3}], ml=0)
    footer(s, n := n + 1)

    # ---------------------------------------------------------- 10 tech stack
    s = blank(prs)
    y = header(s, "TECH STACK", "What we actually shipped it on")
    table(s, M, y, W - 2 * M, [
        ["Layer", "Choice", "Why this and not the alternative"],
        ["Frontend", "React 19 + TypeScript, Vite 8, Tailwind v4, React Router 7",
         "SPA with a dev proxy for /api and /ws. Role-based layouts for REP, MANAGER, FINANCE, "
         "ADMIN and CUSTOMER."],
        ["Backend", "Java 21, Spring Boot 4.1, Spring MVC",
         "Practical team experience, and a runtime that supports persistent WebSockets and "
         "scheduled jobs without extra infrastructure."],
        ["Persistence", "PostgreSQL + Spring Data JPA / Hibernate 7, HikariCP, Flyway",
         "Explicit locking, real constraints and versioned migrations. Flyway owns the schema; "
         "Hibernate only validates it."],
        ["Identity", "Supabase Auth JWTs verified by Spring Security OAuth2 resource server",
         "The token proves who signed in; the database decides what they may do. Roles are read "
         "from the DB on every request."],
        ["Real time", "STOMP over native WebSocket (/ws) + @stomp/stompjs, transactional outbox",
         "Authenticated per-user frames after commit, with REST refetch and a durable inbox as "
         "the safety net."],
        ["Money & time", "BigDecimal + BIGINT minor units, java.time, BusinessClock",
         "Exact rounding, calendar-correct proration, and an overridable clock for demos."],
        ["Exports", "Apache PDFBox and Apache POI",
         "Server-authoritative PDF, XLSX and legacy XLS — real bytes, not a print dialog."],
        ["AI", "Sarvam chat completions (sarvam-105b), server-side only",
         "Conversational explanation and review routing. No tools, no writes, and it never "
         "decides a price or an approval."],
        ["Verification", "JUnit 5 + Testcontainers PostgreSQL, Playwright + axe",
         "Rules are unit-tested; concurrency and auth are exercised against a real PostgreSQL."],
    ], col_w=[1.9, 4.4, 5.6], row_h=0.5, fs=10)
    footer(s, n := n + 1)

    # ---------------------------------------------------------- 11 product surface
    s = blank(prs)
    y = header(s, "PRODUCT SURFACE", "25 routes, five role workspaces, one shared backend")
    table(s, M, y, W - 2 * M, [
        ["Role", "Landing route", "What they can do there"],
        ["Sales rep", "/admin/sales/quotes",
         "Pipeline list + kanban, and the Quote Builder: catalog, lines, live margin, "
         "recommendations, submit for approval"],
        ["Manager", "/admin/manager/approvals",
         "Step-1 approval queue with the blended risk score and reasons; approve, reject or "
         "return for revision"],
        ["Finance / Ops", "/admin/finance/approvals",
         "Step-2 commercial sign-off, warehouse allocation and backorders, billing and "
         "refunds"],
        ["Admin", "/admin/system/catalog",
         "Master catalog, variants, price rules, discount policies, warehouses, plans, "
         "governance, jobs"],
        ["Customer", "/customer/quotes",
         "A separate portal: their quotes only — comment per line, counter a discount, "
         "accept exact terms"],
    ], col_w=[2.0, 3.0, 6.9], row_h=0.48, fs=10.5)
    c = rect(s, M, y + 3.45, W - 2 * M, 1.05, fill=MINT,
             shape=MSO_SHAPE.ROUNDED_RECTANGLE, adj=0.09)
    put(c, [{"t": "Demo-day advantage: one-click persona switching", "sz": 12.5, "b": True,
             "c": GDARK},
            {"t": "Eight seeded personas — admin, two reps, two managers, finance, and two "
                  "customers (Alpha Traders / Bronze, Beta Systems / Gold). Switch role in one "
                  "click and land on the right workspace, so a five-minute demo can show all "
                  "five journeys without a single logout.", "sz": 11.5, "c": INK2, "sb": 3}],
        ml=0.25)
    footer(s, n := n + 1)

    # ---------------------------------------------------------- 12 flow A
    s = blank(prs)
    y = header(s, "LIVE DEMO · FLOW A", "The ordinary sale — no approval needed",
               "Proves the happy path is genuinely automatic, not a shortcut")
    steps = [
        ("1", "Rep builds the quote",
         "Pick laptop + dock, apply a within-policy discount. Live margin updates on every "
         "keystroke."),
        ("2", "Accept a recommendation",
         "The panel ranks cross-sell from real confirmed-order co-purchases. Add it — the "
         "totals and margin move immediately."),
        ("3", "No approval triggered",
         "Risk engine finds nothing over ceiling, so the quote goes straight to share. No "
         "manager is disturbed."),
        ("4", "Customer accepts",
         "Exact-version acceptance in the portal. Gates are re-checked before anything is "
         "created."),
        ("5", "Stock reserved, invoice raised",
         "One transaction reserves across depots and raises the first invoice. Record a payment "
         "— status flips to paid."),
    ]
    cy = y + 0.05
    for num, t, d in steps:
        row = rect(s, M, cy, W - 2 * M, 0.78, fill=WHITE, line=LINE, lw=0.75,
                   shape=MSO_SHAPE.ROUNDED_RECTANGLE, adj=0.16)
        nb = rect(s, M + 0.14, cy + 0.19, 0.4, 0.4, fill=GREEN, shape=MSO_SHAPE.OVAL)
        put(nb, [{"t": num, "sz": 13, "b": True, "c": WHITE}],
            anchor=MSO_ANCHOR.MIDDLE, align=PP_ALIGN.CENTER, ml=0, mr=0)
        box(s, M + 0.68, cy + 0.06, 3.1, 0.66, [{"t": t, "sz": 13, "b": True, "c": INK}],
            anchor=MSO_ANCHOR.MIDDLE, ml=0)
        box(s, M + 3.9, cy + 0.06, 8.0, 0.66, [{"t": d, "sz": 11, "c": INK2}],
            anchor=MSO_ANCHOR.MIDDLE, ml=0)
        cy += 0.86
    footer(s, n := n + 1)

    # ---------------------------------------------------------- 13 flow B
    s = blank(prs)
    y = header(s, "LIVE DEMO · FLOW B", "The messy deal — approval, negotiation, backorder",
               "Seeded stock: Main 4 laptops / 10 docks, East 1 laptop")
    steps = [
        ("1", "Mixed quote breaches a category ceiling",
         "Hardware 12% (ceiling 15%) is fine; Setup Service 18% against a 10% ceiling is 8 "
         "points over — the whole quote is flagged."),
        ("2", "Manager, then Finance",
         "Sequential routing. Finance cannot be skipped and cannot act before the Manager step."),
        ("3", "Customer counters in the portal",
         "They propose a bigger discount on a line. That creates a candidate revision — it "
         "does not silently change the deal."),
        ("4", "Approvals are invalidated",
         "The counter re-enters the approval flow from step one. Nothing inherits the earlier "
         "sign-off."),
        ("5", "Split across two depots + backorder",
         "5 laptops against 4 in Main and 1 in East. Order 6 and it ships what exists, "
         "backorders the rest, then consolidates on receipt."),
        ("6", "Hybrid billing",
         "One-time lines invoice now; the subscription becomes a calendar-month schedule with a "
         "preserved anchor day. Change quantity mid-cycle → prorated adjustment."),
    ]
    cy = y + 0.02
    for num, t, d in steps:
        row = rect(s, M, cy, W - 2 * M, 0.66, fill=WHITE, line=LINE, lw=0.75,
                   shape=MSO_SHAPE.ROUNDED_RECTANGLE, adj=0.16)
        nb = rect(s, M + 0.14, cy + 0.13, 0.4, 0.4, fill=GDARK, shape=MSO_SHAPE.OVAL)
        put(nb, [{"t": num, "sz": 13, "b": True, "c": WHITE}],
            anchor=MSO_ANCHOR.MIDDLE, align=PP_ALIGN.CENTER, ml=0, mr=0)
        box(s, M + 0.68, cy + 0.04, 3.4, 0.58, [{"t": t, "sz": 12, "b": True, "c": INK}],
            anchor=MSO_ANCHOR.MIDDLE, ml=0)
        box(s, M + 4.2, cy + 0.04, 7.7, 0.58, [{"t": d, "sz": 10.5, "c": INK2}],
            anchor=MSO_ANCHOR.MIDDLE, ml=0)
        cy += 0.73
    footer(s, n := n + 1)

    # ---------------------------------------------------------- 14 screen: builder
    s = blank(prs)
    y = header(s, "SCREEN WALKTHROUGH · 1", "Quote Builder — the rep's cockpit")
    mock_x, mock_w = M, 7.5
    draw_mock(s, mock_x, y, mock_w, 4.35, "127.0.0.1:3000/admin/sales/quotes/1042",
              nav=["Quotations", "Pipeline", "Approvals", "Fulfilment", "Billing"],
              body="builder")
    nx = mock_x + mock_w + 0.3
    nw = W - M - nx
    box(s, nx, y, nw, 0.3, [{"t": "POINT AT THIS", "sz": 10.5, "b": True, "c": GREEN}], ml=0)
    points = [
        ("Catalog + line editor", "Hardware, services and subscriptions in one picker; "
                                  "quantities and per-line or order-level discounts."),
        ("Live margin indicator", "Recomputed by PricingEngine on every change — not on "
                                  "save."),
        ("Required approval + reasons", "Shows which role is needed and exactly why, before "
                                        "the rep submits."),
        ("Recommendation cards", "Each offer previews customer price, deal net change, margin "
                                 "change, stock and required approval."),
        ("Fulfilment availability", "Preview only — reserving nothing until the gates pass."),
    ]
    cy = y + 0.34
    for i, (t, d) in enumerate(points):
        nb = rect(s, nx, cy + 0.02, 0.26, 0.26, fill=GREEN, shape=MSO_SHAPE.OVAL)
        put(nb, [{"t": str(i + 1), "sz": 9.5, "b": True, "c": WHITE}],
            anchor=MSO_ANCHOR.MIDDLE, align=PP_ALIGN.CENTER, ml=0, mr=0)
        box(s, nx + 0.36, cy, nw - 0.36, 0.72,
            [{"t": t, "sz": 11.5, "b": True, "c": INK},
             {"t": d, "sz": 10, "c": INK2, "sb": 1}], ml=0)
        cy += 0.78
    footer(s, n := n + 1)

    # ---------------------------------------------------------- 15 screen: approvals + portal
    s = blank(prs)
    y = header(s, "SCREEN WALKTHROUGH · 2", "Approvals and the customer deal room",
               "Two screens that prove the governance is real")
    half = (W - 2 * M - 0.3) / 2
    draw_mock(s, M, y, half, 3.5, "127.0.0.1:3000/admin/manager/approvals",
              nav=["Queue", "Health", "Reviews"], body="approval")
    draw_mock(s, M + half + 0.3, y, half, 3.5, "127.0.0.1:3000/customer/quotes/1042",
              nav=["My quotes", "Invoices", "Profile"], body="portal")
    box(s, M, y + 3.62, half, 0.9, [
        {"t": "Manager approval queue", "sz": 12, "b": True, "c": GDARK},
        {"t": "Blended risk score, the exact submitted revision, and the policy reasons. "
              "Approve, reject or return — every action attributed and time-stamped.",
         "sz": 10.5, "c": INK2, "sb": 2}], ml=0)
    box(s, M + half + 0.3, y + 3.62, half, 0.9, [
        {"t": "Customer deal room", "sz": 12, "b": True, "c": GDARK},
        {"t": "Their quotations only — no cost, no margin, no thresholds. Comment per line, "
              "propose a counter, and accept the exact displayed version.",
         "sz": 10.5, "c": INK2, "sb": 2}], ml=0)
    t = rect(s, M, y + 4.62, W - 2 * M, 0.52, fill=AMBER_BG,
             line=RGBColor(0xEC, 0xD7, 0xB4), lw=0.75,
             shape=MSO_SHAPE.ROUNDED_RECTANGLE, adj=0.16)
    put(t, [{"t": "Say this out loud: an acceptance with outstanding approvals is conditional "
                  "— it cannot release stock or create a billable order.",
             "sz": 11, "b": True, "c": AMBER}], anchor=MSO_ANCHOR.MIDDLE, ml=0.2)
    footer(s, n := n + 1)

    # ---------------------------------------------------------- 16 intelligence
    s = blank(prs)
    y = header(s, "INTELLIGENCE", "Recommendations and the assistant — with the brakes on")
    l = rect(s, M, y, (W - 2 * M - 0.3) / 2, 3.4, fill=WHITE, line=LINE, lw=0.75,
             shape=MSO_SHAPE.ROUNDED_RECTANGLE, adj=0.04)
    put(l, [
        {"t": "Recommendations", "sz": 14, "b": True, "c": GDARK},
        {"t": "No trained model", "sz": 10.5, "b": True, "c": GREEN, "sb": 3},
        {"t": "•  Cross-sell ranks on real confirmed-order co-purchases, promotion "
              "boost and contribution.", "sz": 10.5, "c": INK2, "sb": 4},
        {"t": "•  Upsell proposes variants inside an explicitly configured compatibility "
              "group.", "sz": 10.5, "c": INK2, "sb": 3},
        {"t": "•  Below five historical anchor orders it falls back to an explicitly "
              "labelled catalog result instead of inventing confidence.", "sz": 10.5,
         "c": INK2, "sb": 3},
        {"t": "•  Applying requires the exact current revision and row version, so a "
              "stale offer is rejected.", "sz": 10.5, "c": INK2, "sb": 3},
        {"t": "Dismissals persist for the revision; unsaved edits block recommendation "
              "mutations.", "sz": 10.5, "c": INK2, "sb": 3},
    ], ml=0.24, mr=0.24, mt=0.18)
    rx = M + (W - 2 * M - 0.3) / 2 + 0.3
    r = rect(s, rx, y, (W - 2 * M - 0.3) / 2, 3.4, fill=WHITE, line=LINE, lw=0.75,
             shape=MSO_SHAPE.ROUNDED_RECTANGLE, adj=0.04)
    put(r, [
        {"t": "Ask DealFlow assistant", "sz": 14, "b": True, "c": GDARK},
        {"t": "Server-scoped, read-only, no tools", "sz": 10.5, "b": True, "c": GREEN, "sb": 3},
        {"t": "•  The server decides identity and scope from the database; the browser "
              "cannot supply a role.", "sz": 10.5, "c": INK2, "sb": 4},
        {"t": "•  A customer's context excludes internal costs, margins, policy "
              "ceilings and review notes.", "sz": 10.5, "c": INK2, "sb": 3},
        {"t": "•  Plain-text answers. No executable tools. It cannot write to the "
              "database.", "sz": 10.5, "c": INK2, "sb": 3},
        {"t": "•  It never creates a counteroffer, grants a discount, or accepts a "
              "quotation.", "sz": 10.5, "c": INK2, "sb": 3},
        {"t": "•  Errors stay visible and retryable — there are no fake fallback "
              "answers.", "sz": 10.5, "c": INK2, "sb": 3},
    ], ml=0.24, mr=0.24, mt=0.18)
    t = rect(s, M, y + 3.62, W - 2 * M, 0.78, fill=GDARK,
             shape=MSO_SHAPE.ROUNDED_RECTANGLE, adj=0.12)
    put(t, [{"t": "The line we hold: AI explains the deal and routes questions. It does not "
                  "price it, approve it, reserve stock or send anything on your behalf.",
             "sz": 12, "b": True, "c": WHITE}], anchor=MSO_ANCHOR.MIDDLE,
        align=PP_ALIGN.CENTER, ml=0.25)
    footer(s, n := n + 1)

    # ---------------------------------------------------------- 17 verification
    s = blank(prs)
    y = header(s, "VERIFICATION", "Evidence, not adjectives")
    stats = [("112", "JUnit test methods", "across 20 test classes"),
             ("7", "Flyway migrations", "V1–V7, validated"),
             ("4", "Engines unit-tested", "pricing · risk · allocation · proration"),
             ("5", "Roles covered", "rep, manager, finance, admin, customer")]
    cw = (W - 2 * M - 3 * 0.22) / 4
    for i, (big, lab, sub) in enumerate(stats):
        cx = M + i * (cw + 0.22)
        c = rect(s, cx, y + 0.05, cw, 1.35, fill=MINT,
                 shape=MSO_SHAPE.ROUNDED_RECTANGLE, adj=0.08)
        put(c, [{"t": big, "sz": 30, "b": True, "c": GDARK},
                {"t": lab, "sz": 11.5, "b": True, "c": INK, "sb": 1},
                {"t": sub, "sz": 9.5, "c": MUTED}], anchor=MSO_ANCHOR.MIDDLE,
            align=PP_ALIGN.CENTER, ml=0.1, mr=0.1)
    cards(s, M, y + 1.62, W - 2 * M, 2.5, [
        {"t": "Concurrency", "d": "Two simultaneous acceptances produce one order. A last-unit "
                                  "race cannot oversell. Replayed idempotency keys return the "
                                  "original result."},
        {"t": "Billing lifecycle", "d": "A prorated adjustment is created once on replay; "
                                        "backdating is refused; cancellation credits by segment "
                                        "and never refunds unpaid money."},
        {"t": "Portal isolation", "d": "Another customer's quotation is inaccessible. A forged "
                                       "history role is rejected by the server, not the client."},
        {"t": "Browser journeys", "d": "Playwright covers recommendation application, review "
                                       "routing, handoff, provider errors, keyboard focus and "
                                       "320–1440px layouts, with axe a11y checks."},
    ], cols=2, gapx=0.22, gapy=0.2, num=False, fs=10.5, tfs=12)
    box(s, M, y + 4.28, W - 2 * M, 0.4,
        [{"t": "Counts above are measured from the source tree. Integration tests run against a "
               "real PostgreSQL via Testcontainers — a skipped Docker suite is not a pass.",
          "sz": 10.5, "c": MUTED}], ml=0)
    footer(s, n := n + 1)

    # ---------------------------------------------------------- 18 roadmap
    s = blank(prs)
    y = header(s, "WHAT WE'D BUILD NEXT", "Honest roadmap",
               "Deliberately cut to protect correctness — listed in priority order")
    cards(s, M, y + 0.05, W - 2 * M, 3.1, [
        {"t": "Deal Lab", "d": "Generate and evaluate up to three valid alternatives for a stuck "
                               "quote — approval-ready, margin-focused, delivery-focused "
                               "— using the same engines. Structured reasons already exist."},
        {"t": "Payment gateway", "d": "Payments and refunds are recorded receipts today. A real "
                                      "gateway is the obvious next integration."},
        {"t": "Cadence changes", "d": "Quantity changes and cancellation are exposed; switching "
                                      "monthly → yearly is not."},
        {"t": "Multi-currency & multi-company", "d": "Price records are currency-aware. The "
                                                    "hackathon runs in INR with no FX conversion."},
        {"t": "Distributed real time", "d": "The STOMP broker is in-process and single-instance. "
                                            "A second replica needs a broker relay first."},
        {"t": "Email transport", "d": "Sharing a quotation returns a portal path today; it does "
                                      "not send mail."},
    ], cols=3, gapx=0.22, gapy=0.22, fs=10.5, tfs=12)
    t = rect(s, M, y + 3.4, W - 2 * M, 0.72, fill=MINT,
             shape=MSO_SHAPE.ROUNDED_RECTANGLE, adj=0.13)
    put(t, [{"t": "Known gaps we will state before a judge finds them: no email transport, no "
                  "payment gateway, Deal Lab not implemented, single backend instance. All "
                  "documented in backend/README.md.", "sz": 11.5, "b": True, "c": GDARK}],
        anchor=MSO_ANCHOR.MIDDLE, ml=0.25)
    footer(s, n := n + 1)

    # ---------------------------------------------------------- 19 close
    s = blank(prs)
    rect(s, 0, 0, W, H, fill=GDARK)
    rect(s, 0, 0, 0.22, H, fill=GREEN)
    box(s, 1.0, 2.3, 11, 0.8, [{"t": "DealFlow360", "sz": 50, "b": True, "c": WHITE}], ml=0)
    box(s, 1.0, 3.2, 11.2, 1.0,
        [{"t": "Quote → Approval → Negotiation → Fulfilment → Billing → "
               "Reporting", "sz": 18, "c": RGBColor(0xD7, 0xE9, 0xE1)},
         {"t": "Real business logic, real transactions, real audit trail.",
          "sz": 14, "c": RGBColor(0x9F, 0xBE, 0xB3), "sb": 8}], ml=0)
    rect(s, 1.0, 4.45, 1.1, 0.045, fill=GREEN)
    box(s, 1.0, 4.9, 11, 0.4,
        [{"t": "Questions?", "sz": 22, "b": True, "c": WHITE}], ml=0)
    box(s, 1.0, 6.4, 11, 0.4,
        [{"t": "DealFlow360 · Odoo Hackathon · Team of 6", "sz": 11,
          "c": RGBColor(0x7E, 0xA0, 0x94)}], ml=0)
    return prs


# ---------------------------------------------------------------- UI mockups
def draw_mock(slide, x, y, w, h, url, nav, body):
    """Wireframe browser mock, drawn with shapes (no screenshot needed)."""
    win = rect(slide, x, y, w, h, fill=WHITE, line=LINE, lw=1.0,
               shape=MSO_SHAPE.ROUNDED_RECTANGLE, adj=0.025)
    # chrome
    rect(slide, x, y, w, 0.34, fill=RGBColor(0xF1, 0xF5, 0xF3),
         line=LINE, lw=0.75)
    for i, col in enumerate([RGBColor(0xE0, 0x6C, 0x5A), RGBColor(0xE6, 0xBB, 0x4E),
                             RGBColor(0x5F, 0xB0, 0x7A)]):
        rect(slide, x + 0.11 + i * 0.17, y + 0.115, 0.11, 0.11, fill=col,
             shape=MSO_SHAPE.OVAL)
    urlp = rect(slide, x + 0.62, y + 0.075, w - 0.95, 0.19, fill=WHITE,
                line=LINE, lw=0.75, shape=MSO_SHAPE.ROUNDED_RECTANGLE, adj=0.5)
    put(urlp, [{"t": url, "sz": 7.5, "c": MUTED}], anchor=MSO_ANCHOR.MIDDLE,
        align=PP_ALIGN.CENTER, ml=0.04)

    # sidebar
    sb_w = 1.25
    rect(slide, x, y + 0.34, sb_w, h - 0.34, fill=RGBColor(0xF7, 0xFA, 0xF8), line=None)
    rect(slide, x + sb_w, y + 0.34, 0.01, h - 0.34, fill=LINE)
    rect(slide, x + 0.14, y + 0.5, 0.5, 0.13, fill=GDARK,
         shape=MSO_SHAPE.ROUNDED_RECTANGLE, adj=0.5)
    cy = y + 0.78
    for i, item in enumerate(nav):
        fillc = MINT if i == 0 else None
        it = rect(slide, x + 0.1, cy, sb_w - 0.2, 0.24, fill=fillc,
                  shape=MSO_SHAPE.ROUNDED_RECTANGLE, adj=0.25)
        put(it, [{"t": item, "sz": 8, "c": GDARK if i == 0 else MUTED}],
            anchor=MSO_ANCHOR.MIDDLE, ml=0.1)
        cy += 0.3

    cx = x + sb_w + 0.22
    cw = w - sb_w - 0.42
    cy = y + 0.34 + 0.22

    if body == "builder":
        box(slide, cx, cy, 3.0, 0.26, [{"t": "Quotation #1042 · Beta Systems",
                                        "sz": 12, "b": True, "c": INK}], ml=0)
        for i, (lab, val) in enumerate([("Subtotal", "₹1,84,000"), ("Margin", "18.4%"),
                                        ("Approval", "Finance")]):
            kx = cx + i * (cw / 3)
            k = rect(slide, kx, cy + 0.4, cw / 3 - 0.16, 0.5, fill=MINT2, line=LINE,
                     lw=0.75, shape=MSO_SHAPE.ROUNDED_RECTANGLE, adj=0.12)
            put(k, [{"t": lab, "sz": 7.5, "c": MUTED},
                    {"t": val, "sz": 11, "b": True, "c": GDARK, "sb": 1}],
                anchor=MSO_ANCHOR.MIDDLE, ml=0.1)
        cy += 1.05
        rect(slide, cx, cy, cw, 0.22, fill=RGBColor(0xEF, 0xF4, 0xF1))
        for j, hd in enumerate(["Product", "Qty", "Price", "Disc", "Total"]):
            box(slide, cx + j * (cw / 5), cy, cw / 5, 0.22,
                [{"t": hd, "sz": 8, "b": True, "c": MUTED}], anchor=MSO_ANCHOR.MIDDLE, ml=0.06)
        rows = [("Laptop Pro 14", "5", "₹92,000", "12%", "₹4,04,800"),
                ("Docking Station", "5", "₹18,500", "10%", "₹83,250"),
                ("Setup Service", "1", "₹35,000", "18%", "₹28,700"),
                ("Support Plan (mo)", "1", "₹3,000", "—", "₹3,000/mo")]
        cy += 0.22
        for r in rows:
            rect(slide, cx, cy, cw, 0.26, fill=WHITE, line=LINE, lw=0.5)
            for j, v in enumerate(r):
                box(slide, cx + j * (cw / 5), cy, cw / 5, 0.26,
                    [{"t": v, "sz": 8,
                      "c": RED if (j == 3 and "%" in v and v != "—" and int(v[:-1]) >= 18)
                      else INK2}], anchor=MSO_ANCHOR.MIDDLE, ml=0.06)
            cy += 0.26
        # recommendation card
        rc = rect(slide, cx, cy + 0.16, cw, 0.72, fill=MINT, line=GREEN, lw=0.75,
                  shape=MSO_SHAPE.ROUNDED_RECTANGLE, adj=0.14)
        put(rc, [{"t": "RECOMMENDED", "sz": 7, "b": True, "c": GREEN},
                 {"t": "Add USB-C Monitor — appeared in 4 of 6 similar orders",
                  "sz": 9.5, "b": True, "c": INK, "sb": 1},
                 {"t": "Margin +1.8pp  ·  In stock: Main 12  ·  No new approval",
                  "sz": 8, "c": INK2, "sb": 1}], ml=0.14)

    elif body == "approval":
        box(slide, cx, cy, 3.2, 0.24, [{"t": "Pending approvals", "sz": 11.5, "b": True,
                                        "c": INK}], ml=0)
        cy += 0.36
        a = rect(slide, cx, cy, cw, 0.62, fill=MINT, line=GREEN, lw=0.75,
                 shape=MSO_SHAPE.ROUNDED_RECTANGLE, adj=0.14)
        put(a, [{"t": "Beta Systems · ₹5,19,750", "sz": 10, "b": True, "c": INK},
                {"t": "Blended risk: Finance required", "sz": 8.5, "c": GREEN, "sb": 1},
                {"t": "Setup Service discount 18% vs 10% ceiling → 8pp over",
                 "sz": 8, "c": INK2}], ml=0.14, mt=0.1)
        cy += 0.74
        for t_, c_ in [("Acme Corp · ₹92,000 · No approval needed", MINT2),
                       ("Gamma Ltd · ₹3,10,000 · Awaiting Manager", MINT2)]:
            r_ = rect(slide, cx, cy, cw, 0.44, fill=c_, line=LINE, lw=0.75,
                      shape=MSO_SHAPE.ROUNDED_RECTANGLE, adj=0.18)
            put(r_, [{"t": t_, "sz": 8.5, "c": INK2}], anchor=MSO_ANCHOR.MIDDLE, ml=0.14)
            cy += 0.5
        cy += 0.08
        for i, (lab, fillc, tc) in enumerate([("Approve", GREEN, WHITE),
                                              ("Return", WHITE, INK),
                                              ("Reject", WHITE, RED)]):
            b = rect(slide, cx + i * 0.86, cy, 0.78, 0.28, fill=fillc,
                     line=LINE if fillc == WHITE else None, lw=0.75,
                     shape=MSO_SHAPE.ROUNDED_RECTANGLE, adj=0.3)
            put(b, [{"t": lab, "sz": 8.5, "b": True, "c": tc}],
                anchor=MSO_ANCHOR.MIDDLE, align=PP_ALIGN.CENTER, ml=0.02)

    elif body == "portal":
        box(slide, cx, cy, 3.2, 0.24, [{"t": "Your quotation #1042", "sz": 11.5, "b": True,
                                        "c": INK}], ml=0)
        cy += 0.34
        b = rect(slide, cx, cy, cw, 0.34, fill=AMBER_BG, line=RGBColor(0xEC, 0xD7, 0xB4),
                 lw=0.75, shape=MSO_SHAPE.ROUNDED_RECTANGLE, adj=0.4)
        put(b, [{"t": "Pending internal approval — you can still comment", "sz": 8.5,
                 "b": True, "c": AMBER}], anchor=MSO_ANCHOR.MIDDLE, ml=0.12)
        cy += 0.46
        for r in [("Laptop Pro 14", "5", "₹92,000"),
                  ("Docking Station", "5", "₹18,500"),
                  ("Setup Service", "1", "₹35,000")]:
            rect(slide, cx, cy, cw, 0.3, fill=WHITE, line=LINE, lw=0.5)
            for j, v in enumerate(r):
                box(slide, cx + j * (cw / 3), cy, cw / 3, 0.3, [{"t": v, "sz": 8.5,
                                                                 "c": INK2}],
                    anchor=MSO_ANCHOR.MIDDLE, ml=0.08)
            cy += 0.3
        cy += 0.12
        box(slide, cx, cy, cw, 0.2, [{"t": "Your prices only — no cost or margin shown",
                                      "sz": 7.5, "b": True, "c": GREEN}], ml=0)
        cy += 0.28
        b2 = rect(slide, cx, cy, cw * 0.5 - 0.06, 0.3, fill=GDARK,
                  shape=MSO_SHAPE.ROUNDED_RECTANGLE, adj=0.3)
        put(b2, [{"t": "Request 22% on Setup", "sz": 8.5, "b": True, "c": WHITE}],
            anchor=MSO_ANCHOR.MIDDLE, align=PP_ALIGN.CENTER, ml=0.02)
        b3 = rect(slide, cx + cw * 0.5 + 0.06, cy, cw * 0.5 - 0.06, 0.3, fill=GREEN,
                  shape=MSO_SHAPE.ROUNDED_RECTANGLE, adj=0.3)
        put(b3, [{"t": "Accept terms shown", "sz": 8.5, "b": True, "c": WHITE}],
            anchor=MSO_ANCHOR.MIDDLE, align=PP_ALIGN.CENTER, ml=0.02)
    return win


# ---------------------------------------------------------------- main
def main():
    prs = Presentation()
    prs.slide_width = Inches(W)
    prs.slide_height = Inches(H)
    build(prs)
    out = os.path.join(ROOT, "ppts", "DealFlow360.pptx")
    src = out
    if os.path.exists(out):
        bak = os.path.join(ROOT, "ppts", "DealFlow360_stock_template_backup.pptx")
        if not os.path.exists(bak):
            os.replace(out, bak)
    prs.save(out)
    print("wrote", out, "slides:", len(prs.slides.__iter__.__self__._sldIdLst))


if __name__ == "__main__":
    main()
