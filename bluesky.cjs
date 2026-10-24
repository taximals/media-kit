const fs = require("node:fs/promises");

async function main() {
  const handle = "taximals.bsky.social";

  const url = new URL(
    "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile"
  );

  url.searchParams.set("actor", handle);

  const response = await fetch(url, {
    signal: AbortSignal.timeout(30000)
  });

  if (!response.ok) {
    throw new Error(
      `Bluesky profile request failed (${response.status}).`
    );
  }

  const profile = await response.json();

  if (profile.handle?.toLowerCase() !== handle) {
    throw new Error(
      "Bluesky did not return the expected account."
    );
  }

  function formatCount(value, label) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(
        `Bluesky did not return a valid ${label}.`
      );
    }

    return value.toLocaleString("en-AU");
  }

  const blueskyStats = [
    {
      label: "Bluesky followers",
      value: formatCount(
        profile.followersCount,
        "follower count"
      )
    },
    {
      label: "Bluesky following",
      value: formatCount(
        profile.followsCount,
        "following count"
      )
    },
    {
      label: "Bluesky posts",
      value: formatCount(
        profile.postsCount,
        "post count"
      )
    }
  ];

  const data = JSON.parse(
    await fs.readFile("public/data.json", "utf8")
  );

  if (!Array.isArray(data.stats)) {
    throw new Error(
      "The existing stats file has an unexpected format."
    );
  }

  data.stats = [
    ...data.stats.filter(
      stat => !stat.label.startsWith("Bluesky ")
    ),
    ...blueskyStats
  ];

  data.blueskyCollectedAt = new Date().toISOString();

  data.source =
    "Twitch API + YouTube Data API + Instagram API + TikTok API + Bluesky API";

  await fs.writeFile(
    "public/data.json",
    JSON.stringify(data, null, 2)
  );

  console.log("Collected Bluesky stats for " + handle);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
