import * as vscode from "vscode";

export class LogsViewProvider implements vscode.WebviewViewProvider {
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
        <style>
          body {
            padding: 10px;
            word-wrap: break-word;
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
          }
          .log-entry {
            margin-bottom: 5px;
            padding: 5px;
            border-radius: 3px;
            display: flex;
            align-items: flex-start;
          }
          .log-number {
            min-width: 40px;
            text-align: right;
            margin-right: 8px;
            color: var(--vscode-terminal-foreground);
            opacity: 0.5;
            font-family: var(--vscode-editor-font-family);
          }
          .log-content {
            flex: 1;
          }
          .success {
            color: var(--vscode-terminal-ansiGreen);
          }
          .error {
            color: var(--vscode-terminal-ansiRed);
          }
          .warning {
            color: var(--vscode-terminal-ansiYellow);
          }
          .info {
            color: var(--vscode-terminal-ansiBrightBlue);
          }
          #logs {
            white-space: pre-wrap;
            overflow-y: auto;
            height: calc(100vh - 20px);
          }
          .timestamp {
            color: var(--vscode-terminal-foreground);
            opacity: 0.7;
            font-size: 0.9em;
            margin-right: 5px;
          }
        </style>
        <script>
          (function() {
            const vscode = acquireVsCodeApi();
            
            // 状态变量
            const state = {
              autoScroll: true,
              scrollTimeout: null,
              logCounter: 0,
              currentSyncId: null,
              lastMessageTime: 0,
              lastMessage: ''
            };

            // DOM加载完成后初始化
            document.addEventListener('DOMContentLoaded', function() {
              const logs = document.getElementById('logs');
              if (!logs) return;

              // 监听滚动事件
              logs.addEventListener('scroll', function() {
                if (state.scrollTimeout) {
                  clearTimeout(state.scrollTimeout);
                }

                const isScrolledToBottom = logs.scrollHeight - logs.clientHeight <= logs.scrollTop + 1;
                
                if (!isScrolledToBottom) {
                  state.autoScroll = false;
                  state.scrollTimeout = setTimeout(function() {
                    state.autoScroll = true;
                    if (logs.scrollHeight > logs.clientHeight) {
                      logs.scrollTop = logs.scrollHeight;
                    }
                  }, 3000);
                } else {
                  state.autoScroll = true;
                }
              });
            });

            // 处理消息
            window.addEventListener('message', function(event) {
              const logs = document.getElementById('logs');
              if (!logs) return;

              const now = Date.now();
              const message = event.data.message;
              
              // 只在检查更新时增加计数器
              if (message.includes('检查')) {
                state.logCounter++;
                state.currentSyncId = state.logCounter;
              }
              // 如果还没有设置currentSyncId，则设置为1
              if (!state.currentSyncId) {
                state.currentSyncId = 1;
              }
              
              state.lastMessageTime = now;
              state.lastMessage = message;

              const logEntry = document.createElement('div');
              const logNumber = document.createElement('span');
              const logContent = document.createElement('div');
              const timestamp = document.createElement('span');
              const messageSpan = document.createElement('span');

              // 使用当前同步操作的ID作为编号
              logNumber.className = 'log-number';
              logNumber.textContent = '#' + String(state.currentSyncId).padStart(3, '0');

              // 添加时间戳
              timestamp.className = 'timestamp';
              timestamp.textContent = new Date().toLocaleTimeString();

              // 设置消息样式
              logEntry.className = 'log-entry';
              logContent.className = 'log-content';
              messageSpan.textContent = message;

              // 根据消息内容设置样式
              if (message.includes('✅') || message.includes('成功')) {
                logEntry.classList.add('success');
              } else if (message.includes('❌') || message.includes('失败') || message.includes('错误')) {
                logEntry.classList.add('error');
              } else if (message.includes('警告')) {
                logEntry.classList.add('warning');
              } else if (message.includes('[自动同步]')) {
                logEntry.classList.add('info');
              }

              // 组装DOM
              logContent.appendChild(timestamp);
              logContent.appendChild(messageSpan);
              logEntry.appendChild(logNumber);
              logEntry.appendChild(logContent);
              logs.appendChild(logEntry);

              // 自动滚动
              if (state.autoScroll && logs.scrollHeight > logs.clientHeight) {
                logs.scrollTop = logs.scrollHeight;
              }
            });
          })();
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
