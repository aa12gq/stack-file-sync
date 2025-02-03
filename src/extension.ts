// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { Repository } from "./types";
import { AutoSyncManager } from "./providers/AutoSyncManager";
import { RepositoriesViewProvider } from "./providers/RepositoriesViewProvider";
import { LogsViewProvider } from "./providers/LogsViewProvider";
import { ConfigViewProvider } from "./providers/ConfigViewProvider";
import { ConfigWizardProvider } from "./providers/ConfigWizardProvider";
import { HistoryManager } from "./providers/HistoryManager";
import { HistoryViewProvider } from "./providers/HistoryViewProvider";
import { HistoryTreeItem } from "./types/history";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // 获取插件版本号
  const version =
    vscode.extensions.getExtension("aa12gq.stack-file-sync")?.packageJSON
      .version || "unknown";

  // 创建输出通道
  const outputChannel = vscode.window.createOutputChannel("Stack File Sync");

  // 创建日志视图提供者
  const logsProvider = new LogsViewProvider(context.extensionUri);

  // 创建状态栏项
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left
  );
  statusBarItem.command = "stack-file-sync.syncFiles";
  statusBarItem.text = `$(sync) 同步文件 v${version}`;
  statusBarItem.tooltip = "同步远程仓库文件";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // 添加输出面板按钮
  const outputButton = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left
  );
  outputButton.text = `$(output) 同步日志 v${version}`;
  outputButton.tooltip = "显示同步日志";
  outputButton.command = "stack-file-sync.showOutput";
  outputButton.show();
  context.subscriptions.push(outputButton);

  console.log(`Stack File Sync v${version} is now active!`);
  outputChannel.appendLine(`Stack File Sync v${version} 已激活`);

  // 创建自动同步管理器
  const autoSyncManager = new AutoSyncManager(
    outputChannel,
    statusBarItem,
    context
  );
  autoSyncManager.setLogsProvider(logsProvider);

  // 启动自动同步
  autoSyncManager.startAll();
  outputChannel.appendLine("\n[自动同步] 初始化完成，开始监听配置变更...");

  // 监听配置变化
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("stackFileSync.repositories")) {
        outputChannel.appendLine(
          "\n[自动同步] 检测到配置变更，重新启动自动同步..."
        );
        autoSyncManager.startAll();
      }
    })
  );

  // 在插件停用时停止所有自动同步
  context.subscriptions.push({
    dispose: () => {
      outputChannel.appendLine("\n[自动同步] 停止所有自动同步任务...");
      autoSyncManager.stopAll();
    },
  });

  // 注册显示输出面板的命令
  context.subscriptions.push(
    vscode.commands.registerCommand("stack-file-sync.showOutput", () => {
      outputChannel.show();
    })
  );

  // 注册配置同步命令
  context.subscriptions.push(
    vscode.commands.registerCommand("stack-file-sync.configureSync", () => {
      vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "stackFileSync"
      );
    })
  );

  // 注册同步文件命令
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "stack-file-sync.syncFiles",
      async (repo?: Repository) => {
        try {
          // 显示输出面板
          outputChannel.show();

          // 显示多步骤进度
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: "文件同步",
              cancellable: true,
            },
            async (progress, token) => {
              try {
                // 设置进度对象
                autoSyncManager.setProgress(progress);
                progress.report({ message: "正在准备同步..." });

                // 更新状态栏
                statusBarItem.text = "$(sync~spin) 正在同步...";
                statusBarItem.backgroundColor = new vscode.ThemeColor(
                  "statusBarItem.warningBackground"
                );

                // 检查工作区
                if (!vscode.workspace.workspaceFolders?.length) {
                  throw new Error("请先打开一个工作区文件夹");
                }

                // 获取配置
                const config =
                  vscode.workspace.getConfiguration("stackFileSync");
                const repositories: Repository[] =
                  config.get("repositories") || [];

                if (!repositories.length) {
                  throw new Error("请先配置仓库信息");
                }

                // 如果没有指定仓库，则显示选择对话框
                let selectedRepo:
                  | { label: string; description: string; repo: Repository }
                  | undefined;

                if (!repo) {
                  selectedRepo = await vscode.window.showQuickPick(
                    repositories.map((repo) => ({
                      label: repo.name,
                      description: repo.url,
                      repo,
                    })),
                    {
                      placeHolder: "选择要同步的仓库",
                      ignoreFocusOut: true,
                      matchOnDescription: true,
                      matchOnDetail: true,
                      title: "选择要同步的仓库",
                    }
                  );

                  if (!selectedRepo) {
                    // 恢复状态栏
                    statusBarItem.text = `$(sync) 同步文件 v${version}`;
                    statusBarItem.backgroundColor = undefined;
                    outputChannel.appendLine("\n用户取消了仓库选择");
                    vscode.window.showInformationMessage("已取消同步操作");
                    return;
                  }
                } else {
                  // 使用传入的仓库
                  selectedRepo = {
                    label: repo.name,
                    description: repo.url,
                    repo: repo,
                  };
                }

                // 执行同步
                if (repo) {
                  // 如果是从树视图点击的（已开启自动同步），直接同步
                  await autoSyncManager.checkAndSync(selectedRepo.repo);
                } else {
                  // 如果是手动同步，先获取可同步的文件列表
                  const files = await autoSyncManager.getAvailableFiles(
                    selectedRepo.repo
                  );

                  if (!files || files.length === 0) {
                    statusBarItem.text = `$(sync) 同步文件 v${version}`;
                    statusBarItem.backgroundColor = undefined;
                    outputChannel.appendLine("\n没有找到可同步的文件");
                    vscode.window.showInformationMessage(
                      "没有找到可同步的文件"
                    );
                    return;
                  }

                  // 显示文件选择对话框
                  const selectedFiles = await vscode.window.showQuickPick(
                    files.map((file) => ({
                      label: file,
                      picked: true,
                    })),
                    {
                      canPickMany: true,
                      placeHolder: "选择要同步的文件",
                      title: "选择要同步的文件",
                    }
                  );

                  if (!selectedFiles || selectedFiles.length === 0) {
                    statusBarItem.text = `$(sync) 同步文件 v${version}`;
                    statusBarItem.backgroundColor = undefined;
                    outputChannel.appendLine("\n用户取消了文件选择");
                    vscode.window.showInformationMessage("已取消同步操作");
                    return;
                  }

                  // 更新仓库的文件列表
                  const tempRepo = { ...selectedRepo.repo };
                  tempRepo.selectedFiles = selectedFiles.map((f) => f.label);
                  await autoSyncManager.checkAndSync(tempRepo);
                }

                // 恢复状态栏
                statusBarItem.text = `$(sync) 同步文件 v${version}`;
                statusBarItem.backgroundColor = undefined;
              } catch (error) {
                // 恢复状态栏
                statusBarItem.text = `$(sync) 同步文件 v${version}`;
                statusBarItem.backgroundColor = undefined;

                const errorMessage =
                  error instanceof Error ? error.message : String(error);
                outputChannel.appendLine(`\n❌ 同步失败: ${errorMessage}`);
                vscode.window.showErrorMessage(`同步失败: ${errorMessage}`);
              }
            }
          );
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          outputChannel.appendLine(`\n❌ 同步失败: ${errorMessage}`);
          vscode.window.showErrorMessage(`同步失败: ${errorMessage}`);
        }
      }
    )
  );

  // 注册仓库视图
  const repositoriesProvider = new RepositoriesViewProvider(autoSyncManager);
  vscode.window.registerTreeDataProvider(
    "stack-file-sync-repositories",
    repositoriesProvider
  );

  // 注册启用自动同步命令
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "stack-file-sync.enableAutoSync",
      async (repo: Repository) => {
        const config = vscode.workspace.getConfiguration("stackFileSync");
        const repositories: Repository[] = config.get("repositories") || [];
        const index = repositories.findIndex((r) => r.name === repo.name);

        if (index !== -1) {
          repositories[index].autoSync = {
            enabled: true,
            interval: repositories[index].autoSync?.interval || 300,
          };
          await config.update(
            "repositories",
            repositories,
            vscode.ConfigurationTarget.Global
          );
          repositoriesProvider.refresh();
          outputChannel.appendLine(`\n[配置] 已启用 ${repo.name} 的自动同步`);
          outputChannel.appendLine(
            `[配置] 同步间隔: ${repositories[index].autoSync.interval}秒`
          );

          // 立即重启自动同步管理器
          outputChannel.appendLine("[自动同步] 正在重新启动自动同步...");
          autoSyncManager.startAll();
        }
      }
    )
  );

  // 注册禁用自动同步命令
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "stack-file-sync.disableAutoSync",
      async (repo: Repository) => {
        const config = vscode.workspace.getConfiguration("stackFileSync");
        const repositories: Repository[] = config.get("repositories") || [];
        const index = repositories.findIndex((r) => r.name === repo.name);

        if (index !== -1) {
          const interval = repositories[index].autoSync?.interval || 300;
          repositories[index].autoSync = {
            enabled: false,
            interval: interval,
          };
          await config.update(
            "repositories",
            repositories,
            vscode.ConfigurationTarget.Global
          );
          repositoriesProvider.refresh();
          outputChannel.appendLine(`\n[配置] 已禁用 ${repo.name} 的自动同步`);

          // 立即重启自动同步管理器
          outputChannel.appendLine("[自动同步] 正在重新启动自动同步...");
          autoSyncManager.startAll();
        }
      }
    )
  );

  // 注册日志视图
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "stack-file-sync-logs",
      logsProvider
    )
  );

  // 创建配置视图提供者
  const configProvider = new ConfigViewProvider(context.extensionUri);

  // 注册配置视图
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "stack-file-sync-config",
      configProvider
    )
  );

  // 注册刷新仓库列表的命令
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "stack-file-sync.refreshRepositories",
      () => {
        repositoriesProvider.refresh();
      }
    )
  );

  // 初始化历史记录管理器
  const historyManager = HistoryManager.getInstance(context);

  // 注册历史记录视图
  const historyViewProvider = new HistoryViewProvider(context, historyManager);
  vscode.window.registerTreeDataProvider(
    "stackFileSync.historyView",
    historyViewProvider
  );

  // 注册清除历史记录命令
  context.subscriptions.push(
    vscode.commands.registerCommand("stackFileSync.clearHistory", async () => {
      const answer = await vscode.window.showWarningMessage(
        "Are you sure you want to clear all sync history?",
        { modal: true },
        "Yes",
        "No"
      );

      if (answer === "Yes") {
        await historyManager.clearHistory();
        historyViewProvider.refresh();
        vscode.window.showInformationMessage(
          "Sync history cleared successfully"
        );
      }
    })
  );

  // 注册删除单个历史记录命令
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "stackFileSync.deleteHistoryItem",
      async (item: HistoryTreeItem) => {
        await historyManager.deleteHistoryItem(item.id);
        historyViewProvider.refresh();
        vscode.window.showInformationMessage(
          "History item deleted successfully"
        );
      }
    )
  );

  // 在同步完成后记录历史
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("stackFileSync")) {
        historyViewProvider.refresh();
      }
    })
  );

  // 注册配置向导视图
  const configWizardProvider = new ConfigWizardProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "stack-file-sync-config-wizard",
      configWizardProvider
    )
  );

  // 注册打开配置向导的命令
  context.subscriptions.push(
    vscode.commands.registerCommand("stack-file-sync.openConfigWizard", () => {
      vscode.commands.executeCommand("stack-file-sync-config-wizard.focus");
    })
  );

  // 注册删除仓库命令
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "stack-file-sync.deleteRepository",
      async (repo: Repository) => {
        const answer = await vscode.window.showWarningMessage(
          `确定要删除仓库 "${repo.name}" 吗？`,
          { modal: true },
          "确定",
          "取消"
        );

        if (answer === "确定") {
          const config = vscode.workspace.getConfiguration("stackFileSync");
          const repositories: Repository[] = config.get("repositories") || [];
          const index = repositories.findIndex((r) => r.name === repo.name);

          if (index !== -1) {
            repositories.splice(index, 1);
            await config.update(
              "repositories",
              repositories,
              vscode.ConfigurationTarget.Global
            );
            repositoriesProvider.refresh();
            outputChannel.appendLine(`\n[配置] 已删除仓库 ${repo.name}`);

            // 如果仓库开启了自动同步，需要重启自动同步管理器
            if (repo.autoSync?.enabled) {
              outputChannel.appendLine("[自动同步] 正在重新启动自动同步...");
              autoSyncManager.startAll();
            }

            vscode.window.showInformationMessage(`已删除仓库 "${repo.name}"`);
          }
        }
      }
    )
  );
}
