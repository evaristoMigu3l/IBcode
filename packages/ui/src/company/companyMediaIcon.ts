// 动图图标（MP4/WebM/GIF/WebP/PNG）上传前的本地处理：识别格式、转 base64。

export const MAX_MEDIA_ICON_BYTES = 4 * 1024 * 1024;

const MEDIA_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  gif: "image/gif",
  webp: "image/webp",
  png: "image/png",
};

export const ICON_FILE_ACCEPT = ".svg,image/svg+xml,.mp4,video/mp4,.webm,video/webm,.gif,.webp,.png";

/** 文件对应的动图 MIME；不是支持的动图格式时返回 undefined（SVG 走另一条路）。 */
export function mediaIconMime(file: File): string | undefined {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const mime = MEDIA_TYPES[ext] ?? file.type;
  return Object.values(MEDIA_TYPES).includes(mime) ? mime : undefined;
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}
