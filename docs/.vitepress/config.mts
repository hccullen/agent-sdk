import { defineConfig } from "vitepress";

export default defineConfig({
  title: "@corti/agent-sdk",
  description: "Developer-friendly wrapper for building agents with the Corti SDK.",
  lang: "en-US",
  cleanUrls: true,
  ignoreDeadLinks: [/^https?:\/\/localhost/],
  srcExclude: ["plans/**"],
  lastUpdated: true,
  sitemap: {
    hostname: "https://corticph.github.io/agent-sdk",
  },

  head: [
    ["meta", { name: "theme-color", content: "#0d0f14" }],
  ],

  themeConfig: {
    logo: "/logo.svg",
    siteTitle: "@corti/agent-sdk",

    nav: [
      { text: "Docs", link: "/" },
      { text: "Examples", link: "/examples/01-hello-agent" },
      { text: "Python SDK", link: "/python/" },
      {
        text: "Links",
        items: [
          { text: "GitHub", link: "https://github.com/corticph" },
          { text: "npm — @corti/sdk", link: "https://www.npmjs.com/package/@corti/sdk" },
        ],
      },
    ],

    search: {
      provider: "local",
      options: {
        translations: {
          button: {
            buttonText: "Search docs",
            buttonAriaLabel: "Search docs",
          },
          modal: {
            noResultsText: "No results found.",
            resetButtonTitle: "Clear search",
            footer: {
              selectText: "Select",
              navigateText: "Navigate",
              closeText: "Close",
            },
          },
        },
      },
    },

    sidebar: {
      "/examples/": [
        {
          text: "TypeScript examples",
          items: [
            { text: "01 · Hello, agent", link: "/examples/01-hello-agent" },
            { text: "02 · Connectors", link: "/examples/02-connectors" },
            { text: "03 · Workflow", link: "/examples/03-workflow" },
            { text: "04 · Parallel fan-out", link: "/examples/04-parallel" },
            { text: "05 · Streaming", link: "/examples/05-streaming" },
            { text: "06 · Credentials", link: "/examples/06-credentials" },
            { text: "07 · State graph", link: "/examples/07-state-graph" },
            { text: "08 · Declarative workflows", link: "/examples/08-declarative-workflows" },
          ],
        },
        {
          text: "Reference",
          items: [
            { text: "← Docs home", link: "/" },
            { text: "Python SDK →", link: "/python/" },
          ],
        },
      ],

      "/python/": [
        {
          text: "Python SDK",
          items: [
            { text: "Overview", link: "/python/" },
          ],
        },
        {
          text: "Python examples",
          items: [
            { text: "01 · Hello, agent", link: "/python/01-hello-agent" },
            { text: "02 · Connectors", link: "/python/02-connectors" },
            { text: "03 · Workflow", link: "/python/03-workflow" },
            { text: "04 · Parallel fan-out", link: "/python/04-parallel" },
            { text: "05 · Streaming", link: "/python/05-streaming" },
            { text: "06 · Credentials", link: "/python/06-credentials" },
            { text: "07 · State graph", link: "/python/07-state-graph" },
          ],
        },
        {
          text: "Reference",
          items: [
            { text: "← Docs home", link: "/" },
            { text: "TypeScript Examples →", link: "/examples/01-hello-agent" },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: "github", link: "https://github.com/corticph" },
    ],

    editLink: {
      pattern: "https://github.com/corticph/agent-sdk/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },

    outline: {
      level: [2, 3],
      label: "On this page",
    },

    footer: {
      message: "MIT-licensed · built on @corti/sdk",
      copyright: "Copyright © 2024–2025 Corti",
    },

    darkModeSwitchLabel: "Theme",
    sidebarMenuLabel: "Menu",
    returnToTopLabel: "Back to top",
    lastUpdated: {
      text: "Last updated",
    },
  },
});
