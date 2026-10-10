// Web 端没有系统目录选择框：platform.selectDirectory 改为打开服务端目录浏览器（手机上同样可用），
// 由 RootInner 注册真正的弹窗打开函数。
type DirectoryPicker = () => Promise<string | null>;

let picker: DirectoryPicker | null = null;

export function setDirectoryPicker(next: DirectoryPicker | null) {
  picker = next;
}

export function pickDirectoryInBrowser(): Promise<string | null> {
  return picker ? picker() : Promise.resolve(null);
}

// 目录浏览器的「上一级」：服务端可能是 Windows（手机连电脑）。同时认 / 与 \，盘符根保留 "C:\"。
export function parentDirectoryPath(path: string): string {
  const parent = path.replace(/[\\/][^\\/]+[\\/]?$/, "");
  if (/^[A-Za-z]:$/.test(parent)) return `${parent}\\`;
  return parent || "/";
}
