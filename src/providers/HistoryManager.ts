import * as vscode from "vscode";
import { SyncHistoryItem, SyncStatistics } from "../types/history";

export class HistoryManager {
  private static instance: HistoryManager;
  private context: vscode.ExtensionContext;
  private readonly historyKey = "stackFileSync.history";
  private readonly maxHistoryItems = 100;

  private constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  public static getInstance(context: vscode.ExtensionContext): HistoryManager {
    if (!HistoryManager.instance) {
      HistoryManager.instance = new HistoryManager(context);
    }
    return HistoryManager.instance;
  }

  public async addHistoryItem(
    item: Omit<SyncHistoryItem, "id" | "timestamp">
  ): Promise<void> {
    const history = await this.getHistory();
    const newItem: SyncHistoryItem = {
      ...item,
      id: this.generateId(),
      timestamp: Date.now(),
    };

    history.unshift(newItem);

    // 保持历史记录数量在限制范围内
    if (history.length > this.maxHistoryItems) {
      history.pop();
    }

    await this.context.globalState.update(this.historyKey, history);
  }

  public async getHistory(): Promise<SyncHistoryItem[]> {
    return (
      this.context.globalState.get<SyncHistoryItem[]>(this.historyKey) || []
    );
  }

  public async clearHistory(): Promise<void> {
    await this.context.globalState.update(this.historyKey, []);
  }

  public async deleteHistoryItem(id: string): Promise<void> {
    const history = await this.getHistory();
    const updatedHistory = history.filter((item) => item.id !== id);
    await this.context.globalState.update(this.historyKey, updatedHistory);
  }

  public async getStatistics(): Promise<SyncStatistics> {
    const history = await this.getHistory();
    const stats: SyncStatistics = {
      totalSyncs: history.length,
      successfulSyncs: history.filter((item) => item.status === "success")
        .length,
      failedSyncs: history.filter((item) => item.status === "failed").length,
      totalFiles: history.reduce((sum, item) => sum + item.files.length, 0),
      averageDuration:
        history.reduce((sum, item) => sum + item.duration, 0) /
        (history.length || 1),
      lastSync: history[0]?.timestamp || 0,
    };
    return stats;
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
