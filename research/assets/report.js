// AgentQ research reports: theme toggle + table-of-contents highlight.
// Plain script (no modules) so reports work from file:// with no server.
(function () {
  var KEY = "agentq-report-theme";
  var root = document.documentElement;

  function readTheme() {
    try {
      return localStorage.getItem(KEY);
    } catch (e) {
      return null;
    }
  }

  function writeTheme(value) {
    try {
      localStorage.setItem(KEY, value);
    } catch (e) {
      /* storage blocked: the toggle still works for this visit */
    }
  }

  function currentTheme() {
    var stamped = root.getAttribute("data-theme");
    if (stamped) return stamped;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  var saved = readTheme();
  if (saved === "dark" || saved === "light") root.setAttribute("data-theme", saved);

  document.addEventListener("DOMContentLoaded", function () {
    var toggle = document.querySelector("[data-theme-toggle]");
    if (toggle) {
      var label = function () {
        toggle.textContent = currentTheme() === "dark" ? "Tema claro" : "Tema oscuro";
      };
      label();
      toggle.addEventListener("click", function () {
        var next = currentTheme() === "dark" ? "light" : "dark";
        root.setAttribute("data-theme", next);
        writeTheme(next);
        label();
      });
    }

    // The table of contents starts collapsed on narrow screens (it sits above the content there).
    var tocDetails = document.querySelector(".r-toc details");
    if (tocDetails && window.innerWidth < 1024) tocDetails.removeAttribute("open");

    // Highlight the section being read in the table of contents.
    var links = Array.prototype.slice.call(document.querySelectorAll(".r-toc a[href^='#']"));
    if (!links.length || !("IntersectionObserver" in window)) return;
    var byId = {};
    links.forEach(function (a) {
      byId[a.getAttribute("href").slice(1)] = a;
    });
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          links.forEach(function (a) {
            a.removeAttribute("aria-current");
          });
          var link = byId[entry.target.id];
          if (link) link.setAttribute("aria-current", "true");
        });
      },
      { rootMargin: "-10% 0px -80% 0px" },
    );
    Object.keys(byId).forEach(function (id) {
      var section = document.getElementById(id);
      if (section) observer.observe(section);
    });
  });
})();
