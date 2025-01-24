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
          const vscode = acquireVsCodeApi();
          let autoScroll = true;
          let scrollTimeout;
          
          // 监听滚动事件
          document.addEventListener('DOMContentLoaded', () => {
            const logs = document.getElementById('logs');
            
            logs.addEventListener('scroll', () => {
              // 清除之前的定时器
              clearTimeout(scrollTimeout);
              
              // 检查是否手动滚动
              const isScrolledToBottom = logs.scrollHeight - logs.clientHeight <= logs.scrollTop + 1;
              if (!isScrolledToBottom) {
                autoScroll = false;
                
                // 3秒后恢复自动滚动
                scrollTimeout = setTimeout(() => {
                  autoScroll = true;
                  if (logs.scrollHeight > logs.clientHeight) {
                    logs.scrollTop = logs.scrollHeight;
                  }
                }, 3000);
              } else {
                autoScroll = true;
              }
            });
          });

          window.addEventListener('message', event => {
            const logs = document.getElementById('logs');
            const logEntry = document.createElement('div');
            const timestamp = document.createElement('span');
            const message = document.createElement('span');
            
            // 添加时间戳
            timestamp.className = 'timestamp';
            timestamp.textContent = new Date().toLocaleTimeString();
            
            // 设置消息样式
            logEntry.className = 'log-entry';
            message.textContent = event.data.message;
            
            // 根据消息内容设置样式
            if (event.data.message.includes('✅') || event.data.message.includes('成功')) {
              logEntry.classList.add('success');
            } else if (event.data.message.includes('❌') || event.data.message.includes('失败') || event.data.message.includes('错误')) {
              logEntry.classList.add('error');
            } else if (event.data.message.includes('警告')) {
              logEntry.classList.add('warning');
            } else if (event.data.message.includes('[自动同步]')) {
              logEntry.classList.add('info');
            }
            
            logEntry.appendChild(timestamp);
            logEntry.appendChild(message);
            logs.appendChild(logEntry);
            
            // 如果启用了自动滚动，则滚动到底部
            if (autoScroll && logs.scrollHeight > logs.clientHeight) {
              logs.scrollTop = logs.scrollHeight;
            }
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
