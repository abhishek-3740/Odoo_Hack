from pathlib import Path
import re
import math
import textwrap
from xml.sax.saxutils import escape
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, PageBreak,
    LongTable, TableStyle, Preformatted, Flowable, KeepTogether
)
from reportlab.platypus.tableofcontents import TableOfContents
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

ROOT = Path(__file__).resolve().parents[1]
NAVY = colors.HexColor('#12263A')
TEAL = colors.HexColor('#087F8C')
INK = colors.HexColor('#243748')
MUTED = colors.HexColor('#617587')
PALE = colors.HexColor('#EDF5F7')
LINE = colors.HexColor('#D6E3E8')

for name, filename in [('Body', 'arial.ttf'), ('BodyBold', 'arialbd.ttf'),
                       ('BodyItalic', 'ariali.ttf'), ('Mono', 'consola.ttf')]:
    pdfmetrics.registerFont(TTFont(name, str(Path('C:/Windows/Fonts') / filename)))
pdfmetrics.registerFontFamily('Body', normal='Body', bold='BodyBold', italic='BodyItalic', boldItalic='BodyBold')

STYLE = {
    'body': ParagraphStyle('body', fontName='Body', fontSize=9.6, leading=14, textColor=INK, spaceAfter=7),
    'h1': ParagraphStyle('h1', fontName='BodyBold', fontSize=16, leading=21, textColor=NAVY, spaceBefore=17, spaceAfter=10, keepWithNext=True),
    'h2': ParagraphStyle('h2', fontName='BodyBold', fontSize=11.6, leading=16, textColor=TEAL, spaceBefore=13, spaceAfter=7, keepWithNext=True),
    'bullet': ParagraphStyle('bullet', fontName='Body', fontSize=9.6, leading=14, textColor=INK, leftIndent=12, firstLineIndent=-9, spaceAfter=5),
    'cell': ParagraphStyle('cell', fontName='Body', fontSize=8.3, leading=11.5, textColor=INK, splitLongWords=True),
    'cellhead': ParagraphStyle('cellhead', fontName='BodyBold', fontSize=8.3, leading=11.5, textColor=colors.white),
    'code': ParagraphStyle('code', fontName='Mono', fontSize=7.4, leading=10.4, textColor=INK, backColor=PALE, borderPadding=8, spaceAfter=10),
    'cover': ParagraphStyle('cover', fontName='BodyBold', fontSize=34, leading=41, textColor=NAVY, spaceAfter=20),
    'subtitle': ParagraphStyle('subtitle', fontName='Body', fontSize=18, leading=25, textColor=TEAL, spaceAfter=20),
    'lead': ParagraphStyle('lead', fontName='Body', fontSize=12.5, leading=19, textColor=INK, spaceAfter=17),
    'small': ParagraphStyle('small', fontName='Body', fontSize=8.4, leading=12, textColor=MUTED, spaceAfter=8),
}

def inline(raw):
    links = []
    def save_link(m):
        links.append((m.group(1), m.group(2)))
        return f'LINKTOKEN{len(links)-1}END'
    raw = re.sub(r'\[([^\]]+)\]\((https?://[^)]+)\)', save_link, raw)
    out = escape(raw)
    out = re.sub(r'`([^`]+)`', r'<font name="Mono" size="8.5">\1</font>', out)
    out = re.sub(r'\*\*([^*]+)\*\*', r'<b>\1</b>', out)
    for i, (label, url) in enumerate(links):
        out = out.replace(f'LINKTOKEN{i}END', f'<link href="{escape(url, {chr(34): "&quot;"})}" color="#087F8C">{escape(label)}</link>')
    return out

def split_cells(line):
    result, cur, in_code = [], '', False
    for ch in line.strip().strip('|'):
        if ch == '`':
            in_code = not in_code
        if ch == '|' and not in_code:
            result.append(cur.strip()); cur = ''
        else:
            cur += ch
    result.append(cur.strip())
    return result

def draw_arrow(c, x1, y1, x2, y2, color=TEAL):
    c.setStrokeColor(color); c.setFillColor(color); c.setLineWidth(1.1)
    c.line(x1, y1, x2, y2)
    angle = math.atan2(y2-y1, x2-x1)
    p = c.beginPath(); p.moveTo(x2, y2)
    for s in [-1, 1]:
        p.lineTo(x2-6*math.cos(angle)+s*2.7*math.sin(angle), y2-6*math.sin(angle)-s*2.7*math.cos(angle))
    p.close(); c.drawPath(p, stroke=0, fill=1)

def box(c, x, y, w, h, title, detail='', dark=False, size=10):
    c.setFillColor(NAVY if dark else PALE); c.setStrokeColor(LINE)
    c.roundRect(x, y, w, h, 7, stroke=not dark, fill=1)
    c.setFillColor(colors.white if dark else NAVY); c.setFont('BodyBold', size)
    c.drawString(x+10, y+h-17, title)
    c.setFont('Body', size-1.5)
    for k, line in enumerate(detail.split('\n')):
        c.drawString(x+10, y+h-31-11*k, line)

class ArchitectureFlow(Flowable):
    def __init__(self):
        super().__init__(); self.width=490; self.height=158
    def draw(self):
        c=self.canv
        for x, title, detail in [(0,'Next.js workspace','REST + private WS updates'),(168,'Customer portal','Authenticated, scoped views'),(336,'Spring jobs / outbox','Billing / committed events')]:
            box(c,x,111,154,43,title,detail,size=9)
            draw_arrow(c,x+77,111,x+77,92)
        box(c,0,50,490,42,'Spring Boot + Security + modular Java services','Pricing • Approval • Recommendations • Allocation • Billing',dark=True,size=10)
        draw_arrow(c,245,50,245,35)
        box(c,65,0,360,34,'PostgreSQL / JPA — versions, locks, audit and outbox',size=9)

class Doc(BaseDocTemplate):
    def __init__(self, path, label):
        super().__init__(str(path), pagesize=A4, leftMargin=43, rightMargin=43,
                         topMargin=48, bottomMargin=42, title=f'DealFlow360 — {label}', author='DealFlow360 Team Planning')
        self.label=label; self.hcount=0
        frame=Frame(self.leftMargin,self.bottomMargin,self.width,self.height,id='body',leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0)
        self.addPageTemplates([PageTemplate(id='normal',frames=[frame],onPage=self.decorate)])
    def beforeDocument(self):
        self.hcount=0
    def decorate(self,c,doc):
        w,h=A4
        c.setFillColor(TEAL); c.rect(0,h-7,w,7,stroke=0,fill=1)
        if doc.page>1:
            c.setFont('BodyBold',8); c.setFillColor(NAVY); c.drawString(43,h-28,'DEALFLOW360')
            c.setFont('Body',8); c.setFillColor(MUTED); c.drawRightString(w-43,h-28,self.label)
        c.setStrokeColor(LINE); c.line(43,31,w-43,31)
        c.setFont('Body',7.6); c.setFillColor(MUTED)
        c.drawString(43,19,'Revision 2 • 05 September 2026 • Spring Boot / 23 edge cases')
        c.drawRightString(w-43,19,str(doc.page))
    def afterFlowable(self,flowable):
        if isinstance(flowable,Paragraph) and flowable.style.name in ('h1','h2'):
            text=flowable.getPlainText()
            if text=='Contents': return
            level=0 if flowable.style.name=='h1' else 1
            key=f'section-{self.hcount}'; self.hcount+=1
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(text,key,level=level,closed=False)
            if level==0:
                self.notify('TOCEntry',(level,text,self.page,key))

def render_markdown(path, label, intro, cards):
    doc=Doc(path.with_suffix('.pdf'),label)
    story=[Spacer(1,65),Paragraph('DEALFLOW360',STYLE['small']),Paragraph(label,STYLE['cover']),
           Paragraph('Four people. One day. One connected sales workflow.',STYLE['subtitle']),
           Paragraph(intro,STYLE['lead']),Spacer(1,14)]
    rows=[[Paragraph('<b>'+escape(a)+'</b>',STYLE['cell']),Paragraph(escape(b),STYLE['cell'])] for a,b in cards]
    t=LongTable(rows,colWidths=[132,doc.width-132],hAlign='LEFT')
    t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),PALE),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),12),('RIGHTPADDING',(0,0),(-1,-1),12),('TOPPADDING',(0,0),(-1,-1),11),('BOTTOMPADDING',(0,0),(-1,-1),11),('LINEBELOW',(0,0),(-1,-1),.5,colors.white)]))
    story.extend([t,Spacer(1,24),Paragraph('Proposed design and implementation specification. Application code and deployment are future work; required features and optional innovations are distinguished throughout.',STYLE['small']),PageBreak(),Paragraph('Contents',STYLE['h1'])])
    toc=TableOfContents()
    toc.levelStyles=[ParagraphStyle('TOC',fontName='Body',fontSize=10.1,leading=15.3,textColor=INK,spaceBefore=6,leftIndent=0,firstLineIndent=0)]
    story.extend([toc,PageBreak()])
    lines=path.read_text(encoding='utf-8').splitlines(); i=1
    while i<len(lines):
        line=lines[i]
        if not line.strip(): i+=1; continue
        if line.startswith('```'):
            lang=line[3:]; i+=1; content=[]
            while i<len(lines) and not lines[i].startswith('```'):
                content.append(lines[i]); i+=1
            i+=1
            if lang=='mermaid':
                story.extend([ArchitectureFlow(),Spacer(1,10),Paragraph('The companion one-page architecture PDF includes the grouped data model.',STYLE['small'])])
            else:
                wrapped=[]
                for s in content:
                    wrapped.extend(textwrap.wrap(s, width=106, subsequent_indent='  ', replace_whitespace=False, drop_whitespace=False) or [''])
                story.append(Preformatted('\n'.join(wrapped),STYLE['code']))
            continue
        if line.startswith('|'):
            rows=[]
            while i<len(lines) and lines[i].startswith('|'):
                cells=split_cells(lines[i]); i+=1
                if all(re.fullmatch(r'[:\- ]+',x or '-') for x in cells): continue
                rows.append(cells)
            n=len(rows[0])
            if any(len(r)!=n for r in rows): raise ValueError(f'Table widths inconsistent in {path}: {rows}')
            if n==2: widths=[doc.width*.30,doc.width*.70]
            elif n==3: widths=[doc.width*.24,doc.width*.40,doc.width*.36]
            elif n==4: widths=[doc.width*.20,doc.width*.31,doc.width*.12,doc.width*.37] if rows[0][2]=='Owner' else [doc.width/n]*n
            elif n==6: widths=[doc.width*.09]+[doc.width*.178]*4+[doc.width*.198]
            else: widths=[doc.width/n]*n
            cells=[[Paragraph(inline(v),STYLE['cellhead'] if r==0 else STYLE['cell']) for v in row] for r,row in enumerate(rows)]
            table=LongTable(cells,colWidths=widths,repeatRows=1,hAlign='LEFT')
            table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),NAVY),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,PALE]),('VALIGN',(0,0),(-1,-1),'TOP'),('LINEBELOW',(0,0),(-1,-1),.4,LINE),('LEFTPADDING',(0,0),(-1,-1),7),('RIGHTPADDING',(0,0),(-1,-1),7),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7)]))
            story.extend([table,Spacer(1,10)]); continue
        if line.startswith('## '): story.append(Paragraph(inline(line[3:]),STYLE['h1'])); i+=1; continue
        if line.startswith('### '): story.append(Paragraph(inline(line[4:]),STYLE['h2'])); i+=1; continue
        if line.startswith('- '): story.append(Paragraph('• '+inline(line[2:]),STYLE['bullet'])); i+=1; continue
        if re.match(r'^\d+\. ',line): story.append(Paragraph(inline(line),STYLE['bullet'])); i+=1; continue
        parts=[line]; i+=1
        while i<len(lines) and lines[i].strip() and not re.match(r'^(#|\||```|- |\d+\. )',lines[i]):
            parts.append(lines[i]); i+=1
        story.append(Paragraph(inline(' '.join(parts)),STYLE['body']))
    doc.multiBuild(story)

def architecture_page():
    out=ROOT/'DealFlow360-Architecture.pdf'
    c=canvas.Canvas(str(out),pagesize=landscape(A4))
    c.setTitle('DealFlow360 — One-page architecture and data model')
    w,h=landscape(A4)
    c.setFillColor(TEAL); c.rect(0,h-7,w,7,stroke=0,fill=1)
    c.setFillColor(NAVY); c.setFont('BodyBold',22); c.drawString(32,h-42,'DealFlow360 | Architecture & data model')
    c.setFillColor(MUTED); c.setFont('Body',9.4); c.drawString(32,h-62,'Next.js frontend • Java 21 / Spring Boot backend • JPA / PostgreSQL • Revision 2 proposed architecture')
    xs=[32,232,432,632]
    specs=[('Next.js workspace','HTTPS commands / WSS updates'),('Next.js customer portal','Own quotes; private user events'),('Supabase Auth','JWT issuer / verified identity'),('Spring jobs / outbox','Same backend; DB leases')]
    for x,(title,detail) in zip(xs,specs):
        box(c,x,438,178,54,title,detail,size=9.7)
        draw_arrow(c,x+89,438,x+89,420)
    box(c,32,300,778,120,'SPRING BOOT MODULAR BACKEND','Spring MVC / Security • JPA transactions / locks • Authenticated per-user STOMP updates',True,size=12)
    c.setFont('Body',8.5); c.setFillColor(colors.white)
    c.drawString(45,373,'Committed DB outbox -> private UI notifications. RabbitMQ async workers are optional later; core commands stay transactional.')
    modules=[('Pricing + risk','Versioned policy'),('Recommendations','Purchase-history counts'),('Fulfillment','Reserve / dispatch'),('Billing','Schedules / credits'),('Reporting','Live queries / exports')]
    for k,(title,detail) in enumerate(modules):
        box(c,45+k*151,312,143,52,title,detail,size=9.2)
    draw_arrow(c,421,300,421,271)
    c.setFillColor(NAVY); c.setFont('BodyBold',11); c.drawString(32,262,'POSTGRESQL — grouped relational model')
    c.setFillColor(MUTED); c.setFont('Body',8.2); c.drawString(32,248,'Arrows show ownership/relationships. Audit, outbox, version checks and transaction constraints span commercial records.')
    x=[32,190,348,506,664]; bw=146
    top=[('Customers','Roles / tier / ownership'),('Quotes','Current version / activity'),('Revisions','Lines / policy snapshot'),('Orders','Accepted version only'),('Shipments','Reservations / backorders')]
    low=[('Catalog + plans','Variants / prices / cadence'),('Quote lines','Quantity / price / discount'),('Approval decisions','Version / actor / delegation'),('Billing records','Subscriptions / invoices\nPayments / credits / refunds'),('Inventory','Stock rows / movements')]
    for j,(title,detail) in enumerate(top): box(c,x[j],177,bw,51,title,detail,size=9.2)
    for j,(title,detail) in enumerate(low): box(c,x[j],91,bw,62,title,detail,size=9.2)
    for j in range(4): draw_arrow(c,x[j]+bw,203,x[j+1],203)
    draw_arrow(c,x[0]+bw,122,x[1],122)
    draw_arrow(c,x[2]+40,177,x[2]+40,153)
    draw_arrow(c,x[3]+73,177,x[3]+73,153)
    draw_arrow(c,x[4]+73,153,x[4]+73,177)
    c.setStrokeColor(TEAL); c.setLineWidth(1.1)
    c.line(x[2]+25,177,x[2]+25,164); c.line(x[2]+25,164,x[1]+100,164)
    draw_arrow(c,x[1]+100,164,x[1]+100,153)
    c.setFillColor(PALE); c.roundRect(32,33,778,41,5,stroke=0,fill=1)
    c.setFillColor(NAVY); c.setFont('BodyBold',8.8)
    c.drawString(42,58,'EXECUTION GATE: seller adoption + customer acceptance + valid approval, all on the same current revision')
    c.setFont('Body',8.4); c.drawString(42,43,'One order per quote • Nonnegative stock • Retry-safe charge keys • Exact money • Private customer responses')
    c.setFillColor(MUTED); c.setFont('Body',7.5); c.drawString(32,17,'Revision 2 • 05 September 2026 • All 23 edge-case policies and tests are specified in the Implementation Plan')
    c.save()

if __name__=='__main__':
    architecture_page()
    render_markdown(ROOT/'DealFlow360-Solution-Report.md','Solution Report',
        'A revised product and architecture proposal using the team\'s Spring Boot experience to connect quotation, negotiation, approval, fulfillment, and billing.',
        [('Core decision','Spring Boot + JPA / PostgreSQL, with a Next.js frontend.'),('Live updates','Authenticated WebSockets; committed outbox; RabbitMQ optional later.'),('Edge-case review','All 23 submitted cases resolved with explicit policies and tests.'),('Machine learning','No trained model required; Deal Lab remains the creative extension.')])
    render_markdown(ROOT/'DealFlow360-Implementation-Plan.md','Implementation Plan',
        'A Spring Boot execution specification covering frameworks, transactions, APIs, WebSockets, all 23 submitted edge cases, team ownership, deployment, and demonstration.',
        [('Delivery rule','One modular backend; RabbitMQ and microservices are optional later.'),('Engineering focus','JPA with explicit versions/locks; retry-safe billing and committed events.'),('Team coordination','Four workstreams with OpenAPI contracts and integration gates.'),('Verification','28 baseline checks, 23 edge-case contracts, 8 infrastructure checks.')])
    print('Generated two document PDFs and one architecture PDF in',ROOT)
