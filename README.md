# Stack File Sync

VSCode 插件用于在不同代码仓库之间同步文件。

## 功能特点

- 支持从多个 Git 仓库同步文件
- 支持文件模式匹配（使用 glob 语法）
- 同步前自动备份原文件
- 可配置目标同步目录

## 使用方法

1. 在 VSCode 命令面板中输入 "Stack File Sync: 配置同步设置" 来配置仓库和文件模式
2. 使用 "Stack File Sync: 同步文件" 命令来执行文件同步

## 配置项

- `stackFileSync.repositories`: Git 仓库列表配置
  - `url`: 仓库地址
  - `branch`: 要同步的分支名称（默认: main）
- `stackFileSync.filePatterns`: 要同步的文件匹配模式（例如: "\*_/_.proto"）
- `stackFileSync.targetDirectory`: 文件同步的目标目录
- `stackFileSync.backupBeforeSync`: 是否在同步前备份原文件（默认: true）

## 示例配置

```json
{
  "stackFileSync.repositories": [
    {
      "url": "https://github.com/example/repo1.git",
      "branch": "main"
    },
    {
      "url": "https://github.com/example/repo2.git",
      "branch": "develop"
    }
  ],
  "stackFileSync.filePatterns": ["**/*.proto", "**/*.thrift"],
  "stackFileSync.targetDirectory": "lib/common/proto",
  "stackFileSync.backupBeforeSync": true
}
```
