// A regra vai escrita no próprio idioma: modelos pequenos obedecem melhor assim.
const LANGUAGES = {
  'pt-BR': {
    label: 'Português (BR)',
    rule: 'Responda SEMPRE e SOMENTE em português do Brasil. Nunca use palavras em inglês ou de outro idioma, mesmo no início da frase.',
  },
  en: {
    label: 'English',
    rule: 'ALWAYS reply ONLY in English. Never mix in words from other languages.',
  },
  es: {
    label: 'Español',
    rule: 'Responde SIEMPRE y SOLO en español. Nunca mezcles palabras de otros idiomas.',
  },
  fr: {
    label: 'Français',
    rule: 'Réponds TOUJOURS et UNIQUEMENT en français. Ne mélange jamais de mots d’autres langues.',
  },
  de: {
    label: 'Deutsch',
    rule: 'Antworte IMMER und NUR auf Deutsch. Mische niemals Wörter aus anderen Sprachen ein.',
  },
  it: {
    label: 'Italiano',
    rule: 'Rispondi SEMPRE e SOLO in italiano. Non mescolare mai parole di altre lingue.',
  },
  ja: {
    label: '日本語',
    rule: '必ず日本語だけで答えてください。他の言語の単語を混ぜないでください。',
  },
};

function languageRule(code) {
  return (LANGUAGES[code] ?? LANGUAGES['pt-BR']).rule;
}

function languageList() {
  return Object.entries(LANGUAGES).map(([code, { label }]) => ({ code, label }));
}

module.exports = { languageRule, languageList };
