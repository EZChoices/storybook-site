(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.StoryTemplates = factory();
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  const templates = {
    "mom-love-0-3": {
      templateId: "mom-love-0-3",
      title: "To Mom, With Love (Ages 0–3)",
      pages: [
        {
          role: "Opening",
          caption: "To Mom, with love.",
          imagePrompt: "warm opening portrait, close bond, gentle light",
        },
        {
          role: "Joy",
          caption: "Your smile makes my world brighter.",
          imagePrompt: "joyful moment, laughter, bright but soft",
        },
        {
          role: "Care",
          caption: "You take care of me in a thousand little ways.",
          imagePrompt: "nurturing moment, tenderness, cozy",
        },
        {
          role: "Calm",
          caption: "With you, I feel safe.",
          imagePrompt: "quiet calm scene, soft shadows, peaceful",
        },
        {
          role: "Everyday magic",
          caption: "Even ordinary days feel special with you.",
          imagePrompt: "simple day to day moment, wholesome, warm colors",
        },
        {
          role: "Closing",
          caption: "I love you, today and always.",
          imagePrompt: "closing moment, affectionate, storybook finish",
        },
      ],
    },
  };

  function getTemplate(templateId) {
    return templates[templateId] || null;
  }

  return { templates, getTemplate };
});

