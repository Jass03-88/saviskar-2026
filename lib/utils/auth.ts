export function parseAuthHash(hash: string) {
  if (!hash) return { error: "missing_hash" };
  const cleanHash = hash.startsWith("#") ? hash.substring(1) : hash;
  if (!cleanHash) return { error: "empty_hash" };
  
  const params = new URLSearchParams(cleanHash);
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  
  if (!accessToken || !refreshToken) {
    return { error: "invalid_tokens" };
  }
  
  return { accessToken, refreshToken };
}
