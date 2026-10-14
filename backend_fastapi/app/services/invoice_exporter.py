"""Invoice document exporter — port of billing/service/InvoiceDocumentExporter."""

from __future__ import annotations

import html
import io
from decimal import Decimal
from typing import Any


def _money(amount: Decimal | None, currency: str) -> str:
    if amount is None:
        return f"0.00 {currency}"
    q = Decimal(amount).quantize(Decimal("0.00"))
    return f"{q} {currency}"


def export_invoice_pdf(invoice: dict, lines: list[dict], customer: Any) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib import colors
    from reportlab.lib.units import mm

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm)
    styles = getSampleStyleSheet()
    story = []
    ref = invoice.get("reference", "")
    status = invoice.get("status", "")
    currency = invoice.get("currency", "INR")
    cust_name = _customer_name(invoice, customer)

    story.append(Paragraph("DealFlow360 Enterprise Deals Inc.", styles["Heading1"]))
    story.append(Paragraph("Cyber Gateway, Technology Boulevard, Bengaluru, KA 560066 | GSTIN: 29AABCB1234F1Z5", styles["Normal"]))
    story.append(Paragraph("Tax Invoice / Commercial Settlement Statement", styles["Heading3"]))
    story.append(Spacer(1, 6))
    story.append(Paragraph(f"Invoice Reference: {html.escape(str(ref))} [{html.escape(str(status))}]", styles["Heading2"]))
    story.append(Paragraph(f"Issue Date: {invoice.get('issueDate')}", styles["Normal"]))
    story.append(Paragraph(f"Due Date: {invoice.get('dueDate')}", styles["Normal"]))
    story.append(Paragraph(f"Currency: {currency} ({invoice.get('invoiceKind')})", styles["Normal"]))
    story.append(Paragraph(f"Customer: {html.escape(str(cust_name))}", styles["Normal"]))
    if invoice.get("orderId"):
        story.append(Paragraph(f"Order ID: {invoice.get('orderId')}", styles["Normal"]))
    if invoice.get("subscriptionId"):
        story.append(Paragraph(f"Subscription ID: {invoice.get('subscriptionId')}", styles["Normal"]))
    story.append(Spacer(1, 6))
    story.append(Paragraph("Itemized Charges", styles["Heading2"]))
    data = [["Item Description", "Qty", "Rate", "Tax", "Net Amount"]]
    for ln in lines:
        desc = str(ln.get("description") or "Charge line")[:36]
        data.append([
            desc,
            str(ln.get("quantity") or "1"),
            _money(ln.get("unitPrice"), currency),
            _money(ln.get("tax"), currency),
            _money(ln.get("net"), currency),
        ])
    if len(data) == 1:
        data.append(["No itemized lines recorded.", "", "", "", ""])
    table = Table(data, repeatRows=1)
    table.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey),
    ]))
    story.append(table)
    story.append(Spacer(1, 6))
    story.append(Paragraph("Financial Reconciliation", styles["Heading2"]))
    story.append(Paragraph(f"Subtotal Net: {_money(invoice.get('net'), currency)}", styles["Normal"]))
    story.append(Paragraph(f"Taxes (GST/VAT): {_money(invoice.get('tax'), currency)}", styles["Normal"]))
    story.append(Paragraph(f"Total Invoice: {_money(invoice.get('total'), currency)}", styles["Normal"]))
    story.append(Paragraph(f"Credits Applied: {_money(invoice.get('credited'), currency)}", styles["Normal"]))
    story.append(Paragraph(f"Paid Amount: {_money(invoice.get('paid'), currency)}", styles["Normal"]))
    story.append(Paragraph(f"Balance Due: {_money(invoice.get('outstanding'), currency)}", styles["Normal"]))
    story.append(Spacer(1, 6))
    story.append(Paragraph("Wire Remittance & Settlement Instructions", styles["Heading2"]))
    story.append(Paragraph("Bank Name: HDFC Bank Corporate Banking", styles["Normal"]))
    story.append(Paragraph("Account Number: 50200098765432", styles["Normal"]))
    story.append(Paragraph("IFSC / Code: HDFC0000123", styles["Normal"]))
    story.append(Paragraph("SWIFT Code: HDFCINBBXXX", styles["Normal"]))
    story.append(Paragraph(f"Payment Note: Quote invoice ref {ref} in wire transfer description.", styles["Normal"]))
    story.append(Spacer(1, 6))
    story.append(Paragraph("Thank you for your business. For billing queries: billing@dealflow.corp", styles["Normal"]))
    doc.build(story)
    return buf.getvalue()


def export_invoice_xlsx(invoice: dict, lines: list[dict], customer: Any) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Font

    wb = Workbook()
    ws = wb.active
    ws.title = f"Invoice {invoice.get('reference', '')}"[:31]
    currency = invoice.get("currency", "INR")
    cust_name = _customer_name(invoice, customer)
    bold = Font(bold=True)
    title_font = Font(bold=True, size=14)

    ws["A1"] = f"DealFlow360 — Tax Invoice {invoice.get('reference', '')}"
    ws["A1"].font = title_font
    meta = [
        ("Invoice Reference", str(invoice.get("reference", ""))),
        ("Status", str(invoice.get("status", ""))),
        ("Customer", str(cust_name)),
        ("Issue Date", str(invoice.get("issueDate") or "")),
        ("Due Date", str(invoice.get("dueDate") or "")),
        ("Currency", str(currency)),
    ]
    r = 3
    for label, val in meta:
        ws.cell(row=r, column=1, value=label).font = bold
        ws.cell(row=r, column=2, value=val)
        r += 1
    r += 1
    headers = ["#", "Description", "Type", "Coverage Start", "Coverage End", "Qty", f"Unit Rate ({currency})", f"Tax ({currency})", f"Net Amount ({currency})"]
    for i, h in enumerate(headers, start=1):
        c = ws.cell(row=r, column=i, value=h)
        c.font = bold
    r += 1
    n = 1
    for ln in lines:
        ws.cell(row=r, column=1, value=n)
        ws.cell(row=r, column=2, value=str(ln.get("description") or ""))
        ws.cell(row=r, column=3, value=str(ln.get("lineType") or ""))
        ws.cell(row=r, column=4, value=str(ln.get("coverageStart") or ""))
        ws.cell(row=r, column=5, value=str(ln.get("coverageEnd") or ""))
        try:
            ws.cell(row=r, column=6, value=float(ln.get("quantity") or 0))
        except (TypeError, ValueError):
            ws.cell(row=r, column=6, value=str(ln.get("quantity") or ""))
        for col, key in ((7, "unitPrice"), (8, "tax"), (9, "net")):
            v = ln.get(key)
            try:
                ws.cell(row=r, column=col, value=float(v) if v is not None else 0.0).number_format = "#,##0.00"
            except (TypeError, ValueError):
                ws.cell(row=r, column=col, value=str(v or ""))
        n += 1
        r += 1
    r += 1
    totals = [
        ("Subtotal Net:", invoice.get("net")),
        ("Taxes (GST/VAT):", invoice.get("tax")),
        ("Total Invoice Amount:", invoice.get("total")),
        ("Credits Applied:", invoice.get("credited")),
        ("Amount Paid:", invoice.get("paid")),
        ("Balance Due / Outstanding:", invoice.get("outstanding")),
    ]
    for label, val in totals:
        ws.cell(row=r, column=7, value=label).font = bold
        try:
            ws.cell(row=r, column=9, value=float(val) if val is not None else 0.0).number_format = "#,##0.00"
        except (TypeError, ValueError):
            ws.cell(row=r, column=9, value=str(val or ""))
        r += 1
    r += 1
    ws.cell(row=r, column=1, value="Wire Instructions").font = bold
    ws.cell(row=r, column=2, value="HDFC Bank Corp | A/C: 50200098765432 | IFSC: HDFC0000123")
    r += 1
    ws.cell(row=r, column=1, value="Payment Reference").font = bold
    ws.cell(row=r, column=2, value=f"Please cite invoice reference {invoice.get('reference', '')}")
    for col in range(1, 10):
        ws.column_dimensions[ws.cell(row=1, column=col).column_letter].width = 22
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def export_invoice_doc(invoice: dict, lines: list[dict], customer: Any) -> bytes:
    ref = html.escape(str(invoice.get("reference", "")))
    status = html.escape(str(invoice.get("status", "")))
    currency = html.escape(str(invoice.get("currency", "INR")))
    cust_name = html.escape(str(_customer_name(invoice, customer)))
    parts = [
        "<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>",
        f"<head><meta charset='utf-8'><title>Invoice {ref}</title>",
        "<style>body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10pt; color: #1e293b; margin: 30px; }"
        "h1 { font-size: 18pt; } table { width: 100%; border-collapse: collapse; } th, td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; }</style></head><body>",
        "<h1>DealFlow360 Enterprise Deals Inc.</h1>",
        "<div>Cyber Gateway, Bengaluru, KA 560066 | GSTIN: 29AABCB1234F1Z5 | billing@dealflow.corp</div>",
        f"<p><strong>Billed To:</strong> {cust_name}</p>",
        f"<p><span style='font-size:14pt; font-weight:bold;'>TAX INVOICE {ref}</span><br/>",
        f"Status: {status}<br/>Issue Date: {invoice.get('issueDate')}<br/>Due Date: {invoice.get('dueDate')}<br/>Currency: {currency}</p>",
        "<table><thead><tr><th>Description</th><th>Type</th><th>Qty</th><th>Unit Rate</th><th>Tax</th><th>Net Total</th></tr></thead><tbody>",
    ]
    for ln in lines:
        parts.append(
            "<tr><td><strong>" + html.escape(str(ln.get("description") or "")) + "</strong></td>"
            "<td>" + html.escape(str(ln.get("lineType") or "")) + "</td>"
            f"<td>{html.escape(str(ln.get('quantity') or '1'))}</td>"
            f"<td>{html.escape(_money(ln.get('unitPrice'), str(invoice.get('currency', 'INR'))))}</td>"
            f"<td>{html.escape(_money(ln.get('tax'), str(invoice.get('currency', 'INR'))))}</td>"
            f"<td><strong>{html.escape(_money(ln.get('net'), str(invoice.get('currency', 'INR'))))}</strong></td></tr>"
        )
    parts.append("</tbody></table>")
    cur = str(invoice.get("currency", "INR"))
    parts.append("<table>")
    for label, key in [("Subtotal Net:", "net"), ("Tax (GST/VAT):", "tax"), ("Total Invoice Amount:", "total"), ("Credits Applied:", "credited"), ("Paid Amount:", "paid"), ("Balance Due / Outstanding:", "outstanding")]:
        parts.append(f"<tr><td>{label}</td><td>{html.escape(_money(invoice.get(key), cur))}</td></tr>")
    parts.append("</table>")
    parts.append(
        "<div><strong>Wire Remittance Instructions:</strong> HDFC Bank Corp | A/C: 50200098765432 | IFSC: HDFC0000123 | SWIFT: HDFCINBBXXX<br/>"
        f"Please quote reference <strong>{ref}</strong> on all wire remittances.<br/>"
        "This is a computer-generated tax invoice and requires no physical signature.</div></body></html>"
    )
    return "".join(parts).encode("utf-8")


# Backwards-compatible aliases used by routers/tests.
def invoice_pdf(invoice: dict, lines: list[dict], customer: Any) -> bytes:
    return export_invoice_pdf(invoice, lines, customer)


def invoice_xlsx(invoice: dict, lines: list[dict], customer: Any) -> bytes:
    return export_invoice_xlsx(invoice, lines, customer)


def invoice_doc(invoice: dict, lines: list[dict], customer: Any) -> bytes:
    return export_invoice_doc(invoice, lines, customer)


def _customer_name(invoice: dict, customer: Any) -> str:
    if isinstance(customer, dict):
        return str(customer.get("name") or invoice.get("customerName") or invoice.get("customerId") or "")
    name = getattr(customer, "name", None)
    if name:
        return str(name)
    return str(invoice.get("customerName") or invoice.get("customerId") or "")
