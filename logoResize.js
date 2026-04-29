const fs = require("fs");
const { PNG } = require("pngjs");

/** Printable raster width at 203 dpi (typical TM ESC/POS). */
const DOTS_58MM = 384;
const DOTS_80MM = 576;

function maxLogoWidthDots(paperMm) {
  return paperMm === "80" ? DOTS_80MM : DOTS_58MM;
}

function lineWidthChars(paperMm) {
  return paperMm === "80" ? 48 : 32;
}

function alignWidthTo8(w) {
  let x = Math.floor(w / 8) * 8;
  if (x < 8) x = 8;
  return x;
}

/**
 * Returns a PNG buffer suitable for Epson raster (width multiple of 8),
 * scaled down so width does not exceed max width for the roll (preserves aspect ratio).
 */
function buildLogoPngBuffer(logoPath, paperMm) {
  const maxW = maxLogoWidthDots(paperMm);
  const srcBuf = fs.readFileSync(logoPath);
  const src = PNG.sync.read(srcBuf);
  const srcW = src.width;
  const srcH = src.height;

  let dstW = alignWidthTo8(Math.min(srcW, maxW));
  if (dstW > srcW) {
    dstW = alignWidthTo8(srcW);
  }

  const dstH = Math.max(1, Math.round((srcH * dstW) / srcW));

  if (dstW === srcW && dstH === srcH) {
    return PNG.sync.write(src);
  }

  const out = new PNG({ width: dstW, height: dstH });
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(Math.floor((y * srcH) / dstH), srcH - 1);
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(Math.floor((x * srcW) / dstW), srcW - 1);
      const si = (srcW * sy + sx) << 2;
      const di = (dstW * y + x) << 2;
      out.data[di] = src.data[si];
      out.data[di + 1] = src.data[si + 1];
      out.data[di + 2] = src.data[si + 2];
      out.data[di + 3] = src.data[si + 3];
    }
  }
  return PNG.sync.write(out);
}

module.exports = {
  buildLogoPngBuffer,
  maxLogoWidthDots,
  lineWidthChars,
  DOTS_58MM,
  DOTS_80MM,
};
