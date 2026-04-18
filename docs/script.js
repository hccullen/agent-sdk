// Highlight the sidebar link for the section currently in view.
(function () {
  const links = Array.from(document.querySelectorAll(".sidebar a[href^='#']"));
  const byId = new Map(
    links.map((a) => [a.getAttribute("href").slice(1), a])
  );

  const sections = Array.from(document.querySelectorAll("main section[id]")).filter(
    (s) => byId.has(s.id)
  );

  function setActive(id) {
    links.forEach((a) => a.classList.remove("active"));
    const link = byId.get(id);
    if (link) link.classList.add("active");
  }

  const observer = new IntersectionObserver(
    (entries) => {
      // Pick the entry closest to the top of the viewport among visible ones.
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible.length) setActive(visible[0].target.id);
    },
    {
      // Trigger when a section crosses roughly the top third of the viewport.
      rootMargin: "-80px 0px -60% 0px",
      threshold: 0,
    }
  );

  sections.forEach((s) => observer.observe(s));

  // Initial state — match the hash if present, otherwise the first section.
  const initial = location.hash ? location.hash.slice(1) : sections[0]?.id;
  if (initial) setActive(initial);
})();
