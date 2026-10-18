/**
 * A picture from the person's files made fit for a card: whatever the browser can open
 * (JPEG, PNG, WebP, HEIC in Safari), turned the right way up, scaled down so that its
 * longer side is at most `PHOTO_SIDE`, and encoded as a JPEG — the only kind the server
 * keeps. A phone photo of several megabytes leaves as a few dozen kilobytes.
 */
export const PHOTO_SIDE = 640;
const QUALITY = 0.85;

export async function shrinkPhoto(file: Blob): Promise<Blob> {
  // EXIF orientation is applied, so a portrait shot does not lie on its side
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const k = Math.min(1, PHOTO_SIDE / Math.max(bmp.width, bmp.height));
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(bmp.width * k));
    cv.height = Math.max(1, Math.round(bmp.height * k));
    const ctx = cv.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    // a transparent PNG would turn black in a JPEG
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
    return await new Promise<Blob>((res, rej) =>
      cv.toBlob((b) => (b ? res(b) : rej(new Error("the picture could not be encoded"))), "image/jpeg", QUALITY),
    );
  } finally {
    bmp.close();
  }
}
