// Shared by the classic content script and extension modules.
globalThis.ContributorLensAuthors = (() => {
  const bots = new Set([
    "dependabot",
    "dependabot-preview",
    "renovate",
    "renovate-bot",
    "github-actions",
    "greenkeeper",
  ]);
  return Object.freeze({
    isBot: (user) =>
      typeof user === "string" &&
      (/\[bot\]$/i.test(user) || bots.has(user.toLowerCase())),
  });
})();
