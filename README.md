# Stack File Sync

VSCode 插件用于在不同代码仓库之间同步文件。支持从多个 Git 仓库同步文件到指定目录，并提供文件备份功能。

## 功能特点

- 支持从多个 Git 仓库同步文件
- 支持文件模式匹配（使用 glob 语法）
- 支持排除特定文件或目录
- 同步前自动备份原文件
- 可配置目标同步目录
- 支持编译后处理（如 proto 文件编译）

## 快捷键

- `Ctrl/Cmd + Alt + S`: 执行文件同步
- `Ctrl/Cmd + Alt + ,`: 打开配置页面

> 提示：可以在 VSCode 的键盘快捷方式设置中自定义这些快捷键
>
> 1. 打开命令面板（`Ctrl/Cmd + Shift + P`）
> 2. 输入 "Preferences: Open Keyboard Shortcuts"
> 3. 搜索 "Stack File Sync" 找到相应命令
> 4. 点击编辑图标设置新的快捷键

## 使用方法

### 1. 配置同步设置

有多种方式打开配置：

- 使用快捷键 `Ctrl/Cmd + Alt + ,`
- 在命令面板中输入 "Stack File Sync: 配置同步"
- 在资源管理器中右键选择 "配置同步"

### 2. 执行文件同步

可以通过以下方式执行同步：

- 使用快捷键 `Ctrl/Cmd + Alt + S`
- 点击编辑器标题栏的同步图标
- 在命令面板中输入 "Stack File Sync: 同步文件"
- 在资源管理器中右键选择 "同步文件"

### 3. 同步流程

1. 选择要同步的仓库
2. 选择要同步的文件
3. 选择是否需要备份原文件
4. 等待同步完成
5. 执行配置的后处理命令（如果有）

## 配置项说明

### 仓库配置 (`stackFileSync.repositories`)

```json
{
  "stackFileSync.repositories": [
    {
      "name": "主服务",
      "url": "git@github.com:example/main-service.git",
      "branch": "main",
      "sourceDirectory": "proto/user"
    },
    {
      "name": "用户服务",
      "url": "git@github.com:example/user-service.git",
      "branch": "develop",
      "sourceDirectory": "proto/auth"
    }
  ]
}
```

- `name`: 仓库名称，用于显示在选择列表中
- `url`: Git 仓库地址，支持 HTTPS 和 SSH 格式
- `branch`: 要同步的分支名称
- `sourceDirectory`: 指定要同步的源目录，相对于仓库根目录的路径

### 文件模式 (`stackFileSync.filePatterns`)

```json
{
  "stackFileSync.filePatterns": ["**/*.proto", "**/*.thrift"]
}
```

支持 glob 模式，例如：

- `**/*.proto`: 匹配所有 .proto 文件
- `user/**/*.proto`: 只匹配 user 目录下的 .proto 文件

### 排除模式 (`stackFileSync.excludePatterns`)

```json
{
  "stackFileSync.excludePatterns": ["**/backend/**", "**/test/**"]
}
```

用于排除不需要同步的文件或目录。

### 目标目录 (`stackFileSync.targetDirectory`)

```json
{
  "stackFileSync.targetDirectory": "lib/common/net/grpcs/proto"
}
```

指定文件同步的目标目录，支持相对路径和绝对路径。

### 备份设置 (`stackFileSync.backupEnabled`)

```json
{
  "stackFileSync.backupEnabled": true
}
```

是否在同步前自动备份原文件。

### 后处理命令 (`stackFileSync.postSyncCommands`)

```json
{
  "stackFileSync.postSyncCommands": [
    {
      "directory": "lib/common/net/grpcs/proto",
      "command": "protoc --dart_out=grpc:../generated *.proto"
    },
    {
      "directory": "lib/common/net/thrifts",
      "command": "thrift --gen dart *.thrift"
    }
  ]
}
```

用于配置同步完成后要执行的命令：

- `directory`: 执行命令的目录（相对于工作区根目录）
- `command`: 要执行的命令

支持配置多个命令，会按顺序执行。

## 完整配置示例

```json
{
  "stackFileSync.repositories": [
    {
      "name": "主服务",
      "url": "git@github.com:example/main-service.git",
      "branch": "main",
      "sourceDirectory": "proto/user"
    },
    {
      "name": "用户服务",
      "url": "git@github.com:example/user-service.git",
      "branch": "develop",
      "sourceDirectory": "proto/auth"
    }
  ],
  "stackFileSync.filePatterns": ["**/*.proto", "**/*.thrift"],
  "stackFileSync.excludePatterns": ["**/backend/**", "**/test/**"],
  "stackFileSync.targetDirectory": "lib/common/net/grpcs/proto",
  "stackFileSync.backupEnabled": true,
  "stackFileSync.postSyncCommands": [
    {
      "directory": "lib/common/net/grpcs/proto",
      "command": "protoc --dart_out=grpc:../generated *.proto"
    }
  ]
}
```

## 注意事项

1. 确保有足够的 Git 仓库访问权限
2. 建议在同步前备份重要文件
3. 如果使用 SSH 地址，确保已配置好 SSH 密钥
4. 目标目录如果不存在会提示是否创建
5. 确保已安装后处理命令需要的工具（如 protoc、thrift 等）

## 常见问题

1. **同步失败**

   - 检查 Git 仓库访问权限
   - 确认网络连接正常
   - 验证目标目录权限

2. **找不到文件**

   - 检查文件模式配置是否正确
   - 确认文件在指定分支上存在
   - 查看是否被排除模式过滤

3. **编译失败**

   - 检查后处理命令配置是否正确
   - 确保命令行工具已正确安装
   - 验证执行目录是否存在
   - 检查命令执行权限
