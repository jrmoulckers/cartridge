/**
 * Cover images, stored on-device.
 *
 * A cover the user picks is downscaled and re-encoded before it is stored, for three
 * reasons: IndexedDB is not a photo library, backups are JSON (so every byte is base64'd
 * and grows by a third), and a 4000px phone photo of a game case is never worth more than
 * a few hundred pixels in a 3:4 tile.
 */

/** Longest edge, in CSS pixels, that a stored cover is allowed to be. */
const MAX_EDGE = 600;
/** Refuse anything absurd up front rather than decoding it. */
const MAX_INPUT_BYTES = 12 * 1024 * 1024;

export class ImageError extends Error {}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new ImageError('That image could not be read.'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new ImageError('That file isn’t an image Cartridge can read.'));
    img.src = src;
  });
}

/**
 * Turn a picked file into a compact data URL suitable for `Game.coverData`.
 * Everything happens on-device — no upload, no network.
 */
export async function fileToCoverData(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new ImageError('Choose an image file.');
  if (file.size > MAX_INPUT_BYTES) throw new ImageError('That image is too large (max 12 MB).');

  const original = await readAsDataUrl(file);
  const img = await loadImage(original);

  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return original;
  ctx.drawImage(img, 0, 0, width, height);

  // JPEG for photographs of boxes and screenshots; a cover is never a diagram.
  return canvas.toDataURL('image/jpeg', 0.82);
}
