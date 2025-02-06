import * as vscode from "vscode";

// 自动同步相关的类型定义
export interface AutoSyncConfig {
  enabled: boolean;
  interval: number;
}

export interface Repository {
  name: string;
  url: string;
  branch: string;
  sourceDirectory: string;
  targetDirectory: string;
  filePatterns?: string[];
  excludePatterns?: string[];
  postSyncCommands?: PostSyncCommand[];
  autoSync?: AutoSyncConfig;
  selectedFiles?: string[];

  // 添加内网同步配置
  internalSync?: {
    enabled: boolean;
    networkPath: string; // 如: "\\192.168.1.100\project\proto" 或 "//192.168.1.100/project/proto"
  };
}

export interface PostSyncCommand {
  directory: string;
  command: string;
}
