import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CompanyCustomIcon } from "@zcode/shared";

// 图标库：用户上传的同事图标。按内容寻址存在 icons/<hash>.<ext>，index.json 记名字与格式。
// SVG 存清洗后的文本（UI 渲染时还会再清洗）；视频/动图存原始字节，按文件头校验真实格式。

interface IndexEntry {
  name: string;
  createdAt: number;
  /** 旧条目没有该字段，按 svg 处理。 */
  ext?: string;
}

export const MEDIA_ICON_TYPES: Record<string, { ext: string; kind: "video" | "image"; magic(b: Buffer): boolean }> = {
  "video/mp4": { ext: "mp4", kind: "video", magic: (b) => b.subarray(4, 8).toString("latin1") === "ftyp" },
  "video/webm": { ext: "webm", kind: "video", magic: (b) => b.readUInt32BE(0) === 0x1a45dfa3 },
  "image/gif": { ext: "gif", kind: "image", magic: (b) => b.subarray(0, 4).toString("latin1") === "GIF8" },
  "image/png": { ext: "png", kind: "image", magic: (b) => b.readUInt32BE(0) === 0x89504e47 },
  "image/webp": {
    ext: "webp",
    kind: "image",
    magic: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
  },
};

const MIME_BY_EXT = Object.fromEntries(Object.entries(MEDIA_ICON_TYPES).map(([mime, t]) => [t.ext, mime]));

export class CompanyIconLibrary {
  constructor(private readonly home: string) {}

  private dir() {
    return join(this.home, "icons");
  }

  private async readIndex(): Promise<Record<string, IndexEntry>> {
    try {
      return JSON.parse(await readFile(join(this.dir(), "index.json"), "utf8")) as Record<string, IndexEntry>;
    } catch {
      return {};
    }
  }

  private async writeIndex(index: Record<string, IndexEntry>): Promise<void> {
    await mkdir(this.dir(), { recursive: true });
    const path = join(this.dir(), "index.json");
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(index, null, 2), "utf8");
    await rename(tmp, path);
  }

  async list(): Promise<CompanyCustomIcon[]> {
    const index = await this.readIndex();
    const icons = await Promise.all(
      Object.entries(index)
        .sort(([, a], [, b]) => a.createdAt - b.createdAt)
        .map(async ([hex, meta]): Promise<CompanyCustomIcon | null> => {
          const ext = meta.ext ?? "svg";
          try {
            const file = join(this.dir(), `${hex}.${ext}`);
            if (ext === "svg") return { id: `custom:${hex}`, name: meta.name, kind: "svg", svg: await readFile(file, "utf8") };
            const mime = MIME_BY_EXT[ext];
            if (!mime) return null;
            const data = await readFile(file);
            return {
              id: `custom:${hex}`,
              name: meta.name,
              kind: MEDIA_ICON_TYPES[mime]!.kind,
              dataUrl: `data:${mime};base64,${data.toString("base64")}`,
            };
          } catch {
            return null;
          }
        }),
    );
    return icons.filter((i): i is CompanyCustomIcon => i !== null);
  }

  private async add(name: string, ext: string, content: Buffer | string, extra: Partial<IndexEntry> = {}): Promise<string> {
    const hex = createHash("sha256").update(content).digest("hex").slice(0, 16);
    await mkdir(this.dir(), { recursive: true });
    await writeFile(join(this.dir(), `${hex}.${ext}`), content);
    const index = await this.readIndex();
    index[hex] = { name, createdAt: index[hex]?.createdAt ?? Date.now(), ext, ...extra };
    await this.writeIndex(index);
    return `custom:${hex}`;
  }

  async addSvg(name: string, svg: string): Promise<CompanyCustomIcon> {
    return { id: await this.add(name, "svg", svg), name, kind: "svg", svg };
  }

  async addMedia(name: string, mime: string, data: Buffer): Promise<CompanyCustomIcon> {
    const type = MEDIA_ICON_TYPES[mime];
    if (!type) throw new Error("Animated icons can be MP4, WebM, GIF, WebP or PNG.");
    if (data.length < 12 || !type.magic(data)) throw new Error("That file isn't a valid " + type.ext.toUpperCase() + ".");
    const id = await this.add(name, type.ext, data);
    return { id, name, kind: type.kind, dataUrl: `data:${mime};base64,${data.toString("base64")}` };
  }

  async has(id: string): Promise<boolean> {
    const hex = id.replace(/^custom:/, "");
    return /^[a-f0-9]{16}$/.test(hex) && hex in (await this.readIndex());
  }

  async remove(id: string): Promise<void> {
    const hex = id.replace(/^custom:/, "");
    if (!/^[a-f0-9]{16}$/.test(hex)) throw new Error("Invalid icon id.");
    const index = await this.readIndex();
    const ext = index[hex]?.ext ?? "svg";
    delete index[hex];
    await this.writeIndex(index);
    await rm(join(this.dir(), `${hex}.${ext}`), { force: true });
  }
}
