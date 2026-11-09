export interface PageHeightObservation {
  refresh(): void;
  dispose(): void;
}

/** Shell owns viewport height and sticky insets. Feature panes retain their own scroll. */
export function createPageLayout(shell: HTMLElement, content: HTMLElement, routeSession: HTMLElement) {
  const listener = new AbortController();
  function updateRouteInset() {
    const style = getComputedStyle(routeSession);
    const height = style.position === 'sticky' || style.position === 'fixed' ? routeSession.getBoundingClientRect().height : 0;
    const inset = height ? height + (Number.parseFloat(style.top) || 0) : 0;
    shell.style.setProperty('--active-route-inset', `${inset + 16}px`);
  }
  const routeObserver = new ResizeObserver(updateRouteInset);
  routeObserver.observe(routeSession);
  window.addEventListener('resize', updateRouteInset, { signal: listener.signal });
  updateRouteInset();

  return {
    observeHeight(host: HTMLElement, measure: (available: number) => void): PageHeightObservation {
      const resizeListener = new AbortController();
      let frame = 0;
      function refresh() {
        if (frame || resizeListener.signal.aborted) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          if (!host.getClientRects().length) return;
          // A visit to an auxiliary panel scrolls the document without changing this height.
          const top = Math.max(0, host.getBoundingClientRect().top + window.scrollY);
          measure(Math.floor(window.innerHeight - top - 16));
        });
      }
      const resize = new ResizeObserver(refresh);
      resize.observe(content);
      resize.observe(host);
      window.addEventListener('resize', refresh, { signal: resizeListener.signal });
      function dispose() {
        resizeListener.abort();
        resize.disconnect();
        cancelAnimationFrame(frame);
      }
      listener.signal.addEventListener('abort', dispose, { once: true, signal: resizeListener.signal });
      refresh();
      return { refresh, dispose };
    },
    reveal(target: HTMLElement | SVGElement, block: ScrollLogicalPosition = 'nearest') {
      updateRouteInset();
      target.classList.add('page-frame-reveal');
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block, inline: 'nearest' });
    },
    dispose() {
      listener.abort();
      routeObserver.disconnect();
      shell.style.removeProperty('--active-route-inset');
    },
  };
}
