import * as vscode from "vscode";
import { Repository } from "../types";

export class ConfigWizardProvider implements vscode.WebviewViewProvider {
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

    // 处理来自 Webview 的消息
    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case "saveConfig":
          await this.saveConfig(message.config);
          break;
        case "requestConfig":
          await this.sendCurrentConfig();
          break;
        case "browseDirectory":
          await this.browseDirectory(message.field, message.repoIndex);
          break;
      }
    });
  }

  // 保存配置
  private async saveConfig(config: Repository[]) {
    try {
      await vscode.workspace
        .getConfiguration("stackFileSync")
        .update("repositories", config, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage("配置保存成功！");
      vscode.commands.executeCommand("stack-file-sync.refreshRepositories");
    } catch (error) {
      vscode.window.showErrorMessage(`保存配置失败: ${error}`);
    }
  }

  // 发送当前配置到 Webview
  private async sendCurrentConfig() {
    if (this._view) {
      const config = vscode.workspace.getConfiguration("stackFileSync");
      const repositories: Repository[] = config.get("repositories") || [];
      this._view.webview.postMessage({
        command: "updateConfig",
        config: repositories,
      });
    }
  }

  // 浏览目录
  private async browseDirectory(field: string, repoIndex: number) {
    const uri = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      title: "选择目录",
    });

    if (uri && uri[0]) {
      if (this._view) {
        this._view.webview.postMessage({
          command: "updateDirectory",
          field,
          repoIndex,
          path: uri[0].fsPath,
        });
      }
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Stack File Sync 配置向导</title>
        <style>
          body {
            padding: 20px;
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background: var(--vscode-sideBar-background);
          }
          .wizard-container {
            max-width: 800px;
            margin: 0 auto;
          }
          .step {
            display: none;
            margin-bottom: 20px;
          }
          .step.active {
            display: block;
          }
          .step-title {
            font-size: 18px;
            font-weight: bold;
            margin-bottom: 15px;
            color: var(--vscode-sideBarTitle-foreground);
          }
          .step-description {
            margin-bottom: 20px;
            color: var(--vscode-descriptionForeground);
          }
          .form-group {
            margin-bottom: 15px;
          }
          .form-group label {
            display: block;
            margin-bottom: 5px;
            color: var(--vscode-input-placeholderForeground);
          }
          input, select {
            width: 100%;
            padding: 8px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
          }
          .directory-group {
            display: flex;
            gap: 8px;
          }
          .directory-group input {
            flex: 1;
          }
          button {
            padding: 8px 16px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
          }
          button:hover {
            background: var(--vscode-button-hoverBackground);
          }
          .button-group {
            display: flex;
            justify-content: space-between;
            margin-top: 20px;
          }
          .progress-bar {
            height: 4px;
            background: var(--vscode-progressBar-background);
            margin-bottom: 20px;
          }
          .tips {
            margin-top: 10px;
            padding: 10px;
            background: var(--vscode-textBlockQuote-background);
            border-left: 4px solid var(--vscode-textBlockQuote-border);
            color: var(--vscode-textBlockQuote-foreground);
          }
        </style>
      </head>
      <body>
        <div class="wizard-container">
          <div class="progress-bar"></div>
          
          <!-- 步骤 1: 基本信息 -->
          <div class="step active" id="step1">
            <div class="step-title">步骤 1: 基本信息</div>
            <div class="step-description">
              请填写仓库的基本信息，这些信息将用于连接和识别您的仓库。
            </div>
            <div class="form-group">
              <label>仓库名称</label>
              <input type="text" id="repoName" placeholder="例如: My Proto Files">
            </div>
            <div class="form-group">
              <label>仓库 URL</label>
              <input type="text" id="repoUrl" placeholder="例如: https://github.com/user/repo.git">
            </div>
            <div class="form-group">
              <label>分支名称</label>
              <input type="text" id="repoBranch" placeholder="例如: main" value="main">
            </div>
            <div class="tips">
              提示: 仓库名称将用于在 VS Code 中显示，URL 是您要同步的远程仓库地址。
            </div>
            <div class="button-group">
              <div></div>
              <button onclick="nextStep()">下一步</button>
            </div>
          </div>

          <!-- 步骤 2: 目录设置 -->
          <div class="step" id="step2">
            <div class="step-title">步骤 2: 目录设置</div>
            <div class="step-description">
              设置源目录和目标目录。源目录是远程仓库中的目录，目标目录是本地工作区中的目录。
            </div>
            <div class="form-group">
              <label>源目录</label>
              <div class="directory-group">
                <input type="text" id="sourceDir" placeholder="例如: proto">
                <button onclick="browseDirectory('sourceDir')">浏览</button>
              </div>
            </div>
            <div class="form-group">
              <label>目标目录</label>
              <div class="directory-group">
                <input type="text" id="targetDir" placeholder="例如: src/proto">
                <button onclick="browseDirectory('targetDir')">浏览</button>
              </div>
            </div>
            <div class="tips">
              提示: 源目录是相对于仓库根目录的路径，目标目录是相对于工作区的路径。
            </div>
            <div class="button-group">
              <button onclick="prevStep()">上一步</button>
              <button onclick="nextStep()">下一步</button>
            </div>
          </div>

          <!-- 步骤 3: 文件过滤 -->
          <div class="step" id="step3">
            <div class="step-title">步骤 3: 文件过滤</div>
            <div class="step-description">
              设置要同步的文件类型和需要排除的文件。使用 glob 模式匹配文件。
            </div>
            <div class="form-group">
              <label>文件匹配模式</label>
              <input type="text" id="filePatterns" placeholder="例如: **/*.proto" value="**/*.proto">
            </div>
            <div class="form-group">
              <label>排除模式</label>
              <input type="text" id="excludePatterns" placeholder="例如: **/node_modules/**" value="**/backend/**">
            </div>
            <div class="tips">
              提示: 使用 glob 模式匹配文件，多个模式用逗号分隔。例如: **/*.proto, **/*.txt
            </div>
            <div class="button-group">
              <button onclick="prevStep()">上一步</button>
              <button onclick="nextStep()">下一步</button>
            </div>
          </div>

          <!-- 步骤 4: 自动同步设置 -->
          <div class="step" id="step4">
            <div class="step-title">步骤 4: 自动同步设置</div>
            <div class="step-description">
              配置自动同步功能，设置同步间隔和后处理命令。
            </div>
            <div class="form-group">
              <label>
                <input type="checkbox" id="autoSyncEnabled">
                启用自动同步
              </label>
            </div>
            <div class="form-group" id="intervalGroup" style="display: none;">
              <label>同步间隔（秒）</label>
              <input type="number" id="syncInterval" value="300" min="60">
            </div>
            <div class="form-group">
              <label>后处理命令</label>
              <input type="text" id="postCommand" placeholder="例如: npm run build">
            </div>
            <div class="form-group">
              <label>命令执行目录</label>
              <div class="directory-group">
                <input type="text" id="commandDir" placeholder="例如: src/client">
                <button onclick="browseDirectory('commandDir')">浏览</button>
              </div>
            </div>
            <div class="tips">
              提示: 自动同步将定期检查远程仓库的更新，后处理命令将在同步完成后执行。
            </div>
            <div class="button-group">
              <button onclick="prevStep()">上一步</button>
              <button onclick="saveConfiguration()">完成配置</button>
            </div>
          </div>
        </div>

        <script>
          const vscode = acquireVsCodeApi();
          let currentStep = 1;
          const totalSteps = 4;
          let config = null;

          // 请求当前配置
          vscode.postMessage({ command: 'requestConfig' });

          // 监听来自扩展的消息
          window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
              case 'updateConfig':
                config = message.config;
                break;
              case 'updateDirectory':
                document.getElementById(message.field).value = message.path;
                break;
            }
          });

          function updateProgressBar() {
            const progress = (currentStep - 1) / (totalSteps - 1) * 100;
            document.querySelector('.progress-bar').style.width = \`\${progress}%\`;
          }

          function showStep(step) {
            document.querySelectorAll('.step').forEach(el => {
              el.classList.remove('active');
            });
            document.getElementById(\`step\${step}\`).classList.add('active');
            currentStep = step;
            updateProgressBar();
          }

          function nextStep() {
            if (currentStep < totalSteps) {
              showStep(currentStep + 1);
            }
          }

          function prevStep() {
            if (currentStep > 1) {
              showStep(currentStep - 1);
            }
          }

          function browseDirectory(field) {
            vscode.postMessage({
              command: 'browseDirectory',
              field,
              repoIndex: 0
            });
          }

          document.getElementById('autoSyncEnabled').addEventListener('change', function() {
            document.getElementById('intervalGroup').style.display = this.checked ? 'block' : 'none';
          });

          function saveConfiguration() {
            const repository = {
              name: document.getElementById('repoName').value,
              url: document.getElementById('repoUrl').value,
              branch: document.getElementById('repoBranch').value,
              sourceDirectory: document.getElementById('sourceDir').value,
              targetDirectory: document.getElementById('targetDir').value,
              filePatterns: document.getElementById('filePatterns').value.split(',').map(p => p.trim()),
              excludePatterns: document.getElementById('excludePatterns').value.split(',').map(p => p.trim()),
              autoSync: {
                enabled: document.getElementById('autoSyncEnabled').checked,
                interval: parseInt(document.getElementById('syncInterval').value)
              },
              postSyncCommands: []
            };

            const commandDir = document.getElementById('commandDir').value;
            const postCommand = document.getElementById('postCommand').value;
            if (commandDir && postCommand) {
              repository.postSyncCommands.push({
                directory: commandDir,
                command: postCommand
              });
            }

            const repositories = config ? [...config] : [];
            repositories.push(repository);

            vscode.postMessage({
              command: 'saveConfig',
              config: repositories
            });
          }

          // 初始化进度条
          updateProgressBar();
        </script>
      </body>
      </html>
    `;
  }
}
