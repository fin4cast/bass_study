export type AudioOwner = 'sequence' | 'ear' | 'rhythm' | 'tracks' | 'scores' | 'input' | 'introduction';
export type AudioExit = 'owner' | 'section' | 'route' | 'settings' | 'restore' | 'retire';

/** The application arbitrates starts. Each participant owns cancellation of its pending work. */
export function createAudioOwner(options: {
  canStart(owner: AudioOwner): boolean;
  participants: Record<AudioOwner, (reason: AudioExit) => void>;
  cancelScorePreparation(): void;
}) {
  let current: AudioOwner | null = null;
  return {
    claim(owner: AudioOwner) {
      if (!options.canStart(owner)) return false;
      if (current !== owner) {
        const previous = current;
        current = owner;
        if (previous) options.participants[previous]('owner');
        if (owner !== 'scores' && previous !== 'scores') options.cancelScorePreparation();
      }
      return true;
    },
    end(owner: AudioOwner, reason: AudioExit) {
      if (current === owner) current = null;
      options.participants[owner](reason);
    },
    endAll(reason: AudioExit) {
      current = null;
      for (const interrupt of Object.values(options.participants)) interrupt(reason);
    },
    // Visibility handlers already pause or disconnect using their own transport semantics.
    forget(owner?: AudioOwner) {
      if (owner === undefined || current === owner) current = null;
    },
  };
}
