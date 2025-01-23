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

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // 创建输出通道
  const outputChannel = vscode.window.createOutputChannel("Stack File Sync");

  console.log(
    'Congratulations, your extension "stack-file-sync" is now active!'
  );
  outputChannel.appendLine("插件已激活");

  // 注册同步文件命令
  let syncFilesDisposable = vscode.commands.registerCommand(
    "stack-file-sync.syncFiles",
    async () => {
      try {
        outputChannel.appendLine("开始同步文件...");

        // 检查工作区
        if (!vscode.workspace.workspaceFolders?.length) {
          throw new Error("请先打开一个工作区文件夹");
        }
        const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;

        // 获取配置
        const config = vscode.workspace.getConfiguration("stackFileSync");
        const repositories: Repository[] = config.get("repositories") || [];
        const targetDirectory: string = config.get("targetDirectory") || "";
        const filePatterns: string[] = config.get("filePatterns") || [
          "**/*.proto",
        ];
        const excludePatterns: string[] = config.get("excludePatterns") || [
          "**/backend/**",
        ];

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
          outputChannel.appendLine(`创建目标目录: ${normalizedTargetDir}`);
        }

        // 选择仓库
        const selectedRepo = await vscode.window.showQuickPick(
          repositories.map((repo) => ({
            label: repo.name,
            description: repo.url,
            repo,
          })),
          {
            placeHolder: "选择要同步的仓库",
          }
        );

        if (!selectedRepo) {
          outputChannel.appendLine("用户取消了仓库选择");
          return;
        }

        // 创建临时目录
        const tempDir = path.join(os.tmpdir(), `stack-file-sync-${Date.now()}`);
        fs.mkdirSync(tempDir, { recursive: true });
        outputChannel.appendLine(`创建临时目录: ${tempDir}`);

        try {
          // 克隆仓库
          const git = simpleGit();
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: "正在克隆仓库...",
              cancellable: false,
            },
            async (progress) => {
              outputChannel.appendLine("开始克隆仓库...");
              progress.report({ message: "克隆中..." });

              await git.clone(selectedRepo.repo.url, tempDir, [
                "--depth",
                "1",
                "--filter=blob:none",
                "--sparse",
              ]);

              progress.report({ message: "切换分支..." });
              await git.cwd(tempDir);
              await git.checkout(selectedRepo.repo.branch);

              // 设置 sparse-checkout
              await git.raw(["sparse-checkout", "init", "--cone"]);
              // 确保能获取到所有层级的目录
              const sourceDirParts =
                selectedRepo.repo.sourceDirectory.split("/");
              const sourceDirPaths = sourceDirParts.reduce(
                (paths, _, index) => {
                  paths.push(sourceDirParts.slice(0, index + 1).join("/"));
                  return paths;
                },
                [] as string[]
              );

              outputChannel.appendLine(
                `设置 sparse-checkout 路径: ${sourceDirPaths.join(", ")}`
              );

              await git.raw(["sparse-checkout", "set", ...sourceDirPaths]);
            }
          );

          // 搜索文件
          const allFiles: vscode.Uri[] = [];
          outputChannel.appendLine(
            `开始在目录 ${path.join(
              tempDir,
              selectedRepo.repo.sourceDirectory
            )} 中搜索文件...`
          );
          outputChannel.appendLine(`文件模式: ${filePatterns.join(", ")}`);
          outputChannel.appendLine(`排除模式: ${excludePatterns.join(", ")}`);

          for (const pattern of filePatterns) {
            try {
              const files = await vscode.workspace.findFiles(
                new vscode.RelativePattern(
                  vscode.Uri.file(
                    path.join(tempDir, selectedRepo.repo.sourceDirectory)
                  ),
                  pattern
                ),
                `{${excludePatterns.join(",")}}`
              );
              outputChannel.appendLine(
                `模式 ${pattern} 找到 ${files.length} 个文件`
              );
              if (files.length > 0) {
                outputChannel.appendLine(
                  `文件列表: ${files.map((f) => f.fsPath).join("\n")}`
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
            // 检查目录是否存在
            const searchDir = path.join(
              tempDir,
              selectedRepo.repo.sourceDirectory
            );
            outputChannel.appendLine(
              `搜索目录 ${searchDir} ${
                fs.existsSync(searchDir) ? "存在" : "不存在"
              }`
            );
            if (fs.existsSync(searchDir)) {
              outputChannel.appendLine(
                `目录内容: ${fs.readdirSync(searchDir).join(", ")}`
              );
            }
            throw new Error(
              `没有找到匹配的文件\n搜索目录: ${searchDir}\n文件模式: ${filePatterns.join(
                ", "
              )}\n排除模式: ${excludePatterns.join(", ")}`
            );
          }

          // 对文件进行排序和去重
          const uniqueFiles = [
            ...new Set(allFiles.map((f) => f.fsPath)),
          ].sort();
          outputChannel.appendLine(`共找到 ${uniqueFiles.length} 个唯一文件`);

          // 显示文件选择
          const selectedFiles = await vscode.window.showQuickPick(
            uniqueFiles.map((filePath) => ({
              label: path.basename(filePath),
              description: path.relative(
                path.join(tempDir, selectedRepo.repo.sourceDirectory),
                filePath
              ),
              detail: filePath, // 显示完整路径
              fsPath: filePath,
            })),
            {
              placeHolder: "选择要同步的文件",
              canPickMany: true,
            }
          );

          if (!selectedFiles?.length) {
            outputChannel.appendLine("用户取消了文件选择");
            return;
          }

          // 询问是否备份
          const backupEnabled = await vscode.window.showQuickPick(
            [
              { label: "是", value: true },
              { label: "否", value: false },
            ],
            {
              placeHolder: "是否需要备份原有文件?",
            }
          );

          let backupDir = "";
          if (backupEnabled?.value) {
            backupDir = path.join(
              workspaceRoot,
              "proto_backup_" + new Date().toISOString().replace(/[:.]/g, "-")
            );
            fs.mkdirSync(path.join(backupDir, targetDirectory), {
              recursive: true,
            });
            outputChannel.appendLine(`创建备份目录: ${backupDir}`);
          }

          // 复制文件
          for (const file of selectedFiles) {
            const relPath = path.relative(
              path.join(tempDir, selectedRepo.repo.sourceDirectory),
              file.fsPath
            );
            const targetPath = path.join(normalizedTargetDir, relPath);

            // 备份原文件
            if (backupEnabled?.value && fs.existsSync(targetPath)) {
              const backupPath = path.join(backupDir, targetDirectory, relPath);
              fs.mkdirSync(path.dirname(backupPath), { recursive: true });
              fs.copyFileSync(targetPath, backupPath);
              outputChannel.appendLine(
                `备份文件: ${targetPath} -> ${backupPath}`
              );
            }

            // 复制新文件
            fs.mkdirSync(path.dirname(targetPath), { recursive: true });
            fs.copyFileSync(file.fsPath, targetPath);
            outputChannel.appendLine(
              `更新文件: ${file.fsPath} -> ${targetPath}`
            );
          }

          vscode.window.showInformationMessage("文件同步完成！");

          // 询问是否编译
          const shouldCompile = await vscode.window.showQuickPick(
            [
              { label: "是", value: true },
              { label: "否", value: false },
            ],
            {
              placeHolder: "是否要立即编译生成dart文件?",
            }
          );

          if (shouldCompile?.value) {
            const makefilePath = path.join(workspaceRoot, "Makefile");
            if (fs.existsSync(makefilePath)) {
              const terminal = vscode.window.createTerminal("Proto Compile");
              terminal.sendText(`cd "${workspaceRoot}" && make proto`);
              terminal.show();
            } else {
              vscode.window.showWarningMessage("未找到 Makefile，无法编译");
            }
          }
        } finally {
          // 清理临时目录
          try {
            fs.rmSync(tempDir, { recursive: true, force: true });
            outputChannel.appendLine("清理临时目录完成");
          } catch (error) {
            outputChannel.appendLine(`清理临时目录失败: ${error}`);
          }
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        outputChannel.appendLine(`错误: ${errorMessage}`);
        if (error instanceof Error && error.stack) {
          outputChannel.appendLine(`错误堆栈: ${error.stack}`);
        }
        vscode.window.showErrorMessage(`错误: ${errorMessage}`);
      }
    }
  );

  // 注册配置命令
  let configureDisposable = vscode.commands.registerCommand(
    "stack-file-sync.configureSync",
    async () => {
      try {
        outputChannel.appendLine("打开配置页面");

        // 打开扩展配置
        await vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "stackFileSync"
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        outputChannel.appendLine(`打开配置页面失败: ${errorMessage}`);
        vscode.window.showErrorMessage(`打开配置页面失败: ${errorMessage}`);
      }
    }
  );

  // 注册所有命令
  context.subscriptions.push(syncFilesDisposable, configureDisposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
