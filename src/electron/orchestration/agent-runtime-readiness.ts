export class AgentRuntimeReadiness<T> {
  private runtime: T | null = null;
  private initializationError: string | null = null;

  setRuntime(runtime: T | null) {
    this.runtime = runtime;
    if (runtime) {
      this.initializationError = null;
    }
  }

  setInitializationError(error: unknown) {
    this.initializationError = error instanceof Error ? error.message : String(error);
  }

  getRuntime() {
    return this.runtime;
  }

  getErrorMessage() {
    if (this.runtime) {
      return null;
    }

    return this.initializationError
      ? `Agent runtime failed to initialize: ${this.initializationError}`
      : 'Agent runtime is not ready. Restart MaTE X and try again.';
  }
}
