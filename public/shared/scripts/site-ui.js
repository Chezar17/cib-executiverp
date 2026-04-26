(function attachSiteUiHelpers(globalObj) {

  // ── Page fade transitions ─────────────────────────────────────
  function initPageFadeTransitions(options) {
    var transitionMs       = (options && options.transitionMs)       || 400
    var skipInitialFadeIn  = options && options.skipInitialFadeIn

    if (!skipInitialFadeIn) {
      window.addEventListener('DOMContentLoaded', function () {
        requestAnimationFrame(function () {
          document.body.classList.add('page-visible')
        })
      })
    }

    document.querySelectorAll('a[href]').forEach(function (link) {
      link.addEventListener('click', function (e) {
        var href = this.getAttribute('href')
        if (
          !href ||
          href.startsWith('http') ||
          href.startsWith('#') ||
          href.startsWith('mailto')
        ) return

        e.preventDefault()
        document.body.classList.remove('page-visible')
        setTimeout(function () {
          window.location.href = href
        }, transitionMs)
      })
    })
  }

  // ── Scroll reveal (IntersectionObserver) ─────────────────────
  function initScrollReveal(options) {
    var threshold = (options && options.threshold) || 0.12
    var selector  = (options && options.selector)  || '.reveal, .reveal-left, .reveal-right'

    function attach() {
      var elements = document.querySelectorAll(selector)
      if (!elements.length) return

      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible')
            observer.unobserve(entry.target)
          }
        })
      }, { threshold: threshold })

      elements.forEach(function (el) { observer.observe(el) })
    }

    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', attach)
    } else {
      attach()
    }
  }

  // ── Shared head boilerplate injector ─────────────────────────
  // Inserts Google Fonts link if not already present.
  function injectGoogleFonts() {
    var id = 'cib-gfonts'
    if (document.getElementById(id)) return
    var link = document.createElement('link')
    link.id   = id
    link.rel  = 'stylesheet'
    link.href = 'https://fonts.googleapis.com/css2?family=Oswald:wght@400;600;700' +
                '&family=Roboto:wght@300;400;500' +
                '&family=Roboto+Mono:wght@400;500&display=swap'
    document.head.appendChild(link)
  }

  globalObj.SiteUi = {
    initPageFadeTransitions : initPageFadeTransitions,
    initScrollReveal        : initScrollReveal,
    injectGoogleFonts       : injectGoogleFonts,
  }

})(window)
