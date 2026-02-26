export type ModuleStatus = "ok" | "missing" | "drifted" | "failed";

export type DriftKind =
  | "in-sync"
  | "source-changed"
  | "target-changed"
  | "both-changed"
  | "never-synced";

export interface CheckResult {
  status: ModuleStatus;
  message: string;
  diff?: string;
  error?: string;
  driftKind?: DriftKind;
}

export interface ApplyResult {
  changed: boolean;
  message: string;
  backup?: string;
  error?: string;
}

export interface Module<P> {
  readonly name: string;
  check(params: P): Promise<CheckResult>;
  apply(params: P): Promise<ApplyResult>;
}
