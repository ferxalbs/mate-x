export interface GitStatus {
  not_added: string[];
  conflicted: string[];
  created: string[];
  deleted: string[];
  modified: string[];
  renamed: { from: string; to: string }[];
  staged: string[];
  files: {
    path: string;
    index: string;
    working_dir: string;
  }[];
  ahead: number;
  behind: number;
  current: string | null;
  tracking: string | null;
  isClean: boolean;
}

export interface GitCommit {
  hash: string;
  date: string;
  message: string;
  author_name: string;
  author_email: string;
}

export interface GitDiff {
  files: {
    file: string;
    changes: number;
    insertions: number;
    deletions: number;
    binary: boolean;
  }[];
  insertions: number;
  deletions: number;
}
