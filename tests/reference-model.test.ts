import { describe, expect, it } from 'vitest';
import { REFERENCE_CONCEPTS, conceptBoard, findConcepts, getConcept } from '../src/practice/concepts';
import { answerVerdict, conceptCardHtml } from '../src/ui/reference/card';
import { availableLens, boardSvg, conceptPlainText, conceptTextHtml, levelGroups, levelLabel, positionLabel, relatedExercises } from '../src/ui/reference/model';

const handlers = {};
const card = (id: string, mastered = false) => conceptCardHtml(getConcept(id)!, { scope: 't', mastered, handlers });

describe('разметка текста карточки', () => {
  it('ступени, римские цифры и пальцы получают разные классы', () => {
    const html = conceptTextHtml('{d:♭3} и {r:vi}, палец {f:1}');
    expect(html).toBe('<span class="rf-deg" title="ступень">♭3</span> и <span class="rf-roman" title="римская цифра — аккорд на ступени">vi</span>, палец <span class="rf-finger" title="палец">1</span>');
  });
  it('позиции и выделение', () => {
    expect(conceptTextHtml('**тон**: {p:E/5|A1} → {p:E/7}')).toBe(
      '<b>тон</b>: <span class="rf-pos" title="струна E, лад 5">E/5</span> <span class="rf-pitch">A1</span> → <span class="rf-pos" title="струна E, лад 7">E/7</span>');
    expect(conceptPlainText('Сыграй {p:E/5|A1}, **громче**')).toBe('Сыграй E/5 A1, громче');
  });
  it('экранирует всё, что пришло из текста', () => {
    const html = conceptTextHtml('<img src=x onerror="alert(1)"> & **<i>** {d:<b>} {p:A/3|<s>}');
    expect(html).not.toMatch(/<(img|i|s)[ >]/);
    expect(html.match(/<b>/g)).toHaveLength(1);
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; ');
    expect(html).toContain('<b>&lt;i&gt;</b>');
    expect(html).toContain('<span class="rf-deg" title="ступень">&lt;b&gt;</span>');
    expect(html).toContain('<span class="rf-pitch">&lt;s&gt;</span>');
  });
  it('все тексты справочника разбираются', () => {
    for (const concept of REFERENCE_CONCEPTS) expect(() => card(concept.id)).not.toThrow();
  });
});

describe('мини-гриф и линзы', () => {
  it('подпись зависит от линзы и показа октавы', () => {
    const position = { id: 'E:5', label: 'A♯1', interval: 'м3', degree: '♭3' };
    expect(positionLabel(position, 'notes', true)).toBe('A♯1');
    expect(positionLabel(position, 'notes', false)).toBe('A♯');
    expect(positionLabel(position, 'intervals', false)).toBe('м3');
    expect(positionLabel(position, 'degrees', false)).toBe('♭3');
    expect(positionLabel({ id: 'E:5', label: 'A1' }, 'degrees', false)).toBe('A');
  });
  it('недоступная линза заменяется умолчанием карточки', () => {
    const board = conceptBoard(getConcept('degree')!)!;
    expect(availableLens(board, undefined)).toBe('degrees');
    expect(availableLens(board, 'chord-tones')).toBe('degrees');
    expect(availableLens(board, 'notes')).toBe('notes');
  });
  it('рисует настоящие позиции с ролями, пальцами и подписью', () => {
    const concept = getConcept('semitone')!;
    const svg = boardSvg(conceptBoard(concept)!, 'notes', concept.title);
    expect(svg.match(/class="rf-b-note /g)).toHaveLength(3);
    expect(svg).toContain('rf-b-note is-root');
    expect(svg.match(/class="rf-b-finger"/g)).toHaveLength(3);
    expect(svg).toContain('role="img"');
    expect(svg).toContain('E/5 A, E/6 A♯, E/7 B');
    const shared = getConcept('shared-notes')!;
    expect(boardSvg(conceptBoard(shared)!, 'degrees', shared.title).match(/rf-b-ring/g)).toHaveLength(1);
    expect(() => boardSvg({ ...conceptBoard(concept)!, fretMin: 5, fretMax: 2 }, 'notes', 'x')).toThrow();
  });
});

describe('карточка', () => {
  it('содержит три шага R-027 и связанные упражнения каталога', () => {
    const html = card('octave-numbers');
    expect(html).toContain('Сыграй и послушай');
    expect(html).toContain('Как это называется');
    expect(html).toContain('Зачем басисту');
    expect(html).toContain('Проверь себя · 1 мин');
    expect(html).toContain('контроктава');
    expect(html).toContain('B или H?');
    expect(html).toContain('data-template="note-all-positions"');
    expect(relatedExercises(['octaves'])[0]).toEqual({ id: 'octaves', title: 'Октавы: +2 струны, +2 лада', category: 'Ноты на грифе' });
    expect(card('degree')).toContain('Три вида подписей');
    expect(card('beat-bar')).toContain('вне каталога · раздел «Ритм»');
    expect(card('major-formula')).toContain('rf-formula');
  });
  it('верный ответ и объяснение не попадают в разметку до выбора', () => {
    for (const concept of REFERENCE_CONCEPTS) {
      const check = (concept.full ?? concept.brief)!.check;
      const html = card(concept.id);
      expect(html).not.toContain(conceptTextHtml(check.explanation));
      expect(html).not.toMatch(/data-(answer|correct|right)/);
    }
    const check = getConcept('semitone')!.full!.check;
    expect(answerVerdict(check, 1)).toMatchObject({ right: true });
    expect(answerVerdict(check, 1).html).toContain('Верно.');
    expect(answerVerdict(check, 0)).toEqual({ right: false, html: '<b>Не то — попробуй ещё.</b>' });
    expect(() => answerVerdict(check, 5)).toThrow();
  });
  it('«Послушать» без звука выключено честно, «освоено» — из состояния', () => {
    expect(card('octave')).toMatch(/data-listen disabled/);
    expect(card('octave')).toContain('звук подключится позже');
    expect(conceptCardHtml(getConcept('octave')!, { scope: 't', mastered: false, handlers: { onListen: () => {} } })).not.toContain('data-listen disabled');
    expect(card('octave', true)).toContain('aria-pressed="true"');
  });
});

describe('список и поиск', () => {
  it('группы уровней со счётчиком освоенного и повтором октавы в «Интервалах»', () => {
    const groups = levelGroups(REFERENCE_CONCEPTS, new Set(['semitone', 'octave']));
    expect(groups.map(group => group.title)).toEqual(['Ориентация', 'Интервалы как формы', 'Ступени и гаммы', 'Тоны аккорда', 'Ритм · параллельно', 'Чтение · параллельно']);
    expect(groups[0]).toMatchObject({ total: 6, mastered: 2 });
    expect(groups[1].items.filter(item => item.alias).map(item => item.concept.id)).toEqual(['octave']);
    expect(levelLabel(2)).toBe('Уровень 2 · Ступени и гаммы');
    expect(levelLabel('rhythm')).toBe('Ритм · параллельно');
  });
  it('поиск без учёта регистра и ё/е', () => {
    expect(levelGroups(findConcepts('ТЁРЦИЯ'), new Set()).flatMap(group => group.items.map(item => item.concept.id))).toEqual(['thirds']);
    expect(findConcepts('h').map(concept => concept.id)).toContain('octave-numbers');
    expect(levelGroups(findConcepts('несуществующее'), new Set())).toEqual([]);
  });
});
