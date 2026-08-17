import { defineConfig } from "vitepress";

export default defineConfig({
  title: "@corti/agent-sdk",
  description: "Developer-friendly wrapper for building agents with the Corti SDK.",
  lang: "en-US",
  cleanUrls: true,
  ignoreDeadLinks: [/^https?:\/\/localhost/],
  srcExclude: ["plans/**"],

  head: [
    ["meta", { name: "theme-color", content: "#0d0f14" }],
  ],

  themeConfig: {
    logo: "/logo.svg",
    siteTitle: "@corti/agent-sdk",

    nav: [
      { text: "Docs", link: "/" },
      { text: "TypeScript Examples", link: "/examples/01-hello-agent" },
      { text: "Python SDK", link: "/python/" },
      {
        text: "Links",
        items: [
          { text: "GitHub", link: "https://github.com/corticph" },
          { text: "npm — @corti/sdk", link: "https://www.npmjs.com/package/@corti/sdk" },
        ],
      },
    ],

    sidebar: {
      "/": [
        {
          text: "Getting started",
          items: [
            { text: "Introduction", link: "/#introduction" },
            { text: "Install", link: "/#install" },
            { text: "Quick start", link: "/#quick-start" },
          ],
        },
        {
          text: "Concepts",
          items: [
            { text: "Agents", link: "/#agents" },
            { text: "Connectors", link: "/#connectors" },
            { text: "Contexts & threads", link: "/#contexts" },
            { text: "Response shape", link: "/#responses" },
            { text: "Agent lifecycle", link: "/#lifecycle" },
          ],
        },
        {
          text: "Composition",
          items: [
            { text: "Workflows", link: "/#workflows" },
            { text: "Parallel fan-out", link: "/#parallel" },
            { text: "State graph", link: "/#state-graph" },
            { text: "Declarative workflows", link: "/#declarative-workflows" },
            { text: "Streaming", link: "/#streaming" },
            { text: "Credentials", link: "/#credentials" },
          ],
        },
        {
          text: "Reference",
          items: [
            { text: "API reference", link: "/#api" },
            { text: "Examples", link: "/#examples" },
            { text: "Python SDK", link: "/python/" },
          ],
        },
      ],

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
          text: "Back",
          items: [{ text: "← Docs home", link: "/" }],
        },
      ],

      "/python/": [
        {
          text: "Python SDK",
          items: [
            { text: "Overview", link: "/python/" },
            { text: "Install", link: "/python/#install" },
            { text: "Quick start", link: "/python/#quick-start" },
            { text: "API reference", link: "/python/#api" },
            { text: "vs TypeScript", link: "/python/#differences" },
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
          text: "Back",
          items: [{ text: "← Docs home", link: "/" }],
        },
      ],
    },

    socialLinks: [
      { icon: "github", link: "https://github.com/corticph" },
    ],

    outline: {
      level: [2, 3],
      label: "On this page",
    },

    footer: {
      message: "MIT-licensed · built on @corti/sdk",
    },

    darkModeSwitchLabel: "Theme",
    sidebarMenuLabel: "Menu",
    returnToTopLabel: "Back to top",
  },
});
