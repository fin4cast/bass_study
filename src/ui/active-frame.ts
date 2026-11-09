/** Owns at most one animation callback while a mounted view needs updates. */
export function createActiveFrame(render: FrameRequestCallback) {
  let active = false;
  let request: number | null = null;

  function schedule() {
    if (active && request === null) request = requestAnimationFrame(tick);
  }

  function tick(time: number) {
    request = null;
    if (!active) return;
    render(time);
    schedule();
  }

  return {
    setActive(next: boolean) {
      if (active === next) return;
      active = next;
      if (active) schedule();
      else if (request !== null) { cancelAnimationFrame(request); request = null; }
    },
  };
}
