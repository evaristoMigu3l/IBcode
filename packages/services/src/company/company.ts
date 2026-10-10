import type {
  CompanyAgent,
  CompanyAgentInput,
  CompanyAuditEntry,
  CompanyCapabilities,
  CompanyCustomIcon,
  CompanyFileEntry,
  CompanyFilePreview,
  CompanyMessage,
  CompanyState,
} from "@zcode/shared";
import { ServiceChannels } from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";

/**
 * Company：OpenBot 式的 AI 同事。
 *
 * 状态唯一所有者是本服务（数据落在 ~/.zcode/company）。同事的每次运行都是普通 ZCode task；
 * 文件与命令只能经由本服务内的 Gateway（按授权文件夹裁决并写审计），原生文件/命令工具被禁用。
 */
export interface ICompanyService {
  getState(): Promise<CompanyState>;
  getCapabilities(): Promise<CompanyCapabilities>;
  listMessages(params: { channel: string; since?: number }): Promise<CompanyMessage[]>;
  /** 老板发言；被 @ 到的同事（或私聊频道的同事）会被唤醒。 */
  post(params: { channel: string; text: string }): Promise<{ message: CompanyMessage; woke: string[] }>;
  /** 删除频道里的全部消息（不可撤销；UI 先确认）。 */
  clearChannel(params: { channel: string }): Promise<void>;
  saveAgent(input: CompanyAgentInput): Promise<CompanyAgent>;
  deleteAgent(params: { id: string }): Promise<void>;
  readMemory(params: { id: string }): Promise<string>;
  writeMemory(params: { id: string; text: string }): Promise<void>;
  listAudit(params: { limit?: number; agentId?: string }): Promise<CompanyAuditEntry[]>;
  /** 清空动态：已结束的运行记录与动作日志（可只清某位同事）；进行中的运行保留。 */
  clearActivity(params: { agentId?: string }): Promise<void>;
  runRoutineNow(params: { agentId: string; routineId: string }): Promise<void>;
  /** 浏览同事自己的文件夹（报告、演示文稿、代码等成果）；路径相对于该文件夹。 */
  listFiles(params: { agentId: string; path?: string }): Promise<CompanyFileEntry[]>;
  previewFile(params: { agentId: string; path: string }): Promise<CompanyFilePreview>;
  deleteFile(params: { agentId: string; path: string }): Promise<void>;
  /** 图标库：用户上传的 SVG（UI 渲染前会在隔离的 shadow DOM 里再清洗一次）。 */
  listIcons(): Promise<CompanyCustomIcon[]>;
  addIcon(params: { name: string; svg: string }): Promise<CompanyCustomIcon>;
  /** 动图图标（MP4/WebM/GIF/WebP/PNG，≤4 MB），原样显示。 */
  addMediaIcon(params: { name: string; mime: string; base64: string }): Promise<CompanyCustomIcon>;
  deleteIcon(params: { id: string }): Promise<void>;
}

export const ICompanyService = createServiceDescriptor<ICompanyService>(ServiceChannels.Company);
