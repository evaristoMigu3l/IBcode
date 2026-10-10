# 智能体规则编辑器 (AGENTS.md) 规范

## 1. 业务背景与目标
在 ZCode 中，智能体跨会话的核心行为、代码规范与全局指令由 `AGENTS.md` 定义（工作区根目录 `<workspace>/AGENTS.md` 以及全局 `~/.zcode/AGENTS.md`）。
目前用户必须在外部文件夹中定位和修改这些文件。
本特性在桌面端设置页中提供「智能体规则 (AGENTS.md)」可视化编辑面板，使用户可直接在应用内查看、编辑、预览与保存工作区和全局规则，同时保证底层智能体运行时读取机制完全保持一致。

## 2. 状态所有者与单一事实源
- **单一事实源**：磁盘上的 `AGENTS.md` 文件（工作区根目录或全局用户目录）。
- **读写所有者**：`IFileService` (`packages/services/src/file/`) 负责原子读写与目录保证。
- **UI 状态管理**：`AgentsRulesSection` 维护当前选择的作用域 (`workspace` | `global`)、草稿内容 (`draft`)、加载基线 (`loaded`) 和脏状态 (`isDirty`)。

## 3. 作用域与文件路径
1. **工作区规则 (`workspace`)**：
   - 目标路径：`resolve(workspacePath, "AGENTS.md")`
   - 当无打开的工作区时，提供友好占位提示引导切换至全局规则。
2. **全局规则 (`global`)**：
   - 目标路径：`resolve(userHomeDir, ".zcode", "AGENTS.md")`
   - 始终可用，保存时若 `~/.zcode` 目录不存在则自动递归创建。

## 4. 接口契约
```ts
export interface AgentsRulesResult {
  content: string;
  filePath: string;
  exists: boolean;
}

export interface IFileService {
  readAgentsRules(params: {
    scope: "workspace" | "global";
    workspacePath?: string;
  }): Promise<AgentsRulesResult>;

  writeAgentsRules(params: {
    scope: "workspace" | "global";
    workspacePath?: string;
    content: string;
  }): Promise<{ filePath: string }>;
}
```

## 5. UI 交互与验收场景
1. **设置页导航**：在设置页侧边栏「智能体能力」分组中展示「智能体规则 (AGENTS.md)」（图标：`ScrollText`）。
2. **作用域切换**：支持在「工作区规则」与「全局规则」两栏间平滑切换，未保存时提示或保留草稿。
3. **编辑与预览**：支持源码编辑（等宽字体、行高优化）与 Markdown 渲染实时预览（复用 `MessageResponse`）。
4. **快捷模板**：提供常用规范模板快速插入（标准规范、极简约束、严格审查）。
5. **保存与快捷键**：支持保存按钮与 `Ctrl+S` / `Cmd+S` 快捷键，保存成功触发 Toast 提示。
