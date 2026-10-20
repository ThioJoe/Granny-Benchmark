/* Granny Bench - optional auto-loaded config file.

   1. Copy this file to "config.local.js" in the same folder as index.html.
      (config.local.js is listed in .gitignore so it is never committed.)
   2. Fill in the API keys you want to use. Leave the others empty.
   3. In the app, open Settings > Keys & Security and tick
      "Auto-load config.local.js on startup", then reload the page.

   Keys loaded this way are kept in memory for the session only; they are not written to
   browser storage. This file is plain text on your disk, so the encrypted in-browser key
   storage (Settings > Keys & Security) is the safer option if other people use this computer.

   Custom OpenAI-compatible providers use the ID shown on their card in Settings > Providers
   (it looks like "prov_ab12cd34ef56"). */
window.GRANNY_BENCH_CONFIG = {
  keys: {
    anthropic: '', // sk-ant-...
    openai: '',    // sk-...
    gemini: '',    // AIza...
    // prov_ab12cd34ef56: '',
  },
};
