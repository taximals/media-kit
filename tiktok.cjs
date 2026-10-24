const fs = require("node:fs/promises");
const crypto = require("node:crypto");

const TOKEN_FILE = ".tiktok-state.enc";

function required(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing GitHub secret: ${name}`);
  }

  return value;
}

function mask(value) {
  if (process.env.GITHUB_ACTIONS && value) {
    console.log(`::add-mask::${value}`);
  }
}

async function main() {
  const clientKey = required("TIKTOK_CLIENT_KEY");
  const clientSecret = required("TIKTOK_CLIENT_SECRET");
  const initialRefreshToken = required("TIKTOK_REFRESH_TOKEN");

  const encryptionKey = crypto
    .createHash("sha256")
    .update(clientSecret)
    .digest();

  async function saveState(state) {
    const iv = crypto.randomBytes(12);

    const cipher = crypto.createCipheriv(
      "aes-256-gcm",
      encryptionKey,
      iv
    );

    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(state), "utf8"),
      cipher.final()
    ]);

    await fs.writeFile(
      TOKEN_FILE,
      Buffer.concat([
        iv,
        cipher.getAuthTag(),
        encrypted
      ])
    );
  }

  let state;

  try {
    const saved = await fs.readFile(TOKEN_FILE);

    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      encryptionKey,
      saved.subarray(0, 12)
    );

    decipher.setAuthTag(saved.subarray(12, 28));

    state = JSON.parse(
      Buffer.concat([
        decipher.update(saved.subarray(28)),
        decipher.final()
      ]).toString("utf8")
    );

    if (
      typeof state.refreshToken !== "string" ||
      !state.refreshToken
    ) {
      throw new Error("Invalid saved token state.");
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw new Error(
        "Could not read or decrypt saved TikTok tokens."
      );
    }

    state = {
      refreshToken: initialRefreshToken
    };
  }

  mask(state.refreshToken);

  // Obtain a fresh access token for this collection run.
  const tokenResponse = await fetch(
    "https://open.tiktokapis.com/v2/oauth/token/",
    {
      method: "POST",
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: state.refreshToken
      }),
      signal: AbortSignal.timeout(30000)
    }
  );

  const tokens = await tokenResponse.json();

  if (
    !tokenResponse.ok ||
    tokens.error ||
    !tokens.access_token ||
    !tokens.refresh_token
  ) {
    const errorCode =
      typeof tokens.error === "string"
        ? tokens.error
        : "unknown_error";

    throw new Error(
      `TikTok token refresh failed. ` +
      `HTTP status: ${tokenResponse.status}. ` +
      `TikTok error code: ${errorCode}.`
    );
  }

  mask(tokens.access_token);
  mask(tokens.refresh_token);

  if (
    state.openId &&
    tokens.open_id !== state.openId
  ) {
    throw new Error(
      "TikTok returned a different authorised account."
    );
  }

  // Save immediately because TikTok may rotate the refresh token.
  state = {
    refreshToken: tokens.refresh_token,
    openId: tokens.open_id
  };

  await saveState(state);

  const scopes = new Set(
    String(tokens.scope || "")
      .split(",")
      .map(scope => scope.trim())
  );

  if (!scopes.has("user.info.stats")) {
    throw new Error(
      "TikTok authorisation is missing user.info.stats. " +
      "Add that scope and authorise again."
    );
  }

  const url = new URL(
    "https://open.tiktokapis.com/v2/user/info/"
  );

  url.searchParams.set(
    "fields",
    "open_id,display_name,follower_count,likes_count,video_count"
  );

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${tokens.access_token}`
    },
    signal: AbortSignal.timeout(30000)
  });

  const result = await response.json();

  if (
    !response.ok ||
    result.error?.code !== "ok"
  ) {
    throw new Error(
      "TikTok profile request failed. " +
      "Check your sandbox target user and stats permission."
    );
  }

  const user = result.data?.user;

  if (
    !user ||
    !state.openId ||
    user.open_id !== state.openId
  ) {
    throw new Error(
      "TikTok did not return the expected authorised account."
    );
  }

  function formatCount(value, label) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(
        `TikTok did not return a valid ${label}.`
      );
    }

    return value.toLocaleString("en-AU");
  }

  const tiktokStats = [
    {
      label: "TikTok followers",
      value: formatCount(
        user.follower_count,
        "follower count"
      )
    },
    {
      label: "TikTok total likes",
      value: formatCount(
        user.likes_count,
        "likes count"
      )
    },
    {
      label: "TikTok public videos",
      value: formatCount(
        user.video_count,
        "video count"
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
      stat => !stat.label.startsWith("TikTok ")
    ),
    ...tiktokStats
  ];

  data.source =
    "Twitch API + YouTube Data API + Instagram API + TikTok API";

  data.tiktokCollectedAt = new Date().toISOString();

  await fs.writeFile(
    "public/data.json",
    JSON.stringify(data, null, 2)
  );

  console.log(
    "Collected TikTok stats for display name: " +
    user.display_name
  );
}

main().catch(error => {
  // These messages are deliberately written without token values.
  // Avoid logging raw API responses or request URLs.
  console.error(
    error instanceof TypeError
      ? "TikTok request failed. Check network access and API availability."
      : error.message
  );

  process.exitCode = 1;
});
