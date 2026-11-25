import { Writable } from 'node:stream';

/** Collects a streamed PDF into a Buffer. */
export function bufferSink(): { out: Writable; result: () => Buffer } {
  const chunks: Buffer[] = [];
  const out = new Writable({
    write(chunk: Buffer, _enc, cb) {
      chunks.push(chunk);
      cb();
    },
  });
  return { out, result: () => Buffer.concat(chunks) };
}

/** Number of pages (works on uncompressed test output as well as normal files). */
export function pageCount(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type \/Page\b(?!s)/g) ?? []).length;
}

/**
 * Text drawn on the pages. In tests PDFKit writes uncompressed content streams and encodes text as hex
 * strings (`<4a6f68>`), so decoding every hex string yields the visible text, in drawing order.
 */
export function pdfText(pdf: Buffer): string {
  const raw = pdf.toString('latin1');
  const parts: string[] = [];
  for (const m of raw.matchAll(/<([0-9a-fA-F]{2,})>/g)) parts.push(Buffer.from(m[1] as string, 'hex').toString('latin1'));
  return parts.join('');
}
