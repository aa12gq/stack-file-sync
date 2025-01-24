import * as vscode from "vscode";
import { Repository } from "../types";
import { AutoSyncManager } from "../providers/AutoSyncManager";

export class RepositoriesViewProvider
  implements vscode.TreeDataProvider<Repository>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    Repository | undefined | null | void
  > = new vscode.EventEmitter<Repository | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    Repository | undefined | null | void
  > = this._onDidChangeTreeData.event;

  constructor(private autoSyncManager: AutoSyncManager) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: Repository): vscode.TreeItem {
    const treeItem = new vscode.TreeItem(
      element.name,
      vscode.TreeItemCollapsibleState.None
    );

    // 设置基本信息
    treeItem.description = element.url;
    treeItem.tooltip = `分支: ${element.branch}\n源目录: ${element.sourceDirectory}\n目标目录: ${element.targetDirectory}`;

    // 根据自动同步状态设置上下文值和图标
    if (element.autoSync?.enabled) {
      treeItem.contextValue = "autoSyncEnabled";
      treeItem.iconPath = new vscode.ThemeIcon(
        "sync",
        new vscode.ThemeColor("charts.blue")
      );
      treeItem.description = `${element.url} (每 ${element.autoSync.interval} 秒自动同步)`;
      // 自动同步开启时，点击直接同步
      treeItem.command = {
        command: "stack-file-sync.syncFiles",
        title: "同步文件",
        arguments: [element],
      };
    } else {
      treeItem.contextValue = "autoSyncDisabled";
      treeItem.iconPath = new vscode.ThemeIcon("sync");
      // 未开启自动同步时，不设置点击命令
    }

    return treeItem;
  }

  getChildren(element?: Repository): Thenable<Repository[]> {
    if (element) {
      return Promise.resolve([]);
    } else {
      const config = vscode.workspace.getConfiguration("stackFileSync");
      return Promise.resolve(config.get("repositories") || []);
    }
  }
}
