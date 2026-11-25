import type { Writable } from 'node:stream';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

export interface QrPosterData {
  messName: string;
  label: string;
  /** The exact value printed in the QR ("MQ1:..."). It is never drawn as text. */
  qrValue: string;
  /** First characters of the QR code id, printed in the footer so staff can match sticker and record. */
  shortId: string;
}

/**
 * A4 print-ready sheet: mess name, label, a ~12 cm black-on-white QR with a generous quiet zone,
 * an instruction line and the short code id. Writes the PDF to `out` and resolves when finished.
 */
export async function renderQrPoster(data: QrPosterData, out: Writable): Promise<void> {
  const png = await QRCode.toBuffer(data.qrValue, {
    errorCorrectionLevel: 'M',
    margin: 4, // quiet zone in modules
    width: 1200,
    color: { dark: '#000000', light: '#FFFFFF' },
  });

  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `QR code - ${data.label}` } });
  const done = new Promise<void>((resolve, reject) => {
    out.on('finish', () => resolve());
    out.on('error', reject);
    doc.on('error', reject);
  });
  doc.pipe(out);

  const pageW = doc.page.width;
  const qrSize = 340; // ~12 cm

  doc.font('Helvetica-Bold').fontSize(30).text(data.messName, { align: 'center' });
  doc.moveDown(0.6);
  doc.font('Helvetica').fontSize(22).text(data.label, { align: 'center' });

  doc.image(png, (pageW - qrSize) / 2, 190, { width: qrSize, height: qrSize });

  doc.font('Helvetica-Bold').fontSize(22).text('Scan to mark your attendance', 40, 570, {
    align: 'center',
    width: pageW - 80,
  });
  doc.moveDown(0.5);
  doc.font('Helvetica').fontSize(14).text('Open the Mess app, tap Scan and point the camera here.', {
    align: 'center',
    width: pageW - 80,
  });
  doc.moveDown(0.3);
  doc.fontSize(14).text('Lunch and Dinner are recorded automatically at the meal time.', {
    align: 'center',
    width: pageW - 80,
  });

  doc.fontSize(10).fillColor('#555555').text(`Code ${data.shortId}`, 40, doc.page.height - 60, {
    align: 'center',
    width: pageW - 80,
  });

  doc.end();
  await done;
}
