import { createAudioCue } from '../audio/cue';
import { createEarExample, getEarAudioEvents, type EarDegree } from '../ear';
import type { GlobalProfile } from '../storage';

interface Options {
  onChoice(choice: 'guided' | 'free', completed: boolean): void;
  onMaterial(): void;
  onPosition(id: string): void;
  onBeforeListen(): void;
}

/** Guided actions deliberately have no quiz session, answers, or history score. */
export function mountIntroduction(container: HTMLElement, options: Options) {
  const controller = new AbortController();
  const cue = createAudioCue();
  let step = 0; let guided = false; let generation = 0; let found = new Set<string>();
  const steps = [
    '<h3>1. Три звука C major triad</h3><p>C — тоника (ступень 1), E — большая терция (3), G — квинта (5). Трезвучие — аккорд из трёх звуков, расположенных по терциям.</p>',
    '<h3>2. Нота, ступень и позиция</h3><p>Одна октава: <strong>C2 → E2 → G2 → C3</strong>. Позиции: <strong>E/8 → A/7 → A/10 → D/10</strong>. E/8 означает струну E, лад 8; здесь звучит C2, ступень 1. Цифра после названия ноты — октава; C3 на октаву выше C2.</p><p>На грифе ниже выбрана эта полная форма. Нажми позицию и сопоставь ноту, ступень, струну и лад.</p>',
    '<h3>3. Найди звуки с подсказкой</h3><p>Это обучение без оценки. Выбери каждую подписанную позицию: подсказка перенесёт фокус на гриф. Самостоятельные правильные ответы здесь не начисляются.</p><div class="introduction-positions"><button type="button" data-intro-position="E:8">C2 · тоника · E/8</button><button type="button" data-intro-position="A:7">E2 · терция · A/7</button><button type="button" data-intro-position="A:10">G2 · квинта · A/10</button></div><p data-intro-found role="status"></p>',
    '<h3>4. Сравни звучание</h3><p>Сначала звучит опорная C2, затем выбранная ступень. Подписанные образцы не являются ответами на слуховой вопрос.</p><div class="introduction-examples"><button type="button" data-intro-example="1">C2 → C2 · тоника</button><button type="button" data-intro-example="3">C2 → E2 · большая терция</button><button type="button" data-intro-example="5">C2 → G2 · квинта</button></div><p>Для самостоятельной практики открой «Задания» либо начни общий маршрут 3 + 3 + 4 минуты.</p>',
  ];
  function render() {
    container.innerHTML = guided ? `<div class="introduction-card"><div class="section-title"><h2 tabindex="-1">Введение: ${step + 1} из 4</h2><button type="button" class="text-button" data-intro="close">Закрыть введение</button></div>${steps[step]}<p data-intro-audio role="status"></p><div class="introduction-actions"><button type="button" data-intro="back"${step === 0 ? ' disabled' : ''}>Назад</button><button type="button" class="primary-button" data-intro="next">${step === 3 ? 'Перейти к практике' : 'Дальше'}</button></div></div>`
      : '<div class="introduction-card"><h2 tabindex="-1">С чего начнём?</h2><p>Ты знаешь струны и названия нот. Выбери короткое знакомство с тоникой, ступенями и формой или сразу исследуй гриф.</p><div class="introduction-actions"><button type="button" class="primary-button" data-intro="guided">Пройти введение · 4 шага</button><button type="button" class="secondary-button" data-intro="free">Свободная практика</button></div><p>Введение всегда доступно из шапки.</p></div>';
    if (step === 2) container.querySelector('[data-intro-found]')!.textContent = `Изучено позиций: ${found.size} из 3.`;
  }
  const stop = () => { generation++; cue.stop(); };
  const close = () => { stop(); container.hidden = true; document.getElementById('open-introduction')?.focus(); };
  container.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null;
    if (!target) return;
    if (target.dataset.introPosition) { found.add(target.dataset.introPosition); container.querySelector('[data-intro-found]')!.textContent = `Изучено позиций: ${found.size} из 3.`; options.onPosition(target.dataset.introPosition); return; }
    if (target.dataset.introExample) {
      stop(); options.onBeforeListen();
      const run = generation;
      const plan = getEarAudioEvents(createEarExample({ root: 'C', quality: 'major', referenceMidi: 36 }, target.dataset.introExample as EarDegree), 60);
      void cue.play({ bpm: plan.bpm, totalBeats: plan.totalBeats, notes: plan.events.filter(event => event.midi !== null).map(event => ({ midi: event.midi!, beat: event.atBeat, durationBeats: event.durationBeats })) })
        .catch(error => { if (generation === run) container.querySelector('[data-intro-audio]')!.textContent = error instanceof Error ? error.message : String(error); }); return;
    }
    const action = target.dataset.intro;
    if (action === 'free') { options.onChoice('free', false); close(); }
    if (action === 'guided') { guided = true; step = 0; found = new Set(); options.onChoice('guided', false); options.onMaterial(); render(); container.querySelector<HTMLElement>('h2')?.focus(); }
    if (action === 'close') close();
    if (action === 'back') { stop(); step = Math.max(0, step - 1); render(); container.querySelector<HTMLElement>('h2')?.focus(); }
    if (action === 'next') { stop(); if (step === 3) { options.onChoice('guided', true); close(); } else { step++; render(); container.querySelector<HTMLElement>('h2')?.focus(); } }
  }, { signal: controller.signal });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); }, { signal: controller.signal });
  return { open(value?: GlobalProfile) { guided = value?.onboarding.choice === 'guided' && !value.onboarding.completed; step = 0; if (guided) options.onMaterial(); container.hidden = false; render(); }, stop,
    dispose() { stop(); controller.abort(); void cue.dispose(); container.replaceChildren(); } };
}
