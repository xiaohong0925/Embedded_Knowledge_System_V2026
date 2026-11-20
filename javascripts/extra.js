/* ========================================
   右侧 TOC 手风琴折叠（纯 JS，无 overrides）
   ======================================== */

(function() {
    'use strict';

    function initTocCollapse() {
        const sidebar = document.querySelector('.md-sidebar--secondary');
        if (!sidebar) return;

        const tocNav = sidebar.querySelector('.md-nav[data-md-component="toc"]');
        if (!tocNav || tocNav.dataset.tocCollapsible === 'true') return;
        tocNav.dataset.tocCollapsible = 'true';

        const topList = tocNav.querySelector(':scope > .md-nav__list');
        if (!topList) return;

        // 只处理顶层 li（对应 H2），把其下的 H3/H4 包进折叠区
        topList.querySelectorAll(':scope > .md-nav__item').forEach(function(item) {
            const subList = item.querySelector(':scope > .md-nav__list');
            const link    = item.querySelector(':scope > .md-nav__link');

            if (!subList || !link) return;

            // 标记
            item.classList.add('toc-has-children');

            // 创建 wrapper 包裹标题和 toggle
            const wrapper = document.createElement('div');
            wrapper.className = 'toc-node';
            link.parentNode.insertBefore(wrapper, link);
            wrapper.appendChild(link);

            // 创建 toggle 箭头（Material 风格 SVG）
            const toggle = document.createElement('span');
            toggle.className = 'toc-toggle';
            toggle.setAttribute('role', 'button');
            toggle.setAttribute('tabindex', '0');
            toggle.setAttribute('aria-label', '展开/折叠');
            toggle.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M8.59 16.58 13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.42Z"/></svg>';
            wrapper.appendChild(toggle);

            // 默认折叠
            subList.style.display = 'none';
            item.classList.add('toc-collapsed');

            // 切换逻辑
            function doToggle(e) {
                e.preventDefault();
                e.stopPropagation();
                const hide = subList.style.display === 'block';
                subList.style.display = hide ? 'none' : 'block';
                item.classList.toggle('toc-collapsed', hide);
                item.classList.toggle('toc-expanded', !hide);
            }

            toggle.addEventListener('click', doToggle);
            toggle.addEventListener('keydown', function(e) {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); doToggle(e); }
            });
        });
    }

    // 首次加载
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initTocCollapse);
    } else {
        initTocCollapse();
    }

    // 兼容 Material instant navigation：监听 sidebar 内容变化
    if (document.querySelector('.md-sidebar--secondary')) {
        new MutationObserver(function() {
            const nav = document.querySelector('.md-sidebar--secondary .md-nav[data-md-component="toc"]:not([data-toc-collapsible="true"])');
            if (nav) initTocCollapse();
        }).observe(document.querySelector('.md-sidebar--secondary'), { childList: true, subtree: true });
    }

    // 额外保险：拦截 pushState（Material 无刷新切页时会触发）
    const orig = history.pushState;
    history.pushState = function() {
        orig.apply(this, arguments);
        setTimeout(initTocCollapse, 50);
    };
})();