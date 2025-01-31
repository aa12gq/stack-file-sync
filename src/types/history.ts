export interface SyncHistoryItem {
  id: string;
  timestamp: number;
  repository: string;
  branch: string;
  files: string[];
  status: "success" | "failed";
  error?: string;
  duration: number;
  syncType: "manual" | "auto";
}

export interface SyncStatistics {
  totalSyncs: number;
  successfulSyncs: number;
  failedSyncs: number;
  totalFiles: number;
  averageDuration: number;
  lastSync: number;
}

export interface HistoryTreeItem {
  id: string;
  label: string;
  description?: string;
  tooltip?: string;
  contextValue?: string;
  iconPath?: string;
  children?: HistoryTreeItem[];
}
