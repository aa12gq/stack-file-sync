import * as vscode from "vscode";
import { Repository } from "../types";

export class ConfigViewProvider implements vscode.WebviewViewProvider {
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
        case "browseNetworkPath":
          await this.browseNetworkPath(message.repoIndex);
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
      // 触发配置更新事件
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

  private _getHtmlForWebview(webview: vscode.Webview) {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Stack File Sync 配置</title>
        <style>
          body {
            padding: 0;
            margin: 0;
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background: var(--vscode-sideBar-background);
          }
          #app {
            height: 100vh;
            display: flex;
            flex-direction: column;
          }
          #repositories {
            flex: 1;
            overflow-y: auto;
            padding: 0;
          }
          .repository {
            border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
            background: var(--vscode-sideBar-background);
            margin: 0;
          }
          .repository:last-child {
            border-bottom: none;
          }
          .repository-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 12px;
            cursor: pointer;
            background: var(--vscode-sideBarSectionHeader-background);
            border: none;
            margin: 0;
            height: 22px;
            user-select: none;
          }
          .repository-header:hover {
            background: var(--vscode-list-hoverBackground);
          }
          .repository-header:hover .codicon-chevron-right {
            opacity: 1;
          }
          .repository-title {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: var(--vscode-font-size);
            font-weight: normal;
            color: var(--vscode-sideBarTitle-foreground);
            flex: 1;
            min-width: 0;
          }
          .codicon-chevron-right {
            font-family: codicon;
            font-size: 14px;
            line-height: 14px;
            width: 16px;
            height: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--vscode-icon-foreground);
            opacity: 0.8;
            transition: transform 0.1s ease-in-out;
          }
          .codicon-chevron-right.expanded {
            transform: rotate(90deg);
          }
          .repository-content {
            display: none;
            padding: 12px;
            background: var(--vscode-sideBar-background);
            opacity: 0;
            transform: translateY(-10px);
            transition: opacity 0.2s ease-out, transform 0.2s ease-out;
          }
          .repository-content.expanded {
            display: block;
            opacity: 1;
            transform: translateY(0);
          }
          .repository-status {
            display: flex;
            align-items: center;
            gap: 8px;
            color: var(--vscode-descriptionForeground);
            font-size: var(--vscode-font-size);
            flex-shrink: 0;
          }
          .repository-status span {
            display: inline-flex;
            align-items: center;
          }
          .codicon {
            font-family: codicon;
            cursor: pointer;
            color: var(--vscode-icon-foreground);
          }
          .section {
            margin-bottom: 16px;
          }
          .section-title {
            font-size: var(--vscode-font-size);
            font-weight: 600;
            margin-bottom: 8px;
            color: var(--vscode-sideBarTitle-foreground);
          }
          .form-group {
            margin-bottom: 12px;
          }
          .form-group label {
            display: block;
            margin-bottom: 4px;
            font-size: var(--vscode-font-size);
            color: var(--vscode-input-placeholderForeground);
          }
          input, select {
            width: 100%;
            padding: 4px 6px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 2px;
            font-size: var(--vscode-font-size);
            line-height: 1.4;
          }
          input:focus, select:focus {
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: -1px;
          }
          .pattern-list {
            margin-top: 4px;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 2px;
            padding: 4px;
          }
          .pattern-item {
            display: flex;
            gap: 4px;
            margin-bottom: 4px;
          }
          .pattern-item:last-child {
            margin-bottom: 0;
          }
          .pattern-item input {
            flex: 1;
          }
          button {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 2px 8px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            border-radius: 2px;
            cursor: pointer;
            font-size: var(--vscode-font-size);
            height: 24px;
            min-width: unset;
          }
          button:hover {
            background: var(--vscode-button-secondaryHoverBackground);
          }
          .remove-btn {
            background: transparent;
            color: var(--vscode-icon-foreground);
            padding: 2px 4px;
          }
          .remove-btn:hover {
            background: var(--vscode-toolbar-hoverBackground);
          }
          .add-btn {
            background: transparent;
            color: var(--vscode-button-foreground);
            padding: 2px 4px;
          }
          .add-btn:hover {
            background: var(--vscode-toolbar-hoverBackground);
          }
          .checkbox-wrapper {
            display: flex;
            align-items: center;
            gap: 6px;
          }
          .checkbox-wrapper input[type="checkbox"] {
            width: 16px;
            height: 16px;
            margin: 0;
          }
          .actions-bar {
            position: sticky;
            bottom: 0;
            background: var(--vscode-sideBar-background);
            padding: 8px 12px;
            display: flex;
            justify-content: flex-end;
            gap: 8px;
            border-top: 1px solid var(--vscode-sideBarSectionHeader-border);
          }
          .actions-bar button {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            padding: 2px 8px;
          }
          .actions-bar button:hover {
            background: var(--vscode-button-hoverBackground);
          }
          .url-text {
            max-width: 150px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
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
        </style>
        <link rel="stylesheet" href="${webview.asWebviewUri(
          vscode.Uri.joinPath(
            this._extensionUri,
            "node_modules",
            "@vscode/codicons",
            "dist",
            "codicon.css"
          )
        )}">
      </head>
      <body>
        <div id="app">
          <div id="repositories"></div>
          <div class="actions-bar">
            <button onclick="addRepository()" class="add-btn">
              <i class="codicon codicon-add"></i>
              添加仓库
            </button>
            <button onclick="saveConfig()">
              <i class="codicon codicon-save"></i>
              保存配置
            </button>
          </div>
        </div>

        <script>
          const vscode = acquireVsCodeApi();
          let repositories = [];
          let expandedStates = new Map(); // 存储每个仓库的展开状态

          // 请求当前配置
          vscode.postMessage({ command: 'requestConfig' });

          // 监听来自扩展的消息
          window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
              case 'updateConfig':
                repositories = message.config;
                // 初始化展开状态
                repositories.forEach((_, index) => {
                  if (!expandedStates.has(index)) {
                    expandedStates.set(index, index === 0); // 默认只展开第一个
                  }
                });
                renderRepositories();
                break;
            }
          });

          function toggleRepository(index) {
            expandedStates.set(index, !expandedStates.get(index));
            renderRepositories();
          }

          function renderRepositories() {
            const container = document.getElementById('repositories');
            container.innerHTML = repositories.map((repo, index) => {
              const isExpanded = expandedStates.get(index);
              return \`
                <div class="repository">
                  <div class="repository-header" onclick="toggleRepository(\${index})" title="点击展开/折叠">
                    <div class="repository-title">
                      <i class="codicon codicon-chevron-right \${isExpanded ? 'expanded' : ''}" 
                         aria-label="\${isExpanded ? '折叠' : '展开'}"></i>
                      <span>\${repo.name || '新仓库'}</span>
                    </div>
                    <div class="repository-status">
                      <span class="url-text" title="\${repo.url || ''}">\${repo.url || '未设置 URL'}</span>
                      <i class="codicon \${repo.autoSync?.enabled ? 'codicon-sync~spin' : 'codicon-sync-ignored'}" 
                         title="\${repo.autoSync?.enabled ? '自动同步已开启' : '自动同步已关闭'}"></i>
                      <button class="remove-btn" onclick="event.stopPropagation(); removeRepository(\${index})" 
                              title="删除仓库">
                        <i class="codicon codicon-trash"></i>
                      </button>
                    </div>
                  </div>
                  <div class="repository-content \${isExpanded ? 'expanded' : ''}">
                    <div class="section">
                      <div class="form-group">
                        <label>仓库名称</label>
                        <input type="text" value="\${repo.name}" placeholder="输入仓库名称" 
                          onchange="updateRepo(\${index}, 'name', this.value)">
                      </div>
                      <div class="form-group">
                        <label>仓库 URL</label>
                        <input type="text" value="\${repo.url}" placeholder="输入仓库 URL" 
                          onchange="updateRepo(\${index}, 'url', this.value)">
                      </div>
                      <div class="form-group">
                        <label>分支</label>
                        <input type="text" value="\${repo.branch}" placeholder="输入分支名称" 
                          onchange="updateRepo(\${index}, 'branch', this.value)">
                      </div>
                    </div>

                    <div class="section">
                      <div class="section-title">目录设置</div>
                      <div class="form-group">
                        <label>源目录</label>
                        <input type="text" value="\${repo.sourceDirectory}" placeholder="输入源目录路径" 
                          onchange="updateRepo(\${index}, 'sourceDirectory', this.value)">
                      </div>
                      <div class="form-group">
                        <label>目标目录</label>
                        <input type="text" value="\${repo.targetDirectory}" placeholder="输入目标目录路径" 
                          onchange="updateRepo(\${index}, 'targetDirectory', this.value)">
                      </div>
                    </div>

                    <div class="section">
                      <div class="section-title">文件过滤</div>
                      <div class="form-group">
                        <label>文件匹配模式</label>
                        <div class="pattern-list">
                          \${(repo.filePatterns || []).map((pattern, pIndex) => \`
                            <div class="pattern-item">
                              <input type="text" value="\${pattern}" placeholder="输入匹配模式"
                                onchange="updatePattern(\${index}, \${pIndex}, this.value)">
                              <button class="remove-btn" onclick="removePattern(\${index}, \${pIndex})">
                                <i class="codicon codicon-trash"></i>
                              </button>
                            </div>
                          \`).join('')}
                          <button class="add-btn" onclick="addPattern(\${index})">
                            <i class="codicon codicon-add"></i>
                            添加模式
                          </button>
                        </div>
                      </div>
                      <div class="form-group">
                        <label>排除模式</label>
                        <div class="pattern-list">
                          \${(repo.excludePatterns || []).map((pattern, pIndex) => \`
                            <div class="pattern-item">
                              <input type="text" value="\${pattern}" placeholder="输入排除模式"
                                onchange="updateExcludePattern(\${index}, \${pIndex}, this.value)">
                              <button class="remove-btn" onclick="removeExcludePattern(\${index}, \${pIndex})">
                                <i class="codicon codicon-trash"></i>
                              </button>
                            </div>
                          \`).join('')}
                          <button class="add-btn" onclick="addExcludePattern(\${index})">
                            <i class="codicon codicon-add"></i>
                            添加模式
                          </button>
                        </div>
                      </div>
                    </div>

                    <div class="section">
                      <div class="section-title">自动同步设置</div>
                      <div class="form-group">
                        <div class="checkbox-wrapper">
                          <input type="checkbox" id="autoSync\${index}" \${repo.autoSync?.enabled ? 'checked' : ''} 
                            onchange="updateAutoSync(\${index}, this.checked)">
                          <label for="autoSync\${index}">启用自动同步</label>
                        </div>
                      </div>
                      \${repo.autoSync?.enabled ? \`
                        <div class="form-group">
                          <label>同步间隔（秒）</label>
                          <input type="number" value="\${repo.autoSync?.interval || 300}" 
                            onchange="updateSyncInterval(\${index}, this.value)">
                        </div>
                      \` : ''}
                    </div>

                    <div class="section">
                      <div class="section-title">内网同步设置</div>
                      <div class="form-group">
                        <div class="checkbox-wrapper">
                          <input type="checkbox" id="internalSync\${index}" 
                            \${repo.internalSync?.enabled ? 'checked' : ''} 
                            onchange="updateInternalSync(\${index}, this.checked)">
                          <label for="internalSync\${index}">启用内网同步</label>
                        </div>
                      </div>
                      \${repo.internalSync?.enabled ? \`
                        <div class="form-group">
                          <label>内网路径</label>
                          <div class="directory-group">
                            <input type="text" value="\${repo.internalSync?.networkPath || ''}" 
                              placeholder="填写目标目录的完整路径"
                              title="如果是本机文件，直接填写目标目录的完整路径"
                              onchange="updateNetworkPath(\${index}, this.value)">
                            <button onclick="browseNetworkPath(\${index})">
                              <i class="codicon codicon-folder-opened"></i>
                              浏览
                            </button>
                          </div>
                          <div class="tips">
                            <div class="tip-header">如何填写内网路径：</div>
                            <div class="tip-section">
                              <div class="tip-title">同步本机文件：</div>
                              <div>- 直接填写目标目录的完整路径</div>
                              <div>- 例如：/Users/aa12/BackendProjects/yug-server/proto/user</div>
                            </div>
                            <div class="tip-section">
                              <div class="tip-title">同步其他机器文件：</div>
                              <div>- 需要使用 //IP地址 开头的网络路径</div>
                              <div>- 例如：//192.168.1.100/Users/username/project/proto</div>
                            </div>
                          </div>
                        </div>
                      \` : ''}
                    </div>

                    <div class="section">
                      <div class="section-title">同步后执行命令</div>
                      <div class="form-group">
                        <div class="pattern-list">
                          \${(repo.postSyncCommands || []).map((cmd, cmdIndex) => \`
                            <div class="pattern-item" style="flex-direction: column; gap: 8px;">
                              <div style="display: flex; gap: 4px; width: 100%;">
                                <input type="text" value="\${cmd.directory}" placeholder="输入命令执行目录"
                                  onchange="updatePostSyncCommandDir(\${index}, \${cmdIndex}, this.value)">
                                <button class="remove-btn" onclick="removePostSyncCommand(\${index}, \${cmdIndex})">
                                  <i class="codicon codicon-trash"></i>
                                </button>
                              </div>
                              <input type="text" value="\${cmd.command}" placeholder="输入要执行的命令"
                                onchange="updatePostSyncCommandCmd(\${index}, \${cmdIndex}, this.value)">
                            </div>
                          \`).join('')}
                          <button class="add-btn" onclick="addPostSyncCommand(\${index})">
                            <i class="codicon codicon-add"></i>
                            添加命令
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              \`;
            }).join('');
          }

          function addRepository() {
            repositories.push({
              name: '新仓库',
              url: '',
              branch: 'main',
              sourceDirectory: '',
              targetDirectory: '',
              filePatterns: ['**/*.proto'],
              excludePatterns: ['**/backend/**'],
              postSyncCommands: [],
              autoSync: {
                enabled: false,
                interval: 300
              }
            });
            renderRepositories();
          }

          function removeRepository(index) {
            repositories.splice(index, 1);
            renderRepositories();
          }

          function updateRepo(index, field, value) {
            repositories[index][field] = value;
          }

          function updateAutoSync(index, enabled) {
            repositories[index].autoSync = repositories[index].autoSync || {};
            repositories[index].autoSync.enabled = enabled;
            repositories[index].autoSync.interval = repositories[index].autoSync.interval || 300;
            renderRepositories();
          }

          function updateSyncInterval(index, value) {
            repositories[index].autoSync = repositories[index].autoSync || {};
            repositories[index].autoSync.interval = parseInt(value);
          }

          function addPattern(index) {
            repositories[index].filePatterns = repositories[index].filePatterns || [];
            repositories[index].filePatterns.push('**/*');
            renderRepositories();
          }

          function removePattern(index, patternIndex) {
            repositories[index].filePatterns.splice(patternIndex, 1);
            renderRepositories();
          }

          function updatePattern(index, patternIndex, value) {
            repositories[index].filePatterns[patternIndex] = value;
          }

          function addExcludePattern(index) {
            repositories[index].excludePatterns = repositories[index].excludePatterns || [];
            repositories[index].excludePatterns.push('**/backend/**');
            renderRepositories();
          }

          function removeExcludePattern(index, patternIndex) {
            repositories[index].excludePatterns.splice(patternIndex, 1);
            renderRepositories();
          }

          function updateExcludePattern(index, patternIndex, value) {
            repositories[index].excludePatterns[patternIndex] = value;
          }

          function addPostSyncCommand(index) {
            repositories[index].postSyncCommands = repositories[index].postSyncCommands || [];
            repositories[index].postSyncCommands.push({
              directory: '',
              command: ''
            });
            renderRepositories();
          }

          function removePostSyncCommand(index, cmdIndex) {
            repositories[index].postSyncCommands.splice(cmdIndex, 1);
            renderRepositories();
          }

          function updatePostSyncCommandDir(index, cmdIndex, value) {
            repositories[index].postSyncCommands = repositories[index].postSyncCommands || [];
            repositories[index].postSyncCommands[cmdIndex].directory = value;
          }

          function updatePostSyncCommandCmd(index, cmdIndex, value) {
            repositories[index].postSyncCommands = repositories[index].postSyncCommands || [];
            repositories[index].postSyncCommands[cmdIndex].command = value;
          }

          function updateInternalSync(index, enabled) {
            repositories[index].internalSync = repositories[index].internalSync || {};
            repositories[index].internalSync.enabled = enabled;
            if (!enabled) {
              repositories[index].internalSync.networkPath = '';
            }
            renderRepositories();
          }

          function updateNetworkPath(index, path) {
            repositories[index].internalSync = repositories[index].internalSync || {};
            repositories[index].internalSync.networkPath = path;
          }

          function browseNetworkPath(index) {
            vscode.postMessage({
              command: 'browseNetworkPath',
              repoIndex: index
            });
          }

          function saveConfig() {
            vscode.postMessage({
              command: 'saveConfig',
              config: repositories
            });
          }
        </script>
      </body>
      </html>
    `;
  }

  private async browseNetworkPath(repoIndex: number) {
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
          repoIndex,
          path: uri[0].fsPath,
        });
      }
    }
  }
}
