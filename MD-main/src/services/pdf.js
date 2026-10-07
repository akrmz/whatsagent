"use strict";

const sharp = require("sharp");

/**
 * Pictures → PDF (.topdf), with no extra library: each page holds one JPEG
 * (PDF reads JPEG natively with /DCTDecode), fitted on an A4 page with a margin,
 * portrait or landscape to match the picture.
 */

const A4 = [595.28, 841.89]; // points
const MARGIN = 24;

/** Any picture sharp reads → baseline JPEG (RGB, at most 2480 px, EXIF orientation applied). */
async function toJpeg(buffer) {
  const { data, info } = await sharp(buffer, { limitInputPixels: 64e6, animated: false })
    .rotate()
    .resize({ width: 2480, height: 2480, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .toColourspace("srgb") // grayscale input would otherwise give a 1-channel JPEG (the PDF says RGB)
    .jpeg({ quality: 88, mozjpeg: false })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** @param {Array<{ data: Buffer, width: number, height: number }>} images JPEGs */
function build(images) {
  const chunks = [];
  const offsets = [];
  let length = 0;
  const push = (b) => {
    const buf = Buffer.isBuffer(b) ? b : Buffer.from(b, "latin1");
    chunks.push(buf);
    length += buf.length;
  };
  const obj = (n, body) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    for (const part of [].concat(body)) push(part);
    push("\nendobj\n");
  };

  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  // 1: catalog, 2: pages; then per page: page, image, content
  const pageIds = images.map((_, i) => 3 + i * 3);
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${images.length} >>`);
  images.forEach((img, i) => {
    const [pid, iid, cid] = [3 + i * 3, 4 + i * 3, 5 + i * 3];
    const [pw, ph] = img.width > img.height ? [A4[1], A4[0]] : A4;
    const scale = Math.min((pw - 2 * MARGIN) / img.width, (ph - 2 * MARGIN) / img.height);
    const [w, h] = [img.width * scale, img.height * scale];
    const [x, y] = [(pw - w) / 2, (ph - h) / 2];
    const content = `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im0 Do Q`;
    obj(pid, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw.toFixed(2)} ${ph.toFixed(2)}] /Resources << /XObject << /Im0 ${iid} 0 R >> >> /Contents ${cid} 0 R >>`);
    obj(iid, [
      `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.data.length} >>\nstream\n`,
      img.data,
      "\nendstream",
    ]);
    obj(cid, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  const count = 3 + images.length * 3;
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) push(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(chunks);
}

async function imagesToPdf(buffers) {
  const jpegs = [];
  for (const b of buffers) jpegs.push(await toJpeg(b));
  return build(jpegs);
}

module.exports = { imagesToPdf, build, toJpeg };
