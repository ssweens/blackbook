/**
 * Resolve once everything already written to stdout and stderr has flushed.
 * Writes to a pipe are async, so exiting right after printing drops whatever
 * is past the 64 KB pipe buffer (e.g. `blackbook list --json | jq`). An empty
 * write's callback runs only after all earlier writes on that stream.
 */
export function flushStdio(): Promise<void> {
  return Promise.all(
    [process.stdout, process.stderr].map((stream) => new Promise<void>((done) => stream.write("", () => done()))),
  ).then(() => undefined);
}
