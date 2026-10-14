"""Sales report exporters — ports PdfReportExporter + SpreadsheetReportExporter.

Both render the same SalesReport dict the screen shows, so the numbers on
paper are the numbers on screen. Generation time and currency are printed on
the page: a report is a snapshot, never live data.
"""

from __future__ import annotations

import io
import re
from typing import Any

_NON_WINANSI = re.compile(r"[^\x20-\x7E]")


def _safe(text: Any) -> str:
    # Standard PDF fonts cover WinAnsi only; anything else is replaced
    # rather than crashing the export.
    return _NON_WINANSI.sub("?", "" if text is None else str(text))


def _plain(amount: Any) -> str:
    return "-" if amount is None else str(amount)


def _pad(value: Any, width: int) -> str:
    safe = "" if value is None else str(value)
    if len(safe) >= width:
        return safe[: max(0, width - 1)] + " "
    return safe + " " * (width - len(safe))


def sales_pdf(report: dict[str, Any]) -> bytes:
    """Render the sales report as a real PDF (reportlab). Starts with %PDF-."""
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    doc = canvas.Canvas(buf, pagesize=A4)
    width, height = A4
    margin, line = 40.0, 14.0
    y = height - margin

    def ensure_room() -> None:
        nonlocal y
        if y < margin + line:
            doc.showPage()
            doc.setFont("Courier", 9)
            y = height - margin

    def write(text: str, font: str = "Courier", size: float = 9) -> None:
        nonlocal y
        ensure_room()
        doc.setFont(font, size)
        doc.drawString(margin, y, _safe(text)[:110])
        y -= line

    def heading(text: str) -> None:
        nonlocal y
        ensure_room()
        doc.setFont("Helvetica-Bold", 16)
        doc.drawString(margin, y, _safe(text)[:110])
        y -= line * 1.6

    def subheading(text: str) -> None:
        nonlocal y
        ensure_room()
        doc.setFont("Helvetica-Bold", 11)
        doc.drawString(margin, y, _safe(text)[:110])
        y -= line * 1.2

    currency = report.get("currency", "INR")
    flt = report.get("filter", {})
    heading("DealFlow360 - Sales report")
    write(f"Generated {report.get('generatedAt')} - Currency {currency} - "
          f"Period {flt.get('from')} to {flt.get('to')}")
    y -= line * 0.6

    def money(amount: Any) -> str:
        return f"{currency} {_plain(amount)}"

    subheading("Headline figures (reported separately, never summed)")
    write(f"One-time sales:        {money(report.get('oneTimeSales'))}")
    write(f"Monthly recurring:     {money(report.get('monthlyRecurringRevenue'))}"
          "  (normalised, not an invoice amount)")
    write(f"Invoiced revenue:      {money(report.get('invoicedRevenue'))}")
    write(f"Cash collected:        {money(report.get('cashCollected'))}")
    write(f"Outstanding:           {money(report.get('outstandingReceivables'))}")
    write(f"Quotations {report.get('quotationCount')} - Orders {report.get('orderCount')}"
          f" - Invoices {report.get('invoiceCount')} - Payments {report.get('paymentCount')}")
    y -= line * 0.6

    subheading("Pipeline by stage")
    for stage in report.get("pipeline", []):
        write(_pad(stage.get("stage"), 22) + _pad(stage.get("count"), 8)
              + money(stage.get("oneTimeNet")))
    y -= line * 0.6

    subheading("By sales rep")
    write(_pad("Rep", 26) + _pad("Quotes", 8) + _pad("Orders", 8)
          + _pad("One-time", 16) + _pad("MRR", 14) + "Avg disc %")
    for row in report.get("byRep", []):
        write(_pad(row.get("ownerName"), 26) + _pad(row.get("quotations"), 8)
              + _pad(row.get("orders"), 8) + _pad(_plain(row.get("oneTimeSales")), 16)
              + _pad(_plain(row.get("monthlyRecurringRevenue")), 14)
              + ("" if row.get("averageDiscountPercent") is None
                 else _plain(row.get("averageDiscountPercent"))))
    y -= line * 0.6

    subheading("By category")
    write(_pad("Category", 18) + _pad("One-time", 16) + _pad("Recurring", 16)
          + _pad("Contribution", 16) + "Margin %")
    for row in report.get("byCategory", []):
        write(_pad(row.get("categoryCode"), 18) + _pad(_plain(row.get("oneTimeSales")), 16)
              + _pad(_plain(row.get("recurringFirstCycle")), 16)
              + _pad(_plain(row.get("contribution")), 16)
              + ("n/a" if row.get("contributionPercent") is None
                 else _plain(row.get("contributionPercent"))))
    y -= line * 0.6

    quotations = report.get("quotations", [])
    subheading(f"Quotations in period ({len(quotations)})")
    write(_pad("Reference", 12) + _pad("Customer", 22) + _pad("Stage", 18)
          + _pad("Approval", 16) + "One-time")
    for row in quotations:
        write(_pad(row.get("reference"), 12) + _pad(row.get("customerName"), 22)
              + _pad(row.get("stage"), 18) + _pad(row.get("approvalStatus"), 16)
              + _plain(row.get("oneTimeNet")))

    doc.save()
    return buf.getvalue()


def sales_xlsx(report: dict[str, Any]) -> bytes:
    """Render the sales report as a genuine XLSX workbook (openpyxl).

    Money is written as numeric cells with two decimals so the sheet can be
    summed and filtered; it is never written as text.
    """
    from openpyxl import Workbook
    from openpyxl.styles import Font

    workbook = Workbook()
    bold = Font(bold=True)
    money_format = "#,##0.00"
    flt = report.get("filter", {})

    summary = workbook.active
    summary.title = "Summary"
    summary.append(["DealFlow360 - Sales report"])
    summary["A1"].font = bold
    summary.append(["Generated", _safe(report.get("generatedAt"))])
    summary.append(["Currency", report.get("currency")])
    summary.append(["Period from", flt.get("from")])
    summary.append(["Period to", flt.get("to")])
    summary.append([])
    summary.append(["Figures are reported separately and are not additive"])
    summary.append(["One-time sales", _number(report.get("oneTimeSales"))])
    summary.append(["Monthly recurring revenue (normalised)",
                    _number(report.get("monthlyRecurringRevenue"))])
    summary.append(["Invoiced revenue", _number(report.get("invoicedRevenue"))])
    summary.append(["Cash collected", _number(report.get("cashCollected"))])
    summary.append(["Outstanding receivables",
                    _number(report.get("outstandingReceivables"))])
    summary.append([])
    summary.append(["Pipeline by stage"])
    for stage in report.get("pipeline", []):
        summary.append([stage.get("stage"), stage.get("count"),
                        _number(stage.get("oneTimeNet"))])
    for row in summary.iter_rows():
        for cell in row:
            if isinstance(cell.value, (int, float)) and cell.column > 1:
                cell.number_format = money_format
    summary.column_dimensions["A"].width = 42
    summary.column_dimensions["B"].width = 24
    summary.column_dimensions["C"].width = 20

    _table_sheet(
        workbook, "By rep", bold, money_format,
        ["Rep", "Quotations", "Orders", "One-time sales", "MRR", "Avg discount %"],
        [[r.get("ownerName"), r.get("quotations"), r.get("orders"),
          _number(r.get("oneTimeSales")), _number(r.get("monthlyRecurringRevenue")),
          _number(r.get("averageDiscountPercent"))]
         for r in report.get("byRep", [])],
    )
    _table_sheet(
        workbook, "By category", bold, money_format,
        ["Category", "Name", "One-time", "Recurring first cycle", "Contribution",
         "Contribution %", "Lines"],
        [[r.get("categoryCode"), r.get("categoryName"),
          _number(r.get("oneTimeSales")), _number(r.get("recurringFirstCycle")),
          _number(r.get("contribution")), _number(r.get("contributionPercent")),
          r.get("lines")]
         for r in report.get("byCategory", [])],
    )
    _table_sheet(
        workbook, "Top products", bold, money_format,
        ["Code", "Product", "Quantity", "Net", "Orders"],
        [[r.get("productCode"), r.get("productName"),
          _number(r.get("quantity")), _number(r.get("net")), r.get("orders")]
         for r in report.get("topProducts", [])],
    )
    _table_sheet(
        workbook, "Quotations", bold, money_format,
        ["Reference", "Customer", "Rep", "Stage", "Approval", "Currency",
         "One-time net", "Recurring first cycle", "Contribution %", "Created"],
        [[r.get("reference"), r.get("customerName"), r.get("ownerName"),
          r.get("stage"), r.get("approvalStatus"), r.get("currency"),
          _number(r.get("oneTimeNet")), _number(r.get("recurringFirstCycleNet")),
          _number(r.get("contributionPercent")), r.get("createdOn")]
         for r in report.get("quotations", [])],
    )

    buf = io.BytesIO()
    workbook.save(buf)
    return buf.getvalue()


def _number(value: Any) -> int | float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _table_sheet(workbook, name: str, bold, money_format: str,
                 headers: list[str], rows: list[list]) -> None:
    sheet = workbook.create_sheet(name)
    sheet.append(headers)
    for cell in sheet[1]:
        cell.font = bold
    for values in rows:
        sheet.append([None if v is None else v for v in values])
    for row in list(sheet.iter_rows(min_row=2)):
        for cell in row:
            if isinstance(cell.value, float):
                cell.number_format = money_format
    for column in sheet.columns:
        sheet.column_dimensions[column[0].column_letter].width = 22
