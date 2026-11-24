import type { CorrectionCategory, SpellingCorrection } from '../types';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Replaces a misheard name, place, or address case-insensitively with word boundaries
 * when the search string begins/ends with alphanumeric characters.
 */
export function applyTermCorrection(
  text: string,
  wrong: string,
  correct: string
): { updated: string; count: number } {
  const cleanWrong = wrong.trim();
  const cleanCorrect = correct.trim();
  if (!text || !cleanWrong || !cleanCorrect || cleanWrong.toLowerCase() === cleanCorrect.toLowerCase()) {
    return { updated: text, count: 0 };
  }

  const startsWord = /^[A-Za-z0-9]/.test(cleanWrong);
  const endsWord = /[A-Za-z0-9]$/.test(cleanWrong);
  const pattern = `${startsWord ? '\\b' : ''}${escapeRegExp(cleanWrong)}${endsWord ? '\\b' : ''}`;
  const regex = new RegExp(pattern, 'gi');

  let count = 0;
  const updated = text.replace(regex, () => {
    count += 1;
    return cleanCorrect;
  });

  return { updated, count };
}

export function applyGlossaryToFields(
  fields: {
    transcript: string;
    title: string;
    subtitle: string;
    eraLabel: string;
    pullQuote: string;
    body: string;
  },
  wrong: string,
  correct: string
): {
  next: {
    transcript: string;
    title: string;
    subtitle: string;
    eraLabel: string;
    pullQuote: string;
    body: string;
  };
  totalCount: number;
} {
  let totalCount = 0;
  const t = applyTermCorrection(fields.transcript, wrong, correct);
  totalCount += t.count;
  const ti = applyTermCorrection(fields.title, wrong, correct);
  totalCount += ti.count;
  const su = applyTermCorrection(fields.subtitle, wrong, correct);
  totalCount += su.count;
  const er = applyTermCorrection(fields.eraLabel, wrong, correct);
  totalCount += er.count;
  const pq = applyTermCorrection(fields.pullQuote, wrong, correct);
  totalCount += pq.count;
  const bo = applyTermCorrection(fields.body, wrong, correct);
  totalCount += bo.count;

  return {
    next: {
      transcript: t.updated,
      title: ti.updated,
      subtitle: su.updated,
      eraLabel: er.updated,
      pullQuote: pq.updated,
      body: bo.updated,
    },
    totalCount,
  };
}

export function groupGlossaryByCategory(glossary: SpellingCorrection[] = []): {
  names: string;
  places: string;
  addresses: string;
} {
  const byCat = (cat: CorrectionCategory) =>
    Array.from(
      new Set(
        glossary
          .filter((item) => item.category === cat && item.correct.trim())
          .map((item) => item.correct.trim())
      )
    ).join(', ');

  return {
    names: byCat('name'),
    places: byCat('place'),
    addresses: byCat('address'),
  };
}
