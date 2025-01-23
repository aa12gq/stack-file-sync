// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { simpleGit } from "simple-git";
import * as os from "os";

// 自动同步相关的类型定义
interface AutoSyncConfig {
  enabled: boolean;
  interval: number;
}

interface Repository {
  name: string;
  url: string;
  branch: string;
  sourceDirectory: string;
  targetDirectory: string;
  filePatterns?: string[];
  excludePatterns?: string[];
  postSyncCommands?: PostSyncCommand[];
  autoSync?: AutoSyncConfig;
}

interface PostSyncCommand {
  directory: string;
  command: string;
}

// 自动同步管理器
class AutoSyncManager {
  private timers: Map<string, NodeJS.Timer> = new Map();
  private outputChannel: vscode.OutputChannel;
  private statusBarItem: vscode.StatusBarItem;
  private lastSyncState: Map<string, Map<string, number>> = new Map(); // 记录每个仓库的文件状态

  constructor(
    outputChannel: vscode.OutputChannel,
    statusBarItem: vscode.StatusBarItem
  ) {
    this.outputChannel = outputChannel;
    this.statusBarItem = statusBarItem;
  }

  // 启动所有自动同步任务
  public startAll() {
    const config = vscode.workspace.getConfiguration("stackFileSync");
    const repositories: Repository[] = config.get("repositories") || [];

    // 停止不再需要自动同步的任务
    for (const [repoName, timer] of this.timers.entries()) {
      const repo = repositories.find((r) => r.name === repoName);
      if (!repo || !repo.autoSync?.enabled) {
        clearInterval(timer as NodeJS.Timeout);
        this.timers.delete(repoName);
        this.outputChannel.appendLine(
          `\n[自动同步] 停止 ${repoName} 的自动同步`
        );
      }
    }

    // 启动或更新需要自动同步的任务
    for (const repo of repositories) {
      if (repo.autoSync?.enabled) {
        const existingTimer = this.timers.get(repo.name);
        if (existingTimer) {
          // 如果间隔时间变化，需要重新启动
          const currentInterval = repo.autoSync.interval * 1000;
          if (this.getTimerInterval(existingTimer) !== currentInterval) {
            clearInterval(existingTimer as NodeJS.Timeout);
            this.startAutoSync(repo);
            this.outputChannel.appendLine(
              `\n[自动同步] 更新 ${repo.name} 的同步间隔为 ${repo.autoSync.interval}秒`
            );
          }
        } else {
          this.startAutoSync(repo);
        }
      }
    }
  }

  // 停止所有自动同步任务
  public stopAll() {
    for (const [repoName, timer] of this.timers.entries()) {
      clearInterval(timer as NodeJS.Timeout);
      this.outputChannel.appendLine(`\n[自动同步] 停止 ${repoName} 的自动同步`);
    }
    this.timers.clear();
  }

  // 获取定时器的间隔时间
  private getTimerInterval(timer: NodeJS.Timer): number {
    return (timer as any)._repeat;
  }

  // 为单个仓库启动自动同步
  private startAutoSync(repo: Repository) {
    if (!repo.autoSync?.enabled || !repo.autoSync.interval) {
      return;
    }

    const intervalMs = repo.autoSync.interval * 1000; // 转换为毫秒

    // 如果已经存在定时器，先停止它
    const existingTimer = this.timers.get(repo.name);
    if (existingTimer) {
      clearInterval(existingTimer as NodeJS.Timeout);
      this.timers.delete(repo.name);
    }

    this.outputChannel.appendLine(
      `\n[自动同步] 启动 ${repo.name} 的自动同步，间隔: ${repo.autoSync.interval}秒`
    );

    const timer = setInterval(async () => {
      try {
        await this.checkAndSync(repo);
      } catch (error) {
        this.outputChannel.appendLine(
          `[自动同步] ${repo.name} 同步失败: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }, intervalMs);

    this.timers.set(repo.name, timer);
  }

  // 检查并执行同步
  private async checkAndSync(repo: Repository) {
    this.outputChannel.appendLine(`\n[自动同步] 检查 ${repo.name} 的更新...`);

    // 创建临时目录
    const tempDir = path.join(
      os.tmpdir(),
      `stack-file-sync-auto-${Date.now()}`
    );
    fs.mkdirSync(tempDir, { recursive: true });

    try {
      const git = simpleGit();

      // 克隆仓库
      await git.clone(repo.url, tempDir, [
        "--depth",
        "1",
        "--filter=blob:none",
        "--no-checkout",
      ]);

      await git.cwd(tempDir);
      await git.checkout(repo.branch);

      // 初始化 sparse-checkout
      await git.raw(["sparse-checkout", "init", "--cone"]);
      await git.raw(["sparse-checkout", "set", repo.sourceDirectory]);

      // 检出文件
      await git.checkout(repo.branch);

      // 检查是否有更新
      const hasChanges = await this.checkForChanges(repo, tempDir);

      if (hasChanges) {
        this.outputChannel.appendLine(
          `[自动同步] 检测到 ${repo.name} 有更新，开始同步...`
        );

        // 获取工作区根目录
        if (!vscode.workspace.workspaceFolders?.length) {
          throw new Error("请先打开一个工作区文件夹");
        }
        const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;

        // 准备同步
        const sourceDir = path.join(tempDir, repo.sourceDirectory);
        const targetDir = path.isAbsolute(repo.targetDirectory)
          ? repo.targetDirectory
          : path.join(workspaceRoot, repo.targetDirectory);

        // 确保目标目录存在
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }

        // 获取所有匹配的文件
        const filePatterns = repo.filePatterns || ["**/*.proto"];
        const excludePatterns = repo.excludePatterns || ["**/backend/**"];

        // 递归复制文件
        function copyFiles(
          dir: string,
          baseDir: string,
          output: vscode.OutputChannel
        ) {
          const items = fs.readdirSync(dir);

          for (const item of items) {
            const fullPath = path.join(dir, item);
            const stat = fs.statSync(fullPath);

            if (stat.isDirectory()) {
              copyFiles(fullPath, baseDir, output);
            } else {
              const relativePath = path.relative(baseDir, fullPath);
              const targetPath = path.join(targetDir, relativePath);
              const targetDirPath = path.dirname(targetPath);

              // 确保目标目录存在
              if (!fs.existsSync(targetDirPath)) {
                fs.mkdirSync(targetDirPath, { recursive: true });
              }

              // 复制文件
              fs.copyFileSync(fullPath, targetPath);
              output.appendLine(`[自动同步] 更新文件: ${relativePath}`);
            }
          }
        }

        copyFiles(sourceDir, sourceDir, this.outputChannel);

        // 执行后处理命令
        if (repo.postSyncCommands && repo.postSyncCommands.length > 0) {
          this.outputChannel.appendLine("\n[自动同步] 执行后处理命令:");
          for (const cmd of repo.postSyncCommands) {
            try {
              const cmdDir = path.isAbsolute(cmd.directory)
                ? cmd.directory
                : path.join(workspaceRoot, cmd.directory);

              // 检查目录是否存在
              if (!fs.existsSync(cmdDir)) {
                this.outputChannel.appendLine(`警告: 目录不存在 ${cmdDir}`);
                continue;
              }

              this.outputChannel.appendLine(
                `\n在目录 ${cmdDir} 中执行命令: ${cmd.command}`
              );

              // 执行命令
              const { execSync } = require("child_process");
              const result = execSync(cmd.command, {
                cwd: cmdDir,
                encoding: "utf8",
                stdio: ["inherit", "pipe", "pipe"],
              });

              this.outputChannel.appendLine("命令输出:");
              this.outputChannel.appendLine(result);
              this.outputChannel.appendLine("✅ 命令执行成功");
            } catch (error) {
              this.outputChannel.appendLine(
                `❌ 命令执行失败: ${
                  error instanceof Error ? error.message : String(error)
                }`
              );
            }
          }
        }

        this.outputChannel.appendLine(`[自动同步] ${repo.name} 同步完成`);
      } else {
        this.outputChannel.appendLine(`[自动同步] ${repo.name} 没有检测到更新`);
      }
    } finally {
      // 清理临时目录
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (error) {
        this.outputChannel.appendLine(
          `[自动同步] 清理临时目录失败: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }

  // 检查是否有文件更新
  public async checkForChanges(
    repo: Repository,
    tempDir: string
  ): Promise<boolean> {
    const sourceDir = path.join(tempDir, repo.sourceDirectory);
    const targetDir = path.isAbsolute(repo.targetDirectory)
      ? repo.targetDirectory
      : path.join(
          vscode.workspace.workspaceFolders![0].uri.fsPath,
          repo.targetDirectory
        );

    if (!fs.existsSync(sourceDir)) {
      return true; // 如果源目录不存在，认为需要同步
    }

    const filePatterns = repo.filePatterns || ["**/*.proto"];
    const excludePatterns = repo.excludePatterns || ["**/backend/**"];

    // 获取当前仓库的文件状态缓存
    const repoCache =
      this.lastSyncState.get(repo.url) || new Map<string, number>();

    // 递归检查文件
    function checkFiles(dir: string, baseDir: string): boolean {
      const items = fs.readdirSync(dir);

      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          if (checkFiles(fullPath, baseDir)) {
            return true;
          }
        } else {
          const relativePath = path.relative(baseDir, fullPath);
          const lastModified = repoCache.get(relativePath);

          if (!lastModified || stat.mtime.getTime() > lastModified) {
            return true;
          }
        }
      }

      return false;
    }

    const hasChanges = checkFiles(sourceDir, sourceDir);

    if (hasChanges) {
      // 更新文件状态缓存
      function updateCache(dir: string, baseDir: string) {
        const items = fs.readdirSync(dir);

        for (const item of items) {
          const fullPath = path.join(dir, item);
          const stat = fs.statSync(fullPath);

          if (stat.isDirectory()) {
            updateCache(fullPath, baseDir);
          } else {
            const relativePath = path.relative(baseDir, fullPath);
            repoCache.set(relativePath, stat.mtime.getTime());
          }
        }
      }

      updateCache(sourceDir, sourceDir);
      this.lastSyncState.set(repo.url, repoCache);
    }

    return hasChanges;
  }
}

// 仓库视图提供者
class RepositoriesViewProvider implements vscode.TreeDataProvider<Repository> {
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
    } else {
      treeItem.contextValue = "autoSyncDisabled";
      treeItem.iconPath = new vscode.ThemeIcon("sync");
    }

    // 添加命令
    treeItem.command = {
      command: "stack-file-sync.syncFiles",
      title: "同步文件",
      arguments: [element],
    };

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

// 日志视图提供者
class LogsViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>同步日志</title>
        <script>
          window.addEventListener('message', event => {
            const logs = document.getElementById('logs');
            const logEntry = document.createElement('div');
            logEntry.textContent = event.data.message;
            logs.appendChild(logEntry);
          });
        </script>
      </head>
      <body>
        <div id="logs"></div>
      </body>
      </html>
    `;
  }

  public addLog(message: string) {
    if (this._view) {
      this._view.webview.postMessage({ message });
    }
  }
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // 获取插件版本号
  const version =
    vscode.extensions.getExtension("aa12gq.stack-file-sync")?.packageJSON
      .version || "unknown";

  // 创建输出通道
  const outputChannel = vscode.window.createOutputChannel("Stack File Sync");

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
  const autoSyncManager = new AutoSyncManager(outputChannel, statusBarItem);

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
  let showOutputDisposable = vscode.commands.registerCommand(
    "stack-file-sync.showOutput",
    () => {
      outputChannel.show();
    }
  );

  // 注册配置同步命令
  let configureDisposable = vscode.commands.registerCommand(
    "stack-file-sync.configureSync",
    () => {
      vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "stackFileSync"
      );
    }
  );

  // 注册同步文件命令
  let syncFilesDisposable = vscode.commands.registerCommand(
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
            // 更新状态栏
            statusBarItem.text = "$(sync~spin) 同步中";
            statusBarItem.backgroundColor = new vscode.ThemeColor(
              "statusBarItem.warningBackground"
            );

            try {
              // 检查工作区
              if (!vscode.workspace.workspaceFolders?.length) {
                throw new Error("请先打开一个工作区文件夹");
              }
              const workspaceRoot =
                vscode.workspace.workspaceFolders[0].uri.fsPath;

              // 获取配置
              const config = vscode.workspace.getConfiguration("stackFileSync");
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

              // 使用选中仓库的配置
              const selectedRepository = selectedRepo.repo;
              const filePatterns = selectedRepository.filePatterns || [
                "**/*.proto",
              ];
              const excludePatterns = selectedRepository.excludePatterns || [
                "**/backend/**",
              ];
              const targetDirectory = selectedRepository.targetDirectory;

              outputChannel.appendLine("\n=== 开始同步文件 ===");
              outputChannel.appendLine("1. 检查配置:");
              outputChannel.appendLine(`- 工作区: ${workspaceRoot}`);
              outputChannel.appendLine(`- 目标目录: ${targetDirectory}`);
              outputChannel.appendLine(
                `- 文件模式: ${filePatterns.join(", ")}`
              );
              outputChannel.appendLine(
                `- 排除模式: ${excludePatterns.join(", ")}`
              );
              outputChannel.appendLine(`- 仓库数量: ${repositories.length}`);

              if (!targetDirectory) {
                throw new Error("请先配置目标目录");
              }

              // 验证目标目录
              const normalizedTargetDir = path.normalize(
                path.isAbsolute(targetDirectory)
                  ? targetDirectory
                  : path.join(workspaceRoot, targetDirectory)
              );

              if (!fs.existsSync(normalizedTargetDir)) {
                const create = await vscode.window.showQuickPick(
                  [
                    { label: "是", value: true },
                    { label: "否", value: false },
                  ],
                  {
                    placeHolder: `目标目录 ${normalizedTargetDir} 不存在，是否创建？`,
                  }
                );

                if (!create?.value) {
                  throw new Error("用户取消了操作");
                }

                fs.mkdirSync(normalizedTargetDir, { recursive: true });
                outputChannel.appendLine(
                  `创建目标目录: ${normalizedTargetDir}`
                );
              }

              // 步骤 2: 仓库选择
              progress.report({
                message: "克隆仓库...",
                increment: 30,
              });
              // 创建临时目录
              const tempDir = path.join(
                os.tmpdir(),
                `stack-file-sync-${Date.now()}`
              );
              fs.mkdirSync(tempDir, { recursive: true });
              outputChannel.appendLine(`创建临时目录: ${tempDir}`);

              const git = simpleGit();
              await vscode.window.withProgress(
                {
                  location: vscode.ProgressLocation.Notification,
                  title: "正在克隆仓库...",
                  cancellable: false,
                },
                async (progress) => {
                  outputChannel.appendLine("\n3. 克隆仓库:");
                  outputChannel.appendLine(`- 仓库: ${selectedRepo.repo.url}`);
                  outputChannel.appendLine(
                    `- 分支: ${selectedRepo.repo.branch}`
                  );
                  outputChannel.appendLine(`- 临时目录: ${tempDir}`);

                  progress.report({ message: "克隆中..." });
                  outputChannel.appendLine("- 开始克隆...");

                  // 参考 clone-proto.sh 的克隆方式
                  await git.clone(selectedRepo.repo.url, tempDir, [
                    "--depth",
                    "1",
                    "--filter=blob:none",
                    "--no-checkout",
                  ]);

                  await git.cwd(tempDir);

                  // 切换到指定分支
                  progress.report({ message: "切换分支..." });
                  outputChannel.appendLine("- 切换分支...");
                  await git.checkout(selectedRepo.repo.branch);

                  // 初始化 sparse-checkout
                  outputChannel.appendLine("- 配置 sparse-checkout...");
                  const sourceDir = selectedRepo.repo.sourceDirectory;
                  await git.raw(["sparse-checkout", "init", "--cone"]);
                  await git.raw(["sparse-checkout", "set", sourceDir]);

                  // 检出文件
                  progress.report({ message: "检出文件..." });
                  outputChannel.appendLine("- 检出文件...");
                  await git.checkout(selectedRepo.repo.branch);

                  outputChannel.appendLine(`  路径: ${sourceDir}`);
                  outputChannel.appendLine("- 克隆完成");
                }
              );

              // 步骤 4: 搜索文件
              progress.report({
                message: "搜索文件...",
                increment: 50,
              });
              const allFiles: vscode.Uri[] = [];
              // 检查克隆后的目录结构
              const repoDir = path.join(
                tempDir,
                selectedRepo.repo.sourceDirectory
              );

              outputChannel.appendLine("\n4. 检查目录结构:");
              outputChannel.appendLine(`- 临时目录: ${tempDir}`);
              outputChannel.appendLine(`- 源目录: ${repoDir}`);
              outputChannel.appendLine(`- 目标目录: ${normalizedTargetDir}`);

              // 检查指定目录是否存在
              if (!fs.existsSync(repoDir)) {
                throw new Error(`指定的源目录不存在: ${repoDir}`);
              }

              // 检查是否有更新
              const hasChanges = await autoSyncManager.checkForChanges(
                selectedRepository,
                tempDir
              );

              if (hasChanges) {
                outputChannel.appendLine(
                  `[自动同步] 检测到 ${selectedRepository.name} 有更新，开始同步...`
                );

                // 获取工作区根目录
                if (!vscode.workspace.workspaceFolders?.length) {
                  throw new Error("请先打开一个工作区文件夹");
                }
                const workspaceRoot =
                  vscode.workspace.workspaceFolders[0].uri.fsPath;

                // 准备同步
                const sourceDir = path.join(
                  tempDir,
                  selectedRepository.sourceDirectory
                );
                const targetDir = path.isAbsolute(
                  selectedRepository.targetDirectory
                )
                  ? selectedRepository.targetDirectory
                  : path.join(
                      workspaceRoot,
                      selectedRepository.targetDirectory
                    );

                // 确保目标目录存在
                if (!fs.existsSync(targetDir)) {
                  fs.mkdirSync(targetDir, { recursive: true });
                }

                // 获取所有匹配的文件
                const filePatterns = selectedRepository.filePatterns || [
                  "**/*.proto",
                ];
                const excludePatterns = selectedRepository.excludePatterns || [
                  "**/backend/**",
                ];

                // 递归复制文件
                function copyFiles(
                  dir: string,
                  baseDir: string,
                  output: vscode.OutputChannel
                ) {
                  const items = fs.readdirSync(dir);

                  for (const item of items) {
                    const fullPath = path.join(dir, item);
                    const stat = fs.statSync(fullPath);

                    if (stat.isDirectory()) {
                      copyFiles(fullPath, baseDir, output);
                    } else {
                      const relativePath = path.relative(baseDir, fullPath);
                      const targetPath = path.join(targetDir, relativePath);
                      const targetDirPath = path.dirname(targetPath);

                      // 确保目标目录存在
                      if (!fs.existsSync(targetDirPath)) {
                        fs.mkdirSync(targetDirPath, { recursive: true });
                      }

                      // 复制文件
                      fs.copyFileSync(fullPath, targetPath);
                      output.appendLine(`[自动同步] 更新文件: ${relativePath}`);
                    }
                  }
                }

                copyFiles(sourceDir, sourceDir, outputChannel);

                // 执行后处理命令
                if (
                  selectedRepository.postSyncCommands &&
                  selectedRepository.postSyncCommands.length > 0
                ) {
                  outputChannel.appendLine("\n[自动同步] 执行后处理命令:");
                  for (const cmd of selectedRepository.postSyncCommands) {
                    try {
                      const cmdDir = path.isAbsolute(cmd.directory)
                        ? cmd.directory
                        : path.join(workspaceRoot, cmd.directory);

                      // 检查目录是否存在
                      if (!fs.existsSync(cmdDir)) {
                        outputChannel.appendLine(`警告: 目录不存在 ${cmdDir}`);
                        continue;
                      }

                      outputChannel.appendLine(
                        `\n在目录 ${cmdDir} 中执行命令: ${cmd.command}`
                      );

                      // 执行命令
                      const { execSync } = require("child_process");
                      const result = execSync(cmd.command, {
                        cwd: cmdDir,
                        encoding: "utf8",
                        stdio: ["inherit", "pipe", "pipe"],
                      });

                      outputChannel.appendLine("命令输出:");
                      outputChannel.appendLine(result);
                      outputChannel.appendLine("✅ 命令执行成功");
                    } catch (error) {
                      outputChannel.appendLine(
                        `❌ 命令执行失败: ${
                          error instanceof Error ? error.message : String(error)
                        }`
                      );
                    }
                  }
                }

                outputChannel.appendLine(
                  `[自动同步] ${selectedRepository.name} 同步完成`
                );
              } else {
                outputChannel.appendLine(
                  `[自动同步] ${selectedRepository.name} 没有检测到更新`
                );
              }
            } catch (error) {
              outputChannel.appendLine(
                `❌ 同步失败: ${
                  error instanceof Error ? error.message : String(error)
                }`
              );
            }
          }
        );
      } catch (error) {
        outputChannel.appendLine(
          `❌ 同步失败: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
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
            interval: repositories[index].autoSync?.interval || 300, // 保留原有间隔或使用默认值
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
            interval: interval, // 保留原有间隔
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
  const logsProvider = new LogsViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "stack-file-sync-logs",
      logsProvider
    )
  );

  // 将所有命令添加到上下文订阅中
  context.subscriptions.push(
    showOutputDisposable,
    configureDisposable,
    syncFilesDisposable
  );
}
