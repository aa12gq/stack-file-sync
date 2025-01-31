import * as vscode from "vscode";
import { HistoryManager } from "./HistoryManager";
import { HistoryTreeItem, SyncHistoryItem } from "../types/history";
import * as path from "path";

export class HistoryViewProvider
  implements vscode.TreeDataProvider<HistoryTreeItem>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    HistoryTreeItem | undefined | null | void
  > = new vscode.EventEmitter<HistoryTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    HistoryTreeItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  constructor(
    private context: vscode.ExtensionContext,
    private historyManager: HistoryManager
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: HistoryTreeItem): vscode.TreeItem {
    const treeItem = new vscode.TreeItem(
      element.label,
      element.children
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None
    );

    treeItem.description = element.description;
    treeItem.tooltip = element.tooltip;
    treeItem.contextValue = element.contextValue;

    if (element.iconPath) {
      treeItem.iconPath = new vscode.ThemeIcon(element.iconPath);
    }

    return treeItem;
  }

  async getChildren(element?: HistoryTreeItem): Promise<HistoryTreeItem[]> {
    if (!element) {
      // 根节点：显示统计信息和历史记录
      const stats = await this.historyManager.getStatistics();
      const history = await this.historyManager.getHistory();

      const items: HistoryTreeItem[] = [
        {
          id: "stats",
          label: "Statistics",
          iconPath: "graph",
          children: [
            {
              id: "total",
              label: `Total Syncs: ${stats.totalSyncs}`,
              iconPath: "symbol-number",
            },
            {
              id: "success",
              label: `Successful: ${stats.successfulSyncs}`,
              iconPath: "pass",
            },
            {
              id: "failed",
              label: `Failed: ${stats.failedSyncs}`,
              iconPath: "error",
            },
            {
              id: "files",
              label: `Total Files: ${stats.totalFiles}`,
              iconPath: "files",
            },
            {
              id: "duration",
              label: `Average Duration: ${Math.round(stats.averageDuration)}ms`,
              iconPath: "clock",
            },
          ],
        },
        {
          id: "history",
          label: "Sync History",
          iconPath: "history",
          children: this.createHistoryItems(history),
        },
      ];

      return items;
    }

    return element.children || [];
  }

  private createHistoryItems(history: SyncHistoryItem[]): HistoryTreeItem[] {
    return history.map((item) => ({
      id: item.id,
      label: `${item.repository} (${item.branch})`,
      description: new Date(item.timestamp).toLocaleString(),
      tooltip: this.createTooltip(item),
      contextValue: "historyItem",
      iconPath: item.status === "success" ? "pass" : "error",
      children: [
        {
          id: `${item.id}-files`,
          label: "Synced Files",
          iconPath: "files",
          children: item.files.map((file) => ({
            id: `${item.id}-${file}`,
            label: path.basename(file),
            description: path.dirname(file),
            iconPath: "file",
          })),
        },
        {
          id: `${item.id}-details`,
          label: "Details",
          iconPath: "info",
          children: [
            {
              id: `${item.id}-type`,
              label: `Type: ${item.syncType}`,
              iconPath: "symbol-enum",
            },
            {
              id: `${item.id}-duration`,
              label: `Duration: ${item.duration}ms`,
              iconPath: "clock",
            },
          ],
        },
      ],
    }));
  }

  private createTooltip(item: SyncHistoryItem): string {
    const lines = [
      `Repository: ${item.repository}`,
      `Branch: ${item.branch}`,
      `Status: ${item.status}`,
      `Type: ${item.syncType}`,
      `Time: ${new Date(item.timestamp).toLocaleString()}`,
      `Duration: ${item.duration}ms`,
      `Files: ${item.files.length}`,
    ];

    if (item.error) {
      lines.push(`Error: ${item.error}`);
    }

    return lines.join("\n");
  }
}
