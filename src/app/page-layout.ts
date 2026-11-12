export interface PageHeightObservation {
  refresh(): void;
  dispose(): void;
}

/** Shell owns viewport height. Feature panes retain their own scroll. */
export function createPageLayout(content: HTMLElement) {
  const listener = new AbortController();

  return {
    observeHeight(host: HTMLElement, measure: (available: number) => void): PageHeightObservation {
      const resizeListener = new AbortController();
      let frame = 0;
      function refresh() {
        if (frame || resizeListener.signal.aborted) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          if (!host.getClientRects().length) return;
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
      target.classList.add('page-frame-reveal');
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block, inline: 'nearest' });
    },
    dispose() { listener.abort(); },
  };
}
