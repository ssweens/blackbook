export function getGitHubToken(): string | null {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;
}

export function isGitHubHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === "github.com" ||
      host === "raw.githubusercontent.com" ||
      host === "api.github.com" ||
      host === "gist.github.com" ||
      host === "gist.githubusercontent.com"
    );
  } catch {
    return false;
  }
}
