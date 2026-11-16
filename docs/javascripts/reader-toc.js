/* B-B.3.3 试点：本页目录折叠，以及锚点与高亮同步。 */
(() => {
  let activeObserver;
  let currentToc = null;
  let lastActiveLink = null;
  let pinnedHash = null;
  let pinnedAt = 0;
  let sequence = 0;

  function setExpanded(item, expanded) {
    const button = item.querySelector(':scope > .reader-toc-toggle');
    const link = item.querySelector(':scope > .md-nav__link');
    if (!button || !link) return;
    item.classList.toggle('is-expanded', expanded);
    button.setAttribute('aria-expanded', String(expanded));
    button.setAttribute(
      'aria-label',
      `${expanded ? '收起' : '展开'}“${link.textContent.trim()}”的子目录`
    );
  }

  function hashLink(toc) {
    /* Material 的滚动追踪会在点击后延迟更新地址；短时间内以用户点击为准。 */
    const hash = pinnedHash && performance.now() - pinnedAt < 750
      ? pinnedHash
      : location.hash;
    if (hash === '') return null;
    return [...toc.querySelectorAll('.md-nav__link')].find((link) => {
      try {
        return new URL(link.href).hash === hash;
      } catch {
        return false;
      }
    });
  }

  function syncActive(toc) {
    const target = hashLink(toc);
    const links = [...toc.querySelectorAll('.md-nav__link')];

    if (target) {
      for (const link of links) {
        const isTarget = link === target;
        link.classList.toggle('md-nav__link--active', isTarget);
        if (isTarget) {
          if (link.getAttribute('aria-current') !== 'location') {
            link.setAttribute('aria-current', 'location');
          }
        } else {
          link.removeAttribute('aria-current');
        }
      }
    }

    const active = target || toc.querySelector('.md-nav__link--active, .md-nav__link[aria-current]');
    const item = active?.closest('.reader-toc-collapsible');
    if (item && active !== lastActiveLink) setExpanded(item, true);
    lastActiveLink = active || null;
  }

  function initialize() {
    const toc = document.querySelector('.md-sidebar--secondary [data-md-component="toc"]');
    activeObserver?.disconnect();
    if (!document.querySelector('.reader-b2') || !toc) return;
    if (currentToc !== toc) {
      currentToc = toc;
      pinnedHash = null;
      lastActiveLink = null;
    }

    const items = toc.querySelectorAll(':scope > .md-nav__item');
    for (const item of items) {
      const nested = item.querySelector(':scope > .md-nav > .md-nav__list');
      if (!nested) continue;
      item.classList.add('reader-toc-collapsible');
      if (item.dataset.readerTocReady === 'true') continue;

      const link = item.querySelector(':scope > .md-nav__link');
      if (!link) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'reader-toc-toggle';
      nested.id = `reader-toc-group-${++sequence}`;
      button.setAttribute('aria-controls', nested.id);
      button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      button.addEventListener('click', () => {
        setExpanded(item, !item.classList.contains('is-expanded'));
      });
      item.appendChild(button);
      item.dataset.readerTocReady = 'true';
      setExpanded(item, false);
    }

    toc.addEventListener('click', (event) => {
      const link = event.target.closest('.md-nav__link');
      if (!link || !toc.contains(link)) return;
      try {
        pinnedHash = new URL(link.href).hash;
        pinnedAt = performance.now();
      } catch {
        pinnedHash = null;
      }
      syncActive(toc);
      setTimeout(() => {
        if (document.contains(toc)) syncActive(toc);
      }, 0);
    });

    syncActive(toc);
    activeObserver = new MutationObserver(() => syncActive(toc));
    activeObserver.observe(toc, {
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'aria-current'],
    });
  }

  const navigationObserver = new MutationObserver(initialize);
  navigationObserver.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('hashchange', () => {
    const toc = document.querySelector('.md-sidebar--secondary [data-md-component="toc"]');
    if (document.querySelector('.reader-b2') && toc) syncActive(toc);
  });
  initialize();
})();
