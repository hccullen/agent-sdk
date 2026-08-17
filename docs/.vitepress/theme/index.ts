import type { Theme } from "vitepress";
import DefaultTheme from "vitepress/theme";
import "./custom.css";

import ConceptGrid from "./components/ConceptGrid.vue";
import ConceptCard from "./components/ConceptCard.vue";
import OutputBlock from "./components/OutputBlock.vue";
import ExampleLinks from "./components/ExampleLinks.vue";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("ConceptGrid", ConceptGrid);
    app.component("ConceptCard", ConceptCard);
    app.component("OutputBlock", OutputBlock);
    app.component("ExampleLinks", ExampleLinks);
  },
} satisfies Theme;
