import { copyFile, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { basename, extname, join, relative, sep } from "node:path";
import type { CompanyFileEntry, CompanyFilePreview } from "@zcode/shared";
import { CompanyRefusal, isInside, resolveCompanyPath, type CompanyRoot } from "./companyPolicy.js";

// 老板在 Company → Files 里浏览/预览/删除同事文件夹；以及同事之间用 files_send 交接文件。
// 所有路径都经 resolveCompanyPath 解析真实路径，只能落在同事自己的文件夹里。

const HIDDEN_AT_ROOT = new Set([".home", ".tmp"]);
const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_SEND_BYTES = 50 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};
const BINARY_TYPES = new Set([
  ".pdf", ".pptx", ".ppt", ".docx", ".doc", ".xlsx", ".xls", ".zip", ".7z", ".rar", ".exe", ".dll",
  ".mp3", ".mp4", ".wav", ".mov", ".webm", ".woff", ".woff2", ".ttf", ".otf", ".sqlite", ".db",
]);

const ownRoots = (folder: string): CompanyRoot[] => [{ path: folder, access: "write" }];
const toRelative = (folder: string, abs: string) => relative(folder, abs).split(sep).join("/");

export async function listAgentFiles(folder: string, path: string | undefined): Promise<CompanyFileEntry[]> {
  await mkdir(folder, { recursive: true });
  const dir = await resolveCompanyPath(path || ".", ownRoots(folder), "read");
  const atRoot = toRelative(folder, dir) === "";
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const items = await Promise.all(
    entries
      .filter((e) => !(atRoot && HIDDEN_AT_ROOT.has(e.name)))
      .slice(0, 1000)
      .map(async (e) => {
        const abs = join(dir, e.name);
        const info = await stat(abs).catch(() => null);
        return {
          name: e.name,
          path: toRelative(folder, abs),
          type: e.isDirectory() ? ("dir" as const) : ("file" as const),
          size: info?.size ?? 0,
          modifiedAt: info?.mtimeMs ?? 0,
        };
      }),
  );
  return items.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
}

export async function previewAgentFile(folder: string, path: string): Promise<CompanyFilePreview> {
  const abs = await resolveCompanyPath(path, ownRoots(folder), "read");
  const info = await stat(abs);
  if (info.isDirectory()) throw new CompanyRefusal("That is a folder.");
  const ext = extname(abs).toLowerCase();
  const base = { path: toRelative(folder, abs), absolutePath: abs, size: info.size };
  const imageType = IMAGE_TYPES[ext];
  if (imageType) {
    if (info.size > MAX_IMAGE_BYTES) return { ...base, kind: "other" };
    const data = await readFile(abs);
    return { ...base, kind: "image", dataUrl: `data:${imageType};base64,${data.toString("base64")}` };
  }
  if (BINARY_TYPES.has(ext)) return { ...base, kind: "other" };
  const buffer = await readFile(abs);
  const head = buffer.subarray(0, MAX_TEXT_BYTES);
  if (head.includes(0)) return { ...base, kind: "other" };
  return { ...base, kind: "text", text: head.toString("utf8"), truncated: buffer.length > MAX_TEXT_BYTES };
}

export async function deleteAgentFile(folder: string, path: string): Promise<void> {
  const abs = await resolveCompanyPath(path, ownRoots(folder), "write");
  if (isInside(folder, abs)) throw new CompanyRefusal("You can't delete the whole folder.");
  await rm(abs, { recursive: true, force: true });
}

/** 把发送者的一个文件复制到收件同事的 inbox/<发送者>/ 下，重名时自动加序号。 */
export async function sendFileToCoworker(params: {
  source: string;
  recipientFolder: string;
  senderId: string;
}): Promise<string> {
  const info = await stat(params.source);
  if (info.isDirectory()) throw new CompanyRefusal("Send files one at a time (or zip the folder first).");
  if (info.size > MAX_SEND_BYTES) throw new CompanyRefusal("Files over 50 MB can't be sent.");
  const destDir = join(params.recipientFolder, "inbox", params.senderId);
  await mkdir(destDir, { recursive: true });
  const name = basename(params.source);
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let dest = join(destDir, name);
  for (let n = 2; await stat(dest).then(() => true, () => false); n++) dest = join(destDir, `${stem} (${n})${ext}`);
  await copyFile(params.source, dest);
  return toRelative(params.recipientFolder, dest);
}
