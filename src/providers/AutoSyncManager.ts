import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { simpleGit } from "simple-git";
import * as os from "os";
import { Repository } from "../types";
import { Minimatch } from "minimatch";

export class AutoSyncManager {
  private timers: Map<string, NodeJS.Timer> = new Map();
  private lastSyncState: Map<string, Map<string, number>> = new Map(); // 记录每个仓库的文件状态

  constructor(
    private outputChannel: vscode.OutputChannel,
    private statusBarItem: vscode.StatusBarItem
  ) {}

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

      getFiles(sourceDir, sourceDir);
      return files;
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

  // 检查并执行同步
  public async checkAndSync(repo: Repository) {
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
        await this.syncFiles(repo, tempDir);
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
          this.outputChannel.appendLine(`[自动同步] 更新文件: ${relativePath}`);
        }
      }
    };

    copyFiles(sourceDir, sourceDir);

    // 执行后处理命令
    if (repo.postSyncCommands?.length) {
      this.outputChannel.appendLine("\n[自动同步] 执行后处理命令:");
      for (const cmd of repo.postSyncCommands) {
        try {
          const cmdDir = path.isAbsolute(cmd.directory)
            ? cmd.directory
            : path.join(workspaceRoot, cmd.directory);

          if (!fs.existsSync(cmdDir)) {
            this.outputChannel.appendLine(`警告: 目录不存在 ${cmdDir}`);
            continue;
          }

          this.outputChannel.appendLine(
            `\n在目录 ${cmdDir} 中执行命令: ${cmd.command}`
          );

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
  }
}
