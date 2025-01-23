// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { simpleGit } from "simple-git";
import * as os from "os";

interface Repository {
  name: string;
  url: string;
  branch: string;
  sourceDirectory: string;
}

interface PostSyncCommand {
  directory: string;
  command: string;
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
  // 添加输出面板按钮
  const outputButton = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left
  );
  outputButton.text = `$(output) 同步日志 v${version}`;
  outputButton.tooltip = "显示同步日志";
  outputButton.command = "stack-file-sync.showOutput";
  outputButton.show();
  context.subscriptions.push(outputButton);

  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left
  );
  statusBarItem.command = "stack-file-sync.syncFiles";
  statusBarItem.text = `$(sync) 同步文件 v${version}`;
  statusBarItem.tooltip = "同步远程仓库文件";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  console.log(`Stack File Sync v${version} is now active!`);
  outputChannel.appendLine(`Stack File Sync v${version} 已激活`);

  // 注册显示输出面板的命令
  let showOutputDisposable = vscode.commands.registerCommand(
    "stack-file-sync.showOutput",
    () => {
      outputChannel.show();
    }
  );

  // 注册同步文件命令
  let syncFilesDisposable = vscode.commands.registerCommand(
    "stack-file-sync.syncFiles",
    async () => {
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

            // 步骤 1: 配置检查
            progress.report({
              message: "检查配置...",
              increment: 10,
            });

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
              const targetDirectory: string =
                config.get("targetDirectory") || "";
              const filePatterns: string[] = config.get("filePatterns") || [
                "**/*.proto",
              ];
              const excludePatterns: string[] = config.get(
                "excludePatterns"
              ) || ["**/backend/**"];

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

              if (!repositories.length) {
                throw new Error("请先配置仓库信息");
              }

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
                message: "选择仓库...",
                increment: 20,
              });
              outputChannel.appendLine("\n2. 选择仓库:");
              outputChannel.appendLine(
                `- 可选仓库: ${repositories.map((r) => r.name).join(", ")}`
              );

              // 选择仓库
              const selectedRepo = await vscode.window.showQuickPick<{
                label: string;
                description: string;
                repo: Repository;
              }>(
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

              outputChannel.appendLine(`- 已选择: ${selectedRepo.repo.name}`);
              outputChannel.appendLine(`  URL: ${selectedRepo.repo.url}`);
              outputChannel.appendLine(`  分支: ${selectedRepo.repo.branch}`);
              outputChannel.appendLine(
                `  源目录: ${selectedRepo.repo.sourceDirectory}`
              );

              // 创建临时目录
              const tempDir = path.join(
                os.tmpdir(),
                `stack-file-sync-${Date.now()}`
              );
              fs.mkdirSync(tempDir, { recursive: true });
              outputChannel.appendLine(`创建临时目录: ${tempDir}`);

              try {
                // 步骤 3: 克隆仓库
                progress.report({
                  message: "克隆仓库...",
                  increment: 30,
                });
                const git = simpleGit();
                await vscode.window.withProgress(
                  {
                    location: vscode.ProgressLocation.Notification,
                    title: "正在克隆仓库...",
                    cancellable: false,
                  },
                  async (progress) => {
                    outputChannel.appendLine("\n3. 克隆仓库:");
                    outputChannel.appendLine(
                      `- 仓库: ${selectedRepo.repo.url}`
                    );
                    outputChannel.appendLine(
                      `- 分支: ${selectedRepo.repo.branch}`
                    );
                    outputChannel.appendLine(`- 临时目录: ${tempDir}`);

                    progress.report({ message: "克隆中..." });
                    outputChannel.appendLine("- 开始克隆...");

                    // 简化克隆过程，和原始脚本保持一致
                    await git.clone(selectedRepo.repo.url, tempDir, [
                      "--depth",
                      "1",
                      "--filter=blob:none",
                      "--sparse",
                    ]);

                    progress.report({ message: "切换分支..." });
                    outputChannel.appendLine("- 切换分支...");
                    await git.cwd(tempDir);
                    await git.checkout(selectedRepo.repo.branch);

                    // 设置 sparse-checkout
                    outputChannel.appendLine("- 配置 sparse-checkout...");
                    await git.raw(["sparse-checkout", "init", "--cone"]);
                    await git.raw([
                      "sparse-checkout",
                      "set",
                      selectedRepo.repo.sourceDirectory,
                    ]);

                    outputChannel.appendLine(
                      `  路径: ${selectedRepo.repo.sourceDirectory}`
                    );
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

                outputChannel.appendLine(`\n开始搜索 proto 文件...`);
                outputChannel.appendLine(
                  `文件模式: ${filePatterns.join(", ")}`
                );
                outputChannel.appendLine(
                  `排除模式: ${excludePatterns.join(", ")}`
                );

                for (const pattern of filePatterns) {
                  try {
                    // 递归搜索目录
                    function findProtoFiles(dir: string): string[] {
                      const results: string[] = [];
                      const items = fs.readdirSync(dir);

                      for (const item of items) {
                        const fullPath = path.join(dir, item);
                        const stat = fs.statSync(fullPath);

                        if (stat.isDirectory()) {
                          results.push(...findProtoFiles(fullPath));
                        } else if (item.endsWith(".proto")) {
                          results.push(fullPath);
                        }
                      }

                      return results;
                    }

                    const files = findProtoFiles(repoDir).map((file) =>
                      vscode.Uri.file(file)
                    );

                    // 只显示相对路径
                    const displayFiles = files.map((f) => ({
                      path: f.fsPath,
                      relative: path.relative(repoDir, f.fsPath),
                    }));

                    outputChannel.appendLine(
                      `模式 ${pattern} 找到 ${files.length} 个文件`
                    );
                    if (files.length > 0) {
                      outputChannel.appendLine(
                        `文件列表:\n${displayFiles
                          .map((f) => `  ${f.relative}`)
                          .join("\n")}`
                      );
                    }
                    allFiles.push(...files);
                  } catch (error) {
                    outputChannel.appendLine(
                      `警告: 搜索模式 ${pattern} 时出错: ${
                        error instanceof Error ? error.message : String(error)
                      }`
                    );
                  }
                }

                if (!allFiles.length) {
                  throw new Error(
                    `没有找到匹配的文件\n` +
                      `搜索目录: ${repoDir}\n` +
                      `文件模式: ${filePatterns.join(", ")}\n` +
                      `排除模式: ${excludePatterns.join(", ")}\n\n` +
                      `请检查:\n` +
                      `1. 源目录路径是否正确 (${selectedRepo.repo.sourceDirectory})\n` +
                      `2. 文件模式是否正确 (${filePatterns.join(", ")})\n` +
                      `3. 排除模式是否过于宽泛 (${excludePatterns.join(
                        ", "
                      )})\n` +
                      `4. 仓库分支是否正确 (${selectedRepo.repo.branch})\n` +
                      `5. 查看上方的目录结构检查输出`
                  );
                }

                // 步骤 5: 选择要同步的文件
                progress.report({
                  message: "选择要同步的文件...",
                  increment: 70,
                });
                outputChannel.appendLine("\n5. 选择要同步的文件:");
                outputChannel.appendLine(
                  `找到 ${allFiles.length} 个文件可同步`
                );
                outputChannel.appendLine("正在显示文件选择对话框...");

                interface FileQuickPickItem extends vscode.QuickPickItem {
                  fsPath: string;
                  targetPath: string;
                }

                const quickPick =
                  vscode.window.createQuickPick<FileQuickPickItem>();
                quickPick.title = "选择要同步的文件";
                quickPick.placeholder = "选择要同步的文件（可多选）";
                quickPick.canSelectMany = true;
                quickPick.ignoreFocusOut = true;
                quickPick.items = allFiles.map((file) => {
                  const relativePath = path.relative(repoDir, file.fsPath);
                  return {
                    label: path.basename(file.fsPath),
                    description: `将同步到: ${relativePath}`,
                    detail: relativePath,
                    picked: true,
                    fsPath: file.fsPath,
                    targetPath: path.join(normalizedTargetDir, relativePath),
                  };
                });

                quickPick.show();
                const selectedFiles = await new Promise<FileQuickPickItem[]>(
                  (resolve) => {
                    quickPick.onDidAccept(() => {
                      resolve([...quickPick.selectedItems]);
                      quickPick.hide();
                    });
                    quickPick.onDidHide(() => {
                      resolve([]);
                      quickPick.dispose();
                    });
                  }
                );

                if (!selectedFiles || selectedFiles.length === 0) {
                  // 恢复状态栏
                  statusBarItem.text = `$(sync) 同步文件 v${version}`;
                  statusBarItem.backgroundColor = undefined;
                  outputChannel.appendLine("\n用户取消了文件选择");
                  vscode.window.showInformationMessage("已取消同步操作");
                  return;
                }

                outputChannel.appendLine("已选择文件:");
                selectedFiles.forEach((file) => {
                  outputChannel.appendLine(`- ${file.detail}`);
                });

                // 步骤 6: 复制文件
                progress.report({
                  message: "复制文件...",
                  increment: 90,
                });
                outputChannel.appendLine("\n6. 复制文件:");

                for (const file of selectedFiles) {
                  const targetDir = path.dirname(file.targetPath);
                  if (!fs.existsSync(targetDir)) {
                    fs.mkdirSync(targetDir, { recursive: true });
                  }
                  fs.copyFileSync(file.fsPath, file.targetPath);
                  outputChannel.appendLine(
                    `- ${file.detail} -> ${file.targetPath}`
                  );
                }

                // 完成
                progress.report({
                  message: "同步完成",
                  increment: 100,
                });
                outputChannel.appendLine("\n=== 同步完成 ===");
                vscode.window.showInformationMessage("文件同步完成！");
              } catch (error) {
                // 恢复状态栏
                statusBarItem.text = `$(sync) 同步文件 v${version}`;
                statusBarItem.backgroundColor = undefined;

                if (error instanceof Error) {
                  outputChannel.appendLine(`\n同步失败: ${error.message}`);
                  vscode.window.showErrorMessage(`同步失败: ${error.message}`);
                } else {
                  outputChannel.appendLine(`\n同步失败: ${String(error)}`);
                  vscode.window.showErrorMessage(`同步失败: ${String(error)}`);
                }
                return;
              }
            } catch (error) {
              outputChannel.appendLine(
                `同步失败: ${
                  error instanceof Error ? error.message : String(error)
                }`
              );
            }
          }
        );
      } catch (error) {
        outputChannel.appendLine(
          `同步失败: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  context.subscriptions.push(showOutputDisposable);
  context.subscriptions.push(syncFilesDisposable);
}
