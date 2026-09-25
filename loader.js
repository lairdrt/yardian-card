const yardianLoadTimestamp = Date.now();

import(
  `/local/yardian-card/yardian-card.js?ts=${yardianLoadTimestamp}`
)
  .catch((error) => {
    console.error("Failed to load Yardian card:", error);
  });
