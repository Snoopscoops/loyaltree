// Trial images never leave the browser. These bounds protect the local preview;
// authenticated server uploads must have their own independent validation.
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_SIDE = 4096;
const MAX_PIXELS = 12_000_000;
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function imageHeader(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start, size) => String.fromCharCode(...bytes.slice(start, start + size));
  if (bytes.length >= 24 && [137,80,78,71,13,10,26,10].every((n,i) => bytes[i] === n) && ascii(12,4) === 'IHDR') {
    return { type:'image/png', width:view.getUint32(16), height:view.getUint32(20) };
  }
  if (bytes.length >= 30 && ascii(0,4) === 'RIFF' && ascii(8,4) === 'WEBP') {
    const tag = ascii(12,4);
    if (tag === 'VP8X') {
      const u24 = i => bytes[i] | bytes[i+1]<<8 | bytes[i+2]<<16;
      return { type:'image/webp', width:1+u24(24), height:1+u24(27) };
    }
    if (tag === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 1 && bytes[25] === 0x2a) {
      return { type:'image/webp', width:view.getUint16(26,true)&0x3fff, height:view.getUint16(28,true)&0x3fff };
    }
    if (tag === 'VP8L' && bytes[20] === 0x2f) {
      const bits = view.getUint32(21,true);
      return { type:'image/webp', width:(bits&0x3fff)+1, height:((bits>>>14)&0x3fff)+1 };
    }
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    const starts = new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf]);
    while (i+3 < bytes.length) {
      if (bytes[i++] !== 0xff) break;
      while (bytes[i] === 0xff) i++;
      const marker = bytes[i++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
      if (i+2 > bytes.length) break;
      const length = view.getUint16(i);
      if (length < 2 || i+length > bytes.length) break;
      if (starts.has(marker) && length >= 8) {
        return { type:'image/jpeg', width:view.getUint16(i+5), height:view.getUint16(i+3) };
      }
      i += length;
    }
  }
  throw new Error('Choose a valid PNG, JPG, or WebP image.');
}

async function inspectTrialImage(file) {
  if (!file || !file.size || file.size > MAX_FILE_BYTES) throw new Error('Choose an image under 5 MB.');
  if (file.type && !ALLOWED_TYPES.has(file.type)) throw new Error('Choose a PNG, JPG, or WebP image.');
  const header = imageHeader(new Uint8Array(await file.slice(0,65536).arrayBuffer()));
  if (file.type && file.type !== header.type) throw new Error('The file contents do not match its image type.');
  if (!header.width || !header.height || header.width > MAX_SIDE || header.height > MAX_SIDE || header.width*header.height > MAX_PIXELS) {
    throw new Error('Choose an image up to 4096 pixels per side and 12 megapixels.');
  }
  return header;
}

export async function prepareTrialImage(file, kind) {
  await inspectTrialImage(file); // Inspect dimensions before asking the browser to decode.
  const inputUrl = URL.createObjectURL(file);
  const image = new Image();
  let timer;
  try {
    await new Promise((resolve,reject) => {
      timer = setTimeout(() => reject(new Error('This image could not be opened. Try another file.')),8000);
      image.onload = resolve;
      image.onerror = () => reject(new Error('This image is damaged or unsupported. Try another file.'));
      image.src = inputUrl;
    });
    const width = image.naturalWidth, height = image.naturalHeight;
    if (!width || !height || width > MAX_SIDE || height > MAX_SIDE || width*height > MAX_PIXELS) {
      throw new Error('Choose a smaller image, up to 4096 pixels per side and 12 megapixels.');
    }
    const scale = Math.min(1,(kind === 'logo' ? 1024 : 1600)/Math.max(width,height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1,Math.round(width*scale));
    canvas.height = Math.max(1,Math.round(height*scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image preview is unavailable in this browser.');
    context.drawImage(image,0,0,canvas.width,canvas.height);
    // Re-encoding retains pixels rather than embedding the original file or metadata.
    try {
      const blob = await new Promise((resolve,reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Try another image.')),'image/webp',0.88));
      return URL.createObjectURL(blob);
    } finally { canvas.width = canvas.height = 1; }
  } finally {
    clearTimeout(timer);
    image.onload = image.onerror = null;
    image.src = '';
    URL.revokeObjectURL(inputUrl);
  }
}
