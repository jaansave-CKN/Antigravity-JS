/**
 * Antigravity Skill: CONECTOR_GITHUB
 */
export class GitHubProvider {
  constructor(owner, repo, token) {
    this.owner = owner;
    this.repo = repo;
    this.token = token;
    this.baseUrl = 'https://api.github.com';
  }

  async getRepoStatus() {
    if (!this.owner || !this.repo) return { status: 'DISCONNECTED' };

    const headers = this.token ? { 'Authorization': `token ${this.token}` } : {};
    const response = await fetch(`${this.baseUrl}/repos/${this.owner}/${this.repo}`, { headers });
    
    if (!response.ok) return { status: 'ERROR', message: 'Repo access denied' };
    
    const data = await response.json();
    return {
      status: 'CONNECTED',
      fullName: data.full_name,
      visibility: data.private ? 'Private' : 'Public',
      stars: data.stargazers_count
    };
  }
}
