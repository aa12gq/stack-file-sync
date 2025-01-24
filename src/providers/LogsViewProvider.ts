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
