import type { Writable } from 'node:stream';
import PDFDocument from 'pdfkit';

/**
 * Shared building blocks for the report PDFs. Pure drawing code: no database, no HTTP.
 * Fonts are the built-in Helvetica (English only, D-13); the look is deliberately plain grayscale
 * so it prints well on any printer.
 */

export interface ReportMeta {
  messName: string;
  /** e.g. "25 Nov 2026, 12:00" (already formatted in the mess time zone) */
  generatedAt: string;
  generatedBy: string;
}

export interface Column {
  header: string;
  width: number;
  align?: 'left' | 'right' | 'center';
}

export interface ReportDoc {
  doc: PDFKit.PDFDocument;
  /** x of the left margin and usable width */
  left: number;
  width: number;
  finish: () => Promise<void>;
}

const MARGIN = 40;
const FOOTER_SPACE = 40;
const GRAY_TEXT = '#555555';
const GRAY_FILL = '#EFEFEF';
const GRAY_LINE = '#BDBDBD';

export function createReport(params: {
  title: string;
  subtitle?: string;
  meta: ReportMeta;
  landscape?: boolean;
  out: Writable;
}): ReportDoc {
  const { title, subtitle, meta, out } = params;
  const doc = new PDFDocument({
    size: 'A4',
    layout: params.landscape ? 'landscape' : 'portrait',
    margin: MARGIN,
    bufferPages: true, // needed for "Page X of Y"
    compress: process.env.NODE_ENV !== 'test', // readable streams in tests
    info: { Title: title, Author: meta.messName },
  });

  const done = new Promise<void>((resolve, reject) => {
    params.out.on('finish', () => resolve());
    params.out.on('error', reject);
    doc.on('error', reject);
  });
  doc.pipe(out);

  const width = doc.page.width - MARGIN * 2;

  const drawHeader = (): void => {
    doc.font('Helvetica-Bold').fontSize(16).fillColor('#000000').text(meta.messName, MARGIN, MARGIN, { width });
    doc.font('Helvetica-Bold').fontSize(13).text(title, MARGIN, doc.y + 2, { width });
    if (subtitle) doc.font('Helvetica').fontSize(10).fillColor(GRAY_TEXT).text(subtitle, MARGIN, doc.y + 1, { width });
    doc.font('Helvetica').fontSize(8).fillColor(GRAY_TEXT).text(
      `Generated ${meta.generatedAt} by ${meta.generatedBy}`, MARGIN, doc.y + 1, { width },
    );
    doc.moveTo(MARGIN, doc.y + 6).lineTo(MARGIN + width, doc.y + 6).strokeColor(GRAY_LINE).lineWidth(0.5).stroke();
    doc.y += 14;
    doc.fillColor('#000000');
  };

  drawHeader();
  // Header on every following page (table code adds pages explicitly and the header is redrawn here).
  doc.on('pageAdded', () => {
    doc.x = MARGIN;
    doc.y = MARGIN;
    drawHeader();
  });

  const finish = async (): Promise<void> => {
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      // Writing below the bottom margin would otherwise create a new page.
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(8).fillColor(GRAY_TEXT).text(
        `Page ${i + 1} of ${range.count}`, MARGIN, doc.page.height - 28, { width, align: 'center', lineBreak: false },
      );
      doc.page.margins.bottom = bottom;
    }
    doc.end();
    await done;
  };

  return { doc, left: MARGIN, width, finish };
}

/** Section heading inside a report. */
export function heading(r: ReportDoc, text: string, size = 12): void {
  ensureSpace(r, 40);
  r.doc.font('Helvetica-Bold').fontSize(size).fillColor('#000000').text(text, r.left, r.doc.y + 6, { width: r.width });
  r.doc.moveDown(0.3);
}

/** Small key/value or plain paragraph. */
export function paragraph(r: ReportDoc, text: string, opts: { gray?: boolean; size?: number } = {}): void {
  r.doc.font('Helvetica').fontSize(opts.size ?? 10).fillColor(opts.gray ? GRAY_TEXT : '#000000').text(text, r.left, r.doc.y, { width: r.width });
  r.doc.fillColor('#000000');
}

export function ensureSpace(r: ReportDoc, needed: number): void {
  if (r.doc.y + needed > r.doc.page.height - MARGIN - FOOTER_SPACE) r.doc.addPage();
}

export interface TableOptions {
  fontSize?: number;
  rowHeight?: number;
  /** Bold, shaded last row (totals). */
  totalsRow?: string[];
  /** Text shown instead of an empty table. */
  emptyText?: string;
}

/**
 * Draws a table that breaks across pages and repeats its header row on each page.
 * Cells are clipped with an ellipsis (never wrap), so row height stays constant.
 */
export function drawTable(r: ReportDoc, columns: Column[], rows: string[][], opts: TableOptions = {}): void {
  const { doc } = r;
  const fontSize = opts.fontSize ?? 9;
  const rowHeight = opts.rowHeight ?? fontSize + 8;
  const pad = 3;
  const bottomLimit = (): number => doc.page.height - MARGIN - FOOTER_SPACE;

  const drawRow = (cells: string[], y: number, style: 'header' | 'body' | 'zebra' | 'total'): void => {
    if (style === 'header' || style === 'total' || style === 'zebra') {
      const totalWidth = columns.reduce((n, c) => n + c.width, 0);
      doc.rect(r.left, y, totalWidth, rowHeight).fill(style === 'zebra' ? '#F7F7F7' : GRAY_FILL);
      doc.fillColor('#000000');
    }
    doc.font(style === 'header' || style === 'total' ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize).fillColor('#000000');
    let x = r.left;
    columns.forEach((col, i) => {
      doc.text(cells[i] ?? '', x + pad, y + (rowHeight - fontSize) / 2 - 1, {
        width: col.width - pad * 2,
        height: rowHeight,
        align: col.align ?? 'left',
        lineBreak: false,
        ellipsis: true,
      });
      x += col.width;
    });
    const totalWidth = columns.reduce((n, c) => n + c.width, 0);
    doc.moveTo(r.left, y + rowHeight).lineTo(r.left + totalWidth, y + rowHeight).strokeColor(GRAY_LINE).lineWidth(0.3).stroke();
  };

  const headerRow = columns.map((c) => c.header);
  ensureSpace(r, rowHeight * 3);
  let y = doc.y;
  drawRow(headerRow, y, 'header');
  y += rowHeight;

  if (rows.length === 0) {
    doc.font('Helvetica-Oblique').fontSize(fontSize).fillColor(GRAY_TEXT).text(opts.emptyText ?? 'No records.', r.left + pad, y + 4, { width: r.width });
    doc.fillColor('#000000');
    doc.y = y + rowHeight + 4;
    return;
  }

  rows.forEach((cells, i) => {
    if (y + rowHeight > bottomLimit()) {
      doc.addPage();
      y = doc.y;
      drawRow(headerRow, y, 'header');
      y += rowHeight;
    }
    drawRow(cells, y, i % 2 === 1 ? 'zebra' : 'body');
    y += rowHeight;
  });

  if (opts.totalsRow) {
    if (y + rowHeight > bottomLimit()) {
      doc.addPage();
      y = doc.y;
    }
    drawRow(opts.totalsRow, y, 'total');
    y += rowHeight;
  }
  doc.y = y + 6;
  doc.x = r.left;
}
