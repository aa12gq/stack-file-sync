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
}

export interface PostSyncCommand {
  directory: string;
  command: string;
}
