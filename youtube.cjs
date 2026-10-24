const fs = require("node:fs/promises");

async function main() {
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("Missing GitHub secret: YOUTUBE_API_KEY");
  }

  const url = new URL(
    "https://www.googleapis.com/youtube/v3/channels"
  );

  url.searchParams.set("part", "snippet,statistics");
  url.searchParams.set("forHandle", "@taximalsvt");
  url.searchParams.set("key", apiKey);

  const response = await fetch(url, {
    signal: AbortSignal.timeout(30000)
  });

  if (!response.ok) {
    // Avoid printing the request URL because it contains the API key.
    throw new Error(
      `YouTube API request failed (${response.status}). ` +
      "Check that YouTube Data API v3 is enabled and the key is valid."
    );
  }

  const result = await response.json();
  const channel = result.items?.[0];

  if (!channel) {
    throw new Error("Could not find YouTube channel @taximalsvt.");
  }

  const statistics = channel.statistics;

  if (!statistics) {
    throw new Error("YouTube did not return channel statistics.");
  }

  function formatCount(value, label) {
    if (
      typeof value !== "string" ||
      !/^\d+$/.test(value)
    ) {
      throw new Error(`YouTube did not return a valid ${label}.`);
    }

    return BigInt(value).toLocaleString("en-AU");
  }

  const youtubeStats = [];

  if (!statistics.hiddenSubscriberCount) {
    youtubeStats.push({
      label: "YouTube subscribers",
      value: formatCount(
        statistics.subscriberCount,
        "subscriber count"
      )
    });
  }

  youtubeStats.push(
    {
      label: "YouTube total views",
      value: formatCount(statistics.viewCount, "view count")
    },
    {
      label: "YouTube public videos",
      value: formatCount(statistics.videoCount, "video count")
    }
  );

  // The Twitch collector creates this file first.
  const data = JSON.parse(
    await fs.readFile("public/data.json", "utf8")
  );

  if (!Array.isArray(data.stats)) {
    throw new Error("The existing stats file has an unexpected format.");
  }

  // Replace any previous YouTube entries while keeping Twitch stats.
  data.stats = [
    ...data.stats.filter(
      stat => !stat.label.startsWith("YouTube ")
    ),
    ...youtubeStats
  ];

  data.source = "Twitch API + YouTube Data API";
  data.youtubeCollectedAt = new Date().toISOString();

  await fs.writeFile(
    "public/data.json",
    JSON.stringify(data, null, 2)
  );

  console.log(
    `Collected YouTube stats for ${channel.snippet.title}.`
  );
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
