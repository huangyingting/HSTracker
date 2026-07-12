type SourceTechnicalTerms = {
  chemicalFormulas: string[];
  latinNames: string[];
};

type LocatedTerm = {
  value: string;
  index: number;
};

const CHEMICAL_ELEMENT_SYMBOLS = new Set(
  [
    "H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe",
    "Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd",
    "In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb",
    "Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np",
    "Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc",
    "Lv Ts Og",
  ]
    .join(" ")
    .split(" "),
);

export function preserveSourceTechnicalTerms(
  sourceDescription: string,
  translation: string,
): string {
  const missing = missingSourceTechnicalTerms(
    sourceDescription,
    translation,
  );
  const terms = sourceTechnicalTerms(sourceDescription)
    .filter(
      ({ value }) =>
        missing.chemicalFormulas.includes(value) ||
        missing.latinNames.includes(value),
    )
    .map(({ value }) => value);
  return terms.length === 0
    ? translation
    : `${translation} (${terms.join("; ")})`;
}

export function preserveSourceScopeQualifiers(
  sourceDescription: string,
  translation: string,
): string {
  if (
    /\bnot knitted or crocheted\b/iu.test(sourceDescription) &&
    !/(?:非|不)[^，,;；:：()（）]{0,12}(?:针织|钩编)/u.test(translation)
  ) {
    return `${translation}（非针织或钩编）`;
  }
  return translation;
}

export function missingSourceTechnicalTerms(
  sourceDescription: string,
  translation: string,
): SourceTechnicalTerms {
  const terms = sourceTechnicalTerms(sourceDescription);
  return {
    chemicalFormulas: terms
      .filter(({ kind, value }) => kind === "chemical" && !translation.includes(value))
      .map(({ value }) => value),
    latinNames: terms
      .filter(({ kind, value }) => kind === "latin" && !translation.includes(value))
      .map(({ value }) => value),
  };
}

function sourceTechnicalTerms(
  sourceDescription: string,
): (LocatedTerm & { kind: "chemical" | "latin" })[] {
  const terms: (LocatedTerm & { kind: "chemical" | "latin" })[] = [];
  for (const match of sourceDescription.matchAll(/\b[A-Za-z][A-Za-z0-9]*\b/gu)) {
    const value = match[0];
    if (match.index !== undefined && isChemicalFormula(value)) {
      terms.push({ kind: "chemical", value, index: match.index });
    }
  }
  for (const term of latinNameTerms(sourceDescription)) {
    terms.push({ kind: "latin", ...term });
  }
  const seen = new Set<string>();
  const retained: (LocatedTerm & { kind: "chemical" | "latin" })[] = [];
  return terms
    .sort(
      (left, right) =>
        left.index - right.index || right.value.length - left.value.length,
    )
    .filter((term) => {
      if (
        seen.has(term.value) ||
        retained.some(
          (candidate) =>
            candidate.index === term.index &&
            candidate.value.startsWith(term.value),
        )
      ) {
        return false;
      }
      seen.add(term.value);
      retained.push(term);
      return true;
    });
}

function isChemicalFormula(value: string): boolean {
  const symbols = parseChemicalFormulaSymbols(value);
  return (
    symbols !== null &&
    symbols.length >= 2 &&
    (/\d/u.test(value) || (/[a-z]/u.test(value) && !value.endsWith("s")))
  );
}

function parseChemicalFormulaSymbols(value: string): string[] | null {
  const symbols: string[] = [];
  let index = 0;
  while (index < value.length) {
    let symbol: string;
    if (/[A-Z]/u.test(value[index]!)) {
      const pair = value.slice(index, index + 2);
      symbol =
        /^[A-Z][a-z]$/u.test(pair) && CHEMICAL_ELEMENT_SYMBOLS.has(pair)
          ? pair
          : value[index]!;
    } else if (
      /[a-z]/u.test(value[index]!) &&
      index > 0 &&
      /\d/u.test(value[index - 1]!)
    ) {
      symbol = value[index]!.toUpperCase();
    } else {
      return null;
    }
    if (!CHEMICAL_ELEMENT_SYMBOLS.has(symbol)) {
      return null;
    }
    symbols.push(symbol);
    index += symbol.length;
    while (index < value.length && /\d/u.test(value[index]!)) {
      index += 1;
    }
  }
  return symbols;
}

function latinNameTerms(sourceDescription: string): LocatedTerm[] {
  const terms: LocatedTerm[] = [];
  collectMatches(
    sourceDescription,
    /\bspecies\s+([A-Z][a-z]+\s+[a-z]+(?:-[a-z]+)*)\b/gu,
    1,
    terms,
  );
  collectMatches(
    sourceDescription,
    /\bgenus\s+([A-Z][a-z]+)\b/gu,
    1,
    terms,
  );
  for (const parenthetical of parentheticalSegments(sourceDescription)) {
    collectMatches(
      parenthetical.value,
      /\b([A-Z][a-z]+\s+\([A-Z][a-z]+\)\s+[a-z]+(?:-[a-z]+)*)\b/gu,
      1,
      terms,
      parenthetical.index,
    );
    collectMatches(
      parenthetical.value,
      /\b([A-Z][a-z]+\s+[a-z]+(?:-[a-z]+)*(?:\s*\/\s*[a-z]+(?:-[a-z]+)*)+)\b/gu,
      1,
      terms,
      parenthetical.index,
    );
    collectMatches(
      parenthetical.value,
      /\b([A-Z][a-z]+\s+(?:spp\.|(?!and\b|or\b|hemp\b)[a-z]+(?:-[a-z]+)*(?:\s+[A-Z][a-z]+\.?)?))/gu,
      1,
      terms,
      parenthetical.index,
    );
    collectMatches(
      parenthetical.value,
      /\b((?:[A-Z][a-z]*(?:idae|ales|formes)))\b/gu,
      1,
      terms,
      parenthetical.index,
    );
    collectMatches(
      parenthetical.value,
      /\b(?:order|suborder|family|genus)\s+([A-Z][a-z]+)\b/gu,
      1,
      terms,
      parenthetical.index,
    );
  }
  return terms;
}

function parentheticalSegments(value: string): LocatedTerm[] {
  const segments: LocatedTerm[] = [];
  const starts: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "(") {
      starts.push(index);
    } else if (value[index] === ")" && starts.length > 0) {
      const start = starts.pop()!;
      segments.push({
        value: value.slice(start + 1, index),
        index: start + 1,
      });
    }
  }
  return segments;
}

function collectMatches(
  value: string,
  pattern: RegExp,
  group: number,
  target: LocatedTerm[],
  offset = 0,
): void {
  for (const match of value.matchAll(pattern)) {
    const matchedValue = match[group];
    if (
      matchedValue !== undefined &&
      match.index !== undefined &&
      match[0] !== undefined
    ) {
      target.push({
        value: matchedValue,
        index: offset + match.index + match[0].indexOf(matchedValue),
      });
    }
  }
}
