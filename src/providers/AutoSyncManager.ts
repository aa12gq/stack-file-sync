import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { simpleGit } from "simple-git";
import * as os from "os";
import { Repository } from "../types";
import { Minimatch } from "minimatch";
import { LogsViewProvider } from "../providers/LogsViewProvider";
import { HistoryManager } from "./HistoryManager";

export class AutoSyncManager {
  private timers: Map<string, NodeJS.Timer> = new Map();
  private lastSyncState: Map<string, Map<string, number>> = new Map(); // 记录每个仓库的文件状态
  private outputChannel: vscode.OutputChannel;
  private progress:
    | vscode.Progress<{ message?: string; increment?: number }>
    | undefined;
  private totalFiles: number = 0;
  private processedFiles: number = 0;
  private logsProvider?: LogsViewProvider;
  private historyManager: HistoryManager;
  private syncedFiles: string[] = [];

  constructor(
    outputChannel: vscode.OutputChannel,
    private statusBarItem: vscode.StatusBarItem,
    private context: vscode.ExtensionContext
  ) {
    this.outputChannel = outputChannel;
    this.historyManager = HistoryManager.getInstance(context);
  }

  public setLogsProvider(logsProvider: LogsViewProvider) {
    this.logsProvider = logsProvider;
  }

  private appendLine(message: string) {
    this.outputChannel.appendLine(message);
    this.logsProvider?.addLog(message);
  }

  // 设置进度对象
  public setProgress(
    progress: vscode.Progress<{ message?: string; increment?: number }>
  ) {
    this.progress = progress;
  }

  // 重置进度计数
  private resetProgress() {
    this.totalFiles = 0;
    this.processedFiles = 0;
  }

  // 更新进度
  private updateProgress(message: string, increment?: number) {
    if (this.progress) {
      this.progress.report({
        message,
        increment,
      });
    }
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
        this.appendLine(`\n[自动同步] 停止 ${repoName} 的自动同步`);
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
            this.appendLine(
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
      this.appendLine(`\n[自动同步] 停止 ${repoName} 的自动同步`);
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

    this.appendLine(
      `\n[自动同步] 启动 ${repo.name} 的自动同步，间隔: ${repo.autoSync.interval}秒`
    );

    const timer = setInterval(async () => {
      try {
        await this.checkAndSync(repo);
      } catch (error) {
        this.appendLine(
          `[自动同步] ${repo.name} 同步失败: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }, intervalMs);

    this.timers.set(repo.name, timer);
  }

  // 获取可同步的文件列表
  public async getAvailableFiles(repo: Repository): Promise<string[]> {
    // 创建临时目录
    const tempDir = path.join(
      os.tmpdir(),
      `stack-file-sync-list-${Date.now()}`
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

      // 获取文件列表
      const sourceDir = path.join(tempDir, repo.sourceDirectory);
      const filePatterns = repo.filePatterns || ["**/*.proto"];
      const excludePatterns = repo.excludePatterns || ["**/backend/**"];
      const files: string[] = [];

      // 递归获取文件列表
      const getFiles = (dir: string, baseDir: string) => {
        const items = fs.readdirSync(dir);

        for (const item of items) {
          const fullPath = path.join(dir, item);
          const stat = fs.statSync(fullPath);

          if (stat.isDirectory()) {
            getFiles(fullPath, baseDir);
          } else {
            const relativePath = path.relative(baseDir, fullPath);
            files.push(relativePath);
          }
        }
      };

      // 获取并打印克隆的文件列表
      getFiles(sourceDir, sourceDir);
      this.appendLine(
        `\n[自动同步] ${repo.name} 克隆完成，共克隆了 ${files.length} 个文件：`
      );
      files.forEach((file) => {
        this.appendLine(`  - ${file}`);
      });

      // 过滤出可同步的文件
      return files.filter((relativePath) => {
        const isMatch = filePatterns.some((pattern) =>
          new Minimatch(pattern, { dot: true }).match(relativePath)
        );
        const isExcluded = excludePatterns.some((pattern) =>
          new Minimatch(pattern, { dot: true }).match(relativePath)
        );
        return isMatch && !isExcluded;
      });
    } finally {
      // 清理临时目录
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (error) {
        this.appendLine(
          `[自动同步] 清理临时目录失败: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }

  // 检查并执行同步
  public async checkAndSync(repo: Repository) {
    try {
      // 如果启用了内网同步
      if (repo.internalSync?.enabled) {
        await this.syncFromInternalNetwork(repo);
        return;
      }

      // 原有的 Git 仓库同步逻辑
      this.appendLine(`\n[自动同步] 检查 ${repo.name} 的更新...`);

      // 创建临时目录
      const tempDir = path.join(
        os.tmpdir(),
        `stack-file-sync-auto-${Date.now()}`
      );
      fs.mkdirSync(tempDir, { recursive: true });

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

      // 获取文件列表
      const sourceDir = path.join(tempDir, repo.sourceDirectory);
      const filePatterns = repo.filePatterns || ["**/*.proto"];
      const excludePatterns = repo.excludePatterns || ["**/backend/**"];
      const files: string[] = [];

      // 递归获取文件列表
      const getFiles = (dir: string, baseDir: string) => {
        const items = fs.readdirSync(dir);

        for (const item of items) {
          const fullPath = path.join(dir, item);
          const stat = fs.statSync(fullPath);

          if (stat.isDirectory()) {
            getFiles(fullPath, baseDir);
          } else {
            const relativePath = path.relative(baseDir, fullPath);
            files.push(relativePath);
          }
        }
      };

      // 获取并打印克隆的文件列表
      getFiles(sourceDir, sourceDir);
      this.appendLine(
        `\n[自动同步] ${repo.name} 克隆完成，共克隆了 ${files.length} 个文件：`
      );
      files.forEach((file) => {
        this.appendLine(`  - ${file}`);
      });

      // 过滤出可同步的文件
      const syncableFiles = files.filter((relativePath) => {
        const isMatch = filePatterns.some((pattern) =>
          new Minimatch(pattern, { dot: true }).match(relativePath)
        );
        const isExcluded = excludePatterns.some((pattern) =>
          new Minimatch(pattern, { dot: true }).match(relativePath)
        );
        return isMatch && !isExcluded;
      });

      // 检查是否有更新
      const hasChanges = await this.checkForChanges(repo, tempDir);

      if (hasChanges) {
        await this.syncFiles(repo, tempDir);
      } else {
        this.appendLine(`[自动同步] ${repo.name} 没有检测到更新`);
      }
    } catch (error) {
      throw error;
    }
  }

  // 检查是否有文件更新
  public async checkForChanges(
    repo: Repository,
    tempDir: string
  ): Promise<boolean> {
    const sourceDir = path.join(tempDir, repo.sourceDirectory);

    if (!fs.existsSync(sourceDir)) {
      return true; // 如果源目录不存在，认为需要同步
    }

    // 获取当前仓库的文件状态缓存
    const repoCache =
      this.lastSyncState.get(repo.url) || new Map<string, number>();

    // 递归检查文件
    const checkFiles = (dir: string, baseDir: string): boolean => {
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
    };

    const hasChanges = checkFiles(sourceDir, sourceDir);

    if (hasChanges) {
      // 更新文件状态缓存
      const updateCache = (dir: string, baseDir: string) => {
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
      };

      updateCache(sourceDir, sourceDir);
      this.lastSyncState.set(repo.url, repoCache);
    }

    return hasChanges;
  }

  // 同步文件
  private async syncFiles(repo: Repository, tempDir: string) {
    this.syncedFiles = []; // 重置同步文件列表
    const startTime = Date.now();

    try {
      if (!vscode.workspace.workspaceFolders?.length) {
        throw new Error("请先打开一个工作区文件夹");
      }

      const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
      const sourceDir = path.join(tempDir, repo.sourceDirectory);
      const targetDir = path.isAbsolute(repo.targetDirectory)
        ? repo.targetDirectory
        : path.join(workspaceRoot, repo.targetDirectory);

      // 确保目标目录存在
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      // 重置进度
      this.resetProgress();

      // 首先计算总文件数
      const countFiles = (dir: string, baseDir: string) => {
        const items = fs.readdirSync(dir);
        for (const item of items) {
          const fullPath = path.join(dir, item);
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            countFiles(fullPath, baseDir);
          } else {
            const relativePath = path.relative(baseDir, fullPath);
            if (
              !repo.selectedFiles ||
              repo.selectedFiles.includes(relativePath)
            ) {
              this.totalFiles++;
            }
          }
        }
      };

      countFiles(sourceDir, sourceDir);
      this.updateProgress(`准备同步 ${this.totalFiles} 个文件...`);

      // 递归复制文件
      const copyFiles = (dir: string, baseDir: string) => {
        const items = fs.readdirSync(dir);

        for (const item of items) {
          const fullPath = path.join(dir, item);
          const stat = fs.statSync(fullPath);

          if (stat.isDirectory()) {
            copyFiles(fullPath, baseDir);
          } else {
            const relativePath = path.relative(baseDir, fullPath);

            // 如果指定了要同步的文件列表，则只同步选中的文件
            if (
              repo.selectedFiles &&
              !repo.selectedFiles.includes(relativePath)
            ) {
              continue;
            }

            const targetPath = path.join(targetDir, relativePath);
            const targetDirPath = path.dirname(targetPath);

            // 确保目标目录存在
            if (!fs.existsSync(targetDirPath)) {
              fs.mkdirSync(targetDirPath, { recursive: true });
            }

            // 复制文件
            fs.copyFileSync(fullPath, targetPath);
            this.processedFiles++;
            this.syncedFiles.push(relativePath);

            // 更新进度
            const progressPercent = Math.round(
              (this.processedFiles / this.totalFiles) * 100
            );
            this.updateProgress(
              `正在同步: ${relativePath} (${this.processedFiles}/${this.totalFiles})`,
              100 / this.totalFiles
            );

            this.appendLine(`[自动同步] 更新文件: ${relativePath}`);
          }
        }
      };

      copyFiles(sourceDir, sourceDir);

      // 执行后处理命令
      if (repo.postSyncCommands?.length) {
        this.appendLine("\n[自动同步] 执行后处理命令:");
        for (const cmd of repo.postSyncCommands) {
          try {
            const cmdDir = path.isAbsolute(cmd.directory)
              ? cmd.directory
              : path.join(workspaceRoot, cmd.directory);

            if (!fs.existsSync(cmdDir)) {
              this.appendLine(`警告: 目录不存在 ${cmdDir}`);
              continue;
            }

            this.appendLine(`\n在目录 ${cmdDir} 中执行命令: ${cmd.command}`);

            const { execSync } = require("child_process");
            const result = execSync(cmd.command, {
              cwd: cmdDir,
              encoding: "utf8",
              stdio: ["inherit", "pipe", "pipe"],
            });

            this.appendLine("命令输出:");
            this.appendLine(result);
            this.appendLine("✅ 命令执行成功");
          } catch (error) {
            this.appendLine(
              `❌ 命令执行失败: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }
        }
      }

      this.appendLine(`[自动同步] ${repo.name} 同步完成`);

      // 记录成功的同步历史
      await this.historyManager.addHistoryItem({
        repository: repo.name,
        branch: repo.branch,
        files: this.syncedFiles,
        status: "success",
        duration: Date.now() - startTime,
        syncType: repo.autoSync?.enabled ? "auto" : "manual",
      });
    } catch (error) {
      // 记录失败的同步历史
      await this.historyManager.addHistoryItem({
        repository: repo.name,
        branch: repo.branch,
        files: this.syncedFiles,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
        syncType: repo.autoSync?.enabled ? "auto" : "manual",
      });

      throw error;
    }
  }

  // 添加内网同步方法
  private async syncFromInternalNetwork(repo: Repository) {
    this.appendLine(
      `\n[内网同步] 开始从 ${repo.internalSync!.networkPath} 同步文件...`
    );
    this.syncedFiles = [];
    const startTime = Date.now();

    try {
      if (!vscode.workspace.workspaceFolders?.length) {
        throw new Error("请先打开一个工作区文件夹");
      }

      let sourcePath = repo.internalSync!.networkPath;
      const isWindows = process.platform === "win32";

      // 如果路径以 // 开头，说明是网络路径
      if (sourcePath.startsWith("//")) {
        if (!isWindows) {
          // 对于 Mac/Linux 的网络路径，保持 //host/path 格式，但清理多余的斜杠
          sourcePath = sourcePath
            .replace(/\/\//g, "//")
            .replace(/\/\/\//g, "//");
        }
      }
      // 否则就是本地路径，保持原样

      const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
      const targetDir = path.isAbsolute(repo.targetDirectory)
        ? repo.targetDirectory
        : path.join(workspaceRoot, repo.targetDirectory);

      // 检查源路径是否可访问
      if (!fs.existsSync(sourcePath)) {
        throw new Error(`无法访问内网路径: ${sourcePath}`);
      }

      // 确保目标目录存在
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      // 重置进度
      this.resetProgress();

      // 获取要同步的文件列表
      const files = await this.getInternalFiles(sourcePath, repo);
      this.totalFiles = files.length;

      this.appendLine(`[内网同步] 找到 ${files.length} 个文件需要同步`);

      // 同步文件
      for (const file of files) {
        const sourceFilePath = path.join(sourcePath, file);
        const targetFilePath = path.join(targetDir, file);
        const targetFileDir = path.dirname(targetFilePath);

        // 确保目标文件夹存在
        if (!fs.existsSync(targetFileDir)) {
          fs.mkdirSync(targetFileDir, { recursive: true });
        }

        // 复制文件
        fs.copyFileSync(sourceFilePath, targetFilePath);
        this.processedFiles++;
        this.syncedFiles.push(file);

        // 更新进度
        const progressPercent = Math.round(
          (this.processedFiles / this.totalFiles) * 100
        );
        this.updateProgress(
          `正在同步: ${file} (${this.processedFiles}/${this.totalFiles})`,
          100 / this.totalFiles
        );

        this.appendLine(`[内网同步] 更新文件: ${file}`);
      }

      // 执行后处理命令
      if (repo.postSyncCommands?.length) {
        this.appendLine("\n[内网同步] 执行后处理命令:");
        for (const cmd of repo.postSyncCommands) {
          try {
            const cmdDir = path.isAbsolute(cmd.directory)
              ? cmd.directory
              : path.join(workspaceRoot, cmd.directory);

            if (!fs.existsSync(cmdDir)) {
              this.appendLine(`警告: 目录不存在 ${cmdDir}`);
              continue;
            }

            this.appendLine(`\n在目录 ${cmdDir} 中执行命令: ${cmd.command}`);

            const { execSync } = require("child_process");
            const result = execSync(cmd.command, {
              cwd: cmdDir,
              encoding: "utf8",
              stdio: ["inherit", "pipe", "pipe"],
            });

            this.appendLine("命令输出:");
            this.appendLine(result);
            this.appendLine("✅ 命令执行成功");
          } catch (error) {
            this.appendLine(
              `❌ 命令执行失败: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }
        }
      }

      // 记录成功的同步历史
      await this.historyManager.addHistoryItem({
        repository: repo.name,
        branch: "internal",
        files: this.syncedFiles,
        status: "success",
        duration: Date.now() - startTime,
        syncType: repo.autoSync?.enabled ? "auto" : "manual",
      });

      this.appendLine(`[内网同步] ${repo.name} 同步完成`);
    } catch (error) {
      // 记录失败的同步历史
      await this.historyManager.addHistoryItem({
        repository: repo.name,
        branch: "internal",
        files: this.syncedFiles,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
        syncType: repo.autoSync?.enabled ? "auto" : "manual",
      });

      throw error;
    }
  }

  // 获取内网文件列表
  private async getInternalFiles(
    sourcePath: string,
    repo: Repository
  ): Promise<string[]> {
    const files: string[] = [];
    const filePatterns = repo.filePatterns || ["**/*.proto"];
    const excludePatterns = repo.excludePatterns || ["**/backend/**"];

    // 递归获取文件列表
    const getFiles = (dir: string, baseDir: string) => {
      const items = fs.readdirSync(dir);

      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          getFiles(fullPath, baseDir);
        } else {
          const relativePath = path.relative(baseDir, fullPath);
          // 检查文件是否匹配模式
          const isMatch = filePatterns.some((pattern) =>
            new Minimatch(pattern, { dot: true }).match(relativePath)
          );
          const isExcluded = excludePatterns.some((pattern) =>
            new Minimatch(pattern, { dot: true }).match(relativePath)
          );

          if (isMatch && !isExcluded) {
            files.push(relativePath);
          }
        }
      }
    };

    getFiles(sourcePath, sourcePath);
    return files;
  }
}
