import * as vscode from "vscode";
import { Repository } from "../types";
import * as os from "os";

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
        case "browseNetworkPath":
          await this.browseNetworkPath();
          break;
        case "showError":
          vscode.window.showErrorMessage(message.message);
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

  private async browseNetworkPath() {
    const uri = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      title: "选择内网共享目录",
    });

    if (uri && uri[0]) {
      if (this._view) {
        this._view.webview.postMessage({
          command: "updateNetworkPath",
          path: uri[0].fsPath,
        });
      }
    }
  }

  private getLocalIpAddress(): string {
    const networkInterfaces = os.networkInterfaces();
    for (const interfaceName in networkInterfaces) {
      const interfaces = networkInterfaces[interfaceName];
      if (interfaces) {
        for (const iface of interfaces) {
          // 跳过内部地址和IPv6地址
          if (!iface.internal && iface.family === "IPv4") {
            return iface.address;
          }
        }
      }
    }
    return "192.168.1.100"; // 默认示例IP
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const localIp = this.getLocalIpAddress();
    const isWindows = os.platform() === "win32";
    const localExample = isWindows
      ? "C:\\Users\\username\\project\\proto"
      : "/Users/aa12/BackendProjects/yug-server/proto/user";
    const remoteExample = isWindows
      ? `\\\\${localIp}\\Users\\username\\project\\proto`
      : `//${localIp}/Users/username/project/proto`;

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
            margin-top: 12px;
            padding: 12px;
            background: var(--vscode-textBlockQuote-background);
            border-left: 4px solid var(--vscode-textBlockQuote-border);
          }
          .tip-header {
            font-weight: bold;
            margin-bottom: 8px;
          }
          .tip-section {
            margin-top: 8px;
          }
          .tip-title {
            color: var(--vscode-textLink-foreground);
            margin-bottom: 4px;
          }
          .tip-section div {
            margin-left: 8px;
            line-height: 1.4;
          }
          .sync-type-selector {
            margin-bottom: 20px;
            padding: 10px;
            background: var(--vscode-input-background);
            border-radius: 4px;
          }
          
          .sync-type-selector select {
            width: 100%;
            padding: 8px;
            background: var(--vscode-dropdown-background);
            color: var(--vscode-dropdown-foreground);
            border: 1px solid var(--vscode-dropdown-border);
            border-radius: 4px;
          }

          #internalFields .tips {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-top: 4px;
            padding: 8px;
            background: var(--vscode-textBlockQuote-background);
            border-left: 4px solid var(--vscode-textBlockQuote-border);
          }

          .directory-group {
            display: flex;
            gap: 8px;
          }

          .directory-group input {
            flex: 1;
          }

          .directory-group button {
            padding: 4px 8px;
            display: flex;
            align-items: center;
            gap: 4px;
          }

          .error-message {
            color: var(--vscode-errorForeground);
            background: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            padding: 8px;
            margin-top: 4px;
            border-radius: 4px;
            font-size: 12px;
            display: none;
          }

          .form-group.has-error input {
            border-color: var(--vscode-inputValidation-errorBorder);
          }

          .validation-icon {
            display: none;
            color: var(--vscode-errorForeground);
            margin-left: 4px;
          }

          .form-group.has-error .validation-icon {
            display: inline;
          }

          .required {
            color: var(--vscode-errorForeground);
            margin-left: 2px;
          }

          .form-group {
            position: relative;
          }

          .form-group.has-error .error-message {
            display: block;
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
              请填写仓库的基本信息，选择同步方式。
            </div>
            <div class="form-group">
              <label>仓库名称 <span class="required">*</span></label>
              <input type="text" id="repoName" placeholder="例如: My Proto Files">
              <div class="error-message" id="repoNameError">请输入仓库名称</div>
            </div>
            <div class="form-group sync-type-selector">
              <label>同步类型 <span class="required">*</span></label>
              <select id="syncType" onchange="updateSyncType(this.value)">
                <option value="git">Git 仓库同步</option>
                <option value="internal">内网同步</option>
              </select>
            </div>
            <div id="gitFields">
              <div class="form-group">
                <label>仓库 URL <span class="required">*</span></label>
                <input type="text" id="repoUrl" placeholder="例如: https://github.com/user/repo.git">
                <div class="error-message" id="repoUrlError">请输入有效的仓库地址</div>
              </div>
              <div class="form-group">
                <label>分支名称 <span class="required">*</span></label>
                <input type="text" id="repoBranch" placeholder="例如: main" value="main">
                <div class="error-message" id="repoBranchError">请输入分支名称</div>
              </div>
            </div>
            <div id="internalFields" style="display: none;">
              <div class="form-group">
                <label>内网路径 <span class="required">*</span></label>
                <div class="directory-group">
                  <input type="text" id="networkPath" 
                    placeholder="填写目标目录的完整路径"
                    title="如果是本机文件，直接填写目标目录的完整路径；如果是其他机器，需要使用 //IP地址 开头">
                  <button onclick="browseNetworkPath()">
                    <i class="codicon codicon-folder-opened"></i>
                    浏览
                  </button>
                </div>
                <div class="error-message" id="networkPathError">请输入内网路径</div>
                <div class="tips">
                  <div class="tip-header">如何填写内网路径：</div>
                  <div class="tip-section">
                    <div class="tip-title">同步本机文件：</div>
                    <div>- 直接填写目标目录的完整路径</div>
                    <div>- 示例：${localExample}</div>
                  </div>
                  <div class="tip-section">
                    <div class="tip-title">同步其他机器文件：</div>
                    <div>- 需要使用 //IP地址 开头的网络路径</div>
                    <div>- 示例：${remoteExample}</div>
                  </div>
                </div>
              </div>
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
              设置源目录和目标目录。
              <span id="gitDirDesc" style="display: none;">源目录是远程仓库中的目录，目标目录是本地工作区中的目录。</span>
              <span id="internalDirDesc" style="display: none;">源目录是内网共享目录中的相对路径，目标目录是本地工作区中的目录。</span>
            </div>
            <div class="form-group">
              <label>源目录 <span class="required">*</span></label>
              <div class="directory-group">
                <input type="text" id="sourceDir" placeholder="例如: proto">
                <button onclick="browseDirectory('sourceDir')">
                  <i class="codicon codicon-folder-opened"></i>
                  浏览
                </button>
              </div>
              <div class="error-message" id="sourceDirError">请输入源目录</div>
              <div class="tips" id="sourceDirTip">
                源目录是相对路径，例如：proto/user 或 src/protos
              </div>
            </div>
            <div class="form-group">
              <label>目标目录 <span class="required">*</span></label>
              <div class="directory-group">
                <input type="text" id="targetDir" placeholder="例如: src/proto">
                <button onclick="browseDirectory('targetDir')">
                  <i class="codicon codicon-folder-opened"></i>
                  浏览
                </button>
              </div>
              <div class="error-message" id="targetDirError">请输入目标目录</div>
              <div class="tips">
                目标目录可以是相对或绝对路径
              </div>
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
              case 'updateNetworkPath':
                document.getElementById('networkPath').value = message.path;
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
            if (currentStep === 1 && !validateForm()) {
              return;
            }
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

          function updateSyncType(type) {
            document.getElementById('gitFields').style.display = type === 'git' ? 'block' : 'none';
            document.getElementById('internalFields').style.display = type === 'internal' ? 'block' : 'none';
            document.getElementById('gitDirDesc').style.display = type === 'git' ? 'inline' : 'none';
            document.getElementById('internalDirDesc').style.display = type === 'internal' ? 'inline' : 'none';
            
            // 更新源目录提示
            const sourceDirTip = document.getElementById('sourceDirTip');
            if (type === 'internal') {
              sourceDirTip.textContent = '源目录是相对于内网共享路径的相对路径';
            } else {
              sourceDirTip.textContent = '源目录是相对于仓库根目录的路径';
            }
          }

          function browseNetworkPath() {
            vscode.postMessage({
              command: 'browseNetworkPath'
            });
          }

          document.getElementById('autoSyncEnabled').addEventListener('change', function() {
            document.getElementById('intervalGroup').style.display = this.checked ? 'block' : 'none';
          });

          function validateForm() {
            let isValid = true;
            const syncType = document.getElementById('syncType').value;

            // 清除所有错误状态
            document.querySelectorAll('.form-group').forEach(group => {
              group.classList.remove('has-error');
            });
            document.querySelectorAll('.error-message').forEach(msg => {
              msg.style.display = 'none';
            });

            // 验证必填字段
            const requiredFields = ['repoName', 'sourceDir', 'targetDir'];
            if (syncType === 'git') {
              requiredFields.push('repoUrl', 'repoBranch');
            } else {
              requiredFields.push('networkPath');
            }

            requiredFields.forEach(fieldId => {
              const field = document.getElementById(fieldId);
              if (!field.value.trim()) {
                field.parentElement.classList.add('has-error');
                isValid = false;
              }
            });

            return isValid;
          }

          async function saveConfiguration() {
            if (!validateForm()) {
              return;
            }

            const syncType = document.getElementById('syncType').value;
            const repository = {
              name: document.getElementById('repoName').value.trim(),
              sourceDirectory: document.getElementById('sourceDir').value.trim(),
              targetDirectory: document.getElementById('targetDir').value.trim(),
              filePatterns: document.getElementById('filePatterns').value.split(',').map(p => p.trim()),
              excludePatterns: document.getElementById('excludePatterns').value.split(',').map(p => p.trim()),
              autoSync: {
                enabled: document.getElementById('autoSyncEnabled').checked,
                interval: parseInt(document.getElementById('syncInterval').value)
              }
            };

            if (syncType === 'git') {
              repository.url = document.getElementById('repoUrl').value.trim();
              repository.branch = document.getElementById('repoBranch').value.trim();

              if (!repository.url) {
                vscode.postMessage({ command: 'showError', message: '请输入仓库 URL' });
                return;
              }

              if (!repository.branch) {
                vscode.postMessage({ command: 'showError', message: '请输入分支名称' });
                return;
              }
            } else {
              const networkPath = document.getElementById('networkPath').value.trim();
              if (!networkPath) {
                vscode.postMessage({ command: 'showError', message: '请输入内网路径' });
                return;
              }

              repository.internalSync = {
                enabled: true,
                networkPath
              };
              // 设置默认值以满足类型要求
              repository.url = '';
              repository.branch = '';
            }

            const commandDir = document.getElementById('commandDir').value;
            const postCommand = document.getElementById('postCommand').value;
            if (commandDir && postCommand) {
              repository.postSyncCommands = [{
                directory: commandDir,
                command: postCommand
              }];
            }

            const repositories = config ? [...config] : [];
            repositories.push(repository);

            vscode.postMessage({
              command: 'saveConfig',
              config: repositories
            });
          }

          // 添加实时验证
          document.querySelectorAll('input, select').forEach(input => {
            input.addEventListener('input', function() {
              if (this.value.trim()) {
                this.parentElement.classList.remove('has-error');
              }
            });
          });

          // 初始化进度条
          updateProgressBar();
        </script>
      </body>
      </html>
    `;
  }
}
